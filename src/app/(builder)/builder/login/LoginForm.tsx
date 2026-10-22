'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ui } from '@/lib/builder/ui';
import { Button, IconButton } from '@/components/builder/ui/Button';
import { Checkbox, TextField } from '@/components/builder/ui/Field';
import { Consequence } from '@/components/builder/ui/Overlay';

/**
 * Form đăng nhập. Tách khỏi `page.tsx` vì nó cần `useSearchParams` (đọc `next`), tức
 * phải là client component nằm trong `Suspense` — còn khung trang thì không.
 */
/**
 * Chỉ nhận đường dẫn CÙNG SITE cho `?next=`.
 *
 * `next` đến từ URL, ai cũng soạn được. Không lọc thì `/builder/login?next=https://…`
 * (hay `//…`, trình duyệt hiểu là cùng scheme khác host) là một trang đăng nhập THẬT
 * đưa người vừa đăng nhập sang một site khác — mồi lừa đảo hoàn hảo.
 */
function safeNext(raw: string | null): string {
  // `/\` cũng bị chặn: trình duyệt đọc `\` như `/`, nên `/\evil.com` là `//evil.com`.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/builder';
  return raw;
}

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, remember }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Đăng nhập thất bại');
      /*
       * Nạp LẠI CẢ TRANG, không `router.replace` + `router.refresh`.
       *
       * Sau đăng nhập mọi thứ phía client đều cũ: layout (thanh menu, quyền admin) dựng
       * lúc chưa có phiên, và router cache có thể còn các lượt prefetch đã bị chuyển về
       * trang đăng nhập. Cặp replace + refresh đã từng KẸT: e2e 09/10/2026 bấm Đăng nhập,
       * server trả 200 cho cả hai lượt RSC, mà trang đứng ở "Đang kiểm tra…" suốt 5 phút
       * (dev server vừa biên dịch `/builder` và đẩy một lượt hot update giữa chừng).
       * Một lượt nạp trang thì không có gì để kẹt.
       *
       * `replace` chứ không `assign`: nút Back không nên quay lại trang đăng nhập.
       */
      window.location.replace(next);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className={ui.eyebrow}>Quilder</p>
        <h1 className="text-page font-bold text-balance">Đăng nhập</h1>
      </div>

      {error && (
        <div role="alert">
          <Consequence>{error}</Consequence>
        </div>
      )}

      {/* `id` cố định chứ không `useId`: nhãn nối với ô qua htmlFor/id, và e2e tìm ô
          bằng chính nhãn đó (`getByLabel(/email/i)`). */}
      <TextField
        id="login-email"
        label="Email"
        type="email"
        autoComplete="username"
        required
        mono
        placeholder="ten@congty.vn"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <TextField
        id="login-password"
        label="Mật khẩu"
        /* `autoComplete` giữ nguyên `current-password` kể cả khi đang hiện chữ.
           Đổi nó theo trạng thái (hoặc đổi sang `off`) là cắt đường của trình
           quản lý mật khẩu — người dùng sẽ tưởng builder không nhớ nổi mật khẩu. */
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        suffix={
          /* `IconButton` mặc định `type="button"`, và điều đó là bắt buộc: nút không
             khai type thì là `submit` — bấm con mắt sẽ GỬI FORM bằng mật khẩu đang
             gõ dở. Icon mô tả việc SẼ xảy ra nếu bấm (đang hiện thì vẽ mắt gạch
             chéo), đúng như nhãn; `aria-pressed` cho biết đây là công tắc. */
          <IconButton
            size="sm"
            icon={showPassword ? 'eye-off' : 'eye'}
            label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            pressed={showPassword}
            aria-controls="login-password"
            onClick={() => setShowPassword((v) => !v)}
          />
        }
      />

      {/* Ghi nhớ đăng nhập — mặc định TẮT. Xem `REMEMBER_MAX_AGE` trong
          `lib/auth/session.ts` cho lý do thời hạn và vì sao nó phải do người
          dùng tự chọn. */}
      <Checkbox
        label="Ghi nhớ đăng nhập trong 30 ngày"
        checked={remember}
        onChange={(e) => setRemember(e.target.checked)}
      />

      <Button type="submit" variant="primary" full loading={busy}>
        {busy ? 'Đang kiểm tra…' : 'Đăng nhập'}
      </Button>

      {/* Không còn link tới /builder/setup (21/10/2026): site chưa có tài khoản thì trang
          này TỰ chuyển sang màn cài đặt, còn site đã cài thì màn đó trả 404 — link chỉ dẫn
          tới một trang không tồn tại. */}
      <p className="text-small leading-relaxed text-shell-muted">
        Builder không có tự đăng ký. Cần tài khoản thì nhờ quản trị tạo ở màn Tài khoản.
      </p>
    </form>
  );
}
