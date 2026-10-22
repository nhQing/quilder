/**
 * Định dạng gói xuất trang — `manifest.json` + `files/<sha256>.<đuôi>`.
 *
 * Thuần và chạy được ở trình duyệt: hộp thoại nhập đọc manifest ngay khi người dùng chọn
 * file, trước khi gửi gì lên server. Server kiểm LẠI bằng đúng schema này — không tin bản
 * kiểm ở trình duyệt.
 *
 * id trong gói là id NGUỒN. Đích không bao giờ ghi lại chúng, chỉ dùng làm khoá tra.
 */

import { z } from 'zod';

export const BUNDLE_FORMAT = 'quilder-page' as const;
/**
 * Tên định dạng của gói xuất TRƯỚC khi builder đổi tên thành Quilder (21/10/2026). Gói đã xuất
 * phải nhập được mãi — nhận khi nhập, không bao giờ ghi ra nữa.
 */
export const LEGACY_BUNDLE_FORMATS = ['maimoney-page'] as const;
export const BUNDLE_FORMAT_VERSION = 1 as const;
/** Doc nháp lớn nhất đo ngày 14/10/2026 là 472 KB; 5 MB là gấp mười lần. */
export const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
/** Một node `image-sequence` có tới 3 × 400 khung. */
export const MAX_BUNDLE_ASSETS = 5000;

const zSha = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 phải là 64 ký tự hex');

export const zBundleAsset = z.object({
  id: z.string().min(1).max(64),
  key: z.string().min(1).max(300),
  /** Tên để tải lên ở đích — `uploadNameOf(key)`. */
  name: z.string().min(1).max(200),
  kind: z.string().min(1).max(20),
  mime: z.string().min(1).max(100),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  blurhash: z.string().nullable(),
  alt: z.string().nullable(),
  folder: z.string().nullable(),
  sha256: zSha,
  // Chỉ nhận đúng hình dạng mình sinh ra: không `..`, không thư mục khác.
  file: z.string().regex(/^files\/[0-9a-f]{64}(\.[a-z0-9]{1,8})?$/, 'đường dẫn file trong gói không hợp lệ'),
});

export const zBundleComponent = z.object({
  id: z.string().min(1).max(64),
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  aiDescription: z.string().max(4000),
  tree: z.unknown(),
});

export const zBundleToken = z.object({
  name: z.string().min(1).max(80),
  value: z.string().min(1).max(500),
  category: z.string().min(1).max(40),
  group: z.string().nullable(),
  aiDescription: z.string().nullable(),
});

export const zBundleTranslation = z.object({
  locale: z.string().min(1).max(20),
  nodeId: z.string().min(1).max(200),
  field: z.string().min(1).max(120),
  value: z.unknown(),
  sourceHash: z.string().max(200),
});

export const zBundleNeeds = z.object({
  endpointKeys: z.array(z.string()),
  embedOrigins: z.array(z.string()),
  collectionTypes: z.array(z.string()),
  collection: z
    .object({ typeKey: z.string(), role: z.string(), fields: z.array(z.string()) })
    .nullable(),
});

export const zPageBundle = z.object({
  format: z.enum([BUNDLE_FORMAT, ...LEGACY_BUNDLE_FORMATS]),
  formatVersion: z.literal(BUNDLE_FORMAT_VERSION),
  exportedAt: z.string(),
  exportedBy: z.string(),
  source: z.object({ siteName: z.string(), origin: z.string(), pageId: z.string() }),
  schemaVersion: z.number().int().positive(),
  page: z.object({
    slug: z.string().max(300),
    title: z.string().min(1).max(300),
    description: z.string().nullable(),
    canonical: z.string().nullable(),
    noindex: z.boolean(),
    jsonLd: z.unknown().nullable(),
    ogImageId: z.string().nullable(),
    collection: z.unknown().nullable(),
  }),
  // z.unknown() nhận cả khi thiếu khoá; phải chặn riêng để gói không có doc không lọt qua.
  doc: z.unknown().refine((v) => v !== undefined, { message: 'thiếu trường doc (nội dung trang)' }),
  translations: z.array(zBundleTranslation),
  locales: z.array(z.object({ code: z.string(), label: z.string() })),
  components: z.array(zBundleComponent),
  tokens: z.array(zBundleToken),
  assets: z.array(zBundleAsset).max(MAX_BUNDLE_ASSETS),
  needs: zBundleNeeds,
});

export type PageBundle = z.infer<typeof zPageBundle>;
export type BundleAsset = z.infer<typeof zBundleAsset>;
export type BundleComponent = z.infer<typeof zBundleComponent>;
export type BundleToken = z.infer<typeof zBundleToken>;
export type BundleTranslation = z.infer<typeof zBundleTranslation>;
export type BundleNeeds = z.infer<typeof zBundleNeeds>;

export function parseBundle(
  raw: unknown,
): { ok: true; bundle: PageBundle } | { ok: false; error: string } {
  const r = zPageBundle.safeParse(raw);
  if (r.success) return { ok: true, bundle: r.data };
  const first = r.error.issues[0];
  return {
    ok: false,
    error: `manifest.json hỏng ở "${first?.path.join('.') || '(gốc)'}": ${first ? viMessage(first) : 'không rõ'}`,
  };
}

/** Lời lỗi zod mặc định là tiếng Anh; người dùng chỉ thấy tiếng Việt. */
function viMessage(issue: z.ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' ? 'thiếu giá trị' : 'sai kiểu dữ liệu';
    case 'invalid_literal':
    case 'invalid_enum_value':
      return 'giá trị không đúng (định dạng hoặc phiên bản gói lạ)';
    case 'too_small':
      return 'quá ngắn / quá nhỏ';
    case 'too_big':
      return 'quá dài / quá lớn';
    case 'invalid_string':
    case 'custom':
      // Chỉ dùng lời tự đặt bằng tiếng Việt; lời mặc định của zod ("Invalid") thì rơi xuống dưới.
      return issue.message && issue.message !== 'Invalid' && issue.message !== 'Invalid input'
        ? issue.message
        : 'không hợp lệ';
    default:
      return 'không hợp lệ';
  }
}

/** Chỉ giữ đuôi khớp đúng regex của `file` ở zBundleAsset; đuôi lạ thì bỏ hẳn. */
function extOf(key: string): string {
  const file = key.slice(key.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  const ext = dot <= 0 ? '' : file.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

export function fileEntryName(sha256: string, key: string): string {
  return `files/${sha256}${extOf(key)}`;
}

/**
 * Tên file để tải lên ở đích: tên cuối của khoá, bỏ đuôi `-<8 hex>` mà `nextAssetKey` đã
 * chèn. Không bỏ thì `uploadAsset` chèn hash lần nữa (`hero-1a2b3c4d-1a2b3c4d.png`) và
 * khoá ở đích không bao giờ khớp khoá đoán trước.
 */
export function uploadNameOf(key: string): string {
  const file = key.slice(key.lastIndexOf('/') + 1);
  return file.replace(/-[0-9a-f]{8}(\.[^.]+)?$/, '$1') || 'asset';
}

export function bundleFileName(slug: string, at: Date): string {
  const name = slug
    .replace(/[[\]]/g, '')
    .split('/')
    .filter(Boolean)
    .join('-') || 'trang-chu';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
  return `${name}-${stamp}.zip`;
}
