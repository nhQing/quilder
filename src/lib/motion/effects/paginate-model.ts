/**
 * Phần thuần của effect `paginate` — tách khỏi DOM để test được.
 */

/** Số trang cho `count` mục, mỗi trang `size` mục. Luôn ≥ 1. */
export function pageCount(count: number, size: number): number {
  if (size <= 0) return 1;
  return Math.max(1, Math.ceil(count / size));
}

/**
 * Trang đọc từ URL, kẹp về [1, total]. Chữ lạ, số âm, số thập phân → trang 1;
 * số vượt trần → trang cuối (link cũ sau khi bớt bài vẫn ra nội dung, không ra lưới rỗng).
 */
export function clampPage(raw: string | null | undefined, total: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1 || String(n) !== String(raw ?? '').trim()) return 1;
  return Math.min(n, Math.max(1, total));
}

/** Mục thứ `index` (0-based) có nằm trên trang `page` (1-based) không. */
export function onPage(index: number, page: number, size: number): boolean {
  return index >= (page - 1) * size && index < page * size;
}

export type PageSlot = number | 'gap';

/**
 * Dãy nút số trang: luôn có trang đầu, trang cuối, trang hiện tại ± `siblings`;
 * khoảng trống dài hơn một trang thành `'gap'` (in "…"). Khoảng trống đúng MỘT
 * trang thì in luôn số đó — "1 … 3" tốn chỗ bằng "1 2 3" mà kém rõ hơn.
 */
export function pageList(current: number, total: number, siblings = 1): PageSlot[] {
  const keep = new Set<number>([1, total]);
  for (let p = current - siblings; p <= current + siblings; p++) {
    if (p >= 1 && p <= total) keep.add(p);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: PageSlot[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev === 2) out.push(prev + 1);
    else if (p - prev > 2) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

/** Đường dẫn của trang `page` trên URL hiện tại; trang 1 thì gỡ hẳn tham số. */
export function hrefWithPage(current: string, param: string, page: number): string {
  const url = new URL(current);
  if (page > 1) url.searchParams.set(param, String(page));
  else url.searchParams.delete(param);
  return url.pathname + url.search + url.hash;
}
