import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import type { RepeatSpec } from '@/lib/doc/types';
import { itemOverrides, type RepeatItem } from './repeat';
import {
  expandRelations,
  isRelationRef,
  relationIds,
  toRelationRef,
  type RelationRef,
} from './relation-expand';

const REL_ONE: Extract<FieldDef, { t: 'relation' }> = {
  t: 'relation', key: 'chuyen_de', label: 'Chuyên đề', typeKey: 'chuyen-de', cardinality: 'one',
};
const REL_MANY: Extract<FieldDef, { t: 'relation' }> = {
  t: 'relation', key: 'lien_quan', label: 'Liên quan', typeKey: 'news', cardinality: 'many',
};

const TARGET_SHAPE = {
  titleField: 'ten',
  fields: [
    { t: 'text', key: 'ten', label: 'Tên' },
    { t: 'image', key: 'anh', label: 'Ảnh' },
  ] as FieldDef[],
};

describe('relationIds', () => {
  it('nhận cả chuỗi lẻ và mảng, bất kể cardinality khai gì', () => {
    // Một field vừa đổi từ `one` sang `many` để lại hàng cũ mang hình dạng cũ trong
    // JSONB. Ném ở đó nghĩa là một lần sửa schema làm trắng cả trang danh sách.
    expect(relationIds('e1')).toEqual(['e1']);
    expect(relationIds(['e1', 'e2'])).toEqual(['e1', 'e2']);
  });

  it('bỏ rác thay vì ném', () => {
    expect(relationIds(['e1', 3, null, ''])).toEqual(['e1']);
    expect(relationIds(undefined)).toEqual([]);
    expect(relationIds({ id: 'e1' })).toEqual([]);
  });
});

describe('toRelationRef', () => {
  const target = {
    id: 'c1',
    slug: 'lai-suat',
    typeKey: 'chuyen-de',
    data: { ten: 'Lãi suất', anh: { assetId: 'a7', alt: 'Biểu đồ' } },
  };

  it('lấy tiêu đề qua titleField của LOẠI ĐÍCH, không phải loại đang lặp', () => {
    const ref = toRelationRef(target, TARGET_SHAPE, '/chuyen-de');
    expect(ref.title).toBe('Lãi suất');
  });

  it('href dựng sẵn từ gốc của loại đích', () => {
    // Ghép lúc render sẽ dùng gốc của loại ĐANG LẶP — `/blogs/post/lai-suat`, một
    // URL 404 chỉ lộ ra khi có người bấm.
    expect(toRelationRef(target, TARGET_SHAPE, '/chuyen-de').href).toBe('/chuyen-de/lai-suat');
    expect(toRelationRef(target, TARGET_SHAPE, '/chuyen-de/').href).toBe('/chuyen-de/lai-suat');
  });

  it('loại đích KHÔNG có trang chi tiết thì không có href, không phải href rỗng', () => {
    expect(toRelationRef(target, TARGET_SHAPE, null).href).toBeUndefined();
  });

  it('ảnh đầu tiên đi kèm, và alt rơi về tiêu đề khi ảnh chưa có alt', () => {
    const noAlt = { ...target, data: { ten: 'Lãi suất', anh: { assetId: 'a7' } } };
    const ref = toRelationRef(noAlt, TARGET_SHAPE, null);
    expect(ref.assetId).toBe('a7');
    expect(ref.alt).toBe('Lãi suất');
  });

  it('không biết cấu trúc loại đích thì vẫn trả một ref hợp lệ, chỉ thiếu tiêu đề', () => {
    const ref = toRelationRef(target, null, '/chuyen-de');
    expect(ref.__rel).toBe(true);
    expect(ref.id).toBe('c1');
    expect(ref.title).toBeUndefined();
    expect(ref.href).toBe('/chuyen-de/lai-suat');
  });
});

