import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { CLONE_TOOLS } from './clone-tools';

/**
 * Lược đồ của `create_clone_draft`: những thứ phải bị chặn TRƯỚC khi có lượt đọc DB nào.
 */
const tool = CLONE_TOOLS.find((t) => t.name === 'create_clone_draft')!;
const parse = (v: unknown) => (tool.input as { safeParse: (x: unknown) => { success: boolean } }).safeParse(v);

const valid = {
  url: 'https://nguon.test/',
  title: 'T',
  slug: 'clone-t',
  folder: 'clone/t',
  doc: { rootId: 'root', nodes: { root: { id: 'root', type: 'Stack' } } },
};

describe('create_clone_draft', () => {
  it('là tool GHI, và tên không đụng luật cấm publish/rollback/release/delete', () => {
    expect(tool.readOnly).toBe(false);
    expect(tool.name).not.toMatch(/publish|rollback|release|delete/i);
  });

  it('nhận input tối thiểu hợp lệ', () => {
    expect(parse(valid).success).toBe(true);
  });

  it('folder là BẮT BUỘC và không được rỗng', () => {
    const { folder: _f, ...noFolder } = valid;
    expect(parse(noFolder).success).toBe(false);
    expect(parse({ ...valid, folder: '' }).success).toBe(false);
  });

  it('slug bắt buộc (không có đường tạo trang chủ) và khoá lạ bị từ chối', () => {
    expect(parse({ ...valid, slug: '' }).success).toBe(false);
    expect(parse({ ...valid, publish: true }).success).toBe(false);
  });

  it('mô tả bảo KHÔNG gọi tay và nhắc không publish/không ghi đè', () => {
    expect(tool.description).toMatch(/KHÔNG GỌI TAY/);
    expect(tool.description).toMatch(/không publish/);
    expect(tool.description).toMatch(/không bao giờ ghi đè/);
    expect(tool.description).toMatch(/report/);
  });
});
