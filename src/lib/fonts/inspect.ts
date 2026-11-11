import * as fontkit from 'fontkit';

import { sniff } from '@/lib/assets/sniff';

import { type FontStyle, type FontWarningCode, FontError } from './types';
import { VIETNAMESE_PROBE } from './unicode';

/**
 * Trần một file font — cùng giá trị `MAX_ASSET_BYTES` (10 MB) ở `builder/upload-asset.ts`.
 * Không import từ đó: module ấy kéo theo prisma/S3 (và `server-only`) chỉ để lấy một hằng số.
 */
const MAX_FONT_BYTES = 10 * 1024 * 1024;

export interface InspectResult {
  format: 'woff2' | 'woff' | 'ttf' | 'otf';
  /** Name ID 16 (họ ưa dùng), không có thì ID 1. */
  family: string | null;
  /** "400", hoặc "100 900" khi font có trục wght. */
  weight: string;
  style: FontStyle;
  variable: boolean;
  warnings: FontWarningCode[];
}

const FORMAT_OF: Record<string, InspectResult['format'] | undefined> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
};

const NOT_FONT = 'File không phải font. Hãy chọn file .woff2, .woff, .ttf hoặc .otf.';

/** Đọc metadata của một file font; ném `FontError` khi file không dùng được. */
export function inspectFont(bytes: Uint8Array): InspectResult {
  if (bytes.length > MAX_FONT_BYTES) {
    throw new FontError(
      'too_large',
      'File font lớn hơn 10 MB. Hãy dùng bản đã nén (woff2) hoặc cắt bớt bộ chữ rồi tải lại.',
    );
  }
  const mime = sniff(bytes)?.mime;
  if (mime === 'font/collection') {
    throw new FontError(
      'collection_unsupported',
      'File TTC chứa nhiều font. Hãy tách thành từng file TTF/OTF rồi tải lên riêng.',
    );
  }
  const format = mime ? FORMAT_OF[mime] : undefined;
  if (!format) throw new FontError('not_font', NOT_FONT);

  let font: fontkit.Font;
  try {
    const created = fontkit.create(Buffer.from(bytes));
    if (!('familyName' in created)) throw new Error('collection');
    font = created;
  } catch {
    throw new FontError('not_font', 'Không đọc được file font (hỏng hoặc không đúng định dạng).');
  }

  const records = (font as unknown as { name?: { records?: Record<string, Record<string, string>> } })
    .name?.records;
  const family =
    records?.preferredFamily?.en ?? font.familyName ?? records?.fontFamily?.en ?? null;

  const wght = font.variationAxes?.wght;
  const variable = !!wght;
  const weight = wght
    ? `${Math.round(wght.min)} ${Math.round(wght.max)}`
    : String(font['OS/2']?.usWeightClass || 400);

  const sel = font['OS/2']?.fsSelection as unknown;
  const selItalic =
    typeof sel === 'number' ? (sel & 1) === 1 : !!(sel as { italic?: boolean } | undefined)?.italic;
  const style: FontStyle = selItalic || (font.italicAngle ?? 0) !== 0 ? 'italic' : 'normal';

  const warnings: FontWarningCode[] = [];
  if ([...VIETNAMESE_PROBE].some((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)!))) {
    warnings.push('missing_vietnamese');
  }
  const fsType = font['OS/2']?.fsType as unknown;
  const restricted =
    typeof fsType === 'number'
      ? (fsType & 0x0002) !== 0
      : !!(fsType as { noEmbedding?: boolean } | undefined)?.noEmbedding;
  if (restricted) warnings.push('restricted_embedding');

  return { format, family, weight, style, variable, warnings };
}
