import { revalidateTag } from 'next/cache';
import { after, NextResponse } from 'next/server';

/**
 * Publish và rollback.
 *
 * Cả hai đều là MỘT lần ghi con trỏ `Site.activeReleaseId`. Không build, không
 * image mới, không restart — đó là lý do lớn nhất để tự sở hữu tầng dữ liệu, và
 * là điều kiện để "deploy một lần rồi chỉ prompt" thành sự thật.
 *
 * `revalidateTag` là mảnh còn thiếu trước đây: đổi DB xong mà không gọi nó thì
 * `unstable_cache` vẫn phục vụ bản cũ tới 3600s. Con số "publish 23ms" khi đó
 * là của tầng dữ liệu, chưa phải của tầng phục vụ.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';
import { sweepAssetHolds } from '@/lib/builder/asset-trash';
import { snapshotKey } from '@/lib/render/translations';
import { assetSnapshot, tokenSnapshot } from '@/lib/render/release-snapshot';
import { upsertStyleBundle } from '@/lib/render/style-bundle';
import { mergeTranslationSnapshot, nodeIdsOf, planReleaseEntries } from '@/lib/publish/plan';

export const dynamic = 'force-dynamic';

interface Body {
  action?: 'publish' | 'rollback';
  /** rollback: release muốn quay về. */
  releaseId?: string;
  /**
   * publish: chỉ đẩy bản nháp của những trang này lên.
   *
   * Vắng = publish cả site (mọi trang đang có bản nháp), hành vi cũ. Xem docblock
   * lớn ở nhánh publish bên dưới để biết vì sao hai chế độ vẫn cho ra cùng một
   * loại release.
   */
  pageIds?: string[];
  label?: string;
  note?: string;
}

