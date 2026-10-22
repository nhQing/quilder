/**
 * Một file trong kho thuộc HẠNG nào — và hạng đó hiện ra trên màn hình thế nào.
 *
 * File THUẦN: không prisma, không React, không I/O. Cả trang Thư viện, bộ chọn ảnh
 * và đường tải lên đều đọc bảng này, nên nó phải kiểm được mà không dựng gì.
 *
 * ## Vì sao phân hạng theo MIME, và chỉ dùng đuôi file làm phương án hai
 *
 * `Asset.mime` được đặt bởi `sniff()`, tức là từ NỘI DUNG file, không từ tên người
 * dùng gõ. Đó là giá trị đáng tin. Đuôi trong `Asset.key` chỉ là thứ đi kèm, và nó
 * có thể sai — nhưng với hàng cũ tải lên trước khi có bảng này thì nó là thứ duy
 * nhất còn lại, nên vẫn phải có nhánh đó.
 *
 * ## Vì sao `svg` là hạng RIÊNG, không gộp vào `image`
 *
 * Quyết định cũ, giữ nguyên: `NodeRenderer` phải bỏ qua bộ tối ưu với ảnh vector vì
 * `next/image` rasterise SVG và logo mất nét. Hạng ở đây phải nói được điều đó.
 *
 * ## Vì sao có `previewable`
 *
 * Trang Thư viện vẽ `<img>` cho ảnh và một thẻ có biểu tượng cho mọi thứ khác. Trước
 * bảng này nó vẽ `<img src>` cho MỌI hàng — nên một file PDF hiện ra dưới dạng biểu
 * tượng ảnh lỗi của trình duyệt, kèm dòng `?×?` ở chỗ đáng ra là kích thước. Đó là
 * cách xấu nhất để nói "đây không phải ảnh": nó trông như một ảnh bị hỏng.
 */

export type AssetKind =
  | 'image'
  | 'svg'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'doc'
  | 'font'
  | 'data'
  | 'file';

export interface KindInfo {
  kind: AssetKind;
  /** Nhãn tiếng Việt, hiện dưới tên file. */
  label: string;
  /** Ký tự vẽ trong ô xem trước khi không dựng được bản xem thật. */
  glyph: string;
  /** Có vẽ được bằng `<img>` không. */
  previewable: boolean;
}

const INFO: Record<AssetKind, Omit<KindInfo, 'kind'>> = {
  image: { label: 'Ảnh', glyph: '▣', previewable: true },
  svg: { label: 'Ảnh vector', glyph: '◈', previewable: true },
  video: { label: 'Video', glyph: '▶', previewable: false },
  audio: { label: 'Âm thanh', glyph: '♪', previewable: false },
  pdf: { label: 'PDF', glyph: '▤', previewable: false },
  doc: { label: 'Tài liệu', glyph: '▥', previewable: false },
  font: { label: 'Font', glyph: 'Aa', previewable: false },
  data: { label: 'Dữ liệu', glyph: '⬚', previewable: false },
  file: { label: 'Tệp', glyph: '◻', previewable: false },
};

/** `public/builder/hero-a1b2.png` → `png`. Chuỗi rỗng khi không có đuôi. */
export function extOf(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

const BY_EXT: Record<string, AssetKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', avif: 'image', gif: 'image',
  svg: 'svg',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', xls: 'doc', xlsx: 'doc', ppt: 'doc', pptx: 'doc',
  txt: 'doc', csv: 'doc', md: 'doc', rtf: 'doc',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font',
  json: 'data',
};

/**
 * Hạng của một file. MIME trước, đuôi sau, `file` là đáy.
 *
 * `file` KHÔNG phải lỗi — nó là "có một file ở đây, ta không biết nó là gì, và ta
 * nói thẳng ra thế". Đoán một hạng cụ thể cho nó sẽ làm màn hình khẳng định một
 * điều không ai kiểm được.
 */
export function assetKind(mime: string | null | undefined, key = ''): KindInfo {
  const m = (mime ?? '').toLowerCase();
  let kind: AssetKind | null = null;

  if (m === 'image/svg+xml') kind = 'svg';
  else if (m.startsWith('image/')) kind = 'image';
  else if (m.startsWith('video/')) kind = 'video';
  else if (m.startsWith('audio/')) kind = 'audio';
  else if (m === 'application/pdf') kind = 'pdf';
  else if (m.startsWith('font/') || m === 'application/font-woff') kind = 'font';
  else if (m === 'application/json') kind = 'data';
  else if (m.startsWith('text/') || m.startsWith('application/vnd.')
    || m === 'application/msword') kind = 'doc';

  kind ??= BY_EXT[extOf(key)] ?? 'file';
  return { kind, ...INFO[kind] };
}

/**
 * Giá trị cho cột `Asset.kind`.
 *
 * Cột đó có từ trước bảng này và chỉ nhận `image | video | svg | font | data`; giờ
 * nhận thêm `audio | pdf | doc | file`. Nó là chuỗi tự do trong schema, nên không
 * có migration — nhưng chỗ nào ĐỌC nó thì phải chịu được giá trị mới, và đó là lý
 * do hàm này tồn tại thay vì để mỗi chỗ ghi tự nghĩ ra một chuỗi.
 */
export function dbKind(mime: string, key = ''): AssetKind {
  return assetKind(mime, key).kind;
}

/** Hạng nào dùng được ở một node ảnh. Bộ chọn ảnh lọc theo đúng tập này. */
export const IMAGE_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(['image', 'svg']);

/**
 * `accept` cho `<input type="file">` của trang Thư viện.
 *
 * Phải khớp với những định dạng `sniff()` nhận dạng được. Lệch nhau là hộp chọn file
 * của hệ điều hành cho người dùng chọn một thứ mà server từ chối ngay sau đó — và
 * lỗi 415 hiện ra sau khi họ đã chờ tải xong một file 8 MB.
 *
 * KHÔNG có `.html`: xem lý do trong `otherFormat()` ở `sniff.ts`.
 */
export const UPLOAD_ACCEPT = [
  'image/png', 'image/jpeg', 'image/svg+xml',
  'application/pdf',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
  'font/woff', 'font/woff2',
].join(',');
