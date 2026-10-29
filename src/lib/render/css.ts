/**
 * Doc → CSS compiler.
 *
 * ## Vì sao là stylesheet sinh ra chứ không phải Tailwind arbitrary value
 *
 * Tailwind JIT quét *source file lúc build*. Cây node nằm trong Postgres và đổi
 * SAU KHI Docker image đã build, nên `class="pt-[53.25px]"` sinh từ một DB row sẽ
 * không bao giờ được compile vào stylesheet. Đây là lý do cơ học, không phải khẩu vị.
 *
 * Inline `style` thì không biểu diễn được `@media`, `:hover`, `::before` — mà ~40%
 * CSS của site gốc phụ thuộc breakpoint và state.
 *
 * ## Vì sao output bị chặn
 *
 * Tên property ở đây là enum ĐÓNG (các hàm emit* bên dưới là toàn bộ bề mặt), và mọi
 * value đi qua `len()` / `color()` — hai hàm chỉ nhận tagged union. Không có đường nào
 * để một string tự do lọt vào output. `background: url(javascript:…)` là bất khả.
 *
 * ## Thứ tự output
 *
 * 1. Rule `base` của mọi node
 * 2. Mỗi breakpoint MỘT khối `@media` chứa override của tất cả node — gom theo
 *    breakpoint chứ không theo node, nên số khối `@media` là 4 thay vì 4×N.
 * 3. State (`:hover`, `:focus-visible`, `[data-*]`)
 * 4. `customCss` đã scope
 *
 * Output là deterministic: cùng doc → cùng bytes → hash ổn định → cache được.
 */

import { createHash } from 'node:crypto';

import {
  BREAKPOINT_PX,
  OVERRIDE_BREAKPOINTS,
  STATE_SELECTOR,
  STYLE_STATES,
  type StyleState,
} from '@/lib/design/breakpoints';
import type {
  CalcOp,
  ColorValue,
  Doc,
  GridTrack,
  Len,
  Node,
  StyleProps,
  TokenRef,
} from '@/lib/doc/types';
import { componentCustomScope, componentNodeScope, nodeScope, sanitizeCustomCss } from './sanitize-css';

/* ── Value resolution ─────────────────────────────────────────────────── */

function isTokenRef(v: unknown): v is TokenRef {
  return typeof v === 'object' && v !== null && '$token' in v;
}

/** Token ref → `var(--name)`. Tên đã được validator đối chiếu với bảng Token. */
function tokenVar(t: TokenRef): string {
  return `var(--${t.$token})`;
}

const CALC_SIGN: Record<CalcOp, string> = {
  add: '+', sub: '-', mul: '*', div: '/',
};

function num(n: number, field: string): string {
  if (!Number.isFinite(n)) {
    throw new CssCompileError(`${field} không phải số hữu hạn: ${String(n)}`);
  }
  return String(n);
}

export function len(v: Len): string {
  // Chặn ở đây trước mọi phép `in`.
  //
  // `'clamp' in v` ném TypeError thô khi `v` không phải object — và vì compiler
  // chạy trong render của server component, TypeError đó làm SẬP CẢ TRANG với
  // một stack trỏ vào `css.ts` mà không nói được node nào, thuộc tính nào. Người
  // dùng chỉ thấy builder chết sau khi sửa một ô.
  //
  // `CssCompileError` thì mang thông điệp đọc được và đi qua đúng đường xử lý lỗi.
  if (v === null || typeof v !== 'object') {
    throw new CssCompileError(
      `Giá trị độ dài không hợp lệ: ${JSON.stringify(v)}. Cần { v, u } hoặc { $token }.`,
    );
  }

  if (isTokenRef(v)) return tokenVar(v);

  /*
   * Xoá giá trị layer dưới đã đặt.
   *
   * `unset` chứ không `initial`: với thuộc tính KẾ THỪA (`font-size`, `color`) thì
   * `initial` cắt luôn cả phần kế thừa từ cha, tức nó làm nhiều hơn thứ người dùng
   * yêu cầu. `unset` cư xử như `inherit` cho thuộc tính kế thừa và như `initial` cho
   * thuộc tính không kế thừa — đúng nghĩa "quên thứ base đặt, giữ nguyên phần còn
   * lại của cascade".
   *
   * Kiểm ở đây, TRƯỚC `'clamp' in v`: mọi nhánh dưới đều giả định `v` là một phép
   * tính, và một nhánh sentinel lọt xuống đó sẽ ném với thông điệp nói về clamp.
   */
  if ('unset' in v) return 'unset';

  if ('clamp' in v) {
    if (!Array.isArray(v.clamp) || v.clamp.length !== 3) {
      throw new CssCompileError(`clamp cần đúng 3 giá trị, nhận: ${JSON.stringify(v.clamp)}`);
    }
    const [min, pref, max] = v.clamp;
    return `clamp(${len(min)}, ${len(pref)}, ${len(max)})`;
  }
  if ('max' in v) {
    if (!v.max.length) throw new CssCompileError('max() rỗng');
    return `max(${v.max.map(len).join(', ')})`;
  }
  if ('min' in v) {
    if (!v.min.length) throw new CssCompileError('min() rỗng');
    return `min(${v.min.map(len).join(', ')})`;
  }
  if ('calc' in v) {
    const { op, a, b } = v.calc;
    const sign = CALC_SIGN[op];
    if (!sign) throw new CssCompileError(`toán tử calc không hợp lệ: ${String(op)}`);
    const right = typeof b === 'number' ? num(b, 'calc.b') : len(b);
    // Bọc ngoặc quanh mọi phép tính: lồng nhau vẫn đúng thứ tự ưu tiên, và
    // `(100% - var(--mm-block-w)) / 2` của Section 6 ra đúng như bản gốc.
    return `calc(${len(a)} ${sign} ${right})`;
  }

  // Số 0 không cần đơn vị; giữ nguyên phần thập phân (--mm-nav-h: 53.25px là có chủ đích).
  if (!Number.isFinite(v.v)) {
    throw new CssCompileError(`độ dài không phải số hữu hạn: ${String(v.v)}`);
  }
  return v.v === 0 ? '0' : `${v.v}${v.u}`;
}

