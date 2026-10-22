import 'server-only';

/**
 * Bốn tầng kiểm tra trước khi bất kỳ op nào chạm database.
 *
 *   1. Cú pháp     — op có đúng hình dạng không
 *   2. Ngữ nghĩa   — node tồn tại, token có thật, effect có thật, vùng khoá
 *   3. Dry-run     — apply lên bản sao, bắt lỗi của chính engine
 *   4. Bất biến    — không mồ côi, không cycle, parentId ↔ children nhất quán
 *
 * Bốn tầng chứ không phải một, vì mỗi tầng bắt một loại lỗi khác nhau và tầng
 * sau không thay được tầng trước. Cùng một hàm này chạy cho op đến từ inspector
 * và op đến từ AI — đó là điểm mấu chốt của thiết kế op có kiểu.
 */

import { z } from 'zod';

import { prisma } from '@/lib/db';
import { VIRTUAL_KEYS } from '@/lib/collections/repeat';
import { compositeParamsSchema, isKnownComposite } from '@/lib/composites/registry';
import { isKnownEffect, loadEffect } from '@/lib/motion/effects/registry';
import type { AnyEffectModule } from '@/lib/motion/effects/types';
import { stylePathsForProperty } from '@/lib/builder/style-css-map';
import { sanitizeCustomCss } from '@/lib/render/sanitize-css';
import { AI_CSS_ALLOWLIST, CSS_ESCAPE_HINT, cssPropertiesIn } from './ai-css-allowlist';
import { expandPreset, loadEffectPresets } from './effect-presets';
import type { Actor } from './validate-types';
import { apply, OpError, type Op } from './ops';
import { propsKeysFor, zodIssuesRaw, zOps, zPropsFor, zRepeatSpec } from './schema';
import { nearestStylePaths } from './style-shape';
import { structuralIssues } from './structure';
import type { Doc, NodeType, RepeatSpec } from './types';
import { NODE_TYPES, isLeafType } from './types';

export interface ValidationIssue {
  /** Vị trí op trong mảng. -1 nghĩa là lỗi ở mức toàn cục. */
  index: number;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /**
   * Điều đáng nói mà KHÔNG chặn: op vẫn được áp.
   *
   * Tồn tại vì hai loại "đã làm nhưng không như bạn tưởng" trước đây im lặng
   * hoàn toàn: `customCss` bị sanitize gỡ bớt (`@keyframes`, `!important`,
   * `position:fixed`) — cảnh báo có sẵn trong `sanitizeCustomCss` nhưng chỉ chạy
   * lúc render và bị `compileDoc` bỏ đi — và `style.states` ghi một tên state mà
   * không effect nào trên node ghi ra, tức CSS đúng và không bao giờ khớp.
   *
   * Dùng cùng hình dạng với `issues` để `index` vẫn trỏ đúng op.
   */
  warnings?: ValidationIssue[];
  /** Chỉ có khi ok. */
  doc?: Doc;
  /**
   * Ops đã qua Zod. Bên gọi phải dùng MẢNG NÀY chứ không phải input thô — Zod đã
   * bỏ field thừa và điền default, nên `invert` tính trên input thô sẽ sinh ra
   * nghịch đảo cho một batch khác với batch thực sự được áp.
   */
  ops?: Op[];
}

/** Tên token hợp lệ, nạp một lần mỗi request. */
async function loadTokenNames(): Promise<Set<string>> {
  const rows = await prisma.token.findMany({
    where: { deprecated: false },
    select: { name: true },
  });
  return new Set(rows.map((r) => r.name));
}

/**
 * `key` effect → `statesWritten` của nó, đọc từ bảng `Effect`.
 *
 * Đọc DB chứ không import manifest: `registry.ts` nạp module bằng `import()` động
 * và mọi `init()` chạm `document`, nên kéo nó vào đường ghi server là kéo cả
 * runtime DOM vào. Bảng `Effect` là bản sao được `pnpm effects:sync` sinh ra từ
 * chính manifest đó — xem `scripts/sync-effects.ts`.
 *
 * Effect có trong registry mà VẮNG trong bảng (chưa sync) trả về `undefined`, và
 * chỗ gọi phân biệt được "effect này không ghi state nào" với "không đọc được
 * effect này". Hai ca đó không được xử lý giống nhau: ca thứ hai mà chặn thì một
 * bảng chưa sync làm mọi state tuỳ chỉnh thành bất khả.
 */
async function loadEffectStates(): Promise<Map<string, string[]>> {
  const rows = await prisma.effect.findMany({ select: { key: true, statesWritten: true } });
  return new Map(rows.map((r) => [r.key, r.statesWritten]));
}

/** Tên và kiểu field của mỗi loại nội dung — chỉ hai thứ mà luật `map` cần. */
export interface FieldShape {
  key: string;
  t: string;
}

/**
 * `typeKey` → field của loại đó.
 *
 * ## Vì sao đọc thẳng prisma chứ không gọi `getCollectionTypes()`
 *
 * Hàm kia bọc `unstable_cache` với `revalidate: 3600`. Ở đường ĐỌC đó là đúng.
 * Ở đường GHI nó là một cái bẫy: thêm một field rồi ánh xạ nó ngay trong cùng một
 * buổi làm việc sẽ bị từ chối với câu "loại này không có field ấy" — sai, và sai
 * theo kiểu không ai tin nổi. Một validator đối chiếu với bản cache là một
 * validator nói dối trong đúng một giờ.
 *
 * Cùng lý do (và cùng khuôn) với `loadTokenNames` ngay trên.
 *
 * Không chạy `validateCollectionSchema`: luật `map` chỉ cần TÊN và KIỂU. Kéo cả
 * bộ kiểm cấu trúc vào đây là kéo thêm một lượt đọc `loadGroupTable`, cho một
 * câu trả lời không dùng tới.
 */
async function loadCollectionFields(): Promise<Map<string, FieldShape[]>> {
  const rows = await prisma.collectionType.findMany({ select: { key: true, schema: true } });
  const out = new Map<string, FieldShape[]>();
  for (const r of rows) {
    if (!Array.isArray(r.schema)) continue;
    const fields: FieldShape[] = [];
    for (const f of r.schema as unknown[]) {
      if (!f || typeof f !== 'object') continue;
      const { key, t } = f as { key?: unknown; t?: unknown };
      if (typeof key === 'string' && typeof t === 'string') fields.push({ key, t });
    }
    out.set(r.key, fields);
  }
  return out;
}

/** Mọi `$token` xuất hiện trong một giá trị bất kỳ. */
function collectTokens(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectTokens(v, out);
    return out;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$token === 'string') {
      out.add(obj.$token);
      return out;
    }
    for (const v of Object.values(obj)) collectTokens(v, out);
  }
  return out;
}

// `Actor` sống ở `./validate-types` để module thuần dùng được nó mà không kéo
// theo Prisma. Re-export để mọi chỗ đang import từ đây vẫn chạy.
export type { Actor } from './validate-types';

// Allowlist property cho AI đã chuyển sang `./ai-css-allowlist` — nó thuần, còn
// file này khai `server-only` và import prisma. Xem docblock ở đó.

/* ── Luật cho `repeat` ────────────────────────────────────────────────── */

/**
 * Lặp lồng nhau tối đa hai cấp (`taxonomy` → `group-entries`) — spec §5.1.
 *
 * Cấp thứ ba nhân số truy vấn với số item của cấp hai, và nó làm thế mà không
 * báo gì: trang chỉ chậm dần theo số bài trong database.
 */
const REPEAT_MAX_DEPTH = 2;

/**
 * Số cấp lặp từ `parentId` trở lên — KHÔNG tính node đang kiểm.
 *
 * `repeat` đang được kiểm là cái op này sắp gắn, nên node đó có thể chưa nằm
 * trong `doc.nodes`. "Tổng độ sâu sau khi áp op" = kết quả hàm này + 1, nên
 * `>= REPEAT_MAX_DEPTH` ở chỗ gọi tương đương "tổng độ sâu > REPEAT_MAX_DEPTH".
 *
 * `seen` không phải để phòng xa: tầng 4 mới bắt cycle, và tầng này chạy TRƯỚC
 * nó — một doc đã có cycle sẽ làm vòng while ở đây chạy mãi mãi, tức route treo
 * chứ không trả lỗi.
 */
function ancestorRepeatDepth(doc: Doc, parentId: string | null): number {
  let depth = 0;
  let cur = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = doc.nodes[cur];
    if (!n) break;
    if (n.type === 'Instance' && n.repeat) depth += 1;
    cur = n.parentId;
  }
  return depth;
}

