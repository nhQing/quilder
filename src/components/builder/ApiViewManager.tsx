'use client';

/**
 * Danh sách + form của View của API. Vỏ mỏng quanh `/api/collections/views`; mọi luật
 * (khoá, tham số lạ, query theo cấu trúc loại) nằm ở `api-view-store.ts` và báo lỗi về
 * đây bằng chữ.
 *
 * "Xem trước" gọi THẲNG endpoint công khai của loại với query đang gõ — tức đúng thứ
 * view sẽ trả khi client không gửi tham số nào — nên admin thấy payload thật trước khi
 * lưu, không phải một bản mô phỏng.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { VIEW_CLIENT_PARAMS } from '@/lib/collections/api-view';
import type { ApiViewRow } from '@/lib/collections/api-view-store';
import { ui } from '@/lib/builder/ui';

import { Badge } from './ui/Badge';
import { Button, buttonClass } from './ui/Button';
import { Checkbox, SelectField, TextArea, TextField } from './ui/Field';
import { Icon } from './ui/Icon';
import { ConfirmDialog, Dialog } from './ui/Overlay';
import { Note } from './ui/Note';
import { EmptyState } from './ui/Page';

export interface ViewTypeHint {
  key: string;
  name: string;
  fields: string[];
  relations: { key: string; target: string; fields: string[] }[];
}

/** Nhãn cho từng nhóm tham số client được gửi kèm. */
const PARAM_LABEL: Record<(typeof VIEW_CLIENT_PARAMS)[number], string> = {
  page: 'page — trang',
  pageSize: 'pageSize — số bài mỗi trang (trần 100)',
  locale: 'locale — ngôn ngữ',
  taxonomy: 'taxonomy — lọc theo danh mục',
  sort: 'sort — thứ tự (thay thứ tự đã lưu)',
  filter: 'filter[…] — lọc thêm (cộng vào lọc đã lưu, không thay)',
  format: 'format — json hoặc html',
};

interface Draft {
  id?: string;
  key: string;
  name: string;
  typeKey: string;
  query: string;
  allow: string[];
  note: string;
  /** Khoá lúc mở form — để cảnh báo khi đổi khoá của một view đang chạy. */
  savedKey?: string;
}

const blank = (typeKey: string): Draft => ({
  key: '', name: '', typeKey, query: '', allow: ['page', 'pageSize', 'locale'], note: '',
});

/** Query đã lưu ở dạng mã hoá URL; hiện cho người đọc ở dạng đã giải mã. */
const readable = (q: string) => {
  try {
    return decodeURIComponent(q.replace(/\+/g, ' '));
  } catch {
    return q;
  }
};

