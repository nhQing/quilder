import 'server-only';

/**
 * Đường ghi entry — dùng chung cho route HTTP và tool MCP.
 *
 * Cùng khuôn `create-page.ts`: một hàm, hai vỏ. Chép luật vào route nghĩa là hai
 * bản của một luật, và bản ít được nhớ tới là bản mà người sau đọc.
 *
 * ## Không có bảng phiên bản cho entry
 *
 * Khác `PageVersion`, mỗi lần lưu ghi ĐÈ `data`. Quyết định có ý thức (spec §12):
 * `AuditLog` ghi ai sửa gì lúc nào là đủ, và một bảng version cho nội dung tăng
 * dung lượng theo số lần gõ. Cần lùi một bài viết là một yêu cầu mới.
 */

import { prisma } from '@/lib/db';
import { toSlug } from '@/lib/builder/create-page';
import { allowedEmbedHostnames } from '@/lib/render/embed-origins';
import { configuredSiteOrigin } from '@/lib/site/origin';
import { revalidateCollection } from './cache';
import { validateEntryData, validateEntryDataPartial, type EntryDataCtx } from './entry-data';
import { validateCollectionSchema, type FieldDef, type GroupTable } from './field-def';
import { loadGroupTable } from './group-table';
import { isUniqueCollision } from './unique-retry';

/** Slug trống tạo ra `/tin-tuc/`, trùng trang danh sách. Nên nó không bao giờ trống. */
const SLUG_FALLBACK = 'muc';

