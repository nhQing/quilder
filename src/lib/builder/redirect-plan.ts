/**
 * Đổi slug một trang thì bảng `Redirect` phải đổi những gì.
 *
 * Hàm THUẦN, không prisma, không `server-only` — đây là chỗ dễ sai nhất của cả
 * tính năng và nó phải test được mà không cần Postgres.
 *
 * ## Ba việc, và việc thứ ba là việc hay bị quên
 *
 *  1. **Thêm** `cũ → mới`.
 *  2. **Gộp chuỗi.** Mọi hàng đang trỏ TỚI slug cũ phải chuyển sang trỏ thẳng tới
 *     slug mới. Đổi `a → b` rồi `b → c` mà không gộp thì trình duyệt đi `a → b → c`,
 *     hai lượt 301: chậm hơn, và Google giảm giá trị link qua mỗi chặng. Đủ vài lần
 *     đổi tên là chuỗi dài tới mức trình duyệt bỏ cuộc.
 *  3. **Xoá hàng có `from` trùng slug MỚI.** Đây là việc hay bị quên, và nó là
 *     việc nguy hiểm nhất: nếu `c` từng là slug cũ của một trang khác và đang
 *     redirect đi chỗ khác, thì sau khi đổi tên, địa chỉ MỚI của trang này lại
 *     chuyển hướng người ta đi mất. Trang lên sóng và không ai vào được nó.
 *
 * ## Vì sao không tạo redirect cho trang chưa publish
 *
 * Không có gì để giữ. Slug cũ chưa từng ở trên internet, chưa ai gửi link, Google
 * chưa từng thấy. Một hàng redirect ở đó chỉ là rác vĩnh viễn — và rác trong bảng
 * định tuyến thì về sau sẽ chặn đúng slug đó khi có người muốn dùng lại nó.
 */

export interface RedirectRow {
  id: string;
  from: string;
  to: string;
}

export interface RedirectPlan {
  /** Hàng cần tạo. Rỗng khi trang chưa từng publish. */
  create: { from: string; to: string }[];
  /** `id` → `to` mới. Gộp chuỗi 301. */
  retarget: { id: string; to: string }[];
  /** `id` cần xoá: chúng đang chiếm chính slug mới. */
  remove: string[];
}

export function planRedirects(args: {
  oldSlug: string;
  newSlug: string;
  /** Trang đã từng nằm trong một `ReleaseEntry` chưa. */
  wasPublished: boolean;
  /** Redirect hiện có của site. */
  existing: RedirectRow[];
}): RedirectPlan {
  const { oldSlug, newSlug, wasPublished, existing } = args;

  const plan: RedirectPlan = { create: [], retarget: [], remove: [] };
  if (oldSlug === newSlug) return plan;

  // (3) Slug mới không được là điểm xuất phát của bất kỳ redirect nào.
  plan.remove = existing.filter((r) => r.from === newSlug).map((r) => r.id);
  const removed = new Set(plan.remove);

  if (!wasPublished) return plan;

  // (2) Gộp chuỗi. Bỏ qua hàng sắp xoá, và bỏ qua hàng sẽ tự trỏ vào mình.
  plan.retarget = existing
    .filter((r) => r.to === oldSlug && !removed.has(r.id) && r.from !== newSlug)
    .map((r) => ({ id: r.id, to: newSlug }));

  /*
   * (1) `from` là khoá duy nhất. Nếu đã có hàng xuất phát từ slug cũ — trang này
   * từng mang slug đó, bị đổi đi, rồi được đổi về — thì đây là cập nhật chứ không
   * phải thêm, nếu không sẽ va khoá duy nhất.
   */
  const clash = existing.find((r) => r.from === oldSlug && !removed.has(r.id));
  if (clash) {
    if (clash.to !== newSlug) plan.retarget.push({ id: clash.id, to: newSlug });
  } else {
    plan.create.push({ from: oldSlug, to: newSlug });
  }

  return plan;
}

/**
 * Đi theo chuỗi redirect tới đích cuối, có chặn vòng lặp.
 *
 * `planRedirects` đã gộp chuỗi ở đường GHI, nên đường ĐỌC gần như luôn tìm thấy
 * đích sau một bước. Hàm này vẫn đi vòng, vì dữ liệu vào được bằng cả tay và
 * script — và một vòng lặp `a → b → a` ở tầng định tuyến là một trang treo, không
 * phải một trang lỗi.
 */
export function followRedirect(from: string, rows: RedirectRow[], maxHops = 5): string | null {
  const byFrom = new Map(rows.map((r) => [r.from, r.to]));
  const seen = new Set<string>([from]);

  let current = from;
  for (let i = 0; i < maxHops; i++) {
    const next = byFrom.get(current);
    if (next === undefined) return current === from ? null : current;
    if (seen.has(next)) return null;
    seen.add(next);
    current = next;
  }
  return null;
}
