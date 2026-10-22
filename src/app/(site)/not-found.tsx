import Link from 'next/link';

import { getLocales } from '@/lib/i18n/queries';
import { getPublishedSystemPage } from '@/lib/render/page';
import { recentRedirects } from '@/lib/render/redirects';
import { PublishedPageView } from './PublishedPageView';

type Moved = Awaited<ReturnType<typeof recentRedirects>>;

/**
 * Trang 404.
 *
 * ## Hai nguồn, theo thứ tự
 *
 *  1. **Trang hệ thống trong DB** (`Page.system = 'not-found'`) nếu nó đã được
 *     publish — sửa bằng builder như mọi trang, dựng bằng `PublishedPageView` (cùng
 *     đường với catch-all). Có từ 20/10/2026.
 *  2. **Bản trong code** bên dưới, khi trang hệ thống chưa từng publish (site nâng cấp
 *     lên bản này mà chưa Publish lần nào) hoặc khi dựng nó lỗi. Trang 404 là chỗ cuối
 *     cùng người ta rơi vào; nó không được phép tự hỏng.
 *
 * ## Vì sao có bảng "địa chỉ đã đổi"
 *
 * Redirect 301 lo được những địa chỉ ta BIẾT đã đổi. Còn lại là những link cũ mà
 * không ai ghi lại: một URL gõ tay sai một chữ, một link từ bài báo cũ trỏ tới cấu
 * trúc đường dẫn của hai năm trước, một trang bị gỡ khỏi release. Với những ca đó
 * thì một trang 404 im lặng là ngõ cụt.
 *
 * Next KHÔNG truyền URL đang hỏng vào `not-found.tsx`, nên trang này không thể tự
 * đoán người ta muốn gì. Thứ nó làm được — và làm ở đây — là bày ra những địa chỉ
 * đã dời gần đây, để người vào từ một link cũ nhìn thấy đúng dòng của mình. Bảng
 * nằm DƯỚI trang hệ thống, ở cả hai nguồn: nó là dữ liệu live, không phải nội dung
 * người dựng trang phải nhớ chèn vào.
 *
 * Không có gì đã đổi thì không hiện bảng: một bảng rỗng kèm tiêu đề "Bạn đang tìm
 * trang nào?" là một câu hỏi không có câu trả lời.
 */
export default async function NotFound() {
  const moved = await recentRedirects();

  try {
    const page = await getPublishedSystemPage('not-found');
    if (page) {
      const locales = await getLocales();
      const def = locales.find((l) => l.isDefault);
      // Gọi như hàm, không như JSX: phần nạp dữ liệu chạy NGAY trong `try` này, nên
      // lỗi của nó rơi về bản code thay vì làm sập chính trang 404.
      const view = await PublishedPageView({
        target: { page, entry: null },
        locale: { isDefault: true, code: def?.code ?? 'vi' },
      });
      return (
        <>
          {view}
          {moved.length > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                paddingInline: 'var(--gutter)',
                paddingBlockEnd: 'var(--space-2xl)',
              }}
            >
              <MovedList moved={moved} />
            </div>
          )}
        </>
      );
    }
  } catch (err) {
    console.error('[not-found] không dựng được trang 404 hệ thống, dùng bản trong code:', err);
  }

  return <CodeNotFound moved={moved} />;
}

function CodeNotFound({ moved }: { moved: Moved }) {
  return (
    <main
      style={{
        minBlockSize: '60svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-s)',
        paddingInline: 'var(--gutter)',
        paddingBlock: 'var(--space-2xl)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-3)' }}>
        Không tìm thấy trang
      </h1>
      <p style={{ color: 'var(--color-ink-muted)', maxInlineSize: 'var(--measure)' }}>
        Đường dẫn này không tồn tại, hoặc trang chưa được publish.
      </p>

      {moved.length > 0 && <MovedList moved={moved} />}

      <Link href="/" style={{ marginBlockStart: 'var(--space-l)' }}>
        Về trang chủ
      </Link>
    </main>
  );
}

function MovedList({ moved }: { moved: Moved }) {
  return (
    <section style={{ marginBlockStart: 'var(--space-l)', inlineSize: '100%' }}>
      <h2
        style={{
          fontSize: 'var(--step-0)',
          color: 'var(--color-ink-muted)',
          marginBlockEnd: 'var(--space-xs)',
        }}
      >
        Bạn đang tìm trang nào?
      </h2>
      <p
        style={{
          color: 'var(--color-ink-muted)',
          fontSize: 'var(--step--1)',
          marginBlockEnd: 'var(--space-s)',
        }}
      >
        Những địa chỉ này đã đổi gần đây.
      </p>

      <ul
        style={{
          listStyle: 'none',
          margin: '0 auto',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2xs)',
          maxInlineSize: 'var(--measure)',
          textAlign: 'start',
        }}
      >
        {moved.map((r) => (
          <li
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2xs)',
              flexWrap: 'wrap',
            }}
          >
            {/* Địa chỉ cũ là chữ thường, KHÔNG phải link: nó 404, và một link
                404 trên chính trang 404 là một vòng tròn. */}
            <span
              style={{
                color: 'var(--color-ink-muted)',
                textDecoration: 'line-through',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              /{r.from}
            </span>
            <span aria-hidden style={{ color: 'var(--color-ink-muted)' }}>
              →
            </span>
            <Link href={`/${r.to}`}>/{r.to}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
