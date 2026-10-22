'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { copyText } from '@/lib/builder/clipboard';
import { cn } from '@/lib/builder/cn';
import { mcpServerName, sanitizeMcpName } from '@/lib/builder/mcp-name';
import { ui } from '@/lib/builder/ui';
import { when as formatWhen } from '@/lib/when';
import { Badge } from './ui/Badge';
import { Button, buttonClass } from './ui/Button';
import { Checkbox, SelectField, TextField } from './ui/Field';
import { Icon } from './ui/Icon';
import { ConfirmDialog, Consequence } from './ui/Overlay';
import { EmptyState, Section } from './ui/Page';
import { Tabs } from './ui/Tabs';

export interface TokenRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  /** Token được ĐĂNG bản dịch. Xem `ServiceToken.canPublishLocale`. */
  canPublishLocale: boolean;
}

interface Minted {
  token: string;
  name: string;
  email: string;
  expiresAt: string;
}

export type Platform = 'windows' | 'mac';

/**
 * Bộ lọc danh sách token.
 *
 * Bốn mục chứ không phải hai: `expired` là một trạng thái THẬT trong dữ liệu (token còn
 * nguyên nhưng đã quá hạn), và gộp nó vào "đã cấp" sẽ nói rằng một token vô hiệu vẫn
 * đang có hiệu lực — đúng loại nhầm lẫn khiến người ta tưởng mình còn quyền truy cập.
 */
const FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'active', label: 'Đang dùng' },
  { id: 'expired', label: 'Hết hạn' },
  { id: 'revoked', label: 'Đã thu hồi' },
] as const;

type Filter = (typeof FILTERS)[number]['id'];

const LIFETIMES = [
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: 90, label: '90 ngày' },
];

const when = (iso: string | null) => (iso ? formatWhen(iso) : '—');

/** Việc phá huỷ đang chờ xác nhận. Một lúc chỉ một. */
type Ask = { kind: 'revoke'; row: TokenRow } | { kind: 'purge'; row: TokenRow } | { kind: 'revokeAll' };

/**
 * Nhãn của một nút lọc, mang `data-*` mà e2e dùng để bấm và đọc số đếm.
 *
 * `Tabs` chưa nhận thuộc tính riêng cho từng nút, nên thuộc tính nằm trên nhãn: bấm vào
 * nhãn là bấm vào nút chứa nó, và `textContent` của nhãn chứa cả số đếm. Số đếm vì thế
 * vẽ ở đây thay cho `count` của `Tabs`, cùng hình.
 */
function TabLabel({ data, label, count, on }: { data: Record<string, string>; label: string; count?: number; on: boolean }) {
  return (
    <span {...data} className="inline-flex items-center gap-2">
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'min-w-5.5 rounded-full px-1.5 text-center text-micro font-semibold tabular-nums',
            on ? 'bg-shell-accent text-shell-on-accent' : 'bg-shell-line text-shell-muted',
          )}
        >
          {count}
        </span>
      )}
    </span>
  );
}

/**
 * `mine` — màn cá nhân `/builder/claude`: cấp token cho máy mình, danh sách chỉ token của
 *          mình, "Thu hồi tất cả" chỉ cắt máy của mình.
 * `all`  — Tài khoản › Kết nối Claude (admin): token của MỌI người, có email người đứng
 *          tên, KHÔNG có ô cấp — admin cũng tự cấp cho máy mình ở màn cá nhân như mọi người.
 */
