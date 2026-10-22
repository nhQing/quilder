import 'server-only';

/**
 * Bó CSS tĩnh: ghi một lần lúc publish, đọc lúc render.
 *
 * Tách khỏi `static-css.ts` vì file này CHẠM DB và khai `server-only`, còn hàm
 * gộp là hàm thuần test được không cần Postgres — vitest ở dự án này không có DB.
 * Cùng lý do `release-snapshot.ts` tách khỏi route publish.
 */

import { readFileSync } from 'node:fs';

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';
import { projectFile } from '@/lib/project/files';
import { compileStaticCss, hashCss } from './static-css';

/**
 * Bó CSS của BẢN CODE ĐANG CHẠY, gộp một lần cho cả tiến trình.
 *
 * File tĩnh không đổi trong lúc chạy, nên đọc lại 15 file mỗi lượt publish là
 * việc không cần. Trong `next dev` thì tiến trình sống qua nhiều lần sửa file —
 * nghĩa là sửa `src/styles/` lúc dev sẽ KHÔNG phản ánh vào bó cho tới khi restart.
 * Đó là đánh đổi đúng: bó này chỉ dùng lúc publish và lúc phục vụ site, còn màn
 * bản nháp vẫn `import` CSS như thường nên vòng lặp dev không bị ảnh hưởng.
 */
/** Điểm vào CSS của gói dự án đang chạy, nếu gói có CSS. */
export function projectCssEntries(env: NodeJS.ProcessEnv = process.env): string[] {
  const entry = projectFile('styles/index.css', env);
  return entry ? [entry] : [];
}

let memo: { hash: string; css: string } | null = null;

export function currentStaticCss(): { hash: string; css: string } {
  if (memo) return memo;
  const css = compileStaticCss((p) => readFileSync(p, 'utf8'), projectCssEntries());
  memo = { hash: hashCss(css), css };
  return memo;
}

/**
 * Đảm bảo bó CSS hiện tại có trong DB, trả về hash của nó.
 *
 * `upsert` chứ không `create`: hầu hết lần publish KHÔNG đổi CSS, nên hàng đã có
 * sẵn. Và vì khoá chính LÀ hash, "đã có chưa" là một phép tra khoá chính thay vì
 * một truy vấn tìm trùng trên cột `css`.
 *
 * Nhận `tx` để gọi được trong `$transaction` của route publish: bó phải vào TRƯỚC
 * release, vì `Release.cssHash` là khoá ngoại.
 */
export async function upsertStyleBundle(
  tx: Pick<typeof prisma, 'styleBundle'>,
): Promise<string> {
  const { hash, css } = currentStaticCss();
  await tx.styleBundle.upsert({
    where: { hash },
    create: { hash, css, bytes: Buffer.byteLength(css, 'utf8') },
    update: {},
  });
  return hash;
}

/**
 * HASH của bó CSS mà release đang phục vụ, hoặc chuỗi rỗng.
 *
 * ## Vì sao trả hash chứ không trả CSS
 *
 * Bản đầu trả nguyên chuỗi CSS để layout phát `<style>`. Đo xong thì thấy đó là
 * một hồi quy hiệu năng thật: **RSC payload serialize lại nội dung của prop**, nên
 * 129 KB CSS đi xuống HAI lần — một lần trong HTML, một lần trong flight stream.
 * Trang chủ phình từ 336 KB lên 735 KB. Đã đo, không phải suy đoán.
 *
 * Hash thì chỉ 64 ký tự, và nó cho thêm hai thứ mà `<style>` không cho: trình
 * duyệt cache được vĩnh viễn (hash nằm trong URL nên không cần validate), và bó
 * dùng chung giữa các trang thay vì lặp lại trên từng trang.
 *
 * ## Vì sao trả rỗng thay vì ném
 *
 * Hai trường hợp, và chỗ gọi phải xử lý được cả hai bằng cách dùng hash của code
 * hiện tại: site chưa publish gì, hoặc release đang chạy là bản CŨ chưa có
 * `cssHash` (56 release tồn tại trước khi cột này ra đời). Ném ở đây là biến một
 * cuộc di trú dữ liệu thành một site trắng.
 */
export function getReleaseCssHash() {
  return unstable_cache(
    async (): Promise<string> => {
      const site = await prisma.site.findFirst({
        where: { activeReleaseId: { not: null } },
        select: { activeReleaseId: true },
      });
      if (!site?.activeReleaseId) return '';

      const release = await prisma.release.findUnique({
        where: { id: site.activeReleaseId },
        select: { cssHash: true },
      });
      return release?.cssHash ?? '';
    },
    ['release-css-hash'],
    // Cùng tag với `getPublishedPage`: publish và rollback đều đổi con trỏ, nên
    // bó CSS phải đổi theo trong cùng một nhịp invalidate.
    { tags: ['release'], revalidate: 3600 },
  )();
}

/**
 * Nội dung một bó theo hash — cho route phục vụ CSS.
 *
 * Ưu tiên bó của code đang chạy trước khi vào DB: đó là trường hợp thường (mọi
 * release publish từ bản code này đều trỏ tới nó), và nó tiết kiệm một lượt đọc DB
 * trên đường render-blocking.
 *
 * `null` nghĩa là không có bó nào mang hash đó — chỗ gọi phải trả 404, không phải
 * trả CSS rỗng. CSS rỗng là một trang trắng không có lý do; 404 thì hiện trong
 * network tab.
 */
export async function styleBundleByHash(hash: string): Promise<string | null> {
  const current = currentStaticCss();
  if (hash === current.hash) return current.css;

  const row = await prisma.styleBundle.findUnique({
    where: { hash },
    select: { css: true },
  });
  return row?.css ?? null;
}
