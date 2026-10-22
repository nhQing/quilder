/**
 * Hai tab của khu Tài khoản: danh sách người dùng ↔ các máy đã nối Claude.
 *
 * Trước 16/10/2026 "Kết nối Claude" là một nút trên đầu trang Tài khoản — dễ bị bỏ qua, và
 * nó KHÔNG phải một hành động trên danh sách người dùng như "Thêm tài khoản" bên cạnh. Token
 * là quyền truy cập đứng tên một tài khoản, nên nó ở cùng khu, ngang hàng với danh sách
 * người — chứ không ở Cài đặt (cấu hình của site, không phải của người).
 */

import { LinkTabs } from './ui/Tabs';

export function AccountTabs({ current }: { current: 'users' | 'tokens' }) {
  return (
    <LinkTabs
      label="Mục trong Tài khoản"
      value={current}
      className="self-start"
      items={[
        { id: 'users', href: '/builder/admin', label: 'Người dùng', data: { 'data-account-tab': 'users' } },
        { id: 'tokens', href: '/builder/admin/tokens', label: 'Kết nối Claude', data: { 'data-account-tab': 'tokens' } },
      ]}
    />
  );
}
