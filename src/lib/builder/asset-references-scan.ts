/**
 * Ai đang dùng một ảnh — phần THUẦN của phép kiểm trước khi xoá ảnh.
 *
 * ## Vì sao không dùng lại `asset-usage.ts`
 *
 * `listAssetsWithUsage` trả lời câu của MÀN QUẢN LÝ: "ảnh này đang ở trang nào" — và
 * nó chỉ đọc bản nháp của trang chưa lưu trữ. Đủ cho một con số kiểm kê, không đủ cho
 * một nút XOÁ: ảnh bìa blog (entry), favicon, ảnh đại diện, ảnh nằm trong component
 * chưa ai cắm, ảnh của trang đã lưu trữ, ảnh còn trên site đang chạy nhưng đã rời bản
 * nháp — tất cả đều là "không ai dùng" theo màn đó. Xoá theo con số ấy là xoá ảnh
 * đang hiện trên site thật.
 *
 * ## Vì sao tách thuần / chạm DB
 *
 * Cùng khuôn với `asset-refs.ts` ↔ `asset-usage.ts`: phần đáng sai là phép DUYỆT,
 * và nó test được không cần Postgres. File này nhận dữ liệu thô đã nạp sẵn và trả về
 * kết quả; `asset-references.ts` chỉ làm việc nạp.
 *
 * ## Ba lớp quét, và vì sao cần cả ba
 *
 *  1. **Có cấu trúc** — `assetUsesInDoc`, `collectAssetIds`, `EFFECT_ASSET_PARAMS`.
 *     Lớp DUY NHẤT thấy được ảnh không nằm trong JSON đang quét: ảnh mặc định của
 *     component mà một instance trỏ tới. Thiếu nó, trang chỉ cắm instance là "không
 *     dùng ảnh nào".
 *  2. **Quét mù theo id** — mọi chuỗi bằng ĐÚNG một id đang kiểm. Lưới an toàn cho
 *     chỗ lớp 1 chưa biết (field mới, override mồ côi, doc hỏng không migrate được).
 *     Docblock của `EFFECT_ASSET_PARAMS` cấm quét mù, nhưng lý do ở đó là so với MỌI
 *     chuỗi tình cờ trùng một id bất kỳ; ở đây chỉ so với id của đúng lô đang kiểm, và
 *     id asset là cuid 25 ký tự ngẫu nhiên — không có chuỗi nào tình cờ bằng nó.
 *  3. **Quét theo `key`** — field `html` của CKEditor lưu URL chứ không lưu id (xem
 *     `ArticleEditor.tsx`), `customCss` viết `url(...)`, token và `globals` là chuỗi tự
 *     do. URL = `S3_PUBLIC_BASE_URL/key`, và key mang hash nội dung (`nextAssetKey`)
 *     nên không trùng nhầm.
 *
 * Sai theo hướng thừa là chặn nhầm một lần xoá — người dùng thấy lý do và gỡ được.
 * Sai theo hướng thiếu là xoá vĩnh viễn ảnh đang hiện trên site. Hai hướng không cùng
 * hạng, nên mỗi lớp ở đây đều nghiêng về phía thừa.
 *
 * ## Chặn hay chỉ cảnh báo
 *
 * CHẶN là mọi thứ hiện ra mà không cần ai bấm gì: bản nháp (kể cả trang lưu trữ —
 * khôi phục là nó quay lại), entry (bảng live, "bấm Đăng là lên site"), component,
 * effect preset, cấu hình site, token, ảnh đại diện, và release ĐANG CHẠY. Release
 * đang chạy là release mà `Site.activeReleaseId` trỏ tới — không phải release mới
 * nhất: sau một lần lùi bản, release mới hơn là ĐÍCH của rollback, cùng hạng với
 * release cũ.
 *
 * CẢNH BÁO là release còn lại: chúng chỉ hiện khi có người chủ động lùi bản. Người
 * dùng đã chọn chấp nhận rủi ro đó khi xoá hẳn; việc của hàm này là kể ra chúng.
 *
 * ## Cố ý KHÔNG quét
 *
 *  - **`PresetVersion`, lịch sử `PageVersion`** (ngoài bản nháp và version mà một
 *    release trỏ tới): đó là lịch sử chỉnh sửa, không phải thứ đang hiện ở đâu.
 *    Khôi phục một bản cũ là tạo bản nháp mới — lúc đó ảnh thiếu thì người dùng thấy
 *    ngay trong builder, trước khi publish. Chặn theo lịch sử nghĩa là gần như không
 *    ảnh nào xoá được.
 *    Riêng `PresetVersion.tree`: component render theo tree HIỆN TẠI của `Preset`
 *    (đã quét), không bao giờ đọc lại tree của một version cũ.
 *  - **`CollectionType.schema`** (FieldDef): đã kiểm — chỉ field `boolean` có `default`;
 *    không field nào mang giá trị mặc định trỏ tới asset id/URL. Ảnh nằm ở `Entry.data`.
 *  - **`AssetFolder`**: bảng đường dẫn thư mục, không trỏ tới asset nào; quan hệ ảnh
 *    ↔ thư mục là cột `Asset.folder` của chính ảnh.
 *  - **`Release.assets`**: xem `releaseHits`.
 *
 * `Translation` THÌ CÓ quét, dù trông như bảng chữ: nó giữ cả ảnh theo ngôn ngữ — xem
 * `ASSET_TRANSLATION_FIELDS`.
 */

