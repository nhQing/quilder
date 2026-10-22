/**
 * Ô inspector nào phát ra property CSS nào.
 *
 * Cần để trả lời một câu duy nhất: *"customCss có đang đè giá trị tôi vừa kéo
 * không?"* — nếu có thì ô inspector đổi số mà trang không nhúc nhích, và người
 * dùng sẽ đi tìm bug ở chỗ không có bug.
 *
 * ## Vì sao là bảng viết tay chứ không đọc thẳng từ compiler
 *
 * Nguồn sự thật vẫn là `declarations()` trong `render/css.ts`. Nhưng file đó
 * `import { createHash } from 'node:crypto'` cho `compileDoc`, nên kéo nó vào
 * inspector (một client component) là kéo cả `node:crypto` vào bundle trình
 * duyệt.
 *
 * Nên bảng này chép lại phần ánh xạ, và `style-css-map.test.ts` DÒ THẬT
 * `declarations()` cho từng ô rồi đối chiếu. Bảng trôi khỏi compiler là test đỏ
 * ngay — chép tay mà vẫn không lệch được.
 */

/**
 * Khoá là `${group}.${field}`, đúng cách inspector gọi `setStyle`.
 *
 * MỘT ngoại lệ không có dấu chấm: `shadow` là thuộc tính cấp cao nhất của
 * `StyleProps` (giá trị là `TokenRef | Shadow[]`, không phải một object có
 * field). Bỏ nó khỏi bảng này nghĩa là customCss đè lên `box-shadow` mà không có
 * cảnh báo nào, và ô tìm không tìm ra ô đổ bóng.
 */
