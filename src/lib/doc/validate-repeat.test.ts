import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    token: { findMany: vi.fn().mockResolvedValue([]) },
    // Luật khoá `map` đối chiếu với cấu trúc của loại. Trả 'news' với đúng field mà
    // SPEC ánh xạ — không có hàng nào thì luật tự bỏ qua và test không kiểm gì cả.
    collectionType: {
      findMany: vi.fn().mockResolvedValue([
        { key: 'news', schema: [{ t: 'text', key: 'title', label: 'Tiêu đề' }] },
      ]),
    },
  },
}));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc, type RepeatSpec } from './types';

const SPEC: RepeatSpec = {
  source: { kind: 'query', query: { typeKey: 'news', limit: 10 } },
  map: { title: { nodeId: 'card__title', as: 'content' } },
};

/** Doc với một Instance `inst` (cha `root`) sẵn để op `setProps` gắn `repeat` vào. */
function docWith(patch: (d: Doc) => void): Doc {
  const d = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Grid', parentId: null, children: ['inst'], effects: [], style: { base: {} } },
      inst: { id: 'inst', type: 'Instance', componentId: 'cmp1', overrides: {}, parentId: 'root', children: [], effects: [], style: { base: {} } },
    },
  } as unknown as Doc;
  patch(d);
  return d;
}

const setRepeat = (spec: unknown) => [{ op: 'setProps', nodeId: 'inst', props: { repeat: spec } }];

