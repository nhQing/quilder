/**
 * Ghi chú thô của extractor → báo cáo cho người dùng.
 *
 * Quy tắc cứng của bộ clone: KHÔNG có gì rơi im lặng. Mọi thứ không clone được, clone gần đúng hoặc
 * bị bỏ đều thành một dòng ở đây, và Claude phải đọc nguyên văn cho người dùng nghe (prompt
 * `/clone_website` bắt làm vậy). Thêm một hành vi extractor chưa xử lý được = thêm một `code` ở
 * extractor và một dòng ở bảng này.
 */

import type { CloneNotes, CloneReportItem } from './types';

interface Rule {
  severity: CloneReportItem['severity'];
  message: (count: number, samples: string[]) => string;
}

const list = (samples: string[]) => (samples.length ? ` (${samples.join(', ')})` : '');

const RULES: Record<string, Rule> = {
  canvas: {
    severity: 'error',
    message: (n, s) =>
      `${n} phần tử <canvas> (WebGL / đồ hoạ vẽ bằng JS)${list(s)} KHÔNG clone được — để khung trống cùng kích thước. Builder có node Canvas (gradient, displacement) nhưng không tái tạo được đồ hoạ tuỳ ý của site gốc.`,
  },
  iframe: {
    severity: 'error',
    message: (n, s) =>
      `${n} iframe (nhúng video/bản đồ/widget)${list(s)} KHÔNG clone được — để khung trống cùng kích thước. Cần người quyết định cách nhúng.`,
  },
  embed: {
    severity: 'error',
    message: (n, s) => `${n} phần tử <object>/<embed>/<audio>${list(s)} không clone được — để khung trống.`,
  },
  'form-field': {
    severity: 'warn',
    message: (n, s) =>
      `${n} ô nhập liệu (input/select/textarea)${list(s)} chưa dựng — để khung trống. Biểu mẫu thật cần Composite Form.`,
  },
  form: {
    severity: 'warn',
    message: (n, s) => `${n} biểu mẫu <form>${list(s)}: chỉ dựng khung, KHÔNG có logic gửi dữ liệu.`,
  },
  'form-submit': {
    severity: 'warn',
    message: (n, s) => `${n} nút submit${list(s)} được dựng thành nút không làm gì (action none).`,
  },
  table: {
    severity: 'info',
    message: (n, s) => `${n} bảng <table>${list(s)} được dựng bằng khối Stack/Grid gần đúng, không phải bảng thật.`,
  },
  'behaviour-carousel': {
    severity: 'warn',
    message: (n, s) =>
      `${n} carousel/slider${list(s)}: chỉ clone trạng thái đang hiển thị, hành vi kéo/tự chạy KHÔNG có (composite Carousel của builder chưa có runtime).`,
  },
  'behaviour-scroll-effect': {
    severity: 'warn',
    message: (n, s) =>
      `${n} phần tử có hiệu ứng vào/cuộn/parallax (AOS, GSAP, reveal…)${list(s)}: KHÔNG tái tạo, trang hiện ở trạng thái cuối. Có thể gắn effect của builder sau (list_effects).`,
  },
  'behaviour-toggle': {
    severity: 'warn',
    message: (n, s) => `${n} thành phần đóng/mở (accordion, menu, details)${list(s)}: chỉ clone trạng thái đang thấy, KHÔNG có hành vi bấm đóng/mở.`,
  },
  'behaviour-modal': {
    severity: 'warn',
    message: (n, s) => `${n} hộp thoại/modal${list(s)}: hành vi mở/đóng KHÔNG có.`,
  },
  'behaviour-tabs': {
    severity: 'warn',
    message: (n, s) => `${n} tab${list(s)}: chỉ clone tab đang hiển thị, KHÔNG có hành vi chuyển tab.`,
  },
  'behaviour-lottie': {
    severity: 'error',
    message: (n, s) => `${n} phần tử Lottie/model 3D${list(s)} KHÔNG clone được.`,
  },
  'behaviour-fixed': {
    severity: 'info',
    message: (n, s) =>
      `${n} phần tử cố định/sticky${list(s)}: giữ vị trí cố định/sticky nhưng hành vi ẩn-hiện/thu gọn khi cuộn (do JS) KHÔNG có.`,
  },
  'transform-js': {
    severity: 'warn',
    message: (n) => `${n} phần tử có transform do JS đặt (không có trong CSS) — bị bỏ, vị trí có thể lệch.`,
  },
  'font-family': {
    severity: 'warn',
    message: (n, s) =>
      `Font không có trong builder${list(s)} — các chữ dùng chúng rơi về font mặc định của site (${n} chỗ). Cần chủ site thêm font hoặc chọn font thay.`,
  },
  'color-unparsed': {
    severity: 'warn',
    message: (n, s) => `${n} giá trị màu dạng lạ (lab/oklch/color-mix…)${list(s)} không đổi được sang hex — bị bỏ.`,
  },
  'bg-size': {
    severity: 'info',
    message: (n, s) => `${n} ảnh nền có background-size khác cover/contain${list(s)} — dùng cover.`,
  },
  'bg-layers': {
    severity: 'warn',
    message: (n) => `${n} nền gồm cả ảnh lẫn gradient/nhiều lớp — builder chỉ giữ ảnh (một lớp), gradient bị bỏ.`,
  },
  'gradient-unsupported': {
    severity: 'warn',
    message: (n, s) => `${n} gradient dạng repeating/radial/conic${list(s)} — để trong customCss, builder không sửa được bằng inspector.`,
  },
  'display-unknown': {
    severity: 'info',
    message: (n, s) => `${n} giá trị display lạ${list(s)} — bỏ qua.`,
  },
  'grid-approx': {
    severity: 'info',
    message: (n, s) => `${n} lưới có track dạng auto-fit/auto-fill hoặc phức tạp${list(s)} — dùng số cột đo được ở từng khổ (xấp xỉ).`,
  },
  'grid-unparsed': {
    severity: 'warn',
    message: (n, s) => `${n} lưới không đọc được track${list(s)} — bỏ, bố cục có thể lệch.`,
  },
  'css-unreadable': {
    severity: 'warn',
    message: (n) =>
      `${n} stylesheet khác nguồn (CORS) không đọc được — một số khai báo (grid, transform, chiều cao theo vh) có thể thiếu.`,
  },
  'inline-style-lost': {
    severity: 'warn',
    message: (n, s) =>
      `${n} đoạn chữ nội dòng có màu/đậm/cỡ riêng bị gộp về style của khối chứa${list(s)} (RichText chỉ có đậm, nghiêng, link).`,
  },
  'js-link': {
    severity: 'warn',
    message: (n, s) => `${n} link javascript:/data: bị đổi thành "#"${list(s)}.`,
  },
  'internal-link': {
    severity: 'info',
    message: (n, s) =>
      `Link nội bộ trỏ tới ${n} đường dẫn của site gốc${list(s)} — giữ dạng đường dẫn tương đối; các trang đích cần tồn tại trong builder.`,
  },
  'image-no-src': {
    severity: 'warn',
    message: (n, s) => `${n} ảnh không có nguồn đọc được${list(s)} — để node Image trống.`,
  },
  'video-no-src': {
    severity: 'warn',
    message: (n, s) => `${n} video không có nguồn đọc được${list(s)} — để node Video trống.`,
  },
  'video-stream': {
    severity: 'error',
    message: (n, s) => `${n} video dạng stream (blob/HLS/DASH)${list(s)} KHÔNG tải được — để node Video trống.`,
  },
  'max-nodes': {
    severity: 'error',
    message: () => 'Trang vượt trần số node — phần cuối trang BỊ CẮT. Chia nhỏ trang nguồn hoặc nâng trần.',
  },
  'pass-mismatch': {
    severity: 'warn',
    message: (n, s) => `${n} phần tử chỉ xuất hiện ở khổ lớn (DOM đổi theo khổ)${list(s)} — bị bỏ.`,
  },
  unresettable: {
    severity: 'info',
    message: (n, s) => `${n} khoá style trở về mặc định ở khổ lớn mà không reset được${list(s)} — khổ lớn có thể giữ giá trị của khổ nhỏ.`,
  },
  'text-split': {
    severity: 'info',
    message: (n, s) =>
      `${n} khối chữ có đoạn nội dòng khác style (màu nhấn, cỡ chữ…)${list(s)} được tách thành nhiều node chữ để giữ style; tiêu đề thành khối có role=heading chứ không còn là thẻ h1–h4.`,
  },
  'scroll-capped': {
    severity: 'warn',
    message: (n, s) =>
      `Trang quá dài hoặc cuộn vô hạn${list(s)} — chỉ cuộn tới giới hạn, phần nội dung phía dưới có thể THIẾU.`,
  },
  'pruned-hidden': {
    severity: 'info',
    message: (n) => `Đã gỡ ${n} phần tử ẩn ở mọi khổ hoặc rỗng 0×0 (bản nhân đôi menu mobile/desktop, tracker…).`,
  },
};

/** Luôn có, vì extractor không bao giờ đọc được chúng. */
export const ALWAYS_NOTE: CloneReportItem = {
  code: 'limits',
  severity: 'info',
  message:
    'Không clone: trạng thái hover/focus/active, transition/animation, hành vi JS (menu mobile, cuộn mượt, popup, ' +
    'cookie banner, chat widget), lazy-load bằng JS sau thời điểm đo, và các font web của site gốc. ' +
    'Cỡ chữ/khoảng cách co giãn liên tục theo bề rộng (clamp, vw) được đo tại 5 mốc breakpoint của builder, nên ' +
    'giữa hai mốc có thể lệch vài px — compare_with_url sẽ chỉ ra chỗ cần chỉnh.',
};

export function notesToReport(notes: CloneNotes): CloneReportItem[] {
  const out: CloneReportItem[] = [];
  for (const [code, { count, samples }] of Object.entries(notes)) {
    const rule = RULES[code];
    if (!rule) {
      out.push({ code, severity: 'info', message: `${code}: ${count} lần`, count, samples });
      continue;
    }
    out.push({ code, severity: rule.severity, message: rule.message(count, samples), count, samples });
  }
  const rank = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
