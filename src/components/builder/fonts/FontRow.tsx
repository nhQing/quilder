'use client';

/**
 * Một hàng họ font (§11.2). Họ có sẵn trong lõi: không mở được, chỉ hiện token và chỗ
 * dùng. Họ tải lên/Google: mở ra để sửa tên, fallback, ghi chú giấy phép, thay/xoá face,
 * xoá họ (admin, khoá khi còn chỗ dùng).
 */

import Link from 'next/link';
import { useId, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import type { FontListItem } from '@/lib/fonts/service';
import { FALLBACKS } from '@/lib/fonts/types';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { TextArea, TextField } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { ConfirmDialog } from '../ui/Overlay';

export const PREVIEW_TEXT = 'Tiền về nhanh — Ắ ẩ ữ ộ ₫ 0123';

const SOURCE_LABEL = { builtin: 'Có sẵn trong lõi', upload: 'Tải lên', google: 'Google Fonts' } as const;

/** `"Tên họ"` có nháy, thoát `"` và `\` — tên lấy từ bảng name của file nên không tin được. */
const familyCss = (name: string) => `"${name.replace(/[\\"]/g, '\\$&')}"`;

/** 100–900 hoặc "300 400 700": tóm tắt các weight của họ, không lặp. */
function weightSummary(font: FontListItem): string {
  const ws = [...new Set(font.faces.map((f) => f.weight))];
  ws.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const range = ws.find((w) => /\s/.test(w));
  const text = range ? range.replace(/\s+/, '–') : ws.join(' ');
  return font.faces.some((f) => f.style === 'italic') ? `${text} · italic` : text;
}

const count = (n: number, noun: string) => `${n} ${noun}`;
function usageSummary(font: FontListItem): string {
  const p = font.usage.pages.length;
  const c = font.usage.components.length;
  if (p + c === 0) return 'Chưa dùng ở đâu';
  return `Dùng ở ${[p ? count(p, 'trang') : '', c ? count(c, 'component') : ''].filter(Boolean).join(' · ')}`;
}

async function call(url: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init);
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? `Lỗi ${res.status}`;
  } catch {
    return 'Không kết nối được tới server.';
  }
}

