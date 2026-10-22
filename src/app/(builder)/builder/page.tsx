import Link from 'next/link';

import { NewPageButton } from '@/components/builder/NewPageButton';
import {
  PageGrid,
  type ArchivedCardData,
  type PageCardData,
  type PageStatus,
} from '@/components/builder/PageGrid';
import { ImportPageButton } from '@/components/builder/transfer/ImportPageDialog';
import { PendingWork } from '@/components/builder/PendingWork';
import { Badge, Tile } from '@/components/builder/ui/Badge';
import { ButtonLink } from '@/components/builder/ui/Button';
import { Icon } from '@/components/builder/ui/Icon';
import { EmptyState, PageHeader, PageShell, Section } from '@/components/builder/ui/Page';
import { getSession } from '@/lib/auth/guard';
import { cn } from '@/lib/builder/cn';
import { ROLE_LABEL, parsePageCollection, type PageParamRole } from '@/lib/builder/page-collection';
import { listArchivedPages, listPages, listPresetCards, listReleases } from '@/lib/builder/queries';
import { loadSettingsSummary } from '@/lib/builder/settings';
import { ui } from '@/lib/builder/ui';
import { getCollectionTypes } from '@/lib/collections/queries';
import { undoableImports } from '@/lib/transfer/undo';
import { when } from '@/lib/when';

/**
 * Nhãn ngắn cho huy hiệu vai định tuyến.
 *
 * Lấy từ `ROLE_LABEL` thay vì viết bảng thứ hai: trước đây chỗ này là một
 * ternary ba nhánh, nên khi vai `relation` ra đời nó rơi vào nhánh cuối và
 * hiện "danh mục" y hệt vai `taxonomy` — hai vai đọc hai nơi hoàn toàn khác
 * nhau (bảng Taxonomy so với bảng Entry), mà đây lại là chỗ DUY NHẤT nhìn
 * thấy cả bảng định tuyến cùng lúc.
 *
 * `ROLE_LABEL` viết cho dropdown nên mỗi mục là "Tên — giải thích"; huy hiệu
 * chỉ cần nửa trước. Cắt ở đây để vai thứ năm mai này tự có nhãn đúng.
 */
function roleBadge(role: PageParamRole): string {
  // `?? role` phải đứng TRƯỚC `.split`, không phải sau. Bản đầu viết
  // `ROLE_LABEL[role].split(…)[0] ?? role` — vô dụng, vì nếu tra hụt thì `.split`
  // đã ném trước khi `??` kịp chạy. Kiểu nói role luôn là một trong bốn vai, nhưng
  // đây là trang đọc dữ liệu từ DB và render ở server: một hàng lạ không được phép
  // làm trắng cả danh sách trang.
  const label = ROLE_LABEL[role] ?? role;
  return (label.split(' — ')[0] ?? label).toLowerCase();
}

/**
 * Trang chủ builder — màn "Trang".
 *
 * ## Vì sao không chỉ là danh sách trang
 *
 * Bản đầu liệt kê 2 trang rồi hết — hơn 80% màn hình trống. Vấn đề không nằm ở
 * thẩm mỹ: người mở công cụ không có cách nào biết nó LÀM ĐƯỢC GÌ. Có bao nhiêu
 * component dựng sẵn? Bảng màu riêng gồm những gì? Lần publish gần nhất là khi
 * nào, ai làm? Mọi câu đó đều đã có dữ liệu, chỉ là chưa ai bày ra.
 *
 * ## Vì sao thẻ component dẫn tới trang QUẢN LÝ, không phải "chèn"
 *
 * Chèn cần biết chèn VÀO ĐÂU, mà ở trang chủ thì chưa trang nào đang mở — một
 * nút "chèn" tại đây sẽ phải hỏi thêm một câu trước khi làm được gì. Tab
 * Component trong trang sửa đã làm việc đó trọn vẹn.
 *
 * Còn thứ trang chủ làm được mà tab kia không: mở component ra xem cây node của
 * nó, đổi tên, đổi mô tả cho AI, nhân bản.
 *
 * ## Vì sao thẻ trang không có số phiên bản hay thanh SEO như bản vẽ
 *
 * `listPages` không đọc hai thứ đó, và màn này chỉ bày số nó thật sự tính được. Thẻ
 * nói những gì đã có trong hàng `Page`: trạng thái so với bản đang chạy, vai định
 * tuyến, có mô tả SEO hay chưa, ngày sửa.
 */

export const dynamic = 'force-dynamic';

