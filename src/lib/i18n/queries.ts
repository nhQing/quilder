import 'server-only';

/**
 * Đọc ngôn ngữ và bản dịch.
 *
 * Tách khỏi `render/page.ts` vì hai thứ có nhịp invalidate khác nhau: doc đổi mỗi
 * lần publish, còn danh sách ngôn ngữ gần như không đổi. Gộp chúng vào một cache
 * nghĩa là thêm một ngôn ngữ sẽ phải chờ tag 'release' — hoặc ngược lại, mỗi lần
 * publish sẽ nạp lại một bảng ba dòng.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';
import type { LocaleInfo } from './locale';

export const LOCALES_TAG = 'locales';

/**
 * Ngôn ngữ ĐANG BẬT, mặc định lên trước.
 *
 * Chỉ ngôn ngữ đã bật: một ngôn ngữ mới dịch 30% mà đã có URL công khai là công
 * bố một trang nửa vời, và fallback về tiếng Việt sẽ trông như lỗi.
 */
export const getLocales = unstable_cache(
  async (): Promise<LocaleInfo[]> =>
    prisma.locale.findMany({
      where: { enabled: true },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      select: { code: true, label: true, isDefault: true },
    }),
  ['locales'],
  { tags: [LOCALES_TAG], revalidate: 3600 },
);

/** Mọi ngôn ngữ, kể cả chưa bật — cho trang quản trị. */
export async function listAllLocales() {
  return prisma.locale.findMany({
    orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    select: { code: true, label: true, isDefault: true, enabled: true },
  });
}

export interface DraftTranslation {
  nodeId: string;
  field: string;
  value: unknown;
  sourceHash: string;
  updatedAt: Date;
  updatedBy: string;
}

/**
 * Bản dịch NHÁP của một trang.
 *
 * KHÔNG bọc `unstable_cache`, cùng lý do như `builder/queries.ts`: builder phải
 * thấy ngay thứ vừa lưu. Site thật không đi qua đây — nó đọc ảnh chụp trong
 * `Release.translations`.
 */
export async function listDraftTranslations(
  pageId: string,
): Promise<Record<string, DraftTranslation[]>> {
  const rows = await prisma.translation.findMany({
    where: { pageId },
    select: {
      locale: true, nodeId: true, field: true, value: true,
      sourceHash: true, updatedAt: true, updatedBy: true,
    },
  });

  const byLocale: Record<string, DraftTranslation[]> = {};
  for (const r of rows) {
    (byLocale[r.locale] ??= []).push(r);
  }
  return byLocale;
}
