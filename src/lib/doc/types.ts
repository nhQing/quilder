/**
 * Document schema — cây node của một trang.
 *
 * ## Vì sao map phẳng chứ không phải cây lồng nhau
 *
 * `nodes` là `Record<NodeId, Node>`, quan hệ cha–con nằm ở `parentId` + `children`.
 * Bốn lý do, cái nào cũng cắn về sau nếu chọn sai:
 *
 *  1. Op địa chỉ hóa bằng `{ nodeId }` thay vì path `/children/2/children/0` — chèn
 *     một sibling là vô hiệu hóa sạch mọi path đã tính trước đó.
 *  2. Inverse-op cho undo nhỏ gọn: ghi lại một node, không phải một nhánh cây.
 *  3. AI nhận được đúng một node mà không phải serialize cả subtree vào context.
 *  4. Move node = sửa 2 field, không phải splice rồi reinsert.
 *
 * ## Vì sao đóng băng bộ node type
 *
 * 9 primitive + `Composite`. Năng lực mới đến qua effect và preset, KHÔNG BAO GIỜ
 * qua node type mới. Yêu cầu nào cần một type mới thì nó là một `Composite`.
 * Đây là hàng rào chống scope creep quan trọng nhất của cả dự án — xem README.
 */

import type { Breakpoint, StyleLayer } from '@/lib/design/breakpoints';

export type NodeId = string; // nanoid(10), ổn định suốt đời của node
export type SchemaVersion = 1 | 2;

/**
 * v2 (07/09/2026): `NodeBase.visibility: Responsive<boolean>` → `render: boolean`.
 *
 * Trường cũ TRÔNG như media query — bốn khoá breakpoint, đúng hình dạng mọi thuộc
 * tính responsive khác — nhưng renderer chỉ đọc `.base` rồi `return null`, tức nó
 * cắt node khỏi DOM ở MỌI bề rộng. Đặt `{base:false, lg:true}` với ý "ẩn ở mobile,
 * hiện ở desktop" cho ra node biến mất hoàn toàn, kể cả ở 1440px, và không có lỗi
 * nào. Xem migration `1 -> 2` trong `migrate.ts`.
 */
export const CURRENT_SCHEMA_VERSION: SchemaVersion = 2;

export interface Doc {
  schemaVersion: SchemaVersion;
  rootId: NodeId;
  nodes: Record<NodeId, Node>;
}

/* ─────────────────────────────────────────────────────────────────────────
   Giá trị: mọi thứ là tagged union, không bao giờ là string tự do.

   Đây là chỗ CSS bị chặn. Không phải ở format output — mà ở đây, tại schema.
   `fill.color` chỉ nhận token ref hoặc màu đã validate, nên
   `background: url(javascript:…)` không thể phát sinh từ editor lẫn từ AI.
   Lối thoát duy nhất là node CustomCode, và nó bị sandbox riêng.
   ───────────────────────────────────────────────────────────────────────── */

/** Tham chiếu tới một row trong bảng Token. Compile ra `var(--<name>)`. */
export interface TokenRef {
  $token: string;
}

/**
 * `cqw`/`cqi`/`cqh` có mặt vì `.hero`, `.s2`, `.s4` và `.footer` đều là
 * `container-type: inline-size`, và `_tokens.css` giải thích rõ vì sao dùng cqw
 * chứ không phải vw ở những chỗ đó. Bỏ chúng đi là không tái tạo được layout gốc.
 */
export type LengthUnit =
  | 'px' | 'rem' | '%' | 'vw' | 'svh' | 'ch' | 'fr'
  | 'cqw' | 'cqi' | 'cqh';

/**
 * Phép tính bị bó thành cây toán tử có kiểu, KHÔNG phải chuỗi `calc()` tự do.
 * Site gốc dùng khá nhiều: `calc(-1 * var(--mm-hero-art-drop))`,
 * `calc(100dvh - var(--mm-s3-h))`, và đặc biệt Section 6 dùng
 * `max(var(--mm-block-gutter), (100% - var(--mm-block-w)) / 2)` để dựng full-bleed.
 * Cho phép string tự do ở đây là mở lại đúng lỗ hổng injection mà test R1 đã bắt.
 */
export type CalcOp = 'add' | 'sub' | 'mul' | 'div';

export type Len =
  | TokenRef
  | { v: number; u: LengthUnit }
  | { clamp: [Len, Len, Len] }
  | { max: Len[] }
  | { min: Len[] }
  | { calc: { op: CalcOp; a: Len; b: Len | number } }
  /**
   * XOÁ giá trị mà layer dưới đã đặt. Biên dịch thành `unset`.
   *
   * ## Trạng thái thứ ba mà `Style` trước đây không diễn đạt được
   *
   * Một layer responsive chỉ nói được hai điều: *có key* (ghi đè) và *không có key*
   * (kế thừa). Thiếu điều thứ ba: **ở khổ này, bỏ hẳn thứ base đã đặt**.
   *
   * `RuleSet` của Plasmic phân biệt đủ ba — `null` là kế thừa, `[]` là xoá, giá trị
   * là ghi đè (docs/BENCHMARK.md §1.1). Ta thiếu nhánh giữa.
   *
   * ## Vì sao là `{ unset: true }` chứ không phải `null`
   *
   * `null` đã mang nghĩa khác ở `setPresence` (xoá khoá, về mặc định "có render") và ở
   * `setOverride` (gỡ ghi đè). Dùng lại nó cho nghĩa thứ ba là mời người đọc sau
   * đoán sai, và ba nghĩa cho một giá trị là ba chỗ để nhầm.
   *
   * ## Chưa cắn, và vì sao vẫn làm
   *
   * Hầu hết thuộc tính có giá trị trung tính đặt được thay thế (`padding: 0`). Nó sẽ
   * cắn ở thuộc tính không có, hoặc khi cần trả về đúng mặc định của trình duyệt.
   *
   * ## Phạm vi: CHỈ `Len`
   *
   * Phủ nhóm hay cần nhất — spacing, size, gap. Màu, `display` và các kiểu khác vẫn
   * chỉ có hai trạng thái. Mở rộng khi có nhu cầu thật, chứ không phải cho đủ bộ.
   */
  | { unset: true };