describe('validateOps — luật cho repeat', () => {
  it('Instance lặp hợp lệ thì đi qua', async () => {
    const r = await validateOps(docWith(() => {}), setRepeat(SPEC), 'human');
    expect(r.ok).toBe(true);
  });

  it('tắt lặp bằng null vẫn đi qua — không được kiểm hình dạng của "không có gì"', async () => {
    const r = await validateOps(docWith(() => {}), setRepeat(null), 'human');
    expect(r.ok).toBe(true);
  });

  it('repeat sai hình dạng qua setProps bị chặn', async () => {
    // `setProps` khai `props: z.record(z.string(), z.unknown())`, nên tầng 1 KHÔNG
    // nhìn vào bên trong. Không có luật này thì `limit: '10'` đi thẳng vào doc và
    // chỉ lộ ra ở renderer, dưới dạng một khu trống.
    const r = await validateOps(
      docWith(() => {}),
      setRepeat({ source: { kind: 'query', query: { typeKey: 'news', limit: '10' } }, map: {} }),
      'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_shape')).toBe(true);
  });

  it('Instance có repeat KHÔNG được có effect', async () => {
    // `EffectRuntime` gắn effect bằng `document.querySelector('[data-n=…]')`, tức
    // ĐÚNG MỘT phần tử. Với 10 thẻ thì chín thẻ không có effect, và nó im lặng.
    const d = docWith((x) => {
      (x.nodes.inst as unknown as { effects: unknown[] }).effects = [
        { id: 'e1', effect: 'reveal', params: {} },
      ];
    });
    const r = await validateOps(d, setRepeat(SPEC), 'human');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_effect')).toBe(true);
  });

  it('group-entries chỉ hợp lệ khi có tổ tiên lặp theo taxonomy', async () => {
    const r = await validateOps(
      docWith(() => {}),
      setRepeat({ source: { kind: 'group-entries', limit: 20 }, map: {} }),
      'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_group_parent')).toBe(true);
  });

  it('taxonomy → group-entries hai cấp thì hợp lệ', async () => {
    // Cây này dựng được qua đường op từ 11/09/2026 — xem `nestedRepeatIssue` và
    // nhóm test "cây lặp hai cấp" ở cuối file. Fixture vẫn dựng thẳng object để
    // kiểm đúng luật đang xét, không phải luật cha–con.
    const d = docWith((x) => {
      x.nodes.root!.children = ['outer'];
      x.nodes.outer = {
        id: 'outer', type: 'Instance', componentId: 'cmp_group', overrides: {},
        parentId: 'root', children: ['inst'], effects: [], style: { base: {} },
        repeat: { source: { kind: 'taxonomy', typeKey: 'faq' }, map: {} },
      } as never;
      x.nodes.inst!.parentId = 'outer';
    });
    const r = await validateOps(
      d,
      setRepeat({ source: { kind: 'group-entries', limit: 20 }, map: { title: { nodeId: 'q', as: 'content' } } }),
      'human',
    );
    expect(r.ok).toBe(true);
  });

  it('lồng ba cấp bị từ chối', async () => {
    const d = docWith((x) => {
      x.nodes.root!.children = ['a'];
      x.nodes.a = { id: 'a', type: 'Instance', componentId: 'c', overrides: {}, parentId: 'root', children: ['b'], effects: [], style: { base: {} }, repeat: { source: { kind: 'taxonomy', typeKey: 'faq' }, map: {} } } as never;
      x.nodes.b = { id: 'b', type: 'Instance', componentId: 'c', overrides: {}, parentId: 'a', children: ['inst'], effects: [], style: { base: {} }, repeat: { source: { kind: 'group-entries', limit: 5 }, map: {} } } as never;
      x.nodes.inst!.parentId = 'b';
    });
    const r = await validateOps(
      d,
      setRepeat({ source: { kind: 'group-entries', limit: 5 }, map: {} }),
      'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_depth')).toBe(true);
  });

  it('blockComponents chỉ hợp lệ khi source.kind là field', async () => {
    const r = await validateOps(
      docWith(() => {}),
      setRepeat({ ...SPEC, blockComponents: { quote: 'cmp_quote' } }),
      'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_block_components')).toBe(true);
  });

  const mapKeyIssues = async (map: Record<string, { nodeId: string; as: string }>) => {
    const r = await validateOps(docWith(() => {}), setRepeat({ ...SPEC, map }), 'human');
    return r.ok ? [] : r.issues.filter((i) => i.code === 'repeat_map_key');
  };

  it('khoá map không có trong loại bị TỪ CHỐI — đây là lỗi đang có trên site thật', async () => {
    // stg.example.com/blogs/san-pham, bản đã publish: mọi thẻ mang huy hiệu
    // 'Danh mục' thay vì 'Sản phẩm'. Cấu hình được nhận, được lưu, không bao giờ chạy.
    const issues = await mapKeyIssues({ khong_co_that: { nodeId: 'n', as: 'content' } });
    expect(issues.length).toBe(1);
    // Câu lỗi phải kể ra thứ ĐỌC ĐƯỢC, không chỉ nói 'sai'. Người nhận nó có thể là
    // một agent chỉ nối MCP, không có repo để tra.
    expect(issues[0]?.message).toContain('taxonomy');
  });

  it('khoá ảo đi qua — chúng không nằm trong FieldDef[] nhưng resolve được', async () => {
    expect(await mapKeyIssues({ slug: { nodeId: 'n', as: 'href' } })).toEqual([]);
    expect(await mapKeyIssues({ taxonomy: { nodeId: 'n', as: 'content' } })).toEqual([]);
    expect(await mapKeyIssues({ published_at: { nodeId: 'n', as: 'content' } })).toEqual([]);
  });

  it('nguồn field KHÔNG bị kiểm — item của nó là một mảng JSONB bất kỳ', async () => {
    const r = await validateOps(
      docWith(() => {}),
      setRepeat({ source: { kind: 'field', path: 'khoi' }, map: { bat_ky: { nodeId: 'n', as: 'content' } } }),
      'human',
    );
    expect(r.ok).toBe(true);
  });

  it('khối lặp theo danh mục chỉ đọc được khoá của DANH MỤC, không phải của bài', async () => {
    const r = await validateOps(
      docWith(() => {}),
      setRepeat({ source: { kind: 'taxonomy', typeKey: 'news' }, map: { title: { nodeId: 'n', as: 'content' } } }),
      'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'repeat_map_key')).toBe(true);

    const ok = await validateOps(
      docWith(() => {}),
      setRepeat({ source: { kind: 'taxonomy', typeKey: 'news' }, map: { name: { nodeId: 'n', as: 'content' } } }),
      'human',
    );
    expect(ok.ok).toBe(true);
  });
});

