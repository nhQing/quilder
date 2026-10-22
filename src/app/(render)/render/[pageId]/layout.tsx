import { getSiteCrawlSettings } from '@/lib/site/settings';

/**
 * Layout riêng cho nội dung iframe.
 *
 * Cần tách khỏi layout builder vì đây là TRANG WEBSITE đang được xem trước, chứ
 * không phải vỏ công cụ — nó không được nạp Tailwind của builder, và `lang` phải
 * là của website.
 *
 * Theme đọc CÙNG nguồn với site thật (`Site.theme`): canvas khác theme với site là
 * canvas nói dối về thứ khách sẽ thấy.
 */
export default async function RenderLayout({ children }: { children: React.ReactNode }) {
  const { theme } = await getSiteCrawlSettings();
  return (
    <html lang="vi" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
