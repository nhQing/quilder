'use client';

/**
 * Lịch sử publish và lùi bản.
 *
 * Lùi bản là ĐỔI MỘT CON TRỎ (`Site.activeReleaseId`), không phải dựng lại nội
 * dung: `PageVersion` bất biến một khi đã có release trỏ tới, nên bytes cũ vẫn
 * nguyên và thao tác này không bao giờ fail được. Đó là lý do nút ở đây an toàn
 * để bấm lúc đang hoảng — và lúc đang hoảng là lúc người ta dùng nó.
 *
 * Vẫn hỏi xác nhận: nó đổi thứ khách đang xem ngay lập tức. Hộp xác nhận nói hậu
 * quả bằng dữ liệu thật của danh sách — bản đích có bao nhiêu trang, trang nào của
 * bản đang chạy không có trong nó — chứ không phải một câu chung cho mọi bản.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui, type Tone } from '@/lib/builder/ui';
import { when } from '@/lib/when';

import { Badge } from './ui/Badge';
import { Button, ButtonLink } from './ui/Button';
import { Icon } from './ui/Icon';
import { EmptyState } from './ui/Page';
import { ConfirmDialog, Consequence, Dialog, Toast, ToastRegion } from './ui/Overlay';

export interface ReleaseRow {
  id: string;
  label: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  isActive: boolean;
  pageCount: number;
  changedPages: { slug: string; title: string; kind: 'added' | 'changed' | 'removed' }[];
  /** Ngoài cửa sổ rollback: lùi về vẫn chạy, nhưng ảnh đã xoá hoàn toàn có thể vỡ. */
  inRollbackWindow: boolean;
}

const KIND_LABEL: Record<ReleaseRow['changedPages'][number]['kind'], { text: string; tone: Tone }> = {
  added: { text: 'thêm', tone: 'ok' },
  changed: { text: 'sửa', tone: 'neutral' },
  removed: { text: 'gỡ', tone: 'danger' },
};

/** Số bản hiện sẵn trong dòng thời gian; phần còn lại sau nút "Xem thêm". */
const SHOWN = 10;