export function uniqueSlug(base: string, taken: readonly string[]): string {
  const root = base || SLUG_FALLBACK;
  if (!taken.includes(root)) return root;
  let n = 2;
  while (taken.includes(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

/**
 * Slug của một entry theo cấu trúc của loại.
 *
 * Trả RỖNG khi không sinh được — chỗ gọi quyết định là bắt nhập tay hay dùng
 * fallback. Ném lỗi ở đây thì lưu nháp một bài chưa có tiêu đề là không được, và
 * đó là việc người ta làm suốt.
 */
export function deriveSlug(fields: FieldDef[], data: Record<string, unknown>): string {
  const slugField = fields.find((f) => f.t === 'slug');
  if (!slugField || slugField.t !== 'slug') return '';

  const existing = data[slugField.key];
  if (typeof existing === 'string' && existing.trim()) return toSlug(existing);

  const source = data[slugField.from];
  return typeof source === 'string' ? toSlug(source) : '';
}

/**
 * Loại nội dung có field `taxonomy` bắt buộc thì entry phải gắn ít nhất một danh mục.
 *
 * Cưỡng chế ở ĐÂY chứ không ở `zEntryData`: giá trị không nằm trong `data` — field
 * `taxonomy` là một khai báo, liên kết sống ở bảng `EntryTaxonomy` — nên validator của
 * `data` không thấy nó, và một field `required: true` sẽ được nhận với `data` rỗng.
 *
 * Thuần để có test: `createEntry`/`updateEntry` chạm Prisma nên vitest không chạy được
 * chúng, mà "nhận hay từ chối" là đúng phần cần khoá bằng test.
 *
 * HẠN CHẾ đã biết: `taxonomyIds` là MỘT danh sách phẳng cho cả entry, nên khi một loại
 * có hai field `taxonomy` bắt buộc thì không phân biệt được id nào thuộc ô nào — một
 * danh mục duy nhất làm cả hai ô "đã điền". Nêu `label` trong câu lỗi để người dùng
 * biết ô nào đang bị đòi, chứ chưa phải một phép kiểm theo từng ô; tách được chỉ khi
 * `EntryTaxonomy` mang thêm khoá field, và đó là một thay đổi lược đồ.
 */
export function checkRequiredTaxonomy(
  fields: FieldDef[],
  taxonomyIds: string[] | undefined,
): { ok: true } | { ok: false; error: string } {
  const required = fields.filter((f) => f.t === 'taxonomy' && f.required === true);
  if (!required.length) return { ok: true };
  if (taxonomyIds && taxonomyIds.length > 0) return { ok: true };

  const labels = required.map((f) => `"${f.label}"`).join(', ');
  return {
    ok: false,
    error:
      required.length > 1
        ? `Phải chọn ít nhất một danh mục cho ${labels}`
        : 'Phải chọn ít nhất một danh mục',
  };
}

/**
 * Lượt ghi này có phải đi qua cửa "chỉ sửa được bài nháp" không.
 *
 * ## Vì sao là hàm THUẦN, tách khỏi `updateEntry`
 *
 * Cùng lý do `checkRequiredTaxonomy` ở trên: `updateEntry` chạm Prisma nên vitest
 * không chạy được nó, mà "nhận hay từ chối" là đúng phần cần khoá bằng test. Và
 * cửa này được kiểm HAI lần trong `updateEntry` (sớm để có câu lỗi tử tế, và trong
 * transaction để nguyên tử) — hai bản của một luật sẽ trôi khỏi nhau.
 *
 * ## Luật
 *
 * Cửa bảo vệ NỘI DUNG BẢN GỐC đang chạy trên site: `data` và `taxonomyIds`. Một
 * lượt ghi chỉ chạm `i18n` không chạm thứ đó, nên nó đi qua kể cả khi bài đã đăng.
 *
 * `taxonomyIds` tính là nội dung bản gốc: đổi danh mục của một bài đã đăng là đổi
 * trang danh mục đang chạy, không phải đổi một bản dịch chưa ai thấy.
 */
export function needsDraftGate(args: {
  requireDraft?: boolean;
  data?: unknown;
  taxonomyIds?: string[];
  /**
   * Khai ra dù KHÔNG dùng.
   *
   * Để "i18n không mở cửa" là một lựa chọn đọc thấy được ngay trong chữ ký, chứ
   * không phải một field ai đó quên. Bỏ nó đi thì test truyền `i18n` sẽ đỏ vì
   * excess-property, và người sửa sẽ nghĩ test viết sai.
   */
  i18n?: unknown;
}): boolean {
  if (!args.requireDraft) return false;
  return args.data !== undefined || args.taxonomyIds !== undefined;
}

export type EntryWriteResult =
  | { ok: true; entry: { id: string; slug: string; status: string } }
  | { ok: false; status: number; error: string };

/** Giữ tên cũ làm vỏ mỏng: `createEntry` chỉ quan tâm đụng slug. */
export function isSlugCollision(e: unknown): boolean {
  return isUniqueCollision(e, 'slug');
}

/**
 * Ném khi `updateEntry({ requireDraft: true })` gặp một entry KHÔNG còn là nháp.
 *
 * Là một lớp Error chứ không phải một giá trị trả về, vì phép kiểm nằm BÊN TRONG
 * transaction — chỗ duy nhất kiểm được mà không có khe hở giữa lúc đọc trạng thái và
 * lúc ghi. `return` từ trong đó thì transaction vẫn commit.
 */
class EntryNotDraftError extends Error {
  constructor() {
    super('entry-not-draft');
    this.name = 'EntryNotDraftError';
  }
}

/**
 * Nạp cấu trúc của loại cùng bảng nhóm field, kèm `singleton`/`entryCount` — mọi
 * đường ghi đều cần cấu trúc và bảng nhóm, và `createEntry` cần thêm hai field kia
 * để khỏi đọc lại `collectionType` một lần nữa cho cùng một hàng trong cùng một
 * request: hai lượt đọc thì lượt hai có thể thấy trạng thái khác lượt một.
 */
/**
 * `ctx` đi kèm `fields`/`groups` chứ không được lấy riêng ở từng chỗ gọi.
 *
 * `validateEntryData` cần host được phép cho `<iframe>` của field `html`, và có ba
 * chỗ gọi nó trong file này (tạo, sửa `data`, sửa bản dịch). Một lời gọi
 * `allowedEmbedHostnames()` riêng ở mỗi chỗ là ba chỗ có thể quên — và bản quên là
 * bản xoá mất video của tác giả mà không báo gì. Gộp vào `loadShape` thì "đã tải
 * cấu trúc" và "đã biết host được phép" là một sự kiện.
 */
async function loadShape(typeKey: string): Promise<
  | { ok: true; typeId: string; singleton: boolean; entryCount: number; fields: FieldDef[]; groups: GroupTable; ctx: EntryDataCtx }
  | { ok: false; status: number; error: string }
> {
  const type = await prisma.collectionType.findUnique({
    where: { key: typeKey },
    select: { id: true, schema: true, singleton: true, _count: { select: { entries: true } } },
  });
  if (!type) return { ok: false, status: 404, error: `Không có loại nội dung "${typeKey}"` };

  // Dùng lại `loadGroupTable()`, KHÔNG tự dựng bảng nhóm ở đây: bản tự dựng truyền
  // `{}` làm bảng tra nên không đo được nhóm-lồng-nhóm — một schema sâu 3 sẽ đo ra
  // 2 và lọt qua. Hai bản của một luật, và bản sai là bản nằm trên đường ghi.
  const groups = await loadGroupTable();

  const checked = validateCollectionSchema(type.schema, groups);
  if (!checked.ok) {
    return { ok: false, status: 500, error: `Cấu trúc của "${typeKey}" không hợp lệ: ${checked.error}` };
  }

  return {
    ok: true,
    typeId: type.id,
    singleton: type.singleton,
    entryCount: type._count.entries,
    fields: checked.fields,
    groups,
    ctx: { iframeHosts: await allowedEmbedHostnames(), siteHost: await siteHost() },
  };
}

/** Host của site cho canonical của field `seo`; `null` khi chưa đặt domain. */
async function siteHost(): Promise<string | null> {
  const origin = await configuredSiteOrigin();
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/**
 * Danh mục gửi lên phải TỒN TẠI và phải thuộc đúng loại nội dung của entry.
 *
 * Hai thứ hỏng nếu bỏ phép kiểm này. Một: gắn được danh mục FAQ vào bài tin tức, và
 * nó VÔ HÌNH ở `taxonomyGroups` (hàm đó lọc theo `typeKey`) nên không ai phát hiện —
 * mà docblock model `Taxonomy` nói "danh mục thuộc về MỘT loại", và `createTaxonomy`
 * đã bảo vệ đúng bất biến đó cho `parentId`. Hai: một id không tồn tại thành lỗi FK
 * `P2003` ném ra khỏi transaction, route không bắt, người dùng nhận 500 kèm một câu
 * tiếng Anh. Ca hai là ca dễ xảy ra nhất, vì UI gửi id từ một danh sách có thể đã cũ.
 */
async function checkTaxonomyIds(
  ids: readonly string[],
  typeKey: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const found = await prisma.taxonomy.findMany({
    where: { id: { in: [...ids] }, typeKey },
    select: { id: true },
  });
  // `new Set(...)` vì body có thể gửi id trùng — `createMany` bỏ trùng, phép đếm thì
  // không, nên so với `ids.length` sẽ từ chối một yêu cầu hợp lệ.
  if (found.length !== new Set(ids).size) {
    return {
      ok: false,
      status: 400,
      error: 'Có danh mục không tồn tại, hoặc không thuộc loại nội dung này',
    };
  }
  return { ok: true };
}

export async function createEntry(args: {
  typeKey: string;
  data: unknown;
  taxonomyIds?: string[];
  actorEmail: string;
  actorSub: string;
}): Promise<EntryWriteResult> {
  const shape = await loadShape(args.typeKey);
  if (!shape.ok) return shape;

  if (shape.singleton && shape.entryCount > 0) {
    return { ok: false, status: 409, error: 'Loại này chỉ có một entry duy nhất' };
  }

  const checked = validateEntryData(shape.fields, shape.groups, args.data, shape.ctx);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };

  // LUÔN kiểm: entry mới phải đủ điều kiện, và "không truyền `taxonomyIds`" với một
  // entry mới đúng là ca thiếu danh mục.
  const req = checkRequiredTaxonomy(shape.fields, args.taxonomyIds);
  if (!req.ok) return { ok: false, status: 400, error: req.error };

  if (args.taxonomyIds?.length) {
    const tax = await checkTaxonomyIds(args.taxonomyIds, args.typeKey);
    if (!tax.ok) return tax;
  }

  const writeEntry = (slug: string) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.entry.create({
        data: {
          typeId: shape.typeId,
          typeKey: args.typeKey,
          slug,
          data: checked.data as object,
          status: 'draft',
          createdBy: args.actorEmail,
          updatedBy: args.actorEmail,
        },
        select: { id: true, slug: true, status: true },
      });

      if (args.taxonomyIds?.length) {
        await tx.entryTaxonomy.createMany({
          data: args.taxonomyIds.map((taxonomyId) => ({ entryId: created.id, taxonomyId })),
          skipDuplicates: true,
        });
      }

      await tx.auditLog.create({
        data: {
          userId: args.actorSub,
          action: 'entry.create',
          targetType: 'Entry',
          targetId: created.id,
          meta: { typeKey: args.typeKey, slug },
        },
      });

      return created;
    });

  /*
   * Slug tính từ danh sách đã dùng RỒI mới ghi, nên hai lần tạo đồng thời có thể
   * tính ra cùng một slug và đụng `@@unique([typeId, slug])`.
   *
   * Thử lại MỘT lần với danh sách đọc lại. Slug là giá trị suy ra, không phải lựa
   * chọn của người dùng — bắt họ thử lại cho một thứ họ không chọn là đẩy việc của
   * máy sang cho người. Hai lượt là đủ: lượt hai đọc lại danh sách nên nó đã thấy
   * slug mà lượt một vừa bị chiếm.
   *
   * Vẫn đụng ở lượt hai thì mới trả 409 — lúc đó có thứ khác đang sai, và thử lại
   * mãi chỉ làm nó khó thấy hơn.
   */
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const taken = await prisma.entry.findMany({
      where: { typeId: shape.typeId },
      select: { slug: true },
    });
    const slug = uniqueSlug(deriveSlug(shape.fields, checked.data), taken.map((t) => t.slug));

    try {
      const entry = await writeEntry(slug);
      // Entry mới là NHÁP nên site chưa thấy nó — nhưng bảng admin thì có, và nó
      // cũng đi qua cùng tag. Rẻ hơn hẳn một tag thứ hai chỉ cho admin.
      revalidateCollection(args.typeKey, slug);
      return { ok: true, entry };
    } catch (e) {
      // Lỗi KHÔNG phải đụng slug thì ném tiếp: một lỗi kết nối DB bị biến thành
      // "đường dẫn bị chiếm" là một thông báo nói sai chuyện, và nó làm người sửa
      // đi tìm sai chỗ.
      if (!isSlugCollision(e)) throw e;
      if (attempt === 2) {
        return {
          ok: false,
          status: 409,
          error: 'Đường dẫn vừa bị một bài khác chiếm. Thử lại.',
        };
      }
    }
  }

  // Không tới được: vòng lặp luôn `return` hoặc `throw`. Có mặt để TypeScript thấy
  // mọi đường đều trả giá trị.
  return { ok: false, status: 500, error: 'Không tạo được entry' };
}