/** Nguồn lặp của tổ tiên gần nhất có lặp, hoặc `null` nếu không có tổ tiên nào lặp. */
function nearestRepeatKind(doc: Doc, parentId: string | null): string | null {
  return nearestRepeatSource(doc, parentId)?.kind ?? null;
}

/**
 * `source` của tổ tiên gần nhất có lặp, tính TỪ `parentId` trở lên (bao gồm nó).
 *
 * Nhận cha chứ không nhận chính node, vì hai op cần hai cách tìm cha khác nhau:
 * `setProps` gắn `repeat` lên một node ĐÃ có trong doc, còn `insertNode` gắn nó
 * lên một node CHƯA có — `doc.nodes[id]` là `undefined`, `parentId` là `null`, và
 * hàm này trả `null` cho một node thực ra có cha đàng hoàng.
 *
 * Đó không phải chuyện lý thuyết: nó làm luật `repeat_group_parent` từ chối đúng
 * cái op mà nó sinh ra để phục vụ — chèn một khối lặp `group-entries` vào trong
 * một khối lặp theo danh mục. Lỗi ấy nằm im suốt thời gian `Instance` chưa nhận
 * node con, vì ca đó chưa dựng được.
 */
function nearestRepeatSource(doc: Doc, parentId: string | null): RepeatSpec['source'] | null {
  let cur = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = doc.nodes[cur];
    if (!n) break;
    if (n.type === 'Instance' && n.repeat) return n.repeat.source;
    cur = n.parentId;
  }
  return null;
}

/**
 * "Node lá này có được nhận con không" — câu trả lời, hoặc `null` nếu được.
 *
 * ## Vì sao `Instance` có một ngoại lệ, và chỉ một
 *
 * `Instance` nằm trong `LEAF_TYPES` vì con của nó đến từ cây component. Đó vẫn
 * đúng cho MỌI instance thường, và mọi màn builder vẫn coi nó là lá
 * (`isLeafType` không đổi).
 *
 * Ngoại lệ duy nhất là cây "FAQ theo danh mục": ngoài lặp theo `taxonomy`, trong
 * lặp theo `group-entries`. Cây ấy đã có đủ mọi thứ từ mốc 3 — nguồn
 * `group-entries`, `resolveTaxonomyTree` giải hai cấp bằng ba truy vấn, luật
 * `repeat_group_parent` kèm test, và cả mục chọn trong Inspector — TRỪ đường ghi.
 * Chú thích ở `collection-page.ts` đã ghi thẳng điều đó, và cái giá phải trả ở
 * `Website-MM` là trang `/blogs` gõ tay một hàng cho mỗi danh mục, mỗi hàng ghim
 * cứng một id danh mục. Thêm một danh mục là phải sửa trang.
 *
 * ## Hai điều kiện, cả hai đều cần
 *
 * Cha phải ĐANG LẶP, và con phải là một instance lặp nguồn `group-entries`. Thiếu
 * vế đầu thì con không có danh mục nào để lọc; thiếu vế sau thì renderer render
 * một node con mà không ai bind dữ liệu cho nó, và nó lặp lại y hệt ở mọi item.
 *
 * Đọc `doc.nodes` tức cây TRƯỚC batch — cùng giới hạn "chỉ tham chiếu tiến" mà
 * các luật cây khác trong file này đã chấp nhận.
 */
function nestedRepeatIssue(doc: Doc, parentId: string, child: unknown): string | null {
  const parent = doc.nodes[parentId];
  if (parent?.type !== 'Instance') return `${parent?.type} không nhận node con.`;

  if (!parent.repeat) {
    return (
      'Instance không nhận node con — con của nó đến từ cây component. ' +
      'Ngoại lệ duy nhất: một Instance đang lặp theo danh mục nhận một khối lặp ' +
      '"bài trong danh mục của khối cha".'
    );
  }
  if (parent.repeat.source.kind !== 'taxonomy') {
    return (
      'Chỉ khối lặp theo DANH MỤC mới nhận node con. Khối này đang lặp theo ' +
      `"${parent.repeat.source.kind}".`
    );
  }

  const c = child as { type?: unknown; repeat?: { source?: { kind?: unknown } } } | null;
  if (c?.type !== 'Instance' || c.repeat?.source?.kind !== 'group-entries') {
    return (
      'Con của một khối lặp theo danh mục phải là một Instance có nguồn lặp ' +
      '"bài trong danh mục của khối cha".'
    );
  }

  // Trần một con: `zNode` đã chặn hình dạng, nhưng op chèn con THỨ HAI đi qua
  // `insertNode` chứ không qua `zNode` của cha, nên nó phải được chặn ở đây.
  if (parent.children.length > 0) {
    return 'Khối lặp theo danh mục chỉ nhận MỘT khối lặp con.';
  }

  return null;
}

/* ── Khoá `map` của khối lặp ──────────────────────────────────────────── */

/**
 * Item của nguồn `taxonomy` là một DANH MỤC, không phải entry.
 *
 * `resolveTaxonomyTree` dựng nó với đúng ba khoá dưới đây, cộng `slug` (là `key`
 * của danh mục). Nó KHÔNG có field của loại nội dung nào, nên đối chiếu nó với
 * `FieldDef[]` sẽ từ chối đúng những cấu hình đang chạy tốt.
 */
const TAXONOMY_ITEM_KEYS = ['name', 'key', 'count', 'slug'];

/**
 * Loại nội dung mà item của một khối lặp đến từ, hoặc `null` nếu không biết được.
 *
 * `group-entries` lấy loại từ khối cha đang lặp theo danh mục — cùng chỗ mà
 * `resolveAllRepeats` lấy. `field` thì item là một phần tử của một mảng JSONB bất
 * kỳ, không có schema nào để đối chiếu.
 */
function repeatTypeKey(doc: Doc, parentId: string | null, source: RepeatSpec['source']): string | null {
  if (source.kind === 'query') return source.query.typeKey;
  if (source.kind === 'related') return source.typeKey;
  if (source.kind === 'group-entries') {
    const parent = nearestRepeatSource(doc, parentId);
    return parent?.kind === 'taxonomy' ? parent.typeKey : null;
  }
  return null;
}

/**
 * Khoá `map` không bao giờ resolve được → câu lỗi, hoặc `null` nếu khoá đọc được.
 *
 * ## Vì sao phải chặn ở ĐƯỜNG GHI
 *
 * `itemOverrides` cố ý bỏ qua giá trị vắng mặt, và lý do ấy đúng: vắng override
 * thì thẻ giữ chữ gốc của component, trông có chủ đích hơn một thẻ trắng. Hệ quả
 * là một khoá KHÔNG BAO GIỜ resolve được cũng im lặng y như một bài tình cờ thiếu
 * dữ liệu — không lỗi, không cảnh báo, chỉ mười thẻ mang chữ mẫu.
 *
 * Đó là lỗi đã ở trên site thật: `map: { taxonomy: … }` trên
 * `/blogs/san-pham` trên staging, bản đã publish, mọi thẻ mang huy hiệu
 * `Danh mục`. Nó lọt qua vì không tầng nào biết `taxonomy` có nghĩa gì.
 *
 * ## `relation` thì ĐI QUA — từ khi khối lặp nở được quan hệ
 *
 * Trước đây nhánh này từ chối `relation`, vì cột lưu ID và ánh xạ nó sẽ in nguyên
 * một cuid lên thẻ tin. `relation-expand.ts` giải chuyện đó ở tầng resolve: bản
 * ghi đích được nở thành `{ title, href, assetId }` trước khi tới `itemOverrides`.
 * Nên từ chối ở đây bây giờ là chặn một cấu hình CHẠY ĐƯỢC.
 */
