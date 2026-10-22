import { describe, expect, it } from 'vitest';

/**
 * Phủ bản dịch lên doc.
 *
 * Ba tính chất chịu lực:
 *
 *  1. **KHÔNG sửa doc gốc.** Doc đến từ `unstable_cache` và nhiều request dùng
 *     chung. Ghi vào nó nghĩa là bản tiếng Anh rò rỉ sang request tiếng Việt kế
 *     tiếp — lỗi chỉ xuất hiện dưới tải và gần như không tái hiện nổi.
 *  2. **Thiếu bản dịch thì giữ bản gốc**, không bao giờ ra chuỗi rỗng.
 *  3. **Dữ liệu rác không làm sập trang**: bản dịch mồ côi, sai kiểu, sai node
 *     type đều bị bỏ qua im lặng.
 */

import type { Doc, Node } from '@/lib/doc/types';
import { applyTranslations, entriesFromSnapshot, snapshotKey } from './translations';

const base = { parentId: null, children: [] as string[], style: {}, effects: [] };

function doc(): Doc {
  // Fixture đi qua `unknown`: `direction` và `fit` là `Responsive<…>` trong
  // schema thật, và viết đủ dạng đó cho mỗi node chỉ làm test khó đọc mà không
  // kiểm thêm tính chất nào — phủ bản dịch không đọc hai trường đó.
  const nodes: Record<string, Node> = {
    root: { ...base, id: 'root', type: 'Section', tag: 'main', children: ['t', 'b', 'i', 'x'] },
    t: { ...base, id: 't', parentId: 'root', type: 'Text', tag: 'h1', content: [{ t: 'text', v: 'Tiêu đề' }] },
    b: { ...base, id: 'b', parentId: 'root', type: 'Button', label: [{ t: 'text', v: 'Bấm' }], variant: 'primary', action: { kind: 'none' } },
    i: { ...base, id: 'i', parentId: 'root', type: 'Image', alt: 'Ảnh', assetId: null, fit: { base: 'cover' } },
    x: { ...base, id: 'x', parentId: 'root', type: 'Stack', direction: { base: 'row' }, a11y: { role: 'list', label: 'Danh sách' } },
  } as unknown as Record<string, Node>;
  return { rootId: 'root', nodes, schemaVer: 1 } as unknown as Doc;
}

const text = (d: Doc, id: string) =>
  ((d.nodes[id] as { content?: { v: string }[] }).content ?? [])[0]?.v;

describe('applyTranslations', () => {
  it('thay content, label, alt và a11y label', () => {
    const d = doc();
    const out = applyTranslations(d, [
      { nodeId: 't', field: 'content', value: [{ t: 'text', v: 'Headline' }] },
      { nodeId: 'b', field: 'label', value: [{ t: 'text', v: 'Click' }] },
      { nodeId: 'i', field: 'alt', value: 'Photo' },
      { nodeId: 'x', field: 'a11yLabel', value: 'List' },
    ]);

    expect(text(out, 't')).toBe('Headline');
    expect((out.nodes.b as { label: { v: string }[] }).label[0]!.v).toBe('Click');
    expect((out.nodes.i as { alt: string }).alt).toBe('Photo');
    expect((out.nodes.x as { a11y: { label: string } }).a11y.label).toBe('List');
  });

  it('KHÔNG sửa doc gốc', () => {
    const d = doc();
    applyTranslations(d, [{ nodeId: 't', field: 'content', value: [{ t: 'text', v: 'Headline' }] }]);
    expect(text(d, 't')).toBe('Tiêu đề');
  });

  it('KHÔNG sửa object a11y lồng của doc gốc', () => {
    // Chỗ dễ quên nhất: `node.a11y.label = x` sửa được cả doc gốc dù node đã
    // được nhân bản nông, vì bản sao nông chia sẻ chính object a11y đó.
    const d = doc();
    applyTranslations(d, [{ nodeId: 'x', field: 'a11yLabel', value: 'List' }]);
    expect((d.nodes.x as { a11y: { label: string } }).a11y.label).toBe('Danh sách');
  });

  it('giữ các trường khác của a11y', () => {
    const out = applyTranslations(doc(), [{ nodeId: 'x', field: 'a11yLabel', value: 'List' }]);
    expect((out.nodes.x as { a11y: { role?: string } }).a11y.role).toBe('list');
  });

  it('không có bản dịch thì trả về ĐÚNG object cũ', () => {
    // Không chỉ "giống": trả về cùng reference giữ nguyên lợi ích của cache.
    const d = doc();
    expect(applyTranslations(d, [])).toBe(d);
  });

  it('node không bị dịch thì giữ nguyên reference', () => {
    const d = doc();
    const out = applyTranslations(d, [{ nodeId: 't', field: 'content', value: [{ t: 'text', v: 'X' }] }]);
    expect(out.nodes.b).toBe(d.nodes.b);
    expect(out.nodes.t).not.toBe(d.nodes.t);
  });

  it('chỉ dịch một phần thì phần còn lại giữ bản gốc', () => {
    const out = applyTranslations(doc(), [
      { nodeId: 't', field: 'content', value: [{ t: 'text', v: 'Headline' }] },
    ]);
    expect((out.nodes.b as { label: { v: string }[] }).label[0]!.v).toBe('Bấm');
  });
});