export const STYLE_CSS_PROPERTY: Record<string, readonly string[]> = {
  // Bố cục
  'layout.display': ['display'],
  'layout.flexDirection': ['flex-direction'],
  'layout.gap': ['gap'],
  'layout.align': ['align-items'],
  'layout.justify': ['justify-content'],
  'layout.wrap': ['flex-wrap'],
  'layout.rowGap': ['row-gap'],
  'layout.columnGap': ['column-gap'],
  'layout.alignSelf': ['align-self'],
  'layout.alignContent': ['align-content'],
  'layout.justifyItems': ['justify-items'],
  'layout.placeItems': ['place-items'],
  'layout.gridArea': ['grid-area'],
  'layout.autoFlow': ['grid-auto-flow'],
  'layout.flex': ['flex'],
  'layout.gridTemplateColumns': ['grid-template-columns'],
  'layout.gridTemplateRows': ['grid-template-rows'],
  'layout.gridAutoColumns': ['grid-auto-columns'],
  // Một ô, HAI property: `span.column` phát `grid-column`, `span.row` phát `grid-row`.
  'layout.span': ['grid-column', 'grid-row'],
  'container.type': ['container-type'],
  'container.name': ['container-name'],

  // Khoảng cách — logical property, giống hệt site gốc
  'spacing.pt': ['padding-block-start'],
  'spacing.pb': ['padding-block-end'],
  'spacing.pl': ['padding-inline-start'],
  'spacing.pr': ['padding-inline-end'],
  'spacing.mt': ['margin-block-start'],
  'spacing.mb': ['margin-block-end'],
  'spacing.ml': ['margin-inline-start'],
  'spacing.mr': ['margin-inline-end'],

  // Kích thước
  'size.width': ['inline-size'],
  'size.height': ['block-size'],
  'size.minWidth': ['min-inline-size'],
  'size.maxWidth': ['max-inline-size'],
  'size.minHeight': ['min-block-size'],
  'size.maxHeight': ['max-block-size'],
  'size.aspectRatio': ['aspect-ratio'],

  // Vị trí
  'position.kind': ['position'],
  'position.top': ['inset-block-start'],
  'position.right': ['inset-inline-end'],
  'position.bottom': ['inset-block-end'],
  'position.left': ['inset-inline-start'],
  'position.z': ['z-index'],

  // Chữ
  'typography.color': ['color'],
  'typography.size': ['font-size'],
  'typography.weight': ['font-weight'],
  'typography.leading': ['line-height'],
  'typography.tracking': ['letter-spacing'],
  'typography.align': ['text-align'],
  'typography.transform': ['text-transform'],
  'typography.decoration': ['text-decoration'],
  'typography.family': ['font-family'],
  'typography.wrap': ['text-wrap'],
  'typography.underlineOffset': ['text-underline-offset'],
  'typography.whiteSpace': ['white-space'],
  'typography.overflowWrap': ['overflow-wrap'],
  'typography.listStyle': ['list-style'],
  'typography.variantNumeric': ['font-variant-numeric'],
  // Bốn property cho MỘT ô: cắt dòng bằng -webkit-line-clamp cần cả bốn mới chạy.
  // Nhãn của ô KHÔNG được lấy property đầu ('display') — chỗ gọi truyền nhãn tay.
  'typography.clamp': ['display', '-webkit-box-orient', '-webkit-line-clamp', 'overflow'],

  // Nền & viền
  'fill.color': ['background-color'],
  'fill.gradient': ['background-image'],
  /*
   * Ba property cho MỘT ô, và `background-image` là một `var(--asset-<id>)` mà
   * renderer định nghĩa — compiler cố ý không biết gì về S3. Xem `assetVarName`
   * trong `render/css.ts`.
   *
   * `fill.gradient` và `fill.image` phát ra CÙNG một property. Đó là sự thật của
   * compiler, không phải lỗi của bảng: đặt cả hai thì cái sau thắng, và
   * `stylePathsForProperty('background-image')` trả về cả hai ô — đúng câu trả
   * lời cho "gõ background-image trong customCss thì đè lên ô nào".
   */
  'fill.image': ['background-image', 'background-size', 'background-position'],
  'border.radius': ['border-radius'],
  'border.width': ['border-width', 'border-style'],
  'border.style': ['border-style'],
  'border.color': ['border-color'],
  // Ẩn viền (D4) chỉ phát `border-style: none` — width/color bị bỏ qua, không bị ghi đè.
  'border.hidden': ['border-style'],

  // Hiệu ứng
  'effects.opacity': ['opacity'],
  'effects.overflow': ['overflow'],
  'effects.blur': ['filter'],
  'effects.cursor': ['cursor'],
  'effects.blend': ['mix-blend-mode'],
  'effects.pointerEvents': ['pointer-events'],
  'effects.visibility': ['visibility'],
  'effects.isolation': ['isolation'],
  'effects.userSelect': ['user-select'],
  'effects.objectFit': ['object-fit'],
  'effects.objectPosition': ['object-position'],
  // Compiler phát cả bản có tiền tố: Safari cần `-webkit-` cho backdrop-filter.
  'effects.backdropBlur': ['-webkit-backdrop-filter', 'backdrop-filter'],
  'effects.backdropSaturate': ['-webkit-backdrop-filter', 'backdrop-filter'],
  // `offset` là tuỳ chọn của cùng một ô, nên nó không có mục riêng.
  'effects.outline': ['outline', 'outline-offset'],

  /*
   * Biến hình.
   *
   * `transform.translate` phát ra property `translate` — ĐỘC LẬP, không phải hàm
   * `translate()` bên trong `transform`. Đây không phải chi tiết vụn: thiếu đúng
   * dòng này, `resolve_style` im lặng về `transform.translate`, và một người dựng
   * đã kết luận nó "không render" vì `getComputedStyle().transform === 'none'` —
   * kết quả ĐÚNG của một property khác. Mất một vòng điều tra cho một thứ không
   * hỏng. Lý do tách hai property nằm ở docblock của `StyleProps.transform` và ở
   * `css.ts`: GSAP sở hữu `transform` lúc effect chạy, nên CSS khai `transform`
   * là hai bên ghi đè nhau.
   *
   * Bốn ô `x`/`y`/`scale`/`rotate` gộp vào MỘT declaration `transform` — nên gõ
   * `transform` trong customCss đè cả bốn, và bảng này nói đúng như thế.
   */
  'transform.x': ['transform'],
  'transform.y': ['transform'],
  'transform.scale': ['transform'],
  'transform.rotate': ['transform'],
  'transform.origin': ['transform-origin'],
  'transform.translate': ['translate'],

  // Chuyển cảnh: cả bốn ô hợp thành một declaration `transition` duy nhất.
  'transition.props': ['transition'],
  'transition.duration': ['transition'],
  'transition.easing': ['transition'],
  'transition.delay': ['transition'],

  // Cấp cao nhất, không có field — xem docblock của bảng.
  shadow: ['box-shadow'],
};

/**
 * Bí danh mà người ta gõ trong customCss cho cùng một thứ.
 *
 * Compiler phát ra logical property (`padding-block-start`), nhưng gần như
 * không ai gõ thế trong panel CSS — họ gõ `padding-top`, hoặc `padding` gộp.
 * Không tính các bí danh này thì cảnh báo im lặng đúng lúc cần nhất.
 */