function mapKeyIssue(key: string, fields: FieldShape[], typeKey: string): string | null {
  const field = fields.find((f) => f.key === key);

  if (field?.t === 'taxonomy') {
    return (
      `Khoá \`${key}\` là field danh mục, mà danh mục nằm ở bảng nối \`EntryTaxonomy\` ` +
      'chứ không nằm trong `data` — ánh xạ nó không bao giờ có tác dụng. ' +
      'Dùng `taxonomy` (danh mục đầu tiên) hoặc `taxonomies` (tất cả).'
    );
  }

  if (field || VIRTUAL_KEYS[key]) return null;

  const virtuals = Object.entries(VIRTUAL_KEYS)
    .map(([k, v]) => `\`${k}\` (${v.note})`)
    .join(', ');
  return (
    `Loại \`${typeKey}\` không có field \`${key}\`. Field đang có: ` +
    `${fields.map((f) => `\`${f.key}\``).join(', ') || '(chưa có field nào)'}. ` +
    `Ngoài chúng còn đọc được: ${virtuals}.`
  );
}

/**
 * "ý bạn là `effects.backdropBlur`?" cho một khoá style gõ sai.
 *
 * ## Vì sao câu lỗi trần là không đủ
 *
 * `zStyleProps` là `.strict()`, nên khoá sai cho ra đúng một dòng:
 * `Unrecognized key(s) in object: 'backdropBlur'`. Với người đọc có repo thì đủ.
 * Với một agent chỉ nối MCP thì không: nó không biết `zStyleProps` có tám nhóm và
 * nhóm nào chứa gì, nên nó ĐOÁN một nhóm khác rồi thử lại. Đo 07/09/2026: bốn lần
 * đoán (`fill.blur`, `backdrop.blur`, `effect.backdropBlur`, `fill.backdropBlur`)
 * rồi kết luận SAI rằng builder thiếu hẳn tính năng backdrop blur — thứ đã có từ
 * đầu ở `effects.backdropBlur`, kèm cả bản `-webkit-` trong compiler.
 *
 * Ca hay gặp nhất là đúng TÊN FIELD, sai NHÓM, nên `nearestStylePaths` so cả
 * đường dẫn lẫn riêng tên field.
 *
 * Trả chuỗi rỗng khi không có gợi ý đủ gần: một câu "ý bạn là" bịa ra còn tệ hơn
 * không có gì, vì nó dẫn agent đi thêm một vòng sai.
 */
function styleKeyHint(issue: z.ZodIssue): string {
  if (issue.code !== 'unrecognized_keys') return '';

  // Path của một khoá lạ trong style patch: [index, 'patch', '<nhóm>'].
  const group = issue.path.filter((p): p is string => typeof p === 'string').at(-1);
  const keys = (issue as unknown as { keys?: string[] }).keys ?? [];

  const hints = keys
    .map((k) => {
      const guess = nearestStylePaths(group && group !== 'patch' ? `${group}.${k}` : k, 2);
      return guess.length ? `${k} → ${guess.join(' | ')}` : null;
    })
    .filter((v): v is string => Boolean(v));

  return hints.length ? ` — ý bạn là: ${hints.join('; ')}?` : '';
}

/* ── Hợp đồng của `setProps` ──────────────────────────────────────────── */

/**
 * Câu lỗi cho một khoá KHÔNG có trong hợp đồng của node type.
 *
 * Người đọc là người đang dựng trang qua MCP: họ không có repo để tra `zNode`,
 * nên câu lỗi phải mang theo danh sách field đặt được. Không có danh sách thì họ
 * ĐOÁN một tên khác và thử lại — đúng vòng lặp bốn lần đoán mà `styleKeyHint`
 * sinh ra để cắt.
 *
 * `params` có một câu riêng vì nó là khoá bị đoán nhiều nhất, và vì trả lời "node
 * này không có field ấy" là chưa đủ: câu hỏi thật đằng sau nó là "làm sao truyền
 * tham số cho component", và câu trả lời là KHÔNG CÓ cơ chế đó.
 */
/**
 * Khoá mà node KHÔNG có, kèm chỗ nó thật sự nằm.
 *
 * Ba khoá này không phải gõ sai — chúng là tên khoá của `ContentOverride`, và
 * `builder/push-override.ts` đẩy nguyên xi chúng lên node. Câu "node không có
 * field ấy" là đúng nhưng vô dụng ở đây: thứ người gửi cần biết là field ĐÍCH.
 */
const MISPLACED_PROPS: Record<string, string> = {
  href: '`href` nằm trong `action.href` của Button — và `action` phải gửi ĐỦ object, kèm `kind`.',
  a11yLabel: '`a11yLabel` nằm trong `a11y.label`.',
  posterAssetId: '`posterAssetId` chỉ có trên node Video.',
};

function unknownPropsMessage(type: string, bad: string[]): string {
  const keys = propsKeysFor(type);
  const list = keys.length ? keys.map((k) => `\`${k}\``).join(', ') : '(không có field nào)';

  const moved = bad.map((k) => MISPLACED_PROPS[k]).filter(Boolean).join(' ');

  const paramsHint =
    bad.some((k) => k === 'params' || k === 'props' || k === 'vars') && type !== 'Composite'
      ? ` Node ${type} KHÔNG có cơ chế tham số: \`params\` là field của node ` +
        '`Composite` (Form, Accordion…). Một `Instance` nhận khác biệt ' +
        'qua `overrides` (NỘI DUNG: content, label, alt, assetId, href, a11yLabel) ' +
        'và qua slot của component; còn style thì đặt bằng `setStyle` trên node ' +
        'trong CÂY COMPONENT (apply_component_ops), không truyền vào từ trang.'
      : '';

  return (
    `Node ${type} không có field ${bad.map((k) => `\`${k}\``).join(', ')} — ` +
    'setProps sẽ ghi nó vào doc rồi không renderer nào đọc. ' +
    `Field đặt được trên ${type}: ${list}.` +
    (moved ? ` ${moved}` : '') +
    paramsHint
  );
}

/**
 * Câu lỗi cho một GIÁ TRỊ sai hình dạng ở một field có thật.
 *
 * `action` có câu riêng, vì đây là ca duy nhất mà hình dạng đúng KHÔNG suy ra được
 * từ thứ người gửi đang cầm: `setProps` THAY nguyên giá trị của một khoá
 * (`applyOne`: `target[key] = value`, không merge), nên gửi `{ action: { href } }`
 * để "chỉ sửa đường dẫn" sẽ xoá mất `kind` — và một Button không có `kind` là một
 * node mà `zNode` từ chối ở lần đọc `PageVersion` kế tiếp. Nói thẳng điều đó ra,
 * vì chính chú thích ở `builder/text-write.ts` đang khẳng định ngược lại.
 */
function propsShapeMessage(type: string, issue: z.ZodIssue): string {
  const where = `\`${issue.path.join('.') || 'props'}\``;

  if (issue.path[0] === 'action') {
    return (
      `${where}: ${issue.message}. setProps THAY nguyên giá trị của một khoá, không ` +
      'merge — nên `action` phải gửi ĐỦ object, kèm `kind` (link | anchor | submit | ' +
      'none). Gửi thiếu thì Button mất `kind` và PageVersion không đọc lại được.'
    );
  }

  return `${where}: ${issue.message}. Đọc hình dạng của node ${type} bằng get_node_schema.`;
}

/**
 * Câu lỗi cho một `overrides` sai hình dạng.
 *
 * Ca gần như duy nhất gặp phải là một khoá STYLE, và người gặp nó đang tin rằng
 * override là chỗ đặt style. Nên câu lỗi phải nói cả hai vế: overrides nhận gì,
 * và style thì đặt Ở ĐÂU — không có vế sau thì họ đoán tiếp `css`, `className`.
 */
function overridesMessage(issue: z.ZodIssue): string {
  const where = issue.path.length > 1 ? `\`overrides.${issue.path.slice(1).join('.')}\`` : '`overrides`';
  const bad =
    issue.code === 'unrecognized_keys'
      ? ((issue as z.ZodIssue & { keys?: string[] }).keys ?? []).map((k) => `\`${k}\``).join(', ')
      : '';

  return (
    `${where}${bad ? ` — khoá lạ: ${bad}` : `: ${issue.message}`}. ` +
    '`overrides` CHỈ nhận nội dung: content, label, alt, assetId, posterAssetId, ' +
    'href, a11yLabel. Không nhận style, không nhận cấu trúc. ' +
    'Style của một node bên trong instance đặt bằng `setStyle` TRÊN NODE ĐÓ trong ' +
    'cây component (apply_component_ops); cần hai instance khác style thì tách một ' +
    'tham số của component, đừng override từ trang.'
  );
}

/**
 * Tên tham số lạ trong `params` của một `Composite` → câu lỗi, `null` nếu sạch.
 *
 * `Carousel` khai `.passthrough()` CÓ CHỦ ĐÍCH — xem chú thích trong
 * `COMPOSITE_PARAMS`: nó là placeholder chưa có runtime. Composite của gói dự án có
 * thể khai passthrough vì lý do riêng (ví dụ khoá slot là định nghĩa của nó). Siết
 * chúng ở đây là từ chối đúng những node đang nằm trong doc.
 */
