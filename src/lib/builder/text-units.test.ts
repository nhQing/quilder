import { describe, expect, it } from 'vitest';

/**
 * Rút đơn vị chữ khỏi doc.
 *
 * Ba tính chất chịu lực:
 *
 *  1. KHÔNG bỏ sót bề mặt nào. Một trường bị bỏ quên sẽ thành mẩu tiếng Việt còn
 *     sót trên trang tiếng Anh, và không có test nào khác bắt được.
 *  2. Phân loại `flat` phải ĐÚNG. Cho sửa phẳng một đơn vị có cấu trúc là san
 *     phẳng cây inline — link mất href, hiệu ứng tách chữ chết im lặng.
 *  3. Doc hỏng không được treo request.
 */

import type { ContentOverride, Doc, Node } from '@/lib/doc/types';
import {
  extractUnits, flatRichText, isFlatRichText, sourceHash, unitKey,
} from './text-units';

const base = {
  parentId: null as string | null,
  children: [] as string[],
  style: {},
  effects: [],
};

function doc(nodes: Record<string, Partial<Node> & { type: Node['type'] }>): Doc {
  const full: Record<string, Node> = {};
  for (const [id, n] of Object.entries(nodes)) {
    full[id] = { ...base, id, ...n } as Node;
  }
  return { rootId: 'root', nodes: full, schemaVer: 1 } as unknown as Doc;
}

