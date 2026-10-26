import 'server-only';

/**
 * Tool cho Agent tạo trang, tạo component và ghi bản dịch.
 *
 * ## Mỗi tool ở đây là một lớp MỎNG
 *
 * Không có luật nghiệp vụ nào sống trong file này. Nếu bạn thấy mình viết một luật
 * ở đây thì luật đó thuộc về `src/lib/builder/`, nơi route HTTP cũng gọi tới — nếu
 * không thì builder và Agent sẽ dần cư xử khác nhau, và không ai biết bên nào đúng.
 *
 * ## Vẫn KHÔNG có publish
 *
 * Đợt này thêm nhiều tool ghi nhất từ trước tới nay, nên nhắc lại HANDOFF §2.4:
 * đưa thay đổi ra site thật là hành động của con người. Ranh giới đó giữ được bằng
 * cách không cấp công cụ, không phải bằng cách dặn model.
 *
 * Và không có tool XOÁ trang / component / bản dịch hàng loạt. Xoá là việc một
 * chiều; `set_translation` với `value: null` là ngoại lệ duy nhất, và nó hẹp.
 */

import { z } from 'zod';

import { createComponent } from '@/lib/builder/create-component';
import { createPage } from '@/lib/builder/create-page';
import {
  PAGE_PARAM_ROLES,
  PARAM_ROLE_EXAMPLE,
  type PageCollection,
} from '@/lib/builder/page-collection';
import { renamePage } from '@/lib/builder/rename-page';
import { setPageCollection } from '@/lib/builder/set-page-collection';
import { setPageSeo, type PageSeoInput } from '@/lib/builder/set-page-seo';
import { draftDiff, summarize } from '@/lib/builder/draft-diff';
import { setTranslation } from '@/lib/builder/set-translation';
import { prisma } from '@/lib/db';
import type { ToolContext, ToolDef } from './tools';

/**
 * Lời khai "trang này là mặt tiền của loại nội dung nào".
 *
 * Mô tả phải nói THẲNG luật độc quyền: agent đọc mô tả trước khi đọc lỗi, và một
 * agent bị từ chối ở lượt thứ hai thường thử lại với một `typeKey` khác thay vì hiểu
 * ra rằng loại đó đã có trang chi tiết rồi.
 */
const zCollection = z
  .object({
    typeKey: z.string().min(1).describe('Khoá của loại nội dung, ví dụ "tin-tuc".'),
    param: z
      .enum(PAGE_PARAM_ROLES as unknown as [string, ...string[]])
      .describe(
        'Đoạn động trong slug trỏ vào cái gì. ' +
          'list = trang liệt kê, slug KHÔNG có [..], ví dụ "blogs". ' +
          `entry = mỗi bài một trang, slug phải có [..], ví dụ "${PARAM_ROLE_EXAMPLE.entry}". ` +
          `taxonomy = mỗi danh mục (bảng Taxonomy) một trang, ví dụ "${PARAM_ROLE_EXAMPLE.taxonomy}". ` +
          'relation = đoạn động mang SLUG của một bản ghi thuộc loại ĐÍCH của một field ' +
          `relation, ví dụ "${PARAM_ROLE_EXAMPLE.relation}" cho loại "tin-tuc" lọc theo ` +
          'field "category" trỏ sang loại "danh-muc". Vai này BẮT BUỘC kèm `field`.',
      ),
    field: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe(
        'CHỈ dùng với param "relation", và bắt buộc ở đó: khoá của field `relation` ' +
          'trên `typeKey` mà đoạn động lấp giá trị vào. Loại ĐÍCH của field ấy là loại ' +
          'mang slug trên URL — không khai lại tên loại đó ở đây.',
      ),
  })
  .strict()
  /*
   * Luật "relation thì phải có field" cưỡng chế ở TẦNG ZOD, cùng chỗ và cùng lý do với
   * luật "from='fixed' thì phải có ids" của `CollectionFilter`: đây là tầng thật sự
   * chặn dữ liệu đến từ AI qua MCP, và câu lỗi ở đây là câu model đọc được ngay lượt
   * sau. `checkCollectionPairing` vẫn kiểm lại — nó là đường chung cho cả builder —
   * nhưng nó nằm sau một lượt đọc DB.
   *
   * Chiều ngược lại cũng chặn: `field` trên một vai khác là lời khai KHÔNG BAO GIỜ
   * được đọc (`parsePageCollection` bỏ nó), nên im lặng nhận nó là để người dựng tin
   * rằng mình vừa cấu hình xong một trang danh mục.
   */
  .superRefine((v, ctx) => {
    if (v.param === 'relation' && !v.field) {
      ctx.addIssue({
        code: 'custom',
        path: ['field'],
        message:
          'param "relation" phải kèm `field` — khoá field relation trên `typeKey` mà đoạn ' +
          'động lấp vào. Không có nó thì đoạn động không tra được vào loại nào.',
      });
    }
    if (v.param !== 'relation' && v.field) {
      ctx.addIssue({
        code: 'custom',
        path: ['field'],
        message: `\`field\` chỉ có nghĩa với param "relation"; vai "${v.param}" không đọc tới nó.`,
      });
    }
  })
  .nullable();