describe('applyTranslations — ảnh, video và đường dẫn', () => {
  const media = (): Doc => {
    const nodes: Record<string, Node> = {
      root: { ...base, id: 'root', type: 'Section', tag: 'main', children: ['i', 'v', 'b'] },
      i: { ...base, id: 'i', parentId: 'root', type: 'Image', alt: 'Ảnh', assetId: 'anh-vi', fit: { base: 'cover' } },
      v: { ...base, id: 'v', parentId: 'root', type: 'Video', assetId: 'vid-vi', posterAssetId: 'poster-vi' },
      b: { ...base, id: 'b', parentId: 'root', type: 'Button', label: [{ t: 'text', v: 'EN' }], variant: 'ghost', action: { kind: 'link', href: '/en/trang-chu' } },
    } as unknown as Record<string, Node>;
    return { rootId: 'root', nodes, schemaVer: 1 } as unknown as Doc;
  };

  it('ảnh khác nhau theo ngôn ngữ', () => {
    // Ảnh hero hay có chữ in lên nó, nên một tấm ảnh cho hai ngôn ngữ là chữ
    // tiếng Việt nằm trên trang tiếng Anh.
    const d = applyTranslations(media(), [{ nodeId: 'i', field: 'assetId', value: 'anh-en' }]);
    expect((d.nodes.i as { assetId: string }).assetId).toBe('anh-en');
  });

  it('video và ảnh chờ là HAI đơn vị rời nhau', () => {
    const d = applyTranslations(media(), [
      { nodeId: 'v', field: 'posterAssetId', value: 'poster-en' },
    ]);
    expect((d.nodes.v as { posterAssetId: string }).posterAssetId).toBe('poster-en');
    // Đổi ảnh chờ KHÔNG được đổi file video: dùng chung một khoá thì mỗi lần dịch
    // ảnh chờ là một lần mất video.
    expect((d.nodes.v as { assetId: string }).assetId).toBe('vid-vi');
  });

  it('href dịch được — đây là nút đổi ngôn ngữ trên site', () => {
    const d = applyTranslations(media(), [{ nodeId: 'b', field: 'href', value: '/trang-chu' }]);
    expect((d.nodes.b as { action: { href: string; kind: string } }).action).toEqual({
      kind: 'link',
      href: '/trang-chu',
    });
  });

  it('assetId nhận null — bản dịch này dùng lại ảnh của bản gốc', () => {
    const d = applyTranslations(media(), [{ nodeId: 'i', field: 'assetId', value: null }]);
    expect((d.nodes.i as { assetId: string | null }).assetId).toBeNull();
  });

  it('assetId là chuỗi RỖNG thì bị bỏ qua, không ghi ra ảnh rỗng', () => {
    const d = applyTranslations(media(), [{ nodeId: 'i', field: 'assetId', value: '' }]);
    expect((d.nodes.i as { assetId: string }).assetId).toBe('anh-vi');
  });

  it('href trên action KHÔNG phải link thì bị bỏ qua', () => {
    const d = media();
    (d.nodes.b as unknown as { action: unknown }).action = { kind: 'submit', formId: 'f1' };
    const out = applyTranslations(d, [{ nodeId: 'b', field: 'href', value: '/x' }]);
    expect((out.nodes.b as { action: { kind: string } }).action.kind).toBe('submit');
  });
});

