'use client';

/**
 * Hộp "Tải file font" (§11.3): thả nhiều file, mỗi file một lần `dryRun` thành một dòng
 * (tên họ, weight, style sửa được), các dòng cùng họ gom lại, chọn fallback cho mỗi họ,
 * tick giấy phép rồi Lưu — gửi thật từng file, báo lỗi ngay trên dòng của nó.
 *
 * Ô kéo thả theo mẫu `transfer/ZipDropZone` (cùng `data-over`, input ẩn cho bàn phím và
 * e2e) nhưng nhận nhiều file font; `ZipDropZone` chỉ nhận một file .zip.
 */

import { useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import type { FontUploadResult } from '@/lib/fonts/service';
import { FALLBACKS } from '@/lib/fonts/types';

import { Badge, Progress } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Checkbox, SelectField, TextArea, TextField } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Dialog } from '../ui/Overlay';

const FONT_FILE = /\.(ttf|otf|woff2?)$/i;
type FallbackKey = keyof typeof FALLBACKS;

interface Row {
  key: number;
  file: File;
  family: string;
  weight: string;
  style: 'normal' | 'italic';
  warnings: string[];
  error: string | null;
  checking: boolean;
  done: boolean;
}

let nextKey = 1;
const famKey = (r: Row) => r.family.trim().toLowerCase();

async function post(form: FormData): Promise<{ ok: true; data: FontUploadResult } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/fonts', { method: 'POST', body: form });
    const body = (await res.json().catch(() => null)) as (FontUploadResult & { error?: string }) | null;
    if (res.ok && body) return { ok: true, data: body };
    return { ok: false, error: body?.error ?? `Lỗi ${res.status}` };
  } catch {
    return { ok: false, error: 'Không kết nối được tới server.' };
  }
}

function formOf(r: Row, extra: Record<string, string>) {
  const form = new FormData();
  form.set('file', r.file);
  if (r.family.trim()) form.set('family', r.family.trim());
  if (r.weight.trim()) form.set('weight', r.weight.trim());
  form.set('style', r.style);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  const take = (list: FileList | null | undefined) => {
    const all = Array.from(list ?? []);
    if (all.length === 0) return;
    const good = all.filter((f) => FONT_FILE.test(f.name));
    const bad = all.filter((f) => !FONT_FILE.test(f.name));
    setWrong(
      bad.length ? `Bỏ qua ${bad.map((f) => `"${f.name}"`).join(', ')}: chỉ nhận .ttf, .otf, .woff, .woff2.` : null,
    );
    if (good.length) onFiles(good);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        data-font-drop
        data-over={over || undefined}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors',
          over ? 'border-shell-accent bg-shell-accent-soft/70' : 'border-shell-line',
        )}
      >
        <Icon name="upload" size={24} className={over ? 'text-shell-accent' : 'text-shell-muted'} />
        <p className="font-semibold">{over ? 'Thả file vào đây' : 'Kéo file font vào đây'}</p>
        <p className="text-small text-shell-muted">hoặc</p>
        <Button variant="primary" icon="upload" onClick={() => input.current?.click()}>
          Chọn file font
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".ttf,.otf,.woff,.woff2,font/*"
          aria-label="File font"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {wrong && (
        <p role="alert" className="text-small text-shell-danger">
          {wrong}
        </p>
      )}
    </div>
  );
}

