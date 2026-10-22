import type { Metadata } from 'next';
import { cookies } from 'next/headers';

/**
 * Layout của vỏ builder.
 *
 * Route group riêng, KHÔNG share client component nào với `(site)` — nhờ vậy
 * Next emit hai client bundle rời nhau và khách vào trang chủ không tải một byte
 * code builder nào.
 *
 * Chỉ import `builder.css`. `tokens.css` của website cố ý KHÔNG được nạp ở đây:
 * vỏ công cụ và nội dung phải phân biệt được bằng mắt, và trộn hai bảng màu vào
 * nhau sẽ làm preview trông như một phần của chrome.
 *
 * ## Vì sao theme đọc ở ĐÂY, từ cookie
 *
 * Vỏ builder render ở server. `localStorage` chỉ đọc được sau khi JS chạy, nên
 * mọi cách lưu theme ở client đều cho một nháy sai màu ở mỗi lần tải trang —
 * trang vẽ bằng bảng mặc định rồi mới nhảy sang bảng đúng. Cookie thì đọc được
 * ngay trong lượt render này, nên `data-theme` đúng từ byte HTML đầu tiên.
 */
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@/styles/builder.css';

import { Suspense } from 'react';

import { getSession } from '@/lib/auth/guard';
import { getBuilderBranding } from '@/lib/builder/branding';
import { BuilderNav } from '@/components/builder/BuilderNav';
import { CommandPalette } from '@/components/builder/CommandPalette';
import { NavProgress } from '@/components/builder/NavProgress';
import type { ThemeChoice } from '@/components/builder/ThemeToggle';

export async function generateMetadata(): Promise<Metadata> {
  // Favicon của tab builder: dùng chung của web, hoặc file riêng — xem
  // `lib/builder/branding.ts`. `undefined` khi chưa có: Next khi đó không phát thẻ nào.
  const { favicon } = await getBuilderBranding();
  const icon = favicon ? [{ url: favicon.url, type: favicon.mime }] : undefined;
  return {
    title: 'Quilder',
    // Builder không bao giờ được index. Middleware sẽ đặt thêm X-Robots-Tag ở
    // Plan 3; đây là lớp thứ nhất.
    robots: { index: false, follow: false },
    ...(icon ? { icons: { icon, apple: icon } } : {}),
  };
}

/**
 * Cookie có thể mang bất cứ gì — người dùng sửa được nó bằng devtools, và giá trị
 * đó đi thẳng vào một thuộc tính DOM. Chỉ nhận ba chuỗi, còn lại là `system`.
 *
 * Danh sách nằm ở đây chứ không ở `ThemeToggle`: file kia là `'use client'`, nên
 * một mảng export từ đó sẽ tới server component dưới dạng client reference.
 */
const THEMES: readonly ThemeChoice[] = ['dark', 'light', 'system'];

function readTheme(raw: string | undefined): ThemeChoice {
  return THEMES.find((c) => c === raw) ?? 'system';
}

export default async function BuilderLayout({ children }: { children: React.ReactNode }) {
  const [store, session, branding] = await Promise.all([cookies(), getSession(), getBuilderBranding()]);
  const theme = readTheme(store.get('mm-theme')?.value);

  return (
    <html lang="vi" data-theme={theme}>
      <body className="bg-shell-bg text-shell-ink font-shell antialiased">
        {/* Thanh tiến độ khi chuyển trang, ở LAYOUT vì cùng lý do với thanh menu: mọi màn đều
            cần nó, và nó phải sống qua lượt chuyển trang mà nó đang báo. `Suspense` vì
            `useSearchParams` — ở đây vỏ luôn render động (đọc cookie), nhưng thiếu boundary
            thì màn nào lỡ thành tĩnh sẽ hỏng build. Vì sao có thanh này: `NavProgress.tsx`. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {/* Khung vỏ: thanh menu DỌC bên trái + nội dung, cách mép `--shell-gutter`.
            Trên điện thoại thanh nằm ngang ở trên. Thanh menu ở layout, không ở page:
            đó là điều khiến nó GIỐNG NHAU ở mọi trang. `BuilderNav` tự ẩn ở trang
            đăng nhập và màn cài đặt lần đầu. */}
        <div className="flex min-h-svh flex-col gap-3 p-[var(--shell-gutter)] md:flex-row">
          <BuilderNav
            theme={theme}
            isAdmin={session?.role === 'admin'}
            isWriter={session?.role === 'admin' || session?.role === 'editor'}
            signedIn={Boolean(session)}
            logoUrl={branding.logoUrl}
          />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
        {/* Ctrl+K ở LAYOUT: phím tắt phải chạy ở mọi màn builder, không chỉ ở màn
            có người nhớ chép nó vào. Chỉ dựng khi đã đăng nhập — palette hỏi một
            endpoint cần phiên, và ở màn đăng nhập nó chỉ là một phím tắt trả 401. */}
        {session && <CommandPalette />}
      </body>
    </html>
  );
}