/**
 * Sửa một entry đã có.
 *
 * ## `requireDraft` — vì sao là tham số chứ không phải luật mặc định
 *
 * Builder PHẢI sửa được bài đã đăng: sửa một lỗi chính tả trên bài đang chạy là việc
 * thường ngày của người biên tập, và nó là hành động có người chịu trách nhiệm. Nên
 * mặc định của hàm này giữ nguyên hành vi cũ.
 *
 * Đường AI thì khác: tool `update_entry` LUÔN truyền `requireDraft: true`. Với AI,
 * sửa một bài đã đăng nghĩa là một câu prompt đổi chữ trên site thật, không qua ai —
 * đúng thứ bất biến số 5 tồn tại để chặn. Xem bảng ranh giới ở đầu
 * `src/lib/ai/collection-tools.ts`.
 *
 * ## Vì sao phép chặn nằm TRONG transaction
 *
 * Đọc trạng thái rồi mới ghi để lại một khe: giữa hai bước đó một người có thể bấm
 * Đăng, và bản ghi của AI hạ cánh lên một bài vừa lên sóng. `updateMany` kèm điều
 * kiện `status: 'draft'` là một câu lệnh nguyên tử — khớp 0 hàng nghĩa là huỷ cả
 * transaction.
 */
export async function updateEntry(args: {
  entryId: string;
  data?: unknown;
  i18n?: Record<string, unknown>;
  taxonomyIds?: string[];
  actorEmail: string;
  actorSub: string;
  /**
   * Từ chối nếu entry không còn ở trạng thái `draft`. Đường AI luôn đặt `true`.
   *
   * ## Áp theo THỨ ĐANG BỊ GHI, không theo người gọi
   *
   * Cờ này bảo vệ **nội dung bản gốc đang chạy trên site**: `data` và
   * `taxonomyIds`. Một lượt ghi chỉ chạm `i18n` của ngôn ngữ KHÔNG mặc định thì
   * không chạm thứ đó, và nó được đi qua kể cả khi bài đã đăng.
   *
   * Vì sao phải thế: `EntryLocale` docblock ghi *"đăng bản gốc rồi mới dịch là
   * nhịp làm việc thật"*. Áp cờ cho cả `i18n` nghĩa là AI chỉ dịch được trong
   * khoảng thời gian bài còn nháp — đúng khoảng thời gian chưa ai dịch. Cửa
   * đóng nhầm phòng.
   *
   * Vì sao KHÔNG phá bất biến số 5: một lớp phủ `i18n` không tới được đường đọc
   * công khai nếu hàng `EntryLocale` của ngôn ngữ ấy chưa `published` —
   * `isLocalePublished` là cửa, và nó xét `EntryLocale`, không xét `Entry.status`.
   * Với bản dịch thì `EntryLocale.status` ĐÃ LÀ bước publish, nên `requireDraft`
   * trên `Entry` là cửa thứ hai khoá nhầm phòng.
   *
   * `entry-write.test.ts` khoá cặp hành vi này lại: ghi `i18n` vào bài đã đăng
   * THÀNH CÔNG, ghi `data` vào cùng bài đó trả 409.
   */
  requireDraft?: boolean;
}): Promise<EntryWriteResult> {
  const current = await prisma.entry.findUnique({
    where: { id: args.entryId },
    select: {
      id: true, typeKey: true, slug: true, status: true,
      // Để `revalidateCollection` chạm tới MỌI URL đang phục vụ bài này — xem
      // docblock tham số `slug` của nó.
      locales: { select: { slug: true } },
    },
  });
  if (!current) return { ok: false, status: 404, error: 'Không có entry này' };

  /**
   * Lượt ghi này có chạm NỘI DUNG BẢN GỐC không.
   *
   * Một biến có tên, không phải một điều kiện lặp hai chỗ: cửa `requireDraft` được
   * kiểm hai lần (sớm để có câu lỗi tử tế, và trong transaction để nguyên tử), và
   * hai bản của cùng một luật sẽ trôi khỏi nhau ở lần sửa sau.
   *
   * `taxonomyIds` tính là nội dung bản gốc: đổi danh mục của một bài đã đăng là đổi
   * trang danh mục đang chạy, không phải đổi một bản dịch chưa ai thấy.
   */
  const draftGate = needsDraftGate(args);

  /*
   * Kiểm sớm CHỈ để có thông báo lỗi tử tế; phép chặn thật là `updateMany` trong
   * transaction. Không có bước này thì ca thường gặp nhất — bài đã đăng từ lâu — trả
   * về câu "vừa được đăng trong lúc đang sửa", vốn sai và gây hoang mang.
   */
  if (draftGate && current.status !== 'draft') {
    return {
      ok: false,
      status: 409,
      error:
        `Bài này đang ở trạng thái "${current.status}", không phải bản nháp. ` +
        'Sửa bài đã đăng là sửa thẳng nội dung trên site — việc đó phải do người làm ' +
        'trong builder.',
    };
  }

  const shape = await loadShape(current.typeKey);
  if (!shape.ok) return shape;

  let data: Record<string, unknown> | undefined;
  if (args.data !== undefined) {
    const checked = validateEntryData(shape.fields, shape.groups, args.data, shape.ctx);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
    data = checked.data;
  }

  /*
   * Bản dịch đi qua ĐÚNG cùng một cửa như `data`.
   *
   * Trước đây `args.i18n` được ghi thẳng vào cột, không một phép kiểm nào — rồi
   * `queries.ts:toRow` gọi `applyEntryLocale` và đặt giá trị chưa kiểm vào đúng vị
   * trí của một field đã validate. Cụ thể: `PATCH { i18n: { en: { body: "<p>x</p>" } } }`
   * làm `data.body` khi đọc với `locale='en'` thành một chuỗi HTML thô, ở đúng chỗ
   * `zRichText` tồn tại để chặn. Một đường ghi ở file này vô hiệu hoá hai test ở
   * `entry-data.test.ts`.
   *
   * Spec §7 và docblock model `Entry` đều nói `i18n` là `Partial<data>` — nên
   * `zEntryDataPartial`, không phải `zEntryData`: field `required` chưa dịch là bình
   * thường, field đã dịch thì phải đúng shape.
   */
  let i18n: Record<string, unknown> | undefined;
  if (args.i18n) {
    // Khoá locale phải có trong bảng `Locale`. Khoá tự do nghĩa là cột `i18n` phình
    // vô hạn với những khoá không ai đọc, và không có gì phát hiện — không đường đọc
    // nào tra một locale mà site không khai.
    const locales = await prisma.locale.findMany({ select: { code: true } });
    const known = new Set(locales.map((l) => l.code));

    i18n = {};
    for (const [code, value] of Object.entries(args.i18n)) {
      if (!known.has(code)) {
        return {
          ok: false,
          status: 400,
          error: `Ngôn ngữ "${code}" không có trong danh sách ngôn ngữ của site`,
        };
      }
      const checkedLocale = validateEntryDataPartial(shape.fields, shape.groups, value, shape.ctx);
      if (!checkedLocale.ok) {
        return { ok: false, status: 400, error: `Bản dịch ${code}: ${checkedLocale.error}` };
      }
      // Ghi bản ĐÃ PARSE, không phải bản thô: `data` cũng ghi bản đã parse, nên khoá
      // lạ bị `.strip()` bỏ ở cả hai bên. Ghi bản thô ở đây là để lớp phủ mang được
      // những khoá mà `data` không được phép mang.
      i18n[code] = checkedLocale.data;
    }
  }

  /*
   * Chỉ kiểm khi `taxonomyIds` ĐƯỢC TRUYỀN — kể cả `[]`.
   *
   * `[]` là chủ ý gỡ hết, nên nó phải bị chặn nếu loại có field bắt buộc; KHÔNG truyền
   * là "không đổi danh mục", nên kiểm ở đó sẽ làm mọi PATCH chỉ sửa một chữ bị từ chối
   * vì một thứ nó không hề chạm tới. Đúng cùng ranh giới mà khối ghi dưới đây dùng:
   * `if (args.taxonomyIds)` mới xoá-rồi-ghi-lại.
   */
  if (args.taxonomyIds) {
    const req = checkRequiredTaxonomy(shape.fields, args.taxonomyIds);
    if (!req.ok) return { ok: false, status: 400, error: req.error };
  }

  if (args.taxonomyIds?.length) {
    const tax = await checkTaxonomyIds(args.taxonomyIds, current.typeKey);
    if (!tax.ok) return tax;
  }

  const run = () =>
    prisma.$transaction(async (tx) => {
      if (draftGate) {
        // Nguyên tử: khớp 0 hàng nghĩa là bài vừa được đăng giữa hai bước.
        const guard = await tx.entry.updateMany({
          where: { id: args.entryId, status: 'draft' },
          data: { updatedBy: args.actorEmail },
        });
        if (guard.count === 0) throw new EntryNotDraftError();
      }

      /*
       * Gộp thay vì thay: cập nhật bản tiếng Anh không được xoá bản tiếng Pháp.
       *
       * Và gộp lên `i18n` đọc NGAY TRONG transaction, có khoá hàng (08/10/2026). Trước
       * đó phép gộp dùng `current.i18n` đọc ở đầu hàm, ngoài transaction: hai lần ghi
       * bản dịch hai ngôn ngữ khác nhau (người sửa bản en, agent ghi bản ja) cùng đọc
       * một `i18n`, và lần ghi sau xoá bản dịch của lần trước. `FOR UPDATE` xếp hàng
       * hai transaction, nên lần sau gộp lên kết quả của lần trước.
       */
      let mergedI18n: Record<string, unknown> | undefined;
      if (i18n) {
        const [row] = await tx.$queryRaw<{ i18n: Record<string, unknown> | null }[]>`
          SELECT "i18n" FROM "Entry" WHERE id = ${args.entryId} FOR UPDATE`;
        mergedI18n = { ...(row?.i18n ?? {}), ...i18n };
      }

      const updated = await tx.entry.update({
        where: { id: args.entryId },
        data: {
          ...(data ? { data: data as object } : {}),
          ...(mergedI18n ? { i18n: mergedI18n as object } : {}),
          updatedBy: args.actorEmail,
        },
        select: { id: true, slug: true, status: true },
      });

      if (args.taxonomyIds) {
        await tx.entryTaxonomy.deleteMany({ where: { entryId: args.entryId } });
        if (args.taxonomyIds.length) {
          await tx.entryTaxonomy.createMany({
            data: args.taxonomyIds.map((taxonomyId) => ({ entryId: args.entryId, taxonomyId })),
            skipDuplicates: true,
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: args.actorSub,
          action: 'entry.update',
          targetType: 'Entry',
          targetId: args.entryId,
          meta: { typeKey: current.typeKey, fields: data ? Object.keys(data) : [], locales: Object.keys(args.i18n ?? {}) },
        },
      });

      return updated;
    });

  let entry: { id: string; slug: string; status: string };
  try {
    entry = await run();
  } catch (e) {
    if (e instanceof EntryNotDraftError) {
      return {
        ok: false,
        status: 409,
        error: 'Bài vừa được đăng trong lúc đang sửa. Không ghi gì cả — đọc lại rồi thử lại.',
      };
    }
    throw e;
  }

  revalidateCollection(current.typeKey, [current.slug, ...current.locales.map((l) => l.slug)]);
  return { ok: true, entry };
}

export async function setEntryStatus(args: {
  entryId: string;
  status: 'draft' | 'published';
  publishedAt?: Date | null;
  actorEmail: string;
  actorSub: string;
}): Promise<EntryWriteResult> {
  const current = await prisma.entry.findUnique({
    where: { id: args.entryId },
    select: { typeKey: true, slug: true, publishedAt: true },
  });
  if (!current) return { ok: false, status: 404, error: 'Không có entry này' };

  // Đăng lần đầu mà không nói mốc thì mốc là BÂY GIỜ. Để null thì bài "đã đăng"
  // không bao giờ khớp `publishedAt: { not: null }` và biến mất không dấu vết.
  const publishedAt =
    args.publishedAt !== undefined
      ? args.publishedAt
      : args.status === 'published'
        ? (current.publishedAt ?? new Date())
        : current.publishedAt;

  const entry = await prisma.$transaction(async (tx) => {
    const updated = await tx.entry.update({
      where: { id: args.entryId },
      data: { status: args.status, publishedAt, updatedBy: args.actorEmail },
      select: { id: true, slug: true, status: true },
    });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: `entry.${args.status}`,
        targetType: 'Entry',
        targetId: args.entryId,
        meta: { typeKey: current.typeKey, slug: current.slug, publishedAt: publishedAt?.toISOString() ?? null },
      },
    });
    return updated;
  });

  revalidateCollection(current.typeKey, current.slug);
  return { ok: true, entry };
}

