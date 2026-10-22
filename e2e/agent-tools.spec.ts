import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Tool MCP của Đợt 2, kiểm qua đúng đường mà Agent đi: `POST /api/ai/tool`.
 *
 * Hợp đồng của đợt: **mọi việc người dùng làm được trong builder, Agent làm được
 * qua MCP — trừ Publish.**
 *
 * MỌI test ở đây có ghi thì dọn trong `afterEach`, và dọn THẬT chứ không báo lỗi.
 * Xem `docs/HANDOFF.md` §3.1 (năm spec gọi `/api/publish`, nên một bản nháp bẩn sẽ
 * lên site thật) và §3.25 (một cleanup chỉ-báo-lỗi đã từng để lại rác trong cây
 * preset).
 */

let cleanup: (() => Promise<unknown>) | null = null;

test.afterEach(async () => {
  const job = cleanup;
  cleanup = null;
  if (job) await job().catch(() => undefined);
});

async function tool(request: APIRequestContext, name: string, input: unknown) {
  const res = await request.post('/api/ai/tool', { data: { tool: name, input } });
  expect(res.ok(), await res.text()).toBe(true);
  const { result } = await res.json();
  return result;
}

test.describe('tool cho Agent', () => {
  test('KHÔNG có tool publish, rollback hay xoá', async ({ request }) => {
    // Phép kiểm quan trọng nhất của cả lớp AI, và nó không bao giờ được nới. Ranh
    // giới giữ được bằng cách không cấp công cụ — xem HANDOFF §2.4.
    const res = await request.get('/api/ai/tool');
    const { tools } = await res.json();
    const names = (tools as { name: string }[]).map((t) => t.name);

    expect(names.some((n) => /publish|rollback/i.test(n))).toBe(false);
    expect(names.some((n) => /^delete_|_delete$|xoa/i.test(n))).toBe(false);
  });

  /*
   * KHÔNG có test tạo trang thật ở đây, và đó là quyết định chứ không phải bỏ sót.
   *
   * Không có tool xoá trang — chủ ý của Đợt 2, vì xoá là việc một chiều của người.
   * Nên một e2e tạo trang KHÔNG dọn được qua HTTP, và nó sẽ để lại một trang vĩnh
   * viễn mà lần publish tiếp theo đưa lên site thật. Một test để lại dữ liệu vĩnh
   * viễn tệ hơn là không có test cho đường đó — xem HANDOFF §3.25.
   *
   * Đường tạo trang được phủ ở tầng khác: `create-page.test.ts` cho phần thuần, và
   * một lượt gọi tay qua curl lúc thi công (dọn bằng psql). Ở đây chỉ kiểm nhánh
   * TỪ CHỐI, vốn không ghi gì.
   */
  test('create_page từ chối slug đã tồn tại', async ({ request }) => {
    // `list_pages` trả `path` ("/", "/gioi-thieu"), KHÔNG phải `slug`. Hai thứ khác
    // nhau một dấu gạch chéo, và `create_page` nhận slug — nên phải cắt.
    const pages = await tool(request, 'list_pages', {});
    const path = (pages.pages as { path: string }[]).find((p) => p.path !== '/')?.path;
    expect(path, 'cần ít nhất một trang không phải trang chủ để thử').toBeTruthy();

    const slug = path!.replace(/^\//, '');
    const r = await tool(request, 'create_page', { title: 'Trùng slug', slug });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/đã tồn tại/i);
  });

  test('get_draft_diff báo bản nháp so với live', async ({ request }) => {
    const diff = await tool(request, 'get_draft_diff', {});
    expect(typeof diff.summary).toBe('string');
    expect(Array.isArray(diff.pages)).toBe(true);

    // Mỗi trang phải mang một trong ba trạng thái đã định nghĩa. Một chuỗi lạ ở đây
    // nghĩa là người soát đọc được một từ mà không ai định nghĩa.
    for (const p of diff.pages) {
      expect(['moi', 'da-sua', 'khong-doi']).toContain(p.status);
    }
  });

  test('dry-run KHÔNG ghi gì', async ({ request }) => {
    const pages = await tool(request, 'list_pages', {});
    const pageId = pages.pages[0].id as string;

    const outline = await tool(request, 'get_page_outline', { pageId });
    const before = outline.nodeCount ?? Object.keys(outline.nodes ?? {}).length;

    const dry = await tool(request, 'apply_ops', {
      pageId,
      dryRun: true,
      ops: [{ op: 'setName', nodeId: outline.rootId ?? 'root', name: 'TEN DRY RUN' }],
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.wouldApply).toBe(1);

    // Đọc lại: tên KHÔNG được đổi, và số node không đổi.
    const after = await tool(request, 'get_page_outline', { pageId });
    expect(after.nodeCount ?? Object.keys(after.nodes ?? {}).length).toBe(before);
    expect(JSON.stringify(after)).not.toContain('TEN DRY RUN');
  });

  test('upload_asset từ chối filePath khi gọi qua HTTP', async ({ request }) => {
    // Server không có đĩa của người dùng, và đọc một đường dẫn tuỳ ý từ phía server
    // là một lỗ đọc file. Nhánh `filePath` CHỈ chạy trong mcp/server.mjs.
    const r = await tool(request, 'upload_asset', { filePath: 'C:/Windows/win.ini' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MCP server/i);
  });

  test('set_translation từ chối ngôn ngữ gốc', async ({ request }) => {
    // Chữ gốc sống trong doc. Cho ghi vào bảng dịch là tạo hai nguồn sự thật cho
    // cùng một chuỗi, và chúng sẽ lệch nhau.
    const pages = await tool(request, 'list_pages', {});
    const r = await tool(request, 'set_translation', {
      pageId: pages.pages[0].id,
      locale: 'vi',
      nodeId: 'bat-ky',
      field: 'content',
      value: [{ t: 'text', v: 'x' }],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ngôn ngữ gốc/i);
  });
});

/**
 * Bề mặt sửa MỚI của bảng thuộc tính, nhìn từ phía Agent.
 *
 * Hợp đồng vẫn là hợp đồng cũ: thứ gì người dùng làm được trong panel, Agent làm
 * được qua MCP. Đợt này panel có thêm hai việc — sửa chữ tại chỗ, và đọc property
 * CSS mà mỗi ô phát ra — nên phải chứng minh Agent làm được CẢ HAI, và làm được một
 * cách AN TOÀN: nó phải biết đơn vị nào không sửa được bằng chuỗi trước khi ghi.
 */
test.describe('sửa chữ và đọc style qua MCP', () => {
  test('list_text_units nói rõ flat và op phải dùng', async ({ request }) => {
    const pages = await tool(request, 'list_pages', {});
    const pageId = pages.pages[0].id as string;

    const r = await tool(request, 'list_text_units', { pageId, limit: 100 });
    expect(r.units.length).toBeGreaterThan(0);

    for (const u of r.units as {
      key: string;
      field: string;
      flat: boolean;
      writeWith: string;
      valueKind: string;
    }[]) {
      /*
       * Bảy field, không còn bốn.
       *
       * `assetId` / `posterAssetId` / `href` được thêm khi bản dịch cần đổi được CẢ
       * ảnh, video và đích link — một trang tiếng Anh dùng ảnh có chữ tiếng Việt là
       * một trang chưa dịch, và nút đổi ngôn ngữ phải trỏ về bản kia chứ không về
       * chính nó. Xem docblock `TranslatableField`.
       *
       * Cộng họ `param:<đường dẫn>` — chữ trong params của Composite (mục lục chương,
       * nhãn form, tiêu đề máy tính tiết kiệm), theo whitelist `TRANSLATABLE_PARAMS`.
       */
      expect(u.key).toMatch(
        /^[\w-]+(\/[\w-]+)?:(content|label|alt|a11yLabel|assetId|posterAssetId|href|param:[\w.]+)$/,
      );
      /*
       * Và vì danh sách không còn thuần chữ, nó phải TỰ NÓI ra điều đó.
       *
       * Ba field mới đều `flat: true`, nên `editableOnly: true` trả chúng ra cùng
       * văn xuôi. Agent được bảo "dịch trang này" mà không có `valueKind` sẽ ghi một
       * câu tiếng Anh vào `assetId`: `setProps` nhận vì nó là string hợp lệ, rồi
       * renderer tra một asset không tồn tại và ảnh mất — không lỗi, không log.
       */
      expect(['text', 'asset', 'href']).toContain(u.valueKind);
      const expectedKind =
        u.field === 'assetId' || u.field === 'posterAssetId'
          ? 'asset'
          : u.field === 'href'
            ? 'href'
            : 'text';
      expect(u.valueKind, `${u.key} nói sai loại giá trị`).toBe(expectedKind);
      expect(typeof u.flat).toBe('boolean');
      // Nói THẲNG op, không để Agent suy: suy sai với chữ trong instance nghĩa là
      // `setText` vào cây component, tức đổi mọi trang đang dùng nó.
      expect(['setText', 'setProps', 'setOverride']).toContain(u.writeWith);
    }

    // Chữ trong instance phải luôn là setOverride — không có ngoại lệ.
    const inInstance = (r.units as { key: string; writeWith: string }[]).filter((u) =>
      u.key.includes('/'),
    );
    for (const u of inInstance) expect(u.writeWith).toBe('setOverride');
  });

  test('Agent sửa được chữ, và render đổi theo', async ({ request }) => {
    const pages = await tool(request, 'list_pages', {});
    const pageId = pages.pages[0].id as string;

    // Chỉ lấy đơn vị SỬA ĐƯỢC — đúng cái mà `editableOnly` tồn tại để làm.
    const list = await tool(request, 'list_text_units', {
      pageId,
      editableOnly: true,
      limit: 50,
    });
    const unit = (list.units as { nodeId: string; field: string; text: string; writeWith: string }[])
      .find((u) => u.writeWith === 'setText' && u.text.length > 3);
    expect(unit, 'cần một đơn vị chữ phẳng để thử').toBeTruthy();

    const before = unit!.text;
    cleanup = () =>
      request.post('/api/ai/tool', {
        data: {
          tool: 'apply_ops',
          input: {
            pageId,
            label: 'e2e agent-tools — hoàn nguyên chữ',
            ops: [
              { op: 'setText', nodeId: unit!.nodeId, field: unit!.field, value: [{ t: 'text', v: before }] },
            ],
          },
        },
      });

    const after = `${before} ·mcp`;
    const w = await tool(request, 'apply_ops', {
      pageId,
      label: 'e2e agent-tools — sửa chữ',
      ops: [
        { op: 'setText', nodeId: unit!.nodeId, field: unit!.field, value: [{ t: 'text', v: after }] },
      ],
    });
    expect(w.ok, JSON.stringify(w)).toBe(true);

    // Chứng minh ở đầu ra THẬT, không ở giá trị trả về của tool.
    const html = await (await request.get(`/render/${pageId}`)).text();
    expect(html).toContain('·mcp');

    // Và đọc lại bằng chính tool đọc: khoá không đổi, chữ đổi.
    const again = await tool(request, 'list_text_units', { pageId, text: 'mcp', limit: 5 });
    expect(again.units[0].text).toContain('·mcp');
  });

  test('resolve_style nói property CSS và ai đang đè', async ({ request }) => {
    const pages = await tool(request, 'list_pages', {});
    const pageId = pages.pages[0].id as string;
    const outline = await tool(request, 'get_page_outline', { pageId });

    const r = await tool(request, 'resolve_style', {
      pageId,
      nodeId: outline.rootId,
      breakpoint: 'base',
    });

    // Bản đồ lớp: đủ năm lớp, mỗi lớp có số đếm — đúng thứ panel bày thành dải chip.
    for (const bp of ['base', 'sm', 'md', 'lg', 'xl']) {
      expect(r.layers[bp], `thiếu lớp ${bp}`).toBeTruthy();
      expect(typeof r.layers[bp].count).toBe('number');
    }

    // Mỗi ô có giá trị đều nói property CSS nó phát ra. Đây là thứ cho Agent hiểu
    // "đổi width" = `size.width` = `inline-size`, thay vì phải đoán.
    for (const f of r.fields as { field: string; cssProperty: string }[]) {
      expect(f.field).toMatch(/^\w+\.\w+$/);
      expect(f.cssProperty).toMatch(/^[a-z-]+$/);
    }
  });
});
