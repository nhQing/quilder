import { describe, expect, it } from 'vitest';

import { zDoc, zRepeatSpec } from './schema';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

const OK_SPEC = {
  source: {
    kind: 'query',
    query: {
      typeKey: 'news',
      sort: [{ field: 'publishedAt', dir: 'desc' }],
      limit: 10,
    },
  },
  map: { title: { nodeId: 'card__title', as: 'content' } },
};

describe('zRepeatSpec', () => {
  it('nhận nguồn truy vấn đủ tối thiểu', () => {
    expect(zRepeatSpec.safeParse(OK_SPEC).success).toBe(true);
  });

  it('limit là BẮT BUỘC — không có mặc định vô hạn', () => {
    const s = structuredClone(OK_SPEC) as Record<string, any>;
    delete s.source.query.limit;
    expect(zRepeatSpec.safeParse(s).success).toBe(false);
  });

  it('limit vượt 100 bị từ chối ngay ở schema', () => {
    // Một trang nhỡ tay render 4.000 bài chỉ lộ ra ở production sau bài thứ 500.
    const s = structuredClone(OK_SPEC) as Record<string, any>;
    s.source.query.limit = 500;
    expect(zRepeatSpec.safeParse(s).success).toBe(false);
  });

  it('`as` chỉ nhận field của ContentOverride — không có style, không có cấu trúc', () => {
    const s = structuredClone(OK_SPEC) as Record<string, any>;
    s.map.title.as = 'backgroundColor';
    expect(zRepeatSpec.safeParse(s).success).toBe(false);
  });

  it('nhận cả năm loại nguồn', () => {
    const sources = [
      { kind: 'query', query: { typeKey: 'news', limit: 3 } },
      { kind: 'related', typeKey: 'news', limit: 3 },
      { kind: 'taxonomy', typeKey: 'faq' },
      { kind: 'group-entries', limit: 20 },
      { kind: 'field', path: 'zone' },
    ];
    for (const source of sources) {
      expect(zRepeatSpec.safeParse({ ...OK_SPEC, source }).success).toBe(true);
    }
  });

  it('từ chối loại nguồn lạ', () => {
    expect(zRepeatSpec.safeParse({ ...OK_SPEC, source: { kind: 'sql', q: 'select 1' } }).success).toBe(false);
  });

  it('lọc là union có thẻ, không phải chuỗi', () => {
    const s = structuredClone(OK_SPEC) as Record<string, any>;
    s.source.query.filter = [
      { k: 'field', field: 'pinned', op: 'eq', value: true },
      { k: 'taxonomy', from: 'current-entry' },
      { k: 'excludeCurrent' },
    ];
    expect(zRepeatSpec.safeParse(s).success).toBe(true);

    s.source.query.filter = ['pinned = true'];
    expect(zRepeatSpec.safeParse(s).success).toBe(false);
  });

  it('lọc theo danh mục cố định mà không chọn danh mục nào thì bị từ chối', () => {
    // Không có luật này thì một filter `{from:'fixed'}` rỗng vẫn hợp lệ và lặng lẽ
    // không lọc gì — danh sách trả về mọi bài, và trông như cấu hình đã chạy.
    const s = structuredClone(OK_SPEC) as Record<string, any>;
    s.source.query.filter = [{ k: 'taxonomy', from: 'fixed' }];
    expect(zRepeatSpec.safeParse(s).success).toBe(false);
  });

  it('ba nguồn danh mục đều hợp lệ trong cùng một nhánh thẻ', () => {
    for (const f of [
      { k: 'taxonomy', from: 'fixed', ids: ['t1'] },
      { k: 'taxonomy', from: 'current-entry' },
      { k: 'taxonomy', from: 'url' },
    ]) {
      const s = structuredClone(OK_SPEC) as Record<string, any>;
      s.source.query.filter = [f];
      expect(zRepeatSpec.safeParse(s).success).toBe(true);
    }
  });

  it('sắp theo một field của schema bị từ chối ngay ở schema — Prisma không sắp được theo JSONB', () => {
    const s = structuredClone(OK_SPEC) as Record<string, any>;
    s.source.query.sort = [{ field: 'title', dir: 'asc' }];
    expect(zRepeatSpec.safeParse(s).success).toBe(false);
  });
});

describe('doc có Instance mang repeat', () => {
  const doc: Doc = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: {
        id: 'root', type: 'Section', tag: 'main', parentId: null,
        children: ['inst'], effects: [], style: { base: {} },
      },
      inst: {
        id: 'inst', type: 'Instance', componentId: 'cmp1', overrides: {},
        parentId: 'root', children: [], effects: [], style: { base: {} },
      },
    },
  };

  it('doc CŨ không có repeat vẫn hợp lệ — repeat là optional', () => {
    // `repeat` optional nghĩa là việc thêm nó KHÔNG cần một bước migration nào.
    expect(zDoc.safeParse(doc).success).toBe(true);
  });

  it('doc có repeat hợp lệ', () => {
    const withRepeat = structuredClone(doc) as Record<string, any>;
    withRepeat.nodes.inst.repeat = OK_SPEC;
    expect(zDoc.safeParse(withRepeat).success).toBe(true);
  });

  it('zDoc nhận đúng version hiện tại, không phải một literal gõ tay', () => {
    // Hard-code `1` trong `zDoc` từng làm mọi doc đã migrate bị từ chối ở tầng 1
    // ngay khi schema lên 2 — trước mọi phép kiểm khác, nên câu lỗi không nói gì
    // về nguyên nhân.
    expect(zDoc.safeParse({ ...doc, schemaVersion: CURRENT_SCHEMA_VERSION }).success).toBe(true);
    expect(zDoc.safeParse({ ...doc, schemaVersion: CURRENT_SCHEMA_VERSION - 1 }).success)
      .toBe(false);
  });
});