/** #rgb / #rgba / #rrggbb / #rrggbbaa — không nhận gì khác. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export class CssCompileError extends Error {}

export function color(v: ColorValue): string {
  // Cùng lý do với `len()`: `'mix' in v` ném TypeError thô nếu `v` không phải
  // object, và TypeError trong render của server component làm sập cả trang.
  if (v === null || typeof v !== 'object') {
    throw new CssCompileError(
      `Giá trị màu không hợp lệ: ${JSON.stringify(v)}. Cần { hex } hoặc { $token }.`,
    );
  }

  if (isTokenRef(v)) return tokenVar(v);
  if ('mix' in v) {
    const [a, b] = v.mix;
    const amount = Number(v.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
      throw new CssCompileError(`color-mix amount ngoài khoảng: ${String(v.amount)}`);
    }
    return `color-mix(in srgb, ${color(a)} ${amount}%, ${color(b)})`;
  }

  // Validate ở ĐÂY, tại điểm emit — không tin tầng validator phía trên.
  //
  // Test R1 phát hiện ra: hex `red;background:url(javascript:alert(1))` thoát ra
  // được thành một declaration thứ hai. Nguyên tắc "sanitize lúc render chứ không
  // lúc lưu" (vốn viết cho CustomCode) phải áp cho cả compiler: siết định dạng về
  // sau vẫn bảo vệ được dữ liệu đã nằm sẵn trong DB, và một bug ở validator không
  // biến thành CSS injection trên site production.
  const hex = v.hex.startsWith('#') ? v.hex : `#${v.hex}`;
  if (!HEX_RE.test(hex)) {
    throw new CssCompileError(`Giá trị hex không hợp lệ: ${JSON.stringify(v.hex)}`);
  }

  if (v.alpha === undefined || v.alpha >= 1) return hex;
  const alpha = Number(v.alpha);
  if (!Number.isFinite(alpha) || alpha < 0) {
    throw new CssCompileError(`alpha không hợp lệ: ${String(v.alpha)}`);
  }
  return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
}

/**
 * Mọi string tự do đi ra output đều phải qua đây.
 *
 * `gridArea`, `aspectRatio`, `transform.origin`, `container.name`,
 * `background-position` và `transition.props` đều là string trong schema, nên đều
 * thoát ra được thành declaration mới y hệt lỗ hổng hex mà test R1 tìm ra.
 * Charset cho phép: chữ, số, khoảng trắng, `-` `_` `.` `%` `/`. Không có `;` `:`
 * `(` `)` `{` `}` `"` `'` `\` — tức không có cách nào đóng declaration hiện tại.
 */
const SAFE_RE = /^[a-zA-Z0-9 _.\-%/]+$/;

