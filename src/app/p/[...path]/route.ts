import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

/**
 * Tài nguyên tĩnh của gói dự án: `projects/<QUILDER_PROJECT>/public/**` ở `/p/**`.
 *
 * Next chỉ phục vụ `public/` của gốc repo. Route này thay cho bước chép file của gói vào
 * `public/` lúc build — một bước dễ quên, và chép rồi thì `public/` lẫn đồ của khách hàng.
 * Font và ảnh của gói (`/p/fonts/gilroy.otf`) được CSS của gói trỏ tới.
 *
 * Chặn thoát thư mục: đường dẫn đã resolve phải nằm TRONG thư mục public của gói.
 */
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const name = process.env.QUILDER_PROJECT?.trim();
  if (!name || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) return new Response('Not found', { status: 404 });

  const root = resolve(process.cwd(), 'projects', name, 'public');
  const { path } = await params;
  const file = resolve(root, ...path);
  if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 });

  const type = MIME[extname(file).toLowerCase()];
  if (!type) return new Response('Not found', { status: 404 });

  try {
    if (!(await stat(file)).isFile()) return new Response('Not found', { status: 404 });
    const body = await readFile(file);
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': type,
        // Một ngày, không `immutable`: tên file của gói không mang hash, nên đổi file ở lần
        // deploy sau phải được trình duyệt lấy lại trong vòng một ngày.
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
