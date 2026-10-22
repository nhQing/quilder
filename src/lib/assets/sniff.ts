/**
 * Nhận dạng ảnh từ NỘI DUNG: kiểu thật và kích thước nội tại.
 *
 * ## Vì sao không tin đuôi file
 *
 * Đuôi do người tải lên đặt. Tin nó là để một file bất kỳ được ghi lên bucket kèm
 * `Content-Type` do ta khẳng định — và vì object ghi với `CacheControl: immutable`,
 * kiểu sai là **vĩnh viễn**: không sửa lại được, chỉ ghi khoá mới và bỏ khoá cũ.
 *
 * ## Vì sao kích thước là bắt buộc, không phải tuỳ chọn
 *
 * `Asset.width/height` là thứ duy nhất cho `NodeRenderer` đi nhánh giữ chỗ
 * (CLS = 0). Thiếu là ảnh rơi về nhánh `fill` và trang giật khi ảnh về. Nên nhận
 * dạng được định dạng mà không đọc nổi kích thước vẫn tính là **từ chối** — thà
 * bảo người dùng đổi file còn hơn nhận một ảnh làm giật trang.
 *
 * ## Hàm thuần, không chạm đĩa
 *
 * Nhận `Uint8Array` để `pnpm test` chạy được không cần fixture, và để dùng chung
 * được cho cả đường tải lên (byte từ HTTP) lẫn `scripts/wire-page-assets.ts` (byte
 * từ `readFileSync`). Trước đây script đó giữ bản riêng — hai bản của một luật sẽ
 * trôi khỏi nhau.
 */

export interface Sniffed {
  mime: string;
  /**
   * Chỉ ẢNH có. File PDF/video/âm thanh trả `undefined`, và đó là giá trị hợp lệ.
   *
   * Luật "thiếu kích thước = từ chối" ở docblock đầu file vẫn nguyên, nhưng nó chỉ
   * đúng với ảnh: nó tồn tại vì `NodeRenderer` cần `width/height` để giữ chỗ và
   * tránh giật trang. Một file PDF không bao giờ đi vào nhánh đó, nên đòi kích thước
   * ở nó là đòi một thứ không có nghĩa — và sẽ chặn mất đúng những định dạng mà
   * trang Thư viện được lập ra để chứa.
   */
  width?: number;
  height?: number;
}

function pngSize(b: Uint8Array): Sniffed | null {
  // Signature 8 byte + chunk IHDR ngay sau, với 'IHDR' ở byte 12..16.
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) return null;

  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (tag !== 'IHDR') return null;

  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  if (!width || !height) return null;
  return { mime: 'image/png', width, height };
}

function jpegSize(b: Uint8Array): Sniffed | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;

  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1]!;
    const len = dv.getUint16(i + 2);
    // SOFn mang kích thước, trừ 0xc4 (DHT), 0xc8 (JPG mở rộng) và 0xcc (DAC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { mime: 'image/jpeg', height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function svgSize(b: Uint8Array): Sniffed | null {
  // Đọc 2 KB đầu: thẻ `<svg>` luôn ở đầu file, và giới hạn này chặn việc quét cả
  // một file lớn chỉ để kết luận nó không phải SVG.
  const head = new TextDecoder('utf8', { fatal: false }).decode(b.subarray(0, 2000));
  if (!/<svg[\s>]/i.test(head)) return null;

  const attr = (name: string): number | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*"([\\d.]+)`).exec(head);
    return m ? Number(m[1]) : null;
  };

  const w = attr('width');
  const h = attr('height');
  if (w && h) return { mime: 'image/svg+xml', width: Math.round(w), height: Math.round(h) };

  // Không có width/height thì viewBox là nguồn duy nhất của tỉ lệ.
  const vb = /viewBox\s*=\s*"([^"]+)"/i.exec(head);
  if (vb) {
    const p = vb[1]!.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2]! > 0 && p[3]! > 0) {
      return { mime: 'image/svg+xml', width: Math.round(p[2]!), height: Math.round(p[3]!) };
    }
  }
  return null;
}