/** "dd/mm/yyyy", giờ Việt Nam — cùng một chuỗi ở mọi máy (xem `lib/when.ts`). */
function day(d: Date): string {
  return when(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "dd/mm/yyyy HH:mm". */
function stamp(d: Date): string {
  return `${day(d)} ${when(d, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export default async function BuilderHome() {
  const [pages, archived, releases, presets, settingsSummary, types] = await Promise.all([
    listPages(),
    listArchivedPages(),
    listReleases(4),
    listPresetCards(),
    loadSettingsSummary(),
    getCollectionTypes(),
  ]);

  // Hoàn tác lần nhập là việc của admin: không tính (và không lộ) cho vai thấp hơn hay service token.
  const session = await getSession();
  const isAdmin = session?.role === 'admin' && session.kind !== 'service';
  const undo = isAdmin ? await undoableImports(pages) : new Map<string, string>();

  const typeChoices = types.map((t) => ({ key: t.key, name: t.name }));
  const typeName = new Map(types.map((t) => [t.key, t.name]));

  const cards: PageCardData[] = pages.map((page) => {
    const col = parsePageCollection(page.collection);
    const type = col ? (typeName.get(col.typeKey) ?? col.typeKey) : null;
    const status: PageStatus = !page.isPublished
      ? 'draft'
      : page.hasUnpublishedChanges
        ? 'changed'
        : 'live';
    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      status,
      hasDescription: Boolean(page.description?.trim()),
      updated: day(page.updatedAt),
      updatedFull: stamp(page.updatedAt),
      collection: col,
      /*
        Vai của trang hiện NGAY TRÊN thẻ, không giấu trong dialog:
        `/blogs/[category]` một mình chỉ là một chuỗi có ngoặc, và lưới này là chỗ
        duy nhất người ta nhìn thấy cả bảng định tuyến cùng lúc.
      */
      roleLabel: page.system
        ? 'Trang hệ thống'
        : col
          ? `${type} · ${roleBadge(col.param)}`
          : null,
      roleTitle: page.system
        ? 'Hiện khi khách mở một đường dẫn không tồn tại. Sửa nội dung được, không xoá hay đổi đường dẫn được.'
        : col
          ? `Mặt tiền của loại "${type}"`
          : null,
      system: page.system,
      importId: undo.get(page.id) ?? null,
    };
  });

  const archivedCards: ArchivedCardData[] = archived.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    archived: day(page.archivedAt),
    archivedFull: stamp(page.archivedAt),
    releaseCount: page.releaseCount,
  }));

  /*
    Dòng dưới tiêu đề nói trạng thái CẢ site bằng câu, không bằng một con số trơ:
    con số nằm ở Tabs ngay bên dưới, và mỗi con số ở đó lọc được. Từng trang cần
    publish nằm trong `PendingWork`.
  */
  const changed = cards.filter((c) => c.status === 'changed').length;
  const drafts = cards.filter((c) => c.status === 'draft').length;
  const onSite = cards.length - drafts;
  const lastRelease = releases[0];
  const summary = [
    onSite === 0
      ? null
      : changed === 0
        ? 'Mọi trang đang chạy đều trùng với bản nháp.'
        : `${changed} trang có thay đổi chưa publish.`,
    drafts ? `${drafts} trang chưa từng publish.` : null,
    lastRelease ? `Lần publish gần nhất: ${stamp(lastRelease.createdAt)}.` : 'Chưa publish lần nào.',
  ]
    .filter(Boolean)
    .join(' ');

  const byCategory = new Map<string, typeof presets>();
  for (const p of presets) {
    byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p]);
  }

  return (
    <PageShell>
      <PageHeader title="Trang" count={pages.length} description={summary} actions={<div className="flex gap-2">{isAdmin && <ImportPageButton />}<NewPageButton /></div>} />

      {/*
        Dòng đếm cũ ("N trang có thay đổi chưa publish") đã bị thay.

        Nó đúng và vô dụng: người đọc vẫn phải mở từng trang để biết trang NÀO, và con
        số không dẫn tới hành động nào — đúng thứ mà luật 4 của `3e` ("mọi con số là
        đường dẫn") nói tới. `PendingWork` liệt kê từng trang, và mỗi dòng publish được
        riêng.
      */}
      <PendingWork />

      <PageGrid pages={cards} archived={archivedCards} types={typeChoices} />

      <div className="grid gap-x-6 gap-y-8 pt-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section
          id="component-dung-san"
          title="Component dựng sẵn"
          count={presets.length}
          description={
            <>
              Bấm vào một component để xem cây node, đổi tên, nhân bản. Chèn vào trang thì làm từ
              tab <span className="text-shell-ink">Component</span> khi đang mở trang đó — và chèn là{' '}
              <span className="text-shell-ink">sao chép</span>, nên sửa component sau đó không đổi
              trang đã chèn.
            </>
          }
          actions={
            presets.length > 0 && (
              <ButtonLink href="/builder/components" variant="secondary" size="md" iconRight="arrow-right">
                Quản lý component
              </ButtonLink>
            )
          }
        >
          {[...byCategory.entries()].map(([category, items]) => (
            <div key={category} className="flex flex-col gap-2.5">
              <p className={ui.eyebrow}>{category}</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {items.map((p, i) => (
                  <Link
                    key={p.id}
                    href={`/builder/components/${p.id}`}
                    className={cn(
                      ui.card,
                      ui.cardHover,
                      'group flex min-w-0 items-start gap-3 p-4',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent',
                    )}
                  >
                    <Tile index={i} size="sm">
                      {p.name.trim().charAt(0).toUpperCase() || '?'}
                    </Tile>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-ui font-semibold" title={p.name}>
                          {p.name}
                        </span>
                        <Icon
                          name="arrow-right"
                          size={15}
                          className="ml-auto text-shell-muted group-hover:text-shell-accent"
                        />
                      </span>
                      <span className="line-clamp-2 text-small leading-snug text-shell-muted">
                        {p.aiDescription}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {/* Không nhắc lệnh pnpm ở đây: xem docblock trạng thái rỗng trong
              `builder/components/page.tsx`. Server không có mã nguồn để chạy nó. */}
          {presets.length === 0 && (
            <EmptyState
              compact
              icon="cube"
              title="Chưa có component nào"
              description="Component là khối dùng lại giữa các trang: header, footer, thẻ tin."
              action={
                <ButtonLink href="/builder/components" variant="secondary" icon="plus">
                  Tạo cái đầu tiên
                </ButtonLink>
              }
            />
          )}
        </Section>

        <aside className="flex min-w-0 flex-col gap-8">
          {/* Từng có dải ô màu và font "mặc định của site" — gỡ 13/10/2026 cùng mục
              Nền tảng ở màn Cài đặt: các màu đó không phải màu trang thật đang
              dùng (xem `lib/design/foundations.ts`). Còn lại những con số đúng. */}
          <Section id="cai-dat" title="Cài đặt">
            <div className={cn(ui.card, 'flex flex-col gap-4 p-5')}>
              <dl className="flex flex-col gap-2 text-small">
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 text-shell-muted">Ngôn ngữ</dt>
                  <dd className="min-w-0 truncate">
                    {settingsSummary.defaultLocale ?? '—'}
                    {settingsSummary.localeCount > 1 && (
                      <span className="text-shell-muted"> +{settingsSummary.localeCount - 1}</span>
                    )}
                  </dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 text-shell-muted">Biến tự tạo</dt>
                  <dd className="min-w-0">{settingsSummary.customCount}</dd>
                </div>
              </dl>

              <Link
                href="/builder/settings"
                className="inline-flex items-center gap-1.5 self-start rounded-sm text-small font-semibold text-shell-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent"
              >
                Xem tất cả cài đặt
                <Icon name="arrow-right" size={15} />
              </Link>
            </div>
          </Section>

          <Section id="publish-gan-day" title="Publish gần đây" count={releases.length}>
            {releases.length > 0 ? (
              <div className={cn(ui.card, 'flex flex-col gap-1 p-5')}>
                <ul className="flex flex-col">
                  {releases.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-col gap-1 border-b border-shell-line py-2.5 first:pt-0 last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-ui font-semibold" title={r.label}>
                          {r.label}
                        </span>
                        {r.isActive && (
                          <Badge tone="ok" dot size="sm" className="ml-auto shrink-0">
                            đang chạy
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-mini text-shell-muted">
                        {stamp(r.createdAt)} · <span className="font-shell-mono">{r.createdBy}</span> ·{' '}
                        {r.pageCount} trang
                      </p>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/builder/releases"
                  className="mt-2 inline-flex items-center gap-1.5 self-start rounded-sm text-small font-semibold text-shell-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent"
                >
                  Xem lịch sử publish
                  <Icon name="arrow-right" size={15} />
                </Link>
              </div>
            ) : (
              <EmptyState
                compact
                icon="history"
                title="Chưa publish lần nào"
                description="Vào một trang rồi bấm Publish."
              />
            )}
          </Section>
        </aside>
      </div>
    </PageShell>
  );
}