describe('dữ liệu rác không làm sập trang', () => {
  it('bản dịch mồ côi — node đã bị xoá', () => {
    const d = doc();
    expect(() =>
      applyTranslations(d, [{ nodeId: 'khong-con', field: 'content', value: [{ t: 'text', v: 'X' }] }]),
    ).not.toThrow();
  });

  it('sai kiểu: chuỗi cho content, mảng cho alt', () => {
    const out = applyTranslations(doc(), [
      { nodeId: 't', field: 'content', value: 'chuỗi trần' },
      { nodeId: 'i', field: 'alt', value: [{ t: 'text', v: 'x' }] },
    ]);
    // Cả hai bị bỏ, bản gốc còn nguyên.
    expect(text(out, 't')).toBe('Tiêu đề');
    expect((out.nodes.i as { alt: string }).alt).toBe('Ảnh');
  });

  it('field không khớp node type', () => {
    // Bản dịch `label` trỏ vào một node Text: node đã đổi type sau khi dịch.
    const out = applyTranslations(doc(), [
      { nodeId: 't', field: 'label', value: [{ t: 'text', v: 'X' }] },
    ]);
    expect(text(out, 't')).toBe('Tiêu đề');
  });

  it('null và undefined', () => {
    expect(() =>
      applyTranslations(doc(), [
        { nodeId: 't', field: 'content', value: null },
        { nodeId: 'i', field: 'alt', value: undefined },
      ]),
    ).not.toThrow();
  });
});

describe('entriesFromSnapshot', () => {
  const snap = {
    [snapshotKey('en', 't', 'content')]: [{ t: 'text', v: 'Headline' }],
    [snapshotKey('en', 'i', 'alt')]: 'Photo',
    [snapshotKey('fr', 't', 'content')]: [{ t: 'text', v: 'Titre' }],
  };

  it('chỉ lấy đúng ngôn ngữ được hỏi', () => {
    const en = entriesFromSnapshot(snap, 'en');
    expect(en).toHaveLength(2);
    expect(en.map((e) => e.nodeId).sort()).toEqual(['i', 't']);
  });

  it('ngôn ngữ không có trong ảnh chụp thì trả rỗng', () => {
    expect(entriesFromSnapshot(snap, 'de')).toEqual([]);
  });

  it('tiền tố phải khớp TRỌN, không phải khớp đầu chuỗi', () => {
    // 'en' không được bắt 'eng': hai ngôn ngữ khác nhau.
    const s = { [snapshotKey('eng', 't', 'content')]: [{ t: 'text', v: 'X' }] };
    expect(entriesFromSnapshot(s, 'en')).toEqual([]);
  });

  it('ảnh chụp rỗng, null hoặc sai kiểu đều trả rỗng', () => {
    expect(entriesFromSnapshot(null, 'en')).toEqual([]);
    expect(entriesFromSnapshot(undefined, 'en')).toEqual([]);
    expect(entriesFromSnapshot([], 'en')).toEqual([]);
    expect(entriesFromSnapshot('x', 'en')).toEqual([]);
  });

  it('khoá hỏng bị bỏ, không ném', () => {
    expect(entriesFromSnapshot({ 'en:': 'x', en: 'y' }, 'en')).toEqual([]);
  });

  it('vòng tròn: ảnh chụp → entries → phủ được', () => {
    const out = applyTranslations(doc(), entriesFromSnapshot(snap, 'en'));
    expect(text(out, 't')).toBe('Headline');
    expect((out.nodes.i as { alt: string }).alt).toBe('Photo');
  });
});

