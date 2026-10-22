'use client';

/**
 * Hộp thoại xuất: kiểm trước (chưa tải gì) → lỗi hiện thành chữ kèm hướng dẫn, hoặc nút
 * "Tải về" có thanh tiến độ. Tải bằng `fetch` chứ không bằng link thường: một lượt tải
 * link bị ngắt chỉ cho thấy "tải xuống thất bại" của trình duyệt (spec §5.1, X7).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { issue, type TransferIssue } from '@/lib/transfer/guides';
import { TransferIssues } from './TransferGuide';
import { Button, Spinner } from '../ui/Button';
import { Dialog } from '../ui/Overlay';

type Summary = { files: number; bytes: number; fileName: string };
type State =
  | { kind: 'checking' }
  | { kind: 'ready'; issues: TransferIssue[]; summary: Summary }
  | { kind: 'blocked'; issues: TransferIssue[] }
  | { kind: 'downloading'; received: number; summary: Summary }
  | { kind: 'done'; fileName: string }
  | { kind: 'error'; issues: TransferIssue[]; message?: string };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function ExportPageDialog({ pageId, slug, open, onClose }: { pageId: string; slug: string; open: boolean; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  // Mỗi lượt mở một controller; đóng hộp thoại thì huỷ lượt kiểm / lượt tải đang chạy — không
  // tải tiếp vài trăm MB vào RAM cho một hộp thoại đã đóng.
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    ctl.current = c;
    return () => c.abort();
  }, [open]);
  const live = () => ctl.current && !ctl.current.signal.aborted ? ctl.current : null;

  const check = useCallback(async () => {
    const c = live();
    if (!c) return;
    setState({ kind: 'checking' });
    try {
      const res = await fetch(`/api/pages/${pageId}/export/check`, { method: 'POST', signal: c.signal });
      // Proxy/cổng lỗi có thể trả HTML: không để res.json() ném ra làm sập hộp thoại.
      const data = await res.json().catch(() => null);
      if (c.signal.aborted) return;
      if (!data) { setState({ kind: 'error', issues: [issue('interrupted', 'block')] }); return; }
      // 4xx (hết phiên, thiếu quyền, trang không còn) là câu của server — X3 "không kết nối được
      // kho ảnh" sẽ dắt người dùng đi kiểm S3 vô ích.
      if (res.status >= 400 && res.status < 500) {
        setState({ kind: 'error', issues: [], message: data.error ?? `Lỗi ${res.status}` });
        return;
      }
      if (!res.ok) { setState({ kind: 'error', issues: [issue('storage-unreachable', 'block', { detail: data.error })] }); return; }
      setState(data.ok ? { kind: 'ready', issues: data.issues, summary: data.summary } : { kind: 'blocked', issues: data.issues });
    } catch {
      if (!c.signal.aborted) setState({ kind: 'error', issues: [issue('interrupted', 'block')] });
    }
  }, [pageId]);

  async function download(summary: Summary) {
    const c = live();
    if (!c) return;
    setState({ kind: 'downloading', received: 0, summary });
    try {
      const res = await fetch(`/api/pages/${pageId}/export`, { signal: c.signal });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setState({ kind: 'blocked', issues: data.issues ?? [issue('interrupted', 'block')] });
        return;
      }
      const reader = res.body.getReader();
      const parts: BlobPart[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        received += value.length;
        setState({ kind: 'downloading', received, summary });
      }
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = summary.fileName;
      a.click();
      // Thu hồi ngay sau click thì có trình duyệt chưa kịp bắt đầu tải → file hỏng / không tải.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState({ kind: 'done', fileName: summary.fileName });
    } catch {
      if (!c.signal.aborted) setState({ kind: 'error', issues: [issue('interrupted', 'block')] });
    }
  }

  useEffect(() => { if (open) void check(); }, [open, check]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Xuất trang /${slug}`}
      description="Gói .zip gồm bản nháp, bản dịch, component, token tự tạo và file ảnh của trang."
      actions={
        <>
          {(state.kind === 'blocked' || state.kind === 'error') && <Button onClick={() => void check()}>Thử lại</Button>}
          {state.kind === 'ready' && (
            <Button variant="primary" icon="download" onClick={() => void download(state.summary)}>
              {state.issues.length ? 'Vẫn xuất' : 'Tải về'}
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
        </>
      }
    >
      <div data-export-dialog={state.kind} className="flex flex-col gap-3">
        {state.kind === 'checking' && <p className="flex items-center gap-2"><Spinner /> Đang kiểm từng file trong kho…</p>}
        {state.kind === 'ready' && <p>Sẵn sàng: {state.summary.files} file, {mb(state.summary.bytes)}.</p>}
        {state.kind === 'downloading' && <p className="flex items-center gap-2"><Spinner /> Đang tải về… {mb(state.received)}</p>}
        {state.kind === 'done' && <p>Đã tải về <strong>{state.fileName}</strong>.</p>}
        {state.kind === 'error' && state.message && <p role="alert" className="text-shell-danger">{state.message}</p>}
        {(state.kind === 'ready' || state.kind === 'blocked' || state.kind === 'error') && <TransferIssues issues={state.issues} />}
      </div>
    </Dialog>
  );
}
