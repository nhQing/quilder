'use client';

/**
 * Mục "Nơi nhận dữ liệu" ở màn Cài đặt: bảng CHỈ XEM — mỗi nơi nhận một dòng, kèm các form /
 * biểu đồ đang dùng nó.
 *
 * ## Vì sao chỉ xem
 *
 * Bản trước bày một box cho từng form, với ô URL, "Tách URL riêng" và "Đổi tên". Ba việc đó
 * giờ làm ngay ở Inspector (`EndpointPicker`), nơi người dùng đang đứng cạnh form — Cài đặt
 * không cần là chỗ thứ hai để sửa. Còn lại đúng hai thứ Inspector không cho:
 *  - nhìn TOÀN SITE: URL nào đang nhận dữ liệu của form nào, có bị chặn (http) không;
 *  - dọn nơi nhận không ai dùng (`removeKey`, admin).
 *
 * Nơi nhận có form dùng thì KHÔNG có nút Xoá: xoá nó là tắt form. Muốn đổi, mở form ("Mở")
 * rồi chọn nơi khác ở Inspector.
 *
 * Form dùng một khoá chưa có trong bảng vẫn hiện (nhãn "chưa có URL") — đó là form đang tắt
 * trên site, và đây là chỗ duy nhất gom chúng lại.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { insecureEndpoint, type EndpointTable } from '@/lib/doc/endpoint-table';
import type { EndpointFormRow, EndpointUsageRow } from '@/lib/doc/endpoint-usage';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { Badge } from './ui/Badge';
import { Button, ButtonLink } from './ui/Button';

// Kiểu dùng chung với khối "Gửi tới" của Inspector — định nghĩa ở `endpoint-usage.ts`.
export type { EndpointFormRow, EndpointUsageRow };

const placeOf = (f: EndpointFormRow) =>
  f.where.kind === 'page' ? `trang /${f.where.slug}` : `component ${f.where.name}`;

const kindOf = (f: EndpointFormRow) => (f.composite === 'Form' ? 'Form' : 'Biểu đồ NAV');

async function removeKey(key: string): Promise<string | null> {
  try {
    const res = await fetch('/api/settings/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'removeKey', key }),
    });
    if (res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json.error ?? 'Xoá thất bại';
  } catch {
    return 'Mất kết nối — thử lại.';
  }
}

export function SiteEndpointsForm({
  initial,
  usage,
  canDelete,
}: {
  initial: EndpointTable;
  usage: EndpointUsageRow[];
  /** Chỉ admin xoá được (API cũng chặn) — người khác không thấy nút. */
  canDelete: boolean;
}) {
  const router = useRouter();

  const formsOf = new Map(usage.map((u) => [u.key, u.forms]));
  // Khoá có trong bảng HOẶC có form dùng: khoá mồ côi vẫn liệt kê (để xoá), khoá thiếu URL
  // vẫn liệt kê (form đang tắt).
  const keys = [...new Set([...Object.keys(initial), ...formsOf.keys()])].sort((a, b) => a.localeCompare(b));

  if (keys.length === 0) {
    return (
      <p className={cn(ui.inset, 'px-4 py-3 text-small text-shell-muted')} data-endpoints="">
        Chưa có nơi nhận nào. Thêm một Form trong editor, rồi đặt nơi nhận ở mục “Gửi tới” của Inspector.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3" data-endpoints="">
      {keys.map((key) => (
        <EndpointRow
          key={key}
          name={key}
          url={initial[key] ?? ''}
          forms={formsOf.get(key) ?? []}
          canDelete={canDelete}
          onDone={() => router.refresh()}
        />
      ))}
    </ul>
  );
}

function EndpointRow({
  name,
  url,
  forms,
  canDelete,
  onDone,
}: {
  name: string;
  url: string;
  forms: EndpointFormRow[];
  canDelete: boolean;
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const off = !url;
  const http = !off && insecureEndpoint(url);
  const sorted = [...forms].sort((a, b) => placeOf(a).localeCompare(placeOf(b)) || a.label.localeCompare(b.label));

  const remove = async () => {
    setBusy(true);
    const err = await removeKey(name);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onDone();
  };

  return (
    <li
      data-endpoint-row={name}
      className="flex flex-col gap-2 rounded-md border border-shell-line bg-shell-panel p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-shell-mono text-ui font-semibold">{name}</code>
        {off && (
          <Badge tone="warn" size="sm">
            chưa có URL
          </Badge>
        )}
        {http && (
          <Badge tone="warn" size="sm" title="Trang https gửi tới http:// bị trình duyệt chặn (mixed content)">
            http — trình duyệt sẽ chặn
          </Badge>
        )}
        <span className="flex-1" />
        {canDelete && forms.length === 0 && !off &&
          (confirm ? (
            <>
              <Button variant="danger" size="sm" loading={busy} onClick={() => void remove()}>
                Xoá thật
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(false)}>
                Huỷ
              </Button>
            </>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirm(true)} aria-label={`Xoá nơi nhận ${name}`}>
              Xoá
            </Button>
          ))}
      </div>

      {!off && (
        <p className="font-shell-mono min-w-0 truncate text-small text-shell-muted" title={url} data-endpoint-url="">
          {url}
        </p>
      )}

      {sorted.length > 0 ? (
        <ul className="flex flex-col gap-1" data-endpoint-forms="">
          {sorted.map((f) => (
            <li key={`${f.where.kind}:${f.where.id}:${f.nodeId}`} className="flex min-w-0 items-center gap-2 text-small">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{f.label}</span>
                <span className="text-shell-muted">
                  {' '}
                  · {kindOf(f)} · {placeOf(f)}
                </span>
              </span>
              <ButtonLink
                href={f.href}
                variant="secondary"
                size="sm"
                iconRight="arrow-right"
                title="Mở editor, chọn sẵn node này"
              >
                Mở
              </ButtonLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-mini text-shell-muted">Không form hay biểu đồ nào dùng nơi nhận này.</p>
      )}

      {error && (
        <p role="alert" className={cn(ui.error, 'text-small leading-relaxed')}>
          {error}
        </p>
      )}
    </li>
  );
}
