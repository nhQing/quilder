/**
 * Cây thô của extractor → `Doc` hợp lệ với schema chặt của builder.
 *
 * ## Vì sao phải có bước này, dù extractor đã "ra cây node"
 *
 * Trang nguồn nói bằng CSS tự do; `zDoc` thì chặt (weight chỉ 400–700, text-transform chỉ
 * none/uppercase, node `.strict()`…). `scripts/migrate/draft-page.ts` từng ghi doc không qua `zDoc`
 * và để builder từ chối LÚC CÓ NGƯỜI SỬA đúng node đó — nghĩa là lỗi lộ ra muộn, ở chỗ không ai
 * nghĩ tới. Ở đây ngược lại: mọi thứ builder không nhận bị ép (weight 800 → 700) hoặc GỠ, và gỡ
 * cái gì thì ghi vào báo cáo — không có đường nào để một giá trị lạ lọt vào DB hay biến mất im lặng.
 *
 * Hàm THUẦN (không prisma) để test bằng fixture. Phần chạm DB nằm ở `create-draft.ts`.
 */

import { zDoc, zStyleProps } from '@/lib/doc/schema';
import { CURRENT_SCHEMA_VERSION, type Doc } from '@/lib/doc/types';
import { compileDoc, CssCompileError } from '@/lib/render/css';
import { ALWAYS_NOTE, notesToReport } from './report';
import type { CloneAssetResult, CloneNotes, CloneReportItem, RawDoc } from './types';

type Obj = Record<string, unknown>;

const LAYERS = ['base', 'sm', 'md', 'lg', 'xl'] as const;

/** Giữ chỗ extractor đặt cho `fill.image.assetId` — thay bằng asset thật hoặc gỡ cả `fill.image`. */
const BG_PLACEHOLDER = '__bg__';

export class CloneAssembleError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
  }
}

/* ── Asset ──────────────────────────────────────────────────────────────── */

export type AssetKind = 'image' | 'video' | 'poster' | 'background' | 'svg';

export interface AssetRef {
  /** URL tuyệt đối, `data:` hoặc `svg:<khoá>`. */
  ref: string;
  kind: AssetKind;
}

/** Mọi nguồn asset mà cây thô tham chiếu, mỗi `ref` một lần. */
export function collectAssetRefs(raw: RawDoc): AssetRef[] {
  const seen = new Map<string, AssetKind>();
  const add = (ref: unknown, kind: AssetKind) => {
    if (typeof ref === 'string' && ref && !seen.has(ref)) seen.set(ref, kind);
  };
  for (const node of Object.values(raw.nodes)) {
    const n = node as Obj;
    if (n.type === 'Image') add(n._src, typeof n._src === 'string' && n._src.startsWith('svg:') ? 'svg' : 'image');
    if (n.type === 'Video') {
      add(n._src, 'video');
      add(n._posterSrc, 'poster');
    }
    if (Array.isArray(n._bgSrc)) for (const u of n._bgSrc) add(u, 'background');
  }
  return [...seen].map(([ref, kind]) => ({ ref, kind }));
}

/* ── Tiện ích đường dẫn trong object ────────────────────────────────────── */

function getAt(root: unknown, path: ReadonlyArray<string | number>): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Obj)[k as string];
  }
  return cur;
}

function deleteAt(root: unknown, path: ReadonlyArray<string | number>): boolean {
  if (!path.length) return false;
  const parent = getAt(root, path.slice(0, -1));
  if (parent === null || typeof parent !== 'object') return false;
  const key = path[path.length - 1] as string;
  if (!(key in (parent as Obj))) return false;
  delete (parent as Obj)[key];
  return true;
}

/* ── Ép style về schema ─────────────────────────────────────────────────── */

interface Counter {
  count: number;
  samples: string[];
}

function bump(map: Map<string, Counter>, key: string, sample?: string) {
  const c = map.get(key) ?? { count: 0, samples: [] };
  c.count += 1;
  if (sample && c.samples.length < 3 && !c.samples.includes(sample)) c.samples.push(sample);
  map.set(key, c);
}

