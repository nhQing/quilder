/**
 * Tìm mọi binding `source: 'site'` trong một cây node.
 *
 * ## Vì sao cần
 *
 * `Site.globals` là nguồn cho binding `source:'site'` — tên công ty, hotline,
 * **số giấy phép**, link store. `bindings.ts` nói rõ vì sao nó tồn tại: *"số giấy
 * phép và hotline xuất hiện ở cả trust bar lẫn footer. Gõ tay hai nơi nghĩa là
 * một ngày nào đó chúng lệch nhau — với một công ty tài chính thì đó là vấn đề
 * tuân thủ, không phải lỗi chính tả."*
 *
 * Hệ quả: **xoá một khoá trong `globals` là một thao tác nguy hiểm.** Binding trỏ
 * vào khoá đã mất sẽ rơi về `fallback` — tức chuỗi tác giả gõ sẵn từ lâu. Trang
 * vẫn hiện, vẫn 200, và có thể đang hiện một **số giấy phép cũ**. Đó là loại lỗi
 * tệ nhất: nó *trông* bình thường.
 *
 * Hàm này để màn Cài đặt trả lời được "khoá này đang dùng ở đâu" TRƯỚC khi cho xoá.
 *
 * ## Vì sao duyệt theo cấu trúc, không theo kiểu
 *
 * `bind` là một `InlineNode`, nên nó nằm trong `content` của Text, `label` của
 * Button, và bên trong `em`/`strong`/`link`/`split` lồng nhau. Duyệt theo kiểu sẽ
 * cần biết trước mọi chỗ RichText có thể xuất hiện — và bỏ sót một chỗ nghĩa là
 * báo "khoá không được dùng" cho một khoá đang được dùng, tức đúng câu trả lời
 * sai gây hại nhất.
 *
 * Duyệt cấu trúc thì nó cũng chạy được trên `Preset.tree` (hình dạng
 * `{ rootId, nodes }`, không phải `Doc`) mà không sửa gì — và 154 tham chiếu
 * `$token` từng được đo trong presets là bằng chứng rằng bỏ qua chúng là bỏ sót thật.
 */

/**
 * Khoá `globals` chứa bảng URL của backend.
 *
 * MỘT bảng cho mọi endpoint (`endpoint.newsletter`, `endpoint.nav`, …), không mỗi
 * composite một khoá riêng. Hai khoá gần giống nhau (`formEndpoint`,
 * `navEndpoint`) là hai cơ chế cho cùng một thứ, và màn Cài đặt sẽ bày ra hai chỗ
 * để sửa "URL của BE" — đúng loại trùng lặp mà `Grid.columns` đã dạy một lần.
 *
 * Hằng ở đây chứ không gõ chuỗi ở mỗi chỗ dùng: `siteEndpoint` đọc cùng khoá này,
 * và hai bản của một tên là hai bản sẽ lệch — bản lệch làm phép đếm "khoá này dùng
 * ở đâu" trả rỗng cho một khoá đang được dùng.
 */
export const ENDPOINT_KEY = 'endpoint';

/** Composite nào giữ một khoá trong bảng `endpoint`. */
const ENDPOINT_COMPOSITES = new Set(['Form', 'NavChart']);

/**
 * `endpointKey` → URL thật, đọc từ `Site.globals.endpoint`.
 *
 * ## Vì sao qua globals chứ không nằm trong params
 *
 * `params` là thứ content editor sửa trong Inspector và AI ghi qua `setProps`.
 * Một URL tự do ở đó biến builder thành công cụ gửi dữ liệu khách tới bất kỳ đâu
 * (với `Form`) hoặc kéo nội dung từ bất kỳ đâu vào trang (với `NavChart`), và
 * trong diff nó trông y như một thay đổi nội dung.
 *
 * `globals` được seal vào `Release`, nên đổi URL vẫn phải Publish — tính chất ĐÚNG
 * cho trường này, cùng lý do như số giấy phép.
 *
 * Trả `null` khi thiếu, và bên gọi phải render trạng thái VÔ HIỆU KÈM LÝ DO. Rơi
 * về chuỗi rỗng hay một URL mặc định thì khối trông bình thường mà không hoạt
 * động — đúng loại im lặng mà `Canvas.fallbackChildId` bắt buộc khai để tránh.
 *
 * Ở đây (module thuần) chứ không ở `NodeRenderer`: tầng trang cũng cần nó để
 * fetch TRƯỚC khi render, và `NodeRenderer` là đồng bộ nên không fetch được.
 */