function compositeParamsIssue(key: string, raw: unknown): string | null {
  const schema = compositeParamsSchema(key);
  if (!schema) return null;

  // `.catch(...)` bọc ngoài object — gỡ một lớp để đọc được `shape`.
  const inner = (schema._def as { innerType?: z.ZodTypeAny }).innerType;
  if (!(inner instanceof z.ZodObject)) return null;
  if (inner._def.unknownKeys === 'passthrough') return null;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `\`params\` của ${key} phải là một object.`;
  }

  const allowed = Object.keys(inner.shape);
  const bad = Object.keys(raw as Record<string, unknown>).filter((k) => !allowed.includes(k));
  if (!bad.length) return null;

  return (
    `Composite ${key} không có tham số ${bad.map((k) => `\`${k}\``).join(', ')} — ` +
    'nó được lưu rồi bị gỡ sạch lúc render, nên trang không đổi gì và không có lỗi nào. ' +
    (allowed.length
      ? `Tham số của ${key}: ${allowed.map((k) => `\`${k}\``).join(', ')}.`
      : `${key} KHÔNG có tham số nào — nội dung của nó đi qua slot, không qua params.`)
  );
}

/** Issue tầng cú pháp, kèm gợi ý khoá style khi có. */
function syntaxIssues(error: z.ZodError): ValidationIssue[] {
  return zodIssuesRaw(error).map(({ index, issue }) => ({
    index,
    code: `zod.${issue.code}`,
    message: `${issue.path.join('.') || 'ops'}: ${issue.message}${styleKeyHint(issue)}`,
  }));
}

export async function validateOps(
  doc: Doc,
  input: unknown,
  actor: Actor = 'human',
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, issues: [{ index: -1, code: 'empty', message: 'Không có op nào.' }] };
  }
  // Trần 80 op: một batch không được phép viết lại cả trang. Con số này cũng là
  // hàng rào chống một tool call của AI đi quá xa trong một lượt. Kiểm trước Zod
  // để một batch 5000 op không phải đi qua toàn bộ schema mới bị từ chối.
  if (input.length > 80) {
    return {
      ok: false,
      issues: [{ index: -1, code: 'too-many', message: `Tối đa 80 op, nhận ${input.length}.` }],
    };
  }

  /* ── Tầng 1: cú pháp ──────────────────────────────────────────────── */
  //
  // Trước đây tầng này chỉ tồn tại trên giấy: route ép kiểu `as Op[]` và kiểu
  // TypeScript biến mất lúc chạy. Với op do inspector sinh thì tạm không sao, vì
  // chính code của ta tạo ra chúng — nhưng op do AI sinh là dữ liệu không kiểm
  // soát được, và ba tầng còn lại đều GIẢ ĐỊNH hình dạng đã đúng.
  const parsed = zOps.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: syntaxIssues(parsed.error) };
  }
  const ops = parsed.data as Op[];

  /*
   * Preset → effect thật, NGAY SAU tầng cú pháp và trước mọi tầng khác.
   *
   * Từ đây trở xuống không có dòng nào biết preset tồn tại: `isKnownEffect`,
   * phép kiểm trùng effect, `apply()`, `invert()` và cuối cùng là `PageVersion`
   * đều chỉ thấy một `attachEffect` bình thường. Đó là cả điểm của việc giải ở
   * đây — thêm một khái niệm ở tầng ngoài cùng, không thêm một khái niệm vào
   * doc. Xem `effect-presets.ts` về vì sao KHÔNG giải lúc render.
   *
   * Chỉ đọc bảng khi batch có một `attachEffect` mang key lạ với registry, cùng
   * lý lẽ lười biếng như `effectStates` và `fieldsByType` bên dưới: gắn effect
   * đã hiếm, gắn preset còn hiếm hơn, và `validateOps` chạy cho mọi lần kéo một
   * slider padding trong inspector.
   *
   * Hệ quả của phép gác đó, nói thẳng: một preset TRÙNG key với một effect
   * trong registry sẽ không bao giờ được giải, im lặng. `scripts/effect-preset.ts`
   * chặn việc tạo ra nó, và `list_effects` đánh dấu nếu nó đã lọt vào từ trước.
   */
  const hasUnknownAttach = ops.some(
    (o) => o.op === 'attachEffect' && !isKnownEffect(o.attachment.effect),
  );
  if (hasUnknownAttach) {
    const presets = await loadEffectPresets();
    for (const op of ops) {
      if (op.op !== 'attachEffect') continue;
      if (isKnownEffect(op.attachment.effect)) continue;
      const expanded = expandPreset(op.attachment.effect, op.attachment.params, presets);
      if (!expanded) continue;
      op.attachment = { ...op.attachment, ...expanded };
    }
  }

  const effectModules = await loadEffectModules(doc, ops);

  const tokenNames = await loadTokenNames();
  /*
   * Chỉ đọc bảng `Effect` khi batch THẬT SỰ ghi vào một state.
   *
   * Không phải tối ưu suông: `setStyle` với state là ca hiếm, còn `validateOps`
   * chạy trên MỌI op đến từ inspector — kéo slider padding không đáng một truy
   * vấn nữa. Nó cũng giữ cho các test không liên quan không phải mock thêm một
   * bảng chỉ vì file này chạm tới.
   */
  const needsEffectStates = ops.some(
    (o) => o.op === 'setStyle' && typeof o.target === 'object',
  );
  const effectStates = needsEffectStates ? await loadEffectStates() : new Map<string, string[]>();

  /*
   * Cấu trúc của mọi loại nội dung — chỉ khi batch THẬT SỰ đặt một khối lặp.
   *
   * Cùng lý lẽ với `effectStates` ngay trên: `validateOps` chạy cho mọi lần kéo
   * một slider padding, và bật lặp là thao tác hiếm. `getCollectionTypes` có
   * `unstable_cache` nên lượt đọc này gần như luôn trúng cache, nhưng "gần như"
   * không phải lý do để gọi nó ở mọi op.
   */
  const needsTypes = ops.some(
    (o) =>
      (o.op === 'setProps' && o.props.repeat != null) ||
      (o.op === 'insertNode' && (o.node as { repeat?: unknown }).repeat != null),
  );
  const fieldsByType = needsTypes ? await loadCollectionFields() : new Map<string, FieldShape[]>();

  const warnings: ValidationIssue[] = [];

  /* ── Tầng 2: ngữ nghĩa ────────────────────────────────────────────── */

  /**
   * Node do các op TRƯỚC trong cùng batch tạo ra, id → type.
   *
   * ## Vì sao tầng này không được chỉ nhìn `doc` ban đầu
   *
   * Bản trước kiểm mọi op với bản doc TRƯỚC batch, nên một batch tự tham chiếu bị từ
   * chối — kể cả batch hợp lệ hoàn hảo. Hai hệ quả thật:
   *
   *  - **Hoàn tác việc xoá một node CÓ CON là bất khả.** `invert(removeNode)` sinh một
   *    `insertNode` cho từng node trong cây con, cha trước con; op thứ hai trở đi trỏ
   *    tới cha vừa được op đầu tạo ra, và tầng này báo `missing-parent`. Xoá một Stack
   *    rồi Ctrl+Z là gặp ngay. Đã dùng để khôi phục section hero mất ngày 19/08/2026
   *    (`scripts/restore-hero.ts`) và chính nó chặn.
   *  - **Agent không dựng nổi một cấu trúc trong một lượt**: "thêm Stack rồi đặt Text
   *    vào trong" là hai op, và op thứ hai bị từ chối.
   *
   * Chỉ chấp nhận tham chiếu TIẾN — tới node do op ĐỨNG TRƯỚC tạo — nên thứ tự vẫn
   * phải đúng; tầng 3 apply thật và sẽ vẫn ném nếu sai. Node bị `removeNode` xoá giữa
   * batch KHÔNG được xử lý ở đây; tầng 3 bắt việc đó.
   */
  const created = new Map<string, NodeType>();

  /** Type của một node, kể cả node do một op ĐỨNG TRƯỚC trong batch tạo ra. */
  const typeOf = (id: string): NodeType | undefined => doc.nodes[id]?.type ?? created.get(id);

  ops.forEach((op, index) => {
    const add = (code: string, message: string) => issues.push({ index, code, message });
    const warn = (code: string, message: string) => warnings.push({ index, code, message });

    const nodeId = 'nodeId' in op ? op.nodeId : null;
    if (nodeId && !doc.nodes[nodeId] && !created.has(nodeId)) {
      // insertNode dùng parentId chứ không phải nodeId, nên không rơi vào đây.
      add('missing-node', `Node không tồn tại: ${nodeId}`);
      return;
    }

    // Vùng khoá: nội dung tuân thủ (số giấy phép, disclaimer). AI không được sửa.
    if (actor === 'ai' && nodeId && doc.nodes[nodeId]?.locked) {
      add('locked', `Node ${nodeId} bị khoá: ${doc.nodes[nodeId]!.locked!.reason}`);
      return;
    }

    switch (op.op) {
      case 'insertNode': {
        // Đăng ký TRƯỚC khi kiểm cha, để op sau nhìn thấy node này kể cả khi op này
        // có vấn đề khác — nếu không, một lỗi sinh ra một chuỗi lỗi giả theo sau.
        created.set(op.node.id, op.node.type);

        const parentType = typeOf(op.parentId);
        if (!parentType) add('missing-parent', `Cha không tồn tại: ${op.parentId}`);
        else if (isLeafType(parentType)) {
          // Ngoại lệ cây lặp hai cấp — xem `nestedRepeatIssue`.
          const issue = nestedRepeatIssue(doc, op.parentId, op.node);
          if (issue) add('leaf-parent', issue);
        }
        if (!(NODE_TYPES as readonly string[]).includes(op.node.type)) {
          add('bad-type', `Node type không hợp lệ: ${op.node.type}`);
        }
        // Ảnh không có alt là ảnh vô hình với screen reader. Cho phép alt rỗng,
        // nhưng bắt phải nói rõ đó là ảnh trang trí — để "quên" và "cố ý" là hai
        // thứ phân biệt được, cả với người lẫn với AI.
        if (
          op.node.type === 'Image' &&
          op.node.decorative !== true &&
          !op.node.alt.trim()
        ) {
          add('missing-alt', 'Image cần alt, hoặc đặt decorative: true nếu là ảnh trang trí.');
        }
        break;
      }

      /**
       * `setStyle` vào một state do effect điều khiển.
       *
       * Lớp cố định (`base`, breakpoint, `hover`/`focusVisible`/`inView`) không có
       * gì để kiểm — enum ở tầng 1 đã phủ hết. Còn `{ state: 'x' }` thì tên là tuỳ
       * ý, và một tên không effect nào ghi ra sinh ra CSS ĐÚNG mà selector không
       * bao giờ khớp: không lỗi, không cảnh báo, chỉ là một rule chết vĩnh viễn.
       * Đây là phép kiểm mà `ResponsiveStyle.states` đã HỨA từ đầu nhưng chưa từng
       * được viết.
       */
      case 'setStyle': {
        if (typeof op.target === 'string') break;
        const state = op.target.state;

        // Effect đang gắn: cái đã có trong doc, CỘNG cái được attach bởi một op
        // đứng trước trong cùng batch. Không cộng phần thứ hai thì "gắn effect rồi
        // style theo state của nó" — batch tự nhiên nhất — bị từ chối.
        const attached = new Set((doc.nodes[op.nodeId]?.effects ?? []).map((e) => e.effect));
        const inBatch = new Set<string>();
        for (const earlier of ops.slice(0, index)) {
          if (earlier.op === 'attachEffect' && earlier.nodeId === op.nodeId) {
            inBatch.add(earlier.attachment.effect);
          }
          if (earlier.op === 'detachEffect' && earlier.nodeId === op.nodeId) {
            const gone = (doc.nodes[op.nodeId]?.effects ?? [])
              .find((e) => e.id === earlier.instanceId)?.effect;
            if (gone) attached.delete(gone);
          }
        }

        const keys = [...attached, ...inBatch];
        if (!keys.length) {
          add(
            'state-no-effect',
            `Node ${op.nodeId} không gắn effect nào, nên không có state "${state}". ` +
              'State đến từ effect: gắn effect trước (attachEffect), rồi style theo ' +
              'state mà nó khai trong statesWritten.',
          );
          break;
        }

        const allowed = new Set<string>();
        const unreadable: string[] = [];
        for (const key of keys) {
          const states = effectStates.get(key);
          if (states === undefined) unreadable.push(key);
          else for (const s of states) allowed.add(s);
        }

        if (allowed.has(state)) {
          // Effect được gắn trong CÙNG batch thì tầng này chưa thấy nó trong doc,
          // nên nó đã được tin ở trên. Nói ra để người đọc kết quả biết luật.
          if (inBatch.size && !attached.size) {
            warn(
              'state-from-batch',
              `State "${state}" đến từ effect vừa gắn trong cùng batch — thứ tự op phải ` +
                'giữ nguyên (attachEffect trước setStyle).',
            );
          }
          break;
        }

        if (unreadable.length) {
          // KHÔNG chặn: bảng `Effect` chưa sync thì mọi state tuỳ chỉnh thành bất
          // khả, và đó là hỏng nặng hơn nhiều so với một rule chết.
          warn(
            'state-unverified',
            `Không đọc được statesWritten của ${unreadable.join(', ')} (bảng Effect chưa ` +
              `có hàng). Không kiểm được "${state}" — chạy \`pnpm effects:sync\` rồi thử lại.`,
          );
          break;
        }

        add(
          'unknown-state',
          `Effect trên node ${op.nodeId} không ghi state "${state}". ` +
            (allowed.size
              ? `State hợp lệ: ${[...allowed].sort().join(', ')}.`
              : `${keys.join(', ')} không ghi state nào.`),
        );
        break;
      }

      case 'moveNode': {
        const parentType = typeOf(op.newParentId);
        if (!parentType) add('missing-parent', `Cha mới không tồn tại: ${op.newParentId}`);
        else if (isLeafType(parentType)) {
          const issue = nestedRepeatIssue(doc, op.newParentId, doc.nodes[op.nodeId]);
          if (issue) add('leaf-parent', issue);
        }
        break;
      }

      case 'attachEffect': {
        if (!isKnownEffect(op.attachment.effect)) {
          // Nếu key đã đi qua một preset thì nói ra cả hai tên: người gõ
          // "dai-logo-chay" mà nhận câu "không có slider" sẽ đi tìm nhầm chỗ.
          const via = op.attachment.fromPreset;
          add(
            'unknown-effect',
            via
              ? `Preset "${via}" trỏ tới effect "${op.attachment.effect}" không có trong ` +
                  'registry. Preset là dữ liệu, effect là code — sửa hàng preset hoặc ' +
                  'thêm effect rồi deploy.'
              : `Effect không có trong registry: ${op.attachment.effect}. ` +
                  'Đọc list_effects — nó liệt kê cả effect lẫn preset.',
          );
        }
        // Xung đột: hai effect tranh nhau cùng một transform sẽ triệt tiêu nhau.
        const existing = doc.nodes[op.nodeId]?.effects ?? [];
        if (existing.some((e) => e.effect === op.attachment.effect)) {
          add('duplicate-effect', `Node đã có effect ${op.attachment.effect}.`);
        }

        const mod = effectModules.get(op.attachment.effect);
        if (mod) {
          const paramIssue = effectParamsIssue(mod, op.attachment.params);
          if (paramIssue) add('effect-params', paramIssue);

          const type = typeOf(op.nodeId);
          if (mod.appliesTo?.length && type && !mod.appliesTo.includes(type)) {
            add(
              'effect-applies-to',
              `Effect "${mod.key}" chỉ gắn được vào ${mod.appliesTo.join(', ')}, node ${op.nodeId} là ${type}.`,
            );
          }

          const others = effectsOnNodeBefore(doc, ops, index, op.nodeId).filter((k) => k !== mod.key);
          const clash = others.filter(
            (k) => mod.conflicts?.includes(k) || effectModules.get(k)?.conflicts?.includes(mod.key),
          );
          if (clash.length) {
            add(
              'effect-conflict',
              `Effect "${mod.key}" xung đột với ${clash.map((k) => `"${k}"`).join(', ')} đang gắn trên node ` +
                `${op.nodeId}: hai effect cùng điều khiển một thứ sẽ triệt tiêu nhau. Gỡ một bên trước.`,
            );
          }
        }
        break;
      }

      case 'updateEffect': {
        const key = effectKeyOfInstance(doc, ops, index, op.nodeId, op.instanceId);
        const mod = key ? effectModules.get(key) : undefined;
        if (mod) {
          const paramIssue = effectParamsIssue(mod, op.params);
          if (paramIssue) add('effect-params', paramIssue);
        }
        break;
      }

      case 'setCustomCss': {
        if (op.css && op.css.includes('<')) {
          add('css-escape', "customCss chứa '<' — có thể thoát khỏi thẻ style.");
        }
        if (actor === 'ai' && op.css) {
          const bad = [...new Set(cssPropertiesIn(op.css).filter((p) => !AI_CSS_ALLOWLIST.has(p)))];
          if (bad.length) {
            /*
             * Câu từ chối phải chỉ ĐƯỜNG, không chỉ nói "không được".
             *
             * Bản trước nói "dùng thuộc tính có kiểu (setStyle)" và để người đọc
             * tự đi tìm khoá nào. Với `color` thì khoá đó là `typography.color`,
             * và một agent chỉ có MCP không có cách nào suy ra được — nó sẽ đoán,
             * và `fill.color`/`text.color` đều bị từ chối là unrecognized key.
             */
            const hint = bad
              .map((p) => {
                const paths = CSS_ESCAPE_HINT[p]
                  ? [CSS_ESCAPE_HINT[p]!]
                  : stylePathsForProperty(p);
                return paths.length ? `${p} → setStyle ${paths.join(' | ')}` : null;
              })
              .filter(Boolean);

            add(
              'css-not-allowed',
              `AI không được dùng property: ${bad.join(', ')}. ` +
                (hint.length
                  ? `Đường có kiểu: ${hint.join('; ')}.`
                  : 'Dùng thuộc tính có kiểu (setStyle) thay vì CSS thô.'),
            );
          }

          /*
           * Sanitize CHỈ để lấy cảnh báo — output vẫn sinh lúc render.
           *
           * Chạy hai lần là cố ý: `compileDoc` là nguồn sự thật cho CSS thật (siết
           * luật về sau vẫn bảo vệ được dữ liệu cũ — xem `render/css.ts`), còn lần
           * này là lần DUY NHẤT có người để nói với. Trước đây `@keyframes`,
           * `!important` và `position: fixed` bị đổi hoặc gỡ mà không ai biết:
           * cảnh báo đã tồn tại trong `sanitizeCustomCss` từ đầu, chỉ chưa từng
           * được đọc.
           */
          const { warnings: cssWarnings } = sanitizeCustomCss(op.css, op.nodeId);
          for (const w of cssWarnings) warn('css-sanitized', w);
        }
        break;
      }

      /**
       * `setProps` đối chiếu HỢP ĐỒNG của node type — xem `zPropsFor`.
       *
       * Ba lỗi im lặng cùng một gốc, và gốc là bất đối xứng giữa hai đường ghi:
       * `insertNode` đi qua `zNode` (`.strict()` ở mọi tầng), `setProps` khai
       * `props: z.record(z.string(), z.unknown())` rồi `applyOne` ghi thẳng.
       *
       * 1. **Khoá lạ.** `params` trên một `Instance` được lưu, được publish, rồi
       *    không renderer nào đọc. Người dựng pilot suýt dựng cả một cơ chế tham
       *    số không tồn tại.
       * 2. **`overrides` mang khoá style.** `.strict()` trong `zNode` chặn được ca
       *    này qua `insertNode`, nhưng qua `setProps` thì không có gì chặn.
       * 3. **Giá trị sai hình dạng** cho một field có thật.
       *
       * `params` của `Composite` được kiểm riêng SAU switch (nó phải phủ cả
       * `insertNode`): `zNode` khai `params: z.unknown()`, nên hợp đồng thật nằm
       * ở `COMPOSITE_PARAMS`.
       */
      case 'setProps': {
        const type = typeOf(op.nodeId);
        if (!type) break;

        const contract = zPropsFor(type);
        if (contract) {
          const res = contract.safeParse(op.props);
          if (!res.success) {
            for (const issue of res.error.issues) {
              if (issue.code === 'unrecognized_keys' && issue.path.length === 0) {
                const bad = (issue as z.ZodIssue & { keys?: string[] }).keys ?? [];
                add('props_unknown_key', unknownPropsMessage(type, bad));
                continue;
              }
              if (issue.path[0] === 'overrides') {
                add('overrides_shape', overridesMessage(issue));
                continue;
              }
              add('props_shape', propsShapeMessage(type, issue));
            }
          }
        }

        break;
      }

      case 'setLocked': {
        if (actor === 'ai') add('locked', 'AI không được đổi trạng thái khoá.');
        break;
      }
    }

    /**
     * Luật cho `repeat`. Bảy ca, và cả bảy đều hỏng IM LẶNG nếu lọt qua.
     *
     * 1. **Hình dạng.** `insertNode` đã đi qua `zNode` (có `repeat: zRepeatSpec`) ở
     *    tầng 1, nhưng `setProps` khai `props: z.record(z.string(), z.unknown())` —
     *    tức đường mà UI và MCP thực sự dùng để bật lặp KHÔNG có tầng nào kiểm hình
     *    dạng, và `applyOne` sẽ ghi thẳng object đó vào doc. Một `limit` là chuỗi
     *    hay một `source.kind` viết sai chỉ lộ ra ở renderer, dưới dạng khu trống.
     * 2. **Effect trên Instance lặp.** `EffectRuntime` gắn bằng
     *    `document.querySelector('[data-n=…]')` — đúng MỘT phần tử. Mười thẻ thì chín
     *    thẻ không có hiệu ứng, và không có lỗi nào. Effect phải nằm ở node cha
     *    (Grid/Stack) hoặc trong cây component.
     * 3. **`group-entries` không có tổ tiên `taxonomy`.** Nó lấy danh mục từ khối cha
     *    đang lặp; không có cha thì nó không có gì để lọc và trả danh sách rỗng.
     * 4. **Lồng quá hai cấp.** Xem `REPEAT_MAX_DEPTH`.
     * 5. **`blockComponents` ngoài `source.kind === 'field'`.** Ở nguồn khác nó bị bỏ
     *    qua lúc render — một cấu hình đã đặt mà không có tác dụng.
     * 6. **Khoá `map` không có thật.** Một khoá không nằm trong `FieldDef[]` của loại
     *    và cũng không nằm trong `VIRTUAL_KEYS` sẽ được lưu, được publish, rồi không
     *    bao giờ hiện ra. Xem `mapKeyIssue` — ca này đã ở trên site thật.
     * 7. **Khoá field trong điều kiện LỌC không có thật.** Nặng hơn ca 6: khối trả
     *    về danh sách rỗng, tức trang trông như "chưa có bài nào" chứ không như một
     *    cấu hình sai. Xem chú thích tại chỗ.
     *
     * Tổ tiên đọc từ `doc.nodes`, tức cây TRƯỚC batch. Một batch vừa tạo tổ tiên MỚI
     * vừa gắn `repeat` cho con của nó trong CÙNG batch không được ba luật cây thấy
     * (`created` chỉ giữ type, không giữ `parentId`/`repeat`) — đúng giới hạn "chỉ
     * tham chiếu tiến" mà tầng này đã chấp nhận cho các luật khác trong file.
     */
    /*
     * `Grid.columns` là một field CHẾT.
     *
     * `lib/render/css.ts` chỉ đọc `style.layout.gridTemplateColumns`; không chỗ nào
     * đọc `columns`. Nhưng field vẫn có trong `zNode`, `get_node` vẫn trả nó ra, và
     * nó tên hay hơn — nên cả người lẫn AI đều đặt nó rồi ngồi nhìn một lưới một
     * cột mà không hiểu vì sao. Đo được: `/ve-chung-toi` có `gt-prod-grid` mang CẢ
     * HAI, và chỉ nửa `style` có tác dụng.
     *
     * Vì sao KHÔNG xoá khỏi schema: `zNode` là `.strict()`, nên gỡ field sẽ làm mọi
     * `PageVersion` đang mang nó không parse nổi — tức là làm vỡ đúng những release
     * cũ mà bất biến #3 hứa là lùi về được. Chặn ở đường GHI thì doc cũ vẫn đọc
     * được, còn doc mới không sinh thêm field chết.
     *
     * `null` được cho qua: đó là thao tác DỌN (`applyOne` xoá field khi giá trị
     * `null`), và chặn nó nghĩa là không ai gỡ được field khỏi node cũ.
     */
    /*
     * `CustomCode` mode `inline` không được mang `js`.
     *
     * `inline` nghĩa là HTML và JS vào thẳng realm của trang — cùng realm với
     * form, với cookie, với mọi node khác. Renderer cố ý KHÔNG hiện thực nó, và
     * repo không có thư viện sanitize HTML nào.
     *
     * Chặn ở đường GHI chứ không chỉ ở renderer, vì hai lý do khác nhau: người
     * viết được nhận lỗi ngay lúc lưu thay vì thấy một khối trắng và không hiểu
     * vì sao; và ngày nào `inline` được hiện thực, những `js` đã nằm sẵn trong
     * database sẽ KHÔNG bỗng nhiên sống lại cùng lúc.
     *
     * `iframe` thì cho — đó là toàn bộ điểm của tính năng.
     */
    const customCodeOp =
      op.op === 'setProps'
        ? { targetId: op.nodeId, raw: op.props as Record<string, unknown> }
        : op.op === 'insertNode'
          ? { targetId: op.node.id, raw: op.node as unknown as Record<string, unknown> }
          : null;

    if (customCodeOp) {
      const { raw } = customCodeOp;
      const mode = raw.mode;
      const js = raw.js;
      // Chỉ xét khi op NÓI về mode: một `setProps` chỉ đổi `js` trên node đang là
      // iframe thì `mode` vắng mặt, và chặn nó là chặn sai.
      if (typeof js === 'string' && js.trim() && mode !== undefined && mode !== 'iframe') {
        add(
          'customcode_inline_js',
          'CustomCode mode "inline" không chạy JS — nó nằm cùng realm với trang. ' +
            'Đặt mode: "iframe" để JS chạy trong sandbox riêng.',
        );
      }
    }

    /*
     * `params` của một `Composite` phải là tham số CÓ THẬT của composite đó.
     *
     * `zNode` khai `params: z.unknown()` vì mỗi composite một hình dạng, nên hợp
     * đồng thật nằm ở `COMPOSITE_PARAMS`. Docblock của registry ghi từ đầu rằng
     * "validator của op" đọc nó để chặn params sai trước khi ghi — nó chưa từng
     * đọc. Hệ quả: một bảng `params` BỊA RA đi qua `ok: true`, rồi `.catch()` ở
     * tầng render gỡ sạch khoá lạ. Không lỗi, không cảnh báo, section trông y như
     * trước, và người dựng tin rằng mình vừa cấu hình được một thứ.
     *
     * Chỉ kiểm TÊN tham số, không kiểm giá trị: `.catch()` là cố ý (một hàng JSONB
     * hỏng không được làm cả trang trắng — xem registry), nên `safeParse` ở đây
     * không bao giờ thất bại và không nói được gì.
     */
    const compositeOp =
      op.op === 'setProps'
        ? {
            key: (doc.nodes[op.nodeId] as { composite?: string } | undefined)?.composite,
            raw: (op.props as { params?: unknown }).params,
          }
        : op.op === 'insertNode' && op.node.type === 'Composite'
          ? { key: op.node.composite, raw: (op.node as { params?: unknown }).params }
          : null;

    // Tên composite phải có thật — lõi hoặc gói dự án đang chạy. Schema chỉ kiểm dạng
    // PascalCase (gói mang composite riêng), nên đây là chỗ chặn tên bịa.
    if (op.op === 'insertNode' && op.node.type === 'Composite' && !isKnownComposite(op.node.composite)) {
      add('composite_params', `Không có composite "${op.node.composite}" — xem danh mục composite trong get_node_schema.`);
    }

    if (compositeOp && compositeOp.key && compositeOp.raw != null) {
      const issue = compositeParamsIssue(compositeOp.key, compositeOp.raw);
      if (issue) add('composite_params', issue);
    }

    const gridColumnsOp =
      op.op === 'setProps'
        ? { targetId: op.nodeId, raw: (op.props as { columns?: unknown }).columns }
        : op.op === 'insertNode'
          ? { targetId: op.node.id, raw: (op.node as { columns?: unknown }).columns }
          : null;

    if (gridColumnsOp && gridColumnsOp.raw != null) {
      add(
        'grid_columns_legacy',
        `Field \`columns\` không được renderer đọc — lưới sẽ giữ nguyên một cột. ` +
          'Chia cột bằng `setStyle` với `layout.gridTemplateColumns`, ' +
          'ví dụ [{ "kind": "fr", "v": 1 }, { "kind": "fr", "v": 1 }].',
      );
    }

    /*
     * `parentId` đi kèm vì hai op tìm cha theo hai cách: `setProps` gắn lên một
     * node ĐÃ có trong doc, `insertNode` gắn lên một node chưa có. Xem
     * `nearestRepeatSource`.
     */
    const repeatOp =
      op.op === 'setProps'
        ? {
            targetId: op.nodeId,
            parentId: doc.nodes[op.nodeId]?.parentId ?? null,
            raw: op.props.repeat,
          }
        : op.op === 'insertNode'
          ? {
              targetId: op.node.id,
              parentId: op.parentId,
              raw: (op.node as { repeat?: unknown }).repeat,
            }
          : null;

    // `null`/vắng mặt = tắt lặp (`applyOne` xoá field khi giá trị là `null`).
    // Không có gì để kiểm, và kiểm sẽ chặn đúng thao tác tắt.
    if (repeatOp && repeatOp.raw != null) {
      const shape = zRepeatSpec.safeParse(repeatOp.raw);
      if (!shape.success) {
        add(
          'repeat_shape',
          `Cấu hình lặp không hợp lệ: ${shape.error.issues[0]?.message ?? 'sai hình dạng'}`,
        );
      } else {
        const spec = shape.data as RepeatSpec;
        const targetId = repeatOp.targetId;

        if ((doc.nodes[targetId]?.effects ?? []).length > 0) {
          add(
            'repeat_effect',
            'Instance lặp theo dữ liệu không được gắn effect: runtime gắn effect vào đúng ' +
              'một phần tử, nên chỉ item đầu tiên có hiệu ứng. Đặt effect lên node cha hoặc ' +
              'trong cây component.',
          );
        }
        const parentId = repeatOp.parentId;

        if (spec.source.kind === 'group-entries' && nearestRepeatKind(doc, parentId) !== 'taxonomy') {
          add(
            'repeat_group_parent',
            'Nguồn "bài trong danh mục của khối cha" cần một khối cha đang lặp theo danh mục.',
          );
        }
        if (ancestorRepeatDepth(doc, parentId) >= REPEAT_MAX_DEPTH) {
          add('repeat_depth', `Lặp lồng nhau tối đa ${REPEAT_MAX_DEPTH} cấp.`);
        }
        if (spec.blockComponents && spec.source.kind !== 'field') {
          add(
            'repeat_block_components',
            'blockComponents chỉ dùng được khi nguồn là một field khối của bài đang mở.',
          );
        }

        /*
         * 6. **Khoá `map` không bao giờ resolve được.** Xem `mapKeyIssue`.
         *
         * Nguồn `field` được bỏ qua: item của nó là phần tử của một mảng JSONB bất
         * kỳ, không có `FieldDef[]` nào mô tả nó.
         *
         * Loại KHÔNG có field nào cũng được bỏ qua, và đó là một nhượng bộ có chủ
         * đích: `getCollectionTypes` trả mảng rỗng cho một loại có `schema` hỏng
         * (xem docblock ở đó), nên chặn theo nó nghĩa là một hàng hỏng trong bảng
         * `CollectionType` khoá cứng mọi thao tác lặp trên toàn site.
         */
        const mapKeys = Object.keys(spec.map);
        if (mapKeys.length && spec.source.kind === 'taxonomy') {
          for (const key of mapKeys) {
            if (TAXONOMY_ITEM_KEYS.includes(key)) continue;
            add(
              'repeat_map_key',
              `Khối lặp theo danh mục chỉ đọc được ${TAXONOMY_ITEM_KEYS.map((k) => `\`${k}\``).join(', ')} ` +
                `— \`${key}\` sẽ không bao giờ hiện ra.`,
            );
          }
        } else if (mapKeys.length && spec.source.kind !== 'field') {
          const typeKey = repeatTypeKey(doc, parentId, spec.source);
          const fields = typeKey ? fieldsByType.get(typeKey) : undefined;
          if (typeKey && fields?.length) {
            for (const key of mapKeys) {
              const issue = mapKeyIssue(key, fields, typeKey);
              if (issue) add('repeat_map_key', issue);
            }
          }
        }

        /*
         * 7. **Khoá field trong ĐIỀU KIỆN LỌC không có thật.**
         *
         * Cùng gốc với luật `map` ngay trên, nhưng hỏng nặng hơn một bậc. Một khoá
         * `map` sai cho ra thẻ mang chữ mẫu của component — xấu, mà nhìn là biết.
         * Một khoá `filter.field` sai thì `filterToWhere` sinh
         * `data: { path: ['<khoá>'] }`, không hàng nào khớp, và khối trả về danh
         * sách RỖNG dưới một tiêu đề hàng vẫn còn nguyên. Trang trông như "chưa có
         * bài nào" chứ không như một cấu hình sai.
         *
         * Đã trả giá thật: loại `tin-tuc` từng có field `taxonomy`, nó bị xoá và
         * thay bằng `relation` tên `category`, còn ba trang đang publish vẫn khai
         * theo mô hình cũ. Ở `/blogs` ba hàng danh mục trả `matched: 0` im lặng, và
         * khối lặp rò cả thẻ mẫu chưa bind ra trang công khai.
         *
         * KHÔNG có nhượng bộ `VIRTUAL_KEYS` như luật `map`: `filterToWhere` chỉ đọc
         * trong JSONB `data`, nên `slug`, `published_at`, `taxonomy` — vốn là cột và
         * bảng nối — cũng không bao giờ khớp. Lọc theo danh mục có điều kiện riêng
         * (`k: 'taxonomy'`), và điều kiện đó KHÔNG đi qua đây: `k` là discriminant
         * của `zCollectionFilter`, không phải tên field.
         *
         * Cùng hai nhượng bộ với luật `map`: loại không đọc được, hoặc loại không
         * có field nào (schema hỏng), thì bỏ qua.
         */
        if (spec.source.kind === 'query') {
          const qType = spec.source.query.typeKey;
          const qFields = fieldsByType.get(qType);
          if (qFields?.length) {
            const have = () => qFields.map((x) => `\`${x.key}\``).join(', ');
            for (const f of spec.source.query.filter ?? []) {
              if (f.k === 'field') {
                if (qFields.some((x) => x.key === f.field)) continue;
                add(
                  'repeat_filter_field',
                  `Loại \`${qType}\` không có field \`${f.field}\` — điều kiện lọc đọc ` +
                    `\`data.${f.field}\`, nên không bài nào khớp và khối lặp trả về danh sách ` +
                    `RỖNG mà không báo gì. Field đang có: ${have()}. ` +
                    'Lọc theo danh mục thì dùng điều kiện `{ "k": "taxonomy" }` chứ không phải ' +
                    'một field.',
                );
                continue;
              }

              /*
               * `k: 'relation'` cần HAI phép kiểm, không phải một.
               *
               * Có thật thì chưa đủ: điều kiện này so `data.<field>` với một ID bản
               * ghi, nên trỏ nó vào một field `text` cho ra một `where` không hàng
               * nào khớp — lại đúng hình dạng "danh sách RỖNG dưới tiêu đề còn
               * nguyên" mà luật ngay trên tồn tại để chặn. Sai KIỂU im lặng y hệt
               * sai TÊN, nên nó bị chặn ở cùng một chỗ và mang cùng một mã lỗi.
               */
              if (f.k === 'relation') {
                const def = qFields.find((x) => x.key === f.field);
                if (def?.t === 'relation') continue;
                add(
                  'repeat_filter_field',
                  def
                    ? `Field \`${f.field}\` của loại \`${qType}\` là \`${def.t}\`, không phải ` +
                        '`relation` — điều kiện `{ "k": "relation" }` so nó với ID của một bản ' +
                        'ghi, nên không bài nào khớp và khối lặp trả về danh sách RỖNG mà ' +
                        `không báo gì. Field relation đang có: ${
                          qFields.filter((x) => x.t === 'relation').map((x) => `\`${x.key}\``).join(', ') ||
                          '(không có field relation nào)'
                        }.`
                    : `Loại \`${qType}\` không có field \`${f.field}\` — điều kiện lọc đọc ` +
                        `\`data.${f.field}\`, nên không bài nào khớp và khối lặp trả về danh ` +
                        `sách RỖNG mà không báo gì. Field đang có: ${have()}.`,
                );
              }
            }
          }
        }
      }
    }

    // Token phải có thật. Token sai tên KHÔNG làm CSS hỏng — `var(--khong-co)`
    // là cú pháp hợp lệ, nó chỉ âm thầm không có giá trị. Đây là chỗ chặn.
    for (const token of collectTokens(op)) {
      if (!tokenNames.has(token)) {
        add('unknown-token', `Token không tồn tại hoặc đã deprecated: --${token}`);
      }
    }
  });

  if (issues.length) return { ok: false, issues, ...(warnings.length ? { warnings } : {}) };

  /* ── Tầng 3: dry-run ──────────────────────────────────────────────── */
  let next: Doc;
  try {
    next = apply(doc, ops);
  } catch (error) {
    const message = error instanceof OpError ? error.message : String(error);
    return { ok: false, issues: [{ index: -1, code: 'apply-failed', message }] };
  }

  /* ── Tầng 4: bất biến ─────────────────────────────────────────────── */
  // Bộ luật nằm ở `./structure` (thuần) để nhập trang dùng chung — xem docblock ở đó.
  const structural: ValidationIssue[] = structuralIssues(next).map((i) => ({ index: -1, ...i }));

  if (structural.length) return { ok: false, issues: structural.slice(0, 10) };

  return { ok: true, issues: [], doc: next, ops, ...(warnings.length ? { warnings } : {}) };
}