describe('extractUnits — mọi bề mặt chữ', () => {
  it('gom content, label, alt và a11y label', () => {
    const d = doc({
      root: { type: 'Section', tag: 'main', name: 'Trang', children: ['t', 'b', 'i', 'x'] },
      t: { type: 'Text', tag: 'h1', parentId: 'root', content: [{ t: 'text', v: 'Tiêu đề' }] },
      b: { type: 'Button', parentId: 'root', label: [{ t: 'text', v: 'Bấm' }], variant: 'primary', action: { kind: 'none' } },
      i: { type: 'Image', parentId: 'root', alt: 'Ảnh bìa', assetId: null, fit: { base: 'cover' } },
      x: { type: 'Stack', parentId: 'root', direction: { base: 'row' }, a11y: { label: 'Vùng điều hướng' } },
    });

    expect(extractUnits(d).map((u) => [u.nodeId, u.field, u.text])).toEqual([
      ['t', 'content', 'Tiêu đề'],
      ['b', 'label', 'Bấm'],
      ['i', 'alt', 'Ảnh bìa'],
      // Ảnh sinh HAI đơn vị: chữ thay ảnh, và chính tấm ảnh. Ảnh có chữ in lên nó
      // là thứ rất hay gặp ở hero và banner, nên nó phải dịch được.
      ['i', 'assetId', ''],
      ['x', 'a11yLabel', 'Vùng điều hướng'],
    ]);
  });

  it('một node có thể sinh HAI đơn vị', () => {
    // Ảnh có alt VÀ a11y label. Khoá chỉ theo nodeId sẽ gộp chúng lại, và bản
    // dịch của cái này ghi đè cái kia.
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['i'] },
      i: { type: 'Image', parentId: 'root', alt: 'Logo BIDV', assetId: null, fit: { base: 'contain' }, a11y: { label: 'Ngân hàng lưu ký' } },
    });
    expect(extractUnits(d).map((u) => u.field)).toEqual(['alt', 'assetId', 'a11yLabel']);
  });

  it('alt rỗng VẪN hiện', () => {
    // Rỗng là hợp lệ với ảnh trang trí, nhưng ẩn đi thì không có cách nào phát
    // hiện một ảnh có nội dung bị đánh dấu trang trí nhầm.
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['i'] },
      i: { type: 'Image', parentId: 'root', alt: '', assetId: null, fit: { base: 'cover' }, decorative: true },
    });
    // Hai: `alt` và `assetId`. Cái đang xét là `alt`.
    expect(extractUnits(d)).toHaveLength(2);
    expect(extractUnits(d)[0]!.field).toBe('alt');
    expect(extractUnits(d)[0]!.text).toBe('');
  });

  it('video sinh HAI đơn vị: file và ảnh chờ', () => {
    // Ảnh chờ thường là khung hình CÓ CHỮ in lên, nên nó là thứ hay cần dịch hơn
    // cả file video. Gộp hai thứ vào một đơn vị thì đổi ảnh chờ sẽ đổi luôn video.
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['v'] },
      v: { type: 'Video', parentId: 'root', assetId: 'vid-vi', posterAssetId: 'poster-vi' },
    });
    expect(extractUnits(d).map((u) => [u.field, u.text])).toEqual([
      ['assetId', 'vid-vi'],
      ['posterAssetId', 'poster-vi'],
    ]);
  });

  it('nút action link sinh thêm đơn vị href — đây là nút đổi ngôn ngữ', () => {
    // Bản dịch phủ lên CÙNG một doc, nên không có `href` dịch được thì một nút
    // '/en/trang-chu' trỏ tới chính nó trên trang tiếng Anh.
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['b'] },
      b: { type: 'Button', parentId: 'root', label: [{ t: 'text', v: 'EN' }], variant: 'ghost', action: { kind: 'link', href: '/en/trang-chu' } },
    });
    expect(extractUnits(d).map((u) => [u.field, u.text])).toEqual([
      ['label', 'EN'],
      ['href', '/en/trang-chu'],
    ]);
  });

  it('nút KHÔNG phải link thì không có đơn vị href', () => {
    // `applyOverride` cố ý bỏ qua href trên action khác — bày ô ra là mời người ta
    // gõ vào một chỗ không có tác dụng.
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['b'] },
      b: { type: 'Button', parentId: 'root', label: [{ t: 'text', v: 'Gửi' }], variant: 'primary', action: { kind: 'submit', formId: 'f1' } },
    });
    expect(extractUnits(d).map((u) => u.field)).toEqual(['label']);
  });

  it('a11y label rỗng thì KHÔNG sinh đơn vị', () => {
    // Khác alt: alt là trường bắt buộc nên vắng mặt là có nghĩa. a11y label
    // không có thì đơn giản là node không cần nó.
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['x'] },
      x: { type: 'Stack', parentId: 'root', direction: { base: 'row' }, a11y: { role: 'list' } },
    });
    expect(extractUnits(d)).toHaveLength(0);
  });

  it('theo thứ tự CÂY, không theo thứ tự khoá', () => {
    // Soát chữ là đọc trang từ trên xuống. Bảng sắp theo id thì không đọc tuần
    // tự được — và `Object.keys` không hứa thứ tự nào có nghĩa.
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['z', 'a'] },
      z: { type: 'Text', tag: 'h1', parentId: 'root', content: [{ t: 'text', v: 'Trước' }] },
      a: { type: 'Text', tag: 'p', parentId: 'root', content: [{ t: 'text', v: 'Sau' }] },
    });
    expect(extractUnits(d).map((u) => u.text)).toEqual(['Trước', 'Sau']);
  });

  it('đường dẫn tổ tiên bỏ node gốc', () => {
    const d = doc({
      root: { type: 'Section', tag: 'main', name: 'Trang', children: ['s'] },
      s: { type: 'Section', tag: 'section', parentId: 'root', name: 'hero', children: ['w'] },
      w: { type: 'Stack', parentId: 's', direction: { base: 'column' }, name: 'hero__inner', children: ['t'] },
      t: { type: 'Text', tag: 'h1', parentId: 'w', content: [{ t: 'text', v: 'X' }] },
    });
    expect(extractUnits(d)[0]!.path).toBe('hero › hero__inner');
  });

  it('node ngay dưới gốc có path "(gốc)"', () => {
    const d = doc({
      root: { type: 'Section', tag: 'main', name: 'Trang', children: ['t'] },
      t: { type: 'Text', tag: 'p', parentId: 'root', content: [{ t: 'text', v: 'X' }] },
    });
    expect(extractUnits(d)[0]!.path).toBe('(gốc)');
  });

  it('đánh dấu node bị khoá', () => {
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['t'] },
      t: {
        type: 'Text', tag: 'p', parentId: 'root', content: [{ t: 'text', v: 'Miễn trừ' }],
        locked: { reason: 'pháp lý', lockedBy: 'admin', lockedAt: '2026-01-01' },
      },
    });
    expect(extractUnits(d)[0]!.locked).toBe(true);
  });
});

