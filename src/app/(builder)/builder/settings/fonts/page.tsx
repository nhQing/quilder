import { redirect } from 'next/navigation';

import { can } from '@/lib/auth/session';
import { getSession } from '@/lib/auth/guard';
import { builtinFontFaceCss } from '@/lib/fonts/builtin';
import { listFonts } from '@/lib/fonts/service';
import { draftFontFaceCss } from '@/lib/fonts/seal';
import { SettingsTabs } from '@/components/builder/SettingsTabs';
import { FontList } from '@/components/builder/fonts/FontList';
import { PageHeader, PageShell } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cài đặt › Font: mọi tài khoản mở được; nút thao tác ẩn hoặc hiện theo quyền (§11.1).
 *
 * Builder không nạp `tokens.css` hay `typography.css` của site, nên màn này tự in
 * `@font-face` của mọi họ — nếu không, chữ xem trước rơi về font hệ thống và người dùng
 * tưởng font tải lên hỏng.
 */
export default async function FontsPage() {
  const session = await getSession();
  if (!session) redirect('/builder/login?next=/builder/settings/fonts');

  const [fonts, draftCss] = await Promise.all([listFonts(), draftFontFaceCss()]);
  const css = [builtinFontFaceCss(), draftCss].filter(Boolean).join('\n');

  return (
    <PageShell>
      {css && (
        <style
          data-mm-fonts=""
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: css }}
        />
      )}
      <PageHeader title="Font" />
      <SettingsTabs current="fonts" />
      <FontList fonts={fonts} canWrite={can(session.role, 'write')} isAdmin={session.role === 'admin'} />
    </PageShell>
  );
}