export function ApiViewManager(props: { views: ApiViewRow[]; types: ViewTypeHint[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ApiViewRow | null>(null);
  const [preview, setPreview] = useState<{ status: number; bytes: number; text: string } | null>(null);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // `window` chỉ có ở client; đọc trong effect để HTML của server và lượt hydrate khớp nhau.
  useEffect(() => setOrigin(window.location.origin), []);

  const typeName = (k: string) => props.types.find((t) => t.key === k)?.name ?? k;
  const hint = draft ? props.types.find((t) => t.key === draft.typeKey) : undefined;
  const urlOf = (key: string) => `${origin}/api/public/v1/views/${key}`;

  function open(v?: ApiViewRow) {
    setError(null);
    setPreview(null);
    setDraft(
      v
        ? { id: v.id, key: v.key, name: v.name, typeKey: v.typeKey, query: readable(v.query), allow: v.allow, note: v.note ?? '', savedKey: v.key }
        : blank(props.types[0]?.key ?? ''),
    );
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await fetch(draft.id ? `/api/collections/views/${draft.id}` : '/api/collections/views', {
      method: draft.id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: draft.key, name: draft.name, typeKey: draft.typeKey,
        query: draft.query, allow: draft.allow, note: draft.note,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? 'Không lưu được');
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function remove(v: ApiViewRow) {
    setBusy(true);
    const res = await fetch(`/api/collections/views/${v.id}`, { method: 'DELETE' });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    setConfirming(null);
    if (!res.ok || !json.ok) {
      setError(json.error ?? 'Không xoá được');
      return;
    }
    router.refresh();
  }

  async function runPreview() {
    if (!draft) return;
    setPreview(null);
    const q = draft.query.trim().replace(/^\?/, '');
    const res = await fetch(`/api/public/v1/${draft.typeKey}${q ? `?${q}` : ''}`);
    const text = await res.text();
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Không phải JSON (format=html vẫn là JSON; đây chỉ là lưới an toàn) — hiện thô.
    }
    setPreview({ status: res.status, bytes: new Blob([text]).size, text: pretty });
  }

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(urlOf(key));
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setError('Trình duyệt không cho chép — chọn đường dẫn và chép tay');
    }
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" icon="plus" onClick={() => open()} disabled={!props.types.length}>
          Thêm view
        </Button>
      </div>

      {error && !draft && <Note tone="danger" role="alert">{error}</Note>}

      {props.views.length === 0 ? (
        <EmptyState
          icon="link"
          title="Chưa có view nào"
          description="Tạo một view cho mỗi màn của app: chọn loại nội dung, dán bộ tham số đầy đủ, rồi đưa cho app đường dẫn ngắn."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {props.views.map((v) => (
            <div key={v.id} className={`${ui.card} flex flex-col gap-2.5 px-5 py-4`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-ui font-semibold">{v.name}</span>
                <Badge size="sm">{typeName(v.typeKey)}</Badge>
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="sm" icon="copy" onClick={() => void copy(v.key)}>
                    {copied === v.key ? 'Đã chép' : 'Chép đường dẫn'}
                  </Button>
                  {/* Thẻ `a` thật chứ không `ButtonLink`: đích là JSON, mở tab mới, không đi
                      qua router của Next. */}
                  <a
                    href={`/api/public/v1/views/${v.key}`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass('ghost', 'sm')}
                  >
                    <Icon name="external" size={15} />
                    Thử
                  </a>
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => open(v)}>
                    Sửa
                  </Button>
                  <Button variant="ghost" size="sm" icon="trash" onClick={() => setConfirming(v)}>
                    Xoá
                  </Button>
                </div>
              </div>
              <code className="font-shell-mono text-small break-all">/api/public/v1/views/{v.key}</code>
              <code className="font-shell-mono text-mini break-all text-shell-muted">
                = /api/public/v1/{v.typeKey}{v.query ? `?${readable(v.query)}` : ''}
              </code>
              <div className="flex flex-wrap items-center gap-1.5 text-small text-shell-muted">
                <span>App được gửi thêm:</span>
                {v.allow.length ? v.allow.map((a) => <Badge key={a} size="sm">{a}</Badge>) : <span>không tham số nào</span>}
              </div>
              {v.note && <p className="text-small text-shell-muted">{v.note}</p>}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Sửa view' : 'Thêm view'}
        size="lg"
        dismissable={!busy}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)} disabled={busy}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={busy}>
              Lưu
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Tên"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Tin tức cho app — màn danh sách"
              />
              <TextField
                label="Khoá (đoạn cuối của đường dẫn)"
                mono
                value={draft.key}
                onChange={(e) => set({ key: e.target.value.toLowerCase() })}
                placeholder="mobile-news"
                hint={origin && draft.key ? urlOf(draft.key) : 'Chữ thường, số, gạch ngang.'}
              />
            </div>
            {draft.savedKey && draft.key !== draft.savedKey && (
              <Note tone="warn">
                Đổi khoá thì app đang gọi <code className="font-shell-mono">{draft.savedKey}</code> sẽ nhận 404 ngay khi lưu.
              </Note>
            )}

            <SelectField
              label="Loại nội dung"
              value={draft.typeKey}
              onChange={(e) => set({ typeKey: e.target.value })}
              options={props.types.map((t) => ({ value: t.key, label: `${t.name} (${t.key})` }))}
            />

            <TextArea
              label="Bộ tham số đầy đủ"
              mono
              rows={3}
              value={draft.query}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="fields=title,cover,faq&populate[faq]=question,answer&pageSize=20"
              hint="Cùng cú pháp với /api/public/v1/<loại>. Tham số sai tên hoặc field không có sẽ bị báo khi lưu."
            />

            {hint && (
              <div className="flex flex-col gap-1 text-small text-shell-muted">
                <span>
                  Field của {hint.name}: <code className="font-shell-mono">{hint.fields.join(', ') || '—'}</code>
                </span>
                {hint.relations.map((r) => (
                  <span key={r.key}>
                    <code className="font-shell-mono">populate[{r.key}]=</code> nhận field của {r.target}:{' '}
                    <code className="font-shell-mono">{r.fields.join(', ') || '—'}</code>
                  </span>
                ))}
              </div>
            )}

            <fieldset className="flex flex-col gap-1">
              <legend className={ui.label}>App được gửi thêm</legend>
              {VIEW_CLIENT_PARAMS.map((p) => (
                <Checkbox
                  key={p}
                  label={PARAM_LABEL[p]}
                  checked={draft.allow.includes(p)}
                  onChange={(e) =>
                    set({ allow: e.target.checked ? [...draft.allow, p] : draft.allow.filter((a) => a !== p) })
                  }
                />
              ))}
              <p className={ui.hint}>
                fields và populate luôn cố định theo view. Tham số khác app gửi lên sẽ bị trả lỗi 400.
              </p>
            </fieldset>

            <TextField
              label="Ghi chú (không ra API)"
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="App iOS/Android — màn Tin tức"
            />

            <div className="flex flex-col gap-2">
              <div>
                <Button variant="secondary" size="sm" icon="eye" onClick={() => void runPreview()} disabled={!draft.typeKey}>
                  Xem trước kết quả
                </Button>
              </div>
              {preview && (
                <>
                  <span className="text-small text-shell-muted">
                    HTTP {preview.status} · {(preview.bytes / 1024).toFixed(1)} KB
                  </span>
                  <pre className="max-h-72 overflow-auto rounded-md bg-shell-raised p-3 font-shell-mono text-mini">
                    {preview.text.length > 8000 ? `${preview.text.slice(0, 8000)}\n…` : preview.text}
                  </pre>
                </>
              )}
            </div>

            {error && <Note tone="danger" role="alert">{error}</Note>}
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && void remove(confirming)}
        title={`Xoá view "${confirming?.name ?? ''}"?`}
        consequence={confirming ? `App đang gọi /api/public/v1/views/${confirming.key} sẽ nhận 404 ngay.` : undefined}
        confirmLabel="Xoá view"
        typeToConfirm={confirming?.key}
        busy={busy}
      />
    </div>
  );
}
