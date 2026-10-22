import { getBuilderBranding } from '@/lib/builder/branding';
import { ROLLBACK_WINDOW_TEXT } from '@/lib/builder/rollback-window';
import { Icon, type IconName } from '@/components/builder/ui/Icon';

/**
 * Khung chung của hai màn chưa có phiên: đăng nhập và cài đặt lần đầu.
 *
 * Trái là ô thương hiệu, phải là form. Hai ô cùng nằm trong một hàng `flex-wrap`
 * nên trên điện thoại chúng xếp chồng, form ở dưới. Server component: ô thương hiệu
 * không có gì tương tác, và nó đọc `ROLLBACK_WINDOW_TEXT` (module `server-only`) để
 * câu giới thiệu luôn nói đúng chính sách giữ release đang chạy, không chép tay số.
 */

/*
 * Màu thương hiệu CỐ ĐỊNH (`brand` / `on-brand` trong builder.css), không theo theme.
 *
 * Logo Quilder ở màn này là bản một màu trắng. Ở theme tối `shell-accent` sáng lên (#6c9bff)
 * và chữ trên nó thành chữ tối, nên logo trắng trên đó chỉ còn ~2,7:1 còn chữ trắng
 * thì không đọc nổi. Token `brand` giữ đúng xanh của theme sáng ở cả hai theme: trắng
 * trên nó ~5,5:1, và đây cũng là hình của bản thiết kế đã duyệt.
 */
const BRAND = 'bg-brand text-on-brand';

const FEATURES: { icon: IconName; text: string }[] = [
  { icon: 'grid', text: 'Trang, component và thư viện file trong cùng một chỗ.' },
  { icon: 'history', text: `${ROLLBACK_WINDOW_TEXT} lùi về được đúng nguyên trạng.` },
  { icon: 'sparkle', text: 'Ra lệnh sửa site bằng Claude Desktop qua Kết nối Claude.' },
];

export async function AuthScreen({ children }: { children: React.ReactNode }) {
  // Logo riêng của builder (màn Cài đặt → Nhận diện builder), nếu đã đặt.
  const { logoUrl } = await getBuilderBranding();

  return (
    <main className="flex min-w-0 flex-1 flex-wrap gap-5">
      <section
        aria-label="Giới thiệu"
        className={`${BRAND} relative isolate flex min-w-0 flex-[1_1_26rem] flex-col gap-10 overflow-hidden rounded-xl p-8 sm:p-12`}
      >
        <div className="flex items-center gap-3.5">
          {logoUrl ? (
            /* Logo riêng nằm trên một ô TRẮNG: không biết trước nó màu gì, và một logo
               tối trên nền xanh thương hiệu là một logo không ai thấy. */
            <span className="grid h-14 max-w-48 place-items-center rounded-md bg-white px-2.5 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Logo" className="max-h-full w-auto max-w-full object-contain" />
            </span>
          ) : (
            /* Wordmark Quilder một màu trắng (public/brand). SVG tĩnh: next/image không tối
               ưu được gì thêm. */
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/brand/quilder-wordmark-white.svg" alt="Quilder" className="h-12 w-auto" />
          )}
          {/* Logo riêng là của DỰ ÁN; tên công cụ đứng cạnh để người đăng nhập biết đây là
              trình dựng trang, không phải site. Logo mặc định đã mang chữ Quilder. */}
          {logoUrl && (
            <span className="border-l border-current/35 pl-3 text-ui font-medium opacity-85">Quilder</span>
          )}
        </div>

        <div className="mt-auto flex max-w-[28.75rem] flex-col gap-4">
          <h2 className="text-[1.75rem] leading-[1.24] font-bold tracking-[-0.01em] text-balance sm:text-[2.125rem]">
            Ghép khối thành website, sửa ngay trên bản xem trước.
          </h2>
          <p className="text-[0.9375rem] leading-relaxed opacity-90 max-sm:hidden">
            Mỗi lần publish là một ảnh chụp của cả site. Lùi bản mất chưa tới một giây, không
            build, không deploy lại.
          </p>
        </div>

        <ul className="flex max-w-[28.75rem] flex-col gap-3.5 max-sm:hidden">
          {FEATURES.map((f) => (
            <li key={f.icon} className="flex items-start gap-3 text-ui leading-relaxed">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded bg-current/16">
                <Icon name={f.icon} size={16} />
              </span>
              {f.text}
            </li>
          ))}
        </ul>

        {/* Hình trang trí nằm DƯỚI chữ (`-z-10` trong khung `isolate`): trên điện thoại
            nó chồng lên dòng tiêu đề. */}
        <svg
          aria-hidden
          width="360"
          height="360"
          viewBox="0 0 360 360"
          className="pointer-events-none absolute -top-[5.625rem] -right-[5.625rem] -z-10 opacity-14"
        >
          <rect x="0" y="0" width="160" height="160" rx="36" fill="currentColor" />
          <rect x="180" y="0" width="160" height="160" rx="36" fill="currentColor" />
          <rect x="0" y="180" width="160" height="160" rx="36" fill="currentColor" />
        </svg>
      </section>

      <div className="grid min-w-0 flex-[1_1_28rem] place-items-center px-2 py-8 sm:p-6">
        <div className="w-full max-w-[26.25rem]">{children}</div>
      </div>
    </main>
  );
}