/* ── Effect: params, appliesTo, conflicts ─────────────────────────────── */

/**
 * Module của mọi effect mà batch chạm tới — chỉ khi batch THẬT SỰ gắn hay sửa effect.
 *
 * ## Vì sao kiểm ở đây (08/10/2026)
 *
 * Comment của model `Effect` trong schema.prisma hứa "Validate server-side, không tin
 * output model" từ ngày đầu, nhưng tầng này chỉ kiểm key có trong registry. Params sai
 * vẫn vào DB, rồi `EffectRuntime` bỏ effect đó trên trình duyệt — người dùng thấy
 * "effect không chạy" mà không có lỗi nào để lần. `appliesTo` và `conflicts` thì được
 * đưa cho AI đọc (`list_effects`) nhưng chưa từng được thực thi.
 *
 * Nguồn sự thật là manifest zod trong CODE (`src/lib/motion/effects/*.ts`), đúng thứ
 * `EffectRuntime` dùng lúc chạy — không phải bảng `Effect`, vốn chỉ là bản sync cho AI
 * đọc. Module import được ở Node vì mọi truy cập DOM nằm trong `init()`
 * (`scripts/sync-effects.ts` dựa vào đúng điều đó).
 *
 * Lười như `effectStates`: `validateOps` chạy cho mọi lần kéo một slider padding.
 * Nạp cả module của effect ĐANG gắn trên node đích, để kiểm xung đột cả hai chiều.
 */
