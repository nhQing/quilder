/**
 * Single source of truth cho breakpoint.
 *
 * Site cũ buộc phải khai hai lần — `css/base/_tokens.css` và `js/core/breakpoints.js` —
 * và README ghi thẳng rằng "with no build step there is no way to share them".
 * Có build step thì đây là thứ thắng miễn phí: file này là nguồn duy nhất, CSS
 * generator đọc nó, và `scripts/emit-breakpoints.ts` codegen ra biến CSS tương ứng.
 *
 * ## Vì sao 768 và 1024, không phải 560 và 900
 *
 * Bản đầu chép 560/900/1200/1560 từ site cũ sang "để migration không lệch một
 * pixel nào". Đối chiếu ngày 08/09/2026 cho thấy tiền đề ấy sai: CSS của site cũ
 * KHÔNG có mốc nào ở 560 hay 900 — nó chuyển khung ở `767.98` và `1023.98`, đúng
 * ba khung Figma (390 mobile · 744 tablet · 1920 desktop). Hai con số kia không
 * đến từ thiết kế nào cả.
 *
 * Cái giá của việc lệch: trang phục vụ SAI KHUNG ở hai cửa sổ — 768–899 nhận
 * khung mobile trong khi thiết kế vẽ tablet, và 1024–1199 nhận khung tablet
 * trong khi thiết kế vẽ desktop. Đo ở 1100: `.s3__list` là 999×486 (ba cột) bên
 * thiết kế nhưng 1020×1986 (một cột) bên builder. Bộ đối chiếu không bắt được vì
 * nó lấy mẫu đúng tại 390/560/900/1200/1560 — những bề rộng mà hai bên tình cờ
 * đồng ý.
 *
 * `sm: 768` và `md: 1024` cũng khôi phục quan hệ một-đối-một giữa năm khổ mặc
 * định của canvas và năm lớp style (xem DEFAULT_SCREENS bên dưới): 1920→xl,
 * 1440→lg, 1024→md, 768→sm, 320→base. Với lưới cũ thì 768 và 1024 rơi vào những
 * lớp không phải của chúng, và docblock ấy đã sai từ lúc viết.
 *
 * ĐỔI HAI SỐ NÀY LÀ ĐỔI CSS CỦA MỌI TRANG ĐÃ PUBLISH. Trang nào dựng theo lưới
 * cũ phải dịch lớp theo — `md` cũ xuống `sm`, `lg` cũ xuống `md` — rồi mới
 * deploy. Trang chủ đã dịch ngày 08/09/2026; các trang khác (`/news`,
 * `/nhi-birthday`, `/test`) CHƯA rà.
 */

export const BREAKPOINTS = ['base', 'sm', 'md', 'lg', 'xl'] as const;

export type Breakpoint = (typeof BREAKPOINTS)[number];

/** min-width tính bằng px. `base` là 0 — mobile-first, luôn áp dụng. */
export const BREAKPOINT_PX: Record<Breakpoint, number> = {
  base: 0,
  sm: 768,
  md: 1024,
  lg: 1200,
  xl: 1560,
};

/** Các breakpoint sinh ra `@media`, tức mọi thứ trừ `base`. */
export const OVERRIDE_BREAKPOINTS = BREAKPOINTS.filter(
  (bp): bp is Exclude<Breakpoint, 'base'> => bp !== 'base',
);

/**
 * State giả — không phải breakpoint, nhưng dùng chung đường ống với chúng trong
 * `ResponsiveStyle` vì cả hai đều là "một lớp override lên style.base".
 *
 * `inView` map sang `[data-in-view="true"]`, đúng quy ước data-attribute mà mọi
 * effect hiện có đang ghi ra. CSS sở hữu trạng thái, JS chỉ sở hữu trigger.
 */
export const STYLE_STATES = ['hover', 'focusVisible', 'inView'] as const;

export type StyleState = (typeof STYLE_STATES)[number];

/** Mọi lớp override hợp lệ trên `style.base`. */
export type StyleLayer = Exclude<Breakpoint, 'base'> | StyleState;

export function isBreakpoint(v: string): v is Breakpoint {
  return (BREAKPOINTS as readonly string[]).includes(v);
}

export function isStyleState(v: string): v is StyleState {
  return (STYLE_STATES as readonly string[]).includes(v);
}

/**
 * Nhãn của một BREAKPOINT — tức của một lớp style, không phải của một khung xem.
 *
 * `xl`/`lg`/`md`/`sm` là tên đúng về mặt kỹ thuật nhưng vô nghĩa khi thiết kế —
 * người dựng trang nghĩ bằng "desktop, tablet, điện thoại", không phải bằng
 * min-width. Tên kỹ thuật vẫn là thứ được lưu trong doc và emit ra CSS; đây chỉ
 * là lớp hiển thị, dùng ở Inspector để nói rõ đang ghi vào lớp nào.
 *
 * `base` không bị ẩn dù nó không nằm trong bốn tên user quen dùng: đó là lớp
 * mobile-first mà mọi lớp khác kế thừa từ đó. Ẩn nó đi thì không sửa được nền
 * của cả hệ thống.
 */
export interface BreakpointInfo {
  label: string;
  hint: string;
}

