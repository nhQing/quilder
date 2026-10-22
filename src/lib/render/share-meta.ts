/**
 * Bộ thẻ CHIA SẺ: Open Graph + Twitter Card.
 *
 * Hàm thuần, không DB, không `next/headers` — nên mọi luật ở đây test được mà
 * không dựng một trang, và `generateMetadata` chỉ còn việc nạp dữ liệu.
 *
 * ## Vì sao tách thành một module
 *
 * Trước 11/09/2026 khối `openGraph` nằm inline trong `generateMetadata` và có
 * đúng bốn field: `title`, `description`, `type`, `images`. Ba hệ quả đo được:
 *
 *  1. `og:image` chỉ có trên trang BÀI VIẾT. Trang thường không có, vì
 *     `page.ogImageId` chưa bao giờ được đọc — cột có, ô chọn có, đường đọc không.
 *  2. **Không có `width`/`height`.** Facebook và Zalo phải tải ảnh về để đo trước
 *     khi hiện, và lần chia sẻ ĐẦU TIÊN thường ra một thẻ không ảnh; ảnh chỉ xuất
 *     hiện sau khi scraper quay lại. Với một chiến dịch quảng cáo thì "lần đầu"
 *     chính là lần quan trọng.
 *  3. **Không có thẻ Twitter nào.** X/Twitter không đọc `og:*` cho card, nên link
 *     hiện trơ — không ảnh, không tiêu đề.
 *
 * ## Vì sao KHÔNG suy `og:locale` từ mã ngôn ngữ
 *
 * Facebook đòi dạng `xx_XX` (`vi_VN`, `en_US`). Công thức hiển nhiên
 * `${code}_${code.toUpperCase()}` cho ra `vi_VI` và `en_EN` — cả hai đều không
 * tồn tại, và Facebook bỏ qua thẻ sai mà không báo gì. Nên ở đây là một BẢNG, và
 * mã không có trong bảng thì **bỏ hẳn thẻ** thay vì đoán: thiếu `og:locale` là
 * vô hại, còn sai thì là một thẻ nói dối.
 */

export interface ShareImage {
  /** URL của asset. Tương đối cũng được — `metadataBase` của layout lo phần gốc. */
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  /** MIME, ra `og:image:type`. Giúp scraper khỏi phải đoán. */
  mime?: string | null;
}

export interface ShareLocale {
  code: string;
  isDefault: boolean;
}

export interface ShareMetaInput {
  title: string;
  description?: string;
  /** Đường dẫn của trang đang xem, ví dụ `/en/trang-chu`. */
  path: string;
  /** Tên site, ra `og:site_name`. */
  siteName?: string;
  locale: ShareLocale;
  /** Mã của các ngôn ngữ KHÁC đang bật — ra `og:locale:alternate`. */
  otherLocaleCodes: readonly string[];
  image?: ShareImage;
  kind: 'website' | 'article';
  publishedAt?: Date | null;
  updatedAt?: Date | null;
}

/**
 * Mã ngôn ngữ → `og:locale`.
 *
 * Chỉ những mã site này thật sự dùng. Thêm ngôn ngữ mới thì thêm một dòng ở đây;
 * quên thì thẻ vắng mặt, KHÔNG sai — xem docblock đầu file.
 */
const OG_LOCALE: Record<string, string> = {
  vi: 'vi_VN',
  en: 'en_US',
  ja: 'ja_JP',
  ko: 'ko_KR',
  zh: 'zh_CN',
  th: 'th_TH',
  fr: 'fr_FR',
  de: 'de_DE',
};

/**
 * Bề rộng tối thiểu để scraper CHỊU hiện ảnh.
 *
 * Facebook bỏ qua ảnh dưới 200×200 hoàn toàn, và hiện thumbnail vuông nhỏ cho ảnh
 * dưới 600×315 thay vì thẻ ảnh lớn. Zalo cũng đòi tối thiểu 200×200. Con số ở đây
 * để builder cảnh báo TRƯỚC khi publish — xem `shareImageWarning`.
 */
export const OG_MIN_EDGE = 200;
/** Dưới ngưỡng này Facebook hiện thẻ nhỏ, không phải thẻ ảnh lớn. */
export const OG_LARGE_WIDTH = 600;
export const OG_LARGE_HEIGHT = 315;
/** Tỉ lệ Facebook/Zalo cắt theo. 1200×630. */
export const OG_RATIO = 1200 / 630;

/**
 * Ảnh OG có vấn đề gì không — câu tiếng Việt để builder hiện, hoặc `null`.
 *
 * Ở đây chứ không ở component: đây là luật của NỀN TẢNG, và cùng một luật phải
 * dùng được ở cả pane phải, ở màn publish, và ở một tool MCP về sau.
 *
 * Thiếu `width`/`height` KHÔNG phải lỗi của ảnh — SVG không có kích thước pixel,
 * và một hàng `Asset` cũ có thể chưa đo. Nhưng nó vẫn đáng nói, vì hệ quả là
 * scraper phải tự tải về.
 */
