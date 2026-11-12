/**
 * Sinh font mẫu cho test — KHÔNG commit file nhị phân mới. Gốc là Inter (OFL) đã có
 * trong `public/fonts`; TTF được sinh trong bộ nhớ bằng `subset-font`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import subsetFont from 'subset-font';

const FONT_DIR = path.resolve(import.meta.dirname, '../../../public/fonts');

/** Đường dẫn tuyệt đối tới woff2 có sẵn của Inter. */
export const INTER_VIETNAMESE_PATH = path.join(FONT_DIR, 'inter-vietnamese.woff2');
export const INTER_LATIN_PATH = path.join(FONT_DIR, 'inter-latin-wght-normal.woff2');
export const INTER_LATIN_EXT_PATH = path.join(FONT_DIR, 'inter-latin-ext.woff2');

const read = (p: string): Uint8Array => new Uint8Array(readFileSync(p));

export const interVietnameseWoff2 = (): Uint8Array => read(INTER_VIETNAMESE_PATH);
/** Chỉ có latin — thiếu chữ Việt có dấu. */
export const interLatinWoff2 = (): Uint8Array => read(INTER_LATIN_PATH);
export const interLatinExtWoff2 = (): Uint8Array => read(INTER_LATIN_EXT_PATH);

/**
 * TTF sinh từ Inter. Gốc `inter-vietnamese.woff2` chỉ có glyph chữ Việt (không có ASCII),
 * nên phần ASCII trong `text` không giữ được gì — muốn hai file khác byte thì khác ở chữ Việt.
 */
export async function interTtf(): Promise<Uint8Array> {
  return interTtfWith('AaBbCc0123 ạảãếộữơưƯĐ');
}

/** Như `interTtf` nhưng cắt theo `text` riêng — byte khác nhau để thử thay face. */
export async function interTtfWith(text: string): Promise<Uint8Array> {
  const out = await subsetFont(Buffer.from(interVietnameseWoff2()), text, {
    targetFormat: 'truetype',
  });
  return new Uint8Array(out);
}

/** Vá `fsType` (offset 8 của bảng OS/2) thành `value`; ném lỗi nếu không có OS/2. */
export function patchFsType(ttf: Uint8Array, value: number): Uint8Array {
  const copy = new Uint8Array(ttf);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(copy[rec]!, copy[rec + 1]!, copy[rec + 2]!, copy[rec + 3]!);
    if (tag === 'OS/2') {
      view.setUint16(view.getUint32(rec + 8) + 8, value);
      return copy;
    }
  }
  throw new Error('TTF không có bảng OS/2');
}

/** TTF có `fsType = 0x0002` (cấm nhúng). */
export async function restrictedTtf(): Promise<Uint8Array> {
  return patchFsType(await interTtf(), 0x0002);
}
