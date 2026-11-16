'use client';

/**
 * Hộp thoại xuất: kiểm trước (chưa tải gì) → lỗi hiện thành chữ kèm hướng dẫn, hoặc nút
 * "Tải về" có thanh tiến độ. Tải bằng `fetch` chứ không bằng link thường: một lượt tải
 * link bị ngắt chỉ cho thấy "tải xuống thất bại" của trình duyệt (spec §5.1, X7).
 *
 * Cả hai bước đều có % và thời gian còn lại (`progress.ts`): bước kiểm đọc stream NDJSON của
 * `export/check`, bước tải đếm byte nhận được so với tổng media server báo. Bước tải dùng lại
 * gói của bước kiểm (`summary.token`) nên bắt đầu stream ngay, không đọc lại cả kho.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { issue, type TransferIssue } from '@/lib/transfer/guides';
import {
  etaMs, formatEta, fractionDone, percentLabel, splitNdjson, type CheckEvent, type WorkCount,
} from '@/lib/transfer/progress';
import { TransferIssues } from './TransferGuide';
import { Progress } from '../ui/Badge';
import { Button, Spinner } from '../ui/Button';
import { Dialog } from '../ui/Overlay';

type Summary = { files: number; bytes: number; fileName: string; token?: string };
/** Đã chạy bao lâu và tới đâu — đủ để vẽ % và ETA. `null`: chưa biết tổng (chưa có dòng đầu). */
type Tick = { done: WorkCount; total: WorkCount; startedAt: number; now: number } | null;
type State =
  | { kind: 'checking'; tick: Tick }
  | { kind: 'ready'; issues: TransferIssue[]; summary: Summary; checkMs: number }
  | { kind: 'blocked'; issues: TransferIssue[] }
  | { kind: 'downloading'; received: number; expected: number; summary: Summary; startedAt: number; now: number }
  | { kind: 'done'; fileName: string; ms: number }
  | { kind: 'error'; issues: TransferIssue[]; message?: string };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** "12 giây" / "2 phút 5 giây" — thời gian đã chạy xong, không làm tròn kiểu ước tính. */
