import 'server-only';

/**
 * Tool ĐỌC cho collection. Cùng khuôn `list_text_units` / `resolve_style`.
 *
 * ## Ghi thì được TẠO, không được SỬA và không được ĐĂNG
 *
 * Bản trước của file này không có tool ghi nào, với lý do: bất biến số 5 ("không
 * tồn tại code path auto-apply cho AI"), và `Entry` là nguồn LIVE — một tool ghi
 * nghĩa là một câu prompt đưa chữ lên site thật ngay, không có bước publish nào để
 * rút lại.
 *
 * Lý do đó đúng, nhưng chỉ đúng với việc SỬA và ĐĂNG. `createEntry` ghi cứng
 * `status: 'draft'`, và API công khai lọc `status = published` cộng
 * `publishedAt <= now`. Một entry mới do AI tạo KHÔNG ai ngoài builder thấy được,
 * nên nó không phá bất biến số 5 — cùng hình dạng như trang mới do `create_page`
 * tạo.
 *
 * Ranh giới nằm ở đây, và nó là ranh giới về QUYỀN chứ không về tiện lợi:
 *
 *   create_entry      CÓ             — tạo bản nháp, người bấm Đăng
 *   create_taxonomy   CÓ             — danh mục là cấu trúc, không phải nội dung công khai
 *   set_taxonomy_locale CÓ, CÓ ĐIỀU KIỆN — tên dịch lên site NGAY (không có lớp nháp),
 *                                      nên gác bằng cùng cờ `canPublishLocale`
 *   update_entry      CÓ, CÓ ĐIỀU KIỆN — `data` chỉ sửa được khi entry đang `draft`;
 *                                      `i18n` thì không bị chặn, xem dưới
 *   set_entry_locale  CÓ, CÓ ĐIỀU KIỆN — đăng bản DỊCH cần token mang cờ
 *                                      `canPublishLocale`
 *   publish_entry     KHÔNG          — đăng bản GỐC là hành động của con người
 *
 * `update_entry` được thêm ngày 03/09/2026 vì thiếu nó thì `create_entry` là một
 * đường một chiều: agent viết sai một câu là phải nhờ người vào sửa tay, hoặc tạo
 * một bài trùng. Nó truyền `requireDraft: true` xuống `updateEntry`, và phép chặn
 * đó nguyên tử ở tầng SQL — không phải một lượt đọc trạng thái rồi tin vào nó. Bài
 * đã đăng thì tool trả 409 kèm câu giải thích, không phải im lặng bỏ qua.
 *
 * Dòng `publish_entry KHÔNG` là cố ý, và đừng thêm nó vào sau bằng lý lẽ tiện lợi:
 * cả hai tool ghi ở trên đều vô hại chính vì có đúng một cửa mà AI không mở được.
 *
 * ## Hai chỗ nới ngày 11/09/2026, và vì sao chúng KHÔNG phải lý lẽ tiện lợi
 *
 * **`i18n` không bị `requireDraft` chặn.** `EntryLocale` docblock ghi *"đăng bản
 * gốc rồi mới dịch là nhịp làm việc thật"*. Chặn `i18n` theo `Entry.status` nghĩa
 * là AI chỉ dịch được trong khoảng thời gian bài còn nháp — đúng khoảng thời gian
 * chưa ai dịch. Và nó KHÔNG mở cửa nào: một lớp phủ `i18n` không tới được đường
 * đọc công khai chừng nào hàng `EntryLocale` chưa `published`. Với bản dịch thì
 * `EntryLocale.status` ĐÃ LÀ bước publish; `requireDraft` trên `Entry` là cửa thứ
 * hai khoá nhầm phòng.
 *
 * **`set_entry_locale` đăng được bản dịch — nhưng chỉ khi token mang cờ.** Đây LÀ
 * một chỗ nới thật, và nó được gác bằng một thứ kiểm được bằng code chứ không bằng
 * quy ước: `ServiceToken.canPublishLocale`, mặc định `false`, bật một lần có ý thức
 * lúc cấp token ở `/builder/claude`, và thu hồi có hiệu lực NGAY vì bảng token được tra ở
 * mỗi lời gọi. Bất biến đổi từ "có đúng một cửa AI không mở được" thành "có đúng
 * một cửa AI không mở được TRỪ KHI người ta mở" — vẫn là một câu kiểm được.
 *
 * Bản GỐC thì không đổi: không tool nào đăng được nó, kể cả với cờ.
 *
 * ## Vì sao `resolve_repeat` khai `input.repeat` là `z.unknown()`
 *
 * `zRepeatSpec` chứa `zCollectionQuery` và `zRichText` — một union đệ quy. Đưa nó
 * vào `input` là nhét vài chục KB JSON Schema vào danh mục tool, thứ đi vào prompt ở
 * MỖI LƯỢT của mọi phiên chat. Trần ở `json-schema.test.ts` bắt đúng chuyện đó. Khai
 * lỏng ở tầng công bố, validate THẬT trong handler — đúng khuôn đã dùng cho
 * `apply_ops`; xem docblock `src/lib/ai/json-schema.ts`.
 */