describe('phân loại flat', () => {
  it('một đoạn chữ trần là flat', () => {
    expect(isFlatRichText([{ t: 'text', v: 'xin chào' }])).toBe(true);
  });

  it('có link, br, strong hay split thì KHÔNG flat', () => {
    expect(isFlatRichText([{ t: 'text', v: 'a' }, { t: 'br' }])).toBe(false);
    expect(isFlatRichText([{ t: 'strong', children: [{ t: 'text', v: 'a' }] }])).toBe(false);
    expect(isFlatRichText([{ t: 'link', href: '/x', children: [{ t: 'text', v: 'a' }] }])).toBe(false);
    expect(isFlatRichText([{ t: 'split', mode: 'words', children: [{ t: 'text', v: 'a' }] }])).toBe(false);
  });

  it('rỗng thì không flat — không có gì để sửa phẳng', () => {
    expect(isFlatRichText([])).toBe(false);
    expect(isFlatRichText(undefined)).toBe(false);
  });

  it('alt và a11y luôn flat vì chúng là chuỗi thật', () => {
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['i'] },
      i: { type: 'Image', parentId: 'root', alt: 'x', assetId: null, fit: { base: 'cover' }, a11y: { label: 'y' } },
    });
    expect(extractUnits(d).every((u) => u.flat)).toBe(true);
  });

  it('vòng tròn flat: chuỗi → RichText → chuỗi', () => {
    const rt = flatRichText('Tiền nhàn rỗi');
    expect(isFlatRichText(rt)).toBe(true);
    expect(rt).toEqual([{ t: 'text', v: 'Tiền nhàn rỗi' }]);
  });
});

describe('doc hỏng không được treo', () => {
  it('vòng children', () => {
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['a'] },
      a: { type: 'Stack', parentId: 'root', direction: { base: 'row' }, children: ['root'] },
    });
    expect(() => extractUnits(d)).not.toThrow();
  });

  it('vòng parentId', () => {
    const d = doc({
      root: { type: 'Section', tag: 'main', children: ['a'] },
      a: { type: 'Text', tag: 'p', parentId: 'b', content: [{ t: 'text', v: 'x' }] },
      b: { type: 'Stack', parentId: 'a', direction: { base: 'row' } },
    });
    expect(() => extractUnits(d)).not.toThrow();
  });

  it('children trỏ node không tồn tại', () => {
    const d = doc({ root: { type: 'Section', tag: 'main', children: ['khong-co'] } });
    expect(extractUnits(d)).toEqual([]);
  });
});

describe('unitKey và sourceHash', () => {
  it('unitKey phân biệt hai trường của cùng node', () => {
    expect(unitKey('n1', 'alt')).not.toBe(unitKey('n1', 'a11yLabel'));
  });

  it('sourceHash đổi khi chữ đổi', () => {
    expect(sourceHash('a')).not.toBe(sourceHash('b'));
    expect(sourceHash('Tiền')).toBe(sourceHash('Tiền'));
  });

  it('sourceHash phân biệt cả khác biệt nhỏ và chuỗi rỗng', () => {
    expect(sourceHash('Tiền nhàn rỗi')).not.toBe(sourceHash('Tiền nhàn rỗi.'));
    expect(sourceHash('')).toBe(sourceHash(''));
    expect(sourceHash('')).not.toBe(sourceHash(' '));
  });
});

/* ── Đơn vị chữ bên trong instance ────────────────────────────────────── */

