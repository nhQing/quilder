'use client';

/**
 * Hộp "Nhập từ Google Fonts" (§11.4): ô tên hoặc link, các weight (mặc định tất cả), công
 * tắc italic, **Tìm** (dryRun, liệt kê face) rồi **Nhập**. Server gọi Google, không phải
 * trình duyệt — nên lỗi mạng của Google hiện nguyên lời nhắn của server.
 */

import { useState } from 'react';

import type { FontUploadResult } from '@/lib/fonts/service';
import { FALLBACKS } from '@/lib/fonts/types';

import { Button } from '../ui/Button';
import { Checkbox, SelectField, Switch, TextField } from '../ui/Field';
import { Dialog } from '../ui/Overlay';

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

type Reply = (FontUploadResult & { error?: string; imported?: unknown }) | null;

export function GoogleFontDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [family, setFamily] = useState('');
  const [weights, setWeights] = useState<number[]>(WEIGHTS);
  const [italic, setItalic] = useState(false);
  const [fallback, setFallback] = useState<keyof typeof FALLBACKS>('sans');
  const [found, setFound] = useState<FontUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'find' | 'import' | null>(null);

  const reset = () => {
    setFamily('');
    setWeights(WEIGHTS);
    setItalic(false);
    setFallback('sans');
    setFound(null);
    setError(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const send = async (dryRun: boolean) => {
    setBusy(dryRun ? 'find' : 'import');
    setError(null);
    try {
      const res = await fetch('/api/fonts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          google: {
            family: family.trim(),
            ...(weights.length === WEIGHTS.length ? {} : { weights }),
            italic,
          },
          fallback,
          dryRun,
        }),
      });
      const body = (await res.json().catch(() => null)) as Reply;
      if (!res.ok || !body) {
        setError(body?.error ?? `Lỗi ${res.status}`);
        // Nhập dở (một phần file đã vào kho): danh sách phải làm mới để thấy phần đã nhập.
        if (!dryRun && body?.imported) onSaved();
        if (dryRun) setFound(null);
        return;
      }
      if (dryRun) setFound(body);
      else {
        onSaved();
        reset();
        onClose();
      }
    } catch {
      setError('Không kết nối được tới server.');
    } finally {
      setBusy(null);
    }
  };

  const toggle = (w: number) =>
    setWeights((ws) => (ws.includes(w) ? ws.filter((x) => x !== w) : [...ws, w].sort((a, b) => a - b)));
  const canFind = family.trim() !== '' && weights.length > 0 && !busy;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Nhập từ Google Fonts"
      description="Gõ tên họ (Be Vietnam Pro) hoặc dán link fonts.google.com/specimen/…"
      size="md"
      dismissable={!busy}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={!!busy}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={() => void send(false)} disabled={!found || !!busy} loading={busy === 'import'}>
            Nhập
          </Button>
        </>
      }
    >
      <div className="flex items-end gap-2">
        <TextField
          label="Tên hoặc link"
          wrapperClassName="flex-1"
          value={family}
          onChange={(e) => {
            setFamily(e.target.value);
            setFound(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canFind) {
              e.preventDefault();
              void send(true);
            }
          }}
        />
        <Button variant="secondary" disabled={!canFind} loading={busy === 'find'} onClick={() => void send(true)}>
          Tìm
        </Button>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-small font-semibold">Weight</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {WEIGHTS.map((w) => (
            <Checkbox
              key={w}
              label={String(w)}
              checked={weights.includes(w)}
              onChange={() => {
                toggle(w);
                setFound(null);
              }}
            />
          ))}
        </div>
      </fieldset>

      <Switch
        label="Có chữ nghiêng (italic)"
        checked={italic}
        onChange={(v) => {
          setItalic(v);
          setFound(null);
        }}
      />

      <SelectField
        label="Fallback"
        value={fallback}
        onChange={(e) => setFallback(e.target.value as keyof typeof FALLBACKS)}
        options={[
          { value: 'sans', label: 'Sans (không chân)' },
          { value: 'serif', label: 'Serif (có chân)' },
          { value: 'mono', label: 'Mono (đơn cách)' },
        ]}
      />

      {found && (
        <div data-google-found className="flex flex-col gap-1.5 rounded-lg border border-shell-line p-3 text-small">
          <p className="font-semibold">
            {found.family.cssName} — {found.faces.length} file
            {found.family.created ? '' : ' (thêm vào họ đã có)'}
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-shell-muted">
            {found.faces.map((f, i) => (
              <li key={i}>
                {f.weight} {f.style}
                {f.subset ? ` · ${f.subset}` : ''}
                {f.replaced ? ' (thay)' : ''}
              </li>
            ))}
          </ul>
          {found.warnings.map((w) => (
            <p key={w.code} className="text-shell-warn">
              {w.message}
            </p>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-small text-shell-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