/** `dd/mm/yyyy HH:mm` theo giờ Việt Nam — `when()` lo phần múi giờ. */
function stamp(at: string): string {
  const day = when(at, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = when(at, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

/**
 * Trang của bản đang chạy mà bản đích KHÔNG có — khách sẽ mở chúng ra 404.
 *
 * Danh sách chỉ mang diff của từng bản so với bản liền trước (`changedPages`),
 * không mang tập trang đầy đủ, nên đi dọc chuỗi diff từ bản đang chạy tới bản đích
 * và xét mỗi slug: có mặt ở bản đang chạy (sự kiện đầu không phải "thêm") mà vắng
 * ở bản đích (sự kiện cuối là "gỡ"). Đi lùi thì đảo nghĩa thêm ↔ gỡ.
 *
 * Theo slug, nên một trang đổi slug giữa chừng không bị kể — câu hậu quả thiếu một
 * trang còn hơn nói sai một trang.
 */
function pagesMissingAfterRollback(releases: ReleaseRow[], activeIndex: number, targetIndex: number): string[] {
  type Kind = ReleaseRow['changedPages'][number]['kind'];
  const steps: { kind: Kind; slug: string }[] = [];
  if (targetIndex > activeIndex) {
    // Bản đích cũ hơn: hoàn tác diff của bản đang chạy, rồi của từng bản trước nó.
    for (let i = activeIndex; i < targetIndex; i++) {
      for (const p of releases[i]?.changedPages ?? []) {
        steps.push({ slug: p.slug, kind: p.kind === 'added' ? 'removed' : p.kind === 'removed' ? 'added' : p.kind });
      }
    }
  } else {
    // Bản đích mới hơn (đã lùi trước đó): áp diff của các bản nằm giữa, cũ trước.
    for (let i = activeIndex - 1; i >= targetIndex; i--) {
      for (const p of releases[i]?.changedPages ?? []) steps.push(p);
    }
  }
  const first = new Map<string, Kind>();
  const last = new Map<string, Kind>();
  for (const s of steps) {
    if (!first.has(s.slug)) first.set(s.slug, s.kind);
    last.set(s.slug, s.kind);
  }
  return [...last.entries()]
    .filter(([slug, kind]) => kind === 'removed' && first.get(slug) !== 'added')
    .map(([slug]) => slug)
    .sort();
}

function slugList(slugs: string[]): string {
  const shown = slugs.slice(0, 3).map((s) => `/${s}`);
  return slugs.length > 3 ? `${shown.join(', ')} và ${slugs.length - 3} trang khác` : shown.join(', ');
}

export function ReleaseTimeline({ releases, canPublish }: {
  releases: ReleaseRow[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; detail?: string } | null>(null);
  /** Bản đang chờ xác nhận lùi về — `null` = hộp đóng. */
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseRow | null>(null);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Toast thành công tự tắt sau 5 giây; toast lỗi ở lại tới khi người dùng đóng.
  useEffect(() => {
    if (!message?.ok) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const rollback = async (release: ReleaseRow) => {
    setBusy(release.id);
    setMessage(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', releaseId: release.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Lùi bản thất bại');
      setMessage({
        ok: true,
        text: `Đã đưa site về "${json.label}" trong ${json.ms}ms.`,
        detail: 'Bản nháp không đổi. Publish lại lúc nào cũng được.',
      });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: String(error instanceof Error ? error.message : error) });
    } finally {
      setBusy(null);
      setRollbackTarget(null);
    }
  };

  /**
   * Publish CẢ SITE: mọi trang đang có bản nháp đều lên cùng lúc.
   *
   * Nút này ở đây chứ không ở thanh trên của editor, và đó là chủ đích. Nút
   * Publish trong editor giờ chỉ đẩy đúng trang đang mở; thao tác rộng hơn nhiều
   * lần ấy phải nằm ở chỗ người ta đến khi đang nghĩ về cả site — cạnh danh sách
   * release và nút lùi bản — chứ không phải cách nút "Xem nháp" 8px lúc đang sửa
   * một dòng chữ. Đó đúng là cách một nút publish site-wide bị bấm nhầm.
   */
  const publishAll = async () => {
    setBusy('all');
    setMessage(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Publish thất bại');
      setMessage({
        ok: true,
        text: `Đã publish ${json.pageCount} trang trong ${json.ms}ms.`,
        detail: 'Lùi lại được ngay ở màn này.',
      });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: String(error instanceof Error ? error.message : error) });
    } finally {
      setBusy(null);
      setPublishAllOpen(false);
    }
  };

  const publishAllButton = canPublish ? (
    <Button
      variant="primary"
      icon="upload"
      onClick={() => setPublishAllOpen(true)}
      disabled={busy !== null}
      loading={busy === 'all'}
    >
      {busy === 'all' ? 'Đang publish…' : 'Publish toàn site'}
    </Button>
  ) : null;

  /*
   * Hộp xác nhận publish cả site. Nút xác nhận KHÔNG lặp tên "Publish toàn site":
   * hai nút cùng tên trên một màn là hai nút cùng tên với người dùng lẫn với test.
   */
  const publishAllDialog = canPublish ? (
    <Dialog
      open={publishAllOpen}
      onClose={() => setPublishAllOpen(false)}
      title="Publish toàn bộ site?"
      description="Khách sẽ thấy ngay lập tức. Lùi lại được ngay ở màn này."
      dismissable={busy !== 'all'}
      actions={
        <>
          <Button variant="secondary" onClick={() => setPublishAllOpen(false)} disabled={busy === 'all'}>
            Huỷ
          </Button>
          <Button variant="primary" icon="upload" loading={busy === 'all'} onClick={() => void publishAll()}>
            Publish mọi trang
          </Button>
        </>
      }
    >
      <Consequence tone="warn">
        Bản nháp của <strong>mọi trang</strong> sẽ lên site thật cùng lúc, kể cả trang đang làm dở.
        Muốn đẩy một trang thôi thì vào trang đó và bấm “Publish trang này”.
      </Consequence>
    </Dialog>
  ) : null;

  const toast = (
    <ToastRegion>
      {message && (
        <Toast
          tone={message.ok ? 'ok' : 'danger'}
          title={message.text}
          description={message.detail}
          onClose={() => setMessage(null)}
        />
      )}
    </ToastRegion>
  );

  if (!releases.length) {
    return (
      <>
        <EmptyState
          icon="history"
          title="Chưa publish lần nào"
          description="Vào một trang rồi bấm Publish trang này. Mỗi lần publish sẽ hiện ở đây và lùi về được."
          action={publishAllButton && <div className="mt-2">{publishAllButton}</div>}
        />
        {publishAllDialog}
        {toast}
      </>
    );
  }

  /*
   * Bản đang chạy, và bản NGAY TRƯỚC nó trong danh sách.
   *
   * "Ngay trước" tính theo thứ tự thời gian của danh sách, không phải theo lịch sử
   * lùi bản: nếu ai đó đã lùi hai lần thì bản đang chạy có thể nằm giữa danh sách, và
   * "một bước" nghĩa là bản publish liền trước nó. Đó cũng là thứ người dùng thấy
   * bằng mắt khi nhìn danh sách — nút không được nói khác cái họ đang nhìn.
   */
  const activeIndex = releases.findIndex((r) => r.isActive);
  const active = activeIndex >= 0 ? releases[activeIndex] : null;
  const oneStepBack = activeIndex >= 0 ? releases[activeIndex + 1] : undefined;

  // Bản đang chạy luôn nằm trong phần hiện sẵn, kể cả khi đã lùi về một bản rất cũ.
  const shownCount = showAll ? releases.length : Math.max(SHOWN, activeIndex + 2);
  const shown = releases.slice(0, shownCount);
  const hidden = releases.length - shown.length;

  const target = rollbackTarget;
  const targetIndex = target ? releases.findIndex((r) => r.id === target.id) : -1;
  const missing = target && activeIndex >= 0 && targetIndex >= 0
    ? pagesMissingAfterRollback(releases, activeIndex, targetIndex)
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/*
        Thẻ "đang chạy" tách khỏi danh sách.

        Nhãn nhỏ trong danh sách trả lời được "bản nào đang chạy" nhưng chỉ khi người
        đọc quét hết danh sách. Câu hỏi đầu tiên của người mở màn này lại đúng là câu
        đó, nên nó xứng đáng một thẻ riêng ở trên cùng — cùng lý do bảng điều khiển
        tách "Việc hôm nay" ra khỏi danh sách trang. Đây là thẻ `shell-hero` duy nhất
        của màn.
      */}
      {active && (
        <section
          data-active-release={active.id}
          aria-label="Bản đang chạy"
          className="flex flex-wrap items-center gap-5 rounded-lg bg-shell-hero p-5 text-shell-on-hero shadow-shell-card"
        >
          <span aria-hidden className="grid size-13 shrink-0 place-items-center rounded-md bg-shell-on-hero/12">
            <Icon name="globe" size={24} />
          </span>
          <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-section font-semibold text-balance">{active.label}</span>
              <Badge tone="ok" dot>
                đang chạy
              </Badge>
            </div>
            <span className="text-small text-shell-hero-muted">
              {stamp(active.createdAt)} · <span className="font-shell-mono">{active.createdBy}</span> ·{' '}
              {active.pageCount} trang
              {active.changedPages.length > 0 && (
                <>
                  {' · '}
                  {active.changedPages
                    .slice(0, 3)
                    .map((p) => `${KIND_LABEL[p.kind].text} /${p.slug}`)
                    .join(', ')}
                  {active.changedPages.length > 3 && ` và ${active.changedPages.length - 3} trang khác`}
                </>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/preview/release/${active.id}`}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'inline-flex h-control-md items-center gap-2 rounded-md bg-shell-on-hero px-3.5 text-small font-semibold text-shell-hero transition-[filter] hover:brightness-95',
                focusRing,
              )}
            >
              Xem
              <Icon name="external" size={16} />
            </a>

            {/*
              `Lùi một bước` — đường thoát nhanh khi vừa publish nhầm.

              Nó không làm gì mà nút "Đưa site về bản này" ở dòng dưới không làm
              được; thứ nó tiết kiệm là phải TÌM đúng dòng trong một danh sách 30
              bản, đúng lúc đang cuống. Vắng mặt khi bản đang chạy là bản đầu tiên —
              không có bước nào để lùi, và một nút tối ở đó chỉ gợi ra một câu hỏi.
            */}
            {canPublish && oneStepBack && (
              <Button
                variant="secondary"
                size="md"
                icon="undo"
                data-one-step-back=""
                disabled={busy !== null}
                loading={busy === oneStepBack.id}
                onClick={() => setRollbackTarget(oneStepBack)}
                title={`Đưa site về "${oneStepBack.label}"`}
              >
                {busy === oneStepBack.id ? 'Đang lùi…' : 'Lùi một bước'}
              </Button>
            )}
          </div>
        </section>
      )}

      <div className={cn(ui.card, 'flex flex-wrap items-center gap-3 px-5 py-3.5')}>
        <p className="min-w-0 flex-[1_1_22rem] text-small text-shell-muted">
          Nút Publish trong từng trang chỉ đẩy trang đó. Nút bên phải đẩy bản nháp của mọi trang.
        </p>
        {publishAllButton}
      </div>

      <section aria-labelledby="releases-timeline" className="flex flex-col gap-3.5">
        <h2 id="releases-timeline" className="text-section font-semibold">
          Các lần publish
        </h2>

        {/*
          Bản đang chạy CÓ MẶT trong dòng thời gian dù đã có thẻ riêng ở trên: thẻ trả
          lời "bản nào", dòng thời gian trả lời "nó đứng ở đâu" — sau một lần lùi, bản
          đang chạy có thể nằm giữa danh sách, và đó là thứ phải nhìn thấy được.

          Chấm và đường dọc là pseudo-element, không phải `<span>`: nhãn release là
          `<span>` ĐẦU TIÊN của mỗi dòng, và đó là chỗ e2e đọc nhãn bản sẽ lùi về.
        */}
        <ol className="relative flex flex-col gap-3 pl-7 before:absolute before:top-2.5 before:bottom-2.5 before:left-2 before:w-0.5 before:rounded-full before:bg-shell-line">
          {shown.map((release) => (
            <li
              key={release.id}
              className={cn(
                ui.card,
                'relative flex flex-wrap items-center gap-x-4 gap-y-3 p-4',
                'before:absolute before:top-5.5 before:-left-6.5 before:size-3.5 before:rounded-full before:border-2',
                release.isActive
                  ? 'ring-2 ring-shell-ok before:border-shell-ok before:bg-shell-ok'
                  : 'before:border-shell-line-strong before:bg-shell-panel',
              )}
            >
              <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1">
                <span className="text-card font-semibold text-balance">{release.label}</span>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-shell-muted">
                  {release.isActive && (
                    <Badge tone="ok" dot size="sm">
                      đang chạy
                    </Badge>
                  )}
                  {!release.inRollbackWindow && (
                    <span
                      data-rollback-window="outside"
                      title="Bản này nằm ngoài cửa sổ rollback. Lùi về vẫn được, nhưng ảnh đã xoá hoàn toàn sau khi publish sẽ không còn."
                      className={cn(ui.chip, ui.tone.warn, 'px-2 py-px text-micro')}
                    >
                      không còn đảm bảo rollback
                    </span>
                  )}
                  <span>
                    {stamp(release.createdAt)} · <span className="font-shell-mono">{release.createdBy}</span> ·{' '}
                    {release.pageCount} trang
                  </span>
                </div>

                {release.note && <p className="text-small text-shell-muted">{release.note}</p>}

                {release.changedPages.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1.5">
                    {release.changedPages.map((page) => (
                      <li key={`${page.kind}-${page.slug}`} className="inline-flex items-center gap-1.5">
                        <Badge tone={KIND_LABEL[page.kind].tone} size="sm">
                          {KIND_LABEL[page.kind].text}
                        </Badge>
                        <span className="font-shell-mono text-mini text-shell-ink" title={page.title}>
                          /{page.slug}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  // Publish gom TOÀN BỘ bản nháp, nên bấm Publish khi không sửa gì
                  // vẫn tạo một release. Nói thẳng ra để danh sách không đầy những
                  // dòng trông giống hệt nhau mà không rõ vì sao.
                  <p className="mt-1 text-small text-shell-muted">Không có trang nào đổi so với bản trước.</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/*
                  `Xem` có ở MỌI bản, kể cả bản đang chạy và kể cả với vai trò không
                  lùi được.

                  Trước lát 5, câu duy nhất đáng hỏi trước khi lùi — *bản đó trông ra
                  sao* — chỉ trả lời được bằng cách lùi thật rồi nhìn, tức dùng site
                  thật làm bản xem thử. Nút này đứng TRƯỚC nút lùi vì đó là thứ tự
                  người ta làm.
                */}
                <ButtonLink
                  href={`/preview/release/${release.id}`}
                  target="_blank"
                  rel="noreferrer"
                  variant="ghost"
                  size="md"
                  iconRight="external"
                >
                  Xem
                </ButtonLink>

                {!release.isActive && canPublish && (
                  <Button
                    variant="secondary"
                    size="md"
                    icon="history"
                    disabled={busy !== null}
                    loading={busy === release.id}
                    onClick={() => setRollbackTarget(release)}
                  >
                    {busy === release.id ? 'Đang lùi…' : 'Đưa site về bản này'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>

        {hidden > 0 && (
          <div className="flex justify-center pl-7">
            <Button variant="secondary" onClick={() => setShowAll(true)}>
              Xem thêm {hidden} release
            </Button>
          </div>
        )}

        {!canPublish && (
          <p className="text-small text-shell-muted">
            Vai trò của bạn chỉ xem được lịch sử, không lùi bản được.
          </p>
        )}
      </section>

      {canPublish && target && (
        <ConfirmDialog
          open
          onClose={() => {
            if (busy === null) setRollbackTarget(null);
          }}
          onConfirm={() => void rollback(target)}
          busy={busy === target.id}
          title="Đưa site về bản này?"
          description="Bản nháp trong builder không bị đụng tới, và lùi lên lại được bất cứ lúc nào ở màn này."
          confirmLabel="Đưa site về bản này"
          consequence={
            <div className="flex flex-col gap-1.5">
              <p>
                Site sẽ chạy bản “{target.label}” lúc {stamp(target.createdAt)} ({target.pageCount} trang)
                {active ? ` thay cho bản đang chạy (${active.pageCount} trang).` : '.'}
              </p>
              {missing.length > 0 && (
                <p>
                  {missing.length === 1
                    ? `Trang ${slugList(missing)} không có trong bản đó nên khách sẽ không mở được nó`
                    : `${missing.length} trang ${slugList(missing)} không có trong bản đó nên khách sẽ không mở được chúng`}{' '}
                  cho tới lần publish sau.
                </p>
              )}
              {!target.inRollbackWindow && (
                <p>
                  Bản này ngoài cửa sổ rollback: ảnh đã xoá hoàn toàn sau lần publish đó sẽ không hiện.
                </p>
              )}
            </div>
          }
        />
      )}

      {publishAllDialog}
      {toast}
    </div>
  );
}