export type ColorValue =
  | TokenRef
  | { hex: string; alpha?: number }
  /** → color-mix(in srgb, a X%, b) — `_tokens.css` đã dùng kỹ thuật này sẵn. */
  | { mix: [ColorValue, ColorValue]; amount: number };

/* ─────────────────────────────────────────────────────────────────────────
   Responsive: mobile-first, `base` bắt buộc, override thưa
   ───────────────────────────────────────────────────────────────────────── */

export type Responsive<T> = { base: T } & Partial<
  Record<Exclude<Breakpoint, 'base'>, T>
>;

export interface ResponsiveStyle {
  base: StyleProps;
  sm?: Partial<StyleProps>;
  md?: Partial<StyleProps>;
  lg?: Partial<StyleProps>;
  xl?: Partial<StyleProps>;
  hover?: Partial<StyleProps>;
  focusVisible?: Partial<StyleProps>;
  /** → `[data-in-view="true"]`, đúng quy ước mà scroll-reveal.js đang ghi ra. */
  inView?: Partial<StyleProps>;
  /**
   * State do effect điều khiển, khóa là tên state mà effect khai báo trong manifest.
   * Compile ra `[data-n="<id>"][data-<state>="true"]`.
   *
   * Đây là kết quả trực tiếp của việc chứng minh rủi ro R1: header thật có HAI state
   * — `.header.is-collapsed` (nav-collapse.js) và `.header.is-inverted` (nav-invert.js)
   * — và bộ ba hover/focusVisible/inView cố định không biểu diễn nổi chúng. Không có
   * mục này thì header không tái tạo được, và đó là section quan trọng nhất của site.
   *
   * Tên state KHÔNG tự do: validator tầng semantic đối chiếu với `statesWritten`
   * của các effect đang gắn trên node, nên không thể sinh ra state chết.
   */
  states?: Record<string, Partial<StyleProps>>;
}

export type StyleLayerKey = StyleLayer;

/* ─────────────────────────────────────────────────────────────────────────
   Style props — tên property là enum ĐÓNG
   ───────────────────────────────────────────────────────────────────────── */