import type { AssetRef, AssetRefKind, OldReleaseRef } from '@/lib/assets/trash-types';
import type { TranslatableField } from '@/lib/builder/text-units';
import { collectAssetIds } from '@/lib/collections/public-shape';
import { migrateDoc, migratePresetTree } from '@/lib/doc/migrate';
import type { Doc, Node } from '@/lib/doc/types';
import {
  assetIdsOf,
  assetUsesInDoc,
  EFFECT_ASSET_PARAMS,
  type ComponentTreesFor,
} from './asset-refs';

/** Kết quả cho MỘT ảnh: chỗ chặn xoá, và release cũ sẽ vỡ ảnh nếu vẫn xoá. */
export interface AssetUsage {
  blocking: AssetRef[];
  oldReleases: OldReleaseRef[];
}

export type AssetReferenceMap = Map<string, AssetUsage>;

/** Ảnh đang kiểm: id và key S3 (key để quét URL trong chuỗi tự do). */
export interface ScanAsset {
  id: string;
  key: string;
}

/**
 * Trường bản dịch mang id asset.
 *
 * Bảng `Translation` giữ cả ẢNH theo ngôn ngữ (`assetId`/`posterAssetId` trong
 * `TRANSLATION_FIELDS`), không chỉ chữ — bản tiếng Anh có thể dùng một ảnh khác hẳn
 * bản gốc. Chỉ nạp hai trường này: các trường chữ không trỏ tới asset.
 */
export const ASSET_TRANSLATION_FIELDS = [
  'assetId',
  'posterAssetId',
] as const satisfies readonly TranslatableField[];

export interface PageSource {
  id: string;
  slug: string;
  title: string;
  archived: boolean;
  ogImageId: string | null;
  /** JSON-LD tự viết có thể mang URL ảnh (`"image": "https://…"`). */
  jsonLd: unknown;
  /** `PageVersion.doc` THÔ của bản nháp; `null` khi trang chưa có bản nháp. */
  draftDoc: unknown;
}

export interface DraftTranslationSource {
  pageId: string;
  locale: string;
  value: unknown;
}

export interface PresetSource {
  id: string;
  name: string;
  tree: unknown;
}

export interface EffectPresetSource {
  id: string;
  name: string;
  effectKey: string;
  params: unknown;
}

export interface EntrySource {
  id: string;
  typeKey: string;
  typeName: string;
  titleField: string;
  slug: string;
  archived: boolean;
  data: unknown;
  i18n: unknown;
}

export interface SiteSource {
  faviconAssetId: string | null;
  ogImageId: string | null;
  globals: unknown;
}

export interface UserSource {
  email: string;
  name: string | null;
  avatarAssetId: string | null;
}

export interface TokenSource {
  name: string;
  value: string;
}

export interface ReleaseSource {
  id: string;
  label: string;
  createdAt: Date | string;
  entries: { slug: string; versionId: string }[];
  /** Đã qua `componentsFromSnapshot` — file này không chạm `server-only`. */
  components: ComponentTreesFor;
  translations: unknown;
  tokens: unknown;
  globals: unknown;
}

