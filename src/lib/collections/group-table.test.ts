import { describe, expect, it } from 'vitest';

import type { FieldDef, GroupTable } from './field-def';
import { directGroupRefs, groupClosure, typesUsing } from './group-table';

/** Field `group` tối giản — chỉ những khoá `groupClosure`/`typesUsing` đọc. */
function groupField(groupKey: string): FieldDef {
  return { t: 'group', key: 'g', label: 'G', groupKey };
}

/** Field `blocks` tối giản, cho phép nhiều khoá cùng lúc. */
function blocksField(allowed: string[]): FieldDef {
  return { t: 'blocks', key: 'b', label: 'B', allowed };
}

describe('directGroupRefs', () => {
  it('gom khoá của cả group và blocks trong một danh sách field', () => {
    const refs = directGroupRefs([groupField('a'), blocksField(['b', 'c'])]);
    expect(refs.sort()).toEqual(['a', 'b', 'c']);
  });

  it('field không phải group/blocks không góp khoá nào', () => {
    expect(directGroupRefs([{ t: 'text', key: 't', label: 'T' }])).toEqual([]);
  });
});

describe('groupClosure — bao đóng ngược', () => {
  it('luôn chứa chính khoá đang hỏi, kể cả khi không ai tham chiếu nó', () => {
    const groups: GroupTable = { a: [] };
    expect(groupClosure(groups, 'a')).toEqual(new Set(['a']));
  });

  it('bắt được chuỗi tham chiếu A→B→C: sửa C cũng đổi A và B', () => {
    // a chứa field group -> b; b chứa field group -> c.
    const groups: GroupTable = {
      a: [groupField('b')],
      b: [groupField('c')],
      c: [],
    };
    expect(groupClosure(groups, 'c')).toEqual(new Set(['a', 'b', 'c']));
    // Từ giữa chuỗi: sửa b chỉ ảnh hưởng a và b, không ảnh hưởng c (c không dẫn tới b).
    expect(groupClosure(groups, 'b')).toEqual(new Set(['a', 'b']));
  });

  it('vòng A↔B phải DỪNG, không lặp vô hạn', () => {
    const groups: GroupTable = {
      a: [groupField('b')],
      b: [groupField('a')],
    };
    expect(groupClosure(groups, 'a')).toEqual(new Set(['a', 'b']));
  });

  it('gom qua blocks.allowed với nhiều khoá cùng lúc', () => {
    const groups: GroupTable = {
      a: [blocksField(['x', 'y'])],
      x: [],
      y: [],
      z: [],
    };
    expect(groupClosure(groups, 'x')).toEqual(new Set(['a', 'x']));
    expect(groupClosure(groups, 'z')).toEqual(new Set(['z']));
  });
});

describe('typesUsing', () => {
  const types = [
    { key: 'news', schema: [groupField('cta')] },
    { key: 'faq', schema: [blocksField(['quote', 'cta'])] },
    { key: 'event', schema: [groupField('unrelated')] },
  ];

  it('đếm tham chiếu TRỰC TIẾP khi closure chỉ có đúng một khoá', () => {
    expect(typesUsing(types, new Set(['cta'])).sort()).toEqual(['faq', 'news']);
  });

  it('đếm cả tham chiếu GIÁN TIẾP khi closure đã bao đóng qua groupClosure', () => {
    // "quote" được dùng bởi nhóm "cta" (giả lập): closure của "quote" gồm cả "cta".
    const groups: GroupTable = { cta: [groupField('quote')], quote: [] };
    const closure = groupClosure(groups, 'quote');
    expect(closure).toEqual(new Set(['cta', 'quote']));
    // "news" chỉ tham chiếu "cta" trực tiếp, không tham chiếu "quote" — nhưng vì
    // "cta" nằm trong closure của "quote", sửa "quote" cũng đổi cấu trúc hiệu
    // dụng của "news".
    expect(typesUsing(types, closure).sort()).toEqual(['faq', 'news']);
  });

  it('loại không tham chiếu khoá nào trong closure thì không xuất hiện', () => {
    expect(typesUsing(types, new Set(['unrelated']))).toEqual(['event']);
  });
});