export interface StyleProps {
  layout?: {
    display?: 'flex' | 'grid' | 'block' | 'inline-flex' | 'contents' | 'none';
    /**
     * Trục chính của flex container.
     *
     * KHÔNG dùng `Stack.direction` cho việc này: field đó có trong schema nhưng
     * compiler chưa bao giờ đọc, nên nó không sinh ra CSS — và nó chỉ tồn tại
     * trên `Stack`, còn `Section` cũng cần đổi trục. Đặt ở `layout` để mọi type
     * node dùng chung một đường.
     */
    flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
    gap?: Len;
    rowGap?: Len;
    columnGap?: Len;
    align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
    justify?: 'start' | 'center' | 'end' | 'between' | 'around';
    alignSelf?: 'start' | 'center' | 'end' | 'stretch' | 'baseline' | 'auto';
    alignContent?: 'start' | 'center' | 'end' | 'stretch' | 'between';
    justifyItems?: 'start' | 'center' | 'end' | 'stretch';
    wrap?: boolean;
    /** flex: <grow> <shrink> <basis>. `.nav-primary__icon` dùng `flex: 0 0 auto`. */
    flex?: { grow?: number; shrink?: number; basis?: Len | 'auto' };
    /** Named grid area — `_grid.css` hiện tại đã dùng named line. Validate là ident. */
    gridArea?: string;
    gridTemplateColumns?: GridTrack[];
    gridTemplateRows?: GridTrack[];
    /** Section 8 dựng lưới press bằng auto-flow column + auto-columns. */
    gridAutoColumns?: GridTrack;
    autoFlow?: 'row' | 'column' | 'row dense' | 'column dense';
    /** Footer dùng `place-items` thay vì tách align/justify. */
    placeItems?: 'start' | 'center' | 'end' | 'stretch';
    span?: { column?: number | 'full'; row?: number };
  };
  size?: {
    width?: Len | 'auto' | 'full';
    height?: Len | 'auto' | 'full' | 'svh';
    minWidth?: Len;
    maxWidth?: Len | 'measure' | 'container';
    minHeight?: Len;
    maxHeight?: Len;
    /** '16/9' — giữ chỗ để CLS = 0, đúng cách .card-work__media đang làm. */
    aspectRatio?: string;
  };
  spacing?: {
    pt?: Len; pr?: Len; pb?: Len; pl?: Len;
    mt?: Len; mr?: Len; mb?: Len; ml?: Len;
  };
  position?: {
    kind?: 'static' | 'relative' | 'absolute' | 'sticky' | 'fixed';
    top?: Len; right?: Len; bottom?: Len; left?: Len;
    z?: TokenRef | number;
  };
  typography?: {
    /**
     * MÀU CHỮ. Bị bỏ sót ở bản đầu vì hai section dùng để chứng minh R1 tình cờ
     * không cần nó — `fill.color` map sang `background-color`, nên không có đường
     * nào đặt màu chữ. Cả 5 preset còn lại (hero, trust bar, s8, s10, footer) đều
     * dùng `color`. Đây là bài học: chứng minh trên 2 section không đủ để kết luận
     * cho 10 section.
     */
    color?: ColorValue;
    family?: TokenRef;
    /** --step-0 … --step-5 của thang fluid hiện có. */
    size?: TokenRef | Len;
    weight?: 400 | 500 | 600 | 700;
    leading?: TokenRef | number;
    tracking?: TokenRef | Len;
    align?: 'left' | 'center' | 'right';
    transform?: 'none' | 'uppercase';
    /**
     * `.s6__title` dùng `balance`, `.s6__lede` dùng `pretty` — hai giá trị khác nhau
     * trên hai node cạnh nhau, nên boolean không đủ.
     */
    wrap?: 'balance' | 'pretty' | 'normal';
    decoration?: 'none' | 'underline';
    underlineOffset?: Len;
    whiteSpace?: 'normal' | 'nowrap' | 'pre-line';
    /** Trust bar dùng để tên đối tác dài không phá lưới logo. */
    overflowWrap?: 'normal' | 'anywhere' | 'break-word';
    /** Danh sách trong trust bar, s8, s10 đều bỏ bullet. */
    listStyle?: 'none' | 'disc' | 'decimal';
    /** Bảng số liệu và counter cần chữ số cùng bề rộng. */
    variantNumeric?: 'normal' | 'tabular-nums';
    clamp?: number;
  };
  /*
   * `hidden: true` (D4) có ở gradient, ảnh nền, viền và từng lớp bóng: TẮT TẠM một giá
   * trị mà không xoá nó — bật lại là đúng như cũ, vì giá trị chưa từng rời doc. Bộ sinh
   * CSS bỏ qua phần bị ẩn; ẩn hết ở một breakpoint thì phát `none` để vẫn đè được
   * breakpoint thấp hơn. Chỉ nhận `true`: bật lại là gỡ khoá, không ghi `false`, để
   * một doc không có hai cách nói cùng một trạng thái.
   */
  fill?: {
    color?: ColorValue;
    gradient?: {
      kind: 'linear' | 'radial';
      angle?: number;
      stops: { at: number; color: ColorValue }[];
      hidden?: true;
    };
    image?: { assetId: string; fit: 'cover' | 'contain'; position?: string; hidden?: true };
  };
  border?: {
    width?: Len;
    style?: 'solid' | 'dashed';
    color?: ColorValue;
    radius?: TokenRef | Len;
    /** Ẩn nét viền (width/style/color). Bo góc giữ nguyên: đó là hình của khối, không phải viền. */
    hidden?: true;
  };
  shadow?:
    | TokenRef
    | {
        x: Len; y: Len; blur: Len; spread: Len;
        color: ColorValue; inset?: boolean; hidden?: true;
      }[];
  /**
   * `container-type: inline-size` — bắt buộc phải biểu diễn được: `.hero`, `.s2`,
   * `.s4`, `.footer` và `.s3` đều dùng, và thang token bên trong chúng tính bằng cqw.
   */
  container?: {
    type?: 'inline-size' | 'size' | 'normal';
    name?: string;
  };
  effects?: {
    opacity?: number;
    blur?: Len;
    /**
     * Compiler TỰ SINH nhánh `@supports not ((backdrop-filter: blur(1px)) or
     * (-webkit-backdrop-filter: blur(1px))))` khi có `backdropFallbackColor`.
     * Đây là mẫu mà `.header__pill` và `_glass.css` đang dùng — nó là hành vi của
     * compiler chứ không phải một prop schema, nên tác giả không thể quên fallback.
     */
    backdropBlur?: Len;
    backdropSaturate?: number;
    backdropFallbackColor?: ColorValue;
    /** cursor.js cần 'difference'. */
    blend?: 'normal' | 'difference' | 'multiply' | 'screen' | 'overlay';
    overflow?: 'visible' | 'hidden' | 'clip' | 'auto';
    /**
     * `.header__pill` là `none` lúc expanded và `auto` lúc collapsed — pill nằm
     * đè lên nav nên phải cho click xuyên qua khi nó chỉ là nền. Không có prop này
     * thì header mất tương tác, và bug đó rất khó thấy khi review bằng mắt.
     */
    pointerEvents?: 'none' | 'auto';
    /** Khác `display: none`: giữ chỗ trong layout. Menu mobile cần phân biệt hai cái. */
    visibility?: 'visible' | 'hidden';
    /** `.header__pill` và cursor blend cần stacking context riêng. */
    isolation?: 'auto' | 'isolate';
    userSelect?: 'none' | 'auto';
    objectFit?: 'cover' | 'contain' | 'fill' | 'none';
    objectPosition?: string;
    cursor?: 'auto' | 'pointer' | 'none' | 'not-allowed';
    /**
     * Site gốc khai outline ở `:focus-visible` cho hero CTA và FAQ. Không biểu diễn
     * được nghĩa là bàn phím mất chỉ báo focus — lỗi a11y mà review bằng chuột
     * không bao giờ thấy.
     */
    outline?: { width: Len; style: 'solid' | 'dashed'; color: ColorValue; offset?: Len };
  };
  transform?: {
    x?: Len; y?: Len; scale?: number; rotate?: number; origin?: string;
    /**
     * Property `translate` ĐỘC LẬP, không phải hàm translate() trong `transform`.
     *
     * Hero và trust bar dùng nó có chủ đích, cùng lý do với ngoại lệ text-split:
     * GSAP sở hữu `transform` khi chạy effect, nên nếu CSS cũng khai `transform`
     * thì hai bên ghi đè nhau. Tách sang `translate` để CSS giữ được vị trí tĩnh
     * mà không tranh với GSAP.
     */
    translate?: { x?: Len; y?: Len };
  };
  transition?: {
    props: string[];
    duration?: TokenRef | Len;
    easing?: TokenRef;
    delay?: TokenRef | Len;
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Rich text
   ───────────────────────────────────────────────────────────────────────── */

export type RichText = InlineNode[];

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'em'; children: InlineNode[] }
  | { t: 'strong'; children: InlineNode[] }
  | { t: 'br' }
  | { t: 'link'; href: string; children: InlineNode[] }
  /** Target của text-split.js. GSAP sở hữu transform ở đây — xem effects/reveal.css. */
  | { t: 'split'; mode: 'lines' | 'words' | 'chars'; children: InlineNode[] }
  /** Target của counter.js. Định dạng qua Intl theo locale. */
  | { t: 'counter'; to: number; decimals?: number; suffix?: string }
  | { t: 'bind'; ref: BindingRef; fallback: string };

export interface BindingRef {
  /** 'collection' đã đặt chỗ sẵn cho Phase 5 để sau này không phải migrate schema. */
  source: 'site' | 'page' | 'collection';
  path: string;
  format?: 'text' | 'date' | 'currencyVND' | 'number';
}

/* ─────────────────────────────────────────────────────────────────────────
   RichDoc — RichText cộng một tầng khối
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Giá trị của field `richdoc`. Xem `zRichDoc` trong schema.ts cho lý do đầy đủ.
 *
 * Hai điều đáng nhớ ở kiểu này: `children` là `RichText` CŨ (nên mọi hàm đọc
 * inline dùng lại được), và tầng ngoài là một MẢNG chứ không phải một object
 * `{ type:'doc', content }` — `isBlank` của bản dịch entry dựa vào điều đó.
 */
export type RichDoc = Block[];

export type Block =
  | { b: 'p' | 'h2' | 'h3' | 'h4'; children: RichText }
  /** Mỗi mục là một hộp inline riêng — xem ghi chú `items` trong schema.ts. */
  | { b: 'ul' | 'ol'; items: ListItem[] }
  | { b: 'quote'; children: RichText }
  | { b: 'figure'; assetId: string; alt: string; decorative?: boolean; caption?: RichText }
  | { b: 'hr' };

export interface ListItem {
  children: RichText;
}

export type BlockKind = Block['b'];

/* ─────────────────────────────────────────────────────────────────────────
   Effect attachment
   ───────────────────────────────────────────────────────────────────────── */

export type EffectId = string;

export interface EffectAttachment {
  /** Instance id — cho phép một node mang hai bản của cùng một effect. */
  id: string;
  effect: EffectId;
  /** Validate bằng paramsSchema của Effect row, server-side. */
  params: Record<string, unknown>;
  /**
   * Key của `EffectPreset` đã sinh ra `params` này, nếu có. CHỈ để truy vết.
   *
   * Không ai đọc nó lúc chạy: preset được giải ngay tại validator
   * (`expandEffectPresets`) thành `effect` + `params` đã trộn, và đó là thứ đi
   * vào `PageVersion`. Lưu key rồi giải lúc render thì sửa một hàng preset sẽ
   * đổi mọi trang ĐÃ PUBLISH đang dùng nó, âm thầm, không qua nút Publish nào —
   * xem docblock `model EffectPreset`.
   *
   * Nhưng không ghi lại gì cả thì một node mang chín tham số lạ và không còn
   * dấu vết nào cho biết chúng từ đâu. Trường này là dấu vết đó.
   */
  fromPreset?: string;
  gates?: {
    minBreakpoint?: Breakpoint;
    /** Mirror của breakpoints.hasFinePointer(). tilt/magnetic/cursor cần cái này. */
    finePointerOnly?: boolean;
    /** Mặc định true. Runtime quyết định hạng, không phải skill. */
    respectReducedMotion?: boolean;
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Node
   ───────────────────────────────────────────────────────────────────────── */

export interface NodeBase {
  id: NodeId;
  parentId: NodeId | null;
  /** Có thứ tự. Node lá phải giữ []. */
  children: NodeId[];
  /** Nhãn hiện trong layer tree của builder. */
  name?: string;
  style: ResponsiveStyle;
  effects: EffectAttachment[];
  /**
   * Có render node này ra HTML không. Vắng mặt = có.
   *
   * ## Vì sao KHÔNG phải Responsive
   *
   * Đây là phép cắt khỏi DOM, không phải một lớp style: `NodeRenderer` trả `null`
   * cho cả nhánh, nên node con cũng không lên trang dù chúng không khai gì. Một
   * `Responsive<boolean>` ở đây nói dối về chuyện đó — và đã nói dối thật cho tới
   * 07/09/2026, khi trường này còn bốn khoá breakpoint mà chỉ `.base` được đọc.
   *
   * Ẩn THEO MÀN HÌNH là việc khác và đã có hai đường đúng, cả hai ra `@media`
   * thật: `style.<bp>.layout.display` và `style.<bp>.effects.visibility`. Làm
   * trường này phát media query nữa là đường thứ ba cho cùng một việc, và hai
   * nguồn cùng ghi `display` là chuyện `Grid.columns` đã dạy một lần.
   */
  render?: boolean;
  a11y?: { role?: string; label?: string; labelledBy?: NodeId };
  /** Đích của #anchor. Validate là slug. */
  htmlId?: string;
  /**
   * Vai trò của node bên trong effect hoặc composite của node cha. Phát ra
   * `data-part="<value>"`.
   *
   * ## Vì sao cần một trường riêng
   *
   * Effect như `carousel` phải tìm được viewport, hai mũi tên và nút dừng bên
   * trong nó. Ba cách khác đều tệ hơn:
   *
   *  - **Theo class**: class do preset đặt tên và người dùng đổi được trong
   *    builder, nên hợp đồng vỡ khi có ai đổi tên cho gọn.
   *  - **Theo vị trí** (`children[0]` là viewport): thêm một node bọc là hỏng, và
   *    hỏng im lặng.
   *  - **Dùng `htmlId`**: id phải duy nhất trong cả trang, còn `part` thì cố ý
   *    lặp lại — hai mũi tên của hai carousel đều là `prev`.
   *
   * `name` là nhãn cho người đọc trong cây node, đổi tự do. `part` là hợp đồng
   * với runtime. Trộn hai thứ nghĩa là đổi nhãn cho dễ đọc sẽ làm effect chết.
   *
   * ## Vì sao NHIỀU vai, cách nhau bằng khoảng trắng
   *
   * Một node có thể vừa là slot của composite cha vừa là bề mặt mà một effect
   * ở node KHÁC phải tìm ra: một panel của `PanelStack` (`part: "step-panel"`)
   * cũng là nền tối mà `nav-invert` cần nhận ra. Một `part` một vai nghĩa là hai
   * nhu cầu đó loại trừ nhau, và cách lách duy nhất là thêm một node bọc.
   *
   * Nên `part` là danh sách 1–4 slug, và selector tương ứng là
   * `[data-part~="<vai>"]` — `~=` đúng nghĩa "một từ trong danh sách". Đọc bằng
   * `partTokens` / `hasPart`, đừng so cả chuỗi.
   *
   * `entry:<khoá field>` là một vai đặc biệt: ô cắm thân bài của entry. Xem
   * `entrySlot` trong `NodeRenderer`.
   */
  part?: string;
  /**
   * Escape hatch có phạm vi, ship từ ngày đầu — xem rủi ro R1 trong plan.
   * Scoped về `[data-n="<id>"]` và validate qua postcss trước khi emit.
   */
  customCss?: string;
  /**
   * Vùng bị khóa: AI KHÔNG được sửa node này. Người phải mở khóa có lý do.
   * Dùng cho disclaimer, số giấy phép, giả định của savings model.
   */
  locked?: { reason: string; lockedBy: string; lockedAt: string };
}

export interface SectionNode extends NodeBase {
  type: 'Section';
  tag: 'section' | 'header' | 'footer' | 'main' | 'nav' | 'aside';
}

export interface StackNode extends NodeBase {
  type: 'Stack';
  direction: Responsive<'row' | 'column'>;
}

export interface GridTrack {
  kind: 'fr' | 'px' | 'rem' | 'minmax' | 'auto';
  v?: number;
  min?: Len;
  max?: Len;
}

export interface GridNode extends NodeBase {
  type: 'Grid';
  areas?: Responsive<string | null>;
  columns?: Responsive<GridTrack[]>;
}

export interface TextNode extends NodeBase {
  type: 'Text';
  tag: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span' | 'blockquote' | 'li';
  content: RichText;
  children: [];
}

export interface ImageNode extends NodeBase {
  type: 'Image';
  assetId: string | null;
  /** Schema bắt buộc. '' chỉ hợp lệ khi decorative = true. */
  alt: string;
  decorative?: boolean;
  fit: Responsive<'cover' | 'contain' | 'fill'>;
  ratio?: Responsive<string | null>;
  children: [];
}

export type ButtonAction =
  | { kind: 'link'; href: string; target?: '_blank'; rel?: string }
  /** Đi qua scroll.scrollTo đã port, để Lenis vẫn sở hữu chuyển động. */
  | { kind: 'anchor'; toNodeId: NodeId }
  | { kind: 'submit'; formId: string }
  | { kind: 'none' };

export interface ButtonNode extends NodeBase {
  type: 'Button';
  label: RichText;
  action: ButtonAction;
  /** Map sang class có sẵn trong components/button.css. */
  variant: 'primary' | 'ghost' | 'link';
  children: [];
}

export interface VideoNode extends NodeBase {
  type: 'Video';
  assetId: string | null;
  posterAssetId: string | null;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
  /**
   * Bao nhiêu dữ liệu trình duyệt tải trước khi phát.
   *
   * Bỏ trống = SUY TỪ `autoplay`: 'auto' khi tự phát, 'none' khi không. Đó là
   * hành vi có sẵn từ trước, nên mọi doc đang có không đổi gì.
   *
   * Khai tường minh khi muốn TỰ PHÁT mà KHÔNG tải sẵn — trường hợp có thật:
   * video nền tràn viền nặng vài MB, và nếu nó nằm dưới màn hình đầu tiên thì
   * `preload: "auto"` bắt nó tranh băng thông với ảnh hero ngay lúc tải trang.
   * 'metadata' là điểm giữa: trình duyệt biết kích thước để không nhảy layout,
   * nhưng chưa kéo khung hình nào.
   *
   * KHÔNG thay được cho việc chặn theo `prefers-reduced-motion`: 'none' vẫn
   * tải ngay khi người dùng chạm vào video hoặc khi trình duyệt tự quyết. Chặn
   * thật thì phải không gắn `src` — xem `hero-video.js` của bản static.
   */
  preload?: 'none' | 'metadata' | 'auto';
  children: [];
}

/**
 * Khối WebGL. **Chưa có runtime** (08/10/2026): renderer chỉ phát nhánh
 * `fallbackChildId` và một `data-canvas` mà chưa file nào trong `src/lib/motion` đọc.
 * Gắn `program` lúc này không làm gì trên site — xem `NodeRenderer`, nhánh `Canvas`.
 */
export interface CanvasNode extends NodeBase {
  type: 'Canvas';
  program: 'gradient' | 'displacement';
  /** Màu resolve từ token, đúng cách hero-webgl.js đang làm. */
  uniforms: Record<string, TokenRef | number>;
  /** Render cái này khi WebGL không dùng được. Bắt buộc có — không có thì không degrade. */
  fallbackChildId: NodeId | null;
}

export interface CustomCodeNode extends NodeBase {
  type: 'CustomCode';
  html?: string;
  css?: string;
  js?: string;
  /** Mặc định 'iframe' bất cứ khi nào js khác rỗng. JS không bao giờ chạy trong realm của trang. */
  mode: 'inline' | 'iframe';
  height?: Len;
  children: [];
}

/**
 * Bốn cơ chế hand-tuned không phân rã được thành primitive mà không viết lại
 * 4–6 tuần để ra thứ kém hơn. Sửa được copy/ảnh/param/style của slot content —
 * KHÔNG sửa được cơ chế. Đây là thỏa hiệp có chủ đích, đã chốt với chủ dự án.
 */
/** Composite của LÕI Quilder. */
export type CoreCompositeKey =
  | 'Carousel'
  | 'Form'
  | 'Accordion'
  | 'NavChart';

export interface CompositeNode extends NodeBase {
  type: 'Composite';
  /**
   * Composite lõi, hoặc composite của gói dự án đang chạy (chuỗi bất kỳ — kiểm bằng
   * `isKnownComposite` ở validator, không bằng kiểu). `(string & {})` giữ gợi ý tên lõi
   * trong editor mà vẫn nhận chuỗi khác.
   */
  composite: CoreCompositeKey | (string & {});
  /** Validate bằng Zod schema riêng của từng composite. */
  params: unknown;
  slots: Record<string, NodeId[]>;
}

/**
 * Nội dung ghi đè cho MỘT node bên trong một instance.
 *
 * Chỉ NỘI DUNG, không có style và không có cấu trúc. Đó là quyết định trung tâm
 * của mô hình instance:
 *
 *  - **Style luôn theo component.** Đổi màu nền trong component là mọi trang đổi
 *    theo, không sót chỗ nào. Cho override style thì sau sáu tháng mỗi trang một
 *    kiểu và component chỉ còn là gợi ý.
 *  - **Cấu trúc luôn theo component.** Cho thêm/bớt node trong instance thì
 *    "instance của X" không còn nghĩa gì, và địa chỉ override sẽ trôi mỗi lần
 *    component đổi.
 *
 * Thứ thật sự khác nhau giữa hai chỗ dùng cùng một thẻ sản phẩm là chữ, ảnh và
 * đường dẫn. Đó đúng là danh sách dưới đây.
 */
export interface ContentOverride {
  /** TextNode.content */
  content?: RichText;
  /** ButtonNode.label */
  label?: RichText;
  /** ImageNode.alt */
  alt?: string;
  /** ImageNode.assetId hoặc VideoNode.assetId — `null` để quay về asset của component. */
  assetId?: string | null;
  /**
   * VideoNode.posterAssetId — ảnh hiện trước khi phát.
   *
   * Khoá RIÊNG chứ không dùng chung `assetId`: `Video` có HAI nguồn asset, và
   * một khoá cho hai nguồn nghĩa là đổi poster sẽ đổi luôn video. Đây cũng là
   * lý do bản dịch không đổi được poster cho tới 11/09/2026.
   */
  posterAssetId?: string | null;
  /** ButtonNode.action.href, chỉ khi action là `link`. */
  href?: string;
  /** NodeBase.a11y.label */
  a11yLabel?: string;
  /**
   * CompositeNode.params — chỉ chuỗi hiển thị trong bảng trắng, khoá là đường dẫn
   * (`index.2.label`, `fields.0.placeholder`). Xem `render/param-paths.ts`.
   */
  params?: Record<string, string>;
}

/* ─────────────────────────────────────────────────────────────────────────
   Collection: truy vấn và lặp

   Ba kiểu dưới đây được LƯU BÊN TRONG doc, nên chúng phải khai ở đây chứ không
   ở `src/lib/collections/`. `validate.ts` và `migrate.ts` chạy trên doc, và một
   kiểu nằm ngoài file này là một kiểu hai tầng đó không biết tới.
   ───────────────────────────────────────────────────────────────────────── */

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

/**
 * Điều kiện lọc — union có thẻ `k`, KHÔNG phải chuỗi.
 *
 * Cùng lý do `Len` không phải chuỗi `calc()`: một chuỗi filter tự do đi từ builder
 * xuống Prisma là một đường SQL injection, và AI qua MCP sẽ là thứ đầu tiên đi qua
 * nó. Một khoá thẻ duy nhất (`k`) để `z.discriminatedUnion` dùng được — với
 * `z.union` thì lỗi trả về là danh sách mọi nhánh đã thử, vô dụng cho người sửa.
 *
 * Ba nguồn danh mục gộp vào MỘT nhánh, `ids` optional.
 *
 * Không tách thành ba nhánh cùng `k: 'taxonomy'`: `z.discriminatedUnion` đòi giá
 * trị thẻ DUY NHẤT và sẽ ném lỗi lúc dựng schema — mà file này bị import ở khắp
 * nơi, nên đó là cả app chết lúc khởi động, không phải một test đỏ.
 *
 * Luật "from='fixed' thì phải có ids" được giữ bằng `.superRefine` ở tầng zod,
 * tức tầng thật sự chặn dữ liệu đến từ AI qua MCP.
 */
export type CollectionFilter =
  | { k: 'field'; field: string; op: FilterOp; value: string | number | boolean }
  | { k: 'taxonomy'; from: 'fixed' | 'current-entry' | 'url'; ids?: string[] }
  /**
   * Lọc theo giá trị của một field `relation`.
   *
   * ## Vì sao một nhánh RIÊNG, không phải `k: 'field'` với `op: 'eq'`
   *
   * Hai lý do, và cái thứ hai mới là lý do thật:
   *
   *  1. **`relation` có HAI hình dạng trong JSONB.** `cardinality: 'one'` lưu một
   *     chuỗi, `'many'` lưu một mảng chuỗi — và một field vừa đổi cardinality để
   *     lại hàng cũ mang hình dạng cũ (xem `relationIds`). `op: 'eq'` chỉ khớp
   *     hình dạng thứ nhất, nên nửa số hàng biến mất mà không có lỗi nào.
   *  2. **`k: 'field'` không có `from`.** Giá trị lấy từ URL là thứ cả trang danh
   *     mục dựa vào, và nó cần một chỗ để nói "lấy từ ngữ cảnh" thay vì một hằng
   *     ghi cứng trong doc.
   *
   * Đây là thứ thay cho `k: 'taxonomy'` ở mô hình dữ liệu mới: `tin-tuc` không
   * còn field `taxonomy`; danh mục của nó là field `relation` tên `category` trỏ
   * sang loại `danh-muc`.
   *
   * `from: 'fixed'` phải có `ids` — cưỡng chế ở tầng zod, cùng chỗ và cùng lý do
   * với luật ấy của `k: 'taxonomy'`.
   */
  | { k: 'relation'; field: string; from: 'fixed' | 'url'; ids?: string[] }
  | { k: 'excludeCurrent' };

export interface CollectionQuery {
  typeKey: string;
  /** Nối bằng AND. Không có OR ở v1 — chưa có yêu cầu thật nào cần. */
  filter?: CollectionFilter[];
  sort?: { field: string; dir: 'asc' | 'desc' }[];
  /**
   * BẮT BUỘC, trần 100.
   *
   * Không có nó thì một trang nhỡ tay render 4.000 entry, và điều đó chỉ lộ ra ở
   * production sau bài thứ 500.
   */
  limit: number;
  skip?: number;
}

/**
 * Trần cứng cho `CollectionQuery.limit`.
 *
 * Khai Ở ĐÂY vì `CollectionQuery` khai ở đây. `query-build.ts` re-export nó chứ
 * KHÔNG khai một con số thứ hai — hai hằng cho một trần sẽ lệch nhau ở lần đầu có
 * ai nâng nó, và bản không được nâng là bản zod dùng để từ chối.
 */
export const MAX_QUERY_LIMIT = 100;

/**
 * Cột sắp xếp được — ĐÓNG, và chỉ gồm cột THẬT của bảng `Entry`.
 *
 * ## Vì sao không sắp được theo một field trong `data`
 *
 * Prisma KHÔNG sắp xếp theo đường dẫn bên trong một cột JSONB: `orderBy` chỉ nhận
 * `SortOrder`, không nhận object `{ path, sort }` (đo trực tiếp: "Argument `data`:
 * Invalid value provided. Expected SortOrder, provided Object"). `where` thì làm
 * được — đó là lý do dễ tưởng `orderBy` cũng làm được. Cách duy nhất là
 * `$queryRaw`, tức mất kiểu của Prisma và tự cầm rủi ro injection.
 *
 * Sắp theo tên bài theo bảng chữ cái vẫn gần đúng bằng `slug`, vì slug sinh từ
 * tiêu đề.
 *
 * ## Vì sao khai Ở ĐÂY
 *
 * Cùng lý do với `MAX_QUERY_LIMIT` ngay trên: `CollectionQuery.sort` khai ở đây.
 * Trước đây danh sách này có HAI bản — một ở `query-build.ts` và một `z.enum(…)`
 * chép tay trong `doc/schema.ts` — và hậu quả của hai bản là zod từ chối đúng cái
 * cột vừa được thêm cho tầng truy vấn. Giờ cả hai đọc hằng này.
 */
export const SORTABLE_COLUMNS = [
  'publishedAt',
  'updatedAt',
  'createdAt',
  'slug',
  /** Xem `Entry.viewCount`. Cột "Bài viết nổi bật" = 10 bài xem nhiều nhất. */
  'viewCount',
] as const;

/**
 * Danh mục nào được hiện ra ở khối lặp nguồn `taxonomy`.
 *
 * Vắng cả hai = hiện MỌI danh mục của loại, tức hành vi trước khi hai ô này tồn
 * tại. Giữ như vậy là điều kiện để không trang nào đang chạy đổi hình dạng.
 */
export interface TaxonomyFilter {
  /** `true` = chỉ danh mục `status: 'published'`. Xem `Taxonomy.status`. */
  published?: boolean;
  /**
   * Số bài TỐI THIỂU để một danh mục được hiện. `1` = "có bài thì mới hiện".
   *
   * Đếm bài ĐÃ ĐĂNG và chưa lưu trữ, bằng một `groupBy` riêng — KHÔNG bằng số
   * entry mà khối lặp nạp về. Số đó đã bị cắt bởi `limit` của cấp trong và bởi
   * trần hàng của truy vấn, nên dùng nó sẽ ẩn mất một danh mục có bài thật.
   */
  minEntries?: number;
}

/**
 * Thứ tự của dải danh mục. Vắng = `order` rồi `name`, thứ tự người dựng kéo tay.
 *
 * `count` sắp theo số bài đã đăng — "chuyên mục nhiều bài nhất lên trước". Nó
 * dùng chính con số của `minEntries`, nên hai ô này không thể nói hai điều khác
 * nhau về cùng một danh mục.
 */
export interface TaxonomySort {
  field: 'order' | 'name' | 'count';
  dir: 'asc' | 'desc';
}

export type RepeatSource =
  /** "10 tin mới nhất" */
  | { kind: 'query'; query: CollectionQuery }
  /** "tin liên quan nhất" — xếp theo số danh mục trùng với bài đang mở */
  | { kind: 'related'; typeKey: string; limit: number }
  /** Một lần mỗi danh mục — cấp NGOÀI của "FAQ theo danh mục" */
  | { kind: 'taxonomy'; typeKey: string; filter?: TaxonomyFilter; sort?: TaxonomySort }
  /** Entry của danh mục do khối cha đang lặp — cấp TRONG. Chỉ hợp lệ dưới `taxonomy`. */
  | { kind: 'group-entries'; limit: number }
  /**
   * Bản ghi mà một field `relation` của bài ĐANG MỞ trỏ tới.
   *
   * Khác `related` ở chỗ nó KHÔNG đoán: `related` xếp theo số danh mục trùng, còn
   * đây đọc đúng danh sách người biên tập đã chọn, đúng thứ tự họ đã kéo. "Bài
   * viết cùng chuyên đề" khai bằng quan hệ thật thay vì suy ra từ danh mục.
   *
   * `path` là khoá của field `relation` trên loại của bài đang mở.
   */
  | { kind: 'relation'; path: string; limit: number }
  /** Một field `blocks` hoặc `group` repeatable của entry đang mở */
  | { kind: 'field'; path: string };

/**
 * Lặp một `Instance` theo dữ liệu.
 *
 * ## Vì sao đây là một field trên Instance, không phải một node type mới
 *
 * Bộ node type đóng băng 12 tháng, và không cần mở: `Instance` đã là "dùng lại một
 * component, override CHỈ nội dung, còn liên kết", và `ContentOverride` đã có đúng
 * `content / label / alt / assetId / href / a11yLabel` — chính xác những thứ khác
 * nhau giữa hai thẻ tin tức. Khoảng cách và số cột do `Stack`/`Grid` cha lo.
 *
 * `optional` là điều kiện để `schemaVersion` giữ nguyên 1.
 */
export interface RepeatSpec {
  source: RepeatSource;
  /**
   * Khoá là field của entry; giá trị là node LOCAL trong cây component và vai của
   * nó. Cùng cách địa chỉ hoá như `overrides`, nên node bị xoá khỏi component thì
   * ánh xạ bị BỎ QUA lúc render — y như override mồ côi.
   */
  map: Record<string, { nodeId: NodeId; as: keyof ContentOverride }>;
  /** Chỉ cho `source.kind === 'field'` trên một field `blocks`: loại khối → `Preset.id`. */
  blockComponents?: Record<string, string>;
  /** Không có item nào thì làm gì. Vắng = hiện đúng một lần với nội dung của component. */
  empty?: { hide: true } | { text: RichText };
}

/**
 * Một lần dùng lại component, CÒN LIÊN KẾT.
 *
 * Khác `presetToOps` (đóng dấu một bản sao rời): instance giữ liên kết tới
 * `componentId`, nên sửa component là mọi instance đổi theo. Phần riêng của từng
 * trang nằm trong `overrides`, đánh địa chỉ bằng id node LOCAL trong cây
 * component.
 *
 * ## `children` gần như luôn rỗng — một ngoại lệ duy nhất
 *
 * Con của instance đến từ cây component, không nằm trong doc. Cho phép con thật ở
 * đây nghĩa là có hai nguồn con và renderer phải chọn — và bất kỳ lựa chọn nào
 * cũng làm một trong hai nguồn im lặng biến mất. Nên `Instance` vẫn nằm trong
 * `LEAF_TYPES`, và mọi màn builder vẫn coi nó là lá.
 *
 * Ngoại lệ: một instance ĐANG LẶP THEO DANH MỤC nhận đúng MỘT con, và con ấy phải
 * là một instance lặp nguồn `group-entries`. Đó là cây "FAQ theo danh mục" —
 * ngoài thì một khối mỗi danh mục, trong thì N bài của danh mục ấy. Renderer,
 * `resolveAllRepeats` và luật `repeat_group_parent` đã sẵn sàng cho nó từ mốc 3;
 * thứ thiếu suốt thời gian đó là đường GHI, và cái giá đã phải trả ở `Website-MM`
 * là trang `/blogs` gõ tay một hàng cho mỗi danh mục, mỗi hàng ghim cứng một id.
 *
 * Hai nguồn con KHÔNG chồng nhau trong ca này: cây component dựng phần khung của
 * một danh mục, còn con trong doc là khối lặp cấp trong. Renderer render cả hai,
 * theo thứ tự đó, bên trong cùng một bọc của mỗi item.
 *
 * ## Node bị xoá khỏi component
 *
 * Override trỏ vào một local id không còn tồn tại thì bị BỎ QUA lúc render, y
 * như bản dịch mồ côi. Nó vô hại và phát hiện được; ném lỗi ở đây sẽ làm cả
 * trang trắng vì một chuỗi không ai đọc tới.
 */
export interface InstanceNode extends NodeBase {
  type: 'Instance';
  /** `Preset.id`. */
  componentId: string;
  /** Khoá là id node LOCAL trong cây component. */
  overrides: Record<NodeId, ContentOverride>;
  /** Rỗng, TRỪ cây lặp hai cấp — xem docblock. Trần một con, cưỡng chế ở zod. */
  children: NodeId[];
  /**
   * Có mặt = instance này render N lần, một lần cho mỗi item. Vắng = render 1 lần,
   * hành vi y như trước.
   */
  repeat?: RepeatSpec;
}

export type Node =
  | SectionNode
  | StackNode
  | GridNode
  | TextNode
  | ImageNode
  | ButtonNode
  | VideoNode
  | CanvasNode
  | CustomCodeNode
  | CompositeNode
  | InstanceNode;

export type NodeType = Node['type'];

export const NODE_TYPES = [
  'Section', 'Stack', 'Grid', 'Text', 'Image',
  'Button', 'Video', 'Canvas', 'CustomCode', 'Composite', 'Instance',
] as const satisfies readonly NodeType[];

/** Node lá — không nhận con. Validator tầng semantic dùng bảng này. */
export const LEAF_TYPES = [
  // `Instance` là lá trong DOC: con của nó đến từ cây component, không nằm ở đây.
  // Không khai vào đây thì validator cho chèn node con vào instance, và renderer
  // sẽ im lặng bỏ qua chúng — nội dung biến mất mà không có lỗi nào.
  'Text', 'Image', 'Button', 'Video', 'CustomCode', 'Instance',
] as const satisfies readonly NodeType[];

export function isLeafType(t: NodeType): boolean {
  return (LEAF_TYPES as readonly NodeType[]).includes(t);
}

/* ── `part`, đọc thành từng vai ───────────────────────────────────────── */

/**
 * Vai của một node, tách từ `part` — xem `NodeBase.part`.
 *
 * Tồn tại vì `part` giữ được NHIỀU vai. Mọi chỗ đọc `part` phải đi qua đây thay
 * vì so sánh cả chuỗi: `part === 'nav-dark'` sẽ trượt trên
 * `part = "step-panel nav-dark"`, và trượt IM LẶNG.
 */
export function partTokens(part: string | undefined): string[] {
  if (!part) return [];
  return part.trim().split(/\s+/).filter(Boolean);
}

/** `part` có vai này không. Cùng ngữ nghĩa với selector CSS `[data-part~="..."]`. */
export function hasPart(part: string | undefined, role: string): boolean {
  return partTokens(part).includes(role);
}

/** Khoá field mà `part` khai là ô cắm thân bài (`entry:<khoá>`), nếu có. */
export function entryFieldOf(part: string | undefined): string | null {
  const hit = partTokens(part).find((t) => t.startsWith('entry:'));
  return hit ? hit.slice('entry:'.length) : null;
}
