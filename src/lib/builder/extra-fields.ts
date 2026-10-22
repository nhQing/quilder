/**
 * Ô "thêm khi cần" — những thuộc tính đúng nhưng hiếm.
 *
 * ## Vì sao không bày sẵn hết
 *
 * Nhóm nào cũng có một khúc đuôi dài: `justify-items`, `isolation`, `overflow-wrap`,
 * `font-variant-numeric`. Chúng có thật trong schema và compiler phát ra được, nhưng
 * một trang bình thường không dùng tới.
 *
 * Bày hết thì 20 ô hay dùng chìm trong 48 ô, và mỗi lần tìm một ô là một lượt cuộn.
 * Ẩn hết thì không có đường nào tới chúng, và người dùng phải xuống ô CSS tuỳ chỉnh —
 * mất validate, mất dấu "đặt riêng ở lớp này", mất cả cảnh báo customCss đang đè.
 * Bày cái hay dùng, còn lại một cú bấm.
 *
 * ## Vì sao bảng này viết tay, và cái gì canh cho nó không thiếu
 *
 * Chọn LOẠI ĐIỀU KHIỂN cho một field không suy ra được từ schema: `z.enum` có thể là
 * dải nút hoặc `<select>` tuỳ số lựa chọn, `zLen` có thể cần lọc token theo nhóm nào.
 * Đó là quyết định thiết kế, nên nó phải được viết ra.
 *
 * Nhưng *thiếu* một field thì im lặng — nó chỉ đơn giản không có đường nào tới.
 * `extra-fields.test.ts` duyệt `zStyleProps` thật và đòi MỌI field của tám nhóm phải
 * hoặc bày sẵn (`DEFAULT_FIELDS`) hoặc có mặt ở đây hoặc nằm trong `NEEDS_EDITOR` —
 * thêm field vào schema mà quên bảng này là test đỏ.
 */

/** Loại điều khiển dùng cho một ô. */
export type ExtraControl = 'len' | 'number' | 'select' | 'color' | 'text';

export interface ExtraField {
  group: string;
  field: string;
  control: ExtraControl;
  /**
   * Nhãn ghi tay, chỉ khi `cssLabel()` cho ra tên sai.
   *
   * Hai chỗ cần: `typography.clamp` phát ra bốn property nên property đầu là
   * `display`, và `effects.backdrop*` phát ra bản có tiền tố `-webkit-` trước.
   */
  label?: string;
  /** `select`: các lựa chọn. Nhãn hiện đúng bằng giá trị CSS — không dịch. */
  options?: readonly string[];
  /** `len`: lọc gợi ý token cho đúng ngữ cảnh. */
  tokenCategory?: string;
  /** `number`: biên và bước. */
  min?: number;
  max?: number;
  step?: number;
  /** Câu giải thích, vào `title`. Bắt buộc với ô mà tên của nó không tự nói. */
  hint?: string;
}

/**
 * Field đã bày sẵn trong panel, theo từng nhóm.
 *
 * Danh sách này KHÔNG dùng để render — nó là thứ test đối chiếu để biết field nào còn
 * lại. Lệch khỏi Inspector thì con số trên nút "+ N" sai, nên `inspector-layout.spec.ts`
 * đếm ô thật trong DOM.
 */
export const DEFAULT_FIELDS: Record<string, readonly string[]> = {
  layout: ['display', 'flexDirection', 'gap', 'align', 'justify', 'wrap'],
  size: ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'],
  spacing: ['pt', 'pb', 'pl', 'pr', 'mt', 'mb', 'ml', 'mr'],
  position: ['kind', 'z', 'top', 'right', 'bottom', 'left'],
  typography: [
    'color', 'size', 'weight', 'leading', 'tracking', 'align', 'transform', 'decoration',
  ],
  fill: ['color'],
  // `hidden` (D4): hàng ẩn/hiện nét viền trong `LayerVisibility`, hiện khi node có viền.
  border: ['width', 'style', 'color', 'radius', 'hidden'],
  effects: ['opacity', 'blur', 'overflow', 'cursor'],
  container: [],
};

/**
 * Field cần một editor RIÊNG, không phải một hàng ô nhập.
 *
 * Bày chúng thành một ô text sẽ tệ hơn là không bày: `gridTemplateColumns` là mảng
 * track có kiểu, `shadow` là danh sách lớp, `gradient` là danh sách stop màu. Gõ JSON
 * vào một ô là mời người dùng tạo ra dữ liệu sai mà validator phải từ chối.
 *
 * Chúng có mặt ở đây để test không báo thiếu, và để danh sách "còn nợ" là dữ liệu chứ
 * không phải một câu trong tài liệu.
 */
export const NEEDS_EDITOR: Record<string, readonly string[]> = {
  layout: ['flex', 'gridTemplateColumns', 'gridTemplateRows', 'gridAutoColumns', 'span'],
  size: [],
  spacing: [],
  position: [],
  typography: [],
  fill: ['gradient', 'image'],
  border: [],
  effects: ['outline', 'backdropFallbackColor'],
  container: [],
};

/**
 * Ô thêm-khi-cần, theo nhóm của panel.
 *
 * Khoá là nhóm HIỂN THỊ, không phải nhóm trong schema: `container.*` xếp vào Bố cục vì
 * container query là chuyện bố cục, và mở một section riêng cho hai ô là đổi cấu trúc
 * panel để chứa hai dòng.
 */
