import { describe, expect, it } from 'vitest';

import {
  SEARCH_THRESHOLD,
  foldVi,
  pickerGroups,
  selectedNames,
  type PickerTaxonomy,
} from './taxonomy-picker';

const t = (id: string, name: string, parentId: string | null = null): PickerTaxonomy => ({
  id, name, parentId,
});

/** Cây thật của "Bài viết": hai trục, mỗi trục vài mục con. */
const TREE: PickerTaxonomy[] = [
  t('dm', 'Danh mục'),
  t('dm1', 'Tin Tức Thị Trường', 'dm'),
  t('dm2', 'Tin Tức Công Ty', 'dm'),
  t('dm3', 'Đầu Tư', 'dm'),
  t('dm4', 'Money Talk', 'dm'),
  t('the', 'Thẻ'),
  t('the1', 'Sự kiện', 'the'),
  t('the2', 'Sản phẩm', 'the'),
];

describe('foldVi', () => {
  it('bỏ dấu và hạ chữ thường', () => {
    expect(foldVi('Đầu Tư')).toBe('dau tu');
    expect(foldVi('  Sự Kiện ')).toBe('su kien');
  });
});

describe('pickerGroups', () => {
  it('gốc có con thành tiêu đề nhóm, và KHÔNG thành chip', () => {
    const g = pickerGroups(TREE, []);
    expect(g.map((x) => x.label)).toEqual(['Danh mục', 'Thẻ']);
    expect(g.flatMap((x) => x.items.map((i) => i.id))).not.toContain('dm');
    expect(g[0]!.items.map((i) => i.name)).toEqual([
      'Tin Tức Thị Trường', 'Tin Tức Công Ty', 'Đầu Tư', 'Money Talk',
    ]);
  });

  it('danh sách phẳng vẫn phẳng — không mọc tiêu đề giả', () => {
    const flat = [t('a', 'Đầu Tư'), t('b', 'Sự kiện')];
    const g = pickerGroups(flat, []);
    expect(g).toHaveLength(1);
    expect(g[0]!.label).toBeNull();
    expect(g[0]!.items).toHaveLength(2);
  });

  it('nhóm không tiêu đề đứng TRƯỚC các trục', () => {
    const g = pickerGroups([...TREE, t('le', 'Không phân loại')], []);
    expect(g[0]!.label).toBeNull();
    expect(g[0]!.items[0]!.name).toBe('Không phân loại');
  });

  /*
   * Ca này là lý do luật "gốc có con không phải chip" cần một ngoại lệ: người dùng
   * gắn "Đầu Tư" cho vài bài rồi hôm sau thêm mục con dưới nó. Không có ngoại lệ
   * thì chip biến mất mang theo một lựa chọn đang có thật, và không còn đường bỏ.
   */
  it('gốc-có-con vẫn hiện nếu ĐANG được chọn', () => {
    const g = pickerGroups(TREE, ['dm']);
    const danhMuc = g.find((x) => x.label === 'Danh mục')!;
    expect(danhMuc.items[0]).toMatchObject({ id: 'dm', selected: true });
  });

  it('lọc bỏ dấu, và bỏ luôn nhóm không còn mục nào', () => {
    const g = pickerGroups(TREE, [], 'dau tu');
    expect(g).toHaveLength(1);
    expect(g[0]!.label).toBe('Danh mục');
    expect(g[0]!.items.map((i) => i.name)).toEqual(['Đầu Tư']);
  });

  /*
   * Không có luật này thì bấm chọn xong gõ một chữ là lựa chọn biến mất khỏi màn —
   * trông hệt như vừa bị bỏ chọn, và người dùng bấm lại lần nữa để "sửa".
   */
  it('mục đang chọn luôn qua bộ lọc', () => {
    const g = pickerGroups(TREE, ['the1'], 'khong-khop-gi-ca');
    expect(g.flatMap((x) => x.items.map((i) => i.id))).toEqual(['the1']);
  });

  it('không khớp gì và không chọn gì thì trả mảng rỗng', () => {
    expect(pickerGroups(TREE, [], 'zzzz')).toEqual([]);
  });

  it('đánh dấu selected đúng mục', () => {
    const g = pickerGroups(TREE, ['dm3', 'the2']);
    const on = g.flatMap((x) => x.items).filter((i) => i.selected).map((i) => i.id);
    expect(on).toEqual(['dm3', 'the2']);
  });

  it('ngưỡng hiện ô lọc là một con số, không phải cảm tính', () => {
    expect(SEARCH_THRESHOLD).toBeGreaterThan(0);
  });
});

describe('selectedNames', () => {
  it('theo thứ tự trong cây, không theo thứ tự bấm', () => {
    expect(selectedNames(TREE, ['the2', 'dm1'])).toEqual(['Tin Tức Thị Trường', 'Sản phẩm']);
  });

  it('id lạ thì bỏ qua, không ném', () => {
    expect(selectedNames(TREE, ['khong-co'])).toEqual([]);
  });
});