function snapWeight(n: number): 400 | 500 | 600 | 700 {
  if (n <= 450) return 400;
  if (n <= 550) return 500;
  if (n <= 650) return 600;
  return 700;
}

interface SanitizeStats {
  dropped: Map<string, Counter>;
  snapped: Map<string, Counter>;
}

/** Một lớp style: ép giá trị biết được, rồi gỡ từng khoá mà zod còn từ chối. */
function sanitizeLayer(layer: Obj, nodeId: string, stats: SanitizeStats): void {
  const typo = layer.typography as Obj | undefined;
  if (typo) {
    if (typeof typo.weight === 'number' && ![400, 500, 600, 700].includes(typo.weight)) {
      const to = snapWeight(typo.weight);
      bump(stats.snapped, `font-weight ${typo.weight}→${to}`, nodeId);
      typo.weight = to;
    }
    if (typo.transform !== undefined && typo.transform !== 'none' && typo.transform !== 'uppercase') {
      bump(stats.dropped, `typography.transform=${String(typo.transform)}`, nodeId);
      delete typo.transform;
    }
  }

  for (let round = 0; round < 24; round += 1) {
    const parsed = zStyleProps.safeParse(layer);
    if (parsed.success) return;
    let removed = 0;
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        const target = getAt(layer, issue.path);
        if (target && typeof target === 'object') {
          for (const key of issue.keys) {
            if (delete (target as Obj)[key]) {
              removed += 1;
              bump(stats.dropped, [...issue.path, key].join('.'), nodeId);
            }
          }
        }
        continue;
      }
      // `group.key` là đơn vị gỡ nhỏ nhất có nghĩa: `layout.gridTemplateColumns.0.kind` hỏng thì bỏ cả danh sách track.
      const cut = issue.path.slice(0, Math.min(issue.path.length, 2));
      const was = getAt(layer, cut);
      if (deleteAt(layer, cut)) {
        removed += 1;
        bump(stats.dropped, cut.join('.'), `${nodeId} (${JSON.stringify(was).slice(0, 40)})`);
      }
    }
    if (!removed) break;
  }
  // Không gỡ nổi (không nên xảy ra): bỏ cả lớp còn hơn ghi dữ liệu mà zDoc sẽ từ chối.
  for (const key of Object.keys(layer)) delete layer[key];
  bump(stats.dropped, 'cả lớp style', nodeId);
}

/* ── Lắp ráp ────────────────────────────────────────────────────────────── */

export interface AssembleOptions {
  assets: Record<string, CloneAssetResult>;
  notes: CloneNotes;
}

export interface AssembleResult {
  doc: Doc;
  report: CloneReportItem[];
  stats: { nodes: number; images: number; videos: number; imagesWired: number; videosWired: number };
  /** Khung header/footer — ứng viên để tách thành component (Instance của Preset). */
  landmarks: { header: string | null; footer: string | null };
}

const NODE_DROPPABLE = ['htmlId', 'a11y', 'customCss', 'part', 'name', 'render'] as const;

