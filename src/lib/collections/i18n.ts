/**
 * Bản dịch của entry là LỚP PHỦ lên `data`, không phải một bản sao.
 *
 * Cùng cơ chế với model `Translation`: fork theo ngôn ngữ thì thêm một field là
 * phải sửa N chỗ, và hai bên trôi khỏi nhau ngay lần đầu có người quên.
 *
 * Thuần, không `server-only`: form admin (client) cần nó để hiện cột vi/en.
 */

import { hasSeoText, localizeSeo } from './seo';

function overlayFor(i18n: unknown, locale: string): Record<string, unknown> | null {
  if (typeof i18n !== 'object' || i18n === null) return null;
  const at = (i18n as Record<string, unknown>)[locale];
  if (typeof at !== 'object' || at === null) return null;
  return at as Record<string, unknown>;
}

/**
 * Mọi khoá mà một node chữ (`InlineNode`) hoặc một khối (`Block`) có thể mang.
 *
 * Dùng để NHẬN RA một cây chữ giữa những mảng khác trong `data`, không để validate
 * — `zRichText`/`zRichDoc` là chỗ đó. File này chạy trên JSONB thô, trước mọi phép
 * kiểm, và không được kéo validator (cùng cả zod) vào bundle của form admin.
 *
 * Vì sao phải kiểm cả khoá LẠ chứ không chỉ có `t`/`b`: khoá field của một nhóm
 * hợp lệ có thể đúng là `t` hoặc `b` (`zKey` cho phép một chữ cái), nên một mục
 * `{ t: 'a', title: 'Xin chào' }` của nhóm lặp sẽ bị đọc là một inline node nếu chỉ
 * xét `t`. Thấy khoá ngoài danh sách này thì rơi về luật cũ — luật cũ không bao giờ
 * SAI, chỉ lỏng hơn.
 */
const NODE_KEYS = new Set([
  't', 'b', 'v', 'children', 'items', 'href', 'mode', 'to', 'decimals', 'suffix',
  'ref', 'fallback', 'assetId', 'alt', 'decorative', 'caption',
]);

function isTextTree(arr: unknown[]): boolean {
  return arr.every((n) => {
    if (typeof n !== 'object' || n === null || Array.isArray(n)) return false;
    const rec = n as Record<string, unknown>;
    if (typeof rec['t'] !== 'string' && typeof rec['b'] !== 'string') return false;
    return Object.keys(rec).every((k) => NODE_KEYS.has(k));
  });
}

/**
 * Chữ có thật trong một cây `RichText`/`RichDoc`.
 *
 * Chỉ cần biết CÓ hay KHÔNG, nên không định dạng gì: `counter` và `bind` bị bỏ qua
 * (chúng là số/giá trị suy ra, không phải chữ ai đó dịch), còn `alt` thì tính —
 * một khối ảnh đã có alt tiếng Anh là một khối ĐÃ dịch.
 */
function treeText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(treeText).join('');
  if (typeof v !== 'object' || v === null) return '';
  const rec = v as Record<string, unknown>;
  let out = '';
  if (typeof rec['v'] === 'string') out += rec['v'];
  if (typeof rec['alt'] === 'string') out += rec['alt'];
  for (const key of ['children', 'items', 'caption']) {
    if (Array.isArray(rec[key])) out += treeText(rec[key]);
  }
  return out;
}

/**
 * Rỗng nghĩa là CHƯA dịch, không phải "đã dịch thành chuỗi rỗng".
 *
 * ## Vì sao mảng phải được đếm trên CHỮ, không trên số phần tử
 *
 * Giá trị rỗng của một field `richtext` là `[{ t:'text', v:'' }]` và của một field
 * `richdoc` là `[{ b:'p', children:[{ t:'text', v:'' }] }]` (xem `emptyValue` trong
 * `form-state.ts`) — cả hai đều có độ dài 1. Với luật cũ ("có ≥1 phần tử là đã
 * dịch"), mở tab tiếng Anh của một bài rồi lưu mà KHÔNG gõ gì sẽ ghi một lớp phủ
 * toàn giá trị rỗng, và `localeCoverage` báo 100% đã dịch. Con số đó là thứ duy
 * nhất nói cho người biên tập biết còn gì phải dịch.
 *
 * `richdoc` làm việc này bắt buộc chứ không chỉ đáng làm: nó lồng thêm một tầng,
 * nên chuỗi rỗng của nó nằm sâu hơn và luật đếm phần tử càng xa sự thật hơn.
 */
function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) {
    if (v.length === 0) return true;
    // Mảng KHÔNG phải cây chữ (`relation`, `image` nhiều ảnh, `blocks`, nhóm lặp)
    // giữ đúng luật cũ: `['id_1']` là một giá trị thật, và `treeText` của nó rỗng.
    return isTextTree(v) ? treeText(v).trim() === '' : false;
  }
  return false;
}

/**
 * `seoKey` — khoá của field `seo` của loại (`seoKeyOf(fields)`), hoặc `null`. BẮT BUỘC,
 * để trình biên dịch chỉ ra mọi chỗ gọi (21/10/2026).
 *
 * Field `seo` KHÔNG phủ cạn như mọi field khác: phủ cạn nghĩa là bài chưa có lớp phủ
 * tiếng Anh thì `/en` thừa hưởng nguyên SEO tiếng Việt — kể cả canonical trỏ về URL
 * tiếng Việt, tức bảo Google bỏ trang tiếng Anh. Nên khoá đó luôn đi qua `localizeSeo`,
 * CẢ khi không có lớp phủ nào. Chỉ gọi hàm này cho ngôn ngữ KHÔNG mặc định.
 */
export function applyEntryLocale(
  data: Record<string, unknown>,
  i18n: unknown,
  locale: string,
  seoKey: string | null,
): Record<string, unknown> {
  const overlay = overlayFor(i18n, locale);
  const seoHere = seoKey !== null && (seoKey in data || (overlay !== null && seoKey in overlay));
  if (!overlay && !seoHere) return data;

  const out = { ...data };
  for (const [k, v] of Object.entries(overlay ?? {})) {
    if (k === seoKey) continue;
    if (!isBlank(v)) out[k] = v;
  }
  if (seoHere) out[seoKey] = localizeSeo(data[seoKey], overlay?.[seoKey]);
  return out;
}

/**
 * Field `seo` đếm bằng `hasSeoText`: chỉ ô CHỮ dịch được. Bài chỉ có `noindex` hay ảnh
 * OG mà đếm vào mẫu số thì độ phủ không bao giờ tới 100%, vì không có gì để dịch.
 */
export function localeCoverage(
  data: Record<string, unknown>,
  i18n: unknown,
  locale: string,
  seoKey: string | null,
): { translated: number; total: number } {
  const filled = (k: string, v: unknown) => (k === seoKey ? hasSeoText(v) : !isBlank(v));
  const total = Object.entries(data).filter(([k, v]) => filled(k, v)).length;
  const overlay = overlayFor(i18n, locale);
  if (!overlay) return { translated: 0, total };

  const translated = Object.entries(overlay).filter(
    ([k, v]) => k in data && filled(k, v) && (k !== seoKey || hasSeoText(data[k])),
  ).length;
  return { translated, total };
}
