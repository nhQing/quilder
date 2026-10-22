/**
 * RichDoc → React. Cùng khuôn `richtext.tsx`, thêm một tầng khối.
 *
 * ## Vì sao KHÔNG có `'use client'` ở đây
 *
 * File này có HAI chỗ gọi và chúng nằm hai bên biên server/client: route xem
 * trước cả trang là RSC, còn cột xem cạnh trong `EntryForm` là client. Một
 * `'use client'` ở đây kéo cả bộ render sang bundle của trình duyệt cho cả hai
 * chỗ; một `import 'server-only'` thì làm chỗ thứ hai không build được. Nên: KHÔNG
 * chỉ thị nào, không hook, không state — chỉ hàm nhận props trả JSX, thứ chạy được
 * ở cả hai phía.
 *
 * ## Vì sao không có `dangerouslySetInnerHTML`, và không có class Tailwind
 *
 * Không HTML thô: cả kiến trúc `RichDoc` tồn tại để trang không bao giờ nhận một
 * chuỗi HTML do người/AI nhập (xem `zRichDoc`), và repo này không có thư viện
 * sanitize nào. JSX thì React tự escape.
 *
 * Không class Tailwind: `builder.css` khoá `@source` vào `src/app/(builder)` và
 * `src/components/builder` (xem ghi chú trong file đó), nên một class viết ở
 * `src/lib/render` sẽ KHÔNG được sinh ra — nó chạy đúng ở dev nếu class đó tình cờ
 * đã tồn tại chỗ khác, rồi biến mất im lặng. Kiểu dáng của khối đến từ
 * `typography.css` của site qua selector cấp element; ba chỗ inline style dưới đây
 * là ngoại lệ được ghi lý do tại chỗ.
 */

import type { AssetInfo } from './NodeRenderer';
import type { BindingScope } from './bindings';
import type { Block, RichDoc, RichText } from '@/lib/doc/types';
import { RichTextView, plainText } from './richtext';

/**
 * Không có nguồn binding nào cho nội dung entry ở v1.
 *
 * `bind` trong một entry trỏ tới `site`/`page` của TRANG chứa nó, mà một entry
 * chưa có trang chi tiết thật (mốc 3). Scope rỗng nghĩa là `formatBinding` trả
 * `fallback` — đúng thứ tác giả đã gõ — chứ không phải chuỗi trống.
 */
const EMPTY_SCOPE: BindingScope = { site: {}, page: {} };

/** Text thuần của cả tài liệu. Dùng cho trần độ dài và cho đếm chữ. */
export function plainDoc(doc: RichDoc): string {
  const parts: string[] = [];
  for (const b of doc) {
    switch (b.b) {
      case 'p':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'quote':
        parts.push(plainText(b.children));
        break;
      case 'ul':
      case 'ol':
        for (const it of b.items) parts.push(plainText(it.children));
        break;
      case 'figure':
        // `alt` được đếm cùng vì nó LÀ chữ tác giả gõ và nó vào trang (a11y, SEO).
        // Bỏ nó khỏi phép đếm nghĩa là một trần "2000 ký tự" không chặn được một
        // tài liệu có ba mươi ảnh, mỗi ảnh một câu alt dài.
        parts.push(b.alt);
        if (b.caption) parts.push(plainText(b.caption));
        break;
      case 'hr':
        break;
    }
  }
  // Ngăn cách bằng khoảng trắng, không dán liền: nối "…tháng 8" với "Chi tiết…"
  // thành một từ sẽ làm số ký tự đúng nhưng số TỪ sai, và thanh trạng thái của ô
  // soạn đọc chính hàm này.
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Mọi `assetId` tài liệu tham chiếu — chỗ gọi dùng nó để nạp `assets` một lượt. */
export function collectDocAssetIds(doc: RichDoc): string[] {
  const ids = new Set<string>();
  for (const b of doc) if (b.b === 'figure') ids.add(b.assetId);
  return [...ids];
}

function Inline({ value, scope, id }: { value: RichText; scope: BindingScope; id: string }) {
  return <RichTextView value={value} scope={scope} id={id} />;
}

export function BlockView({
  block,
  assets,
  scope = EMPTY_SCOPE,
  id,
}: {
  block: Block;
  assets: Record<string, AssetInfo>;
  scope?: BindingScope;
  id: string;
}) {
  switch (block.b) {
    case 'p':
      return <p><Inline value={block.children} scope={scope} id={id} /></p>;

    case 'h2':
      return <h2><Inline value={block.children} scope={scope} id={id} /></h2>;

    case 'h3':
      return <h3><Inline value={block.children} scope={scope} id={id} /></h3>;

    case 'h4':
      return <h4><Inline value={block.children} scope={scope} id={id} /></h4>;

    case 'ul':
    case 'ol': {
      const items = block.items.map((it, i) => (
        <li key={`${id}.${i}`}>
          <Inline value={it.children} scope={scope} id={`${id}.${i}`} />
        </li>
      ));
      return block.b === 'ul' ? <ul>{items}</ul> : <ol>{items}</ol>;
    }

    case 'quote':
      return <blockquote><Inline value={block.children} scope={scope} id={id} /></blockquote>;

    case 'figure': {
      const asset = assets[block.assetId];
      // Asset đã bị xoá khỏi kho: hiện một chỗ trống CÓ CHỮ thay vì không hiện gì.
      // Trả `null` như `ImageNode` làm là đúng cho trang công khai, nhưng đây là màn
      // xem trước của người biên tập — và thứ họ cần biết chính là "ảnh này mất".
      if (!asset) {
        return (
          <figure>
            <p>[Ảnh không còn trong kho: {block.assetId}]</p>
            {block.caption && block.caption.length > 0 && (
              <figcaption><Inline value={block.caption} scope={scope} id={`${id}.cap`} /></figcaption>
            )}
          </figure>
        );
      }

      return (
        <figure>
          {/*
            `<img>` chứ không `next/image`, và inline style chứ không class:

            (1) Bản xem trước không bao giờ được index và không có ngân sách LCP,
                nên trình tối ưu ảnh không mang lại gì ở đây.
            (2) `next/image` thiếu số đo phải dùng `fill`, và `fill` đòi một cha có
                `position` — tức file này sẽ phải mang kiểu dáng của chính nó, mà nó
                không có đường phát class nào (xem đầu file).
            (3) `max-width:100%` phải luôn đúng: cột xem cạnh trong form hẹp hơn ảnh
                gốc, và ở đó không có stylesheet nào của site để đỡ.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.url}
            alt={block.decorative ? '' : block.alt}
            width={asset.width ?? undefined}
            height={asset.height ?? undefined}
            loading="lazy"
            decoding="async"
            style={{ maxWidth: '100%', height: 'auto' }}
            {...(block.decorative ? { 'aria-hidden': true } : {})}
          />
          {block.caption && block.caption.length > 0 && (
            <figcaption><Inline value={block.caption} scope={scope} id={`${id}.cap`} /></figcaption>
          )}
        </figure>
      );
    }

    case 'hr':
      return <hr />;
  }
}

export function RichDocView({
  value,
  assets,
  scope,
  id,
}: {
  value: RichDoc;
  assets: Record<string, AssetInfo>;
  scope?: BindingScope;
  id: string;
}) {
  return (
    <>
      {value.map((block, i) => (
        <BlockView key={`${id}.${i}`} block={block} assets={assets} scope={scope} id={`${id}.${i}`} />
      ))}
    </>
  );
}
