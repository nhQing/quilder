'use client';

/**
 * Ô "Form" ở màn Cài đặt: MỖI FORM MỘT BOX — tên, nơi chứa, URL nhận dữ liệu, và các nút
 * của chính nó.
 *
 * ## Vì sao lấy FORM làm gốc, không lấy khoá
 *
 * Bên dưới, form không giữ URL mà giữ một KHOÁ (`params.endpointKey`), và URL nằm trong
 * bảng `Site.globals.endpoint`. Bản đầu của ô này bày đúng cơ chế đó — bảng khoá → URL,
 * form treo lủng lẳng dưới từng khoá — và người dùng đọc không hiểu: họ nghĩ "form danh
 * sách chờ gửi tới đâu", không nghĩ "khoá subscribe trỏ đâu".
 *
 * Nên khoá lùi xuống làm chi tiết (một dòng chữ nhỏ trong box), và mỗi nút dịch về đúng
 * một thay đổi của bảng hoặc của form — xem `formEndpointAction`:
 *  - Lưu URL → đổi URL của khoá form đang dùng. Khoá dùng CHUNG với form khác thì box nói
 *    rõ "sửa ở đây là sửa cho cả N form", kèm nút Tách URL riêng.
 *  - Tách URL riêng → form có khoá riêng (đặt theo tên form), các form kia giữ URL cũ.
 *  - Đổi tên → đặt tên node của form (bản nháp), cùng tên hiện ở Inspector.
 *  - Mở → vào editor, chọn sẵn form.
 *
 * Đổi URL: bản xem nháp dùng ngay (`draftSiteGlobals`), site thật đổi khi Publish.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { insecureEndpoint, type EndpointTable } from '@/lib/doc/endpoint-table';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { Badge } from './ui/Badge';
import { Button, ButtonLink, IconButton } from './ui/Button';

export interface EndpointFormRow {
  nodeId: string;
  label: string;
  composite: 'Form' | 'NavChart';
  where: { kind: 'page'; id: string; slug: string; title: string } | { kind: 'component'; id: string; name: string };
  href: string;
}

export interface EndpointUsageRow {
  key: string;
  forms: EndpointFormRow[];
}

type FormItem = EndpointFormRow & { key: string };

const placeOf = (f: EndpointFormRow) =>
  f.where.kind === 'page' ? `trang /${f.where.slug}` : `component ${f.where.name}`;

const idOf = (f: EndpointFormRow) => `${f.where.kind}:${f.where.id}:${f.nodeId}`;

type Post =
  | { action: 'setUrl'; key: string; url: string }
  | { action: 'split'; place: string; placeId: string; nodeId: string; url: string }
  | { action: 'rename'; place: string; placeId: string; nodeId: string; name: string }
  | { action: 'removeKey'; key: string; force?: boolean };

async function post(body: Post): Promise<{ ok: true; key?: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/settings/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return res.ok ? { ok: true, key: json.key } : { ok: false, error: json.error ?? 'Lưu thất bại' };
  } catch {
    return { ok: false, error: 'Mất kết nối — thử lại.' };
  }
}

export function SiteEndpointsForm({
  initial,
  usage,
}: {
  initial: EndpointTable;
  usage: EndpointUsageRow[];
}) {
  const router = useRouter();
  /** Thông báo "đã lưu" theo form — giữ ở đây vì box tự dựng lại sau `router.refresh()`. */
  const [flash, setFlash] = useState<{ id: string; text: string } | null>(null);

  const forms: FormItem[] = usage
    .flatMap((u) => u.forms.map((f) => ({ ...f, key: u.key })))
    .sort((a, b) => placeOf(a).localeCompare(placeOf(b)) || a.label.localeCompare(b.label));
  const used = new Set(usage.map((u) => u.key));
  const orphans = Object.entries(initial)
    .filter(([key]) => !used.has(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const done = (id: string, text: string) => {
    setFlash({ id, text });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3" data-endpoints="">
      {forms.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {forms.map((f) => (
            <FormBox
              // Dựng lại khi dữ liệu server đổi (URL, khoá, tên) — state nhập liệu bắt đầu
              // từ giá trị mới thay vì giữ chữ cũ.
              key={`${idOf(f)}|${f.key}|${initial[f.key] ?? ''}|${f.label}`}
              form={f}
              url={initial[f.key] ?? ''}
              sharedWith={forms.filter((o) => o.key === f.key && idOf(o) !== idOf(f))}
              flash={flash?.id === idOf(f) ? flash.text : null}
              onDone={(text) => done(idOf(f), text)}
            />
          ))}
        </ul>
      ) : (
        <p className={cn(ui.inset, 'px-4 py-3 text-small text-shell-muted')}>
          Chưa có form nào trên site. Thêm một Form trong editor, rồi quay lại đây đặt URL nhận dữ liệu.
        </p>
      )}

      {orphans.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-shell-line pt-3" data-endpoint-orphans="">
          <p className={ui.label}>URL không form nào dùng</p>
          <ul className="flex flex-col gap-1">
            {orphans.map(([key, url]) => (
              <OrphanRow key={key} name={key} url={url} onDone={() => router.refresh()} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FormBox({
  form,
  url: savedUrl,
  sharedWith,
  flash,
  onDone,
}: {
  form: FormItem;
  url: string;
  sharedWith: FormItem[];
  flash: string | null;
  onDone: (text: string) => void;
}) {
  const [url, setUrl] = useState(savedUrl);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(form.label);
  const [busy, setBusy] = useState<null | 'url' | 'split' | 'name'>(null);
  const [error, setError] = useState<string | null>(null);

  const place = { place: form.where.kind, placeId: form.where.id, nodeId: form.nodeId };
  const dirty = url.trim() !== savedUrl;
  const off = !savedUrl;
  const http = Boolean(url.trim()) && insecureEndpoint(url.trim());
  const kind = form.composite === 'Form' ? 'Form' : 'Biểu đồ NAV';

  const run = async (what: 'url' | 'split' | 'name', body: Post, text: string) => {
    setBusy(what);
    setError(null);
    const result = await post(body);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(text);
  };

  const saveUrl = () => {
    if (!url.trim()) {
      setError('Nhập URL trước khi lưu.');
      return;
    }
    void run('url', { action: 'setUrl', key: form.key, url: url.trim() }, 'đã lưu URL');
  };
  const split = () => {
    const target = url.trim() || savedUrl;
    if (!target) {
      setError('Nhập URL cho form này trước, rồi tách.');
      return;
    }
    void run('split', { action: 'split', ...place, url: target }, 'đã tách URL riêng');
  };
  const rename = () => {
    if (name.trim() === form.label) {
      setRenaming(false);
      return;
    }
    void run('name', { action: 'rename', ...place, name }, 'đã đổi tên');
  };

  return (
    <li
      data-form-box={form.nodeId}
      className="flex flex-col gap-3 rounded-md border border-shell-line bg-shell-panel p-4"
    >
      {/* Đầu box: tên + nơi chứa, và hai nút của form. */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {renaming ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Tên form"
                value={name}
                autoFocus
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename();
                  if (e.key === 'Escape') {
                    setName(form.label);
                    setRenaming(false);
                  }
                }}
                className={cn(ui.fieldMd, 'min-w-0 flex-1 basis-40')}
              />
              <Button variant="primary" size="sm" loading={busy === 'name'} disabled={busy !== null} onClick={rename}>
                Lưu tên
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  setName(form.label);
                  setRenaming(false);
                }}
              >
                Huỷ
              </Button>
            </div>
          ) : (
            <h3 className="min-w-0 truncate text-ui font-semibold" title={form.label}>
              {form.label}
            </h3>
          )}
          <p className="min-w-0 truncate text-mini text-shell-muted">
            {kind} · {placeOf(form)}
          </p>
        </div>
        {!renaming && (
          <IconButton icon="edit" size="sm" label="Đổi tên form" onClick={() => setRenaming(true)} />
        )}
        <ButtonLink href={form.href} variant="secondary" size="sm" iconRight="arrow-right" title="Mở editor, chọn sẵn form này">
          Mở
        </ButtonLink>
      </div>

      {/* URL nhận dữ liệu. */}
      <div className="flex flex-col gap-1.5">
        <label className={ui.label} htmlFor={`url-${form.where.id}-${form.nodeId}`}>
          {form.composite === 'Form' ? 'URL nhận dữ liệu' : 'URL lấy số liệu'}
        </label>
        <input
          id={`url-${form.where.id}-${form.nodeId}`}
          value={url}
          title={url || undefined}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="https://api.example.com/subscribe"
          type="url"
          inputMode="url"
          spellCheck={false}
          className={cn(ui.fieldMd, 'font-shell-mono')}
        />
        {(off || http) && (
          <span className="flex flex-wrap gap-1">
            {off && (
              <Badge tone="warn" size="sm">
                {form.composite === 'Form' ? 'form đang tắt — chưa có URL' : 'chưa có nguồn số liệu'}
              </Badge>
            )}
            {http && (
              <Badge tone="warn" size="sm" title="Trang https gửi tới http:// bị trình duyệt chặn (mixed content)">
                http — trình duyệt sẽ chặn
              </Badge>
            )}
          </span>
        )}
      </div>

      {/* Dùng chung: nói ra hậu quả của việc sửa, và lối thoát. */}
      {sharedWith.length > 0 && (
        <div className="flex flex-col gap-2 rounded-sm bg-shell-raised px-3 py-2.5" data-form-shared="">
          <p className="text-mini leading-relaxed text-shell-muted">
            Dùng chung URL với{' '}
            <strong className="text-shell-ink">{sharedWith.map((o) => o.label).join(', ')}</strong>. Sửa URL ở
            đây là sửa cho cả {sharedWith.length + 1} form.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            loading={busy === 'split'}
            disabled={busy !== null}
            onClick={split}
            title="Cho form này một URL riêng; các form kia giữ URL hiện tại"
          >
            Tách URL riêng cho form này
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className={cn(ui.error, 'text-small leading-relaxed')}>
          {error}
        </p>
      )}

      {/* Chân box: khoá (chi tiết kỹ thuật), trạng thái, nút lưu. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-shell-mono min-w-0 flex-1 truncate text-micro text-shell-muted" title="Khoá endpoint form đang dùng — đặt trong Inspector, mục Gửi tới">
          khoá: {form.key}
        </span>
        {flash && !dirty && (
          <Badge tone="ok" size="sm" dot>
            {flash}
          </Badge>
        )}
        <Button variant="primary" size="sm" loading={busy === 'url'} disabled={!dirty || busy !== null} onClick={saveUrl}>
          Lưu URL
        </Button>
      </div>
    </li>
  );
}

function OrphanRow({ name, url, onDone }: { name: string; url: string; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    const result = await post({ action: 'removeKey', key: name });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
  };

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 text-mini" data-endpoint-orphan={name}>
      <code className="font-shell-mono shrink-0">{name}</code>
      <span className="min-w-0 flex-1 truncate text-shell-muted" title={url}>
        {url}
      </span>
      {confirm ? (
        <>
          <Button variant="danger" size="sm" loading={busy} onClick={() => void remove()}>
            Xoá thật
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(false)}>
            Huỷ
          </Button>
        </>
      ) : (
        <IconButton icon="trash" size="sm" variant="danger" label={`Xoá URL ${name}`} onClick={() => setConfirm(true)} />
      )}
      {error && <span className={ui.error}>{error}</span>}
    </li>
  );
}
