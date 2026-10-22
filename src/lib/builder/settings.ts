import { prisma } from '@/lib/db';

/**
 * Dữ liệu cho trang Cài đặt chung.
 *
 * ## Không còn token ở đây
 *
 * Từ 03/09 tới 13/10/2026 màn này cho sửa 12 token "Nền tảng" (lý do gỡ ở
 * `lib/design/foundations.ts`) và có bảng tra "Toàn bộ biến" — cũng gỡ cùng ngày
 * theo lựa chọn của chủ dự án: bảng chỉ đọc, không ai tra, và bộ chọn màu của
 * inspector lẫn `search_tokens` của MCP đọc thẳng bảng `Token` chứ không qua đây.
 * Thứ còn lại ở màn này: `Site.globals` (chờ Publish), ngôn ngữ, favicon/logo.
 */

export interface LocaleRow {
  code: string;
  label: string;
  isDefault: boolean;
  enabled: boolean;
  /** Số chuỗi đã dịch — con số duy nhất nói ngôn ngữ này thật sự dùng được chưa. */
  translated: number;
  /** Số bài viết có bản dịch ngôn ngữ này — xoá ngôn ngữ là mất chúng. */
  entries: number;
}

/**
 * File đang gắn, đủ để ô xem trước vẽ nó mà không tra kho.
 *
 * Phải có `mime` và `key`, không chỉ `url`: thiếu mime thì ô không biết đây là ảnh và
 * vẽ một tờ giấy xám — xem `KnownAsset` ở `AssetPickerBox`.
 */
export interface FilePreview {
  url: string;
  mime: string;
  key: string;
}

export interface SettingsData {
  site: {
    name: string;
    primaryDomain: string;
    globals: Record<string, unknown>;
    faviconAssetId: string | null;
    /** File của favicon đang đặt, để màn hình hiện ảnh thay vì hiện một cuid. */
    faviconFile: FilePreview | null;
    ogImageId: string | null;
    ogImageFile: FilePreview | null;
    /**
     * Kích thước ảnh chia sẻ.
     *
     * Đi kèm URL vì màn Cài đặt cảnh báo cỡ và tỉ lệ NGAY — dưới 200×200 bị
     * Facebook bỏ qua, lệch tỉ lệ 1200×630 thì bị cắt. Không có hai số này thì
     * cảnh báo phải chờ một lượt đọc kho ảnh ở client.
     */
    ogImageSize: { width: number | null; height: number | null } | null;
    /** Nhận diện của chính builder — xem `lib/builder/branding.ts`. */
    builderLogoAssetId: string | null;
    builderLogoFile: FilePreview | null;
    builderFaviconAssetId: string | null;
    builderFaviconFile: FilePreview | null;
    builderFaviconUseSite: boolean;
  };
  locales: LocaleRow[];
  /**
   * Số token trong bảng — chỉ để cảnh báo khi bảng RỖNG: site vẫn đúng màu (CSS
   * nằm trong bundle) nhưng bộ chọn màu và `search_tokens` của MCP mù hẳn.
   */
  tokenCount: number;
}

/**
 * Bản rút gọn cho trang chủ: ngôn ngữ + số biến tự tạo.
 *
 * Không dùng `loadSettings()` ở đó — nó đọc cả favicon, globals, bản dịch, và
 * trang chủ là trang mở nhiều nhất.
 */
export interface SettingsSummary {
  defaultLocale: string | null;
  localeCount: number;
  customCount: number;
}

export async function loadSettingsSummary(): Promise<SettingsSummary> {
  const [locales, customCount] = await Promise.all([
    prisma.locale.findMany({ select: { code: true, label: true, isDefault: true } }),
    prisma.token.count({ where: { deprecated: false, custom: true } }),
  ]);

  const def = locales.find((l) => l.isDefault);

  return {
    defaultLocale: def ? `${def.label} (${def.code})` : null,
    localeCount: locales.length,
    customCount,
  };
}

export async function loadSettings(): Promise<SettingsData> {
  const [site, locales, tokenCount, counts, entryCounts] = await Promise.all([
    prisma.site.findFirst({
      select: {
        name: true, primaryDomain: true, globals: true,
        faviconAssetId: true, ogImageId: true,
        builderLogoAssetId: true, builderFaviconAssetId: true, builderFaviconUseSite: true,
      },
    }),
    prisma.locale.findMany({ orderBy: [{ isDefault: 'desc' }, { code: 'asc' }] }),
    prisma.token.count({ where: { deprecated: false } }),
    prisma.translation.groupBy({ by: ['locale'], _count: true }),
    prisma.entryLocale.groupBy({ by: ['locale'], _count: true }),
  ]);

  /*
   * Truy vấn phụ, sau `Promise.all`: nó phụ thuộc kết quả của truy vấn kia, và một
   * `include` không dùng được vì cột `faviconAssetId` cố ý KHÔNG có khoá ngoại —
   * xem migration `site_favicon`.
   */
  const iconIds = [
    site?.faviconAssetId,
    site?.ogImageId,
    site?.builderLogoAssetId,
    site?.builderFaviconAssetId,
  ].filter((v): v is string => Boolean(v));
  // MỘT lượt đọc cho cả hai: chúng là hai hàng của cùng một bảng, và hai
  // `findUnique` là hai lượt đi–về cho một màn hình.
  const iconRows = iconIds.length
    ? await prisma.asset.findMany({
        where: { id: { in: iconIds } },
        select: { id: true, url: true, mime: true, key: true, width: true, height: true },
      })
    : [];
  const assetById = new Map(iconRows.map((a) => [a.id, a]));
  const preview = (a: { url: string; mime: string; key: string } | null | undefined): FilePreview | null =>
    a ? { url: a.url, mime: a.mime, key: a.key } : null;
  const favicon = site?.faviconAssetId ? assetById.get(site.faviconAssetId) : null;
  const ogAsset = site?.ogImageId ? assetById.get(site.ogImageId) : null;
  const builderLogo = site?.builderLogoAssetId ? assetById.get(site.builderLogoAssetId) : null;
  const builderIcon = site?.builderFaviconAssetId ? assetById.get(site.builderFaviconAssetId) : null;

  const translated = new Map(counts.map((c) => [c.locale, c._count]));
  const entriesByLocale = new Map(entryCounts.map((c) => [c.locale, c._count]));

  return {
    site: {
      name: site?.name ?? '—',
      primaryDomain: site?.primaryDomain ?? '—',
      globals: (site?.globals ?? {}) as Record<string, unknown>,
      faviconAssetId: site?.faviconAssetId ?? null,
      faviconFile: preview(favicon),
      ogImageId: site?.ogImageId ?? null,
      ogImageFile: preview(ogAsset),
      ogImageSize: ogAsset ? { width: ogAsset.width, height: ogAsset.height } : null,
      builderLogoAssetId: site?.builderLogoAssetId ?? null,
      builderLogoFile: preview(builderLogo),
      builderFaviconAssetId: site?.builderFaviconAssetId ?? null,
      builderFaviconFile: preview(builderIcon),
      builderFaviconUseSite: site?.builderFaviconUseSite ?? true,
    },
    locales: locales.map((l) => ({
      code: l.code,
      label: l.label,
      isDefault: l.isDefault,
      enabled: l.enabled,
      translated: translated.get(l.code) ?? 0,
      entries: entriesByLocale.get(l.code) ?? 0,
    })),
    tokenCount,
  };
}
