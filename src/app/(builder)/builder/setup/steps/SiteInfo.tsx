'use client';

import { Button } from '@/components/builder/ui/Button';
import { TextField } from '@/components/builder/ui/Field';
import { normalizeSiteUrl } from '@/lib/site/origin-resolve';

export interface SiteValues {
  siteName: string;
  siteUrl: string;
}

export type SiteErrors = Partial<Record<keyof SiteValues, string>>;

/** Kiểm trên client bằng ĐÚNG hàm server dùng — hai bên không thể nói khác nhau. */
export function checkSite(v: SiteValues, siteUrlEnv: string | null): SiteErrors {
  const errors: SiteErrors = {};
  if (!v.siteName.trim()) errors.siteName = 'Cần tên site.';
  else if (v.siteName.trim().length > 100) errors.siteName = 'Tên site tối đa 100 ký tự.';
  if (!siteUrlEnv && !normalizeSiteUrl(v.siteUrl)) {
    errors.siteUrl = 'Cần dạng https://ten-mien.vn — có http:// hoặc https://, không có đường dẫn phía sau.';
  }
  return errors;
}

/**
 * Bước 2 — tên site và URL. Không gửi gì: request duy nhất đi ở nút "Cài đặt" của
 * bước 3. "Tiếp" chỉ kiểm trên client rồi chuyển bước.
 */
export function SiteInfo({
  values,
  errors,
  siteUrlEnv,
  onChange,
  onNext,
}: {
  values: SiteValues;
  errors: SiteErrors;
  siteUrlEnv: string | null;
  onChange: (v: SiteValues) => void;
  onNext: () => void;
}) {
  const origin = siteUrlEnv ?? normalizeSiteUrl(values.siteUrl);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      <TextField
        id="setup-site-name"
        label="Tên site"
        autoComplete="organization"
        value={values.siteName}
        error={errors.siteName}
        onChange={(e) => onChange({ ...values, siteName: e.target.value })}
        hint="Hiện trên tab trình duyệt và thẻ chia sẻ. Đổi được sau trong Cài đặt."
      />

      <TextField
        id="setup-site-url"
        label="URL site"
        type="url"
        inputMode="url"
        mono
        spellCheck={false}
        disabled={Boolean(siteUrlEnv)}
        value={siteUrlEnv ?? values.siteUrl}
        error={errors.siteUrl}
        onChange={(e) => onChange({ ...values, siteUrl: e.target.value })}
        hint={
          siteUrlEnv ? (
            <>
              Đang bị biến môi trường <code className="font-shell-mono">SITE_URL</code> ghi đè — đổi ở env của
              server.
            </>
          ) : origin ? (
            <>
              Canonical và sitemap sẽ dựng từ <code className="font-shell-mono text-shell-ink">{origin}/…</code>
            </>
          ) : (
            'Địa chỉ khách gõ để vào site, ví dụ https://ten-mien.vn'
          )
        }
      />

      <div>
        <Button type="submit" variant="primary" iconRight="arrow-right">
          Tiếp
        </Button>
      </div>
    </form>
  );
}
