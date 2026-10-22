import { NextResponse } from 'next/server';

/**
 * Phục vụ bó CSS tĩnh đã niêm phong của một release.
 *
 * ## Vì sao là một route chứ không phải `<style>` inline
 *
 * Bản đầu của Đợt 1 phát bó bằng `<style>` trong layout. Đo xong thì thấy RSC
 * payload serialize lại nội dung prop, nên 129 KB CSS đi xuống HAI lần và trang
 * chủ phình từ 336 KB lên 735 KB. Một route trả về cùng chuỗi đó gửi nó MỘT lần,
 * và cho thêm cache.
 *
 * ## Vì sao hash nằm trong URL
 *
 * Vì nó cho phép `immutable`. Nội dung của URL này không bao giờ đổi — nếu CSS
 * đổi thì hash đổi, tức URL đổi. Đó là cùng kỹ thuật `/_next/static` dùng, và là
 * lý do khoá chính của `StyleBundle` là hash.
 *
 * ## Vì sao đường dẫn có `.css`
 *
 * `src/middleware.ts` khai `matcher` loại trừ mọi đường dẫn có dấu chấm
 * (`.*\..*`), nên request này không đi qua middleware i18n. Không có đuôi `.css`
 * thì middleware sẽ cố tách locale từ một chuỗi hash 64 ký tự.
 */

import { styleBundleByHash } from '@/lib/render/style-bundle';

/** Hash sha256 hex. Chặn ở đây để không mang chuỗi tuỳ ý xuống truy vấn. */
const FILE_RE = /^([0-9a-f]{64})\.css$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const match = FILE_RE.exec(file);
  if (!match) return new NextResponse('Not found', { status: 404 });

  const css = await styleBundleByHash(match[1]!);
  if (css === null) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      // An toàn vì URL đã mang hash của nội dung: một URL luôn trả cùng byte.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