describe('extractUnits — đi xuyên instance', () => {
  const tree = {
    rootId: 'c1',
    nodes: {
      c1: { ...base, id: 'c1', type: 'Section', tag: 'section', name: 'card', children: ['c2', 'c3'] },
      c2: { ...base, id: 'c2', parentId: 'c1', type: 'Text', tag: 'h2', name: 'tiêu đề', content: [{ t: 'text', v: 'Chữ component' }] },
      c3: { ...base, id: 'c3', parentId: 'c1', type: 'Image', name: 'ảnh', alt: 'Alt component', assetId: 'a1', fit: { base: 'cover' } },
    },
  } as unknown as { rootId: string; nodes: Record<string, Node> };

  const components = new Map([['comp1', tree]]);

  const withInstance = (overrides: Record<string, ContentOverride> = {}) =>
    doc({
      root: { type: 'Section', tag: 'main', name: 'Trang', children: ['i1'] },
      i1: {
        type: 'Instance', parentId: 'root', name: 'Thẻ sản phẩm',
        componentId: 'comp1', overrides,
      },
    });

  it('lấy chữ bên trong component, địa chỉ là instanceId/localId', () => {
    const units = extractUnits(withInstance(), components);
    expect(units.map((u) => [u.nodeId, u.field, u.text])).toEqual([
      ['i1/c2', 'content', 'Chữ component'],
      ['i1/c3', 'alt', 'Alt component'],
      ['i1/c3', 'assetId', 'a1'],
    ]);
  });

  it('lấy chữ ĐÃ PHỦ override, không phải chữ gốc', () => {
    // Đây là thứ trang thật hiện, và là thứ người dùng đang nhìn.
    const units = extractUnits(
      withInstance({ c2: { content: [{ t: 'text', v: 'Chữ riêng' }] } }),
      components,
    );
    expect(units[0]!.text).toBe('Chữ riêng');
  });

  it('đánh dấu ô nào còn theo component, ô nào đã sửa riêng', () => {
    // "Giống component" khác hẳn "đã sửa riêng thành ra trùng": cái đầu sẽ đổi
    // theo khi component đổi, cái sau thì không.
    const units = extractUnits(
      withInstance({ c2: { content: [{ t: 'text', v: 'Chữ riêng' }] } }),
      components,
    );
    expect(units[0]!.fromComponent).toBe(false);
    expect(units[1]!.fromComponent).toBe(true);
  });

  it('mang theo địa chỉ để biết ghi bằng setOverride', () => {
    // Ghi nhầm bằng setText sẽ sửa vào CÂY COMPONENT, tức là đổi mọi trang.
    const units = extractUnits(withInstance(), components);
    expect(units[0]!.inInstance).toEqual({
      instanceId: 'i1', localId: 'c2', componentId: 'comp1',
    });
  });

  it('đường dẫn ghép tên instance với đường dẫn trong component', () => {
    const units = extractUnits(withInstance(), components);
    expect(units[0]!.path).toContain('Thẻ sản phẩm');
    expect(units[0]!.path).toContain('card');
  });

  it('không có cây component thì bỏ qua, KHÔNG ném', () => {
    expect(extractUnits(withInstance())).toEqual([]);
    expect(extractUnits(withInstance(), new Map())).toEqual([]);
  });

  it('node component bị khoá thì instance cũng khoá', () => {
    // Khoá nằm ở nội dung, không ở chỗ nội dung được dùng.
    const locked = {
      rootId: 'c1',
      nodes: {
        ...tree.nodes,
        c2: { ...tree.nodes.c2, locked: { reason: 'pháp lý', lockedBy: 'a', lockedAt: 'b' } },
      },
    } as unknown as { rootId: string; nodes: Record<string, Node> };
    const units = extractUnits(withInstance(), new Map([['comp1', locked]]));
    expect(units[0]!.locked).toBe(true);
  });

  it('KHÔNG đi vào children của node Instance trong doc', () => {
    // Instance là lá trong doc; con của nó đến từ cây component. Đi cả hai đường
    // sẽ đếm đôi mọi đơn vị.
    // Ba đơn vị, không phải bốn: c2.content, c3.alt, c3.assetId. Cây lặp hai cấp
    // cho Instance nhận con từ 11/09/2026, nên phép đếm này canh đúng chuyện nó
    // KHÔNG đi xuống `node.children` của doc.
    const d = withInstance();
    expect(extractUnits(d, components)).toHaveLength(3);
  });
});