export function FontRow({
  font,
  canWrite,
  isAdmin,
  onChanged,
}: {
  font: FontListItem;
  canWrite: boolean;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const builtin = font.source === 'builtin';
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const noVietnamese = font.faces.some((f) => f.warnings.includes('missing_vietnamese'));
  const [copied, setCopied] = useState(false);

  const copyToken = () => {
    void navigator.clipboard?.writeText(font.token).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  const summary = (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-left">
      <span
        data-font-preview
        className="truncate text-[1.5rem] leading-snug text-shell-ink"
        style={{ fontFamily: `${familyCss(font.cssName)}, ${font.fallback}` }}
      >
        {PREVIEW_TEXT}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-shell-ink">{font.cssName}</span>
        <Badge className="font-shell-mono" data-font-token>
          {font.token}
        </Badge>
        <span className="text-small text-shell-muted">
          {SOURCE_LABEL[font.source]}
          {builtin && ' (chỉ đọc)'}
        </span>
        {font.unpublished && (
          <Badge tone="warn" size="sm">
            Chưa publish
          </Badge>
        )}
        {noVietnamese && (
          <Badge tone="warn" size="sm" title="Thiếu một số chữ tiếng Việt có dấu">
            thiếu chữ tiếng Việt
          </Badge>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 text-small text-shell-muted">
        <span>{weightSummary(font)}</span>
        <span>{builtin ? 'Font mặc định khi chưa đặt font nào' : usageSummary(font)}</span>
      </span>
    </div>
  );

  return (
    <li data-font-row={font.token} className="flex flex-col">
      <div className="flex items-start gap-2 px-4 py-3.5">
        {builtin ? (
          summary
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-start rounded-md text-left"
          >
            {summary}
            <Icon
              name="chevron-right"
              size={18}
              className={cn('mt-2 shrink-0 text-shell-muted transition-transform', open && 'rotate-90')}
            />
          </button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon="copy"
          aria-label={`Chép token ${font.token}`}
          onClick={copyToken}
          className="mt-1"
        >
          {copied ? 'Đã chép' : ''}
        </Button>
      </div>
      {!builtin && open && (
        <FontDetail id={panelId} font={font} canWrite={canWrite} isAdmin={isAdmin} onChanged={onChanged} />
      )}
    </li>
  );
}

function FontDetail({
  id,
  font,
  canWrite,
  isAdmin,
  onChanged,
}: {
  id: string;
  font: FontListItem;
  canWrite: boolean;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [cssName, setCssName] = useState(font.cssName);
  const [fallback, setFallback] = useState(font.fallback);
  const [note, setNote] = useState(font.licenseNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmFamily, setConfirmFamily] = useState(false);
  const [confirmFace, setConfirmFace] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<FontListItem['faces'][number] | null>(null);

  const used = font.usage.pages.length + font.usage.components.length;
  const dirty =
    cssName.trim() !== font.cssName || fallback.trim() !== font.fallback || note !== (font.licenseNote ?? '');

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
    else onChanged();
    return err;
  };

  const save = () =>
    run(() =>
      call(`/api/fonts/${font.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cssName: cssName.trim(), fallback: fallback.trim(), licenseNote: note }),
      }),
    );

  const replaceFile = (file: File) => {
    const face = replaceTarget.current;
    if (!face) return;
    const form = new FormData();
    form.set('file', file);
    form.set('family', font.cssName);
    form.set('weight', face.weight);
    form.set('style', face.style);
    form.set('fallback', font.fallback);
    form.set('licenseConfirmed', 'true');
    return run(() => call('/api/fonts', { method: 'POST', body: form }));
  };

  return (
    <div id={id} className="flex flex-col gap-4 border-t border-shell-line bg-shell-raised/40 px-4 py-4">
      <table className="w-full text-small">
        <thead>
          <tr className="text-left text-shell-muted">
            <th className="py-1 font-medium">Weight</th>
            <th className="py-1 font-medium">Kiểu</th>
            <th className="py-1 font-medium">Bộ chữ</th>
            <th className="py-1 font-medium">Dung lượng</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {font.faces.map((f) => (
            <tr key={f.id ?? `${f.weight}-${f.style}-${f.subset}`} className="border-t border-shell-line">
              <td className="py-1.5">{f.weight}</td>
              <td className="py-1.5">{f.style}</td>
              <td className="py-1.5">{f.subset}</td>
              <td className="py-1.5">{f.bytes === null ? '—' : `${Math.max(1, Math.round(f.bytes / 1024))} KB`}</td>
              <td className="py-1.5 text-right">
                {canWrite && f.id && (
                  <span className="inline-flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        replaceTarget.current = f;
                        replaceInput.current?.click();
                      }}
                    >
                      Thay file
                    </Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmFace(f.id)}>
                      Xoá
                    </Button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <input
        ref={replaceInput}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/*"
        aria-label="File font thay thế"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void replaceFile(f);
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Tên họ CSS"
          value={cssName}
          disabled={!canWrite}
          onChange={(e) => setCssName(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <TextField
            label="Fallback"
            mono
            value={fallback}
            disabled={!canWrite}
            onChange={(e) => setFallback(e.target.value)}
          />
          {canWrite && (
            <span className="flex gap-1.5">
              {(Object.keys(FALLBACKS) as (keyof typeof FALLBACKS)[]).map((k) => (
                <Button key={k} size="sm" variant="ghost" onClick={() => setFallback(FALLBACKS[k])}>
                  {k}
                </Button>
              ))}
            </span>
          )}
        </div>
      </div>
      <TextArea
        label="Ghi chú giấy phép"
        rows={2}
        value={note}
        disabled={!canWrite}
        onChange={(e) => setNote(e.target.value)}
        hint={font.licenseConfirmedBy ? `Giấy phép do ${font.licenseConfirmedBy} xác nhận.` : undefined}
      />

      <div className="flex flex-col gap-1.5">
        <h3 className="text-small font-semibold">Chỗ dùng</h3>
        {used === 0 ? (
          <p className="text-small text-shell-muted">Chưa dùng ở đâu.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-small">
            {[...font.usage.pages, ...font.usage.components].map((u) => (
              <li key={u.href}>
                <Link href={u.href} className="text-shell-accent hover:text-shell-ink">
                  {u.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="text-small text-shell-danger">
          {error}
        </p>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="md" disabled={!dirty} loading={busy} onClick={() => void save()}>
            Lưu
          </Button>
          {isAdmin && (
            <Button
              variant="danger"
              size="md"
              className="ml-auto"
              disabled={used > 0 || busy}
              title={used > 0 ? 'Còn chỗ đang dùng font này — gỡ khỏi các chỗ đó trước.' : undefined}
              onClick={() => setConfirmFamily(true)}
            >
              Xoá họ
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmFamily}
        onClose={() => setConfirmFamily(false)}
        title={`Xoá họ ${font.cssName}?`}
        consequence="Mọi face và token của họ này bị xoá. Release đã publish vẫn giữ file của nó."
        confirmLabel="Xoá họ"
        busy={busy}
        onConfirm={async () => {
          const err = await run(() => call(`/api/fonts/${font.id}`, { method: 'DELETE' }));
          if (err) setConfirmFamily(false);
        }}
      />
      <ConfirmDialog
        open={confirmFace !== null}
        onClose={() => setConfirmFace(null)}
        title="Xoá face này?"
        consequence="Chữ đang dùng weight/kiểu này sẽ rơi về face gần nhất hoặc font dự phòng."
        confirmLabel="Xoá"
        busy={busy}
        onConfirm={async () => {
          const faceId = confirmFace;
          await run(() => call(`/api/fonts/${font.id}/faces/${faceId}`, { method: 'DELETE' }));
          setConfirmFace(null);
        }}
      />
    </div>
  );
}
