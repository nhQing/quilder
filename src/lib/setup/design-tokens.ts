/**
 * src/styles/tokens.css → bảng Token. Lõi của `pnpm tokens:import`, tách ra ngày
 * 20/10/2026 để màn cài đặt gọi được mà không phải chạy script.
 *
 * File CSS là NGUỒN SỰ THẬT và không bao giờ bị ghi ngược. Bảng Token chỉ là chỉ
 * mục để: inspector dựng bộ chọn màu/spacing từ chính design system, và AI nhận được
 * capability catalog gọn thay vì phải đọc 50KB CSS.
 *
 * Phân loại theo tiền tố.
 *
 * ## Token tĩnh của gói dự án
 *
 * Gói đang bật (`QUILDER_PROJECT`) có `styles/tokens.css` thì khai báo `:root` trong đó
 * cũng là token TĨNH — CSS của gói khai chúng, nên không phát lại, và `deprecated` chỉ
 * xảy ra khi chúng vắng ở CẢ hai file. Dùng cho token cần `@media` (bảng Token chỉ giữ
 * một giá trị); token một giá trị của dự án thì nên là token tự tạo trong DB.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { rootTokens, themeOnlyNames, TOKENS_CSS } from '@/lib/design/token-source';
import { projectFile } from '@/lib/project/files';

export interface TokenImportResult {
  found: number;
  created: number;
  updated: number;
  kept: number;
  deprecated: number;
  /** Token chỉ có trong khối theme — bị bỏ qua. */
  themeOnly: string[];
  byCategory: Map<string, number>;
}

export function categorize(name: string): { category: string; group: string | null } {
  if (name.startsWith('color-') || name.startsWith('surface') || name.startsWith('ink')) {
    return { category: 'color', group: null };
  }
  if (name.startsWith('space') || name === 'gutter' || name === 'measure') {
    return { category: 'space', group: null };
  }
  if (name.startsWith('step')) return { category: 'typeScale', group: null };
  if (name.startsWith('font') || name.startsWith('weight')
    || name.startsWith('leading') || name.startsWith('tracking')) {
    return { category: 'typography', group: null };
  }
  if (name.startsWith('radius')) return { category: 'radius', group: null };
  if (name.startsWith('dur')) return { category: 'duration', group: null };
  if (name.startsWith('ease')) return { category: 'easing', group: null };
  if (name.startsWith('shadow')) return { category: 'shadow', group: null };
  if (name.startsWith('z-')) return { category: 'zIndex', group: null };
  return { category: 'other', group: null };
}

export async function importDesignTokens(prisma: PrismaClient): Promise<TokenImportResult> {
  const css = readFileSync(join(process.cwd(), TOKENS_CSS), 'utf8');

  /*
   * CHỈ khai báo trong `:root` — xem docblock của `rootTokens`.
   *
   * Bản trước dùng `root.walkDecls()` trên cả file, nên khối
   * `[data-theme="light"]` ở cuối `tokens.css` ghi đè 7 token màu và bảng `Token`
   * giữ giá trị theme SÁNG trong khi site render theme TỐI. Hỏng im lặng: tên
   * token vẫn hợp lệ, chỉ giá trị mà người và AI đọc là ngược.
   */
  const found = rootTokens(css);
  const themeOnly = themeOnlyNames(css);

  // Token tĩnh của gói dự án (xem docblock đầu file). Trùng tên lõi thì lõi thắng: gói đè
  // GIÁ TRỊ bằng CSS của nó (nạp sau), không cần chiếm hàng trong bảng.
  const packTokens = projectFile('styles/tokens.css');
  if (packTokens) {
    for (const [name, decl] of rootTokens(readFileSync(join(process.cwd(), packTokens), 'utf8'))) {
      if (!found.has(name)) found.set(name, decl);
    }
  }

  let created = 0;
  let updated = 0;
  let kept = 0;

  for (const [name, { value, comment }] of found) {
    const { category, group } = categorize(name);
    const existing = await prisma.token.findUnique({ where: { name } });

    /*
     * Token đã bị SỬA trong builder thì giữ nguyên `value`.
     *
     * `baseValue != null` nghĩa là có người đặt màu này ở màn Cài đặt. Đồng bộ
     * `value` từ file CSS ở đây sẽ lặng lẽ xoá lựa chọn đó — không lỗi, không hỏi,
     * và người ta chỉ phát hiện khi mở site lên thấy màu cũ quay lại.
     *
     * Metadata thì VẪN đồng bộ: `category`, `group` và mô tả cho AI đến từ file
     * CSS, không phải từ người dùng, nên đóng băng chúng chỉ làm catalogue nói sai.
     *
     * `baseValue` cũng được cập nhật theo file: nó là "giá trị gốc trong
     * tokens.css", nên khi file đổi thì đích của nút "về mặc định" phải đổi theo.
     */
    const frozen = existing?.baseValue != null;
    await prisma.token.upsert({
      where: { name },
      create: { name, value, category, group, aiDescription: comment },
      update: frozen
        ? { category, group, aiDescription: comment, baseValue: value }
        : { value, category, group, aiDescription: comment },
    });

    if (!existing) created += 1;
    else if (frozen) kept += 1;
    else updated += 1;
  }

  /*
   * Token biến mất khỏi CSS thì đánh dấu deprecated chứ KHÔNG xoá — doc cũ vẫn
   * đang tham chiếu tới chúng, và xoá đi là làm hỏng rollback về bản cũ.
   *
   * `custom: false` là điều kiện BẮT BUỘC, không phải tối ưu. Token tự tạo chưa
   * từng nằm trong `tokens.css` và không bao giờ nằm, nên nếu không loại chúng ra
   * thì mọi lần chạy đánh dấu deprecated TOÀN BỘ token người dùng tạo —
   * `custom-tokens.ts` lọc theo `deprecated: false`, nên khai báo `:root` của
   * chúng biến mất và mọi màu dùng chúng cũng biến mất, không một dòng lỗi.
   */
  const stale = await prisma.token.updateMany({
    where: { name: { notIn: [...found.keys()] }, deprecated: false, custom: false },
    data: { deprecated: true },
  });

  const byCategory = new Map<string, number>();
  for (const name of found.keys()) {
    const c = categorize(name).category;
    byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
  }

  return { found: found.size, created, updated, kept, deprecated: stale.count, themeOnly, byCategory };
}

/**
 * Cho màn cài đặt: chỉ nhập khi bảng Token còn RỖNG. Site đã có token thì việc
 * đồng bộ với `tokens.css` là của `pnpm tokens:import` / bootstrap, không phải của
 * một lần bấm "Cài đặt".
 */
export async function ensureDesignTokens(prisma: PrismaClient): Promise<number> {
  if ((await prisma.token.count()) > 0) return 0;
  return (await importDesignTokens(prisma)).created;
}