/* ── Bản dịch cho chữ nằm trong instance ──────────────────────────────── */

describe('applyTranslations — địa chỉ instance', () => {
  const withInstance = (overrides: Record<string, unknown> = {}): Doc => {
    const nodes: Record<string, Node> = {
      root: { ...base, id: 'root', type: 'Section', tag: 'main', children: ['i1'] },
      i1: {
        ...base, id: 'i1', parentId: 'root', type: 'Instance',
        componentId: 'comp1', overrides, children: [],
      },
    } as unknown as Record<string, Node>;
    return { rootId: 'root', nodes, schemaVer: 1 } as unknown as Doc;
  };

  const overridesOf = (d: Doc) =>
    (d.nodes.i1 as unknown as { overrides: Record<string, Record<string, unknown>> }).overrides;

  it('bản dịch rơi vào override của instance, không phải vào node doc', () => {
    const out = applyTranslations(withInstance(), [
      { nodeId: 'i1/c2', field: 'content', value: [{ t: 'text', v: 'English' }] },
    ]);
    expect(overridesOf(out).c2!.content).toEqual([{ t: 'text', v: 'English' }]);
  });

  it('bản dịch THẮNG override của người dùng ở cùng trang', () => {
    // Cả hai thuộc về đúng trang đó; bản dịch là thứ được chọn sau.
    const out = applyTranslations(
      withInstance({ c2: { content: [{ t: 'text', v: 'Tiếng Việt riêng' }] } }),
      [{ nodeId: 'i1/c2', field: 'content', value: [{ t: 'text', v: 'English' }] }],
    );
    expect(overridesOf(out).c2!.content).toEqual([{ t: 'text', v: 'English' }]);
  });

  it('giữ các override khác của cùng node', () => {
    const out = applyTranslations(
      withInstance({ c2: { alt: 'giữ nguyên' } }),
      [{ nodeId: 'i1/c2', field: 'content', value: [{ t: 'text', v: 'X' }] }],
    );
    expect(overridesOf(out).c2!.alt).toBe('giữ nguyên');
    expect(overridesOf(out).c2!.content).toEqual([{ t: 'text', v: 'X' }]);
  });

  it('KHÔNG sửa doc gốc, kể cả bản đồ overrides lồng bên trong', () => {
    // Doc đến từ cache dùng chung; ghi vào nó thì bản dịch tiếng Anh rò rỉ sang
    // request tiếng Việt kế tiếp.
    const d = withInstance({ c2: { alt: 'gốc' } });
    applyTranslations(d, [
      { nodeId: 'i1/c2', field: 'content', value: [{ t: 'text', v: 'X' }] },
    ]);
    expect(overridesOf(d).c2).toEqual({ alt: 'gốc' });
  });

  it('instance đã bị xoá thì bỏ qua, không ném', () => {
    expect(() =>
      applyTranslations(withInstance(), [
        { nodeId: 'khong-co/c2', field: 'content', value: [{ t: 'text', v: 'X' }] },
      ]),
    ).not.toThrow();
  });

  it('địa chỉ trỏ vào node KHÔNG phải instance thì bỏ qua', () => {
    const out = applyTranslations(withInstance(), [
      { nodeId: 'root/c2', field: 'content', value: [{ t: 'text', v: 'X' }] },
    ]);
    expect(out.nodes.root).toEqual(withInstance().nodes.root);
  });
});