export function TokenAdmin({
  scope,
  tokens,
  origin,
  platform,
}: {
  scope: 'mine' | 'all';
  tokens: TokenRow[];
  origin: string;
  platform: Platform;
}) {
  const mine = scope === 'mine';
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  const [name, setName] = useState('');
  const [days, setDays] = useState(30);
  /*
   * Mặc định TẮT, và nó phải nằm ở đây chứ không ở server.
   *
   * Route cũng mặc định tắt (`body.canPublishLocale === true`), nhưng ô này là chỗ
   * người dùng NHÌN THẤY quyết định. Một ô tích sẵn thì họ cấp quyền mà không đọc.
   */
  const [canPublishLocale, setCanPublishLocale] = useState(false);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, days, canPublishLocale }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Không cấp được token');
      setMinted(json);
      setName('');
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const [filter, setFilter] = useState<Filter>('all');

  /** Chạy một lệnh xoá/thu hồi đã được xác nhận trong `ConfirmDialog`. */
  const run = async (path: string, failed: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? failed);
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  /** Token còn hiệu lực — thứ mà "thu hồi tất cả" thật sự chạm tới. */
  const liveCount = tokens.filter((t) => t.status === 'active').length;

  const confirmAsk = () => {
    if (!ask) return;
    if (ask.kind === 'revoke') void run(`/api/tokens/${ask.row.id}`, 'Thu hồi thất bại');
    if (ask.kind === 'purge') void run(`/api/tokens/${ask.row.id}?purge=1`, 'Xoá thất bại');
    if (ask.kind === 'revokeAll') void run(mine ? '/api/tokens?scope=mine' : '/api/tokens', 'Thu hồi thất bại');
  };

  const shown = filter === 'all' ? tokens : tokens.filter((t) => t.status === filter);
  const countOf = (id: Filter) =>
    id === 'all' ? tokens.length : tokens.filter((t) => t.status === id).length;

  return (
    <>
      {error && (
        <div role="alert">
          <Consequence>{error}</Consequence>
        </div>
      )}

      {!mine ? (
        <p className={cn(ui.inset, 'flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-small text-shell-muted')}>
          <Icon name="sparkle" size={16} className="text-shell-accent" />
          Mỗi người tự cấp token cho máy của mình ở
          <Link href="/builder/claude" className="font-semibold text-shell-accent underline-offset-2 hover:underline">
            Kết nối Claude
          </Link>
          (cuối thanh menu). Ở đây là token của mọi người — để soát và thu hồi.
        </p>
      ) : minted ? (
        <MintedPanel
          minted={minted}
          origin={origin}
          platform={platform}
          onDone={() => setMinted(null)}
        />
      ) : (
        <form onSubmit={create} className={cn(ui.card, 'flex flex-col gap-5 p-6')}>
          <div className="flex flex-col gap-1">
            <h2 className="text-section font-semibold">Cấp token mới</h2>
            <p className="text-small text-shell-muted">
              Mỗi token cho một máy chạy Claude Desktop. Đặt tên theo máy để sau này biết thu hồi
              cái nào.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
            <TextField
              id="tk-name"
              label="Tên thiết bị"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Máy ở nhà"
            />
            <SelectField
              id="tk-days"
              label="Hạn"
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value))}
              options={LIFETIMES.map((l) => ({ value: String(l.days), label: l.label }))}
            />
            <Button type="submit" variant="primary" icon="key" loading={busy} disabled={!name.trim()}>
              {busy ? 'Đang cấp…' : 'Cấp token'}
            </Button>
          </div>

          {/*
            Ô tích CHIẾM CẢ DÒNG, dưới hàng ô kia, trong một ô nền riêng.

            Nó không phải một tuỳ chọn ngang hàng với "Hạn": nó cấp cho một máy
            quyền GHI LÊN SITE THẬT. Xếp nó cạnh ô chọn hạn là làm nó trông như
            một lựa chọn cấu hình, và người ta sẽ tích nó cho tiện.

            Chữ dưới ô nói ra HẬU QUẢ, không nói lại tên cờ: người đọc cần biết
            token này làm được gì và KHÔNG làm được gì, không cần biết cột nào
            trong database.
          */}
          <div className={cn(ui.inset, 'flex flex-col gap-1 px-4 py-3.5')}>
            <Checkbox
              label={<span className="font-semibold">Cho phép đăng bản dịch</span>}
              checked={canPublishLocale}
              onChange={(e) => setCanPublishLocale(e.target.checked)}
              aria-describedby="tk-locale-hint"
            />
            <p id="tk-locale-hint" className="pl-7 text-small leading-relaxed text-shell-muted">
              Token này sẽ tự đưa bản dịch của một bài lên site, không cần ai bấm Đăng. Bản GỐC thì
              vẫn không — đăng bản gốc luôn là thao tác của con người. Tắt được bất cứ lúc nào bằng
              cách thu hồi token.
            </p>
          </div>
        </form>
      )}

      <Section
        title={mine ? 'Token của bạn' : 'Token đã cấp'}
        count={tokens.length}
        actions={
          /*
            Nút thu hồi tất cả chỉ hiện khi CÓ token còn hiệu lực.

            Một nút không làm gì vẫn chiếm chỗ và vẫn phải đọc — và với một nút phá huỷ
            thì nó còn tệ hơn: bấm vào không thấy gì xảy ra thì lần sau người ta bấm mạnh
            tay hơn ở chỗ khác. Cùng nguyên tắc với "Gỡ tất cả" ở `InstancePanel`.
          */
          liveCount > 0 && (
            <Button
              variant="danger"
              size="md"
              disabled={busy}
              onClick={() => setAsk({ kind: 'revokeAll' })}
              data-revoke-all=""
              title={`Thu hồi ${liveCount} token còn hiệu lực. Có hiệu lực ngay, không hoàn lại được.`}
            >
              Thu hồi tất cả ({liveCount})
            </Button>
          )
        }
      >
        {/* Lọc theo trạng thái. Số đếm nằm ngay trên nút để không phải bấm mới biết
            có gì bên trong — một bộ lọc dẫn tới danh sách rỗng là một cú bấm bỏ đi. */}
        <Tabs
          label="Lọc theo trạng thái"
          value={filter}
          onChange={setFilter}
          className="self-start"
          items={FILTERS.map((f) => ({
            id: f.id,
            label: (
              <TabLabel
                data={{ 'data-token-filter': f.id }}
                label={f.label}
                count={countOf(f.id)}
                on={filter === f.id}
              />
            ),
          }))}
        />

        {tokens.length === 0 ? (
          <EmptyState
            compact
            icon="key"
            title="Chưa có token nào."
            description={
              mine
                ? 'Cấp token ở khung trên để nối Claude Desktop với builder.'
                : 'Chưa ai nối Claude Desktop với builder.'
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState compact icon="search" title="Không có token nào ở trạng thái này." />
        ) : (
          <ul className={cn(ui.card, 'divide-y divide-shell-line overflow-hidden')}>
            {shown.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-shell-raised">
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded bg-shell-raised text-shell-muted"
                >
                  <Icon name="monitor" size={18} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-ui font-semibold">{row.name}</span>
                    <StatusBadge status={row.status} />
                    {/*
                      Token ĐĂNG ĐƯỢC phải nhìn ra từ danh sách.

                      Đây là danh sách người ta mở ra khi hỏi "ai đang có quyền gì".
                      Một cờ chỉ thấy được lúc cấp là một cờ không ai soát lại, và
                      nó sống 90 ngày. Chỉ hiện trên token CÒN SỐNG: cờ trên một
                      token đã thu hồi là thông tin về quá khứ, và tô nó màu cảnh
                      báo làm người đọc tưởng còn nguy hiểm.
                    */}
                    {row.canPublishLocale && row.status === 'active' && (
                      <Badge
                        tone="warn"
                        size="sm"
                        title="Token này tự đăng được bản dịch lên site, không cần ai bấm Đăng"
                      >
                        đăng bản dịch
                      </Badge>
                    )}
                  </span>
                  <span className="text-small text-shell-muted">
                    {/* Màn cá nhân: mọi dòng đều đứng tên mình, email chỉ là chữ thừa. */}
                    {!mine && (
                      <>
                        <span className="font-shell-mono">{row.email}</span> ·{' '}
                      </>
                    )}
                    hết hạn {when(row.expiresAt)} · dùng lần cuối {when(row.lastUsedAt)}
                  </span>
                </div>

                {/*
                  Xoá hẳn chỉ có với token đã vô hiệu — server cũng kiểm lại (xem
                  `?purge=1`). Hai lớp chứ không một: nút này đổi theo `row.status`, và
                  `status` được tính ở lần tải trang trước — một token vừa hết hạn giữa
                  chừng thì bảng vẫn nói nó "đang dùng".
                */}
                {row.status === 'active' ? (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => setAsk({ kind: 'revoke', row })}
                  >
                    Thu hồi
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    disabled={busy}
                    onClick={() => setAsk({ kind: 'purge', row })}
                    title="Token đã vô hiệu — xoá chỉ để dọn bảng, nhật ký vẫn giữ."
                  >
                    Xoá khỏi danh sách
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="max-w-prose text-small leading-relaxed text-shell-muted">
        Token cho phép sửa <strong className="font-semibold text-shell-ink">bản nháp</strong> của
        site. Nó không publish được — đưa thay đổi ra site thật vẫn là thao tác của bạn trong
        builder. Thu hồi có hiệu lực ngay lập tức.
      </p>

      {/*
        Một hộp xác nhận cho cả ba việc phá huỷ. Chữ trong hộp dựng từ `ask`, nên khi
        đóng thì không còn tên token nào nằm lại trong DOM.

        "Thu hồi tất cả" phải nói ĐÚNG SỐ LƯỢNG, không nói "tất cả": người bấm cần biết
        mình đang cắt mấy thiết bị, và con số là thứ duy nhất chặn được cú bấm theo phản
        xạ. Token đã hết hạn hoặc đã thu hồi không nằm trong đó — chúng đã vô hiệu, và ghi
        `revokedAt` lần hai sẽ xoá mất thời điểm thật.
      */}
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        onConfirm={confirmAsk}
        busy={busy}
        title={
          ask?.kind === 'revoke'
            ? `Thu hồi “${ask.row.name}”?`
            : ask?.kind === 'purge'
              ? `Xoá hẳn “${ask.row.name}” khỏi danh sách?`
              : ask?.kind === 'revokeAll'
                ? `Thu hồi ${liveCount} token còn hiệu lực?`
                : ''
        }
        description={
          ask?.kind === 'purge'
            ? 'Token này đã vô hiệu, nên xoá không đổi gì về bảo mật — chỉ dọn bảng. Dòng nhật ký về nó vẫn còn, nên vẫn truy được sau này.'
            : undefined
        }
        consequence={
          ask?.kind === 'revoke'
            ? 'Máy đang dùng token này sẽ mất kết nối ngay.'
            : ask?.kind === 'revokeAll'
              ? `Mọi máy đang dùng ${liveCount} token này mất kết nối ngay lập tức, và không lấy lại được — phải cấp token mới.`
              : undefined
        }
        confirmLabel={
          ask?.kind === 'purge' ? 'Xoá khỏi danh sách' : ask?.kind === 'revokeAll' ? `Thu hồi ${liveCount} token` : 'Thu hồi'
        }
      />
    </>
  );
}

function StatusBadge({ status }: { status: TokenRow['status'] }) {
  if (status === 'active')
    return (
      <Badge tone="ok" size="sm" dot>
        đang dùng
      </Badge>
    );
  if (status === 'expired')
    return (
      <Badge tone="neutral" size="sm">
        hết hạn
      </Badge>
    );
  return (
    <Badge tone="danger" size="sm">
      đã thu hồi
    </Badge>
  );
}

/**
 * Chỗ đặt `claude_desktop_config.json` — theo nền tảng VÀ theo kiểu cài.
 *
 * ## Vì sao phải nói cả kiểu cài
 *
 * Sự cố 21/08/2026: cấu hình được dán vào `%APPDATA%\Claude\` — đường dẫn mà mọi tài
 * liệu và mọi bài hướng dẫn đều chỉ — rồi Claude Desktop không thấy công cụ nào. Nguyên
 * nhân: bản cài từ Microsoft Store là app đóng gói MSIX, và Windows CHUYỂN HƯỚNG
 * `%APPDATA%` của nó vào một thư mục trong `%LOCALAPPDATA%\Packages\`. `%APPDATA%\Claude`
 * lúc đó không tồn tại, nên tạo file ở đó thành công, im lặng, và vô ích.
 *
 * Kiểu sai này không báo lỗi ở đâu: Desktop chỉ đơn giản không có `mcpServers` để đọc.
 */
const CONFIG_LOCATIONS: Record<Platform, { how: string; path: string; note: string }[]> = {
  windows: [
    /*
     * Chia theo việc app có chạy dạng gói MSIX không — KHÔNG theo "tải từ Store hay từ
     * file .exe": đó là thứ người dùng không nhớ, còn thư mục gói thì kiểm được ngay.
     * Đuôi `pzs8sxrjxfjjc` là mã nhà phát hành (Anthropic), giống nhau trên mọi máy — đo
     * trên máy dev 20/10/2026: gói `Claude_pzs8sxrjxfjjc`, dữ liệu app nằm trong
     * `LocalCache\Roaming\Claude`, còn `%APPDATA%\Claude` không hề tồn tại.
     */
    {
      how: 'Có thư mục %LOCALAPPDATA%\\Packages\\Claude_pzs8sxrjxfjjc (bản MSIX)',
      path: '%LOCALAPPDATA%\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json',
      note: 'Bản cài từ Microsoft Store là bản này. Windows chuyển hướng %APPDATA% của app vào đây; đuôi pzs8sxrjxfjjc giống nhau trên mọi máy.',
    },
    {
      how: 'Không có thư mục đó (bản cài không đóng gói)',
      path: '%APPDATA%\\Claude\\claude_desktop_config.json',
      note: 'Đường dẫn mà tài liệu hay ghi — chỉ đúng khi Claude KHÔNG chạy dạng gói MSIX.',
    },
  ],
  mac: [
    {
      how: 'Mọi bản cài',
      path: '~/Library/Application Support/Claude/claude_desktop_config.json',
      note: 'macOS không có chuyển hướng kiểu MSIX, nên chỉ một đường dẫn.',
    },
  ],
};

/** Log đọc khi Desktop không thấy công cụ. */
const LOG_PATH: Record<Platform, string> = {
  windows: '%LOCALAPPDATA%\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\logs\\mcp.log',
  mac: '~/Library/Logs/Claude/mcp*.log',
};

const CODE = 'font-shell-mono text-[0.92em] text-shell-ink';

/**
 * Token hiện ra đúng một lần.
 *
 * Kèm khối cấu hình đã điền sẵn URL và token — bước hay sai nhất của cả quy trình là
 * ghép tay JSON với đường dẫn tuyệt đối. Ba bước đánh số là một trình tự thật: tải file,
 * dán cấu hình trỏ tới file đó, rồi khởi động lại để Desktop đọc cấu hình.
 */
function MintedPanel({
  minted,
  origin,
  platform,
  onDone,
}: {
  minted: Minted;
  origin: string;
  platform: Platform;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  /*
   * Tab nền tảng đổi được bằng tay, không chỉ đoán từ user-agent.
   *
   * Builder thường được deploy, nên máy mở trang này và máy chạy Claude Desktop không
   * bắt buộc là một. Đoán sai mà không cho đổi thì hướng dẫn chỉ đường tới một file
   * không tồn tại trên máy đích.
   */
  const [os, setOs] = useState<Platform>(platform);

  /*
   * Đường dẫn dùng dấu `/`, kể cả trên Windows.
   *
   * Node trên Windows nhận cả `/` và `\`, nhưng trong JSON thì `\` phải viết đôi
   * (`C:\\Users\\...`). Đó là chỗ hỏng thật: viết một dấu thì JSON parse ra `\U` — hoặc
   * lỗi, hoặc âm thầm mất dấu gạch, tuỳ chỗ. Dùng `/` thì không có gì để escape, nên
   * không có gì để sai. Người dùng PHẢI sửa đoạn này bằng tay, nên nó phải là dạng khó
   * làm sai nhất.
   */
  /*
   * Tên kết nối = khoá trong `mcpServers`, mặc định theo domain của builder (xem
   * `mcp-name.ts`): nối hai builder mà cùng tên thì khối sau đè khối trước. Giữ chuỗi THÔ
   * người dùng gõ, chỉ làm sạch lúc dùng — làm sạch ngay trong ô thì gõ "abc-" bị nuốt
   * mất dấu gạch giữa chừng.
   */
  const [nameInput, setNameInput] = useState(() => mcpServerName(origin));
  const serverName = sanitizeMcpName(nameInput) || mcpServerName(origin);

  /*
   * Mỗi builder một thư mục: builder ở hai môi trường có thể khác phiên bản, nên
   * `server.mjs` của chúng không dùng chung được. Tên file khớp đúng tên file tải về ở
   * bước 1, để không phải đổi tên.
   */
  const scriptPath =
    os === 'windows'
      ? `C:/Users/<tên-của-bạn>/quilder-mcp/${serverName}/quilder-mcp-server.mjs`
      : `/Users/<tên-của-bạn>/quilder-mcp/${serverName}/quilder-mcp-server.mjs`;

  const config = JSON.stringify(
    {
      mcpServers: {
        [serverName]: {
          command: 'node',
          args: [scriptPath],
          env: { MM_BUILDER_URL: origin, MM_BUILDER_TOKEN: minted.token },
        },
      },
    },
    null,
    2,
  );

  const copy = async (text: string, what: string) => {
    await copyText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section
      aria-labelledby="minted-title"
      className={cn(ui.card, 'flex flex-col gap-6 p-6 ring-2 ring-shell-accent')}
    >
      <div className="flex flex-col gap-3">
        <h2 id="minted-title" className="text-section font-semibold">
          Token đã cấp: {minted.name}
        </h2>
        <Consequence>
          Chép ngay bây giờ. Đóng khung này là không xem lại được — hệ thống chỉ lưu dấu vết để
          thu hồi, không lưu chính token.
        </Consequence>
      </div>

      <ol className="flex flex-col">
        <Step n={1} title="Đặt tên kết nối, tải file server">
          <div className="flex max-w-md flex-col gap-1.5">
            <TextField
              id="mcp-name"
              label="Tên kết nối trong Claude Desktop"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              spellCheck={false}
              mono
              data-mcp-name=""
            />
            <p className="text-small leading-relaxed text-shell-muted">
              Mặc định theo domain của builder này, để nối nhiều builder (dev, product, dự án
              khác) mà không trùng tên. Chỉ chữ thường, số, <code className={CODE}>-</code>,{' '}
              <code className={CODE}>_</code>
              {serverName !== nameInput && (
                <>
                  {' '}— sẽ dùng: <code className={CODE}>{serverName}</code>
                </>
              )}
              .
            </p>
          </div>
          {/* `<a download>` thật, không `Link`: đây là một file tải về, không phải một
              màn để điều hướng tới. */}
          <a href="/api/tokens/client" download className={buttonClass('primary', 'md', 'self-start')}>
            <Icon name="download" size={18} />
            Tải quilder-mcp-server.mjs
          </a>
          <p className="text-small leading-relaxed text-shell-muted">
            Lưu vào thư mục <code className={CODE}>quilder-mcp/{serverName}/</code> trong thư mục
            người dùng — mỗi builder một thư mục, vì builder ở môi trường khác có thể là phiên bản
            khác. Cần cài sẵn Node.js.
          </p>
        </Step>

        <Step n={2} title="Dán cấu hình vào Claude Desktop">
          {/* Chọn nền tảng: đường dẫn file cấu hình khác nhau, và trên Windows còn khác
              theo kiểu cài. */}
          <Tabs
            label="Hệ điều hành của máy chạy Claude Desktop"
            size="sm"
            value={os}
            onChange={setOs}
            className="self-start"
            items={(['windows', 'mac'] as const).map((p) => ({
              id: p,
              label: <TabLabel data={{ 'data-os-tab': p }} label={p === 'windows' ? 'Windows' : 'macOS'} on={os === p} />,
            }))}
          />

          <p className="text-small leading-relaxed text-shell-muted">
            Cách <strong className="font-semibold text-shell-ink">chắc chắn đúng</strong>: trong
            Claude Desktop mở{' '}
            <strong className="font-semibold text-shell-ink">Settings → Developer → Edit Config</strong>{' '}
            — nó mở đúng file, bất kể bạn cài kiểu nào. Nếu mở bằng tay thì file nằm ở:
          </p>

          <ul className={cn(ui.inset, 'flex flex-col gap-3 p-4')}>
            {CONFIG_LOCATIONS[os].map((loc) => (
              <li key={loc.how} className="flex flex-col gap-0.5">
                <p className="text-small font-semibold">{loc.how}</p>
                <p className="font-shell-mono text-small break-all text-shell-ink select-all">{loc.path}</p>
                <p className="text-small text-shell-muted">{loc.note}</p>
              </li>
            ))}
          </ul>

          {os === 'windows' && (
            <Consequence tone="warn">
              Bản MSIX (có thư mục <code className={CODE}>Claude_pzs8sxrjxfjjc</code>){' '}
              <strong className="font-semibold">không</strong> đọc{' '}
              <code className={CODE}>%APPDATA%\Claude</code>. Tạo file ở đó vẫn thành công nhưng
              Desktop không bao giờ thấy nó — không có lỗi nào hiện ra.
            </Consequence>
          )}

          <Consequence tone="warn">
            Đã nối builder khác rồi? <strong className="font-semibold">Thêm</strong> khối{' '}
            <code className={CODE}>{serverName}</code> vào trong <code className={CODE}>mcpServers</code>{' '}
            đang có, đừng thay cả file — thay cả file là mất kết nối cũ.
          </Consequence>
          <p className="text-small leading-relaxed text-shell-muted">
            Sửa <code className={CODE}>&lt;tên-của-bạn&gt;</code> trong <code className={CODE}>args</code>{' '}
            cho đúng chỗ bạn vừa lưu file ở bước 1. Giữ dấu <code className={CODE}>/</code> — trong JSON, dấu{' '}
            <code className={CODE}>\</code> phải viết đôi (<code className={CODE}>C:\\Users\\…</code>
            ), và viết một dấu là chỗ hỏng thường gặp nhất. Đừng bỏ{' '}
            <code className={CODE}>MM_BUILDER_URL</code>: thiếu nó, server mặc định{' '}
            <code className={CODE}>http://localhost:3001</code>.
          </p>
          {/* Không đặt max-height: cấu hình chỉ ~14 dòng, cắt ngang giữa dấu ngoặc
              làm người ta tưởng còn thiếu phần chưa hiện. Chỉ cuộn NGANG, cho dòng
              token dài. */}
          <pre className={cn(ui.inset, 'overflow-x-auto p-4 font-shell-mono text-small leading-relaxed')}>
            {config}
          </pre>
          <Button
            size="md"
            icon={copied === 'config' ? 'check' : 'copy'}
            className="self-start"
            onClick={() => void copy(config, 'config')}
          >
            {copied === 'config' ? 'Đã chép' : 'Chép cấu hình'}
          </Button>
        </Step>

        <Step n={3} title="Khởi động lại Claude Desktop" last>
          <p className="text-small leading-relaxed text-shell-muted">
            Bắt buộc — config chỉ được đọc lúc khởi động. Xong sẽ thấy biểu tượng công cụ trong ô
            chat. Thử: <em>&ldquo;Liệt kê các trang của site&rdquo;</em>
          </p>
          <p className="text-small leading-relaxed text-shell-muted">
            Không thấy công cụ? Đọc log:{' '}
            <span className="font-shell-mono break-all text-shell-ink select-all">{LOG_PATH[os]}</span>
          </p>
        </Step>
      </ol>

      {/*
        Ba câu này trả lời ba câu hỏi mà người dùng thật đã hỏi, theo đúng thứ tự họ hỏi.
        Chúng ở đây chứ không ở tài liệu riêng: người đang cấp token là người đang mắc.
        Không đánh số: đây không phải một bước, mà là thứ đọc kèm cả ba bước.
      */}
      <div className={cn(ui.inset, 'flex flex-col gap-2.5 p-4')}>
        <p className="flex items-center gap-2 text-ui font-semibold">
          <Icon name="info" size={18} className="text-shell-accent" />
          Vài điều dễ hiểu sai
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-small leading-relaxed text-shell-muted">
          <li>
            <strong className="font-semibold text-shell-ink">
              Đây không phải &ldquo;connector&rdquo; của claude.ai.
            </strong>{' '}
            Server này chạy qua stdio — Claude Desktop khởi động một tiến trình Node trên máy bạn.
            Thêm nó ở giao diện web claude.ai sẽ không bao giờ thấy, vì connector web cần một MCP
            server HTTP có URL công khai.
          </li>
          <li>
            <strong className="font-semibold text-shell-ink">Builder phải đang chạy.</strong> Công cụ
            gọi vào <code className={CODE}>{origin}</code>. Tắt builder thì Claude báo không kết nối
            được.
          </li>
          <li>
            <strong className="font-semibold text-shell-ink">Máy chạy Desktop cần Node.js.</strong>{' '}
            File server không phụ thuộc thư viện nào, nhưng nó là một script Node.
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="md"
          icon={copied === 'token' ? 'check' : 'copy'}
          onClick={() => void copy(minted.token, 'token')}
        >
          {copied === 'token' ? 'Đã chép' : 'Chép riêng token'}
        </Button>
        <Button size="md" onClick={onDone}>
          Tôi đã lưu xong
        </Button>
      </div>
    </section>
  );
}

/** Một bước trong trình tự: số tròn accent, đường nối dọc xuống bước sau. */
function Step({
  n,
  title,
  last,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-4 pb-7 last:pb-0">
      {!last && <span aria-hidden className="absolute top-9 bottom-2 left-3.5 w-px bg-shell-line" />}
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-shell-accent text-small font-semibold text-shell-on-accent">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
        <h3 className="text-card font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  );
}
