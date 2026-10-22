import { notFound } from 'next/navigation';

import { setupStatus } from '@/lib/setup/status';
import { SetupSteps } from './SetupSteps';

export const dynamic = 'force-dynamic';

/**
 * Cài đặt site lần đầu: kiểm hệ thống → thông tin site → tài khoản admin.
 *
 * Middleware cho đường dẫn này qua (như `/builder/login`), vì nó chạy trên Edge và
 * không đọc được database. Trang này thì đọc được: đã có tài khoản là trả 404 — site
 * đã cài thì màn cài đặt KHÔNG tồn tại, không chỉ "không dùng được" (user chốt
 * 21/10/2026). Phép chặn thật vẫn nằm ở `POST /api/auth/setup` (bảng `User` rỗng, mã
 * cài đặt ở production).
 *
 * Không dùng `AuthScreen` (ô thương hiệu + thẻ form hẹp của màn đăng nhập): ba box
 * và cột progress cần bề ngang, và một site vừa cài chưa có thương hiệu nào để bày.
 */
export default async function SetupPage() {
  const status = await setupStatus();
  if (status.installed) notFound();
  return <SetupSteps initialStatus={status} />;
}
