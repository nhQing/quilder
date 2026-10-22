import 'server-only';

/**
 * Cửa sổ rollback: những release mà "lùi về là trang y như lúc publish" được ĐẢM BẢO.
 *
 * ## Vì sao cần một cửa sổ
 *
 * Release niêm phong doc, component, token, bản dịch — nhưng ảnh thì chỉ niêm phong
 * URL. Object S3 nằm ngoài DB, nên "Xoá hoàn toàn" một ảnh mà release cũ còn trỏ tới
 * là làm release đó vỡ ảnh khi lùi về. Giữ object mãi mãi thì thùng rác không dọn
 * được gì; xoá ngay thì lời hứa "rollback không bao giờ hỏng" có điều kiện.
 *
 * Cửa sổ là chỗ chốt giữa hai đầu đó: release trong cửa sổ được giữ object (bảng
 * `AssetHold`), release ngoài cửa sổ không còn được hứa. Màn Release ghi nhãn cho
 * release ngoài cửa sổ, và dialog Xoá hoàn toàn nói rõ release nào sẽ vỡ.
 *
 * ## Vì sao "30 bản HOẶC 90 ngày", không một trong hai
 *
 * Chỉ đếm số bản: một ngày publish dồn dập 30 lần là đẩy bản của tuần trước ra khỏi
 * cửa sổ. Chỉ đếm ngày: site ít publish thì bản gần nhất trước đó có thể đã quá 90
 * ngày, và lùi một bước cũng không được hứa. Hợp hai luật giữ được cả hai trường hợp.
 * Đo ngày 08/10/2026: 120 release, cũ nhất 11/08 — cả 120 đều trong cửa sổ, và dung
 * lượng ảnh giữ lại là phần nhỏ của kho.
 *
 * Release đang chạy luôn nằm trong cửa sổ, kể cả khi vừa lùi về một bản rất cũ: object
 * của nó là thứ site thật đang phục vụ.
 */

import { prisma } from '@/lib/db';

export const ROLLBACK_KEEP_RELEASES = 30;
export const ROLLBACK_KEEP_DAYS = 90;

const DAY_MS = 86_400_000;

/** Câu mô tả cửa sổ, dùng chung cho dialog, màn Release và tài liệu. */
export const ROLLBACK_WINDOW_TEXT =
  `${ROLLBACK_KEEP_RELEASES} release gần nhất và mọi release trong ${ROLLBACK_KEEP_DAYS} ngày`;

/** Thuần, để test: tập id release nằm trong cửa sổ. `releases` theo thứ tự bất kỳ. */
export function rollbackWindowIds(
  releases: ReadonlyArray<{ id: string; createdAt: Date }>,
  activeIds: ReadonlyArray<string | null | undefined>,
  now: Date = new Date(),
): Set<string> {
  const newestFirst = [...releases].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const since = now.getTime() - ROLLBACK_KEEP_DAYS * DAY_MS;
  const inside = new Set<string>();
  newestFirst.forEach((r, rank) => {
    if (rank < ROLLBACK_KEEP_RELEASES || r.createdAt.getTime() >= since) inside.add(r.id);
  });
  for (const id of activeIds) if (id) inside.add(id);
  return inside;
}

/** Cửa sổ hiện tại, đọc từ DB. Hai truy vấn nhỏ, không phụ thuộc số ảnh. */
export async function loadRollbackWindow(now: Date = new Date()): Promise<Set<string>> {
  const [releases, sites] = await Promise.all([
    prisma.release.findMany({ select: { id: true, createdAt: true } }),
    prisma.site.findMany({ select: { activeReleaseId: true } }),
  ]);
  return rollbackWindowIds(releases, sites.map((s) => s.activeReleaseId), now);
}