export const BREAKPOINT_INFO: Record<Breakpoint, BreakpointInfo> = {
  xl: { label: 'Desktop lớn', hint: '≥ 1560px' },
  lg: { label: 'Desktop', hint: '≥ 1200px' },
  md: { label: 'Desktop nhỏ', hint: '≥ 1024px' },
  sm: { label: 'Tablet', hint: '≥ 768px' },
  base: { label: 'Mobile', hint: 'nền, mọi màn kế thừa' },
};

export function breakpointInfo(bp: Breakpoint): BreakpointInfo {
  return BREAKPOINT_INFO[bp];
}

/* ── Khung giả lập màn hình ───────────────────────────────────────────────── */

/**
 * Một khổ màn để GIẢ LẬP trên canvas.
 *
 * ## Vì sao đây KHÔNG phải breakpoint
 *
 * Trước 19/08/2026, canvas bày đúng năm khung với bề rộng bằng chính mốc
 * breakpoint (1560/1200/1024/768/390), nên "khung đang xem" và "lớp style đang ghi"
 * là một thứ. Tiện, nhưng sai về khái niệm và bó tay người dùng: không xem được
 * trang ở 1920 vì không có breakpoint nào tên 1920.
 *
 * Giờ hai khái niệm tách hẳn:
 *
 *   - **Breakpoint** (`base|sm|md|lg|xl`) là lớp style, nằm trong doc, emit ra
 *     `@media`. Cố định, không sửa được — đổi nó là đổi CSS của site đã publish.
 *   - **Khung giả lập** là bề rộng người dùng muốn xem. Tuỳ ý, thêm bớt được, và
 *     chỉ là lựa chọn giao diện — nó không đi vào doc, không đi vào release.
 *
 * Lớp nào được ghi thì suy ra từ bề rộng khung (`breakpointForWidth`). Hai khung
 * khác nhau có thể trỏ cùng một lớp — 1920 và 1600 đều là `xl` — và đó là hành vi
 * đúng, không phải trùng lặp cần loại bỏ.
 */
export interface Screen {
  /** Ổn định qua các lần lưu; dùng làm `key` và làm khung đang chọn. */
  id: string;
  /** Bề rộng khung xem, px. Đây là thứ người dùng sửa. */
  width: number;
  /**
   * Chiều cao khung, px — và nó cũng LÀ chiều cao một màn mà `100vh`/`100svh`
   * nghĩa là bên trong iframe.
   *
   * Cố định, không bám nội dung. Bản bám-nội-dung đã thử ngày 19/08/2026 và bị
   * loại: khung cao 9.728px làm `100svh` bên trong cũng thành 9.728px, nên trang
   * dùng đơn vị viewport tự phình lên 65.184px và vẫn không thấy hết. Khung cao
   * bằng một màn thật thì `vh` đúng, và nội dung dài thì cuộn trong khung — đúng
   * như khách sẽ cuộn.
   */
  height: number;
}

/** Giới hạn bề rộng khung. Ngoài khoảng này là gõ nhầm, không phải ý định. */
export const MIN_SCREEN_WIDTH = 240;
export const MAX_SCREEN_WIDTH = 3840;

/**
 * Năm khổ mặc định — bộ số quy ước của giới kiểm thử responsive.
 *
 * Chiều cao đi kèm là chiều cao THẬT của thiết bị tương ứng: 1920×1080 (màn
 * desktop), 1440×900 (MacBook), 1024×768 và 768×1024 (iPad ngang/dọc),
 * 320×568 (iPhone SE — khổ hẹp nhất còn đáng đỡ).
 *
 * Năm bề rộng này phủ đúng năm lớp style một-đối-một, và đó là lý do chọn chúng
 * làm mặc định: 1920→xl, 1440→lg, 1024→md, 768→sm, 320→base. Người dùng thêm khổ
 * thì quan hệ đó không còn một-đối-một nữa, và điều đó không sao.
 */
export const DEFAULT_SCREENS: readonly Screen[] = [
  { id: 'w1920', width: 1920, height: 1080 },
  { id: 'w1440', width: 1440, height: 900 },
  { id: 'w1024', width: 1024, height: 768 },
  { id: 'w768', width: 768, height: 1024 },
  { id: 'w320', width: 320, height: 568 },
];

/**
 * Lớp style mà một bề rộng thuộc về — mốc lớn nhất còn ≤ width.
 *
 * Đây đúng là phép mà trình duyệt làm với `@media (min-width: …)`, nên khung
 * 1024px ghi vào `md` chính vì trình duyệt ở 1024px cũng áp `md`. Giữ hai phép
 * này giống nhau là điều kiện để "sửa ở khung nào thì hiện ra đúng ở đó".
 */
export function breakpointForWidth(width: number): Breakpoint {
  let best: Breakpoint = 'base';
  for (const bp of BREAKPOINTS) {
    if (width >= BREAKPOINT_PX[bp]) best = bp;
  }
  return best;
}

/** Selector suffix cho một state. Breakpoint không dùng hàm này — chúng bọc bằng @media. */
export const STATE_SELECTOR: Record<StyleState, string> = {
  hover: ':hover',
  focusVisible: ':focus-visible',
  inView: '[data-in-view="true"]',
};