/**
 * Slug và trạng thái đăng của MỘT ngôn ngữ.
 *
 * Song song với `setEntryStatus`, không phải thay nó: hàm kia là bản gốc (cột của
 * `Entry`), hàm này là một hàng `EntryLocale`. Hai đường ghi vì hai thứ được duyệt
 * độc lập — xem docblock model `EntryLocale`.
 *
 * ## Vì sao ngôn ngữ mặc định bị TỪ CHỐI ở đây
 *
 * Không phải để chặt chẽ hình thức. Ngôn ngữ mặc định đọc trạng thái từ cột của
 * `Entry` (quy ước `locale === undefined`, xem `entry-locale.ts`), nên một hàng
 * `EntryLocale` cho nó là một nguồn sự thật thứ hai mà KHÔNG đường đọc nào nhìn
 * vào — người dùng bấm "đăng" ở tab tiếng Việt, hàng được ghi, và site không đổi
 * gì. Trả lỗi rõ ràng còn hơn nhận một lệnh không có tác dụng.
 */
export async function setEntryLocaleState(args: {
  entryId: string;
  locale: string;
  /** `undefined` = không đổi. `null` = bỏ slug riêng, quay về dùng slug gốc. */
  slug?: string | null;
  status?: 'draft' | 'published';
  /** `undefined` = không đổi. `null` = bỏ mốc. */
  publishedAt?: Date | null;
  actorEmail: string;
  actorSub: string;
}): Promise<EntryWriteResult> {
  const current = await prisma.entry.findUnique({
    where: { id: args.entryId },
    select: {
      id: true, typeKey: true, slug: true,
      locales: {
        where: { locale: args.locale },
        select: { slug: true, status: true, publishedAt: true },
      },
    },
  });
  if (!current) return { ok: false, status: 404, error: 'Không có entry này' };

  const loc = await prisma.locale.findUnique({
    where: { code: args.locale },
    select: { code: true, isDefault: true },
  });
  if (!loc) return { ok: false, status: 400, error: `Không có ngôn ngữ '${args.locale}'` };
  if (loc.isDefault) {
    return {
      ok: false,
      status: 400,
      error: 'Ngôn ngữ mặc định dùng trạng thái của bản gốc — đăng/hạ ở đó, không ở đây',
    };
  }

  const row = current.locales[0] ?? null;

  /*
   * Slug do người gõ, nên phải qua `toSlug` — cùng hàm mà đường sinh tự động dùng.
   * Không chuẩn hoá thì `"August Rates "` thành một URL có dấu cách, và nó chỉ hỏng
   * ở trình duyệt của người đọc chứ không hỏng ở đây.
   */
  let slug: string | null | undefined;
  if (args.slug !== undefined) {
    if (args.slug === null) {
      slug = null;
    } else {
      const cleaned = toSlug(args.slug);
      if (!cleaned) {
        return { ok: false, status: 400, error: 'Slug rỗng sau khi chuẩn hoá' };
      }
      slug = cleaned;
    }
  }

  const status = args.status ?? row?.status ?? 'draft';

  // Cùng luật với `setEntryStatus`: đăng mà không nói mốc thì mốc là BÂY GIỜ, vì
  // `publishedAt: null` làm hàng "đã đăng" không khớp `{ not: null }` và bản dịch
  // biến mất không dấu vết.
  const publishedAt =
    args.publishedAt !== undefined
      ? args.publishedAt
      : status === 'published'
        ? (row?.publishedAt ?? new Date())
        : (row?.publishedAt ?? null);

  const nextSlug = slug !== undefined ? slug : (row?.slug ?? null);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.entryLocale.upsert({
        where: { entryId_locale: { entryId: args.entryId, locale: args.locale } },
        create: {
          entryId: args.entryId,
          locale: args.locale,
          typeKey: current.typeKey,
          slug: nextSlug,
          status,
          publishedAt,
          updatedBy: args.actorEmail,
        },
        update: { slug: nextSlug, status, publishedAt, updatedBy: args.actorEmail },
      });

      await tx.auditLog.create({
        data: {
          userId: args.actorSub,
          action: `entry.locale.${status}`,
          targetType: 'Entry',
          targetId: args.entryId,
          meta: {
            typeKey: current.typeKey,
            locale: args.locale,
            slug: nextSlug,
            publishedAt: publishedAt?.toISOString() ?? null,
          },
        },
      });
    });
  } catch (e) {
    // Đụng `@@unique([typeKey, locale, slug])`. Nói rõ ĐANG nói về ngôn ngữ nào —
    // "slug đã tồn tại" một mình làm người dùng đi sửa slug gốc, thứ không liên quan.
    if (isSlugCollision(e)) {
      return {
        ok: false,
        status: 409,
        error: `Slug '${nextSlug}' đã thuộc một bài khác ở ngôn ngữ '${args.locale}'`,
      };
    }
    throw e;
  }

  // Ba URL, không phải một: slug gốc (trang danh sách đọc qua nó), slug CŨ của ngôn
  // ngữ này (vừa thôi phục vụ — bỏ nó là để một URL chết còn trả 200 từ cache), và
  // slug MỚI.
  revalidateCollection(current.typeKey, [current.slug, row?.slug, nextSlug]);

  return { ok: true, entry: { id: current.id, slug: nextSlug ?? current.slug, status } };
}

