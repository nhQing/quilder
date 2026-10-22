import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Instance — component còn LIÊN KẾT, override chỉ nội dung.
 *
 * Hợp đồng đang kiểm, và cả bốn đều là lý do mô hình này tồn tại:
 *  - sửa component → trang đang dùng nó ĐỔI THEO
 *  - override nội dung là RIÊNG từng instance
 *  - style KHÔNG override được (schema strict chặn)
 *  - component không chứa được instance (selector hậu duệ sẽ áp nhầm style)
 *
 * Mọi test ghi vào nháp phải dọn trong `afterEach` — bộ e2e này publish.
 */

let cleanup: Array<(r: APIRequestContext) => Promise<unknown>> = [];

test.afterEach(async ({ request }) => {
  const jobs = cleanup;
  cleanup = [];
  for (const job of jobs) await job(request).catch(() => undefined);
});

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  expect(res.ok(), `tool ${name}: ${await res.text()}`).toBe(true);
  return (await res.json()).result;
}

/** Component riêng cho test, để không đụng thư viện thật. */
async function makeComponent(request: APIRequestContext, name: string) {
  const res = await request.post('/api/presets', { data: { name } });
  expect(res.ok()).toBe(true);
  const { preset } = await res.json();
  cleanup.push((r) => r.delete(`/api/presets/${preset.id}`));

  const { rootId } = await tool(request, 'get_component', { componentId: preset.id });

  // Một node Text bên trong, để có thứ mà override.
  const add = await request.post(`/api/presets/${preset.id}/ops`, {
    data: {
      ops: [
        {
          op: 'insertNode',
          parentId: rootId,
          index: 0,
          node: {
            id: 'inst-title',
            parentId: rootId,
            type: 'Text',
            tag: 'h2',
            children: [],
            effects: [],
            style: { base: { typography: { weight: 700 } } },
            content: [{ t: 'text', v: 'CHỮ CỦA COMPONENT' }],
          },
        },
      ],
    },
  });
  expect(add.ok(), await add.text()).toBe(true);

  return { id: preset.id as string, rootId: rootId as string };
}