type CollectionArg = PageCollection | null;

const COLLECTION_RULES =
  'ĐOẠN ĐỘNG VÀ LOẠI NỘI DUNG. Slug dùng đúng cú pháp Next.js: "blogs" là trang ' +
  'thường, "blogs/[category]" và "blogs/post/[slug]" là MẪU. Mỗi trang tối đa MỘT ' +
  'đoạn động, và nó không được đứng đầu. Trang có đoạn động BẮT BUỘC khai ' +
  '`collection`; trang không có đoạn động thì chỉ được khai `param: "list"`.\n\n' +
  'MỖI LOẠI NỘI DUNG CHỈ ĐƯỢC MỘT trang `entry`, MỘT trang `taxonomy` và MỘT trang ' +
  '`relation`. Không phải giới hạn tuỳ tiện: href của mọi thẻ tin suy ra từ trang ' +
  '`entry` của loại đó, nên hai trang là hai câu trả lời khác nhau cho cùng một câu hỏi.\n\n' +
  'HAI VAI DANH MỤC, CHỌN THEO MÔ HÌNH DỮ LIỆU. `taxonomy` cho loại có field `taxonomy` ' +
  '— đoạn động là `key` của một hàng trong bảng Taxonomy. `relation` cho loại mà danh ' +
  'mục là một field `relation` trỏ sang một loại nội dung KHÁC — đoạn động khi ấy là ' +
  '`slug` của một BẢN GHI đã đăng thuộc loại đích, và `field` nói field nào.';

const createPageTool: ToolDef = {
  name: 'create_page',
  title: 'Tạo trang',
  description:
    'Tạo một trang MỚI với cây node trống, ở trạng thái bản nháp.\n\n' +
    'Trang chỉ lên site thật sau khi người dùng bấm Publish trong builder. Sau khi ' +
    'tạo, dùng apply_ops để dựng nội dung, rồi đưa previewUrl cho người dùng xem.\n\n' +
    'Đường dẫn suy từ tiêu đề nếu không truyền `slug`. Truyền `slug: ""` để tạo trang chủ.\n\n' +
    COLLECTION_RULES,
  input: z
    .object({
      title: z.string().min(1).max(200),
      slug: z
        .string()
        .max(200)
        .optional()
        .describe('Bỏ trống để suy từ tiêu đề. Chuỗi rỗng "" nghĩa là trang chủ.'),
      collection: zCollection.optional().describe(
        'Trang này là mặt tiền của một loại nội dung. null = gỡ lời khai. ' +
          'Bắt buộc khi slug có đoạn động [..].',
      ),
    })
    .strict(),
  readOnly: false,
  async run(
    input: { title: string; slug?: string; collection?: CollectionArg },
    ctx: ToolContext,
  ) {
    const r = await createPage({
      title: input.title,
      slug: input.slug,
      collection: input.collection ?? null,
      actorEmail: ctx.session.email,
      actorSub: ctx.session.sub,
    });
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      pageId: r.page.id,
      slug: r.page.slug,
      previewUrl: `${ctx.origin}/preview/${r.page.id}`,
      note:
        'Trang mới còn TRỐNG — chỉ có một node Section. Dùng apply_ops với pageId ' +
        'này để dựng nội dung. Site thật chưa đổi.',
    };
  },
};