/**
 * Lưu trữ một entry — xoá MỀM, một bước, lùi lại được.
 *
 * ## Vì sao lưu trữ chứ không xoá thẳng
 *
 * `Entry` là nguồn LIVE và không có bảng phiên bản (ghi chú đầu file): xoá một
 * hàng là mất hẳn bài viết, không có `PageVersion` nào để lùi về. Mọi đường đọc
 * (`buildEntryFindArgs`, `listAdminEntries`, `listEntries`) đều đã lọc
 * `archivedAt: null`, nên đặt cột đó là bài rời khỏi site và khỏi bảng admin ngay
 * — cùng hiệu ứng nhìn thấy được của việc xoá, mà không mất dữ liệu.
 *
 * Đây là lý do cột `archivedAt` tồn tại từ mốc 1 nhưng chưa có ai đặt nó.
 */
export async function archiveEntry(args: {
  entryId: string;
  actorEmail: string;
  actorSub: string;
}): Promise<EntryWriteResult> {
  const current = await prisma.entry.findUnique({
    where: { id: args.entryId },
    select: { typeKey: true, slug: true, archivedAt: true },
  });
  if (!current) return { ok: false, status: 404, error: 'Không có entry này' };
  if (current.archivedAt) return { ok: false, status: 409, error: 'Entry này đã ở trong lưu trữ' };

  const entry = await prisma.$transaction(async (tx) => {
    const updated = await tx.entry.update({
      where: { id: args.entryId },
      data: { archivedAt: new Date(), updatedBy: args.actorEmail },
      select: { id: true, slug: true, status: true },
    });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'entry.archive',
        targetType: 'Entry',
        targetId: args.entryId,
        meta: { typeKey: current.typeKey, slug: current.slug },
      },
    });
    return updated;
  });

  revalidateCollection(current.typeKey, current.slug);
  return { ok: true, entry };
}

