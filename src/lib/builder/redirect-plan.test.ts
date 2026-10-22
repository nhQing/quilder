import { describe, expect, it } from 'vitest';

import { followRedirect, planRedirects, type RedirectRow } from './redirect-plan';

const R = (id: string, from: string, to: string): RedirectRow => ({ id, from, to });

describe('planRedirects', () => {
  it('trang chưa publish thì không tạo gì — slug cũ chưa từng ở trên internet', () => {
    const plan = planRedirects({
      oldSlug: 'sai-chinh-ta', newSlug: 'dung-roi', wasPublished: false, existing: [],
    });
    expect(plan.create).toEqual([]);
    expect(plan.retarget).toEqual([]);
  });

  it('trang đã publish thì tạo cũ → mới', () => {
    const plan = planRedirects({
      oldSlug: 'tin-tuc', newSlug: 'bai-viet', wasPublished: true, existing: [],
    });
    expect(plan.create).toEqual([{ from: 'tin-tuc', to: 'bai-viet' }]);
  });

  it('đổi tên lần hai gộp chuỗi thay vì nối dài nó', () => {
    // a → b đã có; giờ đổi b thành c. Kết quả phải là a → c và b → c.
    const plan = planRedirects({
      oldSlug: 'b', newSlug: 'c', wasPublished: true, existing: [R('1', 'a', 'b')],
    });
    expect(plan.retarget).toEqual([{ id: '1', to: 'c' }]);
    expect(plan.create).toEqual([{ from: 'b', to: 'c' }]);
  });

  /*
   * Ca nguy hiểm nhất: slug mới đang là điểm xuất phát của một redirect cũ. Không
   * xoá thì trang vừa đổi tên xong sẽ tự chuyển hướng người ta đi mất.
   */
  it('xoá redirect đang chiếm chính slug mới', () => {
    const plan = planRedirects({
      oldSlug: 'x', newSlug: 'gioi-thieu', wasPublished: true,
      existing: [R('9', 'gioi-thieu', 've-chung-toi')],
    });
    expect(plan.remove).toEqual(['9']);
    expect(plan.create).toEqual([{ from: 'x', to: 'gioi-thieu' }]);
  });

  it('xoá cả khi trang chưa publish — hàng rác vẫn chặn địa chỉ mới', () => {
    const plan = planRedirects({
      oldSlug: 'x', newSlug: 'y', wasPublished: false, existing: [R('9', 'y', 'z')],
    });
    expect(plan.remove).toEqual(['9']);
    expect(plan.create).toEqual([]);
  });

  it('đổi về đúng slug cũ của chính mình thì cập nhật, không tạo hàng va khoá', () => {
    // Trang từng là 'a', đổi sang 'b' (sinh a → b), giờ đổi 'b' về 'a'.
    // 'a' là slug MỚI, nên hàng a → b phải bị xoá chứ không được để lại.
    const plan = planRedirects({
      oldSlug: 'b', newSlug: 'a', wasPublished: true, existing: [R('1', 'a', 'b')],
    });
    expect(plan.remove).toEqual(['1']);
    expect(plan.create).toEqual([{ from: 'b', to: 'a' }]);
    expect(plan.retarget).toEqual([]);
  });

  it('không đổi gì khi slug không đổi', () => {
    const plan = planRedirects({
      oldSlug: 'a', newSlug: 'a', wasPublished: true, existing: [R('1', 'z', 'a')],
    });
    expect(plan).toEqual({ create: [], retarget: [], remove: [] });
  });

  it('trang chủ (slug rỗng) cũng đổi được như mọi trang khác', () => {
    const plan = planRedirects({
      oldSlug: '', newSlug: 'trang-chu', wasPublished: true, existing: [],
    });
    expect(plan.create).toEqual([{ from: '', to: 'trang-chu' }]);
  });
});

describe('followRedirect', () => {
  it('null khi không có hàng nào — bên gọi hiểu là 404 thật', () => {
    expect(followRedirect('a', [])).toBeNull();
  });

  it('một bước', () => {
    expect(followRedirect('a', [R('1', 'a', 'b')])).toBe('b');
  });

  it('đi hết chuỗi nếu dữ liệu chưa được gộp', () => {
    expect(followRedirect('a', [R('1', 'a', 'b'), R('2', 'b', 'c')])).toBe('c');
  });

  it('vòng lặp trả null thay vì treo', () => {
    expect(followRedirect('a', [R('1', 'a', 'b'), R('2', 'b', 'a')])).toBeNull();
  });

  it('chuỗi dài quá giới hạn cũng trả null', () => {
    const rows = Array.from({ length: 9 }, (_, i) => R(String(i), `s${i}`, `s${i + 1}`));
    expect(followRedirect('s0', rows)).toBeNull();
  });
});