export const CSS_ALIASES: Record<string, readonly string[]> = {
  'padding-block-start': ['padding-top', 'padding-block', 'padding'],
  'padding-block-end': ['padding-bottom', 'padding-block', 'padding'],
  'padding-inline-start': ['padding-left', 'padding-inline', 'padding'],
  'padding-inline-end': ['padding-right', 'padding-inline', 'padding'],
  'margin-block-start': ['margin-top', 'margin-block', 'margin'],
  'margin-block-end': ['margin-bottom', 'margin-block', 'margin'],
  'margin-inline-start': ['margin-left', 'margin-inline', 'margin'],
  'margin-inline-end': ['margin-right', 'margin-inline', 'margin'],
  'inline-size': ['width'],
  'block-size': ['height'],
  'min-inline-size': ['min-width'],
  'min-block-size': ['min-height'],
  'max-inline-size': ['max-width'],
  'max-block-size': ['max-height'],
  'inset-block-start': ['top', 'inset-block', 'inset'],
  'inset-block-end': ['bottom', 'inset-block', 'inset'],
  'inset-inline-start': ['left', 'inset-inline', 'inset'],
  'inset-inline-end': ['right', 'inset-inline', 'inset'],
  'flex-direction': ['flex-flow'],
  'flex-wrap': ['flex-flow'],
  'text-decoration': ['text-decoration-line'],
  // `filter` là property gộp: gõ `filter: saturate(2)` đè luôn ô blur.
  'filter': [],
  'background-color': ['background'],
  'background-image': ['background'],
  'background-size': ['background'],
  'background-position': ['background'],
  'outline': ['outline-width', 'outline-style', 'outline-color'],
  'flex': ['flex-grow', 'flex-shrink', 'flex-basis'],
  'grid-template-columns': ['grid-template', 'grid'],
  'grid-template-rows': ['grid-template', 'grid'],
  // `grid-area` là dạng gộp của cả grid-row lẫn grid-column — nó đè ô `layout.span`.
  'grid-column': ['grid-area'],
  'grid-row': ['grid-area'],
  'transition': [
    'transition-property', 'transition-duration', 'transition-timing-function',
    'transition-delay',
  ],
  // `translate` KHÔNG có bí danh `transform`: hai property tách nhau là cả lý do
  // nó tồn tại. Gõ `transform` trong customCss không đè lên nó.
  'translate': [],
  'border-radius': ['border-start-start-radius', 'border-start-end-radius'],
  'border-width': ['border'],
  'border-color': ['border'],
  'border-style': ['border'],
  'gap': ['row-gap', 'column-gap'],
  'font-size': ['font'],
  'font-weight': ['font'],
  'line-height': ['font'],
  'position': [],
};

/**
 * Nhãn của một ô inspector = TÊN PROPERTY mà nó phát ra.
 *
 * ## Vì sao không dịch sang tiếng Việt nữa
 *
 * "canh ngang trục" không tra được ở đâu cả: không gõ được vào ô tìm, không dán
 * được sang MDN, và không khớp với thứ hiện ra trong stylesheet. Người dùng builder
 * này đọc được CSS — panel nói cùng một ngôn ngữ với CSS thì họ không phải dịch.
 *
 * ## Vì sao là LOGICAL property, không phải `width` / `padding-top`
 *
 * Compiler phát ra `inline-size` và `padding-block-start` (xem `render/css.ts`, và
 * site gốc dùng logical property khắp nơi). Nhãn phải là thứ THẬT SỰ ra stylesheet,
 * vì ba chỗ khác đã nói bằng tên đó rồi: cảnh báo "customCss đang đè ô này bằng
 * ...", khối class Tailwind, và chính file CSS người dùng mở ra xem. Đặt nhãn
 * `width` trong khi CSS ghi `inline-size` là tạo hai tên cho một thứ.
 *
 * Bù lại: `cssAlias()` trả về tên vật lý quen thuộc để đưa vào `title`, nên ai quen
 * `width` vẫn tìm ra ô — và ô tìm khớp cả hai.
 */
export function cssLabel(group: string, field: string): string {
  return STYLE_CSS_PROPERTY[`${group}.${field}`]?.[0] ?? field;
}

/**
 * Logical property → tên vật lý tương đương.
 *
 * Bảng RIÊNG, không dùng lại `CSS_ALIASES`: bảng kia gom cả property GỘP
 * (`padding`, `border`, `font`, `row-gap`) vì mục đích của nó là "thứ gì trong
 * customCss có thể đè ô này". Ở đây câu hỏi khác hẳn — "ô này còn tên nào khác cho
 * cùng đúng một thứ" — và `padding` không phải tên khác của `padding-block-start`,
 * nó là property bao trùm bốn ô.
 *
 * Chỉ có mặt những cặp 1-1 thật sự. Chúng đúng với `writing-mode: horizontal-tb`,
 * tức mọi trang của site này; ở chế độ viết dọc thì logical và vật lý tách nhau, và
 * đó là lý do compiler chọn logical.
 */