import { z } from 'zod';

import { getAdminEntry, listAdminEntries, repeatEntryContext } from '@/lib/collections/admin-queries';
import { localePublishState, localeSlug } from '@/lib/collections/entry-locale';
import { createEntry, setEntryLocaleState, updateEntry } from '@/lib/collections/entry-write';
import { entryLocaleState } from '@/lib/collections/entry-locale-read';
import { canPublishLocale } from '@/lib/auth/service-token';
import { loadGroupTable } from '@/lib/collections/group-table';
import { getCollectionTypes } from '@/lib/collections/queries';
import { createTaxonomy, setTaxonomyLocaleName } from '@/lib/collections/taxonomy-write';
import { prisma } from '@/lib/db';
import { resolveRepeat } from '@/lib/collections/resolve-repeat';
import { zRepeatSpec } from '@/lib/doc/schema';
import type { RepeatSpec } from '@/lib/doc/types';
import type { ToolContext, ToolDef } from './tools';

const listCollectionTypes: ToolDef = {
  name: 'list_collection_types',
  title: 'Danh sách loại nội dung',
  description:
    'Mọi loại nội dung (tin tức, FAQ, sự kiện…) kèm CẤU TRÚC FIELD của chúng, số ' +
    'entry, và field nào làm tiêu đề / đường dẫn. ĐỌC TOOL NÀY TRƯỚC khi cấu hình ' +
    'một khối lặp hay khi người dùng nói tên một field: khoá field ở đây là khoá ' +
    'dùng trong RepeatSpec.map và trong binding source:"collection". Field kiểu ' +
    'group và blocks tham chiếu một nhóm field theo khoá — nhóm field KHÔNG phải ' +
    'Component; Component là cây node, xem list_components. BA kiểu chữ giàu, KHÔNG ' +
    'thay thế nhau được: richtext là mảng inline node; richdoc thêm một tầng KHỐI ' +
    '(đoạn, tiêu đề, danh sách, ảnh); html là một CHUỖI HTML (bảng, iframe, h1-h6, ' +
    'màu chữ, canh lề) đi qua danh sách trắng thẻ — script và thuộc tính on* bị gỡ. ' +
    'Field kiểu seo (tối đa một mỗi loại) là object { metaTitle, metaDescription, keywords, ' +
    'ogImage:{assetId,alt}, canonicalUrl (đường dẫn), noindex, structuredData } — mọi khoá ' +
    'đều tuỳ chọn và là giá trị GHI ĐÈ; để trống thì site tự suy ra từ tiêu đề, sapo, ảnh đầu tiên.\n\n' +
    '`groups` trả kèm CẤU TRÚC BÊN TRONG của từng nhóm field, nên không cần gọi ' +
    'thêm tool nào để biết một khối `figure` hay `cta` gồm những field gì.',
  input: z.object({}).strict(),
  readOnly: true,
  async run() {
    /*
     * Trả kèm `groups` vì thiếu nó thì tool này TỰ NÓ vô dụng cho việc ghi: một
     * field `blocks` chỉ nói `allowed: ['figure']`, và không có gì cho biết một
     * `figure` gồm những field nào. Agent buộc phải đoán, và đoán sai một khối là
     * một entry bị validator từ chối bằng thông báo về field nó chưa từng thấy.
     */
    const [types, groups] = await Promise.all([getCollectionTypes(), loadGroupTable()]);
    return {
      groups,
      types: types.map((t) => ({
        key: t.key,
        name: t.name,
        namePlural: t.namePlural,
        entryCount: t.entryCount,
        titleField: t.titleField,
        slugField: t.slugField,
        singleton: t.singleton,
        fields: t.schema,
      })),
    };
  },
};