function took(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} giây` : `${Math.floor(s / 60)} phút ${s % 60} giây`;
}

/** Không re-render hộp thoại mỗi chunk vài KB: tối đa ~8 lần/giây. */
const PAINT_EVERY_MS = 120;

function ProgressLine({ label, fraction, elapsedMs, detail }: { label: string; fraction: number; elapsedMs: number; detail: string }) {
  const pct = percentLabel(fraction);
  return (
    <div data-export-progress className="flex flex-col gap-1.5">
      <Progress value={pct} max={100} label={label} valueLabel={`${pct}%`} />
      <p className="flex justify-between gap-2 text-mini text-shell-muted" aria-live="polite">
        <span>{detail}</span>
        <span>{formatEta(etaMs(fraction, elapsedMs))}</span>
      </p>
    </div>
  );
}

export function ExportPageDialog({ pageId, slug, open, onClose }: { pageId: string; slug: string; open: boolean; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'checking', tick: null });
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
    const startedAt = Date.now();
    setState({ kind: 'checking', tick: null });
    try {
      const res = await fetch(`/api/pages/${pageId}/export/check`, {
        method: 'POST',
        signal: c.signal,
        headers: { accept: 'application/x-ndjson' },
      });
      let status = res.status;
      let data: { ok?: boolean; issues?: TransferIssue[]; summary?: Summary; error?: string } | null = null;

      if ((res.headers.get('content-type') ?? '').includes('application/x-ndjson') && res.body) {
        // Stream: các dòng `progress` rồi một dòng `result`. Mất kết nối giữa chừng → không có
        // `result` → rơi xuống nhánh "interrupted" bên dưới, đúng như bản JSON cũ.
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        let painted = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const { lines, rest } = splitNdjson(buf + value);
          buf = rest;
          for (const line of lines) {
            let ev: CheckEvent;
            try { ev = JSON.parse(line) as CheckEvent; } catch { continue; }
            if (ev.type === 'result') {
              status = ev.status;
              data = (ev.body ?? null) as typeof data;
            } else if (ev.type === 'progress') {
              const now = Date.now();
              const last = ev.done.files === ev.total.files;
              if (last || now - painted >= PAINT_EVERY_MS) {
                painted = now;
                if (!c.signal.aborted) setState({ kind: 'checking', tick: { done: ev.done, total: ev.total, startedAt, now } });
              }
            }
          }
        }
      } else {
        // Proxy/cổng lỗi có thể trả HTML: không để res.json() ném ra làm sập hộp thoại.
        data = await res.json().catch(() => null);
      }

      if (c.signal.aborted) return;
      if (!data) { setState({ kind: 'error', issues: [issue('interrupted', 'block')] }); return; }
      // 4xx (hết phiên, thiếu quyền, trang không còn) là câu của server — X3 "không kết nối được
      // kho ảnh" sẽ dắt người dùng đi kiểm S3 vô ích.
      if (status >= 400 && status < 500) {
        setState({ kind: 'error', issues: [], message: data.error ?? `Lỗi ${status}` });
        return;
      }
      if (status >= 400) { setState({ kind: 'error', issues: [issue('storage-unreachable', 'block', { detail: data.error })] }); return; }
      setState(data.ok && data.summary
        ? { kind: 'ready', issues: data.issues ?? [], summary: data.summary, checkMs: Date.now() - startedAt }
        : { kind: 'blocked', issues: data.issues ?? [] });
    } catch {
      if (!c.signal.aborted) setState({ kind: 'error', issues: [issue('interrupted', 'block')] });
    }
  }, [pageId]);

  async function download(summary: Summary) {
    const c = live();
    if (!c) return;
    const startedAt = Date.now();
    setState({ kind: 'downloading', received: 0, expected: summary.bytes, summary, startedAt, now: startedAt });
    try {
      const qs = summary.token ? `?token=${encodeURIComponent(summary.token)}` : '';
      const res = await fetch(`/api/pages/${pageId}/export${qs}`, { signal: c.signal });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setState({ kind: 'blocked', issues: data.issues ?? [issue('interrupted', 'block')] });
        return;
      }
      // Tổng server báo (đếm theo entry, file trùng chỉ một lần) chính xác hơn `summary.bytes`.
      const headerBytes = Number(res.headers.get('x-export-media-bytes'));
      const expected = Number.isFinite(headerBytes) && headerBytes > 0 ? headerBytes : summary.bytes;
      const reader = res.body.getReader();
      const parts: BlobPart[] = [];
      let received = 0;
      let painted = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        received += value.length;
        const now = Date.now();
        if (now - painted >= PAINT_EVERY_MS) {
          painted = now;
          setState({ kind: 'downloading', received, expected, summary, startedAt, now });
        }
      }
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = summary.fileName;
      a.click();
      // Thu hồi ngay sau click thì có trình duyệt chưa kịp bắt đầu tải → file hỏng / không tải.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState({ kind: 'done', fileName: summary.fileName, ms: Date.now() - startedAt });
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
        {state.kind === 'checking' && !state.tick && (
          <p className="flex items-center gap-2"><Spinner /> Đang đọc bản nháp và danh sách file…</p>
        )}
        {state.kind === 'checking' && state.tick && (
          <ProgressLine
            label="Đang kiểm từng file trong kho"
            fraction={fractionDone(state.tick.done, state.tick.total)}
            elapsedMs={state.tick.now - state.tick.startedAt}
            detail={`${state.tick.done.files}/${state.tick.total.files} file · ${mb(state.tick.done.bytes)}/${mb(state.tick.total.bytes)}`}
          />
        )}
        {state.kind === 'ready' && (
          <p>Sẵn sàng: {state.summary.files} file, {mb(state.summary.bytes)}. <span className="text-shell-muted">Kiểm xong trong {took(state.checkMs)}.</span></p>
        )}
        {state.kind === 'downloading' && (
          <ProgressLine
            label="Đang tải về"
            fraction={state.expected > 0 ? Math.min(1, state.received / state.expected) : 0}
            elapsedMs={state.now - state.startedAt}
            detail={`${mb(state.received)}/${mb(state.expected)}`}
          />
        )}
        {state.kind === 'done' && <p>Đã tải về <strong>{state.fileName}</strong> trong {took(state.ms)}.</p>}
        {state.kind === 'error' && state.message && <p role="alert" className="text-shell-danger">{state.message}</p>}
        {(state.kind === 'ready' || state.kind === 'blocked' || state.kind === 'error') && <TransferIssues issues={state.issues} />}
      </div>
    </Dialog>
  );
}
