/**
 * Sinh `key` cho component.
 *
 * `key` là định danh ổn định mà `scripts/extract-presets.ts` upsert theo, và nó
 * xuất hiện trong tool AI. Nên nó phải là slug đọc được, không phải cuid.
 *
 * Hàm thuần để test được: đây là chỗ một lỗi tạo ra hai component cùng key và
 * `upsert` sẽ ghi đè cái này bằng cái kia.
 */

/** Bỏ dấu tiếng Việt rồi rút về slug. Rỗng thì trả `component`. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  // Key rỗng sẽ đụng nhau ngay lần thứ hai, và `-1`, `-2` phía dưới sẽ biến nó
  // thành một dãy vô nghĩa. Một tên mặc định đọc được thì tệ ít hơn.
  return base || 'component';
}

/**
 * Key chưa bị dùng, dựa trên `base`.
 *
 * Thêm `-2`, `-3`… chứ không thêm chuỗi ngẫu nhiên: người dùng nhìn danh sách và
 * cần biết cái nào là bản sao của cái nào.
 *
 * Bắt đầu từ 2 vì `-1` gợi ý rằng có một bản `-0` — không có.
 */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  const slug = slugify(base);
  if (!taken.has(slug)) return slug;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${slug}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 998 bản sao cùng tên là dấu hiệu của một vòng lặp, không phải của người dùng.
  throw new Error(`Không sinh được key duy nhất từ "${base}"`);
}

/**
 * Tên cho bản sao.
 *
 * "Header" → "Header (bản sao)" → "Header (bản sao 2)". Chuỗi lồng nhau
 * ("Header (bản sao) (bản sao)") đọc ra vô nghĩa sau lần thứ hai.
 */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  const stem = name.replace(/\s*\(bản sao( \d+)?\)$/, '');
  const first = `${stem} (bản sao)`;
  if (!taken.has(first)) return first;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} (bản sao ${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Không sinh được tên duy nhất từ "${name}"`);
}