export interface ReferenceSources {
  pages: PageSource[];
  draftTranslations: DraftTranslationSource[];
  presets: PresetSource[];
  effectPresets: EffectPresetSource[];
  entries: EntrySource[];
  sites: SiteSource[];
  users: UserSource[];
  tokens: TokenSource[];
  /** Release mà `Site.activeReleaseId` trỏ tới — thứ site thật đang phục vụ. */
  liveReleases: ReleaseSource[];
  /** Mọi release KHÁC: đích của rollback, chỉ cảnh báo. Mới nhất trước. */
  oldReleases: ReleaseSource[];
  /**
   * `PageVersion.doc` thô theo `versionId`, DÙNG CHUNG giữa các release. Phần lớn
   * trang không đổi giữa hai lần publish, nên năm mươi release thường chỉ trỏ tới vài
   * chục version — một map chung là mỗi doc được quét một lần, không năm mươi lần.
   */
  versionDocs: ReadonlyMap<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ngữ cảnh quét
// ---------------------------------------------------------------------------

export interface ScanContext {
  /** Id đang kiểm. Mọi phép quét chỉ trả id trong tập này. */
  readonly targets: ReadonlySet<string>;
  /** key gọn (chỉ ký tự URL an toàn) → id. */
  readonly byKey: ReadonlyMap<string, string>;
  /** key mang ký tự lạ (ảnh cũ nạp bằng script) → quét bằng `includes`. */
  readonly oddKeys: ReadonlyArray<readonly [string, string]>;
  readonly minKeyLen: number;
  /** Bộ đệm theo object: cùng một doc version được nhiều release trỏ tới. */
  readonly jsonCache: WeakMap<object, ReadonlySet<string>>;
  readonly docCache: WeakMap<object, Doc | null>;
}

const KEY_SHAPE = /^[A-Za-z0-9._~\-/]+$/;
const KEY_TOKEN = /[A-Za-z0-9._~\-/]+/g;

export function createScanContext(
  ids: readonly string[],
  assets: readonly ScanAsset[],
): ScanContext {
  const targets = new Set(ids);
  const byKey = new Map<string, string>();
  const oddKeys: [string, string][] = [];
  let minKeyLen = Number.POSITIVE_INFINITY;
  for (const a of assets) {
    if (!targets.has(a.id) || !a.key) continue;
    if (KEY_SHAPE.test(a.key)) byKey.set(a.key, a.id);
    else oddKeys.push([a.key, a.id]);
    minKeyLen = Math.min(minKeyLen, a.key.length);
  }
  return {
    targets,
    byKey,
    oddKeys,
    minKeyLen,
    jsonCache: new WeakMap(),
    docCache: new WeakMap(),
  };
}

/**
 * Một token có phải (hoặc kết thúc bằng) một key không.
 *
 * Thử cả token và mọi hậu tố bắt đầu ngay sau một `/`: URL
 * `https://cdn/public/builder/a-1234abcd.png` tách ra token
 * `//cdn/public/builder/a-1234abcd.png`, và key là hậu tố `public/builder/…`.
 *
 * ## Vì sao không `text.includes(key)` cho từng key
 *
 * "Dọn sạch" gửi tới hai nghìn ảnh một lượt. Hai nghìn key × mọi entry blog × mọi
 * doc là hàng chục tỉ phép so. Tách token rồi tra `Map` là tuyến tính theo độ dài
 * chữ, bất kể lô to cỡ nào. Bonus: biên `/` chặn `logo.png` khớp nhầm vào
 * `footer-logo.png`.
 */
function matchToken(tok: string, ctx: ScanContext, out: Set<string>): void {
  let start = 0;
  for (;;) {
    const id = ctx.byKey.get(start ? tok.slice(start) : tok);
    if (id) out.add(id);
    const slash = tok.indexOf('/', start);
    if (slash === -1) return;
    start = slash + 1;
  }
}

function idsInString(s: string, ctx: ScanContext, out: Set<string>): void {
  if (ctx.targets.has(s)) out.add(s);
  if (s.length < ctx.minKeyLen) return;
  if (ctx.byKey.size) {
    for (const m of s.matchAll(KEY_TOKEN)) {
      const tok = m[0];
      if (tok.length < ctx.minKeyLen) continue;
      matchToken(tok, ctx, out);
      // Dấu chấm cuối câu dính vào token: "xem https://…/a.png." vẫn là a.png.
      const trimmed = tok.replace(/\.+$/, '');
      if (trimmed !== tok) matchToken(trimmed, ctx, out);
    }
  }
  for (const [key, id] of ctx.oddKeys) if (s.includes(key)) out.add(id);
}

function walk(value: unknown, ctx: ScanContext, out: Set<string>): void {
  if (typeof value === 'string') {
    idsInString(value, ctx, out);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, ctx, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) walk(v, ctx, out);
  }
}

