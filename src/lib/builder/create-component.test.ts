import { describe, expect, it } from 'vitest';

import { blankTree } from './create-component';
import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';

/**
 * Cây trống của một component mới.
 *
 * `createComponent()` chạm Prisma nên không test được ở đây; `uniqueKey` và
 * `copyName` đã có test riêng ở `preset-key.test.ts`. Còn lại `blankTree()`, và nó
 * đáng test vì cây này đi thẳng vào `Release.components` lúc publish và sống ở đó
 * lâu hơn mọi thứ khác.
 */

describe('blankTree', () => {
  it('đúng một node gốc, không con', () => {
    const tree = blankTree();
    expect(Object.keys(tree.nodes)).toEqual(['p1']);
    expect(tree.rootId).toBe('p1');
    expect(tree.nodes.p1!.children).toEqual([]);
  });

  it('node gốc là Section và là gốc thật', () => {
    const root = blankTree().nodes.p1!;
    expect(root.type).toBe('Section');
    expect(root.parentId).toBeNull();
  });

  it('MANG schemaVersion — cây phải tự mô tả', () => {
    // `Release.components` chụp lại đúng JSON này, và ở đó không có cột nào để
    // tra. Thiếu trường này thì `migratePresetTree` phải đoán, và mọi component
    // tạo mới lạc hậu một bậc ngay khi schema tăng. Xem HANDOFF §3.23.
    expect(blankTree().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('đi qua zNode thật, không phải object viết tay', () => {
    // Nếu `zNode` đổi mà `blankTree` không đổi theo thì phải vỡ Ở ĐÂY, chứ không
    // vỡ ở lần đầu có người chèn component vào trang.
    expect(() => blankTree()).not.toThrow();
    expect(blankTree().nodes.p1).toHaveProperty('style');
  });

  it('mỗi lần gọi ra một object mới, không dùng chung tham chiếu', () => {
    // Dùng chung thì hai component tạo liên tiếp sẽ chia nhau một cây, và sửa cái
    // này đổi cái kia — im lặng, và chỉ lộ ra rất muộn.
    const a = blankTree();
    const b = blankTree();
    expect(a).not.toBe(b);
    expect(a.nodes).not.toBe(b.nodes);
  });
});