export function FontUploadDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [fallbacks, setFallbacks] = useState<Record<string, FallbackKey>>({});
  const [license, setLicense] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  const patch = (key: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  /** Một lần dryRun cho một dòng: điền tên họ/weight/style tìm được, hoặc ghi lỗi. */
  const probe = async (r: Row, keepEdits: boolean) => {
    patch(r.key, { checking: true });
    const res = await post(formOf(r, { dryRun: 'true', licenseConfirmed: 'true' }));
    if (!res.ok) {
      patch(r.key, { checking: false, error: res.error, warnings: [] });
      return;
    }
    const face = res.data.faces[0];
    patch(r.key, {
      checking: false,
      error: null,
      warnings: res.data.warnings.map((w) => w.message),
      ...(keepEdits
        ? {}
        : { family: res.data.family.cssName, weight: face?.weight ?? r.weight, style: face?.style ?? r.style }),
    });
  };

  const add = (files: File[]) => {
    const fresh: Row[] = files.map((file) => ({
      key: nextKey++,
      file,
      family: '',
      weight: '',
      style: 'normal',
      warnings: [],
      error: null,
      checking: true,
      done: false,
    }));
    setRows((rs) => [...rs, ...fresh]);
    for (const r of fresh) void probe(r, false);
  };

  const families = [...new Map(rows.filter((r) => r.family.trim()).map((r) => [famKey(r), r.family.trim()])).entries()];
  const ready = rows.filter((r) => !r.done);
  const canSave =
    license && ready.length > 0 && ready.every((r) => r.family.trim() && !r.checking && !r.error) && !saving;

  const reset = () => {
    setRows([]);
    setFallbacks({});
    setLicense(false);
    setNote('');
    setProgress(0);
  };
  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const save = async () => {
    setSaving(true);
    setProgress(0);
    let failed = 0;
    let i = 0;
    for (const r of ready) {
      const fb = FALLBACKS[fallbacks[famKey(r)] ?? 'sans'];
      const res = await post(
        formOf(r, {
          fallback: fb,
          licenseConfirmed: 'true',
          ...(note.trim() ? { licenseNote: note.trim() } : {}),
        }),
      );
      if (res.ok) patch(r.key, { done: true, error: null });
      else {
        failed++;
        patch(r.key, { error: res.error });
      }
      setProgress(++i);
    }
    setSaving(false);
    onSaved();
    if (failed === 0) {
      reset();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Tải file font"
      description="TTF, OTF, WOFF hoặc WOFF2, tối đa 10 MB mỗi file. Server cắt về woff2 trước khi lưu."
      size="lg"
      dismissable={!saving}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!canSave} loading={saving}>
            Lưu
          </Button>
        </>
      }
    >
      <DropZone onFiles={add} />

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="File đã chọn">
          {rows.map((r) => (
            <li
              key={r.key}
              data-font-file={r.file.name}
              className="flex flex-col gap-2 rounded-lg border border-shell-line p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-small">
                <span className="font-semibold">{r.file.name}</span>
                {r.checking && <span className="text-shell-muted">Đang kiểm tra…</span>}
                {r.done && (
                  <Badge tone="ok" size="sm">
                    đã lưu
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-[1fr_6rem_7rem] gap-2">
                <TextField
                  label="Tên họ"
                  size="md"
                  value={r.family}
                  disabled={r.done || saving}
                  onChange={(e) => patch(r.key, { family: e.target.value })}
                  onBlur={() => r.family.trim() && void probe(r, true)}
                />
                <TextField
                  label="Weight"
                  size="md"
                  value={r.weight}
                  placeholder="400"
                  disabled={r.done || saving}
                  onChange={(e) => patch(r.key, { weight: e.target.value })}
                  onBlur={() => void probe(r, true)}
                />
                <SelectField
                  label="Kiểu"
                  size="md"
                  value={r.style}
                  disabled={r.done || saving}
                  options={['normal', 'italic']}
                  onChange={(e) => {
                    const style = e.target.value as Row['style'];
                    patch(r.key, { style });
                    void probe({ ...r, style }, true);
                  }}
                />
              </div>
              {r.warnings.map((w) => (
                <p key={w} className="text-small text-shell-warn">
                  {w}
                </p>
              ))}
              {r.error && (
                <p role="alert" className="text-small text-shell-danger">
                  {r.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {families.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-small font-semibold">Fallback cho mỗi họ</h3>
          {families.map(([key, name]) => (
            <SelectField
              key={key}
              label={name}
              size="md"
              value={fallbacks[key] ?? 'sans'}
              onChange={(e) => setFallbacks((f) => ({ ...f, [key]: e.target.value as FallbackKey }))}
              options={[
                { value: 'sans', label: 'Sans (không chân)' },
                { value: 'serif', label: 'Serif (có chân)' },
                { value: 'mono', label: 'Mono (đơn cách)' },
              ]}
              hint="Chỉ có tác dụng với họ mới; họ đã có giữ fallback cũ."
            />
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <Checkbox
            label="Tôi xác nhận có giấy phép dùng các font này trên web"
            checked={license}
            onChange={(e) => setLicense(e.target.checked)}
            disabled={saving}
          />
          <TextArea
            label="Ghi chú giấy phép (không bắt buộc)"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={saving}
          />
        </>
      )}

      {saving && <Progress value={progress} max={ready.length} label="Đang lưu" valueLabel={`${progress}/${ready.length}`} />}
    </Dialog>
  );
}
