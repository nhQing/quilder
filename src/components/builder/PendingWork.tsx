'use client';

/**
 * Banner việc treo trên trang chủ builder: trang nào chưa lên site, và publish từng trang.
 *
 * ## Vì sao con số đầu là LẦN SỬA, không phải chỗ đổi
 *
 * `diffDocs` cố ý không so style. Đo trên dữ liệu thật ngày 09/09/2026: `/gioi-thieu`
 * có **1166 lần sửa** chưa publish và diff trả về `{added: 0, removed: 0, textChanged: 0}`
 * — nghĩa là một banner đếm chỗ đổi sẽ nói "không có gì đổi" trong khi bấm Publish sẽ
 * đổi site thật. Đó là quyết định #3 của spec, và con số trên đây dùng cùng nguồn với
 * số trên nút Publish trong editor.
 *
 * Chi tiết diff vẫn hiện, nhưng ở hàng dưới và **có nhãn nói nó không tính style**.
 * Bày một con số mà không nói nó đếm gì là cách chắc chắn để có người đọc sai nó.
 *
 * ## Vì sao banner thay thế dòng đếm cũ
 *
 * Dòng cũ nói "N trang có thay đổi chưa publish" rồi hết. Nó đúng và vô dụng: người đọc
 * vẫn phải mở từng trang để biết trang nào. Luật 4 của `3e` ("mọi con số là đường dẫn")
 * áp đúng vào đây.
 *
 * ## Vì sao tự nạp (`load()`) THAY VÌ CHỈ DÙNG `router.refresh()`
 *
 * Sau khi publish một trang, banner phải hết một dòng NGAY — không đợi round-trip
 * dựng lại cả trang chủ (component dựng sẵn, nền tảng thiết kế, lịch sử publish).
 * `load()` chỉ gọi lại `/api/pages/pending` nên khu này đổi tức thì.
 *
 * Nhưng danh sách "Trang" bên dưới (nhãn "nháp" / "chưa publish") nằm trong
 * `page.tsx` — một Server Component render một lần lúc mở trang, không nghe được
 * banner này publish xong. Thiếu bước nạp lại phần đó thì danh sách dưới đứng yên
 * dù publish đã xong thật (site đã đổi) — đây từng là một bug thật. Nên `publishOne`
 * gọi CẢ HAI: `load()` cho banner phản hồi nhanh, và `router.refresh()` cho danh
 * sách "Trang" đồng bộ theo — router.refresh() chỉ nạp lại phần server-render, không
 * phải điều hướng lại cả trang.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { DiffDialog } from './DiffDialog';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { Dialog } from './ui/Overlay';

interface Row {
  pageId: string;
  slug: string;
  title: string;
  status: 'moi' | 'da-sua';
  editCount: number | null;
  diff: { added: number; removed: number; textChanged: number };
}

/** Một câu tiếng Việt cho phần diff. Rỗng khi diff không thấy gì. */
export function diffPhrase(d: Row['diff']): string {
  const bits: string[] = [];
  if (d.added) bits.push(`thêm ${d.added}`);
  if (d.removed) bits.push(`xoá ${d.removed}`);
  if (d.textChanged) bits.push(`đổi chữ ${d.textChanged}`);
  return bits.join(' · ');
}

