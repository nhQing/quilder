import { describe, expect, it } from 'vitest';

import { DocVersionError, migrateDoc, migratePresetTree, presetTreeToDoc } from './migrate';
import { CURRENT_SCHEMA_VERSION } from './types';

/**
 * Cây COMPONENT phải đi qua đúng bộ migration mà cây TRANG đi qua.
 *
 * ## Vì sao đây là lỗ chí tử với mô hình "nâng cấp builder"
 *
 * Nâng cấp builder CHÍNH LÀ lúc `schemaVersion` tăng. Trước task này,
 * `apply-to-preset.ts` gắn `CURRENT_SCHEMA_VERSION` lên bất cứ cây nào đọc ra —
 * tức nó KHẲNG ĐỊNH cây đã ở schema mới nhất mà không kiểm. Ngày `Doc` lên 2:
 * trang migrate, component thì không, 286 node `Instance` render từ cây chưa nâng
 * cấp, và `pnpm verify` vẫn xanh.
 */

const TREE = {
  rootId: 'n1',
  nodes: {
    n1: { id: 'n1', type: 'Box', parentId: null, children: [], style: { base: {} } },
  },
};

describe('migratePresetTree', () => {
  it('cây THIẾU schemaVersion coi là v1', () => {
    // Ngoại lệ có chủ đích so với `migrateDoc`, vốn ném khi thiếu. Có lý do dữ
    // liệu: 5 preset và 56 `Release.components` đã được ghi TRƯỚC khi trường này
    // tồn tại. Ném ở đây là làm trắng mọi trang có instance, để đổi lấy một lời
    // cảnh báo không ai cần.
    const out = migratePresetTree(TREE);
    expect(out.rootId).toBe('n1');
    expect(Object.keys(out.nodes)).toEqual(['n1']);
  });

  it('giữ nguyên cây khi schemaVersion đã là bản hiện tại', () => {
    expect(
      migratePresetTree({ ...TREE, schemaVersion: CURRENT_SCHEMA_VERSION }).rootId,
    ).toBe('n1');
  });

  it('KHÔNG trả schemaVersion ra ngoài — ComponentTree không có trường đó', () => {
    // `ComponentTree` là `{ rootId, nodes }`. Trả kèm `schemaVersion` sẽ lọt vào
    // mọi chỗ so sánh cây và làm chúng lệch vì một trường không ai đọc.
    expect(
      migratePresetTree({ ...TREE, schemaVersion: CURRENT_SCHEMA_VERSION }),
    ).not.toHaveProperty('schemaVersion');
  });

  it('version cao hơn code thì NÉM, không đoán', () => {
    // Xảy ra khi lùi code về bản cũ trong lúc DB đã có cây mới hơn. Render sai còn
    // tệ hơn báo lỗi rõ ràng.
    expect(() => migratePresetTree({ ...TREE, schemaVersion: 99 })).toThrow(DocVersionError);
  });

  it('không phải object thì ném', () => {
    expect(() => migratePresetTree(null)).toThrow(DocVersionError);
    expect(() => migratePresetTree('cây')).toThrow(DocVersionError);
  });

  it('dùng CÙNG bảng MIGRATIONS với migrateDoc, không phải bảng thứ hai', () => {
    // Giờ kiểm được TRỰC TIẾP bằng hành vi: bước 1→2 đổi `visibility` thành
    // `render`, và cây component phải đi qua đúng bước đó. Hai bảng riêng sẽ trôi
    // khỏi nhau, và bản ít được nhớ tới là bản dùng cho component.
    const out = migratePresetTree({
      rootId: 'n1',
      schemaVersion: 1,
      nodes: {
        n1: {
          id: 'n1', type: 'Box', parentId: null, children: [], style: { base: {} },
          visibility: { base: false },
        },
      },
    });
    const node = out.nodes.n1 as unknown as Record<string, unknown>;
    expect(node.render).toBe(false);
    expect(node).not.toHaveProperty('visibility');
  });

  it('version cao hơn CURRENT thì vẫn ném', () => {
    expect(() =>
      migratePresetTree({ ...TREE, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
    ).toThrow(DocVersionError);
  });
});

/**
 * `visibility: Responsive<boolean>` → `render: boolean` (v1 → v2).
 *
 * Trường cũ TRÔNG như media query nhưng `NodeRenderer` chỉ đọc `.base` rồi trả
 * `null` — nó cắt node khỏi DOM ở MỌI bề rộng. Nên phép chuyển không mất thông tin
 * nào đang có tác dụng: ba khoá `sm/md/lg/xl` chưa từng được đọc.
 *
 * Điều KHÔNG được làm: đoán ý người dùng. `{base:false, lg:true}` gợi ra "ẩn ở
 * mobile, hiện ở desktop", nhưng hành vi thật là ẩn khắp nơi — nên migration giữ
 * hành vi thật (`render: false`), và ai muốn ý kia phải đặt lại bằng
 * `style.lg.layout.display`. Migration im lặng đổi hành vi của một trang đã publish
 * là thứ tệ hơn cả bug ban đầu.
 */
describe('migrate v1 → v2: visibility → render', () => {
  const docV1 = (visibility: unknown) => ({
    schemaVersion: 1,
    rootId: 'n1',
    nodes: {
      n1: { id: 'n1', type: 'Box', parentId: null, children: [], style: { base: {} }, visibility },
    },
  });

  const nodeOf = (doc: unknown) =>
    (doc as { nodes: Record<string, Record<string, unknown>> }).nodes.n1!;

  it('base:false thành render:false', () => {
    const node = nodeOf(migrateDoc(docV1({ base: false })));
    expect(node.render).toBe(false);
    expect(node).not.toHaveProperty('visibility');
  });

  it('base:true KHÔNG ghi render — mặc định là có render, đừng làm doc phình', () => {
    const node = nodeOf(migrateDoc(docV1({ base: true })));
    expect(node).not.toHaveProperty('render');
    expect(node).not.toHaveProperty('visibility');
  });

  it('base:false kèm lg:true vẫn thành render:false — giữ HÀNH VI, không đoán ý', () => {
    const node = nodeOf(migrateDoc(docV1({ base: false, lg: true })));
    expect(node.render).toBe(false);
  });

  it('node không có visibility thì không mọc thêm render', () => {
    const doc = migrateDoc({
      schemaVersion: 1,
      rootId: 'n1',
      nodes: { n1: { id: 'n1', type: 'Box', parentId: null, children: [], style: { base: {} } } },
    });
    expect(nodeOf(doc)).not.toHaveProperty('render');
  });

  it('doc v2 đi qua không đổi', () => {
    const doc = migrateDoc({
      schemaVersion: 2,
      rootId: 'n1',
      nodes: {
        n1: {
          id: 'n1', type: 'Box', parentId: null, children: [], style: { base: {} },
          render: false,
        },
      },
    });
    expect(nodeOf(doc).render).toBe(false);
    expect(doc.schemaVersion).toBe(2);
  });

  it('presetTreeToDoc migrate rồi gắn version hiện tại', () => {
    // Ba chỗ ở client từng tự ghép `{ ...tree, schemaVersion: 1 }` — dán nhãn v1
    // cho cây version bất kỳ, tức bỏ qua mọi migration.
    const doc = presetTreeToDoc({
      rootId: 'n1',
      schemaVersion: 1,
      nodes: {
        n1: {
          id: 'n1', type: 'Box', parentId: null, children: [], style: { base: {} },
          visibility: { base: false },
        },
      },
    });
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(nodeOf(doc).render).toBe(false);
  });
});

describe('stripScaffolding qua migrateDoc', () => {
  const withSrc = {
    schemaVersion: 1,
    rootId: 'n1',
    nodes: {
      n1: {
        id: 'n1', type: 'Image', parentId: null, children: [], style: { base: {} },
        assetId: 'a1', alt: '', fit: { base: 'cover' },
        _src: 'img/hero/hero.jpg',
      },
    },
  };

  it('bỏ `_src` khỏi node', () => {
    // `zNode` là .strict(), nên invert() gói node kèm `_src` thành insertNode và
    // validator từ chối — hoàn tác sau khi xoá báo "Unrecognized key(s): '_src'".
    // Người dùng báo đúng lỗi này ngày 19/08/2026.
    const out = migrateDoc(withSrc);
    expect(out.nodes.n1).not.toHaveProperty('_src');
  });

  it('giữ nguyên mọi field khác', () => {
    const out = migrateDoc(withSrc) as unknown as {
      nodes: { n1: { assetId: string; type: string } };
    };
    expect(out.nodes.n1.assetId).toBe('a1');
    expect(out.nodes.n1.type).toBe('Image');
  });

  it('doc không có giàn giáo thì trả về CHÍNH object cũ', () => {
    // Giữ referential equality cho React.memo ở tầng builder — cùng lý lẽ như
    // applyPatchWithMinimalMutationChain của Builder.io.
    //
    // Doc phải ở CURRENT_SCHEMA_VERSION: có bước migration nào chạy thì kết quả
    // là một object mới, và đó là ĐÚNG — xem test kế tiếp.
    const clean = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rootId: 'n1',
      nodes: { n1: { id: 'n1', type: 'Box', parentId: null, children: [], style: { base: {} } } },
    };
    expect(migrateDoc(clean)).toBe(clean);
  });

  it('migrateDoc KHÔNG mutate đầu vào', () => {
    /*
     * Vòng lặp trong `migrateDoc` ghi `current.schemaVersion = version` sau mỗi
     * bước. Nếu một bước migration trả về CHÍNH object đầu vào để "tối ưu" thì
     * dòng đó ghi thẳng vào doc của người gọi — và người gọi thường là
     * `applyOpsToPage`, đang giữ `page.draftVersion.doc` đọc từ Prisma.
     *
     * Nên mỗi bước phải trả về object mới. Test này là thứ canh cho luật đó.
     */
    const input = {
      schemaVersion: 1,
      rootId: 'n1',
      nodes: {
        n1: {
          id: 'n1', type: 'Box', parentId: null, children: [], style: { base: {} },
          visibility: { base: false },
        },
      },
    };
    const snapshot = JSON.stringify(input);
    migrateDoc(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