function safe(v: string | undefined, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (!SAFE_RE.test(v)) {
    throw new CssCompileError(`${field} chứa ký tự không cho phép: ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * `size.aspectRatio` → một giá trị `aspect-ratio` HỢP LỆ, hoặc một tiếng kêu.
 *
 * Grammar là `auto || <ratio>`: hai token tách nhau bằng khoảng trắng. Dữ liệu thật
 * mang `auto152/44` — dính liền, nên `auto152` là một ident và trình duyệt VỨT cả
 * declaration. Nhìn từ người dựng thì "phát ra CSS chết" không khác gì "không phát
 * gì": stylesheet có dòng đó, mà `getComputedStyle` trả `auto`.
 *
 * Vá chỗ dính thay vì ném, vì dữ liệu quyết định: đếm ngày 14/09/2026 trên 4804
 * `PageVersion`, 95 `PresetVersion` và 6 preset đang dùng chỉ ra 10 giá trị khác
 * nhau — 2 hợp lệ và 8 dạng `auto<w>/<h>` do bản migrate html→doc sinh, nằm trong
 * header và footer tức MỌI trang. Ném ở đó là làm trắng cả site vì một dấu cách.
 *
 * Phần còn lại thì ném: đó là điều kiện để một lỗi gõ MỚI không lặp lại đúng kiểu
 * im lặng này. Cùng nguyên tắc với hex ở `color()` — chặn tại điểm emit.
 *
 * Lưu ý cho người dựng (renderer không làm hộ được): `auto <ratio>` trên ảnh nghĩa
 * là ưu tiên tỉ lệ NỘI TẠI, nên muốn ghim ô thì giá trị phải bỏ `auto`.
 */
const RATIO_TOKEN_RE = /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/;

function ratioTokens(v: string): string[] | null {
  const tokens = v.trim().replace(/\s*\/\s*/g, '/').split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 2) return null;
  let autos = 0;
  let ratios = 0;
  for (const t of tokens) {
    if (t === 'auto') autos += 1;
    else if (RATIO_TOKEN_RE.test(t)) ratios += 1;
    else return null;
  }
  return autos <= 1 && ratios <= 1 ? tokens : null;
}

function aspectRatio(raw: string | undefined): string | undefined {
  const v = safe(raw, 'size.aspectRatio');
  if (v === undefined) return undefined;

  // Hợp lệ thì trả NGUYÊN VĂN: `244 / 66` người dựng gõ không có lý do gì để bị
  // viết lại, và output của compiler là khoá cache nên càng ít biến đổi càng tốt.
  if (ratioTokens(v)) return v;

  const repaired = v.trim().replace(/^auto(?=[\d.])/, 'auto ');
  if (ratioTokens(repaired)) return repaired;

  throw new CssCompileError(
    `size.aspectRatio không phải tỉ lệ CSS: ${JSON.stringify(raw)}. ` +
      'Cần dạng "16/9", "244 / 66", "auto" hoặc "auto 16/9".',
  );
}

/* ── Asset ────────────────────────────────────────────────────────────── */

/**
 * Hợp đồng ảnh nền có HAI nửa — và nửa thứ hai từng không tồn tại.
 *
 * Compiler cố ý không biết gì về S3, nên `fill.image` phát ra một custom property
 * (`background-image: var(--asset-<id>)`) còn renderer định nghĩa property đó trên
 * chính element ấy (`assetVars` trong `NodeRenderer.tsx`). Nửa đầu có từ commit đầu
 * tiên; nửa sau thì không — nên mọi ảnh nền đều rơi về `none`, vì một `var()` không
 * có giá trị là "invalid at computed-value time". Không lỗi, không cảnh báo, và
 * người dựng trang thử đầu tiên đã phải đi vòng bằng customCss gõ cứng URL CDN.
 *
 * Tên biến sinh ở ĐÂY, một chỗ duy nhất, vì hai file phải gọi đúng cùng một chuỗi.
 * Lệch một ký tự giữa hai bên là dựng lại đúng lỗi cũ, im lặng y như vậy.
 *
 * Và `assetId` là string TỰ DO trong schema (`z.string().min(1)`) trong khi ở đây nó
 * đi thẳng vào TÊN một property — cùng lỗ hổng mà test R1 tìm ra ở hex. Siết ngay
 * tại điểm emit, không tin tầng trên.
 */
const ASSET_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function assetVarName(assetId: string): string {
  if (typeof assetId !== 'string' || !ASSET_ID_RE.test(assetId)) {
    throw new CssCompileError(`assetId không hợp lệ: ${JSON.stringify(assetId)}`);
  }
  return `--asset-${assetId}`;
}

/**
 * URL của asset → giá trị `url("…")`.
 *
 * Chặn theo SCHEME chứ không theo charset: chỉ `https://`, `http://`, `//host` và
 * `/đường-dẫn` đi qua, nên `url(javascript:…)` và `data:text/html,…` là bất khả —
 * đúng như docblock đầu file cam kết.
 *
 * Còn ký tự đóng được `url("…")` (`"` `\` `(` `)` và khoảng trắng) thì MÃ HOÁ chứ
 * không ném: URL do chính pipeline upload sinh ra, và một dấu cách trong key S3 mà
 * làm trắng cả trang là cái giá sai. Percent-encoding vẫn trỏ đúng file đó.
 */
const ASSET_URL_RE = /^(?:(?:https?:)?\/\/[^\r\n]+|\/[^\r\n]*)$/;

export function assetUrlValue(url: string): string {
  if (typeof url !== 'string' || !ASSET_URL_RE.test(url)) {
    throw new CssCompileError(`URL asset không hợp lệ: ${JSON.stringify(url)}`);
  }
  const escaped = url.replace(
    /["\\()\s]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
  return `url("${escaped}")`;
}

function lenOrKeyword(
  v: Len | string | undefined,
  keywords: Record<string, string>,
): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return keywords[v];
  return len(v);
}

/* ── Declaration emitters ─────────────────────────────────────────────── */

type Decl = [prop: string, value: string];

const JUSTIFY: Record<string, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end',
  between: 'space-between', around: 'space-around',
};
const ALIGN: Record<string, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end',
  stretch: 'stretch', baseline: 'baseline',
};

function push(out: Decl[], prop: string, value: string | undefined): void {
  if (value !== undefined) out.push([prop, value]);
}

/** Grid track list — cũng là tagged union, không phải string tự do. */
function tracks(list: GridTrack[]): string {
  return list
    .map((t) => {
      switch (t.kind) {
        case 'auto':
          return 'auto';
        case 'fr':
          return `${num(t.v ?? 1, 'track.v')}fr`;
        case 'px':
        case 'rem':
          return `${num(t.v ?? 0, 'track.v')}${t.kind}`;
        case 'minmax':
          if (!t.min || !t.max) throw new CssCompileError('minmax thiếu min hoặc max');
          return `minmax(${len(t.min)}, ${len(t.max)})`;
        default:
          throw new CssCompileError(`grid track không hợp lệ: ${JSON.stringify(t)}`);
      }
    })
    .join(' ');
}

/**
 * Toàn bộ bề mặt property mà compiler có thể phát ra. Thêm property mới nghĩa là
 * sửa hàm này — cố ý làm nó thành một chỗ duy nhất phải xét lại.
 */
export function declarations(s: Partial<StyleProps>): Decl[] {
  const out: Decl[] = [];

  if (s.layout) {
    const l = s.layout;
    push(out, 'display', l.display);
    push(out, 'flex-direction', l.flexDirection);
    push(out, 'gap', l.gap && len(l.gap));
    push(out, 'row-gap', l.rowGap && len(l.rowGap));
    push(out, 'column-gap', l.columnGap && len(l.columnGap));
    push(out, 'align-items', l.align && ALIGN[l.align]);
    push(out, 'justify-content', l.justify && JUSTIFY[l.justify]);
    push(out, 'flex-wrap', l.wrap === undefined ? undefined : l.wrap ? 'wrap' : 'nowrap');
    push(out, 'align-self', l.alignSelf && (ALIGN[l.alignSelf] ?? l.alignSelf));
    push(out, 'align-content', l.alignContent && (JUSTIFY[l.alignContent] ?? ALIGN[l.alignContent]));
    push(out, 'justify-items', l.justifyItems);
    if (l.flex) {
      const basis = l.flex.basis === undefined ? 'auto'
        : l.flex.basis === 'auto' ? 'auto' : len(l.flex.basis);
      push(out, 'flex',
        `${num(l.flex.grow ?? 0, 'flex.grow')} ${num(l.flex.shrink ?? 1, 'flex.shrink')} ${basis}`);
    }
    push(out, 'grid-area', safe(l.gridArea, 'layout.gridArea'));
    push(out, 'grid-template-columns', l.gridTemplateColumns && tracks(l.gridTemplateColumns));
    push(out, 'grid-template-rows', l.gridTemplateRows && tracks(l.gridTemplateRows));
    push(out, 'grid-auto-columns', l.gridAutoColumns && tracks([l.gridAutoColumns]));
    push(out, 'grid-auto-flow', l.autoFlow);
    push(out, 'place-items', l.placeItems);
    if (l.span?.column !== undefined) {
      push(out, 'grid-column',
        l.span.column === 'full' ? '1 / -1' : `span ${l.span.column}`);
    }
    if (l.span?.row !== undefined) push(out, 'grid-row', `span ${l.span.row}`);
  }

  if (s.size) {
    const z = s.size;
    push(out, 'inline-size', lenOrKeyword(z.width, { auto: 'auto', full: '100%' }));
    push(out, 'block-size',
      lenOrKeyword(z.height, { auto: 'auto', full: '100%', svh: '100svh' }));
    push(out, 'min-inline-size', z.minWidth && len(z.minWidth));
    push(out, 'max-inline-size',
      lenOrKeyword(z.maxWidth, { measure: 'var(--measure)', container: 'var(--max-width)' }));
    push(out, 'min-block-size', z.minHeight && len(z.minHeight));
    push(out, 'max-block-size', z.maxHeight && len(z.maxHeight));
    push(out, 'aspect-ratio', aspectRatio(z.aspectRatio));
  }

  if (s.spacing) {
    const p = s.spacing;
    // Logical property, giống hệt site gốc.
    push(out, 'padding-block-start', p.pt && len(p.pt));
    push(out, 'padding-inline-end', p.pr && len(p.pr));
    push(out, 'padding-block-end', p.pb && len(p.pb));
    push(out, 'padding-inline-start', p.pl && len(p.pl));
    push(out, 'margin-block-start', p.mt && len(p.mt));
    push(out, 'margin-inline-end', p.mr && len(p.mr));
    push(out, 'margin-block-end', p.mb && len(p.mb));
    push(out, 'margin-inline-start', p.ml && len(p.ml));
  }

  if (s.position) {
    const p = s.position;
    push(out, 'position', p.kind);
    push(out, 'inset-block-start', p.top && len(p.top));
    push(out, 'inset-inline-end', p.right && len(p.right));
    push(out, 'inset-block-end', p.bottom && len(p.bottom));
    push(out, 'inset-inline-start', p.left && len(p.left));
    push(out, 'z-index', p.z === undefined ? undefined : isTokenRef(p.z) ? tokenVar(p.z) : String(p.z));
  }

  if (s.typography) {
    const t = s.typography;
    push(out, 'color', t.color && color(t.color));
    push(out, 'font-family', t.family && tokenVar(t.family));
    push(out, 'font-size', t.size && len(t.size));
    push(out, 'font-weight', t.weight && String(t.weight));
    push(out, 'line-height',
      t.leading === undefined ? undefined
        : isTokenRef(t.leading) ? tokenVar(t.leading) : String(t.leading));
    push(out, 'letter-spacing', t.tracking && len(t.tracking));
    push(out, 'text-align', t.align);
    push(out, 'text-transform', t.transform);
    // "normal" trong schema nghĩa là ngắt dòng thường; giá trị CSS tương ứng là `wrap`
    // (`text-wrap: normal` không hợp lệ, trình duyệt bỏ cả khai báo).
    push(out, 'text-wrap', t.wrap === 'normal' ? 'wrap' : t.wrap);
    push(out, 'text-decoration', t.decoration);
    push(out, 'text-underline-offset', t.underlineOffset && len(t.underlineOffset));
    push(out, 'white-space', t.whiteSpace);
    push(out, 'overflow-wrap', t.overflowWrap);
    push(out, 'list-style', t.listStyle);
    push(out, 'font-variant-numeric', t.variantNumeric);
    if (t.clamp !== undefined) {
      out.push(['display', '-webkit-box'],
        ['-webkit-box-orient', 'vertical'],
        ['-webkit-line-clamp', String(t.clamp)],
        ['overflow', 'hidden']);
    }
  }

  if (s.fill) {
    const f = s.fill;
    push(out, 'background-color', f.color && color(f.color));
    const gradient = f.gradient && !f.gradient.hidden ? f.gradient : undefined;
    const image = f.image && !f.image.hidden ? f.image : undefined;
    // Có lớp nền mà lớp nào cũng đang ẩn: phát `none` để đè breakpoint thấp hơn —
    // không phát gì thì lớp ẩn ở `md` vẫn hiện vì `base` còn khai nó.
    if ((f.gradient || f.image) && !gradient && !image) push(out, 'background-image', 'none');
    if (gradient) {
      const stops = gradient.stops
        .map((st) => `${color(st.color)} ${st.at}%`)
        .join(', ');
      push(out, 'background-image',
        gradient.kind === 'linear'
          ? `linear-gradient(${gradient.angle ?? 180}deg, ${stops})`
          : `radial-gradient(${stops})`);
    }
    if (image) {
      // URL do renderer inject qua custom property để compiler không phải biết gì
      // về S3 — xem `assetVarName` ở trên cho cả hai nửa của hợp đồng.
      push(out, 'background-image', `var(${assetVarName(image.assetId)})`);
      push(out, 'background-size', image.fit);
      push(out, 'background-position', safe(image.position, 'fill.image.position') ?? 'center');
    }
  }

  if (s.border) {
    const b = s.border;
    if (b.hidden) {
      // `none` thắng mọi width/color, kể cả của breakpoint thấp hơn.
      push(out, 'border-style', 'none');
    } else {
      push(out, 'border-width', b.width && len(b.width));
      push(out, 'border-style', b.style ?? (b.width ? 'solid' : undefined));
      push(out, 'border-color', b.color && color(b.color));
    }
    push(out, 'border-radius', b.radius && len(b.radius));
  }

  if (s.shadow !== undefined) {
    const visible = isTokenRef(s.shadow) ? null : s.shadow.filter((sh) => !sh.hidden);
    push(out, 'box-shadow',
      visible === null
        ? tokenVar(s.shadow as TokenRef)
        : visible.length === 0
          // Ẩn hết lớp: `none`, không phải bỏ khai báo — xem nhánh nền ở trên.
          ? 'none'
          : visible
              .map((sh) =>
                `${sh.inset ? 'inset ' : ''}${len(sh.x)} ${len(sh.y)} ${len(sh.blur)} ${len(sh.spread)} ${color(sh.color)}`)
              .join(', '));
  }

  if (s.container) {
    push(out, 'container-type', s.container.type);
    push(out, 'container-name', safe(s.container.name, 'container.name'));
  }

  if (s.effects) {
    const e = s.effects;
    push(out, 'opacity', e.opacity === undefined ? undefined : String(e.opacity));
    push(out, 'filter', e.blur && `blur(${len(e.blur)})`);
    if (e.backdropBlur || e.backdropSaturate) {
      const parts = [
        e.backdropBlur && `blur(${len(e.backdropBlur)})`,
        e.backdropSaturate && `saturate(${e.backdropSaturate})`,
      ].filter(Boolean).join(' ');
      out.push(['-webkit-backdrop-filter', parts], ['backdrop-filter', parts]);
    }
    push(out, 'mix-blend-mode', e.blend);
    push(out, 'overflow', e.overflow);
    push(out, 'pointer-events', e.pointerEvents);
    push(out, 'visibility', e.visibility);
    push(out, 'isolation', e.isolation);
    push(out, 'user-select', e.userSelect);
    push(out, 'object-fit', e.objectFit);
    push(out, 'object-position', safe(e.objectPosition, 'effects.objectPosition'));
    push(out, 'cursor', e.cursor);
    if (e.outline) {
      push(out, 'outline',
        `${len(e.outline.width)} ${e.outline.style} ${color(e.outline.color)}`);
      push(out, 'outline-offset', e.outline.offset && len(e.outline.offset));
    }
  }

  if (s.transform) {
    const t = s.transform;
    const parts = [
      t.x && `translateX(${len(t.x)})`,
      t.y && `translateY(${len(t.y)})`,
      t.scale !== undefined && `scale(${t.scale})`,
      t.rotate !== undefined && `rotate(${t.rotate}deg)`,
    ].filter(Boolean);
    if (parts.length) push(out, 'transform', parts.join(' '));
    push(out, 'transform-origin', safe(t.origin, 'transform.origin'));
    if (t.translate) {
      // Property `translate` độc lập — cố ý KHÔNG gộp vào `transform`, để CSS và
      // GSAP không tranh nhau cùng một property lúc effect chạy.
      const tx = t.translate.x ? len(t.translate.x) : '0';
      const ty = t.translate.y ? len(t.translate.y) : '0';
      push(out, 'translate', `${tx} ${ty}`);
    }
  }

  if (s.transition) {
    const t = s.transition;
    const dur = t.duration ? len(t.duration) : 'var(--dur-base)';
    const ease = t.easing ? tokenVar(t.easing) : 'var(--ease-out)';
    const delay = t.delay ? ` ${len(t.delay)}` : '';
    push(out, 'transition',
      t.props.map((p) => `${safe(p, 'transition.props')} ${dur} ${ease}${delay}`).join(', '));
  }

  return out;
}

/* ── Rule assembly ────────────────────────────────────────────────────── */

function sel(id: string, suffix = ''): string {
  return `${nodeScope(id)}${suffix}`;
}

/**
 * Selector cho một node BÊN TRONG cây component.
 *
 * `[data-c="<componentId>"] [data-cn="<localId>"]` — scope theo COMPONENT, không
 * theo instance. Đó là cả điểm của mô hình: style thuộc về component, nên một
 * khối rule phục vụ mọi instance, và đổi style component là mọi trang đổi theo
 * mà không phải ghi lại gì.
 *
 * Nếu scope theo instance thì mỗi instance sinh một bản rule riêng, và trang có
 * mười thẻ sản phẩm sẽ mang mười bản của cùng một khối CSS.
 *
 * Ràng buộc đi kèm: cây component KHÔNG được chứa instance. Selector hậu duệ ở
 * trên sẽ khớp xuyên qua một instance lồng bên trong và áp nhầm style. Chặn ở
 * `applyOpsToPreset`.
 */
function selIn(componentId: string, localId: string, suffix = ''): string {
  return `${componentNodeScope(componentId, localId)}${suffix}`;
}

function rule(selector: string, decls: Decl[], indent = ''): string {
  if (!decls.length) return '';
  const body = decls.map(([p, v]) => `${indent}  ${p}: ${v};`).join('\n');
  return `${indent}${selector} {\n${body}\n${indent}}\n`;
}

/**
 * Fallback cho backdrop-filter. Sinh tự động, không phải prop — nên tác giả
 * (và AI) không thể quên nó. Đây chính là mẫu `.header__pill` đang dùng.
 */
function backdropFallback(id: string, s: Partial<StyleProps>): string {
  const fb = s.effects?.backdropFallbackColor;
  if (!fb || !s.effects?.backdropBlur) return '';
  return (
    `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {\n` +
    rule(sel(id), [['background-color', color(fb)]], '  ') +
    `}\n`
  );
}

export interface CompiledCss {
  css: string;
  hash: string;
}

/** Cây component mà doc đang tham chiếu, dùng để phát CSS cho instance. */
export type ComponentTrees = ReadonlyMap<string, { nodes: Record<string, Node> }>;

export function compileDoc(doc: Doc, components?: ComponentTrees): CompiledCss {
  // Thứ tự id ổn định → output deterministic → hash ổn định → cache được.
  const ids = Object.keys(doc.nodes).sort();
  const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is Node => Boolean(n));

  // Khai thứ tự layer TRƯỚC mọi thứ. Thứ tự khai quyết định độ ưu tiên, không
  // phụ thuộc vị trí xuất hiện của khối bên dưới.
  //
  // `doc-custom` sau `doc` nghĩa là customCss LUÔN thắng style props, kể cả khi
  // specificity thấp hơn. Đó là điều người dùng mong đợi: gõ CSS vào panel thì
  // phải thấy nó có tác dụng, chứ không phải thua một rule mình không nhìn thấy.
  const parts: string[] = ['@layer doc, doc-custom;\n', '@layer doc {\n'];

  // 1 — base
  for (const n of nodes) {
    parts.push(rule(sel(n.id), declarations(n.style.base), '  '));
  }

  // 1b — fallback backdrop (ngoài @layer để @supports không bị lồng sai)
  const fallbacks = nodes.map((n) => backdropFallback(n.id, n.style.base)).filter(Boolean);

  // 2 — breakpoint, gom theo breakpoint chứ không theo node
  for (const bp of OVERRIDE_BREAKPOINTS) {
    const inner = nodes
      .map((n) => {
        const layer = n.style[bp];
        return layer ? rule(sel(n.id), declarations(layer), '    ') : '';
      })
      .filter(Boolean)
      .join('');
    if (inner) {
      parts.push(`  @media (min-width: ${BREAKPOINT_PX[bp]}px) {\n${inner}  }\n`);
    }
  }

  // 3 — state cố định
  for (const st of STYLE_STATES) {
    for (const n of nodes) {
      const layer = n.style[st as StyleState];
      if (layer) parts.push(rule(sel(n.id, STATE_SELECTOR[st]), declarations(layer), '  '));
    }
  }

  // 3b — state do effect điều khiển (kết quả của R1: header.is-collapsed/is-inverted)
  //
  // Cờ trên chính node HOẶC trên một tổ tiên đều áp: effect gắn ở node cha (header,
  // một bước của `steps`) ghi cờ một lần, và các node bên trong style theo nó mà
  // không cần effect ghi cờ xuống từng con. Hai dạng cùng độ ưu tiên (0,2,0).
  for (const n of nodes) {
    const states = n.style.states;
    if (!states) continue;
    for (const name of Object.keys(states).sort()) {
      const layer = states[name];
      const flag = `[data-${name}="true"]`;
      if (layer) parts.push(rule(`${sel(n.id, flag)}, ${flag} ${sel(n.id)}`, declarations(layer), '  '));
    }
  }

  // 4 — style của component mà instance trên trang đang dùng.
  //
  // Phát MỘT LẦN cho mỗi component, không phải một lần cho mỗi instance: rule
  // scope theo `[data-c]` nên chúng dùng chung. Trang có mười thẻ sản phẩm cùng
  // component vẫn chỉ mang một khối.
  //
  // Và chỉ phát component THẬT SỰ được dùng: thư viện có thể lớn hơn nhiều so
  // với thứ một trang cần, còn CSS của component không dùng tới là bytes chết
  // trên mọi lượt tải.
  const usedComponents = [
    ...new Set(nodes.filter((n) => n.type === 'Instance').map((n) => n.componentId)),
  ].sort();

  for (const componentId of usedComponents) {
    const tree = components?.get(componentId);
    // Component đã bị xoá khỏi thư viện: không phát gì. Renderer cũng không vẽ
    // instance đó, nên hai bên nhất quán.
    if (!tree) continue;

    const localIds = Object.keys(tree.nodes).sort();
    const localNodes = localIds
      .map((id) => tree.nodes[id])
      .filter((n): n is Node => Boolean(n));

    for (const cn of localNodes) {
      parts.push(rule(selIn(componentId, cn.id), declarations(cn.style.base), '  '));
    }

    for (const bp of OVERRIDE_BREAKPOINTS) {
      const inner = localNodes
        .map((cn) => {
          const layer = cn.style[bp];
          return layer ? rule(selIn(componentId, cn.id), declarations(layer), '    ') : '';
        })
        .filter(Boolean)
        .join('');
      if (inner) {
        parts.push(`  @media (min-width: ${BREAKPOINT_PX[bp]}px) {\n${inner}  }\n`);
      }
    }

    for (const st of STYLE_STATES) {
      for (const cn of localNodes) {
        const layer = cn.style[st as StyleState];
        if (layer) {
          parts.push(rule(selIn(componentId, cn.id, STATE_SELECTOR[st]), declarations(layer), '  '));
        }
      }
    }

    for (const cn of localNodes) {
      const states = cn.style.states;
      if (!states) continue;
      for (const name of Object.keys(states).sort()) {
        const layer = states[name];
        const flag = `[data-${name}="true"]`;
        if (layer) {
          // Dạng tổ tiên dùng scope MỘT compound — xem `componentCustomScope`.
          parts.push(
            rule(
              `${selIn(componentId, cn.id, flag)}, ${flag} ${componentCustomScope(componentId, cn.id)}`,
              declarations(layer),
              '  ',
            ),
          );
        }
      }
    }
  }

  parts.push('}\n');
  parts.push(...fallbacks);

  // ── customCss, layer riêng ──────────────────────────────────────────
  //
  // Đây là panel CSS trong builder, không phải escape hatch dùng hiếm — người
  // dùng gõ vào đây hằng ngày và AI cũng ghi được (mức "Vừa": qua allowlist
  // property, luôn hiện trong diff preview để duyệt).
  //
  // Sanitize đầy đủ nằm ở `sanitize-css.ts`: scope selector về [data-n], gỡ
  // @import, đổi position:fixed thành absolute, chặn url(javascript:). Chạy lúc
  // RENDER chứ không lúc lưu, để siết luật về sau vẫn bảo vệ được dữ liệu cũ.
  /*
   * Node của TRANG và node trong CÂY COMPONENT, cùng một layer.
   *
   * Vòng lặp cũ chỉ duyệt `nodes` — tức node của doc trang — nên `customCss` của
   * một node bên trong component lưu đúng vào database và xuất hiện 0 lần trong
   * HTML. Không lỗi, không cảnh báo: `get_component_node` vẫn trả về chuỗi CSS,
   * chỉ là nó không bao giờ ra stylesheet. Hệ quả thật là component không mang
   * được lớp kính hay bất kỳ escape hatch nào, nên cách duy nhất còn lại là bỏ
   * hẳn thư viện component và đóng dấu mọi thứ thành node trang.
   *
   * Thứ tự: trang trước, component sau, và `usedComponents` đã `.sort()` — output
   * phải tất định vì hash của nó là khoá cache (`StyleBundle`, `Release.cssHash`).
   */
  const custom: { comment: string; css: string; scope: string }[] = nodes
    .filter((n) => n.customCss)
    .map((n) => ({ comment: n.id, css: n.customCss!, scope: nodeScope(n.id) }));

  for (const componentId of usedComponents) {
    const tree = components?.get(componentId);
    if (!tree) continue;
    for (const localId of Object.keys(tree.nodes).sort()) {
      const cn = tree.nodes[localId];
      if (!cn?.customCss) continue;
      custom.push({
        comment: `${componentId} / ${localId}`,
        css: cn.customCss,
        // Một compound — xem `componentCustomScope` vì sao không dùng `componentNodeScope`.
        scope: componentCustomScope(componentId, localId),
      });
    }
  }

  if (custom.length) {
    parts.push('@layer doc-custom {\n');
    for (const c of custom) {
      // Sanitize ở ĐÂY, lúc render — không phải lúc lưu. Nhờ vậy siết luật về
      // sau vẫn bảo vệ được customCss đã nằm sẵn trong database từ trước.
      const { css: safeCss } = sanitizeCustomCss(c.css, c.comment, c.scope);
      if (!safeCss) continue;
      parts.push(`  /* ${c.comment} */\n${safeCss}\n`);
    }
    parts.push('}\n');
  }

  const css = parts.join('');
  const hash = createHash('sha256').update(css).digest('hex').slice(0, 16);
  return { css, hash };
}