export function PendingWork() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Trang đang mở trong hộp "Xem diff" — `null` = hộp đóng. */
  const [diffPageId, setDiffPageId] = useState<string | null>(null);
  /** Trang đang chờ xác nhận publish — `null` = hộp đóng. */
  const [confirmRow, setConfirmRow] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pages/pending');
      const json = (await res.json()) as { pages?: Row[]; error?: string };
      if (!res.ok) {
        setError(json.error ?? `Lỗi ${res.status}`);
        return;
      }
      setRows(json.pages ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function publishOne(row: Row) {
    setBusy(row.pageId);
    setError(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `pageIds` — publish TỪNG TRANG, đường đã có sẵn ở `/api/publish`. Trang khác
        // giữ nguyên bản đang chạy của chúng.
        body: JSON.stringify({ pageIds: [row.pageId], label: `Publish /${row.slug}` }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Lỗi ${res.status}`);
        return;
      }
      await load();
      // Danh sách "Trang" bên dưới (nhãn "nháp" / "chưa publish") đọc từ
      // Server Component `page.tsx`, dựng một lần lúc mở trang — nó không tự
      // biết banner này vừa publish xong. `router.refresh()` chỉ nạp lại phần
      // server-render, không phải cả trang, nên state của banner (rows, error)
      // vẫn giữ nguyên trong lúc chờ.
      router.refresh();
    } finally {
      setBusy(null);
      setConfirmRow(null);
    }
  }

  // Chưa nạp xong thì KHÔNG dựng gì: một khung xám nhấp nháy rồi biến mất làm cả trang
  // chủ giật ở mỗi lần mở, và khu này không phải thứ người ta chờ.
  if (rows === null) return null;

  if (!rows.length) {
    return error ? <p className="text-small text-shell-warn">{error}</p> : null;
  }

  const edits = rows.reduce((n, r) => n + (r.editCount ?? 0), 0);
  const fresh = rows.filter((r) => r.status === 'moi').length;
  const pending = confirmRow;

  return (
    <section
      data-pending-work=""
      aria-labelledby="pending-work-title"
      className={cn(ui.card, 'flex flex-col gap-4 p-5')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id="pending-work-title" className="text-section font-semibold">
          Việc hôm nay
        </h2>
        <span className="text-small text-shell-muted">
          {/* Hai câu, không gộp thành một con số: "3 lần sửa" và "1 trang mới" là hai
              loại việc khác nhau, và "4" không nói được gì. */}
          {edits > 0 && <>{edits} lần sửa chưa publish</>}
          {edits > 0 && fresh > 0 && ' · '}
          {fresh > 0 && <>{fresh} trang chưa từng lên site</>}
        </span>
        <span className="ml-auto text-small text-shell-muted">
          Khách vẫn đang xem bản cũ cho tới khi bạn publish.
        </span>
      </div>

      {/* Hàng lồng trong thẻ gom nhóm bằng nền `shell-raised`, không chồng thêm bóng. */}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const phrase = diffPhrase(r.diff);
          return (
            <li
              key={r.pageId}
              className={cn(ui.inset, 'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5')}
            >
              <Link
                href={`/builder/${r.pageId}`}
                className="flex min-w-0 flex-[1_1_14rem] items-baseline gap-2 rounded-sm underline-offset-4 hover:underline"
              >
                <span className="truncate text-ui font-semibold">{r.title}</span>
                <span className="font-shell-mono shrink-0 text-mini text-shell-muted">/{r.slug}</span>
              </Link>

              <span className="flex flex-wrap items-center gap-1.5">
                {r.status === 'moi' ? (
                  <Badge tone="accent">trang mới</Badge>
                ) : (
                  <Badge tone="warn" className="tabular-nums">
                    {r.editCount} lần sửa
                  </Badge>
                )}

                {/* Chi tiết diff, và nhãn nói rõ nó đếm gì. Không có nhãn thì "0" ở đây
                    đọc như "không có gì đổi" — xem docblock đầu file. */}
                {phrase && (
                  <Badge
                    tone="neutral"
                    className="tabular-nums"
                    title="Node và chữ. KHÔNG tính style — đổi màu hay khoảng cách không hiện ở đây."
                  >
                    {phrase}
                  </Badge>
                )}
              </span>

              <span className="ml-auto flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="md" icon="eye" onClick={() => setDiffPageId(r.pageId)}>
                  Xem diff
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  icon="upload"
                  disabled={busy !== null}
                  loading={busy === r.pageId}
                  onClick={() => setConfirmRow(r)}
                >
                  {busy === r.pageId ? 'Đang publish…' : 'Publish trang này'}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="flex items-center gap-2 text-small text-shell-warn">
          <Icon name="alert" size={16} />
          {error}
        </p>
      )}

      <DiffDialog pageId={diffPageId} onClose={() => setDiffPageId(null)} />

      {/*
        Publish là hành động ra ngoài — nó đổi thứ khách đang xem. Một câu hỏi, và câu
        hỏi phải nói ĐÚNG hậu quả (luật 2 của `3e`). Nút xác nhận mang slug, không lặp
        "Publish trang này" của từng dòng: hai nút cùng tên trên một màn là hai nút
        cùng tên với cả người dùng lẫn test.
      */}
      {pending && (
        <Dialog
          open
          onClose={() => {
            if (busy === null) setConfirmRow(null);
          }}
          dismissable={busy === null}
          title={
            pending.status === 'moi'
              ? 'Đưa trang mới lên site?'
              : `Đưa ${pending.editCount} lần sửa lên site?`
          }
          description="Khách sẽ thấy bản mới ngay sau khi xong. Các trang khác giữ nguyên bản đang chạy."
          actions={
            <>
              <Button variant="secondary" onClick={() => setConfirmRow(null)} disabled={busy !== null}>
                Huỷ
              </Button>
              <Button
                variant="primary"
                icon="upload"
                loading={busy === pending.pageId}
                onClick={() => void publishOne(pending)}
              >
                Publish /{pending.slug}
              </Button>
            </>
          }
        >
          <p className="text-ui leading-relaxed">
            {pending.status === 'moi' ? (
              <>
                Trang mới “{pending.title}” sẽ lên site tại{' '}
                <span className="font-shell-mono">/{pending.slug}</span>.
              </>
            ) : (
              <>
                Bản nháp của “{pending.title}” (<span className="font-shell-mono">/{pending.slug}</span>)
                sẽ thay bản đang chạy. Lùi lại được ở Lịch sử publish.
              </>
            )}
          </p>
        </Dialog>
      )}
    </section>
  );
}