describe('validateOps — cây lặp hai cấp', () => {
  /** Doc có một Instance `outer` lặp theo danh mục, nằm dưới `root`. */
  const withOuter = (outerSource: unknown = { kind: 'taxonomy', typeKey: 'faq' }) =>
    docWith((x) => {
      x.nodes.root!.children = ['outer'];
      x.nodes.outer = {
        id: 'outer', type: 'Instance', componentId: 'cmp_group', overrides: {},
        parentId: 'root', children: [], effects: [], style: { base: {} },
        repeat: { source: outerSource, map: {} },
      } as never;
      delete x.nodes.inst;
    });

  const insertInner = (repeat: unknown) => [
    {
      op: 'insertNode',
      parentId: 'outer',
      index: 0,
      node: {
        id: 'inner', type: 'Instance', componentId: 'cmp_q', overrides: {},
        parentId: 'outer', children: [], effects: [], style: { base: {} },
        repeat,
      },
    },
  ];

  it('khối lặp group-entries chèn được vào khối lặp theo danh mục', async () => {
    // Đây là thứ KHÔNG làm được trước 11/09/2026, và là lý do trang /blogs của
    // Website-MM phải gõ tay một hàng cho mỗi danh mục, mỗi hàng ghim cứng một id.
    const r = await validateOps(
      withOuter(),
      insertInner({ source: { kind: 'group-entries', limit: 5 }, map: { title: { nodeId: 'q', as: 'content' } } }),
      'human',
    );
    expect(r.ok).toBe(true);
  });

  it('Instance THƯỜNG vẫn là lá — không nhận con', async () => {
    // `inst` không có `repeat`, nên ngoại lệ cây hai cấp không áp — kể cả khi con
    // là đúng một khối lặp `group-entries`.
    const r = await validateOps(
      docWith(() => {}),
      [
        {
          op: 'insertNode',
          parentId: 'inst',
          index: 0,
          node: {
            id: 'inner', type: 'Instance', componentId: 'cmp_q', overrides: {},
            parentId: 'inst', children: [], effects: [], style: { base: {} },
            repeat: { source: { kind: 'group-entries', limit: 5 }, map: {} },
          },
        },
      ],
      'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'leaf-parent')).toBe(true);
  });

  it('con KHÔNG phải group-entries thì bị chặn', async () => {
    // Không có luật này thì renderer render một node con không ai bind dữ liệu,
    // và nó lặp lại y hệt ở mọi danh mục.
    const r = await validateOps(
      withOuter(),
      insertInner({ source: { kind: 'query', query: { typeKey: 'news', limit: 3 } }, map: {} }),
      'human',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => i.code === 'leaf-parent')).toBe(true);
  });

  it('cha lặp theo TRUY VẤN thì không nhận con', async () => {
    const r = await validateOps(
      withOuter({ kind: 'query', query: { typeKey: 'news', limit: 10 } }),
      insertInner({ source: { kind: 'group-entries', limit: 5 }, map: {} }),
      'human',
    );
    expect(r.ok).toBe(false);
  });

  it('con thứ HAI bị chặn — một khối lặp con, không phải nhiều', async () => {
    const d = withOuter();
    (d.nodes.outer as unknown as { children: string[] }).children = ['da-co'];
    const r = await validateOps(
      d,
      insertInner({ source: { kind: 'group-entries', limit: 5 }, map: {} }),
      'human',
    );
    expect(r.ok).toBe(false);
  });
});
