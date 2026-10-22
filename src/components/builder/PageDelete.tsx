'use client';

/**
 * Lưu trữ một trang, và khôi phục / xoá hẳn trang đã ở trong lưu trữ.
 *
 * ## Vì sao HAI bước chứ không một
 *
 * Cùng luật với `EntryDangerBox`: "xoá" lần thứ nhất là LƯU TRỮ — trang rời khỏi mọi
 * danh sách, rời khỏi bảng định tuyến, nhưng lấy lại được. Chỉ trang đã nằm trong lưu
 * trữ mới hiện "Xoá hẳn".
 *
 * ## Vì sao lần thứ nhất chỉ hỏi MỘT câu, lần thứ hai bắt GÕ
 *
 * Một thao tác lùi được thì một câu hỏi là đủ; nhiều hơn là dạy người ta bấm Đồng ý
 * mà không đọc. Còn xoá hẳn thì không lùi được, và một câu hỏi thứ hai không thêm
 * được gì — người ta bấm qua nó bằng đúng cùng một phản xạ. Gõ lại đường dẫn buộc
 * mắt phải đọc, và nó chặn đúng lỗi thật: bấm nhầm thẻ trong một lưới.
 *
 * Trang đã từng publish cũng xoá hẳn được (từ 21/10/2026): nó bị gỡ khỏi các release
 * cũ — xem `purgePage` cho lý do điều đó không làm hỏng lần lùi nào. Dialog nói ra số
 * release bị gỡ, vì đó là hậu quả duy nhất người bấm không tự đoán được.
 *
 * ## Vì sao lưu trữ là một dialog do bên ngoài mở
 *
 * Lối vào nằm trong menu "…" của thẻ trang (`PageGrid`), và menu đóng lại ngay khi
 * chọn xong — dialog không thể là con của nó. Nên `PageArchiveDialog` nhận `open`
 * từ thẻ, còn khôi phục / xoá hẳn vẫn là nút thật trên thẻ lưu trữ: ở đó chúng là
 * hai việc duy nhất làm được, giấu vào menu chỉ thêm một cú bấm.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from './ui/Button';
import { TextField } from './ui/Field';
import { Consequence, Dialog } from './ui/Overlay';

/** Truy vấn của ba thao tác trên `DELETE /api/pages/:id`. */
const ARCHIVE = '';
const RESTORE = '?restore=1';
const PURGE = '?purge=1';

function usePageDeleteCall(pageId: string) {
  const router = useRouter();
  /** Thao tác đang chạy — để vòng quay nằm đúng trên nút đã bấm. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(query: string): Promise<boolean> {
    setBusy(query);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}${query}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Lỗi ${res.status}`);
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, setError, call };
}

/** Xác nhận đưa một trang vào lưu trữ. Lùi được, nên chỉ một câu hỏi. */
export function PageArchiveDialog({
  open,
  onClose,
  onArchived,
  pageId,
  slug,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** Gọi sau khi server đã lưu trữ xong — chỗ hiện toast. */
  onArchived?: () => void;
  pageId: string;
  slug: string;
  title: string;
}) {
  const { busy, error, setError, call } = usePageDeleteCall(pageId);

  useEffect(() => {
    if (open) setError(null);
  }, [open, setError]);

  async function archive() {
    if (!(await call(ARCHIVE))) return;
    onClose();
    onArchived?.();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissable={busy === null}
      title={<>Đưa &ldquo;{title}&rdquo; vào lưu trữ?</>}
      description={<span className="font-shell-mono">/{slug}</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
            Huỷ
          </Button>
          <Button variant="danger-solid" loading={busy !== null} onClick={() => void archive()}>
            Lưu trữ trang
          </Button>
        </>
      }
    >
      <Consequence tone="warn">
        Trang rời khỏi builder và khỏi bảng định tuyến, nhưng không mất — lấy lại được từ mục
        Lưu trữ.
      </Consequence>
      {error && (
        <p role="alert" className="text-small leading-relaxed text-shell-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Hai nút trên thẻ của trang đã lưu trữ: Khôi phục, và Xoá hẳn (bắt gõ lại đường dẫn). */
export function PageDelete({
  pageId,
  slug,
  title,
  releaseCount,
  onRestored,
}: {
  pageId: string;
  slug: string;
  title: string;
  /** Số release có chứa trang. 0 = chưa từng publish. */
  releaseCount: number;
  /** Gọi sau khi khôi phục xong — chỗ hiện toast. */
  onRestored?: () => void;
}) {
  const { busy, error, setError, call } = usePageDeleteCall(pageId);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const expected = slug || '(trang chủ)';

  // Ô gõ là việc duy nhất làm được trong dialog này, nên focus vào nó chứ không vào
  // nút đóng — nút đóng đứng trước trong DOM và `showModal()` sẽ chọn nó.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function restore() {
    if (await call(RESTORE)) onRestored?.();
  }

  async function purge() {
    if (busy !== null || typed !== expected) return;
    if (await call(PURGE)) setOpen(false);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="md"
          icon="undo"
          loading={busy === RESTORE}
          disabled={busy !== null}
          onClick={() => void restore()}
        >
          Khôi phục
        </Button>
        {/* Không icon: hai nút có icon không vừa một hàng trong thẻ 250px. */}
        <Button
          variant="danger"
          size="md"
          disabled={busy !== null}
          onClick={() => {
            setTyped('');
            setError(null);
            setOpen(true);
          }}
        >
          Xoá hẳn
        </Button>
      </div>

      {/* Lỗi khôi phục hiện ngay dưới nút: dialog không mở thì không ai đọc được nó ở đó. */}
      {!open && error && (
        <p role="alert" className="text-small leading-relaxed text-shell-danger">
          {error}
        </p>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        dismissable={busy === null}
        title={<>Xoá hẳn &ldquo;{title}&rdquo;?</>}
        description={<span className="font-shell-mono">/{slug}</span>}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy !== null}>
              Huỷ
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="danger-solid"
              loading={busy === PURGE}
              disabled={busy !== null || typed !== expected}
            >
              {busy === PURGE ? 'Đang xoá…' : 'Xoá hẳn'}
            </Button>
          </>
        }
      >
        {/* Form riêng để Enter trong ô gõ gửi luôn, như mọi dialog có ô nhập khác. */}
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            void purge();
          }}
          className="flex flex-col gap-4"
        >
          <Consequence>
            Trang, toàn bộ lịch sử phiên bản và mọi bản dịch của nó sẽ mất hẳn. Không có đường
            lùi.
          </Consequence>
          {releaseCount > 0 && (
            <Consequence tone="warn">
              Trang có trong {releaseCount} release cũ và sẽ bị gỡ khỏi chúng. Lùi về một release
              cũ thì <span className="font-shell-mono">/{slug}</span> vẫn không có trang — y như
              bây giờ, vì trang đã ở trong lưu trữ.
            </Consequence>
          )}
          <TextField
            ref={input}
            label={
              <>
                Gõ <span className="font-shell-mono">{expected}</span> để xác nhận
              </>
            }
            mono
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
          />
          {error && (
            <p role="alert" className="text-small leading-relaxed text-shell-danger">
              {error}
            </p>
          )}
        </form>
      </Dialog>
    </div>
  );
}
