'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { AccountTabs } from './AccountTabs';
import { AssetField } from './AssetField';
import { Badge, Tile } from './ui/Badge';
import { Button } from './ui/Button';
import { SearchField, SelectField, TextField } from './ui/Field';
import type { IconName } from './ui/Icon';
import { ConfirmDialog, Dialog, Toast, ToastRegion } from './ui/Overlay';
import { EmptyState, PageHeader } from './ui/Page';
import { Tabs } from './ui/Tabs';

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  /** ISO, hoặc null khi đang dùng được. Xem `User.lockedAt`. */
  lockedAt: string | null;
  /** `Asset.id` của ảnh đại diện — đi vào byline trên site. */
  avatarAssetId: string | null;
}

const ROLES: { id: string; label: string; hint: string; icon: IconName }[] = [
  { id: 'admin', label: 'Quản trị', hint: 'sửa, publish, quản lý tài khoản', icon: 'users' },
  { id: 'editor', label: 'Sửa', hint: 'sửa và publish', icon: 'edit' },
  { id: 'viewer', label: 'Xem', hint: 'chỉ xem bản nháp', icon: 'eye' },
];

/** Thứ tự trong ô chọn: từ quyền ít tới quyền nhiều. */
const ROLE_OPTIONS = [...ROLES].reverse().map((r) => ({ value: r.id, label: r.label }));

const ROLE_HINT = ROLES.slice()
  .reverse()
  .map((r) => `${r.label}: ${r.hint}.`)
  .join(' ');

/** Ô của bảng: tiêu đề cột viết hoa `micro`, hàng cách nhau bằng vạch `shell-line`. */
const TH =
  'border-b border-shell-line px-4 py-3.5 text-left text-micro font-semibold tracking-[0.08em] whitespace-nowrap text-shell-muted uppercase first:pl-5.5 last:pr-5.5';
const TD = 'border-b border-shell-line px-4 py-3 align-middle first:pl-5.5 last:pr-5.5';

type Modal = { kind: 'new' } | { kind: 'password'; user: UserRow } | { kind: 'lock'; user: UserRow };

