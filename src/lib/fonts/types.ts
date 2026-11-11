/** Kiểu dùng chung của tính năng font động. */

export type FontStyle = 'normal' | 'italic';
export type FontSource = 'upload' | 'google';

/** Một face trong ảnh chụp font của release. `key` là khoá file trong kho (prefix `public/`). */
export interface FontSealFace {
  key: string;
  weight: string;
  style: FontStyle;
  unicodeRange: string;
}
export interface FontSealFamily {
  slug: string;
  cssName: string;
  faces: FontSealFace[];
}
export interface FontSeal {
  families: FontSealFamily[];
}
export const EMPTY_FONT_SEAL: FontSeal = Object.freeze({ families: [] }) as FontSeal;

export type FontErrorCode =
  | 'not_font'
  | 'collection_unsupported'
  | 'too_large'
  | 'name_required'
  | 'name_reserved'
  | 'slug_taken'
  | 'license_required'
  | 'google_not_found'
  | 'google_unreachable'
  | 'in_use'
  | 'bad_fallback'
  | 'not_found'
  | 'bad_weight';

export const FONT_ERROR_STATUS: Record<FontErrorCode, number> = {
  not_font: 415,
  collection_unsupported: 415,
  too_large: 413,
  name_required: 422,
  name_reserved: 409,
  slug_taken: 409,
  license_required: 422,
  google_not_found: 404,
  google_unreachable: 502,
  in_use: 409,
  bad_fallback: 422,
  not_found: 404,
  bad_weight: 422,
};

export class FontError extends Error {
  readonly code: FontErrorCode;
  readonly status: number;
  readonly extra?: Record<string, unknown>;
  constructor(code: FontErrorCode, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'FontError';
    this.code = code;
    this.status = FONT_ERROR_STATUS[code];
    this.extra = extra;
  }
}

export type FontWarningCode = 'missing_vietnamese' | 'restricted_embedding' | 'google_truncated';

/** Tag cache Next cho mọi thứ đọc từ bảng font. */
export const FONTS_TAG = 'fonts';

/** Chuỗi dự phòng mặc định (§7.4). */
export const FALLBACKS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
};

/** Cache của file font trong kho: khoá có hash nội dung nên không bao giờ đổi. */
export const FONT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const WEIGHT_RE = /^(\d{1,4})(?: (\d{1,4}))?$/;

function badWeight(): FontError {
  return new FontError(
    'bad_weight',
    'Độ đậm không hợp lệ: nhập một số từ 1 đến 1000 (ví dụ 400) hoặc dải tăng dần như "100 900".',
  );
}

/**
 * Chuẩn hoá `weight` do người gọi cung cấp (route và tool MCP dùng chung): một số
 * `400` hoặc dải `100 900`, mỗi số 1..1000, dải phải tăng dần. Rỗng thì trả
 * `undefined` (service tự đọc từ file). Sai thì ném `FontError('bad_weight')`.
 */
export function parseWeight(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const raw = typeof input === 'number' ? String(input) : input;
  if (typeof raw !== 'string') throw badWeight();
  const text = raw.trim();
  if (text === '') return undefined;
  const m = WEIGHT_RE.exec(text);
  if (!m) throw badWeight();
  const lo = Number(m[1]);
  const hi = m[2] === undefined ? lo : Number(m[2]);
  if (lo < 1 || lo > 1000 || hi < 1 || hi > 1000 || lo > hi) throw badWeight();
  return text;
}

const SERVABLE_KEY_RE = /^public\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:woff2|woff|ttf|otf)$/;

/** Khoá file font mà `/mm-font` được phép đọc: `public/…`, đuôi font, không `..`/`.`/`//`/`\`. */
export function isServableFontKey(key: string): boolean {
  return SERVABLE_KEY_RE.test(key) && !key.split('/').some((s) => s === '.' || s === '..');
}
