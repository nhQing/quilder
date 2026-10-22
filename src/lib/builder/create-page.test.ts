import { describe, expect, it } from 'vitest';

import { blankDoc, toSlug, validateNewPage } from './create-page';

/**
 * Phần THUẦN của việc tạo trang, tách ra để test được không cần DB.
 *
 * `createPage()` chạm Prisma nên nó không test được ở đây — `vitest.config.ts` chỉ
 * include `src/**` và không có Postgres. Nhưng mọi quyết định "nhận hay từ chối"
 * thì thuần, và đó là phần dễ sai.
 *
 * Các kỳ vọng dưới đây khớp với hành vi ĐANG CHẠY của `POST /api/pages`, không
 * phải với hành vi tôi cho là đẹp hơn. Task này là rút logic ra dùng chung, không
 * phải sửa nó — route đang chạy phụ thuộc vào từng chi tiết ở đây.
 */

describe('toSlug', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(toSlug('Giới thiệu')).toBe('gioi-thieu');
  });

  it('đổi đ và Đ thành d', () => {
    expect(toSlug('Đầu tư')).toBe('dau-tu');
  });

  it('gộp khoảng trắng và ký tự lạ thành một gạch nối', () => {
    expect(toSlug('Về  chúng — tôi!')).toBe('ve-chung-toi');
  });

  it('không để gạch nối ở đầu hoặc cuối', () => {
    expect(toSlug('  Xin chào  ')).toBe('xin-chao');
  });

  it('chuỗi không còn ký tự nào thì trả RỖNG, không trả gạch nối', () => {
    // Rỗng là tín hiệu để chỗ gọi bắt người dùng nhập tay. Trả "-" thì trang được
    // tạo với đường dẫn "/-", và không ai phát hiện cho tới khi mở nó.
    expect(toSlug('!!!')).toBe('');
  });

  it('cắt ở 80 ký tự', () => {
    // Giới hạn có thật trong code đang chạy. Slug dài hơn là một URL không ai gõ
    // được và một hàng database khó đọc.
    expect(toSlug('a'.repeat(200))).toHaveLength(80);
  });
});

describe('validateNewPage', () => {
  it('thiếu tiêu đề thì từ chối', () => {
    expect(validateNewPage({ title: '   ' })).toEqual({
      ok: false,
      status: 400,
      error: 'Thiếu tiêu đề',
    });
  });

  it('tiêu đề không tạo được slug thì nói rõ phải làm gì', () => {
    const r = validateNewPage({ title: '???' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nhập đường dẫn/i);
  });

  it('slug truyền tay được chuẩn hoá, không dùng nguyên', () => {
    const r = validateNewPage({ title: 'Trang A', slug: 'Về Chúng Tôi' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slug).toBe('ve-chung-toi');
  });

  it('slug rỗng truyền tay KHÁC slug không truyền', () => {
    // `slug: ''` là "tôi muốn trang chủ" — hợp lệ. `slug: undefined` là "suy từ
    // tiêu đề". Gộp hai thứ đó lại là làm trang chủ không tạo được.
    expect(validateNewPage({ title: 'Trang chủ', slug: '' })).toEqual({
      ok: true,
      title: 'Trang chủ',
      slug: '',
    });
  });

  it('cắt khoảng trắng quanh tiêu đề', () => {
    const r = validateNewPage({ title: '  Giới thiệu  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.title).toBe('Giới thiệu');
  });
});

describe('blankDoc', () => {
  it('đúng một node gốc, không có nội dung mẫu', () => {
    // Nội dung mẫu thì nửa số trang sẽ đi vào production kèm chữ "Lorem" — xem
    // docblock của route.
    const doc = blankDoc();
    expect(Object.keys(doc.nodes)).toEqual(['root']);
    expect(doc.rootId).toBe('root');
  });

  it('node gốc là Section thẻ main, và là gốc thật', () => {
    const root = blankDoc().nodes.root!;
    expect(root.type).toBe('Section');
    expect(root.parentId).toBeNull();
  });

  it('mang schemaVersion hiện tại', () => {
    // Thiếu thì `migrateDoc` ném ngay lần đọc đầu tiên.
    expect(blankDoc().schemaVersion).toBeGreaterThanOrEqual(1);
  });
});
