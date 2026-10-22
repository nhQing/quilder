'use client';

/**
 * Ô "Ngôn ngữ" của màn Cài đặt: thêm, bật/tắt, xoá. Xem
 * docs/superpowers/specs/2026-10-21-them-ngon-ngu-design.md.
 *
 * Danh sách đọc thẳng từ props (server render lại sau `router.refresh()`), không giữ bản sao
 * trong state — một nguồn sự thật, không lệch sau khi lưu.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { LocaleRow } from '@/lib/builder/settings';
import { checkLocaleCode, checkLocaleLabel, COMMON_LOCALE_CODES, nativeLocaleName } from '@/lib/i18n/locale-rules';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Switch, TextField } from './ui/Field';
import { ConfirmDialog, Consequence } from './ui/Overlay';

type Pending = { kind: 'enable' | 'disable' | 'delete'; locale: LocaleRow } | null;

export function SiteLocalesForm({ locales }: { locales: LocaleRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  /** Tên lần cuối TỰ ĐIỀN — người dùng chưa sửa tay thì đổi mã là đổi theo. */
  const [autoLabel, setAutoLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const codes = locales.map((l) => l.code);
  const suggestions = COMMON_LOCALE_CODES.filter((c) => !codes.includes(c));

  async function call(url: string, init: RequestInit): Promise<string | null> {
    setBusy(true);
    try {
      const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return json.error ?? `Thất bại (HTTP ${res.status})`;
      router.refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    const { kind, locale } = pending;
    const url = `/api/settings/locales/${encodeURIComponent(locale.code)}`;
    const err =
      kind === 'delete'
        ? await call(url, { method: 'DELETE' })
        : await call(url, { method: 'PATCH', body: JSON.stringify({ enabled: kind === 'enable' }) });
    setError(err);
    setPending(null);
  }

  async function add() {
    const c = code.trim().toLowerCase();
    const bad = checkLocaleCode(c, codes) ?? checkLocaleLabel(label);
    if (bad) {
      setAddError(bad);
      return;
    }
    const err = await call('/api/settings/locales', { method: 'POST', body: JSON.stringify({ code: c, label }) });
    setAddError(err);
    if (!err) {
      setCode('');
      setLabel('');
      setAutoLabel('');
      setAdding(false);
    }
  }

  const lost = pending?.kind === 'delete' ? pending.locale.translated + pending.locale.entries : 0;

  return (
    <div className="flex flex-col gap-3">
      {error && <Consequence>{error}</Consequence>}

      <ul className="flex flex-col">
        {locales.map((l) => (
          <li
            key={l.code}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-shell-line py-3 last:border-b-0"
            data-locale={l.code}
          >
            <code className="font-shell-mono min-w-6 text-small">{l.code}</code>
            <span className="min-w-0 flex-1 truncate text-ui font-semibold">{l.label}</span>
            <span className="text-mini text-shell-muted">
              {l.isDefault
                ? 'nguồn'
                : `${l.translated} chuỗi${l.entries ? ` · ${l.entries} bài viết` : ''} đã dịch`}
            </span>
            {l.isDefault ? (
              <Badge tone="accent" size="sm">
                mặc định
              </Badge>
            ) : (
              <>
                <Switch
                  label={<span className="sr-only">Bật {l.label}</span>}
                  checked={l.enabled}
                  disabled={busy}
                  onChange={(next) => setPending({ kind: next ? 'enable' : 'disable', locale: l })}
                />
                <IconButton
                  icon="trash"
                  size="sm"
                  variant="danger"
                  label={`Xoá ${l.label}`}
                  disabled={busy}
                  onClick={() => setPending({ kind: 'delete', locale: l })}
                />
              </>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="flex flex-col gap-3 rounded-md border border-shell-line p-3">
          <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3">
            <TextField
              id="locale-code"
              label="Mã"
              size="md"
              mono
              autoFocus
              spellCheck={false}
              list="locale-suggestions"
              placeholder="ja"
              value={code}
              onChange={(e) => {
                const v = e.target.value;
                setCode(v);
                // Điền sẵn tên gốc của ngôn ngữ (ja → 日本語) cho MỌI mã trình duyệt biết. Tên người
                // dùng đã sửa tay thì giữ nguyên.
                if (!label.trim() || label === autoLabel) {
                  const name = nativeLocaleName(v.trim().toLowerCase()) ?? '';
                  setLabel(name);
                  setAutoLabel(name);
                }
              }}
            />
            <TextField
              id="locale-label"
              label="Tên hiển thị"
              size="md"
              placeholder="日本語"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <datalist id="locale-suggestions">
              {suggestions.map((c) => (
                <option key={c} value={c}>
                  {nativeLocaleName(c) ?? c}
                </option>
              ))}
            </datalist>
          </div>
          {addError && <Consequence>{addError}</Consequence>}
          <p className="text-mini leading-relaxed text-shell-muted">
            Ngôn ngữ mới ở trạng thái <strong className="text-shell-ink">tắt</strong>: dịch ở Văn bản trước,
            rồi bật.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setAddError(null);
              }}
            >
              Huỷ
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={busy || !code.trim() || !label.trim()}
              onClick={() => void add()}
            >
              Thêm
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon="plus" className="self-start" onClick={() => setAdding(true)}>
          Thêm ngôn ngữ
        </Button>
      )}

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={() => void confirmPending()}
        busy={busy}
        title={
          pending?.kind === 'enable'
            ? `Bật ${pending.locale.label}?`
            : pending?.kind === 'disable'
              ? `Tắt ${pending.locale.label}?`
              : `Xoá ${pending?.locale.label ?? ''}?`
        }
        description={
          pending?.kind === 'enable' ? (
            <>
              Địa chỉ <code className="font-shell-mono">/{pending.locale.code}/…</code> có ngay trên site.
              Chữ đã dịch lên site sau lần <strong>Publish</strong> kế tiếp; chỗ chưa dịch hiện ngôn ngữ mặc định.
            </>
          ) : pending?.kind === 'disable' ? (
            <>
              Địa chỉ <code className="font-shell-mono">/{pending.locale.code}/…</code> gỡ khỏi site ngay. Bản
              dịch vẫn giữ, bật lại là dùng tiếp.
            </>
          ) : (
            'Không hoàn tác được.'
          )
        }
        consequence={
          pending?.kind === 'delete' && lost > 0
            ? `Mất ${pending.locale.translated} chuỗi dịch của trang và bản dịch của ${pending.locale.entries} bài viết.`
            : undefined
        }
        typeToConfirm={pending?.kind === 'delete' && lost > 0 ? pending.locale.code : undefined}
        confirmLabel={pending?.kind === 'enable' ? 'Bật' : pending?.kind === 'disable' ? 'Tắt' : 'Xoá'}
      />
    </div>
  );
}
