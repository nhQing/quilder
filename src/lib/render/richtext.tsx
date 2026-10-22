/**
 * RichText → React. Server component, không có 'use client'.
 *
 * Điểm quan trọng nhất: `split` render ra chữ ĐẦY ĐỦ kèm `aria-label`, và các
 * span con mang `aria-hidden`. Đây đúng mẫu mà text-split.js đang dùng ở site cũ —
 * screen reader đọc trọn câu, mắt thấy từng dòng chạy vào. Bỏ mẫu này là vừa hỏng
 * a11y vừa hỏng hiệu ứng.
 *
 * Và vì đây là RSC: chữ nằm sẵn trong HTML ban đầu. Site cũ chèn phần lớn nội dung
 * bằng js/core/render.js sau một fetch, nên crawler thấy markup rỗng. Đây là chỗ
 * cải thiện SEO thật, không phải lời hứa suông.
 */

import type { InlineNode, RichText } from '@/lib/doc/types';
import { formatBinding, type BindingScope } from './bindings';

/** Text thuần của một cây inline — dùng cho aria-label và cho <title>. */
export function plainText(rt: RichText): string {
  const walk = (nodes: InlineNode[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case 'text': return n.v;
          case 'br': return ' ';
          case 'counter': return String(n.to);
          case 'bind': return n.fallback;
          case 'em':
          case 'strong':
          case 'link':
          case 'split': return walk(n.children);
          default: return '';
        }
      })
      .join('');
  return walk(rt).replace(/\s+/g, ' ').trim();
}

function renderInline(
  nodes: InlineNode[],
  scope: BindingScope,
  keyPrefix: string,
): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}.${i}`;
    switch (n.t) {
      case 'text':
        return n.v;

      case 'br':
        return <br key={key} />;

      case 'em':
        return <em key={key}>{renderInline(n.children, scope, key)}</em>;

      case 'strong':
        return <strong key={key}>{renderInline(n.children, scope, key)}</strong>;

      case 'link': {
        const external = /^https?:\/\//i.test(n.href);
        return (
          <a
            key={key}
            href={n.href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {renderInline(n.children, scope, key)}
          </a>
        );
      }

      case 'counter':
        // counter.js đọc data-* và tự định dạng bằng Intl. Giá trị cuối được
        // render sẵn ở đây để không-JS và reduced-motion vẫn thấy con số đúng.
        return (
          <span
            key={key}
            data-counter=""
            data-counter-to={n.to}
            data-counter-decimals={n.decimals ?? 0}
          >
            {new Intl.NumberFormat('vi-VN', {
              minimumFractionDigits: n.decimals ?? 0,
              maximumFractionDigits: n.decimals ?? 0,
            }).format(n.to)}
            {n.suffix ?? ''}
          </span>
        );

      case 'bind':
        return <span key={key}>{formatBinding(n.ref, n.fallback, scope)}</span>;

      case 'split': {
        const label = plainText(n.children);
        return (
          <span key={key} data-split={n.mode} aria-label={label}>
            <span aria-hidden="true">{renderInline(n.children, scope, key)}</span>
          </span>
        );
      }

      default:
        return null;
    }
  });
}

export function RichTextView({
  value,
  scope,
  id,
}: {
  value: RichText;
  scope: BindingScope;
  id: string;
}) {
  return <>{renderInline(value, scope, id)}</>;
}