export function shareImageWarning(image: ShareImage | undefined): string | null {
  if (!image) return 'Chưa có ảnh chia sẻ — chia sẻ trang này sẽ ra một thẻ không ảnh.';

  const { width: w, height: h } = image;
  if (!w || !h) {
    return 'Không biết kích thước ảnh, nên thẻ chia sẻ không khai được width/height — Facebook và Zalo sẽ phải tự tải ảnh về, và lần chia sẻ đầu thường chưa ra ảnh.';
  }
  if (w < OG_MIN_EDGE || h < OG_MIN_EDGE) {
    return `Ảnh ${w}×${h} quá nhỏ — Facebook và Zalo bỏ qua ảnh dưới ${OG_MIN_EDGE}×${OG_MIN_EDGE}.`;
  }
  if (w < OG_LARGE_WIDTH || h < OG_LARGE_HEIGHT) {
    return `Ảnh ${w}×${h} nhỏ hơn ${OG_LARGE_WIDTH}×${OG_LARGE_HEIGHT} — Facebook sẽ hiện thẻ vuông nhỏ thay vì thẻ ảnh lớn.`;
  }
  /*
   * Lệch tỉ lệ thì bị CẮT, không bị co.
   *
   * Ngưỡng 25% chọn theo hậu quả: một tấm 1200×630 lệch 0%, một tấm vuông
   * 1200×1200 lệch ~48% và bị cắt mất gần nửa chiều cao — đủ để một logo ở đáy
   * ảnh biến mất. Dưới 25% thì phần cắt còn nằm ở lề.
   */
  const ratio = w / h;
  const off = Math.abs(ratio - OG_RATIO) / OG_RATIO;
  if (off > 0.25) {
    return `Ảnh ${w}×${h} lệch tỉ lệ 1200×630 — Facebook và Zalo sẽ CẮT, không co lại. Chữ hoặc logo gần mép có thể mất.`;
  }
  return null;
}

interface OgImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  type?: string;
}

/**
 * Input → khối `openGraph` + `twitter` cho `Metadata` của Next.
 *
 * Trả về đúng hình dạng Next mong đợi, nên `generateMetadata` chỉ spread nó vào.
 */
export function shareMeta(input: ShareMetaInput): {
  openGraph: Record<string, unknown>;
  twitter: Record<string, unknown>;
} {
  const image: OgImage | undefined = input.image
    ? {
        url: input.image.url,
        // Chỉ khai khi có CẢ HAI: một chiều lẻ loi làm scraper tính sai tỉ lệ, tệ
        // hơn không khai gì.
        ...(input.image.width && input.image.height
          ? { width: input.image.width, height: input.image.height }
          : {}),
        ...(input.image.alt?.trim() ? { alt: input.image.alt.trim() } : {}),
        ...(input.image.mime ? { type: input.image.mime } : {}),
      }
    : undefined;

  const ogLocale = OG_LOCALE[input.locale.code];
  const alternates = input.otherLocaleCodes
    .map((c) => OG_LOCALE[c])
    .filter((v): v is string => Boolean(v));

  return {
    openGraph: {
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      /*
       * `og:url` là URL CHÍNH TẮC của nội dung, không phải URL người dùng đang mở.
       *
       * Facebook gộp lượt thích và lượt chia sẻ theo thẻ này, nên hai URL cùng nội
       * dung mà khai hai `og:url` khác nhau sẽ thành hai bản ghi rời — số chia sẻ
       * bị chia đôi, và không có gì báo. Trước đây thẻ này KHÔNG có, nên Facebook
       * tự lấy URL nó quét được, kể cả khi URL đó mang tham số quảng cáo
       * (`?fbclid=…`).
       *
       * Tương đối là ĐÚNG: `metadataBase` ở layout biến nó thành tuyệt đối. Ghép
       * tay ở đây là bản thứ hai của cùng một gốc, và bản ở đây sẽ không biết về
       * `SITE_URL`.
       */
      url: input.path,
      ...(input.siteName ? { siteName: input.siteName } : {}),
      type: input.kind,
      ...(ogLocale ? { locale: ogLocale } : {}),
      ...(alternates.length ? { alternateLocale: alternates } : {}),
      ...(image ? { images: [image] } : {}),
      /*
       * `article:*` chỉ có nghĩa với `type: 'article'`.
       *
       * Khai chúng trên một `website` là thẻ mà không scraper nào đọc, và nó làm
       * người soát tưởng trang chủ là một bài viết.
       */
      ...(input.kind === 'article'
        ? {
            ...(input.publishedAt ? { publishedTime: input.publishedAt.toISOString() } : {}),
            ...(input.updatedAt ? { modifiedTime: input.updatedAt.toISOString() } : {}),
          }
        : {}),
    },

    twitter: {
      /*
       * `summary_large_image` CHỈ khi có ảnh.
       *
       * Khai nó mà không có `twitter:image` cho ra một thẻ dành chỗ cho ảnh rồi để
       * trống — xấu hơn hẳn thẻ `summary`, vốn vốn dĩ là thẻ không ảnh.
       */
      card: image ? 'summary_large_image' : 'summary',
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(image ? { images: [image] } : {}),
    },
  };
}
