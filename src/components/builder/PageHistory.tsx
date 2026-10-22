'use client';

/**
 * Lịch sử sửa một trang, trong một dialog.
 *
 * ## Vì sao `<dialog>` thật chứ không phải một div `fixed`
 *
 * Thẻ `<dialog>` cho sẵn ba thứ mà bản tự dựng gần như luôn quên: bẫy focus,
 * Esc để đóng, và `aria-modal` để screen reader biết phần còn lại của trang đang
 * bị chặn. Tự dựng nghĩa là tự viết lại cả ba, và cái thứ nhất thì rất khó viết
 * đúng. `Dialog` của `ui/` dựng đúng trên thẻ đó.
 *
 * ## Vì sao tải lịch sử lúc MỞ, không phải lúc render trang
 *
 * Danh sách trang có thể có 20 trang. Tải lịch sử cho cả 20 lúc vào builder là 20
 * truy vấn kèm hàng chục `doc` để diff, cho một dialog mà người ta mở một lần
 * mỗi tuần. Tải khi mở là một truy vấn, đúng lúc cần.
 *
 * ## Vì sao cột `prompt` được cho nhiều chỗ nhất
 *
 * Đây là màn hình người ta mở khi **AI vừa làm sai gì đó**. Lúc đó câu hỏi không
 * phải "sửa lúc mấy giờ" mà "**mình đã yêu cầu cái gì**". `apply_ops` lưu prompt
 * từ trước; đây là nơi đầu tiên nó được đọc ra.
 *
 * ## Vì sao lùi bản hỏi lại NGAY TRONG HÀNG
 *
 * Lùi bản lùi được (lần lùi cũng vào lịch sử), nên một câu hỏi là đủ — nhưng câu đó
 * phải nằm cạnh đúng bản sắp lùi về. Một hộp `confirm()` của trình duyệt che mất danh
 * sách, đúng lúc người ta cần nhìn nó để chắc mình chọn đúng hàng.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { when as formatWhen } from '@/lib/when';

import { Badge } from './ui/Badge';
import { Button, Spinner } from './ui/Button';
import { Dialog } from './ui/Overlay';

interface VersionRow {
  id: string;
  seq: number;
  label: string | null;
  prompt: string | null;
  createdBy: string;
  createdAt: string;
  byAi: boolean;
  isCurrentDraft: boolean;
  isPublished: boolean;
  changes: { added: number; removed: number; textChanged: number } | null;
}

function when(iso: string): string {
  // `vi-VN` VÀ múi giờ đều cố định thay vì lấy theo máy: hai người trong cùng một
  // team đọc cùng một lịch sử phải thấy cùng một chuỗi, nếu không việc chỉ nhau
  // "dòng 14:32" trở nên vô nghĩa. Múi giờ là nửa còn lại của câu đó — xem
  // `lib/when.ts` để biết nửa bị quên ấy đã hiện ra ở đâu.
  return formatWhen(iso, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function changeSummary(c: VersionRow['changes']): string {
  if (!c) return '—';
  const parts: string[] = [];
  if (c.added) parts.push(`+${c.added}`);
  if (c.removed) parts.push(`−${c.removed}`);
  if (c.textChanged) parts.push(`${c.textChanged} chữ`);
  // Rỗng KHÁC null: null là "không so được", rỗng là "so rồi, không đổi gì".
  return parts.length ? parts.join(' · ') : 'không đổi node';
}

export function PageHistory({
  open,
  onClose,
  onReverted,
  pageId,
  slug,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** Gọi sau khi lùi xong: bản đích, và số của bản nháp mới mà lần lùi vừa tạo. */
  onReverted?: (r: { seq: number; draftSeq: number | null }) => void;
  pageId: string;
  slug: string;
  title: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<VersionRow[] | null> => {
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/history`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Không đọc được lịch sử');
      const versions = json.versions as VersionRow[];
      setRows(versions);
      return versions;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return null;
    }
  }, [pageId]);

  // Chỉ nạp ở lượt chuyển đóng → mở, và chỉ lần đầu: dialog mở lại thì danh sách
  // cũ vẫn đúng, trừ khi chính nó vừa lùi bản (lúc đó `revert` đã tự nạp lại).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && !rows) void load();
    wasOpen.current = open;
  }, [open, rows, load]);

  // Esc đóng dialog ở tầng browser; dọn `busy`, `error` và câu hỏi đang dở ở đây để
  // lần mở sau không hiện lại chúng.
  const close = () => {
    setBusy(null);
    setError(null);
    setConfirming(null);
    onClose();
  };

  const revert = async (v: VersionRow) => {
    setBusy(v.id);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Bản nháp đang hiện trong hộp: server từ chối nếu nó đã bị thay trong lúc hộp mở.
        body: JSON.stringify({
          versionId: v.id,
          expectDraftId: rows?.find((r) => r.isCurrentDraft)?.id,
        }),
      });
      const json = await res.json();
      if (res.status === 409) {
        // Nạp lại để người dùng thấy bản nháp mới trước khi chọn lại.
        await load();
        throw new Error(json.error ?? 'Bản nháp vừa đổi. Xem lại rồi chọn lại.');
      }
      if (!res.ok) throw new Error(json.error ?? 'Lùi bản thất bại');
      const fresh = await load();
      router.refresh();
      close();
      onReverted?.({ seq: v.seq, draftSeq: fresh?.find((r) => r.isCurrentDraft)?.seq ?? null });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setConfirming(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={<>Lịch sử sửa · {title}</>}
      description={
        <>
          <span className="font-shell-mono">/{slug}</span> · Mỗi lần lưu là một phiên bản. Lùi về
          một phiên bản tạo ra bản nháp mới, không xoá gì — site thật chỉ đổi khi bấm Publish.
        </>
      }
      actions={
        <Button variant="secondary" onClick={close}>
          Đóng
        </Button>
      }
    >
      {error && (
        <p role="alert" className="rounded-md bg-shell-danger-soft px-4 py-3 text-small text-shell-danger">
          {error}
        </p>
      )}

      <div className="-mx-6 max-h-[56vh] overflow-y-auto px-6">
        {!rows && !error && (
          <p className="flex items-center justify-center gap-2 py-10 text-ui text-shell-muted">
            <Spinner /> Đang tải…
          </p>
        )}

        {rows?.length === 0 && (
          <p className="py-10 text-center text-ui text-shell-muted">Chưa có bản nào trong lịch sử.</p>
        )}

        <ul className="flex flex-col">
          {rows?.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-shell-line py-3 last:border-b-0"
            >
              <span className="w-12 shrink-0 self-start pt-px font-shell-mono text-ui text-shell-ink">
                v{v.seq}
              </span>

              <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* `label` là LOẠI ('sửa tay' / 'AI' / 'lùi về v38'), không
                      phải danh tính — trước đây hai thông tin này chen vào một
                      chỗ, nên hàng nào cũng đọc là "sửa tay" và không trỏ tới
                      bản nào được. */}
                  {v.label && (
                    <span className="min-w-0 truncate text-ui font-semibold" title={v.label}>
                      {v.label}
                    </span>
                  )}
                  {v.byAi && (
                    <Badge tone="accent" size="sm">
                      AI
                    </Badge>
                  )}
                  {v.isCurrentDraft && (
                    <Badge tone="accent" size="sm">
                      nháp hiện tại
                    </Badge>
                  )}
                  {v.isPublished && (
                    <Badge tone="ok" size="sm">
                      đã publish
                    </Badge>
                  )}
                </div>

                <p className="text-small text-shell-muted">
                  {when(v.createdAt)} · <span className="font-shell-mono">{v.createdBy}</span> ·{' '}
                  {changeSummary(v.changes)}
                </p>

                {v.prompt && (
                  <p className="mt-0.5 border-l-2 border-shell-line pl-2.5 text-small leading-relaxed text-shell-muted italic">
                    “{v.prompt}”
                  </p>
                )}
              </div>

              {!v.isCurrentDraft && confirming !== v.id && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="history"
                  disabled={busy !== null}
                  onClick={() => setConfirming(v.id)}
                  className="ml-auto"
                >
                  Lùi về đây
                </Button>
              )}

              {confirming === v.id && (
                <div
                  className={cn(
                    'flex basis-full flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-shell-raised px-4 py-3',
                    'sm:ml-15',
                  )}
                >
                  <p className="min-w-0 flex-[1_1_16rem] text-small leading-relaxed">
                    Lùi bản nháp của <span className="font-shell-mono">/{slug}</span> về v{v.seq}?
                    Site thật không đổi cho tới khi bấm Publish, và lần lùi này cũng vào lịch sử.
                  </p>
                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setConfirming(null)}
                    >
                      Huỷ
                    </Button>
                    <Button variant="primary" size="sm" loading={busy === v.id} onClick={() => void revert(v)}>
                      {busy === v.id ? 'Đang lùi…' : `Lùi về v${v.seq}`}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
