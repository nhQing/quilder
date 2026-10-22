import 'server-only';

/**
 * Tạo trang mới — dùng chung cho route HTTP và cho tool MCP.
 *
 * ## Vì sao tách khỏi handler
 *
 * Tool MCP cần đúng luồng này. Có hai cách nối hai đường vào một luồng, và cả hai
 * cách kia đều tệ:
 *
 *  - `fetch` chính mình: một vòng HTTP nội bộ, mất session context, thêm một lớp
 *    serialize không ai cần, và một lỗi mạng nội bộ trở thành lỗi nghiệp vụ.
 *  - chép logic: hai bản của một luật, và bản ít được nhớ tới sẽ trôi — đúng lỗi
 *    mà `overrideSlots()` tránh bằng cách dùng lại `extractUnits`.
 *
 * Nên: một hàm, hai vỏ. Cùng khuôn với `src/lib/ai/tools.ts` ("một lớp, hai vỏ").
 *
 * ## Trang mới trông thế nào
 *
 * Một doc tối thiểu: đúng một node `main` rỗng. Không dựng sẵn nội dung mẫu —
 * trang trắng thì tác giả biết ngay mình phải bắt đầu từ đâu, còn nội dung mẫu thì
 * nửa số trang sẽ đi vào production kèm chữ "Lorem".
 *
 * Trang mới CHƯA publish: nó chỉ có `draftVersion`, và chỉ xuất hiện trên site
 * thật sau lần publish tiếp theo.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getLocales } from '@/lib/i18n/queries';
import { checkSlugPath, toSlugPath } from './slug';
import type { PageCollection } from './page-collection';
import { checkCollection, checkSlugShapeFree } from './set-page-collection';
import { CURRENT_SCHEMA_VERSION, type Doc } from '@/lib/doc/types';

export type CreatePageResult =
  | { ok: true; page: { id: string; slug: string; title: string } }
  | { ok: false; status: number; error: string };

// `toSlug` đã chuyển sang `./slug` — file này khai `server-only` và import prisma,
// nên một hàm thuần nằm ở đây là một hàm không test được. Import CỤC BỘ ở trên và
// re-export ở đây: `export { X } from` cho người khác dùng được X nhưng KHÔNG khai
// X trong scope của chính file này.
export { toSlug } from './slug';

/** Doc của một trang mới: đúng một node gốc. */
export function blankDoc(): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: {
        id: 'root', type: 'Section', tag: 'main',
        parentId: null, children: [], name: 'Trang', effects: [],
        style: {
          base: {
            layout: { display: 'flex', gap: { $token: 'space-m' } },
            spacing: {
              pt: { $token: 'space-3xl' }, pb: { $token: 'space-3xl' },
              pl: { $token: 'gutter' }, pr: { $token: 'gutter' },
            },
            size: { minHeight: { v: 100, u: 'svh' } },
          },
        },
      },
    },
  };
}

export interface NewPageInput {
  title: string;
  slug?: string;
  /** Mã ngôn ngữ đang bật. Đoạn đầu trùng một trong số này sẽ bị `splitLocale` ăn mất. */
  localeCodes?: readonly string[];
}

export type NewPageChecked =
  | { ok: true; title: string; slug: string }
  | { ok: false; status: number; error: string };

/**
 * Kiểm đầu vào — phần THUẦN, test được không cần DB.
 *
 * `slug: ''` truyền tay KHÁC `slug: undefined`. Cái đầu là "tôi muốn trang chủ",
 * cái sau là "suy từ tiêu đề". Gộp hai thứ đó lại là làm trang chủ không tạo được,
 * và đó là một lỗi rất khó nhìn ra vì nó chỉ xảy ra với đúng một trang.
 */
export function validateNewPage(input: NewPageInput): NewPageChecked {
  const title = (input.title ?? '').trim();
  if (!title) return { ok: false, status: 400, error: 'Thiếu tiêu đề' };

  /*
   * `toSlugPath`, không `toSlug`: dấu `/` là RANH GIỚI ĐOẠN ở đây, không phải rác.
   *
   * Đo ngày 08/09/2026, trước khi đổi: `create_page(slug:'blogs/tin-tuc')` ra
   * `/blogs-tin-tuc`. Cả hai lối ghi đi qua hàm này, nên một dòng ở đây làm phẳng mọi
   * đường dẫn nhiều đoạn của cả HTTP API lẫn tool MCP.
   */
  const slug = input.slug !== undefined ? toSlugPath(input.slug) : toSlugPath(title);
  if (!slug && input.slug === undefined) {
    return {
      ok: false,
      status: 400,
      error: 'Tiêu đề không tạo được đường dẫn. Nhập đường dẫn thủ công.',
    };
  }

  const bad = checkSlugPath(slug, { localeCodes: input.localeCodes });
  if (bad) return { ok: false, status: 400, error: bad };

  return { ok: true, title, slug };
}

export async function createPage(args: {
  title: string;
  slug?: string;
  /** Trang này là mặt tiền của một loại nội dung. Bắt buộc khi slug có đoạn động. */
  collection?: PageCollection | null;
  actorEmail: string;
  actorSub: string;
}): Promise<CreatePageResult> {
  const localeCodes = (await getLocales()).map((l) => l.code);
  const checked = validateNewPage({ title: args.title, slug: args.slug, localeCodes });
  if (!checked.ok) return checked;

  const collection = args.collection ?? null;
  const badCollection = await checkCollection({
    pageId: null,
    slug: checked.slug,
    collection,
  });
  if (badCollection) return { ok: false, status: 409, error: badCollection };

  const badShape = await checkSlugShapeFree(checked.slug, null);
  if (badShape) return { ok: false, status: 409, error: badShape };

  const site = await prisma.site.findFirst({ select: { id: true } });
  if (!site) return { ok: false, status: 404, error: 'Chưa có site' };

  const existing = await prisma.page.findUnique({
    where: { siteId_slug: { siteId: site.id, slug: checked.slug } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, status: 409, error: `Đường dẫn /${checked.slug} đã tồn tại` };
  }

  const page = await prisma.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: {
        siteId: site.id,
        slug: checked.slug,
        title: checked.title,
        ...(collection ? { collection: collection as unknown as Prisma.InputJsonObject } : {}),
      },
      select: { id: true, slug: true, title: true },
    });

    const version = await tx.pageVersion.create({
      data: {
        pageId: created.id,
        doc: blankDoc() as unknown as object,
        schemaVer: CURRENT_SCHEMA_VERSION,
        label: 'trang mới',
        createdBy: args.actorEmail,
      },
      select: { id: true },
    });

    await tx.page.update({
      where: { id: created.id },
      data: { draftVersionId: version.id },
    });

    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'page.create',
        targetType: 'Page',
        targetId: created.id,
        meta: { slug: checked.slug, title: checked.title, collection } as Prisma.InputJsonObject,
      },
    });

    return created;
  });

  return { ok: true, page };
}
