import { expect, test, type APIRequestContext } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * Đường vào bằng token service — thứ MCP server dùng.
 *
 * Đây là bề mặt xác thực THỨ HAI của hệ thống (bên cạnh cookie trình duyệt), và
 * là đường mà một tiến trình tự động dùng để ghi vào site. Mỗi test ở đây khoá
 * lại một tính chất mà nếu vỡ thì vỡ im lặng:
 *
 *  - Bearer sai vẫn bị chặn (không được nới lỏng khi thêm đường mới)
 *  - Phân quyền theo TỪNG tool, không theo endpoint
 *  - AI ghi được bản nháp nhưng KHÔNG chạm được site đang publish
 */

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET!);

async function serviceToken(payload: {
  sub: string; email: string; role: string;
}): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role, kind: 'service' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret());
}

/** Gọi tool bằng Bearer, KHÔNG mang cookie phiên. */
async function tool(
  request: APIRequestContext,
  token: string | null,
  name: string,
  input: unknown = {},
) {
  return request.post('/api/ai/tool', {
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    data: { tool: name, input },
  });
}

test.describe('token service', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('không token thì không vào được', async ({ request }) => {
    const res = await request.get('/api/ai/tool');
    expect(res.status()).toBe(401);
  });

  test('token rác bị từ chối', async ({ request }) => {
    const res = await request.get('/api/ai/tool', {
      headers: { authorization: 'Bearer khong-phai-jwt' },
    });
    expect(res.status()).toBe(401);
  });

  test('token ký bằng khoá khác bị từ chối', async ({ request }) => {
    // Chữ ký là thứ duy nhất phân biệt token thật với token do người khác tự
    // chế. Test này chứng minh nó thật sự được kiểm, chứ không phải chỉ decode.
    const forged = await new SignJWT({ email: 'ke-gia-mao@x.com', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('gia-mao')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('khoa-sai-nhung-du-dai-32-ky-tu-tro-len!!'));

    const res = await request.get('/api/ai/tool', {
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('phân quyền theo từng tool', () => {
  test('viewer đọc được nhưng KHÔNG ghi được', async ({ request }) => {
    // request ở đây có phiên admin (storageState) để tạo tài khoản thử.
    const email = `viewer-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const created = await request.post('/api/users', {
      data: { email, password: 'mat-khau-du-dai', role: 'viewer' },
    });
    expect(created.ok()).toBe(true);
    const { user } = await created.json();

    const token = await serviceToken({ sub: user.id, email, role: 'viewer' });

    const read = await tool(request, token, 'list_pages');
    expect(read.status()).toBe(200);
    expect((await read.json()).ok).toBe(true);

    // Ẩn tool đi không phải là cổng — endpoint phải tự từ chối.
    const write = await tool(request, token, 'apply_ops', {
      pageId: 'bat-ky',
      ops: [{ op: 'removeNode', nodeId: 'x' }],
    });
    expect(write.status()).toBe(403);

    await request.delete(`/api/users/${user.id}`);
  });
});

test.describe('AI chỉ chạm bản nháp', () => {
  test('apply_ops đổi nháp, site đang publish giữ nguyên', async ({ request }) => {
    const me = await (await request.get('/api/auth/me')).json();
    const token = await serviceToken({ sub: me.id, email: me.email, role: me.role });

    const pages = await (await tool(request, token, 'list_pages')).json();
    const page = pages.result.pages.find((p: { published: boolean }) => p.published);
    expect(page, 'cần ít nhất một trang đã publish để test có nghĩa').toBeTruthy();

    const marker = `MCP-E2E-${Date.now()}`;
    const outline = await (
      await tool(request, token, 'get_page_outline', { pageId: page.id })
    ).json();
    const textNode = outline.result.nodes.find(
      (n: { type: string; text?: string }) => n.type === 'Text' && n.text,
    );
    expect(textNode).toBeTruthy();

    // Dàn ý CẮT text ở 60 ký tự và thêm '…'. Khôi phục từ giá trị đó sẽ ghi đè
    // nội dung thật bằng bản cụt — một test dọn dẹp không sạch sẽ âm thầm phá
    // dữ liệu. Lấy nội dung đầy đủ từ get_node.
    const detail = await (
      await tool(request, token, 'get_node', { pageId: page.id, nodeIds: [textNode.id] })
    ).json();
    const original = detail.result.nodes[textNode.id].content;

    // try/finally, KHÔNG phải dọn dẹp ở cuối thân hàm.
    //
    // Bài học phải trả giá thật: bản đầu của test này dọn ở dòng cuối, rồi một
    // assertion phía trên fail — nên phần dọn không bao giờ chạy và bản nháp
    // đọng lại marker. Sau đó `users.spec.ts` gọi /api/publish (để chứng minh
    // editor publish được) và đẩy luôn marker đó lên site thật.
    //
    // Nghĩa là: trong bộ test này, một bản nháp bẩn KHÔNG chỉ là rác — nó là
    // một thay đổi trên site đang chạy, chờ test kế tiếp bấm nút.
    try {
      const applied = await (
        await tool(request, token, 'apply_ops', {
          pageId: page.id,
          label: 'e2e mcp',
          ops: [
            {
              op: 'setText',
              nodeId: textNode.id,
              field: 'content',
              value: [{ t: 'text', v: marker }],
            },
          ],
        })
      ).json();
      expect(applied.result.ok).toBe(true);

      // Site thật: KHÔNG được đổi. Tính chất quan trọng nhất của cả lớp AI.
      //
      // So sánh NỘI DUNG chứ không so sánh nguyên byte: dev server của Next gắn
      // một timestamp chống cache vào link CSS, nên hai lần tải cùng một trang
      // không bao giờ giống nhau từng byte, kể cả khi không ai sửa gì.
      const after = await (await request.get(page.path)).text();
      expect(after).not.toContain(marker);

      // Bản nháp: PHẢI đổi.
      const preview = await (await request.get(page.previewUrl)).text();
      expect(preview).toContain(marker);
    } finally {
      const restored = await (
        await tool(request, token, 'apply_ops', {
          pageId: page.id,
          label: 'e2e mcp — hoàn tác',
          ops: [{ op: 'setText', nodeId: textNode.id, field: 'content', value: original }],
        })
      ).json();
      expect(restored.result?.ok, 'khôi phục thất bại — bản nháp còn dính marker').toBe(true);
    }

    // Chứng minh bản nháp đã sạch, thay vì tin là nó sạch.
    const draft = await (await request.get(page.previewUrl)).text();
    expect(draft).not.toContain(marker);
  });

  test('không tool nào publish trang; đăng bản dịch phải có cờ trên token', async ({
    request,
  }) => {
    const catalog = await (await request.get('/api/ai/tool')).json();
    const names = catalog.tools.map((t: { name: string }) => t.name);
    expect(names).not.toEqual(expect.arrayContaining([expect.stringMatching(/publish|rollback|release/i)]));
    /**
     * Tool GHI được liệt kê tường minh, không phải đếm.
     *
     * Đây là rào chắn thật của nguyên tắc "AI không bao giờ publish": nguyên tắc
     * đó được bảo đảm bằng cách KHÔNG CUNG CẤP tool, nên mỗi tool ghi thêm vào
     * phải đi qua đây và được nhìn tận mắt đúng một lần.
     *
     * Sắp xếp trước khi so: thứ tự trong `TOOLS` là thứ tự bày cho model đọc,
     * không phải hợp đồng — neo test vào nó sẽ đỏ mỗi lần có người đổi chỗ hai
     * dòng.
     */
    const writers = catalog.tools
      .filter((t: { readOnly: boolean }) => !t.readOnly)
      .map((t: { name: string }) => t.name)
      .sort();

    expect(writers).toEqual(
      [
        // Ghi vào BẢN NHÁP của trang.
        'apply_ops',
        'create_page',

        // Bước ghi của `clone_url`: tạo một trang MỚI (noindex) từ cây node đã trích.
        // Cùng nhóm với `create_page` — chỉ tạo bản nháp, không bao giờ ghi đè trang
        // có sẵn (slug trùng là lỗi), không publish.
        'create_clone_draft',

        // Ghi `Page.slug` / `Page.title`, không phải `doc` — xem `site-tools.ts`.
        // Đáng đứng riêng một dòng ghi chú vì nó là tool ghi duy nhất chạm ĐỊNH
        // TUYẾN: đổi slug là đổi URL công khai, và với trang đã publish nó còn tự
        // sinh redirect 301. Vẫn là bản nháp — bản đang chạy giữ slug cũ trong ảnh
        // chụp release của nó cho tới lần Publish sau.
        'update_page',

        // Ghi vào THƯ VIỆN component. Không trang đang chạy nào bị ảnh hưởng ngay:
        // trang cắm Instance chỉ thấy thay đổi ở lần Publish kế tiếp (release chụp
        // thư viện), còn bản đã chèn bằng `insertNode` là bản sao, không đổi theo.
        'apply_component_ops',
        'create_component',
        'duplicate_component',
        'update_component',

        // Ghi vào bảng Translation — cũng là BẢN NHÁP. `Release.translations` chụp
        // lại lúc publish, nên sửa ở đây không chạm site đang chạy.
        'set_translation',

        // Ghi vào kho asset. Khác ba nhóm trên ở một điểm đáng biết: object trên S3
        // ghi rồi là VĨNH VIỄN (khoá theo nội dung, cache immutable), nên "bản nháp"
        // ở đây nghĩa là hàng `Asset` chưa được release nào chụp — chứ không phải
        // file có thể lấy lại được.
        'upload_asset',

        /*
         * Ghi vào bảng `Entry` — và đây là nhóm KHÁC BẢN CHẤT với mọi nhóm trên,
         * nên nó phải được đọc kỹ chứ không chỉ được thêm vào cho test xanh.
         *
         * `Entry` là ngoại lệ LIVE đã được đặt tên của dự án: nó KHÔNG nằm trong
         * ảnh chụp `Release`, nên một hàng ghi ở đây là ghi vào cùng bảng mà site
         * đang chạy đọc. "Bản nháp" ở đây không do release bảo đảm, mà do đúng hai
         * chốt trong code bảo đảm:
         *
         *   - `create_entry` đóng cứng `status: 'draft'` (`collection-tools.ts`),
         *   - `update_entry` luôn truyền `requireDraft: true`, và `entry-write.ts`
         *     kiểm lại bằng một `updateMany` có điều kiện NGAY TRONG giao dịch —
         *     nên một bài vừa được người dùng Đăng ở tab khác không bị sửa mất.
         *
         * Bỏ một trong hai chốt đó là AI sửa được bài đang hiển thị công khai.
         * Không có `publish_entry`, và sẽ không có: đăng là hành động của con người.
         */
        'create_entry',
        'update_entry',

        /*
         * Ghi vào `EntryLocale` — và đây là tool GHI ĐẦU TIÊN của dự án có thể làm
         * một thứ hiện ra trên site công khai. Nên nó phải được đọc hết đoạn này.
         *
         * Nguyên tắc cũ là "AI không bao giờ publish", bảo đảm bằng cách không cung
         * cấp tool. Nó vẫn đúng cho TRANG: không có `publish_page`, và sẽ không có.
         *
         * Với BẢN DỊCH của một entry thì nguyên tắc đã được nới, có ý thức, vì luật
         * cũ đòi một cái giá vô lý: `requireDraft` trước đây chặn mọi lượt ghi vào
         * bài đã đăng, nên muốn dịch một bài đang chạy thì phải hạ nó xuống nháp —
         * tức là tự tay làm site khuyết một khoảng để dịch. Bản dịch lại là thứ
         * KHÔNG ai đang xem: nó nằm sau một URL chưa mở.
         *
         * Nới tới đâu, và ai giữ:
         *
         *   - ghi NỘI DUNG bản dịch (`update_entry` với `i18n`) — tự do, vì lớp phủ
         *     đó không xuất hiện ở đâu cho tới khi có người/máy đăng nó;
         *   - ĐĂNG bản dịch (`set_entry_locale` với `status: 'published'`) — chỉ đi
         *     qua khi token mang `ServiceToken.canPublishLocale`, mặc định `false`,
         *     bật một lần có ý thức lúc cấp ở `/builder/claude`, và vì cờ KHÔNG nằm
         *     trong JWT nên tắt đi là có hiệu lực ngay ở lượt gọi sau;
         *   - nội dung BẢN GỐC của bài đã đăng — vẫn khoá như cũ. `needsDraftGate`
         *     (`entry-write.ts`) là chỗ đường ranh đó nằm, và `entry-write.test.ts`
         *     khoá nó lại bằng cặp test "i18n qua được / data thì không".
         *
         * Lưu ý cho người đọc phép kiểm TÊN ở đầu test này: từ giờ nó không còn
         * chứng minh được "không tool nào publish". `set_entry_locale` không khớp
         * /publish/, nên phép kiểm ấy chỉ còn ngăn người ta THÊM một tool tên
         * publish/rollback/release. Thứ thật sự giữ ranh giới là cờ trên token, và
         * chỗ chứng minh nó là test đơn vị nói trên — không phải tên tool.
         */
        'set_entry_locale',

        // Ghi CẤU TRÚC danh mục, không phải nội dung. Không có `delete_taxonomy`:
        // xoá một mục là gỡ liên kết của mọi bài đang gắn nó, và không có đường lùi.
        'create_taxonomy',
      ].sort(),
    );

    /*
     * Và cờ ấy phải THẬT SỰ chặn, không chỉ được ghi trong chú thích.
     *
     * Test này chạy bằng cookie trình duyệt — không có `jti`, nên không có hàng
     * `ServiceToken`, nên không có cờ. Đó chính là trường hợp đáng khoá lại: AI
     * trong builder ngồi dưới quyền một admin, và nó vẫn không được đăng.
     *
     * `entryId` cố tình KHÔNG tồn tại. Nếu phép kiểm quyền bị dịch xuống sau lượt
     * ghi, câu trả về sẽ là "không tìm thấy bài" — và test đỏ. Nói cách khác nó
     * chứng minh luôn thứ tự: cửa quyền đứng trước, đúng như docblock của
     * `set_entry_locale` khẳng định. Kiểm sau khi ghi sẽ để lại một hàng
     * `EntryLocale` đã đổi kèm một câu lỗi, và người đọc tưởng không có gì xảy ra.
     */
    const denied = await (
      await request.post('/api/ai/tool', {
        data: {
          tool: 'set_entry_locale',
          input: { entryId: 'khong-ton-tai', locale: 'en', status: 'published' },
        },
      })
    ).json();
    expect(denied.result?.ok, 'phiên trình duyệt đăng được bản dịch — cờ không chặn').toBe(
      false,
    );
    expect(denied.result?.error).toMatch(/không có quyền đăng bản dịch/i);
  });
});
