import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `robots.txt` và `sitemap.xml` phải được sinh LÚC CHẠY, không lúc build.
 *
 * ## Vì sao test này đọc FILE thay vì import module
 *
 * `sitemap.ts` import `prisma` ở đầu file. Import nó trong vitest kéo theo cả
 * client Prisma và `server-only`, cho một phép kiểm không liên quan gì tới DB.
 * Thứ cần khoá ở đây là một DÒNG KHAI BÁO, và dòng đó đọc được bằng mắt.
 *
 * ## Vì sao phải khoá
 *
 * Thiếu `force-dynamic`, Next sinh hai file này thành file tĩnh lúc build, và mọi
 * `process.env` trong chúng là env của MÁY BUILD. Chúng không chạm DB nên build
 * vẫn xanh, deploy vẫn xanh, và cái sai chỉ hiện ra khi có người mở
 * `/robots.txt` trên môi trường thật rồi đọc kỹ.
 *
 * Đã xảy ra thật: `sitemap.ts` có dòng này từ đầu, `robots.ts` thì không. Trên stg
 * ngày 11/09/2026, sitemap rỗng đúng theo `SITE_NOINDEX=true` trong khi robots.txt
 * vẫn `Allow: /` và khai `Sitemap: http://localhost:3001/sitemap.xml` — tức là mời
 * crawler vào một bản trùng của production. Bất đối xứng giữa hai file là bug, nên
 * test này nói về CẢ HAI chứ không riêng file vừa sửa.
 */
const ROUTES = ['robots.txt/route.ts', 'sitemap.ts'];

describe('route metadata đọc env lúc chạy', () => {
  for (const file of ROUTES) {
    it(`${file} khai force-dynamic`, () => {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src).toMatch(/^export const dynamic = 'force-dynamic';$/m);
    });
  }

  it('cả hai cùng lấy gốc từ siteOrigin() — một gốc, không hai', () => {
    // Hai file cùng dựng URL tuyệt đối. Lệch nhau ở đây nghĩa là `Sitemap:` trong
    // robots.txt trỏ một gốc khác với gốc trong chính sitemap.xml.
    for (const file of ROUTES) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src, file).toContain('await siteOrigin()');
    }
  });
});

/**
 * Không file nào ngoài `src/lib/site/` đọc thẳng `process.env.SITE_URL`.
 *
 * Từ 20/10/2026 gốc URL là env → `Site.siteUrl` → localhost (xem `origin.ts`). Một
 * chỗ đọc env trực tiếp sẽ bỏ qua DB, và site dựng bằng màn cài đặt (không có env)
 * sẽ có một chỗ trỏ localhost trong khi mọi chỗ khác trỏ đúng domain.
 */
describe('SITE_URL chỉ đọc ở một chỗ', () => {
  it('không đọc process.env.SITE_URL ngoài src/lib/site/', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
          const rel = relative(root, p).replace(/\\/g, '/');
          if (rel.startsWith('lib/site/')) continue;
          if (/process\.env\.SITE_URL\b/.test(readFileSync(p, 'utf8'))) offenders.push(rel);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