/**
 * Đổi tên / đổi đường dẫn một trang đã có.
 *
 * Tách khỏi `apply_ops` vì nó không đụng `doc`: slug và tiêu đề nằm trên `Page`.
 * Gộp vào một tool "sửa trang" chung sẽ làm một op nội dung và một op định tuyến
 * trông giống nhau trong mắt model — trong khi cái sau đổi URL công khai.
 */
const updatePageTool: ToolDef = {
  name: 'update_page',
  title: 'Đổi tiêu đề / đường dẫn trang',
  description:
    'Đổi tiêu đề và/hoặc đường dẫn (slug) của một trang đã có.\n\n' +
    'ĐỔI SLUG LÀ ĐỔI URL CÔNG KHAI. Với trang đã publish, hệ thống tự tạo chuyển ' +
    'hướng 301 từ địa chỉ cũ sang địa chỉ mới, nên link cũ không chết. Nhưng đây ' +
    'vẫn là việc người dùng phải muốn — đừng tự đổi slug khi họ chỉ nhờ sửa nội dung.\n\n' +
    'Không truyền `slug` = giữ nguyên đường dẫn. Truyền `slug: ""` = đưa trang này ' +
    'thành trang chủ.\n\n' +
    'Site thật KHÔNG đổi cho tới lần Publish tiếp theo: bản đang chạy giữ slug cũ ' +
    'trong ảnh chụp release của nó.\n\n' +
    COLLECTION_RULES,
  input: z
    .object({
      pageId: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      slug: z
        .string()
        .max(200)
        .optional()
        .describe('Bỏ trống để giữ nguyên. Chuỗi rỗng "" nghĩa là trang chủ.'),
      collection: zCollection.optional().describe(
        'Trang này là mặt tiền của một loại nội dung. null = gỡ lời khai. ' +
          'Bắt buộc khi slug có đoạn động [..].',
      ),
    })
    .strict(),
  readOnly: false,
  async run(
    input: { pageId: string; title?: string; slug?: string; collection?: CollectionArg },
    ctx: ToolContext,
  ) {
    const wantsCollection = input.collection !== undefined;
    if (input.title === undefined && input.slug === undefined && !wantsCollection) {
      return { ok: false, error: 'Cần title, slug hoặc collection' };
    }

    // Cùng thứ tự và cùng lý do như `PATCH /api/pages/:id` — xem comment ở đó. Lời
    // khai sắp tới đi vào phép kiểm cặp, rồi mới được ghi.
    const nextCollection = wantsCollection ? (input.collection ?? null) : undefined;

    if (input.title === undefined && input.slug === undefined) {
      const set = await setPageCollection({
        pageId: input.pageId,
        collection: nextCollection ?? null,
        actorSub: ctx.session.sub,
      });
      if (!set.ok) return { ok: false, error: set.error };
      return { ok: true, pageId: input.pageId, collection: set.collection };
    }

    const r = await renamePage({
      pageId: input.pageId,
      title: input.title,
      slug: input.slug,
      collection: nextCollection,
      actorSub: ctx.session.sub,
    });
    if (!r.ok) return { ok: false, error: r.error };

    if (wantsCollection) {
      const set = await setPageCollection({
        pageId: input.pageId,
        collection: nextCollection ?? null,
        actorSub: ctx.session.sub,
      });
      if (!set.ok) return { ok: false, error: set.error };
    }

    return {
      ok: true,
      pageId: r.page.id,
      slug: r.page.slug,
      title: r.page.title,
      redirected: r.redirected,
      ...(wantsCollection ? { collection: nextCollection ?? null } : {}),
      previewUrl: `${ctx.origin}/preview/${r.page.id}`,
      note: r.note,
    };
  },
};

/**
 * Mô tả, ảnh OG, canonical, noindex của một trang.
 *
 * ## Vì sao không gộp vào `update_page`
 *
 * Cùng lý do `PATCH /api/pages/[id]` tách nhánh SEO: tiêu đề/slug/collection ràng
 * buộc lẫn nhau và đổi slug là đổi URL công khai; bốn cột SEO thì độc lập với cả
 * ba. Gộp lại là để một lần sửa mô tả trông giống một lần đổi đường dẫn trong mắt
 * model.
 *
 * ## Khác các tool ghi khác: nó ra site NGAY
 *
 * Bốn cột nằm trên `Page`, ngoài doc, nên không chờ Publish (xem `setPageSeo`).
 * Mô tả tool phải nói thẳng điều đó — model quen với "chỉ ghi bản nháp".
 */
