/**
 * Phần THUẦN của `origin.ts` — tách ra để client (màn cài đặt, Cài đặt) kiểm URL
 * bằng đúng luật server dùng, và để test không cần Prisma.
 */

export type OriginSource = 'env' | 'db' | 'fallback';

export const FALLBACK_ORIGIN = 'http://localhost:3001';

/**
 * URL site hợp lệ → origin chuẩn (`https://vd.com`, không `/` cuối). Sai → `null`.
 *
 * Chỉ nhận ORIGIN: có path, query hay hash là lỗi chứ không lặng lẽ cắt đi. Người
 * gõ `https://vd.com/vi` đang nghĩ site nằm dưới `/vi`, và cắt mất `/vi` là cho họ
 * một canonical khác thứ họ tưởng.
 */
export function normalizeSiteUrl(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
  return url.origin;
}

export function resolveOrigin(
  envValue: string | null | undefined,
  dbValue: string | null | undefined,
): { origin: string; source: OriginSource } {
  const fromEnv = envValue?.trim();
  if (fromEnv) return { origin: fromEnv.replace(/\/+$/, ''), source: 'env' };
  const fromDb = normalizeSiteUrl(dbValue);
  if (fromDb) return { origin: fromDb, source: 'db' };
  return { origin: FALLBACK_ORIGIN, source: 'fallback' };
}