async function loadEffectModules(doc: Doc, ops: Op[]): Promise<Map<string, AnyEffectModule>> {
  const keys = new Set<string>();
  ops.forEach((op, index) => {
    if (op.op === 'attachEffect') {
      if (isKnownEffect(op.attachment.effect)) keys.add(op.attachment.effect);
      for (const k of effectsOnNodeBefore(doc, ops, index, op.nodeId)) keys.add(k);
    } else if (op.op === 'updateEffect') {
      const key = effectKeyOfInstance(doc, ops, index, op.nodeId, op.instanceId);
      if (key) keys.add(key);
    }
  });
  const out = new Map<string, AnyEffectModule>();
  await Promise.all(
    [...keys].map(async (key) => {
      const mod = await loadEffect(key);
      if (mod) out.set(key, mod);
    }),
  );
  return out;
}

/** Key của các effect trên node TRƯỚC op thứ `index`: trong doc, cộng/trừ op đứng trước. */
function effectsOnNodeBefore(doc: Doc, ops: Op[], index: number, nodeId: string): string[] {
  const live = new Map((doc.nodes[nodeId]?.effects ?? []).map((e) => [e.id, e.effect]));
  for (const earlier of ops.slice(0, index)) {
    if (earlier.op === 'attachEffect' && earlier.nodeId === nodeId) {
      live.set(earlier.attachment.id, earlier.attachment.effect);
    } else if (earlier.op === 'detachEffect' && earlier.nodeId === nodeId) {
      live.delete(earlier.instanceId);
    }
  }
  return [...new Set(live.values())];
}

/** Effect key của một instance — có thể vừa được gắn ở một op đứng trước trong batch. */
function effectKeyOfInstance(
  doc: Doc,
  ops: Op[],
  index: number,
  nodeId: string,
  instanceId: string,
): string | undefined {
  for (const earlier of ops.slice(0, index).reverse()) {
    if (earlier.op === 'attachEffect' && earlier.nodeId === nodeId && earlier.attachment.id === instanceId) {
      return earlier.attachment.effect;
    }
  }
  return doc.nodes[nodeId]?.effects.find((e) => e.id === instanceId)?.effect;
}

/** Câu lỗi khi params không qua schema của effect, hoặc `null`. */
function effectParamsIssue(mod: AnyEffectModule, params: unknown): string | null {
  const parsed = mod.paramsSchema.safeParse(params ?? {});
  if (parsed.success) return null;
  const detail = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.join('.') : '(gốc)'}: ${i.message}`)
    .join('; ');
  return (
    `Params không hợp lệ cho effect "${mod.key}" — ${detail}. ` +
    'Đọc list_effects để xem params, kiểu và giới hạn của từng effect.'
  );
}
