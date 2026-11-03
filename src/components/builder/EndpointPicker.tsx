'use client';

/**
 * Khối "Gửi tới" (Form) / "Nguồn số liệu" (NavChart) trong Inspector.
 *
 * ## Vì sao có nó
 *
 * Form gửi tới URL tra theo KHOÁ (`params.endpointKey`) trong bảng `Site.globals.endpoint`
 * — xem `formParams.endpointKey` trong registry cho lý do không để URL trong params. Bảng
 * từng chỉ sửa được ở màn Cài đặt, và không có chỗ nào trong editor chọn được KHOÁ của một
 * form: form nào cũng dùng `newsletter` mặc định, đổi nó chỉ làm được qua AI/MCP.
 *
 * ## Một khối làm trọn việc "form này gửi tới đâu"
 *
 *  - Ô chọn một nơi nhận ĐÃ CÓ trong bảng (kèm host để phân biệt staging với production).
 *    Chọn từ danh sách, không gõ khoá tự do: một khoá gõ sai chính tả là một form im lặng
 *    tắt trên site. Ai có quyền sửa trang đều chọn được — mọi URL trong bảng do admin đặt,
 *    nên chuyển giữa chúng không đưa dữ liệu khách tới chỗ admin chưa duyệt.
 *  - URL THẬT của nơi nhận đang chọn. ADMIN sửa tại chỗ (đổi cho mọi form cùng khoá —
 *    khối nói rõ "Dùng chung với N form: …"); người khác chỉ đọc.
 *  - ADMIN: "Dùng URL riêng" (tách form này khỏi khoá dùng chung) và "Nơi nhận mới" (đặt
 *    tên + URL; khoá suy từ tên). Đặt URL mới là gửi dữ liệu khách tới một chỗ mới, nên
 *    API (`/api/settings/endpoints`) cũng chỉ nhận admin — ẩn nút ở đây chỉ để giao diện
 *    nói đúng, không phải cổng.
 *
 * ## Ghi
 *
 *  - Đổi khoá: `setProps` qua `dispatch` của editor, như mọi ô khác của Inspector — undo,
 *    lịch sử và validator (`composite_params`) đi theo. `setProps` THAY cả `params`, nên
 *    phải trải params thô cũ ra — xem `withEndpointKey`.
 *  - Đổi URL / tạo khoá: `POST /api/settings/endpoints` (`setUrl`), rồi `router.refresh()`
 *    để bảng mới vào ô chọn và vào canvas (bản nháp đọc bảng LIVE qua `draftSiteGlobals`).
 *    Site thật đổi khi Publish — khối nói điều đó cạnh nút Lưu.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Role } from '@/lib/auth/session';
import { cn } from '@/lib/builder/cn';
import {
  endpointOptions,
  placeLabel,
  readEndpointKey,
  sharedWith,
  withEndpointKey,
} from '@/lib/builder/endpoint-options';
import { selectStyleLocked, useEditor } from '@/lib/builder/store';
import { focusRing, ui } from '@/lib/builder/ui';
import { insecureEndpoint, suggestEndpointKey, type EndpointTable } from '@/lib/doc/endpoint-table';
import type { EndpointUsageRow } from '@/lib/doc/endpoint-usage';
import type { Node } from '@/lib/doc/types';
import { Button } from './ui/Button';
import { SelectField, TextField } from './ui/Field';
import { Icon } from './ui/Icon';

/**
 * Nhãn và lời giải thích theo composite. Composite không có ở đây thì không có khối —
 * cùng tập với `ENDPOINT_COMPOSITES` của `site-bindings.ts`.
 */
const COPY = {
  Form: {
    label: 'Gửi tới',
    url: 'URL nhận dữ liệu',
    off: 'form đang tắt (hiện vô hiệu kèm lý do)',
    none: 'Chưa chọn nơi nhận',
  },
  NavChart: {
    label: 'Nguồn số liệu',
    url: 'URL lấy số liệu',
    off: 'biểu đồ hiện "chưa có nguồn số liệu"',
    none: 'Chưa chọn nguồn',
  },
} as const;