/**
 * Lớp 2 + 3: mọi id đang kiểm xuất hiện trong một giá trị JSON bất kỳ — bằng chính
 * id, hoặc qua key của nó trong một chuỗi (URL trong HTML, `url()` trong CSS).
 *
 * Chỉ duyệt GIÁ TRỊ, không duyệt khoá object: khoá là id node, id preset, tên token.
 *
 * Kết quả của một object được đệm theo danh tính; ĐỪNG sửa Set trả về.
 */
export function idsInJson(value: unknown, ctx: ScanContext): ReadonlySet<string> {
  if (value !== null && typeof value === 'object') {
    const hit = ctx.jsonCache.get(value);
    if (hit) return hit;
    const out = new Set<string>();
    walk(value, ctx, out);
    ctx.jsonCache.set(value, out);
    return out;
  }
  const out = new Set<string>();
  walk(value, ctx, out);
  return out;
}

function migrated(raw: unknown, ctx: ScanContext): Doc | null {
  if (raw === null || typeof raw !== 'object') return null;
  if (ctx.docCache.has(raw)) return ctx.docCache.get(raw) ?? null;
  let doc: Doc | null;
  try {
    doc = migrateDoc(raw);
  } catch {
    doc = null;
  }
  ctx.docCache.set(raw, doc);
  return doc;
}

/**
 * Id đang kiểm mà một doc trang dùng, kể cả qua component nó cắm.
 *
 * Doc hỏng (không migrate được) vẫn được quét mù chứ không bị bỏ qua như ở
 * `listAssetsWithUsage`: màn quản lý bỏ qua để khỏi trắng trang, còn ở đây bỏ qua là
 * kết luận "không ai dùng" từ một doc mình không đọc được.
 */
export function idsInDoc(
  raw: unknown,
  components: ComponentTreesFor,
  ctx: ScanContext,
): Set<string> {
  const out = new Set(idsInJson(raw, ctx));
  const doc = migrated(raw, ctx);
  if (!doc) return out;

  for (const id of assetUsesInDoc(doc, components).keys()) {
    if (ctx.targets.has(id)) out.add(id);
  }
  // `url()` trong customCss của node BÊN TRONG component — lớp 1 không đọc CSS.
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'Instance') continue;
    const tree = components.get(node.componentId);
    if (tree) for (const id of idsInJson(tree.nodes, ctx)) out.add(id);
  }
  return out;
}

/** Id đang kiểm trong một cây component (kể cả component lồng bên trong nó). */
export function idsInPresetTree(
  raw: unknown,
  tree: { nodes: Record<string, Node> } | undefined,
  components: ComponentTreesFor,
  ctx: ScanContext,
): Set<string> {
  const out = new Set(idsInJson(raw, ctx));
  if (!tree) return out;
  for (const node of Object.values(tree.nodes)) {
    for (const id of assetIdsOf(node, components)) if (ctx.targets.has(id)) out.add(id);
  }
  return out;
}

/** Id trong tham số của một effect preset — lô khung của `image-sequence`. */
export function effectPresetAssetIds(effectKey: string, params: unknown): string[] {
  const keys = EFFECT_ASSET_PARAMS[effectKey];
  if (!keys || params === null || typeof params !== 'object') return [];
  const out: string[] = [];
  for (const key of keys) {
    const value = (params as Record<string, unknown>)[key];
    if (!Array.isArray(value)) continue;
    for (const id of value) if (typeof id === 'string' && id) out.push(id);
  }
  return out;
}

/**
 * Id trong một entry: `data` lẫn `i18n`.
 *
 * `collectAssetIds` bắt mọi `{ assetId }` ở mọi độ sâu — field `image`, khối
 * `figure` của `richdoc`, nhóm lặp. Field `html` thì không có `assetId` nào: CKEditor
 * lưu `<img src="URL">`, nên chỉ lớp quét key thấy nó.
 */