/** Bỏ lưu trữ. Bài quay lại đúng `status` cũ — lưu trữ không đụng tới nó. */
export async function unarchiveEntry(args: {
  entryId: string;
  actorEmail: string;
  actorSub: string;
}): Promise<EntryWriteResult> {
  const current = await prisma.entry.findUnique({
    where: { id: args.entryId },
    select: { typeKey: true, slug: true, archivedAt: true },
  });
  if (!current) return { ok: false, status: 404, error: 'Không có entry này' };
  if (!current.archivedAt) return { ok: false, status: 409, error: 'Entry này không ở trong lưu trữ' };

  const entry = await prisma.$transaction(async (tx) => {
    const updated = await tx.entry.update({
      where: { id: args.entryId },
      data: { archivedAt: null, updatedBy: args.actorEmail },
      select: { id: true, slug: true, status: true },
    });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'entry.unarchive',
        targetType: 'Entry',
        targetId: args.entryId,
        meta: { typeKey: current.typeKey, slug: current.slug },
      },
    });
    return updated;
  });

  revalidateCollection(current.typeKey, current.slug);
  return { ok: true, entry };
}

/**
 * Xoá hẳn một entry. CHỈ khi nó đã ở trong lưu trữ.
 *
 * Hai bước chứ không một: bước một (lưu trữ) là thứ người dùng làm hằng ngày và
 * lùi được; bước hai là không lùi được, và bắt nó đi qua bước một nghĩa là không
 * có cú bấm nào làm mất bài viết ngay lập tức.
 *
 * `EntryTaxonomy` tự đi theo (`onDelete: Cascade`).
 */
export async function purgeEntry(args: {
  entryId: string;
  actorSub: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const current = await prisma.entry.findUnique({
    where: { id: args.entryId },
    select: { typeKey: true, slug: true, archivedAt: true },
  });
  if (!current) return { ok: false, status: 404, error: 'Không có entry này' };
  if (!current.archivedAt) {
    return {
      ok: false,
      status: 409,
      error: 'Chỉ xoá hẳn được entry đã ở trong lưu trữ. Lưu trữ nó trước.',
    };
  }

  await prisma.$transaction(async (tx) => {
    // AuditLog ghi TRƯỚC khi xoá: sau khi hàng biến mất thì `targetId` không còn
    // trỏ tới gì, nên nội dung của meta là bản ghi duy nhất còn lại về bài này.
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'entry.purge',
        targetType: 'Entry',
        targetId: args.entryId,
        meta: { typeKey: current.typeKey, slug: current.slug },
      },
    });
    await tx.entry.delete({ where: { id: args.entryId } });
  });

  revalidateCollection(current.typeKey, current.slug);
  return { ok: true };
}