export function siteEndpoint(
  globals: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const table = globals?.[ENDPOINT_KEY];
  if (!table || typeof table !== 'object' || Array.isArray(table)) return null;
  const url = (table as Record<string, unknown>)[key];
  // Chỉ http(s): một `javascript:` hay `data:` ở đây là XSS qua đường cấu hình.
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  return url;
}

/** Khoá `globals` → danh sách nodeId dùng nó. */
export type SiteBindingUsage = Map<string, string[]>;

/**
 * `path` trong binding có thể viết kèm tiền tố nguồn (`site.phone`) hoặc không
 * (`phone`) — `formatBinding` chấp nhận cả hai và gỡ tiền tố. Ở đây phải gỡ đúng
 * như vậy, nếu không cùng một khoá sẽ đếm thành hai.
 */
function keyOf(path: string): string {
  const p = path.startsWith('site.') ? path.slice(5) : path;
  // Chỉ lấy đoạn ĐẦU: `store.ios` là khoá `store` với một đường dẫn con.
  return p.split('.')[0] ?? '';
}

export function findSiteBindings(tree: unknown, out: SiteBindingUsage = new Map()): SiteBindingUsage {
  const walk = (value: unknown, nodeId: string) => {
    if (Array.isArray(value)) {
      for (const v of value) walk(v, nodeId);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const o = value as Record<string, unknown>;

    /*
     * `Form` và `NavChart` giữ một khoá `globals` mà KHÔNG qua `bind`.
     *
     * `endpointKey` trỏ vào `Site.globals.endpoint`, nên xoá khoá đó là gỡ đích
     * gửi của mọi form VÀ nguồn số của mọi biểu đồ trên site. Không đếm nó ở đây
     * thì màn Cài đặt báo "khoá này không được dùng ở đâu" cho một khoá đang giữ
     * chúng — đúng câu trả lời sai gây hại nhất, và đúng thứ hàm này tồn tại để ngăn.
     *
     * Đếm dưới khoá TỔNG (`endpoint`), không dưới `endpoint.<key>`: khoá mà người
     * dùng xoá được ở màn Cài đặt là khoá cấp một, và `keyOf` cũng chỉ lấy đoạn
     * đầu. Còn thiếu một khoá CON thì renderer đã lo — khối hiện vô hiệu kèm lý do.
     */
    if (o.type === 'Composite' && typeof o.composite === 'string'
        && ENDPOINT_COMPOSITES.has(o.composite)) {
      const params = o.params as { endpointKey?: unknown } | null | undefined;
      if (params && typeof params === 'object') {
        const list = out.get(ENDPOINT_KEY) ?? [];
        if (!list.includes(nodeId)) list.push(nodeId);
        out.set(ENDPOINT_KEY, list);
      }
      // KHÔNG `return`: node vẫn có thể mang `bind` trong a11yLabel hay trong
      // params khác, và slot của nó là node riêng nên vòng lặp dưới vẫn phải chạy.
    }

    if (o.t === 'bind' && o.ref && typeof o.ref === 'object') {
      const ref = o.ref as { source?: unknown; path?: unknown };
      if (ref.source === 'site' && typeof ref.path === 'string') {
        const key = keyOf(ref.path);
        if (key) {
          const list = out.get(key) ?? [];
          if (!list.includes(nodeId)) list.push(nodeId);
          out.set(key, list);
        }
      }
      return;
    }

    for (const [k, v] of Object.entries(o)) {
      // Khi đi vào map `nodes`, khoá CHÍNH LÀ nodeId — mang nó theo để báo cáo
      // chỉ được đúng node, không chỉ đúng trang.
      walk(v, k === 'nodes' ? nodeId : nodeId);
    }
  };

  const t = tree as { nodes?: Record<string, unknown> } | null;
  if (t?.nodes && typeof t.nodes === 'object') {
    for (const [nodeId, node] of Object.entries(t.nodes)) walk(node, nodeId);
  } else {
    walk(tree, '(gốc)');
  }

  return out;
}