const setPageSeoTool: ToolDef = {
  name: 'set_page_seo',
  title: 'SEO của trang',
  description:
    'Đặt mô tả (meta description), ảnh OG, canonical và noindex cho một trang. Tiêu ' +
    'đề trang đổi bằng update_page.\n\n' +
    'KHÁC apply_ops: bốn cột này nằm trên hàng Page, không trong bản nháp, nên chúng ' +
    'ra site THẬT NGAY, không chờ Publish.\n\n' +
    'Chỉ truyền cột cần đổi; cột vắng mặt giữ nguyên. `null` (hoặc chuỗi rỗng) = gỡ.\n' +
    '- description: tối đa 300 ký tự; nên 120–160 vì máy tìm kiếm cắt phần dư.\n' +
    '- ogImageId: assetId từ upload_asset / list_assets. Bỏ trống thì dùng ảnh OG của site.\n' +
    '- canonical: URL tuyệt đối http(s) hoặc đường dẫn bắt đầu bằng "/". Thường KHÔNG cần — ' +
    'trang tự trỏ về chính nó.\n' +
    '- noindex: true = chặn máy tìm kiếm. Chỉ đặt khi người dùng muốn trang không lên Google.',
  input: z
    .object({
      pageId: z.string().min(1),
      description: z.string().max(300).nullable().optional(),
      ogImageId: z.string().max(60).nullable().optional(),
      canonical: z.string().max(2000).nullable().optional(),
      noindex: z.boolean().optional(),
    })
    .strict(),
  readOnly: false,
  async run(input: { pageId: string } & PageSeoInput, ctx: ToolContext) {
    const { pageId, ...seo } = input;
    const r = await setPageSeo({ pageId, input: seo, actorSub: ctx.session.sub });
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      pageId,
      seo: r.seo,
      note: 'Đã ghi lên trang, có hiệu lực trên site ngay — không cần Publish.',
    };
  },
};

/**
 * Khoá `site.globals` đang có, để Agent BIND thay vì gõ giá trị thật.
 *
 * ## Vì sao thiếu tool này là một lỗ, không phải một thiếu tiện nghi
 *
 * `bind` với `source:'site'` đọc theo TÊN KHOÁ. Không có tool nào liệt kê chúng thì
 * Agent phải đoán: `site.hotline` hay `site.phone` hay `site.hotlineNumber`. Đoán
 * sai không gây lỗi nào — binding rơi về chuỗi dự phòng, trang vẫn 200, vẫn hiện.
 * Với site tài chính thì một số giấy phép hiện ra chữ dự phòng là chuyện pháp lý.
 *
 * Trả cả GIÁ TRỊ, không chỉ tên khoá: Agent cần biết `hotline` là số điện thoại
 * chứ không phải một object, để chọn đúng chỗ đặt nó trong câu.
 */
