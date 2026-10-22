/**
 * Dựng ảnh chụp cho một `Release`.
 *
 * Hàm THUẦN — không `server-only`, không prisma. Lý do: vitest ở dự án này không
 * có Postgres, nên logic phải ở đây để test được, và route publish chỉ còn phần
 * truy vấn. Cùng khuôn với `translations.ts` và `components.ts`, nơi phần đọc ảnh
 * chụp cũng là hàm thuần.
 */

/** Đúng những cột `assetSnapshot` cần. Khớp `select` trong route publish. */
export interface AssetRow {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  mime: string;
}

/**
 * Đúng những gì `NodeRenderer` đọc từ một asset — xem `AssetInfo` ở đó.
 *
 * Cố ý KHÔNG chụp `kind`, `bytes`, `key`: render không đọc chúng. Chụp thêm là
 * mời người sau tưởng chúng có tác dụng lúc render, rồi dựa vào một field mà ảnh
 * chụp của release cũ không có.
 */
export interface AssetSeal {
  url: string;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  mime: string;
}

/**
 * Token tự tạo → map phẳng `name → value`.
 *
 * Không chụp `category`/`group`/`aiDescription`: render chỉ cần phát
 * `--name: value`. Những field kia phục vụ builder, và builder đọc bảng live.
 *
 * Bỏ tiền tố `--` để `tokenCssFromSeal` không bao giờ phát `----x`. Quy ước trong
 * schema là tên KHÔNG có `--`, nhưng dữ liệu vào được qua seed, qua prisma studio,
 * qua script — nên chuẩn hoá ở chặng này thay vì tin vào quy ước.
 */
export function tokenSnapshot(rows: { name: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.name.replace(/^--/, ''), r.value]));
}

/**
 * Metadata asset → map `assetId → AssetSeal`.
 *
 * Chụp METADATA, không chụp file. Điều đó chỉ đúng khi `Asset.key` là bất biến —
 * xem `src/lib/assets/key.ts`. Ghi đè key là làm mọi release cũ trỏ tới một file
 * đã đổi nội dung, tức lùi release sẽ lùi bố cục, chữ, token, CSS, nhưng ảnh thì
 * không: người soát thấy một trang gần đúng và không có gì chỉ ra chỗ sai.
 *
 * Chụp MỌI asset, không chỉ asset đang được dùng — cùng lý do như
 * `Release.components`: một ảnh có thể được thêm vào ở bản nháp giữa hai lần
 * publish, và ảnh chụp phải phục vụ được cả lần lùi bản về đây.
 */
export function assetSnapshot(rows: AssetRow[]): Record<string, AssetSeal> {
  return Object.fromEntries(
    rows.map((a) => [
      a.id,
      { url: a.url, width: a.width, height: a.height, blurhash: a.blurhash, mime: a.mime },
    ]),
  );
}
