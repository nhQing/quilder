import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

/**
 * Phục vụ file font của kho, CÙNG ORIGIN với trang.
 *
 * ## Vì sao không để trình duyệt tải thẳng từ S3
 *
 * `@font-face` tải font là yêu cầu CORS; kho ảnh không cấu hình CORS cho mọi origin
 * (builder, site, localhost). Đi qua origin của trang thì không cần CORS và không
 * lộ địa chỉ kho.
 *
 * ## Công khai, không đăng nhập
 *
 * Giống ảnh của site: khách vãng lai phải tải được font. `src/middleware.ts` loại trừ
 * mọi đường dẫn có dấu chấm khỏi `matcher` (đuôi `.woff2`), nên request này không đi
 * qua middleware — không cần thêm ngoại lệ, và nó mở như nhau ở host site lẫn builder.
 *
 * ## Chỉ nhận khoá do service font ghi
 *
 * Khoá phải bắt đầu `public/`, đuôi font, không `..`, `.`, đoạn rỗng hay `\`. Mọi thứ
 * khác là 404 mà không chạm tới kho, để route này không thành cổng đọc object tuỳ ý.
 *
 * ## ETag
 *
 * Khoá có hash nội dung nên một khoá luôn trả cùng byte; ETag suy từ khoá, khỏi gọi
 * thêm `HeadObject`.
 */

import { getObject } from '@/lib/assets/s3';
import { FONT_CACHE_CONTROL, isServableFontKey } from '@/lib/fonts/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

const notFound = () => new NextResponse('Not found', { status: 404 });

/** Object không có trong kho (lỗi "bình thường", không cần log). */
function isMissingObject(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;
}

function validKey(segments: string[]): { key: string; ext: string } | null {
  // Next giải mã %2f trong từng đoạn, nên một đoạn có thể mang cả `/`: kiểm trên khoá đã nối.
  if (segments.some((s) => s.includes('/') || s.includes('\\'))) return null;
  const key = segments.join('/');
  if (!isServableFontKey(key)) return null;
  return { key, ext: key.slice(key.lastIndexOf('.') + 1) };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const valid = validKey(segments);
  if (!valid) return notFound();

  const etag = `"${createHash('sha1').update(valid.key).digest('hex')}"`;
  const headers = {
    etag,
    'cache-control': FONT_CACHE_CONTROL,
    'content-type': MIME[valid.ext]!,
    // Byte trong kho do người dùng tải lên: cấm trình duyệt đoán lại kiểu (vd. thành HTML).
    'x-content-type-options': 'nosniff',
  };

  const inm = request.headers.get('if-none-match');
  if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
    return new NextResponse(null, { status: 304, headers: { etag, 'cache-control': FONT_CACHE_CONTROL } });
  }

  let bytes: Uint8Array;
  try {
    bytes = await getObject(valid.key);
  } catch (e) {
    // Khách vẫn chỉ thấy 404 (không lộ chi tiết kho), nhưng kho sập / sai quyền / sai cấu hình
    // phải để lại dấu vết: không log thì mọi font của site "mất" mà không có gì chỉ ra vì sao.
    if (!isMissingObject(e)) console.error(`[mm-font] đọc ${valid.key} lỗi:`, e);
    return notFound();
  }
  return new NextResponse(Buffer.from(bytes), {
    headers: { ...headers, 'content-length': String(bytes.length) },
  });
}
