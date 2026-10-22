import { describe, expect, it } from 'vitest';

import { sniff } from './sniff';

/**
 * Kiểu file lấy từ NỘI DUNG, không từ đuôi.
 *
 * ## Vì sao đuôi không đủ
 *
 * Đuôi do người tải lên đặt. Tin nó là để một file bất kỳ được ghi lên bucket với
 * `Content-Type` do ta khẳng định — và vì `CacheControl: immutable`, một object ghi
 * sai kiểu là **vĩnh viễn**: không sửa lại được, chỉ ghi khoá mới và bỏ khoá cũ.
 *
 * ## Vì sao trả `null` thay vì đoán
 *
 * Không nhận dạng được thì từ chối TRƯỚC khi chạm S3. Đoán bừa là đưa một object
 * không rõ nội dung lên một bucket đọc công khai.
 */

/** PNG 1×1: signature + IHDR khai 1×1. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

/** PNG 447×677 — đúng kích thước một ảnh chương thật trong dự án. */
const PNG_447 = (() => {
  const b = new Uint8Array(PNG);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, 447);
  dv.setUint32(20, 677);
  return b;
})();

const SVG_VIEWBOX = new TextEncoder().encode(
  '<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg"></svg>',
);
const SVG_WH = new TextEncoder().encode('<svg width="120" height="40"></svg>');

/** JPEG tối thiểu: SOI + SOF0 khai 30×40. */
const JPEG = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08,
  0x00, 0x28, // height 40
  0x00, 0x1e, // width 30
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
]);

describe('sniff — nhận dạng đúng', () => {
  it('PNG: đọc kích thước từ IHDR', () => {
    expect(sniff(PNG)).toEqual({ mime: 'image/png', width: 1, height: 1 });
  });

  it('PNG thật: 447×677', () => {
    expect(sniff(PNG_447)).toEqual({ mime: 'image/png', width: 447, height: 677 });
  });

  it('JPEG: đọc kích thước từ SOF', () => {
    expect(sniff(JPEG)).toEqual({ mime: 'image/jpeg', width: 30, height: 40 });
  });

  it('SVG: ưu tiên width/height', () => {
    expect(sniff(SVG_WH)).toEqual({ mime: 'image/svg+xml', width: 120, height: 40 });
  });

  it('SVG: rơi về viewBox khi không có width/height', () => {
    expect(sniff(SVG_VIEWBOX)).toEqual({ mime: 'image/svg+xml', width: 24, height: 16 });
  });
});

describe('sniff — từ chối', () => {
  it('HTML đặt tên .png bị TỪ CHỐI', () => {
    // Phép thử chịu lực của cả luật này.
    expect(sniff(new TextEncoder().encode('<html><body>xin chao</body></html>'))).toBeNull();
  });

  it('file rỗng', () => {
    expect(sniff(new Uint8Array())).toBeNull();
  });

  it('byte ngẫu nhiên — không đoán bừa', () => {
    expect(sniff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  it('PNG cụt: có signature nhưng thiếu IHDR', () => {
    // Nhận dạng được định dạng mà không đọc nổi kích thước thì vẫn là từ chối:
    // `Asset.width/height` là thứ duy nhất cho renderer đi nhánh giữ chỗ (CLS = 0).
    expect(sniff(PNG.slice(0, 8))).toBeNull();
  });

  it('SVG không có width/height lẫn viewBox', () => {
    expect(sniff(new TextEncoder().encode('<svg></svg>'))).toBeNull();
  });
});

/*
 * Nhận dạng định dạng KHÔNG phải ảnh.
 *
 * Mỗi ca dựng đúng phần đầu file — magic byte — chứ không dùng fixture: phép kiểm ở
 * đây là "nhìn byte đầu có nói đúng tên định dạng không", và một file thật 2 MB
 * không kiểm thêm được gì cho câu đó.
 */
describe('sniff — không phải ảnh', () => {
  const bytes = (...parts: (string | number[])[]) => {
    const out: number[] = [];
    for (const p of parts) {
      if (typeof p === 'string') for (const c of p) out.push(c.charCodeAt(0));
      else out.push(...p);
    }
    return new Uint8Array(out);
  };

  it('PDF', () => {
    expect(sniff(bytes('%PDF-1.7\n'))).toEqual({ mime: 'application/pdf' });
  });

  it('MP4, và phân biệt được nhánh audio-only của cùng vỏ ISO-BMFF', () => {
    expect(sniff(bytes([0, 0, 0, 0x18], 'ftyp', 'isom'))).toEqual({ mime: 'video/mp4' });
    expect(sniff(bytes([0, 0, 0, 0x18], 'ftyp', 'M4A '))).toEqual({ mime: 'audio/mp4' });
    expect(sniff(bytes([0, 0, 0, 0x14], 'ftyp', 'qt  '))).toEqual({ mime: 'video/quicktime' });
  });

  it('WebM', () => {
    expect(sniff(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]))).toEqual({ mime: 'video/webm' });
  });

  it('OGG và WAV', () => {
    expect(sniff(bytes('OggS', [0, 2, 0]))).toEqual({ mime: 'audio/ogg' });
    expect(sniff(bytes('RIFF', [0x24, 0, 0, 0], 'WAVE'))).toEqual({ mime: 'audio/wav' });
    // RIFF mà KHÔNG phải WAVE (ví dụ AVI) thì không được nhận là audio.
    expect(sniff(bytes('RIFF', [0x24, 0, 0, 0], 'AVI '))).toBeNull();
  });

  it('MP3 cả hai dạng: có tag ID3 và frame sync trần', () => {
    expect(sniff(bytes('ID3', [3, 0, 0]))).toEqual({ mime: 'audio/mpeg' });
    expect(sniff(bytes([0xff, 0xfb, 0x90, 0x00]))).toEqual({ mime: 'audio/mpeg' });
  });

  it('WOFF2 và WOFF', () => {
    expect(sniff(bytes('wOF2', [0, 1, 0, 0]))).toEqual({ mime: 'font/woff2' });
    expect(sniff(bytes('wOFF', [0, 1, 0, 0]))).toEqual({ mime: 'font/woff' });
  });

  /*
   * Đây là phép kiểm chịu lực của cả nhánh này. Cả ba thứ dưới đây CỐ Ý không được
   * nhận, và mỗi cái vì một lý do khác nhau:
   *
   *  - zip/docx/xlsx/pptx dùng chung `PK\x03\x04`, phân biệt cần mở zip;
   *  - HTML là stored XSS nếu phục vụ từ host CDN;
   *  - văn bản trần không có magic byte nào cả.
   *
   * Nhận bất kỳ cái nào trong đó bằng cách tin đuôi file là mở lại đúng cánh cửa mà
   * docblock đầu `sniff.ts` đóng.
   */
  it('từ chối zip/office, HTML và văn bản trần', () => {
    expect(sniff(bytes([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(sniff(bytes('<!DOCTYPE html><html><body>x'))).toBeNull();
    expect(sniff(bytes('ten,tuoi\nan,30\n'))).toBeNull();
  });
});