const listSiteGlobalsTool: ToolDef = {
  name: 'list_site_globals',
  title: 'Cấu hình site',
  description:
    'Liệt kê khoá trong `site.globals` kèm giá trị hiện tại: tên công ty, hotline, ' +
    'số giấy phép, link store, và mọi thứ khác người dùng khai ở trang Cài đặt.\n\n' +
    'GỌI NÓ TRƯỚC KHI GÕ bất cứ giá trị nào thuộc về cấu hình. Builder này chạy cho ' +
    'nhiều dự án; gõ "1900 1234" vào cây node là làm trang đó chỉ dùng được cho một ' +
    'dự án. Thay vào đó dùng InlineNode `bind`:\n' +
    '  { "t":"bind", "ref":{ "source":"site", "path":"hotline" }, "fallback":"hotline" }\n\n' +
    'Khoá không có ở đây thì KHÔNG tự tạo bind tới nó — nói cho người dùng biết họ ' +
    'cần thêm khoá đó ở trang Cài đặt trước.',
  input: z.object({}).strict(),
  readOnly: true,
  async run() {
    const site = await prisma.site.findFirst({
      select: { name: true, primaryDomain: true, globals: true, faviconAssetId: true },
    });
    if (!site) return { ok: false, error: 'Chưa có site nào' };

    const globals = (site.globals ?? {}) as Record<string, unknown>;

    return {
      /*
       * `name` và `primaryDomain` là cột riêng trên `Site`, KHÔNG nằm trong
       * `globals` — nên chúng không bind được qua `source:'site'`. Trả ở đây để
       * Agent biết chúng tồn tại, và ghi rõ là không bind được, thay vì để nó dựng
       * một bind trỏ tới `site.name` rồi rơi về fallback mãi mãi.
       */
      site: {
        name: site.name,
        primaryDomain: site.primaryDomain,
        faviconAssetId: site.faviconAssetId,
      },
      siteNote:
        '`name`, `primaryDomain` và `faviconAssetId` là cột riêng, KHÔNG bind được bằng ' +
        'source:"site". Chỉ những khoá trong `globals` dưới đây bind được. Favicon đổi ' +
        'ở trang Cài đặt của builder, không qua tool nào.',
      globals: Object.entries(globals).map(([key, value]) => ({
        key,
        bindPath: key,
        type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
        value,
      })),
      count: Object.keys(globals).length,
      howTo:
        'Đặt vào RichText: { "t":"bind", "ref":{ "source":"site", "path":"<key>" }, ' +
        '"fallback":"<chữ hiện khi khoá mất>" }. `bind` thay được CHỮ, không thay được style.',
    };
  },
};

const createComponentTool: ToolDef = {
  name: 'create_component',
  title: 'Tạo component',
  description:
    'Tạo một component MỚI: cây trống (truyền `name`), hoặc bản sao của component ' +
    'đang có (truyền `from`).\n\n' +
    'Sửa cây bằng apply_component_ops. Chèn vào trang bằng op insertNode — xem ' +
    'get_component để lấy cây.\n\n' +
    'Lưu ý về ngữ nghĩa: cắm component bằng node `Instance` là LIÊN KẾT — sửa ' +
    'component đổi mọi trang đang cắm nó ở lần Publish kế tiếp (Publish bất kỳ trang ' +
    'nào cũng đưa mọi thay đổi component lên site). Chèn bằng op insertNode thì là ' +
    'ĐÓNG DẤU một bản sao độc lập, sửa component sau đó không đổi bản sao. Nói rõ ' +
    'điều này với người dùng.',
  input: z
    .object({
      name: z.string().max(80).optional().describe('Bắt buộc khi tạo cây trống.'),
      from: z.string().optional().describe('Id component nguồn để nhân bản.'),
      category: z.string().max(40).optional(),
      aiDescription: z
        .string()
        .max(500)
        .optional()
        .describe('Mô tả để lần sau chính bạn biết component này dùng làm gì.'),
    })
    .strict(),
  readOnly: false,
  async run(
    input: { name?: string; from?: string; category?: string; aiDescription?: string },
    ctx: ToolContext,
  ) {
    const r = await createComponent({
      ...input,
      actorEmail: ctx.session.email,
      actorSub: ctx.session.sub,
    });
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      componentId: r.preset.id,
      key: r.preset.key,
      name: r.preset.name,
      editUrl: `${ctx.origin}/builder/components/${r.preset.id}/edit`,
      note: input.from
        ? 'Đã nhân bản. Bản sao độc lập hoàn toàn với bản gốc.'
        : 'Component mới còn TRỐNG — một node Section. Dùng apply_component_ops để dựng.',
    };
  },
};