export function assembleCloneDoc(raw: RawDoc, options: AssembleOptions): AssembleResult {
  const nodes = JSON.parse(JSON.stringify(raw.nodes)) as Record<string, Obj>;
  const report: CloneReportItem[] = [];
  const failedAssets = new Map<string, Counter>();
  const stats = { nodes: 0, images: 0, videos: 0, imagesWired: 0, videosWired: 0 };
  const sanitize: SanitizeStats = { dropped: new Map(), snapped: new Map() };

  const resolve = (ref: unknown): string | null => {
    if (typeof ref !== 'string') return null;
    const r = options.assets[ref];
    if (!r) {
      bump(failedAssets, 'chưa được tải lên', ref.slice(0, 80));
      return null;
    }
    if ('assetId' in r) return r.assetId;
    bump(failedAssets, r.error, ref.slice(0, 80));
    return null;
  };

  /* 1. Nối asset, đổi nền ảnh. */
  for (const node of Object.values(nodes)) {
    if (node.type === 'Image') {
      stats.images += 1;
      node.assetId = resolve(node._src);
      if (node.assetId) stats.imagesWired += 1;
    }
    if (node.type === 'Video') {
      stats.videos += 1;
      node.assetId = resolve(node._src);
      node.posterAssetId = node._posterSrc ? resolve(node._posterSrc) : null;
      if (node.assetId) stats.videosWired += 1;
    }
    const bg = Array.isArray(node._bgSrc) ? (node._bgSrc as string[]) : [];
    const bgAsset = bg.length ? resolve(bg[0]) : null;
    const style = node.style as Record<string, Obj> | undefined;
    for (const layer of LAYERS) {
      const fill = style?.[layer]?.fill as Obj | undefined;
      const image = fill?.image as Obj | undefined;
      if (image?.assetId === BG_PLACEHOLDER) {
        if (bgAsset) image.assetId = bgAsset;
        else delete fill!.image;
      }
    }
  }

  /* 2. Gỡ giàn giáo `_…`, ép style, sửa chỗ ngữ nghĩa. */
  for (const [id, node] of Object.entries(nodes)) {
    for (const key of Object.keys(node)) if (key.startsWith('_')) delete node[key];
    node.effects ??= [];
    if (node.type === 'Image' && node.decorative !== true && !String(node.alt ?? '').trim()) node.decorative = true;
    if (typeof node.customCss === 'string' && node.customCss.length > 8000) {
      bump(sanitize.dropped, 'customCss quá 8000 ký tự', id);
      delete node.customCss;
    }
    if (typeof node.name === 'string') node.name = node.name.slice(0, 120);
    const style = node.style as Obj | undefined;
    if (!style) {
      node.style = { base: {} };
      continue;
    }
    style.base ??= {};
    for (const layer of LAYERS) {
      const l = style[layer] as Obj | undefined;
      if (l) {
        sanitizeLayer(l, id, sanitize);
        // Nhóm rỗng (`fill: {}` sau khi gỡ ảnh nền hỏng) không mang nghĩa gì và làm doc phình.
        for (const [group, value] of Object.entries(l)) {
          if (value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) delete l[group];
        }
      }
    }
    // Lớp override rỗng sau khi ép thì bỏ, để doc không mang `sm: {}`.
    for (const layer of LAYERS) {
      if (layer !== 'base' && style[layer] && !Object.keys(style[layer] as Obj).length) delete style[layer];
    }
  }

  /* 3. Cấu trúc: dựng lại parentId từ children, bỏ node mồ côi. */
  if (!nodes[raw.rootId]) throw new CloneAssembleError('Cây thô không có node gốc.', []);
  const reachable = new Set<string>();
  const queue: Array<[string, string | null]> = [[raw.rootId, null]];
  while (queue.length) {
    const [id, parent] = queue.shift() as [string, string | null];
    const node = nodes[id];
    if (!node || reachable.has(id)) continue;
    reachable.add(id);
    node.parentId = parent;
    const kids = Array.isArray(node.children) ? (node.children as string[]) : [];
    node.children = [...new Set(kids)].filter((c) => nodes[c] && c !== id);
    for (const c of node.children as string[]) queue.push([c, id]);
  }
  for (const id of Object.keys(nodes)) if (!reachable.has(id)) delete nodes[id];

  const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: raw.rootId, nodes } as unknown as Doc;
  stats.nodes = Object.keys(nodes).length;

  /* 4. zDoc: sửa những gì sửa được ở cấp node, còn lại là lỗi thật. */
  let lastIssues: string[] = [];
  for (let round = 0; round < 6; round += 1) {
    const parsed = zDoc.safeParse(doc);
    if (parsed.success) {
      lastIssues = [];
      break;
    }
    let fixed = 0;
    lastIssues = [];
    for (const issue of parsed.error.issues) {
      const [root, id, field] = issue.path as [string, string, string];
      const where = `${issue.path.join('.')}: ${issue.message}`;
      if (root !== 'nodes' || !id || !nodes[id]) {
        lastIssues.push(where);
        continue;
      }
      if (issue.code === 'unrecognized_keys' && issue.path.length === 2) {
        for (const key of issue.keys) {
          delete nodes[id]![key];
          fixed += 1;
          bump(sanitize.dropped, `node.${key}`, id);
        }
        continue;
      }
      if ((NODE_DROPPABLE as readonly string[]).includes(field) && deleteAt(nodes[id], [field])) {
        fixed += 1;
        bump(sanitize.dropped, `node.${field}`, id);
        continue;
      }
      if (field === 'style' && issue.path.length >= 5 && deleteAt(nodes[id], issue.path.slice(2, 6))) {
        fixed += 1;
        bump(sanitize.dropped, issue.path.slice(4, 6).join('.'), id);
        continue;
      }
      lastIssues.push(where);
    }
    if (!fixed) break;
  }
  if (lastIssues.length || !zDoc.safeParse(doc).success) {
    throw new CloneAssembleError(
      `Doc dựng ra không qua schema của builder (${lastIssues.length} lỗi). Đầu tiên: ${lastIssues.slice(0, 4).join(' | ')}`,
      lastIssues.slice(0, 20),
    );
  }

  /* 5. Biên dịch CSS thử — lỗi compile là lỗi không ai thấy cho tới lúc trang render. */
  try {
    compileDoc(doc);
  } catch (e) {
    throw new CloneAssembleError(
      `CSS của doc không biên dịch được: ${e instanceof CssCompileError ? e.message : String(e)}`,
      [],
    );
  }

  /* 6. Báo cáo. */
  report.push(...notesToReport(options.notes));

  if (failedAssets.size) {
    const total = [...failedAssets.values()].reduce((a, c) => a + c.count, 0);
    report.unshift({
      code: 'assets-failed',
      severity: 'error',
      count: total,
      message:
        `${total} asset (ảnh/video/nền) KHÔNG tải lên được — node tương ứng để trống. ` +
        [...failedAssets].map(([reason, c]) => `${reason} ×${c.count}`).join('; '),
      samples: [...failedAssets.values()].flatMap((c) => c.samples).slice(0, 8),
    });
  }
  if (sanitize.dropped.size) {
    const total = [...sanitize.dropped.values()].reduce((a, c) => a + c.count, 0);
    report.push({
      code: 'style-dropped',
      severity: 'warn',
      count: total,
      message:
        `${total} giá trị style mà builder không hỗ trợ đã bị gỡ: ` +
        [...sanitize.dropped]
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 8)
          .map(([k, c]) => `${k} ×${c.count}`)
          .join(', '),
      samples: [...sanitize.dropped.values()].flatMap((c) => c.samples).slice(0, 6),
    });
  }
  if (sanitize.snapped.size) {
    report.push({
      code: 'weight-snapped',
      severity: 'info',
      count: [...sanitize.snapped.values()].reduce((a, c) => a + c.count, 0),
      message:
        'Builder chỉ có font-weight 400/500/600/700; đã làm tròn: ' +
        [...sanitize.snapped].map(([k, c]) => `${k} ×${c.count}`).join(', '),
    });
  }
  report.push(ALWAYS_NOTE);
  // Lỗi trước, cảnh báo sau, thông tin cuối — gồm cả các mục do chính bộ lắp ráp thêm.
  const rank = { error: 0, warn: 1, info: 2 } as const;
  report.sort((a, b) => rank[a.severity] - rank[b.severity]);

  /* 7. Khung header/footer để tách thành component. */
  let header: string | null = null;
  let footer: string | null = null;
  const visit = (id: string, depth: number) => {
    const n = nodes[id];
    if (!n || depth > 4) return;
    if (n.type === 'Section' && n.tag === 'header' && !header) header = id;
    if (n.type === 'Section' && n.tag === 'footer') footer = id;
    for (const c of n.children as string[]) visit(c, depth + 1);
  };
  visit(raw.rootId, 0);

  return { doc, report, stats, landmarks: { header, footer } };
}
