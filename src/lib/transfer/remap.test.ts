import { describe, expect, it } from 'vitest';

import { leftoverIds, remapTranslationValue, remapValue, type IdMaps } from './remap';

const maps: IdMaps = {
  assets: new Map([['src-a1', 'dst-a1'], ['src-a2', 'dst-a2'], ['same', 'same']]),
  components: new Map([['src-c1', 'dst-c1']]),
};

const nodes = {
  img: { type: 'Image', assetId: 'src-a1', alt: 'src-a1 là chữ, không phải id' },
  vid: { type: 'Video', assetId: 'src-a2', posterAssetId: 'src-a1' },
  bg: {
    style: { base: { fill: { image: { assetId: 'src-a2' } } }, states: { hover: { fill: { image: { assetId: 'src-a1' } } } } },
    effects: [{ effect: 'image-sequence', params: { frames: ['src-a1', 'src-a2'], framesNarrow: ['src-a2'] } }],
  },
  inst: {
    type: 'Instance', componentId: 'src-c1',
    overrides: { logo: { assetId: 'src-a2', posterAssetId: null } },
    repeat: { blockComponents: { quote: 'src-c1' } },
  },
};

describe('remapValue', () => {
  const out = remapValue(nodes, maps);

  it('đổi mọi chỗ chứa id ảnh và id component', () => {
    expect(out.img.assetId).toBe('dst-a1');
    expect(out.vid).toMatchObject({ assetId: 'dst-a2', posterAssetId: 'dst-a1' });
    expect(out.bg.style.base.fill.image.assetId).toBe('dst-a2');
    expect(out.bg.style.states.hover.fill.image.assetId).toBe('dst-a1');
    expect(out.bg.effects[0]!.params).toEqual({ frames: ['dst-a1', 'dst-a2'], framesNarrow: ['dst-a2'] });
    expect(out.inst.componentId).toBe('dst-c1');
    expect(out.inst.overrides.logo.assetId).toBe('dst-a2');
    expect(out.inst.repeat.blockComponents.quote).toBe('dst-c1');
  });

  it('KHÔNG đổi chữ trùng id — chỉ đổi theo khoá chứa id', () => {
    expect(out.img.alt).toBe('src-a1 là chữ, không phải id');
  });

  it('không sửa đầu vào', () => {
    expect(nodes.img.assetId).toBe('src-a1');
  });
});

describe('leftoverIds', () => {
  it('sau khi đổi đủ thì không còn id nguồn nào', () => {
    // Quét mù cố ý: nó là lưới cuối, bắt cả chỗ mà phép đổi theo khoá bỏ sót. Vì thế
    // gói `nodes.vid` (không có alt trùng id) — alt trùng id ở `nodes.img` SẼ bị báo.
    expect(leftoverIds(remapValue({ x: nodes.vid }, maps), maps)).toEqual([]);
    expect(leftoverIds({ a: { b: ['ok', 'src-a2'] } }, maps)).toEqual(['a.b.1']);
  });

  it('xuất rồi nhập CÙNG môi trường: id ánh xạ về chính nó không phải id sót', () => {
    expect(leftoverIds({ assetId: 'same' }, maps)).toEqual([]);
  });
});

describe('remapTranslationValue', () => {
  it('chỉ đổi giá trị của field assetId / posterAssetId', () => {
    expect(remapTranslationValue('assetId', 'src-a1', maps)).toBe('dst-a1');
    expect(remapTranslationValue('posterAssetId', 'src-a2', maps)).toBe('dst-a2');
    expect(remapTranslationValue('alt', 'src-a1', maps)).toBe('src-a1');
  });
});
