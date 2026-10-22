/**
 * Khối `CustomCode`, render trên server.
 *
 * ## Vì sao là một server component async, không phải plumbing qua RenderContext
 *
 * `NodeRenderer` là hàm ĐỒNG BỘ và docblock của nó nói rõ vì sao: biến nó thành
 * async là biến mọi node trên trang thành một Promise — mười nghìn Promise cho
 * một trang, và mất khả năng suy luận về số truy vấn.
 *
 * Nhưng một component async được RENDER BỞI một component đồng bộ thì không phá
 * điều đó: chỉ node `CustomCode` mới sinh Promise, và khối này là loại node hiếm.
 * Đổi lại, allowlist không phải đi qua bốn đường render (`(site)`, `preview`,
 * `render`, và component preview) — mỗi đường một chỗ để quên.
 *
 * Truy vấn được `unstable_cache` gộp, nên mười khối trên một trang là một lượt đọc.
 */

import { buildSrcdoc } from '@/lib/render/custom-code';
import { CustomCodeFrame } from './CustomCodeFrame';
import { allowedEmbedOrigins } from '@/lib/render/embed-origins';
import type { Len } from '@/lib/doc/types';

/** `Len` → chuỗi CSS. Chỉ dùng cho chiều cao cố định của khối. */
function lenToCss(len: Len | undefined): string | undefined {
  if (!len) return undefined;
  if (typeof len === 'string') return len;
  const l = len as { v?: unknown; u?: unknown };
  return typeof l.v === 'number' && typeof l.u === 'string' ? `${l.v}${l.u}` : undefined;
}

export async function CustomCodeBlock({
  html,
  css,
  js,
  height,
  nodeId,
}: {
  html?: string;
  css?: string;
  js?: string;
  height?: Len;
  nodeId: string;
}) {
  const origins = await allowedEmbedOrigins();

  return (
    <CustomCodeFrame
      srcdoc={buildSrcdoc({ html, css, js }, { origins })}
      // Tiêu đề bắt buộc và phải có nghĩa: screen reader đọc iframe bằng `title`,
      // và "iframe" trần là một trong những thông báo vô dụng nhất nó phát ra.
      title={`Khối nội dung tuỳ chỉnh ${nodeId}`}
      fixedHeight={lenToCss(height)}
    />
  );
}