/** `bytes` bắt đầu bằng đúng dãy này? */
function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  return sig.every((v, i) => b[at + i] === v);
}

function ascii(b: Uint8Array, at: number, len: number): string {
  if (b.length < at + len) return '';
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(b[at + i]!);
  return out;
}

/**
 * Định dạng không phải ảnh, nhận dạng từ magic byte.
 *
 * ## Vì sao CHỈ những định dạng có magic byte
 *
 * Docblock đầu file nói rõ vì sao không tin đuôi file: object ghi lên S3 với
 * `CacheControl: immutable`, nên `Content-Type` sai là VĨNH VIỄN. Luật đó không
 * được nới ra chỉ vì danh sách định dạng dài hơn.
 *
 * Hệ quả là có những thứ CỐ Ý không nằm đây:
 *
 *  - **docx / xlsx / pptx / zip** — tất cả đều là `PK\x03\x04`. Phân biệt chúng
 *    cần mở zip và đọc mục lục bên trong. Chưa làm, nên chưa nhận; nhận bằng cách
 *    tin đuôi file là đúng thứ luật trên cấm.
 *  - **html** — và cái này thì không phải "chưa làm". Một file HTML ghi lên bucket
 *    công khai rồi phục vụ từ chính host CDN là stored XSS trên host đó. Nó chỉ
 *    được phép nếu phục vụ kèm `Content-Disposition: attachment`, mà `putObject`
 *    hiện không đặt header đó. Không nhận cho tới khi có đường đó.
 */
function otherFormat(b: Uint8Array): Sniffed | null {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf' };

  // ISO-BMFF: 4 byte độ dài rồi 'ftyp'. Dùng cho mp4, m4v, m4a, mov.
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'M4A ') return { mime: 'audio/mp4' };
    if (brand === 'qt  ') return { mime: 'video/quicktime' };
    return { mime: 'video/mp4' };
  }

  // Matroska / WebM. Phân biệt hai cái cần đọc DocType, nên trả webm — đó là thứ
  // trình duyệt phát được, và là 100% ca dùng thật ở đây.
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: 'video/webm' };

  if (ascii(b, 0, 4) === 'OggS') return { mime: 'audio/ogg' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { mime: 'audio/wav' };

  // MP3: tag ID3 ở đầu, hoặc frame sync 11 bit bật (0xFF Ex/Fx).
  if (ascii(b, 0, 3) === 'ID3') return { mime: 'audio/mpeg' };
  if (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0) {
    return { mime: 'audio/mpeg' };
  }

  // Font: woff2 và woff. Có sẵn ở đây để việc "nhập file font" sau này không phải
  // mở lại luật nhận dạng — xem HANDOFF §3.49.
  if (ascii(b, 0, 4) === 'wOF2') return { mime: 'font/woff2' };
  if (ascii(b, 0, 4) === 'wOFF') return { mime: 'font/woff' };

  return null;
}

/**
 * Kiểu và (với ảnh) kích thước, hoặc `null` khi không nhận dạng được.
 *
 * `null` là câu trả lời hợp lệ và chỗ gọi phải xử lý nó bằng cách TỪ CHỐI, không
 * phải bằng cách đoán một giá trị mặc định.
 *
 * Thứ tự: ảnh trước. Một ảnh nào cũng phải trả kèm kích thước, còn nhánh dưới thì
 * không — nên để nhánh dưới chạy trước sẽ có ngày một định dạng ảnh mới lọt qua đó
 * và mất `width/height` trong im lặng.
 */
export function sniff(bytes: Uint8Array): Sniffed | null {
  if (!bytes.length) return null;
  return pngSize(bytes) ?? jpegSize(bytes) ?? svgSize(bytes) ?? otherFormat(bytes);
}
