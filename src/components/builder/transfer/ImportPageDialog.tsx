'use client';

/**
 * Nhập trang từ gói .zip — spec §6. Trình duyệt mở zip; server chỉ nhận manifest (JSON) và
 * từng file ≤ 10 MB, nên giới hạn kích thước request của proxy không chặn cả gói.
 *
 * Bước: chọn file → xem trước (chọn trang đích, thư mục cho file mới) → tải file còn thiếu
 * (tiến độ) → ghi → kết quả (mở editor, xem nháp, hoàn tác, việc cần làm).
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { TransferIssue } from '@/lib/transfer/guides';
import type { ImportPlan, ImportTarget } from '@/lib/transfer/import-plan';
import type { PageBundle } from '@/lib/transfer/manifest';
import { issue, UNDO_IMPORT_CONSEQUENCE } from '@/lib/transfer/guides';
import { openBundle, postFile, postJson } from '@/lib/transfer/client';
import { uploadsNeeded } from '@/lib/transfer/uploads';
import { TransferIssues } from './TransferGuide';
import { ImportStepsHelp } from './ImportStepsHelp';
import { ZipDropZone } from './ZipDropZone';
import { Button, Spinner } from '../ui/Button';
import { Consequence, Dialog } from '../ui/Overlay';

type Opened = { bundle: PageBundle; fileOf: (entry: string) => Uint8Array };
type Done = { pageId: string; importId: string; editorUrl: string; previewUrl: string; issues: TransferIssue[] };
type Phase =
  | { kind: 'pick'; issues: TransferIssue[] }
  | { kind: 'busy'; label: string }
  | { kind: 'preview'; plan: ImportPlan; issues: TransferIssue[] }
  | { kind: 'done'; result: Done; undone?: boolean; confirmUndo?: boolean };

export function ImportPageButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="upload" onClick={() => setOpen(true)}>Nhập trang</Button>
      {open && <ImportPageDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportPageDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick', issues: [] });
  const [opened, setOpened] = useState<Opened | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [pageId, setPageId] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [takeMeta, setTakeMeta] = useState(false);
  const [folderMode, setFolderMode] = useState<'' | 'source' | 'one'>('');
  const [folder, setFolder] = useState('');
  const [errorText, setErrorText] = useState('');
  const [resumable, setResumable] = useState(false);
  // Lỗi của lượt chạy (tải file / ghi) tách riêng: không phải 'chặn' của kế hoạch, nên không khoá nút Tiếp tục.
  const [runIssues, setRunIssues] = useState<TransferIssue[]>([]);
  const [running, setRunning] = useState(false);
  // Bản nháp đích mà người dùng ĐÃ NHÌN THẤY (spec G5): nếu lúc bấm Nhập nó đã đổi thì dừng, không ghi đè mù.
  const seen = useRef<{ key: string; draft: string | null } | null>(null);
  const lastPlan = useRef<ImportPlan | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Đóng hộp thoại = huỷ: dừng request đang bay và KHÔNG BAO GIỜ gọi ghi sau đó (spec §6 —
  // người dùng đóng giữa lúc tải file là đổi ý, không phải "chạy nốt trong nền").
  // Tạo trong effect chứ không trong useRef: StrictMode gắn–gỡ–gắn lại, controller đã huỷ sẽ kẹt lại.
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    ctl.current = c;
    return () => c.abort();
  }, []);
  const signal = () => ctl.current?.signal;
  const closed = () => ctl.current?.signal.aborted ?? false;
  const close = () => { ctl.current?.abort(); onClose(); };

  const target = (): ImportTarget | null =>
    mode === 'existing' ? (pageId ? { kind: 'existing', pageId } : null) : newSlug && newTitle ? { kind: 'new', slug: newSlug, title: newTitle } : null;

  const targetFor = (m: 'existing' | 'new', id = pageId, slug = newSlug, title = newTitle): ImportTarget | null =>
    m === 'existing' ? (id ? { kind: 'existing', pageId: id } : null) : slug && title ? { kind: 'new', slug, title } : null;

  async function preview(o: Opened, t: ImportTarget | null, clickTime = false) {
    setErrorText('');
    setPhase({ kind: 'busy', label: 'Đang xem trước…' });
    const r = await postJson('/api/transfer/preview', { bundle: o.bundle, target: t }, signal());
    if (closed()) return;
    if (!r.ok) {
      setErrorText(r.issues.length ? '' : r.error);
      // Đã có kế hoạch trước đó thì ở lại màn xem trước để không mất lựa chọn của người dùng.
      if (lastPlan.current) setPhase({ kind: 'preview', plan: lastPlan.current, issues: r.issues });
      else setPhase({ kind: 'pick', issues: r.issues });
      return;
    }
    const plan = (r.data as { plan: ImportPlan }).plan;
    lastPlan.current = plan;
    const key = JSON.stringify(t);
    const draft = plan.target?.draftVersionId ?? null;
    const before = seen.current;
    seen.current = { key, draft };
    const changed = clickTime && before?.key === key && before.draft !== draft;
    // Cảnh báo đổi bản nháp là của lượt chạy (không khoá nút): người dùng vừa thấy kế hoạch mới, bấm lại là chạy.
    if (changed) setRunIssues([issue('target-changed', 'block')]);
    setPhase({ kind: 'preview', plan, issues: plan.issues });
    return changed ? undefined : plan;
  }

  function repreview(m: 'existing' | 'new', id = pageId, slug = newSlug, title = newTitle) {
    const t = targetFor(m, id, slug, title);
    if (opened && t) { setRunIssues([]); void preview(opened, t); }
  }

  async function onFile(file: File) {
    setPhase({ kind: 'busy', label: 'Đang mở gói và kiểm từng file…' });
    const res = await openBundle(new Uint8Array(await file.arrayBuffer()));
    if (closed()) return;
    if (!res.ok) { setPhase({ kind: 'pick', issues: res.issues }); return; }
    setOpened(res);
    setNewSlug(res.bundle.page.slug);
    setNewTitle(res.bundle.page.title);
    const plan = await preview(res, null);
    if (plan?.suggestedPageId && !closed()) {
      setPageId(plan.suggestedPageId);
      await preview(res, { kind: 'existing', pageId: plan.suggestedPageId });
    }
  }

  async function run() {
    if (!opened) return;
    const t = target();
    setRunning(true);
    setRunIssues([]);
    try {
    const plan = await preview(opened, t, true);
    if (!plan || plan.issues.some((i) => i.level === 'block')) return;

    // Mỗi KHOÁ ĐÍCH một lần (không phải mỗi file): cùng byte khác tên là hai hàng ảnh ở đích.
    const uniq = uploadsNeeded(plan.assets);
    setResumable(false);
    setProgress({ done: 0, total: uniq.length });
    let done = 0;
    const queue = [...uniq];
    const failures: TransferIssue[] = [];
    let stopped = false;
    let failText = '';
    await Promise.all([0, 1, 2].map(async () => {
      for (let a = queue.shift(); a && !stopped && !closed(); a = queue.shift()) {
        const bytes = opened.fileOf(a.file);
        const form = new FormData();
        form.set('file', new Blob([new Uint8Array(bytes)], { type: a.mime }), a.name);
        form.set('sha256', a.sha256);
        form.set('name', a.name);
        form.set('folder', folderMode === 'source' ? (a.folder ?? '') : folder);
        const r = await postFile('/api/transfer/files', form, bytes.length, signal());
        if (!r.ok) {
          stopped = true;
          // Lỗi server không kèm hướng dẫn (vd 400 thư mục sai) là chữ của server, không phải "mất mạng".
          if (r.issues.length) failures.push(...r.issues);
          else if (!('aborted' in r)) failText = `${a.name}: ${r.error}`;
          return;
        }
        setProgress({ done: ++done, total: uniq.length });
      }
    }));
    if (closed()) return;
    setProgress(null);
    if (stopped) { setResumable(true); setRunIssues(failures); setErrorText(failText); setPhase({ kind: 'preview', plan, issues: plan.issues }); return; }

    setPhase({ kind: 'busy', label: 'Đang ghi vào bản nháp…' });
    const r = await postJson('/api/transfer/commit', {
      bundle: opened.bundle, target: t, takeMeta,
      expectDraftVersionId: plan.target?.draftVersionId ?? null,
    }, signal());
    if (closed()) return;
    if (!r.ok) { setErrorText(r.issues.length ? '' : r.error); setRunIssues(r.issues); setPhase({ kind: 'preview', plan, issues: plan.issues }); return; }
    setPhase({ kind: 'done', result: r.data as Done });
    router.refresh();
    } finally {
      setRunning(false);
    }
  }

  async function undo(result: Done) {
    setErrorText('');
    setPhase({ kind: 'busy', label: 'Đang hoàn tác…' });
    const r = await postJson('/api/transfer/undo', { importId: result.importId }, signal());
    if (closed()) return;
    if (!r.ok) { setErrorText(r.error); setPhase({ kind: 'done', result }); return; }
    setPhase({ kind: 'done', result, undone: true });
    router.refresh();
  }

  const plan = phase.kind === 'preview' ? phase.plan : null;
  const blocked = phase.kind === 'preview' && phase.issues.some((i) => i.level === 'block');
  const canRun = plan && !running && !blocked && target() && folderMode !== '' && (folderMode === 'source' || folder.trim());

  return (
    <Dialog
      open
      onClose={close}
      size="lg"
      title="Nhập trang từ file .zip"
      description="Nhập chỉ ghi bản nháp. Site thật không đổi cho tới khi bạn bấm Publish."
      actions={
        <>
          {phase.kind === 'preview' && <Button disabled={running} onClick={() => { setRunIssues([]); if (opened) void preview(opened, target()); }}>Xem trước lại</Button>}
          {phase.kind === 'preview' && <Button variant="primary" disabled={!canRun} onClick={() => void run()}>{resumable ? 'Tiếp tục' : 'Nhập'}</Button>}
          <Button onClick={close}>Đóng</Button>
        </>
      }
    >
      <div data-import-dialog={phase.kind} className="flex flex-col gap-4">
        <ImportStepsHelp />

        {phase.kind === 'pick' && (
          <>
            <ZipDropZone onFile={(f) => void onFile(f)} />
            <TransferIssues issues={phase.issues} />
          </>
        )}

        {errorText && <p role="alert" className="text-shell-danger">{errorText}</p>}

        {phase.kind === 'busy' && <p className="flex items-center gap-2"><Spinner /> {phase.label}</p>}
        {progress && <p data-import-progress>Đang tải file lên: {progress.done}/{progress.total}</p>}

        {plan && (
          <>
            {runIssues.length > 0 && <TransferIssues issues={runIssues} />}
            <p className="text-small text-shell-muted">
              Nguồn: “{plan.source.title}” (/{plan.source.slug}) · xuất từ {plan.source.origin} · {plan.source.exportedBy} · {new Date(plan.source.exportedAt).toLocaleString('vi-VN')}
            </p>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">Nhập vào</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" checked={mode === 'existing'} disabled={running} onChange={() => { setMode('existing'); repreview('existing'); }} />
                Trang có sẵn
                <select aria-label="Trang đích" value={pageId} disabled={running || mode !== 'existing'} onChange={(e) => { setPageId(e.target.value); repreview('existing', e.target.value); }}>
                  <option value="">— chọn trang —</option>
                  {plan.choices.map((c) => <option key={c.id} value={c.id}>/{c.slug} — {c.title}</option>)}
                </select>
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input type="radio" name="mode" checked={mode === 'new'} disabled={running} onChange={() => { setMode('new'); repreview('new'); }} />
                Trang mới
                <input aria-label="Đường dẫn trang mới" value={newSlug} disabled={running || mode !== 'new'} onChange={(e) => setNewSlug(e.target.value)} onBlur={() => repreview('new')} />
                <input aria-label="Tiêu đề trang mới" value={newTitle} disabled={running || mode !== 'new'} onChange={(e) => setNewTitle(e.target.value)} onBlur={() => repreview('new')} />
              </label>
              {mode === 'existing' && plan.target && (
                <p className="text-small" role="note">
                  Bản nháp hiện tại của trang này sẽ bị thay{plan.target.hasUnpublishedChanges ? ' (trang đang có thay đổi chưa publish)' : ''}. Site thật không đổi cho tới khi Publish. Hoàn tác được.
                </p>
              )}
              {mode === 'existing' && (
                <label className="flex items-center gap-2 text-small">
                  <input type="checkbox" disabled={running} checked={takeMeta} onChange={(e) => setTakeMeta(e.target.checked)} />
                  Lấy cả tiêu đề &amp; SEO từ file (mặc định giữ của trang đích)
                </label>
              )}
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">
                Ảnh &amp; video: {plan.assets.length} file — {plan.assets.filter((a) => a.status === 'upload').length} mới, {plan.assets.filter((a) => a.status !== 'upload').length} đã có ở đây
                {plan.assets.some((a) => a.status === 'restore') ? ` (${plan.assets.filter((a) => a.status === 'restore').length} đang trong thùng rác sẽ được lấy ra)` : ''}
              </legend>
              <p className="text-small text-shell-muted">Thư mục cho file mới (bắt buộc chọn):</p>
              <label className="flex items-center gap-2"><input type="radio" name="folder" checked={folderMode === 'source'} disabled={running} onChange={() => setFolderMode('source')} /> Giữ thư mục như bên nguồn</label>
              <label className="flex items-center gap-2">
                <input type="radio" name="folder" checked={folderMode === 'one'} disabled={running} onChange={() => setFolderMode('one')} /> Đưa hết vào:
                <input aria-label="Thư mục cho file mới" list="import-folders" value={folder} disabled={running || folderMode !== 'one'} onChange={(e) => setFolder(e.target.value)} placeholder="vd trang-chu/hero" />
                <datalist id="import-folders">{plan.folders.map((f) => <option key={f} value={f} />)}</datalist>
              </label>
            </fieldset>

            <ul className="text-small">
              {plan.components.map((c) => <li key={c.key}>Component {c.name} — {c.action === 'create' ? 'chưa có, sẽ tạo mới' : `dùng bản đang có ở đây${c.differs ? ' ⚠ khác bản trong file' : ''}`}</li>)}
              {plan.tokens.length > 0 && <li>Token tự tạo: {plan.tokens.filter((t) => t.action === 'create').length} tạo mới · {plan.tokens.filter((t) => t.action === 'keep').length} đã có (giữ giá trị ở đây)</li>}
              {plan.locales.map((l) => <li key={l.code}>Ngôn ngữ {l.code} — {l.count} bản dịch{l.status === 'missing' ? ' (bỏ qua: chưa có ngôn ngữ này)' : l.status === 'disabled' ? ' (ngôn ngữ đang tắt)' : ''}</li>)}
            </ul>

            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">{blocked ? 'Cần xử lý trước khi nhập' : 'Cần làm sau khi nhập'}</h3>
              <TransferIssues issues={phase.kind === 'preview' ? phase.issues : []} />
            </section>
          </>
        )}

        {phase.kind === 'done' && (
          <section data-import-done className="flex flex-col gap-3">
            <p className="font-semibold">{phase.undone ? 'Đã hoàn tác lần nhập.' : 'Đã nhập vào bản nháp.'}</p>
            {!phase.undone && (
              <div className="flex flex-wrap gap-2">
                <a className="underline" href={phase.result.editorUrl}>Mở editor</a>
                <a className="underline" href={phase.result.previewUrl} target="_blank" rel="noreferrer">Xem bản nháp</a>
                {!phase.confirmUndo && <Button onClick={() => { setErrorText(''); setPhase({ ...phase, confirmUndo: true }); }}>Hoàn tác lần nhập</Button>}
              </div>
            )}
            {!phase.undone && phase.confirmUndo && (
              <div data-import-undo-confirm className="flex flex-col gap-2">
                <Consequence>{UNDO_IMPORT_CONSEQUENCE}</Consequence>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger-solid" onClick={() => void undo(phase.result)}>Xác nhận hoàn tác</Button>
                  <Button onClick={() => setPhase({ ...phase, confirmUndo: false })}>Huỷ</Button>
                </div>
              </div>
            )}
            {!phase.undone && <TransferIssues issues={phase.result.issues} />}
          </section>
        )}
      </div>
    </Dialog>
  );
}
