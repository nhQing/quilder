/**
 * RichText → văn bản thuần.
 *
 * ## Vì sao nó ở đây, không ở `lib/ai/tools.ts`
 *
 * Nó sống ở đó tới 26/08/2026, và `tools.ts` import `prisma`. Nên bất cứ ai muốn
 * chuyển RichText thành chuỗi — kể cả một hàm hoàn toàn thuần như `diffDocs` —
 * đều kéo theo cả Prisma client, và mất khả năng test không cần database.
 *
 * Đây là lần thứ tư cùng một khuôn trong repo này (xem `ai-css-allowlist.ts`,
 * `fixture-guard.ts`, `token-source.ts`). Luật rút ra: **một hàm thuần nằm cùng
 * file với `prisma` hay `server-only` thì không còn thuần trên thực tế.**
 *
 * `tools.ts` re-export lại, nên mọi chỗ đang import từ đó vẫn chạy nguyên.
 */

import type { InlineNode, RichText } from './types';

export function plainText(rich: RichText | undefined): string {
  if (!rich) return '';
  const walk = (nodes: InlineNode[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case 'text': return n.v;
          case 'br': return ' ';
          case 'counter': return `${n.to}${n.suffix ?? ''}`;
          // `bind` trả `fallback`: giá trị thật đến từ scope lúc render, mà ở đây
          // không có scope. Fallback là chữ tác giả đã gõ, tức xấp xỉ đúng nhất.
          case 'bind': return n.fallback;
          default: return walk(n.children);
        }
      })
      .join('');
  return walk(rich).replace(/\s+/g, ' ').trim();
}