export function UserAdmin({ users, meId }: { users: UserRow[]; meId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [role, setRole] = useState<string>('all');
  const [query, setQuery] = useState('');

  const call = async (path: string, init: RequestInit, ok: string) => {
    setBusy(path);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Thất bại');
      setNotice(ok);
      router.refresh();
      return true;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  // Báo thành công tự tắt sau 5 giây; lỗi ở lại tới khi người dùng đóng.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const closeModal = () => {
    setModal(null);
    setError(null);
  };

  const countOf = (id: string) => users.filter((u) => u.role === id).length;
  const q = query.trim().toLowerCase();
  const shown = users.filter(
    (u) =>
      (role === 'all' || u.role === role) &&
      (!q || u.email.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader
        title="Tài khoản"
        count={users.length}
        description="Không có tự đăng ký: mọi tài khoản do quản trị tạo ở đây."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setModal({ kind: 'new' })}>
            Thêm tài khoản
          </Button>
        }
      />

      <AccountTabs current="users" />

      {/* Số theo vai trò đếm từ chính danh sách bên dưới, nên không bao giờ lệch nó. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(13.75rem,1fr))] gap-4">
        {ROLES.map((r, i) => {
          const locked = users.filter((u) => u.role === r.id && u.lockedAt !== null).length;
          return (
            <article key={r.id} className={cn(ui.card, 'flex items-center gap-3.5 p-4')}>
              <Tile index={i} icon={r.icon} />
              <span className="flex flex-col">
                <b className="text-[1.375rem] leading-tight font-bold tabular-nums">{countOf(r.id)}</b>
                <span className="text-small text-shell-muted">
                  {r.label}
                  {locked > 0 && ` · ${locked} đã khoá`}
                </span>
              </span>
            </article>
          );
        })}
      </div>

      <section aria-label="Danh sách tài khoản" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Tabs
            label="Lọc theo vai trò"
            value={role}
            onChange={setRole}
            items={[
              { id: 'all', label: 'Tất cả', count: users.length },
              ...ROLES.map((r) => ({ id: r.id, label: r.label, count: countOf(r.id) })),
            ]}
          />
          <SearchField
            label="Tìm tài khoản"
            placeholder="Tìm theo tên hoặc email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            wrapperClassName="ml-auto min-w-55 flex-[0_1_18.75rem]"
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            compact
            icon="search"
            title="Không có tài khoản nào khớp bộ lọc."
            description="Bỏ lọc vai trò hoặc tìm bằng từ khác."
          />
        ) : (
          // `relative` là bắt buộc: nhãn `sr-only` (tiêu đề cột "Thao tác", nhãn ô vai
          // trò) là phần tử `absolute`, và khung cuộn không định vị thì không cắt được
          // chúng — trên điện thoại chúng đẩy cả TRANG cuộn ngang dù bảng có khung riêng.
          <div className={cn(ui.card, 'relative overflow-x-auto')}>
            <table className="w-full min-w-[47.5rem] border-collapse text-small">
              <caption className="sr-only">Tài khoản</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Tài khoản
                  </th>
                  <th scope="col" className={cn(TH, 'w-44')}>
                    Vai trò
                  </th>
                  <th scope="col" className={cn(TH, 'w-36')}>
                    Trạng thái
                  </th>
                  <th scope="col" className={cn(TH, 'w-64')}>
                    <span className="sr-only">Thao tác</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((user) => {
                  const isMe = user.id === meId;
                  const locked = user.lockedAt !== null;
                  const display = user.name || user.email;
                  return (
                    <tr key={user.id} className="hover:bg-shell-raised [&:last-child>td]:border-b-0">
                      <td className={TD}>
                        {/* Làm mờ ô danh tính khi đã khoá: tài khoản ấy vẫn PHẢI hiện ra
                            (nó là tác giả của bài đang chạy), nên nó cần khác hẳn về mặt
                            thị giác thay vì chỉ khác một nhãn nhỏ mà mắt lướt qua. Nút
                            "Mở khoá" ở cuối hàng thì không mờ — nó vẫn bấm được. */}
                        <div className={cn('flex items-center gap-3', locked && 'opacity-60')}>
                          {/* Ảnh đại diện đứng ĐẦU hàng, không nằm trong một màn cài đặt
                              riêng: nó là thứ hiện ra byline trên site thật, nên nó thuộc
                              về đúng chỗ người ta nhìn danh sách tài khoản và thấy ai thiếu
                              ảnh.

                              Ẩn dòng tên file dưới khung của `AssetPickerBox` (con `span`
                              trực tiếp): ở đây khung rỗng có dấu cộng đã nói "chưa có ảnh",
                              tên file vẫn có ở `title` khi rê chuột, và dòng chữ đó làm mỗi
                              hàng cao thêm một nửa. */}
                          <div className="w-14 shrink-0 [&>div>span]:hidden">
                            <AssetField
                              imageOnly
                              value={user.avatarAssetId}
                              onPick={(assetId) =>
                                void call(
                                  `/api/users/${user.id}`,
                                  { method: 'PATCH', body: JSON.stringify({ avatarAssetId: assetId }) },
                                  'Đã đổi ảnh đại diện',
                                )
                              }
                            />
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-2">
                              <span className={cn('truncate text-ui font-semibold', locked && 'line-through')}>
                                {display}
                              </span>
                              {isMe && (
                                <Badge tone="accent" size="sm">
                                  bạn
                                </Badge>
                              )}
                            </span>
                            {user.name && (
                              <span className="truncate font-shell-mono text-mini text-shell-muted">
                                {user.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className={TD}>
                        <SelectField
                          size="md"
                          label={`Vai trò của ${display}`}
                          hideLabel
                          value={user.role}
                          disabled={busy !== null}
                          options={ROLE_OPTIONS}
                          onChange={(e) =>
                            void call(
                              `/api/users/${user.id}`,
                              { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) },
                              'Đã đổi vai trò',
                            )
                          }
                        />
                      </td>

                      <td className={TD}>
                        {locked ? (
                          <Badge tone="danger" size="sm">
                            đã khoá
                          </Badge>
                        ) : (
                          <Badge tone="ok" size="sm" dot>
                            đang dùng
                          </Badge>
                        )}
                      </td>

                      <td className={TD}>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="key"
                            disabled={busy !== null}
                            onClick={() => setModal({ kind: 'password', user })}
                          >
                            Đổi mật khẩu
                          </Button>
                          <Button
                            variant={locked ? 'secondary' : 'danger'}
                            size="sm"
                            icon="lock"
                            disabled={busy !== null || isMe}
                            title={isMe ? 'Không tự khoá tài khoản của mình' : locked ? 'Mở khoá' : 'Khoá tài khoản'}
                            onClick={() => {
                              if (locked) {
                                void call(
                                  `/api/users/${user.id}`,
                                  { method: 'POST', body: JSON.stringify({ locked: false }) },
                                  'Đã mở khoá',
                                );
                                return;
                              }
                              setModal({ kind: 'lock', user });
                            }}
                          >
                            {locked ? 'Mở khoá' : 'Khoá'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="max-w-prose text-small leading-relaxed text-shell-muted">
          Không có đăng ký tự do và không có mời qua email — đây là công cụ nội bộ, và mỗi tài
          khoản đều publish được lên site thật. Admin tạo tài khoản rồi đưa mật khẩu tận tay.
          Hệ thống luôn giữ ít nhất một admin.
        </p>
      </section>

      <NewUserDialog
        open={modal?.kind === 'new'}
        busy={busy === '/api/users'}
        error={modal?.kind === 'new' ? error : null}
        onClose={closeModal}
        onCreate={async (body) => {
          const ok = await call('/api/users', { method: 'POST', body: JSON.stringify(body) }, 'Đã tạo tài khoản');
          if (ok) setModal(null);
          return ok;
        }}
      />

      <PasswordDialog
        user={modal?.kind === 'password' ? modal.user : null}
        busy={busy !== null}
        error={modal?.kind === 'password' ? error : null}
        onClose={closeModal}
        onReset={async (user, password) => {
          const ok = await call(
            `/api/users/${user.id}`,
            { method: 'PATCH', body: JSON.stringify({ password }) },
            'Đã đặt lại mật khẩu',
          );
          if (ok) setModal(null);
        }}
      />

      {/* Hộp xác nhận nói ra HAI hậu quả, không chỉ một. Token MCP bị thu hồi là thứ
          không ai nghĩ tới lúc bấm, và là thứ làm một con bot ngừng chạy vào hôm sau
          mà không ai nối được nguyên nhân. */}
      <ConfirmDialog
        open={modal?.kind === 'lock'}
        onClose={closeModal}
        busy={busy !== null}
        title="Khoá tài khoản này?"
        description={
          modal?.kind === 'lock' ? (
            <>
              <span className="block font-shell-mono break-all text-shell-ink">{modal.user.email}</span>
              Tài khoản này sẽ không đăng nhập được nữa. Bài họ đã viết vẫn giữ tên họ.
            </>
          ) : undefined
        }
        consequence="Mọi token MCP của tài khoản này bị thu hồi ngay, và mở khoá KHÔNG trả lại token."
        confirmLabel="Khoá tài khoản"
        onConfirm={() => {
          if (modal?.kind !== 'lock') return;
          void call(
            `/api/users/${modal.user.id}`,
            { method: 'POST', body: JSON.stringify({ locked: true }) },
            'Đã khoá tài khoản',
          ).then((ok) => {
            if (ok) setModal(null);
          });
        }}
      >
        {modal?.kind === 'lock' && error && (
          <p role="alert" className={ui.error}>
            {error}
          </p>
        )}
      </ConfirmDialog>

      {/* Lỗi trong lúc một dialog đang mở thì hiện ngay trong dialog đó: toast nằm dưới
          lớp phủ của dialog modal, không ai thấy. */}
      {!modal && (notice || error) && (
        <ToastRegion>
          {error ? (
            <Toast tone="danger" title={error} onClose={() => setError(null)} />
          ) : (
            <Toast tone="ok" title={notice} onClose={() => setNotice(null)} />
          )}
        </ToastRegion>
      )}
    </>
  );
}

function NewUserDialog({
  open,
  busy,
  error,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (body: Record<string, string>) => Promise<boolean>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('editor');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!busy}
      title="Thêm tài khoản"
      description="Người được thêm đăng nhập bằng email và mật khẩu này. Không có email mời."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await onCreate({ email, name, password, role });
          if (ok) {
            setEmail('');
            setName('');
            setPassword('');
          }
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))] gap-4">
          <TextField
            id="nu-email"
            label="Email"
            type="email"
            required
            mono
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField id="nu-name" label="Tên" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <TextField
          id="nu-pass"
          label="Mật khẩu"
          type="password"
          autoComplete="new-password"
          required
          hint="Ít nhất 10 ký tự."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <SelectField
          id="nu-role"
          label="Vai trò"
          hint={ROLE_HINT}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          options={ROLE_OPTIONS}
        />
        {error && (
          <p role="alert" className={ui.error}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!email || password.length < 10}>
            {busy ? 'Đang tạo…' : 'Thêm'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PasswordDialog({
  user,
  busy,
  error,
  onClose,
  onReset,
}: {
  user: UserRow | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onReset: (user: UserRow, password: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');

  // Mỗi lần đóng là xoá ô: mật khẩu gõ dở cho người trước không được đi theo sang
  // người sau. `Dialog` gọi `onClose` ở mọi đường đóng (Esc, X, Huỷ, lưu xong).
  const close = () => {
    setValue('');
    onClose();
  };

  return (
    <Dialog
      open={user !== null}
      onClose={close}
      dismissable={!busy}
      size="sm"
      title="Đổi mật khẩu"
      description={
        user ? (
          <>
            <span className="block font-shell-mono break-all text-shell-ink">{user.email}</span>
            Builder không gửi email — đưa mật khẩu mới tận tay người dùng.
          </>
        ) : undefined
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (user && value.length >= 10) void onReset(user, value);
        }}
        className="flex flex-col gap-4"
      >
        <TextField
          label="Mật khẩu mới"
          type="password"
          autoComplete="new-password"
          autoFocus
          hint="Ít nhất 10 ký tự."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && (
          <p role="alert" className={ui.error}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Huỷ
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={value.length < 10}>
            Đặt mật khẩu mới
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