const setTranslationTool: ToolDef = {
  name: 'set_translation',
  title: 'Ghi bản dịch',
  description:
    'Ghi bản dịch cho MỘT đơn vị chữ của một trang, hoặc xoá nó bằng `value: null`.\n\n' +
    'KHÔNG ghi được cho ngôn ngữ gốc: chữ gốc sống trong doc, sửa nó bằng op setText. ' +
    'Ghi vào đây sẽ tạo hai nguồn sự thật cho cùng một chuỗi.\n\n' +
    'Đơn vị chữ phải TỒN TẠI trong doc — dùng list_translations để lấy danh sách ' +
    'nodeId/field hợp lệ thay vì đoán.\n\n' +
    '`content` và `label` nhận RichText (mảng inline node). `alt` và `a11yLabel` nhận chuỗi.\n\n' +
    'Chữ trong `params` của Composite (nhãn/placeholder/gợi ý/lựa chọn của ô nhập Form, ' +
    'submitLabel, successMessage, errorMessage, a11yLabel, và trường chữ của composite riêng ' +
    'của dự án) dùng `field: "param:<đường dẫn>"` với giá trị là CHUỖI, ví dụ ' +
    '`param:fields.2.label`, `param:fields.0.placeholder`, `param:submitLabel` (số = chỉ số mảng, ' +
    'từ 0). Chữ trong Form của một component (instance) dùng nodeId `instanceId/localId`. ' +
    'Đường dẫn phải có thật trong params — trường nào vắng ở bản gốc thì không có đơn vị để dịch.',
  input: z
    .object({
      pageId: z.string().min(1),
      locale: z.string().min(2).max(10),
      nodeId: z.string().min(1),
      field: z.union([
        z.enum(['content', 'label', 'alt', 'a11yLabel']),
        z.string().regex(/^param:[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/, 'param:<đường dẫn>'),
      ]),
      value: z.unknown().describe('RichText, chuỗi, hoặc null để xoá.'),
    })
    .strict(),
  readOnly: false,
  async run(
    input: { pageId: string; locale: string; nodeId: string; field: string; value: unknown },
    ctx: ToolContext,
  ) {
    const r = await setTranslation({
      ...input,
      actorEmail: ctx.session.email,
      actorSub: ctx.session.sub,
    });
    if (!r.ok) return { ok: false, error: r.error };
    if ('deleted' in r) return { ok: true, deleted: true, note: 'Đã xoá bản dịch.' };
    return {
      ok: true,
      translationId: r.translation.id,
      previewUrl: `${ctx.origin}/preview/${input.pageId}?locale=${input.locale}`,
      note:
        'Đã ghi vào BẢN NHÁP. Mở previewUrl để soát — đó là đường DUY NHẤT xem bản ' +
        'dịch trước khi publish.',
    };
  },
};

const listTranslationsTool: ToolDef = {
  name: 'list_translations',
  title: 'Bản dịch của một trang',
  description:
    'Liệt kê bản dịch đang có của một trang, kèm cờ `stale` cho những bản mà chữ gốc ' +
    'đã đổi sau khi dịch.\n\n' +
    'Dùng nó TRƯỚC set_translation để lấy đúng nodeId và field, thay vì đoán.',
  input: z
    .object({
      pageId: z.string().min(1),
      locale: z.string().min(2).max(10).optional().describe('Bỏ trống để lấy mọi ngôn ngữ.'),
    })
    .strict(),
  readOnly: true,
  async run(input: { pageId: string; locale?: string }) {
    const rows = await prisma.translation.findMany({
      where: { pageId: input.pageId, ...(input.locale ? { locale: input.locale } : {}) },
      orderBy: [{ locale: 'asc' }, { nodeId: 'asc' }],
      select: {
        locale: true, nodeId: true, field: true, sourceHash: true, updatedAt: true,
      },
    });

    return {
      count: rows.length,
      translations: rows.map((r) => ({
        locale: r.locale,
        nodeId: r.nodeId,
        field: r.field,
        updatedAt: r.updatedAt.toISOString(),
      })),
      note:
        rows.length === 0
          ? 'Trang này chưa có bản dịch nào.'
          : 'Dùng nodeId và field ở đây làm đầu vào cho set_translation.',
    };
  },
};

const draftDiffTool: ToolDef = {
  name: 'get_draft_diff',
  title: 'Bản nháp khác live ở đâu',
  description:
    'So bản nháp với bản đang chạy trên site: trang nào mới, node nào thêm/mất, chữ ' +
    'nào đổi.\n\n' +
    'GỌI NÓ TRƯỚC KHI BÁO XONG. Nó là cách bạn tự kiểm rằng mình đã sửa đúng thứ ' +
    'được yêu cầu và không sửa gì khác — và là cùng dữ liệu mà người dùng sẽ đọc ' +
    'trước khi bấm Publish.\n\n' +
    'Chỉ so cấu trúc và chữ, KHÔNG so style: "spacing đổi từ 24 sang 32" không trả ' +
    'lời được câu hỏi "trang có gì khác".\n\n' +
    'Bỏ trống `pageId` để so mọi trang.',
  input: z.object({ pageId: z.string().optional() }).strict(),
  readOnly: true,
  async run(input: { pageId?: string }, ctx: ToolContext) {
    const diffs = await draftDiff(input.pageId);
    return {
      summary: summarize(diffs),
      pages: diffs.map((d) => ({
        slug: d.slug,
        status: d.status,
        previewUrl: `${ctx.origin}/preview/${d.pageId}`,
        added: d.diff.added.length,
        removed: d.diff.removed.length,
        // Cắt danh sách chữ: một trang sửa hàng loạt sẽ nhồi cả nghìn dòng vào
        // context, và mười ví dụ đầu đã đủ để người soát biết chuyện gì xảy ra.
        textChanged: d.diff.textChanged.slice(0, 10),
        textChangedTotal: d.diff.textChanged.length,
      })),
    };
  },
};

/**
 * Ngôn ngữ của site.
 *
 * ## Vì sao tool này phải tồn tại
 *
 * Ba tool nhận một mã ngôn ngữ (`set_translation`, `list_translations`,
 * `set_entry_locale`), và cả ba đều TỪ CHỐI mã không có trong bảng `Locale`.
 * Nhưng không tool nào đọc bảng đó, nên vòng làm việc thật là: agent đoán `"en"`,
 * sai thì đọc câu lỗi để biết. Nó chạy được, và nó tốn một lượt GHI thất bại cho
 * mỗi lần đoán.
 *
 * `list_translations` không thay được: nó liệt kê bản dịch ĐÃ CÓ, nên một site
 * vừa bật tiếng Anh mà chưa dịch câu nào sẽ trả rỗng — đúng lúc agent cần biết
 * nhất.
 *
 * ## Vì sao ở `site-tools`, không ở `collection-tools`
 *
 * Ngôn ngữ là thuộc tính của SITE. Tool dịch trang cũng cần nó, và đặt ở file kia
 * nghĩa là một tool về trang phải đi mượn từ file về nội dung.
 *
 * ## Vì sao trả cả ngôn ngữ CHƯA BẬT
 *
 * `enabled: false` nghĩa là "dịch trước, bật sau" (xem `model Locale`) — dịch vào
 * một ngôn ngữ chưa bật là việc HỢP LỆ và là cả điểm của cờ ấy. Giấu chúng đi thì
 * agent không biết mình được phép dịch sẵn. Cờ đi kèm để nó nói đúng với người
 * dùng.
 */
const listLocalesTool: ToolDef = {
  name: 'list_locales',
  title: 'Ngôn ngữ của site',
  description:
    'Mã ngôn ngữ hợp lệ của site này. Gọi nó TRƯỚC `set_translation` hoặc ' +
    '`set_entry_locale` thay vì đoán mã.\n\n' +
    'Ngôn ngữ MẶC ĐỊNH là bản gốc: nó không có tiền tố URL, không có bản dịch, và ' +
    '`set_entry_locale` từ chối nó.\n\n' +
    '`enabled: false` = đã khai nhưng chưa công bố. Dịch sẵn vào đó là hợp lệ; nó ' +
    'chỉ chưa có URL công khai.',
  input: z.object({}).strict(),
  readOnly: true,
  async run() {
    const rows = await prisma.locale.findMany({
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      select: { code: true, label: true, isDefault: true, enabled: true },
    });

    return {
      count: rows.length,
      locales: rows,
      note:
        rows.length <= 1
          ? 'Site chỉ có một ngôn ngữ — chưa có gì để dịch.'
          : 'Dùng `code` làm đầu vào cho set_translation và set_entry_locale.',
    };
  },
};

export const SITE_TOOLS: ToolDef[] = [
  createPageTool,
  updatePageTool,
  setPageSeoTool,
  listSiteGlobalsTool,
  createComponentTool,
  setTranslationTool,
  listTranslationsTool,
  listLocalesTool,
  draftDiffTool,
];