export function idsInEntry(entry: Pick<EntrySource, 'data' | 'i18n'>, ctx: ScanContext): Set<string> {
  const out = new Set<string>();
  for (const value of [entry.data, entry.i18n]) {
    for (const id of collectAssetIds(value)) if (ctx.targets.has(id)) out.add(id);
    for (const id of idsInJson(value, ctx)) out.add(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

interface ReleaseHit {
  /** Phần sau "Site đang chạy — ". */
  where: string;
  ids: ReadonlySet<string>;
}

/**
 * Mọi chỗ trong MỘT release đang dùng ảnh: doc từng trang (với cây component của
 * CHÍNH release đó, không phải bảng `Preset` hiện tại) và ba ảnh chụp chuỗi tự do.
 *
 * KHÔNG đọc `Release.assets`: ảnh chụp đó chép metadata của MỌI asset có lúc
 * publish, dùng hay không — đọc nó thì mọi ảnh cũ hơn release đầu tiên đều bị chặn.
 */
function releaseHits(
  rel: ReleaseSource,
  versionDocs: ReadonlyMap<string, unknown>,
  ctx: ScanContext,
): ReleaseHit[] {
  const hits: ReleaseHit[] = [];
  for (const e of rel.entries) {
    const raw = versionDocs.get(e.versionId);
    if (raw === undefined) continue;
    hits.push({ where: `/${e.slug}`, ids: idsInDoc(raw, rel.components, ctx) });
  }

  // Ảnh chụp bản dịch: `locale:nodeId:field` → giá trị. Gom theo ngôn ngữ để nhãn
  // nói được "bản dịch en" thay vì một id node không ai đọc được.
  if (rel.translations && typeof rel.translations === 'object' && !Array.isArray(rel.translations)) {
    const byLocale = new Map<string, Set<string>>();
    for (const [k, v] of Object.entries(rel.translations as Record<string, unknown>)) {
      const found = idsInJson(v, ctx);
      if (!found.size) continue;
      const locale = k.split(':')[0] ?? '';
      const set = byLocale.get(locale) ?? new Set<string>();
      for (const id of found) set.add(id);
      byLocale.set(locale, set);
    }
    for (const [locale, ids] of byLocale) hits.push({ where: `bản dịch ${locale}`, ids });
  }

  hits.push({ where: 'token', ids: idsInJson(rel.tokens, ctx) });
  hits.push({ where: 'thông tin chung', ids: idsInJson(rel.globals, ctx) });
  return hits;
}

// ---------------------------------------------------------------------------
// Ghép
// ---------------------------------------------------------------------------

const pageName = (p: Pick<PageSource, 'title' | 'slug'>) =>
  `${p.title.trim() || 'Trang chưa đặt tên'} — /${p.slug}`;

const entryTitle = (e: EntrySource): string => {
  const data = e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {};
  const raw = data[e.titleField];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : e.slug;
};

const toIso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());

/**
 * Ghép mọi nguồn thành kết quả cho từng id.
 *
 * Mọi id đầu vào đều có mặt trong Map trả về, kể cả id không có hàng `Asset` — chỗ
 * gọi phân biệt "không ai dùng" với "không tồn tại" bằng bảng `Asset`, không bằng
 * việc thiếu khoá ở đây.
 */
export function scanAssetReferences(
  ids: readonly string[],
  assets: readonly ScanAsset[],
  src: ReferenceSources,
): AssetReferenceMap {
  const unique = [...new Set(ids)];
  const ctx = createScanContext(unique, assets);
  const out: AssetReferenceMap = new Map(
    unique.map((id) => [id, { blocking: [], oldReleases: [] }]),
  );
  const seenRef = new Map<string, Set<string>>();
  const seenRel = new Map<string, Set<string>>();

  const block = (found: Iterable<string | null | undefined>, ref: AssetRef) => {
    const sig = `${ref.kind}\u0000${ref.label}\u0000${ref.href ?? ''}`;
    for (const id of found) {
      if (!id) continue;
      const slot = out.get(id);
      if (!slot) continue;
      const seen = seenRef.get(id) ?? new Set<string>();
      if (seen.has(sig)) continue;
      seen.add(sig);
      seenRef.set(id, seen);
      slot.blocking.push(ref);
    }
  };

  const warn = (found: Iterable<string>, rel: OldReleaseRef) => {
    for (const id of found) {
      const slot = out.get(id);
      if (!slot) continue;
      const seen = seenRel.get(id) ?? new Set<string>();
      if (seen.has(rel.id)) continue;
      seen.add(rel.id);
      seenRel.set(id, seen);
      slot.oldReleases.push(rel);
    }
  };

  /*
   * Cây component HIỆN TẠI, dựng một lần từ chính các hàng `Preset` đã nạp.
   *
   * Không gọi `loadComponents` từng trang như `asset-usage.ts`: nguồn 'component'
   * dưới đây đã phải nạp MỌI preset, nên tra lại bảng đó theo từng tập id là đọc hai
   * lần cùng một thứ. `assetIdsOf` chỉ tra id mà doc cắm, nên một map thừa component
   * không đổi kết quả. Cây hỏng thì vắng mặt — cùng luật với `loadComponents`.
   */
  const liveTrees = new Map<string, { rootId: string; nodes: Record<string, Node> }>();
  for (const p of src.presets) {
    try {
      liveTrees.set(p.id, migratePresetTree(p.tree));
    } catch {
      continue;
    }
  }

  // --- Bản nháp trang, kể cả trang đã lưu trữ ---------------------------------
  const pageById = new Map(src.pages.map((p) => [p.id, p]));
  const pageRef = (p: PageSource, suffix = ''): AssetRef => {
    const kind: AssetRefKind = p.archived ? 'archived-page' : 'page';
    return p.archived
      ? // Trang lưu trữ không mở trong trình soạn; chỗ khôi phục/xoá hẳn nó là danh
        // sách "Lưu trữ" ở trang chủ builder.
        { kind, label: `${pageName(p)}${suffix} (đã lưu trữ)`, href: '/builder' }
      : { kind, label: `${pageName(p)}${suffix}`, href: `/builder/${p.id}` };
  };

  for (const p of src.pages) {
    const found = new Set<string>(idsInJson(p.jsonLd, ctx));
    if (p.draftDoc !== null && p.draftDoc !== undefined) {
      for (const id of idsInDoc(p.draftDoc, liveTrees, ctx)) found.add(id);
    }
    block(found, pageRef(p));

    if (p.ogImageId) {
      block([p.ogImageId], {
        kind: 'page-og',
        label: `Ảnh chia sẻ của trang ${pageName(p)}`,
        href: p.archived ? '/builder' : `/builder/${p.id}`,
      });
    }
  }

  for (const t of src.draftTranslations) {
    const p = pageById.get(t.pageId);
    if (!p) continue;
    block(idsInJson(t.value, ctx), pageRef(p, ` (bản dịch ${t.locale})`));
  }

  // --- Component, kể cả component chưa có instance nào ------------------------
  for (const p of src.presets) {
    block(idsInPresetTree(p.tree, liveTrees.get(p.id), liveTrees, ctx), {
      kind: 'component',
      label: `Component “${p.name}”`,
      href: `/builder/components/${p.id}`,
    });
  }

  // --- Effect preset ----------------------------------------------------------
  for (const e of src.effectPresets) {
    const found = new Set(idsInJson(e.params, ctx));
    for (const id of effectPresetAssetIds(e.effectKey, e.params)) found.add(id);
    // Không có href: chưa có màn nào trong builder sửa effect preset.
    block(found, { kind: 'effect-preset', label: `Hiệu ứng mẫu “${e.name}”` });
  }

  // --- Entry (bảng live, không đi qua publish) --------------------------------
  for (const e of src.entries) {
    block(idsInEntry(e, ctx), {
      kind: 'entry',
      label: `${e.typeName}: ${entryTitle(e)}${e.archived ? ' (đã lưu trữ)' : ''}`,
      href: `/builder/content/${e.typeKey}/${e.id}`,
    });
  }

  // --- Cấu hình site ------------------------------------------------------------
  for (const s of src.sites) {
    block([s.faviconAssetId], { kind: 'favicon', label: 'Favicon của site', href: '/builder/settings' });
    block([s.ogImageId], {
      kind: 'site-og',
      label: 'Ảnh chia sẻ mặc định của site',
      href: '/builder/settings',
    });
    block(idsInJson(s.globals, ctx), {
      kind: 'site-globals',
      label: 'Thông tin chung của site',
      href: '/builder/settings',
    });
  }

  for (const u of src.users) {
    block([u.avatarAssetId], {
      kind: 'avatar',
      label: `Ảnh đại diện của ${u.name?.trim() || u.email}`,
      href: '/builder/admin',
    });
  }

  for (const t of src.tokens) {
    block(idsInJson(t.value, ctx), { kind: 'token', label: `Token --${t.name}`, href: '/builder/settings' });
  }

  // --- Release đang chạy: CHẶN -------------------------------------------------
  for (const rel of src.liveReleases) {
    for (const hit of releaseHits(rel, src.versionDocs, ctx)) {
      block(hit.ids, {
        kind: 'live-release',
        label: `Site đang chạy — ${hit.where}`,
        href: '/builder/releases',
      });
    }
  }

  // --- Release cũ: chỉ CẢNH BÁO ------------------------------------------------
  for (const rel of src.oldReleases) {
    const ref: OldReleaseRef = { id: rel.id, label: rel.label, createdAt: toIso(rel.createdAt) };
    for (const hit of releaseHits(rel, src.versionDocs, ctx)) warn(hit.ids, ref);
  }

  return out;
}
