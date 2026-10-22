import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { prisma } from '@/lib/db';
import { AuthScreen } from './AuthScreen';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

/**
 * Site chưa cài (chưa có tài khoản nào), hoặc DB chưa sẵn sàng → màn cài đặt.
 *
 * Đây là đường mà "mở /builder trên một site trắng" đi qua: middleware đá người
 * chưa đăng nhập về trang này, và trang này đá tiếp sang `/builder/setup`. Không
 * có bước này, người dựng site mới đứng trước một form đăng nhập mà không tài
 * khoản nào đăng nhập được, và không gì chỉ cho họ màn cài đặt.
 *
 * DB lỗi cũng chuyển: màn cài đặt là chỗ nói được DB đang hỏng thế nào; form đăng
 * nhập chỉ nói được "đăng nhập thất bại".
 */
async function needsSetup(): Promise<boolean> {
  try {
    return (await prisma.user.count()) === 0;
  } catch {
    return true;
  }
}

/**
 * Đăng nhập.
 *
 * Nằm trong route group `(builder)` nên nó dùng vỏ Tailwind của builder, nhưng
 * middleware cho nó qua — nếu chặn thì sẽ vòng lặp chuyển hướng vô tận. `BuilderNav`
 * tự ẩn ở đây: mọi link trong thanh đều bị middleware đá ngược về trang này.
 */
export default async function LoginPage() {
  if (await needsSetup()) redirect('/builder/setup');
  return (
    <AuthScreen>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthScreen>
  );
}
