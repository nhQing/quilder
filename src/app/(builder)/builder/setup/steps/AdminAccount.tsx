'use client';

import { Button } from '@/components/builder/ui/Button';
import { TextField } from '@/components/builder/ui/Field';
import { Consequence } from '@/components/builder/ui/Overlay';

export interface AdminValues {
  email: string;
  password: string;
  confirm: string;
  token: string;
}

export type AdminErrors = Partial<Record<keyof AdminValues, string>>;

export const MIN_PASSWORD = 12;

export function checkAdmin(v: AdminValues, tokenRequired: boolean): AdminErrors {
  const errors: AdminErrors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errors.email = 'Email không hợp lệ.';
  if (v.password.length < MIN_PASSWORD) errors.password = `Tối thiểu ${MIN_PASSWORD} ký tự.`;
  else if (v.confirm !== v.password) errors.confirm = 'Hai mật khẩu không khớp.';
  if (tokenRequired && !v.token.trim()) errors.token = 'Cần mã cài đặt.';
  return errors;
}

/** Bước 3 — tài khoản admin. Nút "Cài đặt" gửi request DUY NHẤT của cả màn. */
export function AdminAccount({
  values,
  errors,
  tokenRequired,
  busy,
  formError,
  onChange,
  onSubmit,
}: {
  values: AdminValues;
  errors: AdminErrors;
  tokenRequired: boolean;
  busy: boolean;
  formError: string | null;
  onChange: (v: AdminValues) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {formError && (
        <div role="alert">
          <Consequence>{formError}</Consequence>
        </div>
      )}

      <TextField
        id="setup-email"
        label="Email"
        type="email"
        autoComplete="username"
        mono
        value={values.email}
        error={errors.email}
        onChange={(e) => onChange({ ...values, email: e.target.value })}
      />

      <TextField
        id="setup-password"
        label="Mật khẩu"
        type="password"
        autoComplete="new-password"
        value={values.password}
        error={errors.password}
        onChange={(e) => onChange({ ...values, password: e.target.value })}
        hint={`Tối thiểu ${MIN_PASSWORD} ký tự. Tài khoản này có toàn quyền trên site.`}
      />

      <TextField
        id="setup-password-confirm"
        label="Nhập lại mật khẩu"
        type="password"
        autoComplete="new-password"
        value={values.confirm}
        error={errors.confirm}
        onChange={(e) => onChange({ ...values, confirm: e.target.value })}
      />

      {tokenRequired && (
        <TextField
          id="setup-token"
          label="Mã cài đặt"
          autoComplete="off"
          spellCheck={false}
          mono
          value={values.token}
          error={errors.token}
          onChange={(e) => onChange({ ...values, token: e.target.value.trim() })}
          hint={
            <>
              Lấy từ log của container khởi tạo:{' '}
              <code className="font-shell-mono text-shell-ink">docker compose -f docker-compose.prod.yaml logs bootstrap</code>
            </>
          }
        />
      )}

      <p className="text-small text-shell-muted">
        Bấm Cài đặt sẽ tạo site, trang chủ, trang 404 và tài khoản này. Màn cài đặt tự đóng sau đó.
      </p>

      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {busy ? 'Đang cài đặt…' : 'Cài đặt'}
        </Button>
      </div>
    </form>
  );
}