const listEntriesTool: ToolDef = {
  name: 'list_entries',
  title: 'Danh sách entry',
  description:
    'Entry của một loại nội dung, KỂ CẢ bản nháp và bản hẹn giờ (khác API công ' +
    'khai, vốn chỉ thấy bài đã đăng và đã tới mốc). Mỗi hàng nói rõ trạng thái, mốc ' +
    'đăng, danh mục, và độ phủ bản dịch. "locales" ở đây CHỈ là độ phủ dịch — nó ' +
    'không nói bản dịch đã lên site chưa; gọi get_entry để biết trạng thái công bố ' +
    'của từng ngôn ngữ. Dùng khi cần biết "có bao nhiêu bài", ' +
    '"bài nào chưa đăng", hay để tìm id của một bài trước khi gọi get_entry.',
  input: z
    .object({
      typeKey: z.string().min(1),
      status: z
        .enum(['draft', 'published', 'scheduled'])
        .optional()
        .describe('scheduled = đã đăng nhưng mốc còn ở tương lai. Đây là trạng thái SUY RA, không phải giá trị của cột status.'),
      q: z.string().min(1).optional().describe('Tìm trong nội dung.'),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  readOnly: true,
  async run(input: { typeKey: string; status?: 'draft' | 'published' | 'scheduled'; q?: string; limit: number }) {
    const { rows, total, counts } = await listAdminEntries({
      typeKey: input.typeKey, status: input.status, q: input.q, page: 1, pageSize: input.limit,
    });
    return {
      total,
      counts,
      entries: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        taxonomies: r.taxonomies.map((t) => t.name),
        locales: r.locales,
      })),
    };
  },
};

const getEntry: ToolDef = {
  name: 'get_entry',
  title: 'Một entry đầy đủ',
  description:
    'Toàn bộ dữ liệu của một entry, kèm lớp phủ bản dịch theo từng ngôn ngữ. Field ' +
    'richtext là cây RichText (mảng inline node), field richdoc là mảng KHỐI mỗi ' +
    'khối có khoá "b" — hai kiểu đó KHÔNG phải HTML. Field html thì NGƯỢC LẠI: giá ' +
    'trị là một chuỗi HTML, và mọi thẻ ghi vào đó đi qua danh sách trắng — ' +
    '<script>, thuộc tính on*, href="javascript:" bị gỡ trước khi lưu, và <iframe> ' +
    'chỉ giữ được host đã khai trong bảng EmbedOrigin. Field blocks là mảng, mỗi phần ' +
    'tử có __type nói nó là khối gì. Ảnh mang assetId, không mang URL — dùng ' +
    'list_assets để tra. Field seo là giá trị ghi đè đã lưu (ô trống = site tự suy ra), ' +
    'canonicalUrl luôn là đường dẫn. ' +
    'BẢN DỊCH: "i18n" là lớp phủ BỘ PHẬN lên "data" theo mã ngôn ngữ — field nào ' +
    'không có trong lớp phủ thì site hiện giá trị của bản gốc, không hiện trống. ' +
    '"locales" nói trạng thái CÔNG BỐ của từng ngôn ngữ, và nó ĐỘC LẬP với "status" ' +
    'của bản gốc: bản tiếng Anh live được khi bản gốc còn nháp, và ngược lại. ' +
    '"locales[].url" là đoạn slug ngôn ngữ đó đang phục vụ (rơi về slug gốc khi ' +
    'chưa đặt riêng). "state": missing = chưa có bản này, draft = có nhưng chưa ' +
    'duyệt, scheduled = đã duyệt nhưng mốc còn ở tương lai, live = đang trên site.',
  input: z.object({ entryId: z.string().min(1) }).strict(),
  readOnly: true,
  async run(input: { entryId: string }) {
    const e = await getAdminEntry(input.entryId);
    if (!e) return { error: `Không có entry ${input.entryId}` };
    return {
      id: e.id,
      typeKey: e.typeKey,
      slug: e.slug,
      status: e.status,
      publishedAt: e.publishedAt?.toISOString() ?? null,
      data: e.data,
      i18n: e.i18n,
      /*
       * Trạng thái công bố của từng ngôn ngữ, ngay cạnh `i18n`.
       *
       * `i18n` một mình chỉ nói "đã dịch tới đâu", không nói "bản đó có trên site
       * hay chưa" — và từ khi publish tách theo ngôn ngữ thì hai câu đó khác nhau.
       * Thiếu ô này, một agent đọc thấy lớp phủ tiếng Anh đầy đủ rồi kết luận bản
       * tiếng Anh đang chạy, trong khi nó còn nháp.
       *
       * KHÔNG có tool ghi tương ứng — xem docblock đầu file. Đây là ô để agent BÁO
       * cho người dùng biết còn gì phải bấm, không phải để nó tự bấm.
       */
      locales: e.locales.map((l) => ({
        locale: l.locale,
        url: localeSlug({ slug: e.slug, status: e.status, publishedAt: e.publishedAt }, e.locales, l.locale),
        ownSlug: l.slug,
        state: localePublishState(
          { slug: e.slug, status: e.status, publishedAt: e.publishedAt },
          e.locales,
          l.locale,
          new Date(),
        ),
        status: l.status,
        publishedAt: l.publishedAt?.toISOString() ?? null,
      })),
      taxonomyIds: e.taxonomyIds,
      updatedAt: e.updatedAt.toISOString(),
      updatedBy: e.updatedBy,
    };
  },
};