/** Lời nhắc "vẫn chạy, nhưng có thứ bạn nên biết" — cùng khuôn `WARN_NOTE` của Inspector. */
const WARN = 'bg-shell-warn-soft text-shell-warn rounded-sm px-2.5 py-1.5 text-mini leading-snug';
const INFO = 'bg-shell-raised text-shell-muted rounded-sm px-2.5 py-1.5 text-mini leading-snug';

const SETTINGS_HREF = '/builder/settings#settings-endpoints';

const HTTP_WARN = 'http — trang https gửi tới http:// bị trình duyệt chặn (mixed content).';

type Post = { action: 'setUrl'; key: string; url: string } | { action: 'removeKey'; key: string };

/** Một lần gọi `/api/settings/endpoints` (admin). Lỗi trả thành chữ để hiện cạnh ô. */
async function post(body: Post): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/settings/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true } : { ok: false, error: json.error ?? 'Lưu thất bại' };
  } catch {
    return { ok: false, error: 'Mất kết nối — thử lại.' };
  }
}

export function EndpointPicker({
  node,
  endpoints,
  usage,
  role,
}: {
  node: Extract<Node, { type: 'Composite' }>;
  endpoints: EndpointTable;
  /** Form nào dùng khoá nào trên cả site, cấp từ server lúc tải trang. */
  usage: EndpointUsageRow[];
  role: Role;
}) {
  const router = useRouter();
  const dispatch = useEditor((s) => s.dispatch);
  const target = useEditor((s) => s.target);
  // Khoá cả khi đang sửa bản dịch, dù khối đã ẩn ở chế độ đó: nguồn dữ liệu dùng chung
  // mọi ngôn ngữ, và selector này là MỘT chỗ quyết định điều đó cho cả Inspector.
  const locked = useEditor(selectStyleLocked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const copy = node.composite === 'Form' ? COPY.Form : node.composite === 'NavChart' ? COPY.NavChart : null;
  const state = readEndpointKey(node.composite, node.params);
  if (!copy || !state) return null;

  const isAdmin = role === 'admin';
  const current = state.key;
  const hasUrl = Object.hasOwn(endpoints, current);
  const savedUrl = hasUrl ? endpoints[current]! : '';
  const options = endpointOptions(endpoints, current);
  const unusable = current !== '' && (options.find((o) => o.key === current)?.missing ?? true);
  const empty = Object.keys(endpoints).length === 0;
  const self = target ? { kind: target.kind, id: target.id, nodeId: node.id } : null;
  const sharing = self ? sharedWith(usage, current, self) : [];
  const inComponent = target?.kind === 'component';
  const taken = new Set([...Object.keys(endpoints), ...usage.map((u) => u.key), current]);
  const ownName = node.name?.trim() || (node.composite === 'Form' ? 'Form' : 'Biểu đồ NAV');

  const assignKey = (key: string) =>
    dispatch(
      [{ op: 'setProps', nodeId: node.id, props: { params: withEndpointKey(node.params, key) } }],
      { label: `đổi endpoint: ${key}` },
    );

  const pick = (key: string) => {
    if (key === current) return;
    setError(null);
    void assignKey(key);
  };

  /**
   * Khoá MỚI mang URL `url`, rồi gán cho form này. Bảng TRƯỚC, form SAU — cùng thứ tự với
   * `split` ở server: giữa hai bước form vẫn trỏ khoá cũ còn nguyên URL. Gán qua `dispatch`
   * của editor (không qua `split` ở server) để store không lệch bản nháp và Hoàn tác dùng được.
   * Gán hỏng thì bỏ khoá vừa tạo, khỏi để một URL mồ côi trong bảng.
   */
  const createKey = async (name: string, url: string): Promise<boolean> => {
    const key = suggestEndpointKey(name, taken);
    setBusy(true);
    setError(null);
    const made = await post({ action: 'setUrl', key, url: url.trim() });
    if (!made.ok) {
      setBusy(false);
      setError(made.error);
      return false;
    }
    const assigned = await assignKey(key);
    if (!assigned) {
      await post({ action: 'removeKey', key });
      setBusy(false);
      setError('Không gán được nơi nhận cho form này — thử lại.');
      return false;
    }
    setBusy(false);
    router.refresh();
    return true;
  };

  const saveUrl = async (url: string) => {
    setBusy(true);
    setError(null);
    const result = await post({ action: 'setUrl', key: current, url: url.trim() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <section data-endpoint-picker="" className="flex flex-col gap-1.5 px-3.5">
      {/*
        Bảng rỗng thì KHÔNG bày ô chọn: một ô chỉ có đúng một lựa chọn "chưa có URL" là
        một ô không chọn được gì, và nó trông y như một ô hỏng. Nói thẳng việc cần làm.
      */}
      {empty ? (
        <>
          <span className={ui.label}>{copy.label}</span>
          <p className={WARN} data-endpoint-missing="">
            Site chưa có nơi nhận nào — {copy.off} cho tới khi có một nơi nhận.{' '}
            {isAdmin ? 'Bấm "Nơi nhận mới" bên dưới.' : 'Nhờ admin tạo nơi nhận.'}
          </p>
        </>
      ) : (
        <SelectField
          size="sm"
          label={copy.label}
          value={current}
          disabled={locked || busy}
          onChange={(e) => pick(e.target.value)}
        >
          {current === '' && <option value="">{copy.none}</option>}
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </SelectField>
      )}

      {current === '' && !empty && (
        <p className={WARN} data-endpoint-missing="">
          Chọn một nơi nhận — {copy.off} cho tới lúc đó.
        </p>
      )}

      {/* URL thật của nơi nhận đang chọn: admin sửa tại chỗ, người khác chỉ đọc. */}
      {current !== '' &&
        (isAdmin ? (
          <UrlEditor
            // Dựng lại khi khoá hoặc URL đã lưu đổi: ô nhập bắt đầu từ giá trị mới.
            key={`${current}|${savedUrl}`}
            label={copy.url}
            keyName={current}
            saved={savedUrl}
            sharedCount={sharing.length}
            busy={busy || locked}
            onSave={saveUrl}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <span className={ui.label}>{copy.url}</span>
            {hasUrl ? (
              <code className="font-shell-mono text-mini break-all text-shell-ink" data-endpoint-url="">
                {savedUrl}
              </code>
            ) : (
              <p className={WARN} data-endpoint-missing="">
                Khoá <code className="font-shell-mono">{current}</code> chưa có URL — {copy.off} cho tới
                khi admin đặt URL.
              </p>
            )}
            {hasUrl && unusable && (
              <p className={WARN} data-endpoint-missing="">
                URL này không dùng được — {copy.off}.
              </p>
            )}
            <p className={INFO} data-endpoint-readonly="">
              Chỉ admin đổi được URL nhận.
            </p>
          </div>
        ))}

      {sharing.length > 0 && (
        <div className={cn(INFO, 'flex flex-col gap-1.5')} data-endpoint-shared="">
          <p>
            Dùng chung với {sharing.length} form: {sharing.map(placeLabel).join(', ')}.
          </p>
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={locked || busy || !savedUrl}
              onClick={() => void createKey(ownName, savedUrl)}
              title="Cho form này một nơi nhận riêng (cùng URL hiện tại); các form kia giữ nguyên"
              data-endpoint-split=""
            >
              Dùng URL riêng
            </Button>
          )}
        </div>
      )}

      {inComponent && (
        <p className={INFO} data-endpoint-in-component="">
          Form thuộc component: đổi nơi nhận ở đây là đổi cho mọi trang dùng component này.
        </p>
      )}

      {isAdmin &&
        (creating ? (
          <NewEndpoint
            urlLabel={copy.url}
            defaultName={ownName}
            taken={taken}
            busy={busy || locked}
            onCancel={() => setCreating(false)}
            onCreate={async (name, url) => {
              if (await createKey(name, url)) setCreating(false);
            }}
          />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={locked || busy}
            onClick={() => setCreating(true)}
            data-endpoint-new=""
          >
            Nơi nhận mới
          </Button>
        ))}

      {error && (
        <p role="alert" className={cn(ui.error, 'text-mini leading-snug')} data-endpoint-error="">
          {error}
        </p>
      )}

      {state.ignored && (
        // Khoá đã ghi nhưng `.catch()` của registry đưa cả params về mặc định — xem
        // `readEndpointKey`. Không nói ra thì ô chọn bật về khoá cũ mà không lý do.
        <p className={WARN}>
          Một tham số khác của {node.composite} đang sai, nên cả bộ tham số chạy theo mặc
          định và khoá vừa chọn chưa có tác dụng. Sửa tham số đó qua AI/MCP.
        </p>
      )}

      <Link
        href={SETTINGS_HREF}
        className={cn(
          'text-shell-accent inline-flex items-center gap-1 self-start rounded-xs text-mini font-medium underline-offset-2 hover:underline',
          focusRing,
        )}
        title="Mở màn Cài đặt — xem mọi nơi nhận của site và form nào đang dùng"
      >
        Xem mọi nơi nhận ở Cài đặt
        <Icon name="arrow-right" size={12} />
      </Link>
    </section>
  );
}

/**
 * Ô sửa URL của khoá đang chọn (admin). Sửa là sửa cho MỌI form dùng khoá — nói ra ngay
 * dưới ô khi có form khác dùng chung. Bản nháp dùng URL mới ngay; site thật đổi khi Publish.
 */
function UrlEditor({
  label,
  keyName,
  saved,
  sharedCount,
  busy,
  onSave,
}: {
  label: string;
  keyName: string;
  saved: string;
  sharedCount: number;
  busy: boolean;
  onSave: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(saved);
  const dirty = url.trim() !== saved;
  const http = url.trim() !== '' && insecureEndpoint(url.trim());
  const canSave = dirty && url.trim() !== '' && !busy;

  return (
    <div className="flex flex-col gap-1.5" data-endpoint-editor="">
      <TextField
        size="sm"
        mono
        label={label}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://api.example.com/subscribe"
        type="url"
        inputMode="url"
        spellCheck={false}
        disabled={busy}
        hint={
          sharedCount > 0
            ? `Khoá ${keyName} — sửa ở đây là sửa cho cả ${sharedCount + 1} form.`
            : `Khoá ${keyName}`
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSave) void onSave(url);
        }}
      />
      {http && (
        <p className={WARN} data-endpoint-http="">
          {HTTP_WARN}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={!canSave} loading={busy && dirty} onClick={() => void onSave(url)}>
          Lưu URL
        </Button>
        <span className="text-micro text-shell-muted">Site thật đổi khi Publish.</span>
      </div>
    </div>
  );
}

/** "Nơi nhận mới": tên (khoá suy từ tên) + URL, rồi gán cho form đang chọn. */
function NewEndpoint({
  urlLabel,
  defaultName,
  taken,
  busy,
  onCancel,
  onCreate,
}: {
  urlLabel: string;
  defaultName: string;
  taken: ReadonlySet<string>;
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string, url: string) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [url, setUrl] = useState('');
  const http = url.trim() !== '' && insecureEndpoint(url.trim());
  const ready = name.trim() !== '' && url.trim() !== '';

  return (
    <div className={cn(INFO, 'flex flex-col gap-1.5')} data-endpoint-create="">
      <TextField
        size="sm"
        label="Tên nơi nhận"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
        hint={`Khoá: ${suggestEndpointKey(name, taken)}`}
      />
      <TextField
        size="sm"
        mono
        label={`${urlLabel} (nơi nhận mới)`}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://api.example.com/subscribe"
        type="url"
        inputMode="url"
        spellCheck={false}
        disabled={busy}
      />
      {http && (
        <p className={WARN} data-endpoint-http="">
          {HTTP_WARN}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={!ready || busy} loading={busy} onClick={() => void onCreate(name, url)}>
          Tạo nơi nhận
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Huỷ
        </Button>
        <span className="text-micro text-shell-muted">Site thật đổi khi Publish.</span>
      </div>
    </div>
  );
}