export const EXTRA_FIELDS: Record<string, readonly ExtraField[]> = {
  layout: [
    { group: 'layout', field: 'rowGap', control: 'len', tokenCategory: 'space' },
    { group: 'layout', field: 'columnGap', control: 'len', tokenCategory: 'space' },
    {
      group: 'layout',
      field: 'alignSelf',
      control: 'select',
      options: ['auto', 'start', 'center', 'end', 'stretch', 'baseline'],
      hint: 'Canh CHÍNH NÓ trong hộp cha, ghi đè align-items của cha.',
    },
    {
      group: 'layout',
      field: 'alignContent',
      control: 'select',
      options: ['start', 'center', 'end', 'stretch', 'between'],
      hint: 'Canh các HÀNG khi nội dung xuống nhiều dòng. Không có tác dụng nếu chỉ một dòng.',
    },
    {
      group: 'layout',
      field: 'justifyItems',
      control: 'select',
      options: ['start', 'center', 'end', 'stretch'],
      hint: 'Chỉ có tác dụng với display: grid.',
    },
    {
      group: 'layout',
      field: 'placeItems',
      control: 'select',
      options: ['start', 'center', 'end', 'stretch'],
      hint: 'Viết gộp của align-items + justify-items.',
    },
    {
      group: 'layout',
      field: 'autoFlow',
      control: 'select',
      options: ['row', 'column', 'row dense', 'column dense'],
      hint: 'Hướng grid tự xếp ô chưa được đặt chỗ.',
    },
    {
      group: 'layout',
      field: 'gridArea',
      control: 'text',
      hint: 'Tên vùng trong grid-template-areas của cha, ví dụ "hero".',
    },
    {
      group: 'container',
      field: 'type',
      control: 'select',
      options: ['normal', 'inline-size', 'size'],
      hint: 'Bật inline-size là điều kiện để token theo cqw bên trong node này hoạt động.',
    },
    {
      group: 'container',
      field: 'name',
      control: 'text',
      hint: 'Tên để @container gọi đúng node này thay vì tổ tiên gần nhất.',
    },
  ],

  size: [
    {
      group: 'size',
      field: 'aspectRatio',
      control: 'text',
      hint: 'Ví dụ 16/9. Chừa đúng chỗ trước khi ảnh tải xong, nên CLS = 0.',
    },
  ],

  typography: [
    {
      group: 'typography',
      field: 'family',
      control: 'len',
      tokenCategory: 'font',
      hint: 'CHỈ nhận tên token font (font-display, font-body, font-mono). Gõ số sẽ bị validator từ chối.',
    },
    {
      group: 'typography',
      field: 'wrap',
      control: 'select',
      options: ['normal', 'balance', 'pretty'],
      hint: 'balance cho tiêu đề ngắn (cân số chữ mỗi dòng), pretty cho đoạn dài (tránh dòng cuối một chữ).',
    },
    { group: 'typography', field: 'underlineOffset', control: 'len' },
    {
      group: 'typography',
      field: 'whiteSpace',
      control: 'select',
      options: ['normal', 'nowrap', 'pre-line'],
    },
    {
      group: 'typography',
      field: 'overflowWrap',
      control: 'select',
      options: ['normal', 'anywhere', 'break-word'],
      hint: 'anywhere cho chuỗi dài không có khoảng trắng (URL, tên đối tác) khỏi phá lưới.',
    },
    {
      group: 'typography',
      field: 'listStyle',
      control: 'select',
      options: ['none', 'disc', 'decimal'],
    },
    {
      group: 'typography',
      field: 'variantNumeric',
      control: 'select',
      options: ['normal', 'tabular-nums'],
      hint: 'tabular-nums cho bảng số và counter: mọi chữ số cùng bề rộng nên cột không nhảy.',
    },
    {
      group: 'typography',
      field: 'clamp',
      control: 'number',
      label: '-webkit-line-clamp',
      min: 1,
      step: 1,
      hint: 'Cắt sau N dòng. Compiler phát thêm display, -webkit-box-orient và overflow — cả bốn mới chạy.',
    },
  ],

  fill: [],

  effects: [
    {
      group: 'effects',
      field: 'backdropBlur',
      control: 'len',
      label: 'backdrop-filter: blur',
      hint: 'Làm mờ thứ NẰM SAU node. Cần nền trong suốt một phần mới thấy.',
    },
    {
      group: 'effects',
      field: 'backdropSaturate',
      control: 'number',
      label: 'backdrop-filter: saturate',
      min: 0,
      max: 4,
      step: 0.1,
    },
    {
      group: 'effects',
      field: 'blend',
      control: 'select',
      options: ['normal', 'difference', 'multiply', 'screen', 'overlay'],
    },
    { group: 'effects', field: 'pointerEvents', control: 'select', options: ['auto', 'none'] },
    {
      group: 'effects',
      field: 'visibility',
      control: 'select',
      options: ['visible', 'hidden'],
      hint: 'hidden vẫn CHIẾM CHỖ trong layout. Muốn gỡ hẳn thì dùng display: none.',
    },
    {
      group: 'effects',
      field: 'isolation',
      control: 'select',
      options: ['auto', 'isolate'],
      hint: 'isolate tạo stacking context mới, nên mix-blend-mode của con không trộn ra ngoài.',
    },
    { group: 'effects', field: 'userSelect', control: 'select', options: ['auto', 'none'] },
    {
      group: 'effects',
      field: 'objectFit',
      control: 'select',
      options: ['cover', 'contain', 'fill', 'none'],
      hint: 'Chỉ có tác dụng với ảnh và video.',
    },
    { group: 'effects', field: 'objectPosition', control: 'text', hint: 'Ví dụ "center", "top left", "50% 20%".' },
  ],
};

/** Mọi ô thêm-khi-cần của một nhóm panel, hoặc mảng rỗng. */
export function extrasFor(panelGroup: string): readonly ExtraField[] {
  return EXTRA_FIELDS[panelGroup] ?? [];
}