describe('expandRelations', () => {
  const ref = (id: string, title: string): RelationRef => ({ __rel: true, id, title });

  it('one: ID trần thành một ref', () => {
    const out = expandRelations({ chuyen_de: 'c1' }, [REL_ONE], new Map([['c1', ref('c1', 'Lãi suất')]]));
    expect(isRelationRef(out.chuyen_de)).toBe(true);
  });

  it('many: mảng ID thành mảng ref, GIỮ thứ tự người biên tập đã chọn', () => {
    const map = new Map([['e1', ref('e1', 'Một')], ['e2', ref('e2', 'Hai')]]);
    const out = expandRelations({ lien_quan: ['e2', 'e1'] }, [REL_MANY], map);
    expect((out.lien_quan as RelationRef[]).map((r) => r.title)).toEqual(['Hai', 'Một']);
  });

  it('đích không tra được thì GỠ HẲN field, không để lại mảng rỗng', () => {
    // `itemOverrides` bỏ qua `undefined` và giữ chữ gốc của component — trông có chủ
    // đích hơn một thẻ trắng.
    const out = expandRelations({ chuyen_de: 'da-xoa' }, [REL_ONE], new Map());
    expect('chuyen_de' in out).toBe(false);
  });

  it('không có field relation nào thì trả CHÍNH object cũ, không clone', () => {
    // `data` đến thẳng từ JSONB; clone nó cho mỗi bài là một phép sao vô ích nhân
    // với số thẻ trên trang.
    const data = { title: 'A' };
    expect(expandRelations(data, [], new Map())).toBe(data);
  });

  it('không đụng field khác', () => {
    const map = new Map([['c1', ref('c1', 'Lãi suất')]]);
    const out = expandRelations({ title: 'Bài', chuyen_de: 'c1' }, [REL_ONE], map);
    expect(out.title).toBe('Bài');
  });
});

describe('itemOverrides với quan hệ đã nở', () => {
  const spec = (key: string, as: 'content' | 'href' | 'assetId'): RepeatSpec => ({
    source: { kind: 'query', query: { typeKey: 'news', limit: 10 } },
    map: { [key]: { nodeId: 'n', as } },
  });
  const item = (data: Record<string, unknown>): RepeatItem => ({ key: 'e1', data });

  const FULL: RelationRef = {
    __rel: true, id: 'c1', title: 'Lãi suất', href: '/chuyen-de/lai-suat', assetId: 'a7', alt: 'Biểu đồ',
  };

  it('one → content lấy tiêu đề, KHÔNG in cuid', () => {
    const o = itemOverrides(item({ chuyen_de: FULL }), spec('chuyen_de', 'content'), {});
    expect(o.n?.content).toEqual([{ t: 'text', v: 'Lãi suất' }]);
  });

  it('one → href lấy đường dẫn đã dựng sẵn', () => {
    const o = itemOverrides(item({ chuyen_de: FULL }), spec('chuyen_de', 'href'), {});
    expect(o.n?.href).toBe('/chuyen-de/lai-suat');
  });

  it('one → assetId lấy ảnh của bản ghi đích, kèm alt', () => {
    const o = itemOverrides(item({ chuyen_de: FULL }), spec('chuyen_de', 'assetId'), {});
    expect(o.n?.assetId).toBe('a7');
    expect(o.n?.alt).toBe('Biểu đồ');
  });

  it('many → content nối tiêu đề; href và assetId lấy cái ĐẦU', () => {
    const two = [FULL, { __rel: true as const, id: 'c2', title: 'Tiết kiệm', href: '/chuyen-de/tiet-kiem' }];
    expect(itemOverrides(item({ r: two }), spec('r', 'content'), {}).n?.content).toEqual([
      { t: 'text', v: 'Lãi suất, Tiết kiệm' },
    ]);
    expect(itemOverrides(item({ r: two }), spec('r', 'href'), {}).n?.href).toBe('/chuyen-de/lai-suat');
  });

  it('bản ghi đích CHƯA đặt tiêu đề thì không override — và tuyệt đối không in cuid', () => {
    // Ca này là lý do `isRelation` được kiểm riêng thay vì dựa vào `fromRelation`
    // trả undefined rồi rơi về giá trị thô.
    const bare: RelationRef = { __rel: true, id: 'cmtsi59im0060s601ddexomx9' };
    const o = itemOverrides(item({ chuyen_de: bare }), spec('chuyen_de', 'content'), {});
    expect(o.n).toBeUndefined();
  });

  it('bản ghi đích không có ảnh thì thẻ giữ ảnh mẫu của component', () => {
    const noImg: RelationRef = { __rel: true, id: 'c1', title: 'Lãi suất' };
    expect(itemOverrides(item({ chuyen_de: noImg }), spec('chuyen_de', 'assetId'), {}).n).toBeUndefined();
  });
});