async function pageIds(request: APIRequestContext) {
  const { pages } = await tool(request, 'list_pages', {});
  return (pages as { id: string; path: string }[]).map((p) => ({
    ...p, slug: p.path.replace(/^\//, ''),
  }));
}

test.describe('instance', () => {
  test('sửa component thì trang đang dùng nó ĐỔI THEO', async ({ request }) => {
    const comp = await makeComponent(request, 'E2E Liên kết');
    const target = (await pageIds(request)).find((p) => p.slug === 'gioi-thieu')!;
    const { rootId: pageRoot } = await tool(request, 'get_page_outline', { pageId: target.id });

    // Chèn instance vào trang.
    const insert = await request.post('/api/ops', {
      data: {
        pageId: target.id,
        label: 'e2e chèn instance',
        ops: [
          {
            op: 'insertNode',
            parentId: pageRoot,
            index: 0,
            node: {
              id: 'e2einst',
              parentId: pageRoot,
              type: 'Instance',
              componentId: comp.id,
              overrides: {},
              children: [],
              effects: [],
              style: { base: {} },
            },
          },
        ],
      },
    });
    expect(insert.ok(), await insert.text()).toBe(true);
    cleanup.push((r) =>
      r.post('/api/ops', {
        data: { pageId: target.id, label: 'e2e dọn instance', ops: [{ op: 'removeNode', nodeId: 'e2einst' }] },
      }),
    );

    // Trang render ra chữ CỦA COMPONENT.
    let html = await (await request.get(`/render/${target.id}`)).text();
    expect(html).toContain('CHỮ CỦA COMPONENT');
    // Và style của component được phát dưới selector scope theo component, MỘT lần.
    expect(html).toContain(`[data-c="${comp.id}"] [data-cn="inst-title"]`);

    // Sửa component → trang đổi theo, KHÔNG cần chạm vào trang.
    const edit = await request.post(`/api/presets/${comp.id}/ops`, {
      data: {
        ops: [{ op: 'setText', nodeId: 'inst-title', field: 'content', value: [{ t: 'text', v: 'ĐÃ SỬA Ở COMPONENT' }] }],
      },
    });
    expect(edit.ok(), await edit.text()).toBe(true);

    html = await (await request.get(`/render/${target.id}`)).text();
    expect(html).toContain('ĐÃ SỬA Ở COMPONENT');
    expect(html).not.toContain('CHỮ CỦA COMPONENT');
  });

  test('override nội dung là RIÊNG của instance', async ({ request }) => {
    const comp = await makeComponent(request, 'E2E Override');
    const target = (await pageIds(request)).find((p) => p.slug === 'gioi-thieu')!;
    const { rootId: pageRoot } = await tool(request, 'get_page_outline', { pageId: target.id });

    const node = (id: string) => ({
      op: 'insertNode',
      parentId: pageRoot,
      index: 0,
      node: {
        id, parentId: pageRoot, type: 'Instance', componentId: comp.id,
        overrides: {}, children: [], effects: [], style: { base: {} },
      },
    });

    // HAI instance của cùng một component.
    await request.post('/api/ops', {
      data: { pageId: target.id, label: 'e2e hai instance', ops: [node('e2ea')] },
    });
    await request.post('/api/ops', {
      data: { pageId: target.id, label: 'e2e hai instance', ops: [node('e2eb')] },
    });
    cleanup.push((r) =>
      r.post('/api/ops', {
        data: {
          pageId: target.id, label: 'e2e dọn',
          ops: [{ op: 'removeNode', nodeId: 'e2ea' }, { op: 'removeNode', nodeId: 'e2eb' }],
        },
      }),
    );

    // Chỉ ghi đè MỘT trong hai.
    const over = await request.post('/api/ops', {
      data: {
        pageId: target.id,
        label: 'e2e override',
        ops: [
          {
            op: 'setOverride',
            nodeId: 'e2ea',
            localId: 'inst-title',
            patch: { content: [{ t: 'text', v: 'CHỮ RIÊNG CỦA A' }] },
          },
        ],
      },
    });
    expect(over.ok(), await over.text()).toBe(true);

    const html = await (await request.get(`/render/${target.id}`)).text();
    // Instance A mang chữ riêng, instance B vẫn mang chữ của component.
    expect(html).toContain('CHỮ RIÊNG CỦA A');
    expect(html).toContain('CHỮ CỦA COMPONENT');
  });

  test('override KHÔNG mang được style', async ({ request }) => {
    // Đây là ranh giới của cả mô hình: style luôn theo component. Schema
    // `.strict()` là thứ giữ nó, và test này là thứ giữ schema.
    const comp = await makeComponent(request, 'E2E Chặn style');
    const target = (await pageIds(request)).find((p) => p.slug === 'gioi-thieu')!;
    const { rootId: pageRoot } = await tool(request, 'get_page_outline', { pageId: target.id });

    await request.post('/api/ops', {
      data: {
        pageId: target.id,
        label: 'e2e instance',
        ops: [
          {
            op: 'insertNode', parentId: pageRoot, index: 0,
            node: {
              id: 'e2estyle', parentId: pageRoot, type: 'Instance', componentId: comp.id,
              overrides: {}, children: [], effects: [], style: { base: {} },
            },
          },
        ],
      },
    });
    cleanup.push((r) =>
      r.post('/api/ops', {
        data: { pageId: target.id, label: 'e2e dọn', ops: [{ op: 'removeNode', nodeId: 'e2estyle' }] },
      }),
    );

    const res = await request.post('/api/ops', {
      data: {
        pageId: target.id,
        ops: [
          {
            op: 'setOverride',
            nodeId: 'e2estyle',
            localId: 'inst-title',
            patch: { style: { base: { typography: { weight: 400 } } } },
          },
        ],
      },
    });
    expect(res.status()).toBe(422);
  });

  test('component KHÔNG chứa được instance', async ({ request }) => {
    // Style của component scope bằng selector hậu duệ, nên một instance lồng bên
    // trong sẽ bị áp nhầm style — sai im lặng.
    const outer = await makeComponent(request, 'E2E Ngoài');
    const inner = await makeComponent(request, 'E2E Trong');

    const res = await request.post(`/api/presets/${outer.id}/ops`, {
      data: {
        ops: [
          {
            op: 'insertNode', parentId: outer.rootId, index: 0,
            node: {
              id: 'nested', parentId: outer.rootId, type: 'Instance',
              componentId: inner.id, overrides: {}, children: [], effects: [], style: { base: {} },
            },
          },
        ],
      },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toMatch(/không chứa được instance/i);
  });
});

test.describe('component KHÔNG lên site thật trước khi publish', () => {
  test('sửa component đổi bản nháp, nhưng site đang chạy giữ nguyên', async ({ request }) => {
    // Đây là hợp đồng quan trọng nhất của cả hệ: instance render bằng cách tra
    // cây component, và nếu tra thẳng bảng Preset thì sửa một component sẽ đổi
    // NGAY trang đang chạy — bỏ qua publish, im lặng.
    const comp = await makeComponent(request, 'E2E Ảnh chụp');
    const target = (await pageIds(request)).find((p) => p.slug === 'gioi-thieu')!;
    const { rootId: pageRoot } = await tool(request, 'get_page_outline', { pageId: target.id });

    await request.post('/api/ops', {
      data: {
        pageId: target.id, label: 'e2e instance ảnh chụp',
        ops: [
          {
            op: 'insertNode', parentId: pageRoot, index: 0,
            node: {
              id: 'e2esnap', parentId: pageRoot, type: 'Instance', componentId: comp.id,
              overrides: {}, children: [], effects: [], style: { base: {} },
            },
          },
        ],
      },
    });
    cleanup.push((r) =>
      r.post('/api/ops', {
        data: { pageId: target.id, label: 'e2e dọn', ops: [{ op: 'removeNode', nodeId: 'e2esnap' }] },
      }),
    );

    // Sửa component.
    await request.post(`/api/presets/${comp.id}/ops`, {
      data: {
        ops: [
          {
            op: 'setText', nodeId: 'inst-title', field: 'content',
            value: [{ t: 'text', v: 'CHỈ Ở NHÁP' }],
          },
        ],
      },
    });

    // Bản nháp thấy ngay.
    const draft = await (await request.get(`/render/${target.id}`)).text();
    expect(draft).toContain('CHỈ Ở NHÁP');

    // Site đang chạy thì KHÔNG — nó đọc ảnh chụp của release, và release chưa
    // được tạo lại.
    const live = await (await request.get('/gioi-thieu')).text();
    expect(live).not.toContain('CHỈ Ở NHÁP');
  });
});
