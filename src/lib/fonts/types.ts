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
  | 'bad_fallback';

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

export type FontWarningCode = 'missing_vietnamese' | 'restricted_embedding';

/** Tag cache Next cho mọi thứ đọc từ bảng font. */
export const FONTS_TAG = 'fonts';

/** Chuỗi dự phòng mặc định (§7.4). */
export const FALLBACKS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
};