const resolveRepeatTool: ToolDef = {
  name: 'resolve_repeat',
  title: 'Khối lặp này đang khớp gì',
  description:
    'Entry mà một cấu hình lặp (RepeatSpec) sẽ render, đọc ĐÚNG đường mà site đọc. ' +
    'Đây là cách duy nhất trả lời "vì sao danh sách của tôi trống": thường là bài ' +
    'còn nháp, mốc đăng còn ở tương lai, hoặc điều kiện danh mục cần một bài đang ' +
    'mở mà trang danh sách không có. Gọi tool này TRƯỚC khi kết luận cấu hình sai. ' +
    'Lấy RepeatSpec từ trường "repeat" của một node Instance qua get_node.',
  input: z
    .object({
      repeat: z.unknown().describe('RepeatSpec — lấy từ node Instance qua get_node.'),
      entryId: z
        .string()
        .min(1)
        .optional()
        .describe('Bài đang mở, cho nguồn "related"/"field" và điều kiện danh mục "current-entry".'),
    })
    .strict(),
  readOnly: true,
  async run(input: { repeat?: unknown; entryId?: string }) {
    const parsed = zRepeatSpec.safeParse(input.repeat);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { error: `Cấu hình lặp không hợp lệ: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim() };
    }
    const spec = parsed.data as RepeatSpec;

    const entry = input.entryId ? await getAdminEntry(input.entryId) : null;
    if (input.entryId && !entry) return { error: `Không có entry ${input.entryId}` };

    const items = await resolveRepeat(spec, {
      entry: entry ? repeatEntryContext(entry) : undefined,
    });

    return {
      matched: items.length,
      // Nói rõ khi rỗng, kèm lý do có thể — một `matched: 0` trơ trọi làm người
      // đọc (và model) đoán, và đoán sai chỗ này rất dễ.
      ...(items.length === 0
        ? {
            hint:
              'Không khớp bài nào. Kiểm: bài còn ở trạng thái nháp, mốc đăng còn ở ' +
              'tương lai, danh mục trong điều kiện không có bài, hoặc nguồn cần một ' +
              'bài đang mở (related / field / current-entry) mà không có entryId. ' +
              'Nguồn "group-entries" luôn trả rỗng ngoài ngữ cảnh render — nó lấy ' +
              'danh mục từ khối lặp CHA.',
          }
        : {}),
      items: items.slice(0, 10).map((i) => ({
        key: i.key,
        slug: i.slug ?? null,
        title:
          typeof i.data.title === 'string' ? i.data.title
          : typeof i.data.name === 'string' ? i.data.name
          : null,
      })),
    };
  },
};

/**
 * Danh mục của một loại nội dung.
 *
 * Tồn tại vì `create_entry` gần như luôn cần nó: field `taxonomy` thường `required`,
 * và nó nhận **id cuid** — thứ không suy ra được từ tên. Không có tool này thì đường
 * duy nhất là mở builder chép id bằng mắt, tức việc tạo bài không tự động được dù đã
 * có tool ghi.
 */
const listTaxonomiesTool: ToolDef = {
  name: 'list_taxonomies',
  title: 'Danh mục',
  description:
    'Danh mục của một loại nội dung, kèm id và số bài mỗi mục.\n\n' +
    'GỌI TRƯỚC `create_entry` khi loại đó có field `taxonomy`: field ấy nhận id ' +
    'cuid, không nhận tên. Chưa có mục cần dùng thì gọi `create_taxonomy`.\n\n' +
    '`i18n` là tên theo ngôn ngữ không mặc định (`{ en: { name } }`); đặt bằng ' +
    '`set_taxonomy_locale`.',
  input: z.object({ typeKey: z.string().min(1) }).strict(),
  readOnly: true,
  async run(input: { typeKey: string }) {
    const type = await prisma.collectionType.findUnique({
      where: { key: input.typeKey },
      select: { id: true },
    });
    if (!type) return { ok: false, error: `Không có loại nội dung "${input.typeKey}"` };

    const rows = await prisma.taxonomy.findMany({
      where: { typeKey: input.typeKey },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, key: true, name: true, parentId: true, i18n: true },
    });

    // Một `groupBy` chứ không `_count` trên quan hệ: `_count` đếm cả entry đã lưu
    // trữ, và một con số lệch với bảng trong builder làm người ta ngờ cả hai.
    const counts = await prisma.entryTaxonomy.groupBy({
      by: ['taxonomyId'],
      where: { entry: { typeKey: input.typeKey, archivedAt: null } },
      _count: { entryId: true },
    });
    const byId = new Map(counts.map((c) => [c.taxonomyId, c._count.entryId]));

    return {
      ok: true,
      count: rows.length,
      taxonomies: rows.map((r) => ({ ...r, entryCount: byId.get(r.id) ?? 0 })),
    };
  },
};

const createTaxonomyTool: ToolDef = {
  name: 'create_taxonomy',
  title: 'Tạo danh mục',
  description:
    'Tạo một danh mục mới cho một loại nội dung.\n\n' +
    'Gọi `list_taxonomies` TRƯỚC: hai mục gần trùng tên ("Tin thị trường" và ' +
    '"Thị trường") chia đôi nội dung của cùng một chủ đề, và không có gì báo.\n\n' +
    'Danh mục là CẤU TRÚC, không phải nội dung công khai — nhưng nó hiện trong form ' +
    'nhập của mọi bài, nên đừng tạo mục rác để thử.',
  input: z
    .object({
      typeKey: z.string().min(1),
      name: z.string().min(1).max(120),
      parentId: z.string().min(1).optional().describe('Id danh mục cha, cùng loại nội dung.'),
    })
    .strict(),
  readOnly: false,
  async run(input: { typeKey: string; name: string; parentId?: string }, ctx: ToolContext) {
    const r = await createTaxonomy({
      typeKey: input.typeKey,
      name: input.name,
      parentId: input.parentId,
      actorSub: ctx.session.sub,
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, taxonomyId: r.taxonomy.id, key: r.taxonomy.key };
  },
};

/**
 * Tên danh mục theo ngôn ngữ.
 *
 * Cửa quyền là `canPublishLocale`, KHÔNG phải không điều kiện như `create_taxonomy`:
 * danh mục mới chưa ai thấy (mặc định `draft`), còn tên dịch thì hiện trên tab và huy
 * hiệu ở `/en` ngay lần ghi — nó không có lớp nháp nào để người duyệt chặn lại. Đó
 * đúng là việc "đăng bản dịch" mà cờ này tồn tại để gác.
 */
const setTaxonomyLocaleTool: ToolDef = {
  name: 'set_taxonomy_locale',
  title: 'Dịch tên danh mục',
  description:
    'Đặt tên của một danh mục ở một ngôn ngữ không mặc định (tab danh mục và huy hiệu ' +
    'trên thẻ ở `/en`…). `name: null` gỡ bản dịch; chưa dịch thì site hiện tên gốc.\n\n' +
    'LÊN SITE NGAY — không có bản nháp. Cần token được cấp quyền đăng bản dịch. Lấy ' +
    '`taxonomyId` từ `list_taxonomies`, mã ngôn ngữ từ `list_locales`.',
  input: z
    .object({
      taxonomyId: z.string().min(1),
      locale: z.string().min(2).max(10),
      name: z.string().max(120).nullable(),
    })
    .strict(),
  readOnly: false,
  async run(input: { taxonomyId: string; locale: string; name: string | null }, ctx: ToolContext) {
    if (!(await canPublishLocale(ctx.session))) {
      return {
        ok: false,
        error:
          'Token này không có quyền đăng bản dịch, và tên danh mục dịch lên site ngay. ' +
          'Người dùng đặt tên ở builder (Kho dữ liệu → Danh mục) — hoặc cấp token mới có ' +
          'tích "Cho phép đăng bản dịch" ở /builder/claude.',
      };
    }
    const r = await setTaxonomyLocaleName({
      id: input.taxonomyId,
      locale: input.locale,
      name: input.name,
      actorSub: ctx.session.sub,
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, i18n: r.i18n };
  },
};

/**
 * Tạo entry ở trạng thái NHÁP.
 *
 * `createEntry` ghi cứng `status: 'draft'`, và tool này không có tham số nào đổi được
 * điều đó. Đó là cả ranh giới — xem docblock đầu file.
 */
const createEntryTool: ToolDef = {
  name: 'create_entry',
  title: 'Tạo bài / entry',
  description:
    'Tạo một entry MỚI cho một loại nội dung, ở trạng thái BẢN NHÁP.\n\n' +
    'Bài mới KHÔNG hiện trên site: API công khai chỉ trả bài `published` đã tới mốc ' +
    'đăng. Đưa nó lên là việc người dùng làm trong builder — không có tool đăng bài, ' +
    'và không có tool sửa bài đã có.\n\n' +
    'THỨ TỰ BẮT BUỘC:\n' +
    '  1. `list_collection_types` — khoá field, field nào `required`, và `groups` cho khối `blocks`\n' +
    '  2. `list_taxonomies` — id danh mục (field taxonomy nhận id, không nhận tên)\n' +
    '  3. `upload_asset` — assetId cho field ảnh\n' +
    '  4. `create_entry`\n\n' +
    '`data` là object khoá-field → giá trị, theo đúng schema của loại:\n' +
    '  text      → chuỗi\n' +
    '  richtext  → mảng InlineNode, ví dụ [{ "t":"text","v":"…" }]\n' +
    '  image     → { assetId, alt } — `alt` bắt buộc khi field khai requireAlt\n' +
    '  blocks    → mảng object, mỗi object có `__type` là một khoá trong `allowed`\n' +
    '  slug      → bỏ trống để tự sinh từ tiêu đề; trùng thì hệ thống tự thêm hậu tố\n' +
    '  seo       → { metaTitle, metaDescription, keywords, ogImage:{assetId,alt}, canonicalUrl, ' +
    'noindex, structuredData } — mọi khoá tuỳ chọn; trống thì site tự suy ra. metaTitle ≤ 120 ' +
    'ký tự (nên ≤ 60), metaDescription ≤ 300 (nên ≤ 160). canonicalUrl là ĐƯỜNG DẪN trên ' +
    'site ("/blogs/post/x"); URL domain khác bị từ chối\n\n' +
    '`taxonomyIds` là mảng id lấy từ `list_taxonomies`. Thiếu nó khi loại có taxonomy ' +
    '`required` sẽ bị từ chối.',
  input: z
    .object({
      typeKey: z.string().min(1),
      /*
       * `z.unknown()` chứ không phải một schema thật: hình dạng của `data` phụ thuộc
       * schema của TỪNG loại nội dung, thứ nằm trong database và đổi được lúc chạy —
       * không có schema tĩnh nào mô tả được nó. Validate THẬT bằng `validateEntryData`
       * trong `createEntry`, đúng khuôn `apply_ops` và `resolve_repeat`.
       */
      data: z.unknown().describe('Object khoá-field → giá trị. Xem list_collection_types.'),
      taxonomyIds: z.array(z.string().min(1)).max(20).optional(),
    })
    .strict(),
  readOnly: false,
  async run(input: { typeKey: string; data: unknown; taxonomyIds?: string[] }, ctx: ToolContext) {
    const r = await createEntry({
      typeKey: input.typeKey,
      data: input.data ?? {},
      taxonomyIds: input.taxonomyIds,
      actorEmail: ctx.session.email,
      actorSub: ctx.session.sub,
    });
    if (!r.ok) return { ok: false, error: r.error };

    return {
      ok: true,
      entryId: r.entry.id,
      slug: r.entry.slug,
      status: r.entry.status,
      note:
        'Bài ở trạng thái NHÁP — chưa ai ngoài builder thấy được. Mở ' +
        `/builder/content/${input.typeKey}/${r.entry.id} để soát rồi bấm Đăng.`,
    };
  },
};

/**
 * Sửa một entry ĐANG LÀ NHÁP.
 *
 * Cặp với `create_entry`: viết xong đọc lại thấy sai thì sửa được, không phải tạo
 * bài thứ hai. Ranh giới nằm ở `requireDraft: true` bên dưới — xem docblock đầu file.
 */
const updateEntryTool: ToolDef = {
  name: 'update_entry',
  title: 'Sửa bài nháp',
  description:
    'Sửa một entry ĐANG Ở TRẠNG THÁI NHÁP.\n\n' +
    'CHỈ sửa được bài nháp. Bài đã đăng (hoặc đã hẹn giờ đăng) sẽ bị TỪ CHỐI — sửa ' +
    'nội dung đang chạy trên site là việc người làm trong builder, không phải việc ' +
    'của một câu prompt. Gọi `list_entries` với `status: "draft"` để biết bài nào ' +
    'sửa được.\n\n' +
    '`data` THAY TOÀN BỘ phần nội dung, không phải merge từng field: field nào vắng ' +
    'mặt trong `data` sẽ MẤT. Gọi `get_entry` trước, sửa trên bản đọc được, rồi gửi ' +
    'lại cả object — cùng luật với `globals` ở trang Cài đặt.\n\n' +
    '`taxonomyIds` thì khác: KHÔNG truyền = giữ nguyên danh mục; truyền `[]` = gỡ ' +
    'hết (và sẽ bị từ chối nếu loại có taxonomy bắt buộc).\n\n' +
    'Không đổi được `slug` bằng tool này, và không đổi được trạng thái đăng.',
  input: z
    .object({
      entryId: z.string().min(1),
      /*
       * `z.unknown()` cùng lý do như `create_entry`: hình dạng phụ thuộc schema của
       * từng loại nội dung, thứ nằm trong database. Validate thật ở `updateEntry`.
       */
      data: z
        .unknown()
        .optional()
        .describe('Object khoá-field → giá trị. THAY TOÀN BỘ. Bỏ trống để chỉ sửa danh mục.'),
      taxonomyIds: z
        .array(z.string().min(1))
        .max(20)
        .optional()
        .describe('Bỏ trống = giữ nguyên. [] = gỡ hết danh mục.'),
      /*
       * `z.unknown()` cùng lý do với `data`: mỗi khoá là một mã ngôn ngữ, và giá trị
       * là `Partial<data>` của loại đó — hình dạng nằm trong database.
       * `updateEntry` kiểm thật: mã locale phải có trong bảng `Locale`, và mỗi lớp
       * phủ đi qua `validateEntryDataPartial`.
       */
      i18n: z
        .unknown()
        .optional()
        .describe(
          '{ "<mã ngôn ngữ>": { "<field>": giá trị } }. Gộp theo NGÔN NGỮ, thay TOÀN BỘ trong một ngôn ngữ. ' +
            'Field seo của một ngôn ngữ KHÔNG kế thừa bản gốc (chữ, canonicalUrl, noindex, ' +
            'structuredData); chỉ ogImage.assetId kế thừa khi để trống — ghi ogImage:{alt} để dịch alt.',
        ),
    })
    .strict(),
  readOnly: false,
  async run(
    input: { entryId: string; data?: unknown; taxonomyIds?: string[]; i18n?: unknown },
    ctx: ToolContext,
  ) {
    if (input.data === undefined && input.taxonomyIds === undefined && input.i18n === undefined) {
      return {
        ok: false,
        error: 'Cần `data`, `i18n` hoặc `taxonomyIds` — không có gì để sửa.',
      };
    }

    if (input.i18n !== undefined && (typeof input.i18n !== 'object' || input.i18n === null || Array.isArray(input.i18n))) {
      return { ok: false, error: '`i18n` phải là một object khoá ngôn ngữ → lớp phủ field.' };
    }

    const r = await updateEntry({
      entryId: input.entryId,
      // Truyền `data` CHỈ KHI có: `updateEntry` phân biệt "vắng mặt" (không đổi) với
      // một object rỗng (thay bằng rỗng), và `data: undefined` tường minh cũng là
      // vắng mặt — nhưng viết rõ ra để người sau không phải suy ra điều đó.
      ...(input.data !== undefined ? { data: input.data } : {}),
      ...(input.taxonomyIds !== undefined ? { taxonomyIds: input.taxonomyIds } : {}),
      ...(input.i18n !== undefined
        ? { i18n: input.i18n as Record<string, unknown> }
        : {}),
      actorEmail: ctx.session.email,
      actorSub: ctx.session.sub,
      /*
       * Không phải tuỳ chọn. Đây là cả ranh giới của tool này.
       *
       * `updateEntry` áp nó theo THỨ ĐANG BỊ GHI: `data`/`taxonomyIds` thì chặn,
       * `i18n` một mình thì không. Xem docblock của tham số ấy.
       */
      requireDraft: true,
    });
    if (!r.ok) return { ok: false, error: r.error };

    return {
      ok: true,
      entryId: r.entry.id,
      slug: r.entry.slug,
      status: r.entry.status,
      note: 'Đã sửa BẢN NHÁP. Bài vẫn chưa lên site — người dùng bấm Đăng trong builder.',
    };
  },
};

/**
 * Đặt slug và trạng thái đăng của MỘT ngôn ngữ cho một bài.
 *
 * ## Vì sao tool này tách khỏi `update_entry`
 *
 * Bản dịch của một entry nằm ở HAI chỗ, và chúng có vòng đời khác nhau:
 *
 *   nội dung đã dịch         `Entry.i18n`   → `update_entry({ i18n })`
 *   slug riêng + trạng thái  `EntryLocale`  → tool này
 *
 * Gộp vào một tool nghĩa là một lượt gọi vừa ghi JSONB vừa ghi một bảng quan hệ,
 * với hai bộ luật khác nhau (lớp phủ field vs đụng `@@unique([typeKey, locale,
 * slug])`). Và nó che mất điều quan trọng nhất: **dịch xong nội dung KHÔNG làm bản
 * dịch lên site** — phải gọi thêm tool này.
 *
 * ## Vì sao `status: 'published'` cần cờ trên token
 *
 * Xem bảng ranh giới ở đầu file. Đăng bản dịch là ghi lên site thật, nên nó chỉ đi
 * qua khi token mang `canPublishLocale` — mặc định `false`, bật một lần có ý thức
 * lúc cấp token ở `/builder/claude`, thu hồi có hiệu lực ngay.
 *
 * Phiên trình duyệt không có token nên không có cờ: AI trong builder dịch được
 * nhưng không đăng được. Người thì bấm nút Đăng, và nút ấy đã có sẵn.
 */
const setEntryLocaleTool: ToolDef = {
  name: 'set_entry_locale',
  title: 'Đặt slug / trạng thái cho một ngôn ngữ',
  description:
    'Đặt đường dẫn riêng và trạng thái đăng của MỘT ngôn ngữ cho một bài.\n\n' +
    'Đây là bước THỨ HAI của việc dịch. Bước một là `update_entry` với `i18n` — ' +
    'nó ghi nội dung đã dịch, nhưng KHÔNG làm bản dịch hiện ra trên site. Tool này ' +
    'mới quyết định điều đó.\n\n' +
    '`locale` phải là mã lấy từ `list_locales`, và KHÔNG được là ngôn ngữ mặc ' +
    'định — bản gốc dùng trạng thái của chính nó, đăng/hạ ở đó.\n\n' +
    '`slug` bỏ trống = không đổi; `null` = bỏ slug riêng và dùng lại slug gốc. Hai ' +
    'nghĩa khác nhau.\n\n' +
    'ĐĂNG (`status: "published"`) cần token được cấp quyền riêng. Không có quyền ' +
    'thì tool trả lỗi và bạn chỉ đặt được `draft` — người dùng vào builder bấm Đăng.',
  input: z
    .object({
      entryId: z.string().min(1),
      locale: z.string().min(2).max(10).describe('Mã ngôn ngữ, lấy từ list_locales.'),
      /*
       * `.nullable()` chứ không chỉ `.optional()`.
       *
       * `undefined` = không đổi, `null` = bỏ slug riêng. `setEntryLocaleState` đã
       * phân biệt hai nghĩa đó, và gộp chúng ở tầng tool là làm việc "quay về slug
       * gốc" thành bất khả.
       */
      slug: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe('Bỏ trống = không đổi. null = bỏ slug riêng, dùng slug gốc.'),
      status: z.enum(['draft', 'published']).optional(),
      /*
       * ISO string rồi `new Date()` ở `run` — cùng khuôn `create_entry` để
       * `z.unknown()` cho `data` và validate thật ở tầng dưới. Một `z.date()` ở đây
       * sẽ không qua nổi JSON của MCP.
       */
      publishedAt: z
        .string()
        .datetime()
        .nullable()
        .optional()
        .describe('ISO 8601. Mốc ở TƯƠNG LAI = hẹn giờ. null = bỏ mốc.'),
    })
    .strict(),
  readOnly: false,
  async run(
    input: {
      entryId: string;
      locale: string;
      slug?: string | null;
      status?: 'draft' | 'published';
      publishedAt?: string | null;
    },
    ctx: ToolContext,
  ) {
    /*
     * Cửa quyền kiểm TRƯỚC mọi thứ khác.
     *
     * Kiểm sau khi ghi slug thành công sẽ để lại một hàng `EntryLocale` đã đổi kèm
     * một câu lỗi — người đọc sẽ tưởng không có gì xảy ra.
     */
    if (input.status === 'published' && !(await canPublishLocale(ctx.session))) {
      return {
        ok: false,
        error:
          'Token này không có quyền đăng bản dịch. Đặt `status: "draft"` để lưu, ' +
          'rồi người dùng vào builder bấm Đăng cho ngôn ngữ đó — hoặc cấp token mới có ' +
          'tích "Cho phép đăng bản dịch" ở /builder/claude.',
      };
    }

    const r = await setEntryLocaleState({
      entryId: input.entryId,
      locale: input.locale,
      // Truyền CHỈ KHI có — `undefined` và `null` là hai nghĩa khác nhau ở tầng dưới.
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.publishedAt !== undefined
        ? { publishedAt: input.publishedAt === null ? null : new Date(input.publishedAt) }
        : {}),
      actorEmail: ctx.session.email,
      actorSub: ctx.session.sub,
    });
    if (!r.ok) return { ok: false, error: r.error };

    /*
     * Trả `state`, không chỉ `status`.
     *
     * "Đã hẹn giờ" và "đã lên sóng" CÙNG có `status: 'published'`. Một bài hẹn 9:00
     * mai mà tool báo "đã đăng" thì agent sẽ nói với người dùng là xong, và người
     * dùng mở URL ra gặp 404. Bốn giá trị của `localePublishState` phân biệt được.
     */
    const st = await entryLocaleState(input.entryId);
    const state = st
      ? localePublishState(st.base, st.rows, input.locale, new Date())
      : 'missing';

    return {
      ok: true,
      entryId: r.entry.id,
      locale: input.locale,
      state,
      note:
        state === 'live'
          ? 'Bản dịch đã lên sóng.'
          : state === 'scheduled'
            ? 'Đã hẹn giờ — mốc đăng còn ở tương lai, URL chưa mở.'
            : 'Đã lưu ở trạng thái nháp. Bản dịch CHƯA hiện trên site.',
    };
  },
};

export const COLLECTION_TOOLS: ToolDef[] = [
  listCollectionTypes,
  listEntriesTool,
  getEntry,
  resolveRepeatTool,
  listTaxonomiesTool,
  createTaxonomyTool,
  setTaxonomyLocaleTool,
  createEntryTool,
  updateEntryTool,
  setEntryLocaleTool,
];
