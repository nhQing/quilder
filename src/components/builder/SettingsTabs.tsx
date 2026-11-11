/**
 * Hai tab của khu Cài đặt: cài đặt chung ↔ font (theo mẫu `AccountTabs`).
 *
 * Font là cấu hình của site, ngang hàng với ngôn ngữ và biến, nên ở Cài đặt chứ không ở
 * Kho tài nguyên: nó có token đi kèm và đi theo release, ảnh thì không.
 */

import { LinkTabs } from './ui/Tabs';

export function SettingsTabs({ current }: { current: 'general' | 'fonts' }) {
  return (
    <LinkTabs
      label="Mục trong Cài đặt"
      value={current}
      className="self-start"
      items={[
        { id: 'general', href: '/builder/settings', label: 'Chung', data: { 'data-settings-tab': 'general' } },
        { id: 'fonts', href: '/builder/settings/fonts', label: 'Font', data: { 'data-settings-tab': 'fonts' } },
      ]}
    />
  );
}