export async function POST(request: Request) {
  const auth = await requireAuth('publish');
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  // `globals` phải có trong select, không thì ảnh chụp globals RỖNG và im lặng —
  // trang mất hotline, số giấy phép, link store, và không có lỗi nào.
  const site = await prisma.site.findFirst({
    select: { id: true, activeReleaseId: true, globals: true },
  });
  if (!site) return NextResponse.json({ error: 'Chưa có site' }, { status: 404 });

  const started = Date.now();

  if (body.action === 'rollback') {
    if (!body.releaseId) {
      return NextResponse.json({ error: 'Thiếu releaseId' }, { status: 400 });
    }
    const target = await prisma.release.findFirst({
      where: { id: body.releaseId, siteId: site.id },
      select: { id: true, label: true, entries: { select: { slug: true } } },
    });
    if (!target) return NextResponse.json({ error: 'Không tìm thấy release' }, { status: 404 });

    await prisma.$transaction([
      prisma.site.update({ where: { id: site.id }, data: { activeReleaseId: target.id } }),
      prisma.auditLog.create({
        data: {
          userId: auth.sub, action: 'release.rollback', targetType: 'Release',
          targetId: target.id, meta: { from: site.activeReleaseId },
        },
      }),
    ]);

    revalidateTag('release');
    for (const entry of target.entries) revalidateTag(`page:${entry.slug}`);

    return NextResponse.json({
      ok: true, releaseId: target.id, label: target.label, ms: Date.now() - started,
    });
  }

  /* ── publish ───────────────────────────────────────────────────────── */

  /*
   * Hai chế độ, MỘT loại release.
   *
   * Không có `pageIds` → publish cả site: mọi trang đang có bản nháp đều lên.
   * Có `pageIds`       → publish từng trang: chỉ những trang được nêu lấy bản
   *                      nháp, MỌI trang còn lại giữ đúng phiên bản đang chạy.
   *
   * Bản trước của file này từ chối chế độ thứ hai với lý do: "publish từng trang
   * sẽ cho phép hai trang tham chiếu chéo nhau ở hai phiên bản khác nhau — một
   * release là một ảnh chụp nhất quán của cả site." Lý do đó vẫn đúng, và đây là
   * chỗ nó được giữ: publish từng trang KHÔNG sửa release đang chạy tại chỗ và
   * KHÔNG tạo release nửa vời. Nó dựng một release ĐẦY ĐỦ mới = bản nháp của
   * trang được chọn + bản đang chạy của tất cả trang khác. Nhờ vậy
   * `Site.activeReleaseId` vẫn là một lần ghi con trỏ, mọi release vẫn tự chứa,
   * và lùi bản vẫn đưa cả site về đúng một trạng thái từng tồn tại thật.
   *
   * Điều KHÔNG chia nhỏ được, và phải nói thẳng ra: `components`, `tokens`,
   * `assets`, `globals` là tài nguyên DÙNG CHUNG toàn site, không thuộc trang
   * nào. Chúng luôn được chụp mới, kể cả khi chỉ publish một trang — nên sửa một
   * component rồi publish trang A thì trang B cũng nhận component mới. Đây là
   * hành vi đã có từ trước (HANDOFF mục 3.10), không phải mới sinh ra ở đây;
   * nhưng nút "Publish trang này" làm nó dễ gây bất ngờ hơn hẳn, nên hộp xác
   * nhận trong `EditorShell` nói đúng câu đó.
   *
   * `translations` thì chia được, và CÓ chia — xem ngay dưới.
   */
  const selection = Array.isArray(body.pageIds)
    ? body.pageIds.filter((id): id is string => typeof id === 'string' && !!id)
    : null;

  const sitePages = await prisma.page.findMany({
    where: { siteId: site.id, archivedAt: null },
    select: { id: true, slug: true, draftVersionId: true },
  });

  // Chỉ đọc release đang chạy khi thực sự cần nó — publish cả site không đụng tới.
  const liveEntries =
    selection && site.activeReleaseId
      ? await prisma.releaseEntry.findMany({
          where: { releaseId: site.activeReleaseId },
          select: { pageId: true, slug: true, versionId: true },
        })
      : [];

  const plan = planReleaseEntries({ sitePages, liveEntries, selection });
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  const { pages, publishedIds } = plan;
  if (!pages.length) {
    return NextResponse.json({ error: 'Không có trang nào để publish' }, { status: 400 });
  }

  // Ảnh chụp bản dịch, cùng transaction với ảnh chụp doc.
  //
  // Chụp riêng lẻ về sau sẽ để hở đúng khoảng mà một lần sửa tiếng Anh rơi vào
  // giữa: release mang bố cục lúc T nhưng bản dịch lúc T+1. Và nếu render đọc
  // thẳng bảng `Translation` thì mọi ký tự vừa gõ lên sóng ngay — mất hợp đồng
  // nháp/publish cho toàn bộ chữ dịch.
  //
  // Chỉ chụp ngôn ngữ ĐANG BẬT: bản dịch của một ngôn ngữ chưa công bố không
  // nên phình ảnh chụp của mọi release.
  const rows = await prisma.translation.findMany({
    where: { pageId: { in: publishedIds }, loc: { enabled: true } },
    select: { locale: true, nodeId: true, field: true, value: true },
  });
  const fresh: Record<string, unknown> = Object.fromEntries(
    rows.map((r) => [snapshotKey(r.locale, r.nodeId, r.field), r.value]),
  );

  /*
   * Publish cả site: `publishedIds` là mọi trang, nên `fresh` CHÍNH LÀ ảnh chụp.
   *
   * Publish từng trang: bản dịch của trang không publish phải đứng yên đúng như
   * đang chạy, nên nền là ảnh chụp cũ và chỉ khoá thuộc trang được publish mới bị
   * thay. Phải XOÁ trước rồi mới ghi đè: nếu chỉ ghi đè, một bản dịch VỪA BỊ XOÁ
   * sẽ sống sót từ ảnh chụp cũ, và trang tiếng Anh hiện lại đúng chuỗi mà người
   * dùng tưởng đã bỏ.
   *
   * Khoá là `locale:nodeId:field`, không mang pageId — nên tập nodeId của trang
   * được publish lấy thẳng từ `doc.nodes` của bản nháp; `Doc.nodes` vốn đã là map
   * theo id nên không phải duyệt cây.
   */
  let translations = fresh;
  if (selection) {
    const previous = site.activeReleaseId
      ? await prisma.release.findUnique({
          where: { id: site.activeReleaseId },
          select: { translations: true },
        })
      : null;

    const publishedVersionIds = pages
      .filter((p) => publishedIds.includes(p.id))
      .map((p) => p.versionId);
    const versions = await prisma.pageVersion.findMany({
      where: { id: { in: publishedVersionIds } },
      select: { doc: true },
    });

    translations = mergeTranslationSnapshot(
      previous?.translations as Record<string, unknown> | null,
      fresh,
      nodeIdsOf(versions.map((v) => v.doc)),
    );
  }

  // Ảnh chụp cây component, cùng transaction với ảnh chụp doc.
  //
  // Không chụp thì instance render bằng cách tra thẳng bảng Preset, và SỬA MỘT
  // COMPONENT LÀ ĐỔI NGAY SITE ĐANG CHẠY — bỏ qua publish hoàn toàn, im lặng.
  //
  // Chụp MỌI component, không chỉ component đang được dùng: một instance có thể
  // được thêm vào ở bản nháp giữa hai lần publish, và ảnh chụp phải phục vụ được
  // cả lần lùi bản về đây.
  const componentRows = await prisma.preset.findMany({ select: { id: true, tree: true } });
  const components = Object.fromEntries(componentRows.map((c) => [c.id, c.tree]));

  /*
   * Ba ảnh chụp còn lại, cùng lý do và cùng cơ chế với `translations` và
   * `components` ở trên: bảng nguồn là BẢN NHÁP, nên đọc nó lúc render là bỏ qua
   * publish hoàn toàn.
   *
   * Đo 18/08/2026: 0 token tự tạo, 11 asset, 3 khoá globals. Tức đường token hôm
   * nay chưa tải dữ liệu nào — nó là bảo hiểm; hai đường kia đang hoạt động thật.
   */
  const tokenRows = await prisma.token.findMany({
    where: { custom: true, deprecated: false },
    orderBy: { name: 'asc' },
    select: { name: true, value: true },
  });
  const tokens = tokenSnapshot(tokenRows);

  const assetRows = await prisma.asset.findMany({
    select: { id: true, url: true, width: true, height: true, blurhash: true, mime: true },
  });
  /*
   * Ép về `InputJsonObject` cho cả hai.
   *
   * Không phải để làm im typechecker: `InputJsonValue` là union có nhánh mảng, và
   * TS chọn nhánh đó khi gặp một `Record<...>` bất kỳ, nên nó báo "thiếu length,
   * concat, join". Cả `assets` lẫn `globals` đều đã là dữ liệu JSON thuần —
   * `assetSnapshot` chỉ trả string/number/null, và `Site.globals` vốn là cột
   * JSONB nên nội dung của nó đã qua kiểm khi ghi vào.
   */
  const assets = assetSnapshot(assetRows) as unknown as Prisma.InputJsonObject;

  const globals = (site.globals ?? {}) as Prisma.InputJsonObject;

  const release = await prisma.$transaction(async (tx) => {
    // Bó CSS vào TRƯỚC release: `Release.cssHash` là khoá ngoại, nên tạo release
    // trỏ tới một bó chưa tồn tại sẽ vi phạm ràng buộc.
    //
    // Đây là thứ làm cho "nâng cấp builder không đổi gì trên site" thành đúng.
    // `site.css` đi qua bundler lúc build, tức nó nằm trong CODE — xem
    // `render/static-css.ts`.
    const cssHash = await upsertStyleBundle(tx);

    const created = await tx.release.create({
      data: {
        siteId: site.id,
        label: body.label ?? `Publish ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        note: body.note ?? null,
        createdBy: auth.email,
        // Cùng lý do ép kiểu với `assets` ở trên: `Record<string, unknown>` làm TS
        // chọn nhánh mảng của `InputJsonValue`.
        translations: translations as unknown as Prisma.InputJsonObject,
        components,
        tokens,
        globals,
        assets,
        cssHash,
        entries: {
          create: pages.map((p) => ({
            pageId: p.id, versionId: p.versionId, slug: p.slug,
          })),
        },
      },
      select: { id: true, label: true },
    });

    await tx.site.update({ where: { id: site.id }, data: { activeReleaseId: created.id } });

    await tx.auditLog.create({
      data: {
        userId: auth.sub, action: 'release.publish', targetType: 'Release',
        targetId: created.id,
        meta: {
          scope: selection ? 'pages' : 'site',
          pageCount: pages.length,
          publishedPageCount: publishedIds.length,
          publishedPageIds: publishedIds,
          previous: site.activeReleaseId,
        },
      },
    });

    return created;
  });

  revalidateTag('release');
  for (const p of pages) revalidateTag(`page:${p.slug}`);

  // Release mới đẩy cửa sổ rollback trôi đi một bản: object ảnh đã xoá hoàn toàn mà chỉ
  // release vừa ra khỏi cửa sổ còn giữ thì tới hạn dọn. Chạy SAU phản hồi — publish vẫn
  // chỉ là ghi con trỏ, không chờ S3 — và lỗi ở đó không thành lỗi của publish.
  after(() => sweepAssetHolds().catch(() => undefined));

  return NextResponse.json({
    ok: true,
    releaseId: release.id,
    label: release.label,
    /** Số trang trong release — gồm cả trang chỉ được mang nguyên bản đang chạy sang. */
    pageCount: pages.length,
    /** Số trang thực sự vừa được đẩy bản nháp lên. Bằng `pageCount` khi publish cả site. */
    publishedPageCount: publishedIds.length,
    scope: selection ? 'pages' : 'site',
    ms: Date.now() - started,
  });
}
