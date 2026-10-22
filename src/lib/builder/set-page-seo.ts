import 'server-only';

/**
 * Metadata SEO của một trang: mô tả, ảnh OG, canonical, noindex.
 *
 * ## Vì sao file này phải tồn tại
 *
 * Bốn cột ấy có trên `Page` từ đầu, và route site ĐỌC cả bốn (xem
 * `generateMetadata` trong `(site)/[[...slug]]/page.tsx`). Nhưng cho tới
 * 11/09/2026 **không có đường GHI nào**: `PATCH /api/pages/[id]` chỉ nhận
 * `title`/`slug`/`collection`, tool MCP `update_page` cũng vậy, và không màn
 * builder nào bày chúng ra.
 *
 * Tệ hơn một tính năng thiếu: luật cho AI ở `ai/tools.ts` nói thẳng *"SEO của
 * trang nằm trên hàng Page (title, description, ogImageId, canonical, noindex,
 * jsonLd) — không nhét thẻ meta vào cây node"*. Một model đọc câu đó sẽ đi tìm
 * tool để làm việc ấy và không có. Đó là một lời hứa đã viết ra mà không ai hiện
 * thực.
 *
 * ## Vì sao KHÔNG tạo `PageVersion`
 *
 * Cùng lý do `renamePage` không tạo: bốn cột này nằm trên `Page`, không nằm trong
 * `doc`. Một version không đổi node nào chỉ làm bẩn dialog Lịch sử. `AuditLog`
 * mới là chỗ của nó.
 *
 * ## Vì sao `jsonLd` KHÔNG sửa được ở đây
 *
 * Nó là một blob JSON tự do, và trang chi tiết đã có `articleJsonLd()` tự sinh.
 * Một ô nhập JSON trong pane 300px là chỗ để dán vào một chuỗi hỏng, và hỏng ở
 * đây nghĩa là Google đọc structured data sai. Ai cần nó thì đi qua MCP, nơi có
 * chỗ để kiểm hình dạng tử tế.
 */

import { revalidateTag } from 'next/cache';

import { prisma } from '@/lib/db';

export interface PageSeoInput {
  description?: string | null;
  ogImageId?: string | null;
  canonical?: string | null;
  noindex?: boolean;
}

export type SetPageSeoResult =
  | { ok: true; seo: PageSeoInput }
  | { ok: false; status: number; error: string };

/** Trần cho `description`. Dài hơn thì mọi công cụ đều cắt — xem `entrySeo`. */
const MAX_DESCRIPTION = 300;

/**
 * `canonical` phải là URL tuyệt đối hoặc đường dẫn bắt đầu bằng `/`.
 *
 * Một chuỗi như `trang-chu` (thiếu dấu gạch đầu) được trình duyệt hiểu là TƯƠNG
 * ĐỐI với URL hiện tại, nên `<link rel="canonical">` của `/en/trang-chu` sẽ trỏ
 * tới `/en/trang-chu` — đúng chỗ đang đứng, tức canonical không làm gì cả. Lỗi đó
 * không có triệu chứng nào ngoài thứ hạng tìm kiếm.
 */
function canonicalError(v: string): string | null {
  if (v.startsWith('/')) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return 'canonical phải là http(s)';
    }
    return null;
  } catch {
    return 'canonical phải là URL tuyệt đối, hoặc đường dẫn bắt đầu bằng "/"';
  }
}

export async function setPageSeo(args: {
  pageId: string;
  input: PageSeoInput;
  actorSub: string;
}): Promise<SetPageSeoResult> {
  const page = await prisma.page.findUnique({
    where: { id: args.pageId },
    select: { id: true, slug: true, fixture: true },
  });
  if (!page) return { ok: false, status: 404, error: 'Không có trang này' };

  const data: PageSeoInput = {};

  if (args.input.description !== undefined) {
    const v = args.input.description?.trim() ?? '';
    if (v.length > MAX_DESCRIPTION) {
      return {
        ok: false,
        status: 400,
        error: `Mô tả tối đa ${MAX_DESCRIPTION} ký tự (đang ${v.length})`,
      };
    }
    // Rỗng → `null`, không phải `''`: route site kiểm `page.description ?? undefined`,
    // và một chuỗi rỗng sẽ đi qua phép kiểm đó rồi thành `<meta description="">`.
    data.description = v || null;
  }

  if (args.input.canonical !== undefined) {
    const v = args.input.canonical?.trim() ?? '';
    if (v) {
      const err = canonicalError(v);
      if (err) return { ok: false, status: 400, error: err };
    }
    data.canonical = v || null;
  }

  if (args.input.ogImageId !== undefined) {
    const v = args.input.ogImageId?.trim() ?? '';
    /*
     * KHÔNG kiểm asset có tồn tại.
     *
     * Cùng quy ước với `User.avatarAssetId` và mọi `assetId` khác: cột là chuỗi,
     * không khoá ngoại, vì một khoá ngoại ở đây nghĩa là không xoá được một ảnh
     * đang là ảnh OG của trang nào đó. Asset biến mất thì thẻ OG không có ảnh.
     */
    data.ogImageId = v || null;
  }

  if (args.input.noindex !== undefined) data.noindex = args.input.noindex;

  if (!Object.keys(data).length) {
    return { ok: false, status: 400, error: 'Không có gì để đổi' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.page.update({ where: { id: args.pageId }, data });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub,
        action: 'page.seo',
        targetType: 'Page',
        targetId: args.pageId,
        meta: { slug: page.slug, fields: Object.keys(data) },
      },
    });
  });

  /*
   * `release` chứ không một tag riêng cho trang.
   *
   * Metadata nằm trên `Page`, ngoài doc, nên nó ra site NGAY chứ không chờ
   * publish — khác slug (`renamePage` giải thích vì sao slug thì chờ). Cách duy
   * nhất để trang đã cache phát metadata mới là gỡ cache ấy.
   */
  revalidateTag('release');

  return { ok: true, seo: data };
}