const PHYSICAL_NAME: Record<string, string> = {
  'padding-block-start': 'padding-top',
  'padding-block-end': 'padding-bottom',
  'padding-inline-start': 'padding-left',
  'padding-inline-end': 'padding-right',
  'margin-block-start': 'margin-top',
  'margin-block-end': 'margin-bottom',
  'margin-inline-start': 'margin-left',
  'margin-inline-end': 'margin-right',
  'inline-size': 'width',
  'block-size': 'height',
  'min-inline-size': 'min-width',
  'min-block-size': 'min-height',
  'max-inline-size': 'max-width',
  'max-block-size': 'max-height',
  'inset-block-start': 'top',
  'inset-block-end': 'bottom',
  'inset-inline-start': 'left',
  'inset-inline-end': 'right',
};

/**
 * Tên vật lý quen thuộc của ô, nếu nhãn logical khác nó.
 *
 * `inline-size` → `width`. Trả `null` khi không có gì để nói thêm (`gap` → `gap`),
 * để chỗ gọi không phải hiện một chú thích rỗng.
 */
export function cssAlias(group: string, field: string): string | null {
  const prop = STYLE_CSS_PROPERTY[`${group}.${field}`]?.[0];
  return (prop && PHYSICAL_NAME[prop]) ?? null;
}

/**
 * Chuỗi để ô tìm khớp cho một nhóm ô.
 *
 * Gộp: tên field trong schema, tên property CSS phát ra, VÀ tên vật lý tương đương.
 * Nhờ cái cuối, gõ `width` tìm ra nhóm Kích thước dù nhãn của nó là `inline-size`, và
 * gõ `padding-top` tìm ra hộp box model dù nó phát ra `padding-block-start`.
 *
 * Sinh từ `STYLE_CSS_PROPERTY` chứ không viết tay từng nhóm: một danh sách từ khoá
 * viết tay sẽ thiếu đúng cái field vừa được thêm, và không có gì báo.
 */
export function searchKeysFor(groups: readonly string[]): string {
  const out = new Set<string>();
  for (const key of Object.keys(STYLE_CSS_PROPERTY)) {
    const [group, field] = key.split('.') as [string, string | undefined];
    if (!groups.includes(group)) continue;
    // Khoá không có dấu chấm (`shadow`): tên nhóm CHÍNH LÀ tên thứ tìm được.
    out.add((field ?? group).toLowerCase());
    for (const prop of STYLE_CSS_PROPERTY[key] ?? []) out.add(prop);
    const physical = field ? cssAlias(group, field) : null;
    if (physical) out.add(physical);
  }
  return [...out].join(' ');
}

/**
 * Nghịch đảo: một tên property CSS ra từ những ô inspector nào.
 *
 * Dùng ở chỗ từ chối `customCss` của AI, để câu lỗi chỉ được đường có kiểu thay
 * vì chỉ nói "không được dùng". Đọc thẳng `STYLE_CSS_PROPERTY` chứ không có bảng
 * riêng — một bảng nghịch đảo viết tay là bản sao thứ hai sẽ trôi.
 *
 * Tính mỗi lần gọi: nó chỉ chạy trên đường LỖI, không phải đường nóng.
 */
export function stylePathsForProperty(prop: string): string[] {
  const want = prop.toLowerCase();
  const out: string[] = [];
  for (const [path, props] of Object.entries(STYLE_CSS_PROPERTY)) {
    if (props.some((p) => p === want)) out.push(path);
    // Bí danh cũng tính: người gõ `padding-top` đang nhắm ô `spacing.pt`, mà ô đó
    // phát ra `padding-block-start`.
    else if (props.some((p) => (CSS_ALIASES[p] ?? []).includes(want))) out.push(path);
  }
  return out.sort();
}

/** Mọi tên property có thể đè ô này, gồm cả bí danh. */
export function propertiesFor(group: string, field?: string): string[] {
  const base = STYLE_CSS_PROPERTY[field ? `${group}.${field}` : group];
  if (!base) return [];
  const out = new Set<string>(base);
  for (const prop of base) {
    for (const alias of CSS_ALIASES[prop] ?? []) out.add(alias);
  }
  return [...out];
}
