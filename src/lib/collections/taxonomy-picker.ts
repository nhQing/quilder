/**
 * Xếp danh mục thành nhóm để CHỌN, và lọc theo chữ gõ vào.
 *
 * File THUẦN: không prisma, không React. Nó là phần duy nhất của bộ chọn danh mục
 * có luật đáng sai, nên nó phải kiểm được mà không cần dựng một trang.
 *
 * ## Vì sao phải nhóm
 *
 * `Taxonomy` chỉ có MỘT tập cho mỗi loại nội dung — giá trị không nằm trong `data`
 * mà ở bảng nối `EntryTaxonomy`, nên không khai được hai field riêng cho "danh mục"
 * và "thẻ". Trục duy nhất có sẵn là cây `parentId`.
 *
 * Nên quy ước ở đây, và nó là quy ước chứ không phải phát hiện:
 *
 *  - **Gốc CÓ con là một TRỤC.** Tên nó thành tiêu đề nhóm ("Danh mục", "Thẻ"),
 *    các con thành chip. Bản thân gốc KHÔNG phải chip: gắn "Danh mục" cho một bài
 *    là vô nghĩa, và một chip vô nghĩa nằm cạnh chip thật thì có ngày ai đó bấm.
 *  - **Gốc KHÔNG con là một MỤC THẬT.** Chúng gom vào một nhóm không tiêu đề đứng
 *    trước — tức là một danh sách phẳng vẫn phẳng, không mọc ra tiêu đề giả.
 *
 * ## Ngoại lệ: gốc-có-con mà ĐANG được chọn thì vẫn hiện
 *
 * Người dùng có thể gắn "Đầu Tư" cho vài bài rồi hôm sau thêm mục con dưới nó. Luật
 * trên sẽ làm chip đó biến mất, mang theo một lựa chọn đang có thật mà không còn
 * đường bỏ. Nên: đã chọn thì luôn hiện. Không có ngõ cụt.
 */

export interface PickerTaxonomy {
  id: string;
  name: string;
  parentId: string | null;
}

export interface PickerChip {
  id: string;
  name: string;
  selected: boolean;
}

export interface PickerGroup {
  /** `null` = nhóm mục gốc không có con; nó cố ý không có tiêu đề. */
  label: string | null;
  items: PickerChip[];
}

/** Từ bao nhiêu mục thì hiện ô lọc. Dưới ngưỡng, ô lọc chỉ là thêm một thứ để nhìn. */
export const SEARCH_THRESHOLD = 12;

/**
 * Bỏ dấu tiếng Việt và hạ chữ thường, để gõ "dau tu" tìm ra "Đầu Tư".
 *
 * Không có bước này thì ô lọc gần như vô dụng: người gõ nhanh không bỏ dấu, và một
 * ô tìm không ra kết quả tệ hơn không có ô tìm — nó nói "không có mục đó" trong khi
 * mục đó đang nằm ngay dưới.
 */
export function foldVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function pickerGroups(
  all: readonly PickerTaxonomy[],
  selectedIds: readonly string[],
  query = '',
): PickerGroup[] {
  const selected = new Set(selectedIds);
  const childrenOf = new Map<string, PickerTaxonomy[]>();
  for (const t of all) {
    if (!t.parentId) continue;
    const list = childrenOf.get(t.parentId);
    if (list) list.push(t);
    else childrenOf.set(t.parentId, [t]);
  }

  const needle = foldVi(query);
  /*
   * Mục ĐANG CHỌN luôn qua bộ lọc.
   *
   * Ngược lại thì bấm chọn xong gõ một chữ là lựa chọn biến mất khỏi màn hình —
   * trông y hệt như vừa bị bỏ chọn, và người dùng sẽ bấm lại lần nữa để "sửa".
   */
  const keep = (t: PickerTaxonomy) =>
    !needle || selected.has(t.id) || foldVi(t.name).includes(needle);

  const chip = (t: PickerTaxonomy): PickerChip => ({
    id: t.id,
    name: t.name,
    selected: selected.has(t.id),
  });

  const roots = all.filter((t) => !t.parentId);
  const flat = roots.filter((r) => !childrenOf.has(r.id)).filter(keep);
  const groups: PickerGroup[] = [];

  if (flat.length) groups.push({ label: null, items: flat.map(chip) });

  for (const root of roots) {
    const kids = childrenOf.get(root.id);
    if (!kids) continue;
    const items = [
      // Gốc chỉ là chip khi nó đang được chọn — xem "Ngoại lệ" ở đầu file.
      ...(selected.has(root.id) ? [chip(root)] : []),
      ...kids.filter(keep).map(chip),
    ];
    if (items.length) groups.push({ label: root.name, items });
  }

  return groups;
}

/** Tên các mục đang chọn, theo thứ tự hiện trên màn — dòng tóm tắt đọc nó. */
export function selectedNames(
  all: readonly PickerTaxonomy[],
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(selectedIds);
  return all.filter((t) => selected.has(t.id)).map((t) => t.name);
}
