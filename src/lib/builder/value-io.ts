/**
 * Chuyển đổi giữa chuỗi người gõ và giá trị có kiểu trong doc.
 *
 * Doc không lưu string tự do — mọi độ dài và màu là tagged union (xem
 * `doc/types.ts`). Nhưng người dùng thì gõ "16px" và "#0d1321". File này là chỗ
 * duy nhất dịch qua lại, nên chỉ có một định nghĩa về "thế nào là hợp lệ".
 *
 * Vì sao không dùng input số + dropdown đơn vị: `clamp()`, `calc()`, `min()`,
 * `max()` không biểu diễn được bằng cặp số/đơn vị, mà site thật dùng chúng khá
 * nhiều. Ô text đọc/ghi được dạng đơn giản và HIỂN THỊ dạng phức tạp ở chế độ
 * chỉ đọc, thay vì giả vờ chúng không tồn tại rồi ghi đè mất.
 *
 * ## Vì sao số trần ĐƯỢC nhận (đổi ý so với bản đầu)
 *
 * Bản đầu từ chối `16` với lý do "không rõ px hay rem, đoán sai thì layout lệch
 * mà không ai biết vì sao". Lý do đó đúng với ô TRỐNG, nhưng sai với ô ĐANG CÓ
 * giá trị: ô đang là `24px`, người dùng bôi đen gõ `16` — chẳng có gì để đoán,
 * đơn vị nằm ngay đó. Bắt gõ lại "px" mỗi lần đã biến thao tác thường xuyên nhất
 * của cả panel thành một lỗi đỏ.
 *
 * Ô trống thì mặc định `px`, và ô hiện lại ngay `16px` sau khi ghi — vẫn là đoán,
 * nhưng đoán CÔNG KHAI, người dùng thấy kết quả và sửa được nếu sai.
 */

import type { ColorValue, Len } from '@/lib/doc/types';

const UNITS = ['px', 'rem', '%', 'vw', 'svh', 'ch', 'fr', 'cqw', 'cqi', 'cqh'] as const;
type Unit = (typeof UNITS)[number];

const LEN_RE = new RegExp(`^(-?\\d*\\.?\\d+)\\s*(${UNITS.join('|')})$`, 'i');
const HEX_RE = /^#?(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Số chữ số thập phân tối đa cho độ dài.
 *
 * Ba lý do, không phải khẩu vị:
 *
 *  1. `1/3` của một cột ra `33.333333333333336%` — 17 chữ số vô nghĩa nhưng vẫn
 *     phải cuộn ngang trong ô rộng 11px chữ.
 *  2. Trình duyệt làm tròn về pixel vật lý; chênh lệch dưới 0.01px không bao giờ
 *     hiện ra màn hình, nên độ chính xác thừa đó là ảo.
 *  3. Giá trị lưu trong DB rồi đi vào stylesheet — chuỗi ngắn hơn là bytes ít hơn
 *     trên mọi lượt tải trang.
 *
 * Hai chữ số vẫn giữ được mọi thứ người ta thật sự gõ: `0.5px` viền, `1.25rem`
 * chữ, `33.33%` cột. Thứ bị cắt chỉ là đuôi rác của phép chia.
 */
export const LEN_DECIMALS = 2;

/** Làm tròn về tối đa `LEN_DECIMALS` chữ số thập phân, bỏ số 0 thừa ở đuôi. */
export function roundLen(n: number): number {
  if (!Number.isFinite(n)) return n;
  // `Number()` bỏ luôn "16.00" → 16, nên không sinh ra chuỗi kiểu "16.00px".
  return Number(n.toFixed(LEN_DECIMALS));
}

/** Đơn vị hiện tại của một giá trị, nếu nó là dạng số+đơn vị. */
export function unitOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return 'v' in v && typeof v.u === 'string' ? v.u : null;
}

/** Giá trị phức tạp — sửa được bằng ô text sẽ mất thông tin. */
export function isComplexLen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return 'clamp' in v || 'calc' in v || 'min' in v || 'max' in v;
}

/**
 * Đơn vị bày trong bộ chọn.
 *
 * Bảy trong mười đơn vị của `LengthUnit`. Ba cái vắng mặt có lý do:
 *
 *  - `cqi` và `cqh` là biến thể của `cqw` theo trục, và trong toàn bộ site gốc chỉ
 *    `cqw` được dùng. Bày cả ba là bắt người dùng chọn giữa ba thứ họ không phân biệt
 *    được; ai thật sự cần `cqi` thì dữ liệu cũ vẫn giữ nguyên và ô vẫn hiện đúng.
 *  - `fr` chỉ có nghĩa trong grid track, mà track thì có editor riêng (chưa làm) —
 *    đặt `inline-size: 1fr` là một khai báo không làm gì.
 *
 * Đây là danh sách để CHỌN, không phải danh sách để chấp nhận: `parseLen` vẫn nhận cả
 * mười đơn vị, nên dữ liệu cũ và Agent qua MCP không bị hẹp lại.
 */
export const UNIT_CHOICES = ['px', 'rem', '%', 'vw', 'svh', 'ch', 'cqw'] as const;

/**
 * Giá trị đang trong ô thuộc dạng nào.
 *
 * Bộ điều khiển "số + đơn vị" chỉ diễn đạt được MỘT trong năm dạng này. Bốn dạng còn
 * lại vẫn phải hiện đúng, nếu không thì mở panel ra là thấy ô trống trong khi trang
 * rõ ràng đang có style — và người dùng sẽ gõ một giá trị mới lên, tức xoá mất thứ có
 * chủ đích (một token của design system, hay một công thức `clamp()`).
 *
 * Hàm thuần, ở đây thay vì trong component, vì đây là chỗ dễ sai nhất của cả bộ điều
 * khiển và nó phải test được mà không dựng React.
 */
export type LenMode =
  | { kind: 'empty' }
  | { kind: 'number'; v: number; u: string }
  | { kind: 'token'; name: string }
  | { kind: 'keyword'; word: string }
  /** `clamp()`, `calc()`, `min()`, `max()` — không sửa được bằng số + đơn vị. */
  | { kind: 'complex'; shown: string }
  /** `{ unset: true }` — xoá thứ lớp dưới đã đặt. Xem `Len` trong doc/types.ts. */
  | { kind: 'unset' };

export function splitLen(value: unknown): LenMode {
  if (value === null || value === undefined) return { kind: 'empty' };

  // Từ khoá (`auto`, `full`, `measure`, `svh`…) lưu thành chuỗi trần.
  if (typeof value === 'string') return { kind: 'keyword', word: value };

  // Số trần: `z-index`, `opacity`, `leading` — không có đơn vị, và đó là ĐÚNG.
  if (typeof value === 'number') return { kind: 'number', v: value, u: '' };

  if (typeof value !== 'object') return { kind: 'empty' };
  const v = value as Record<string, unknown>;

  if (typeof v.$token === 'string') return { kind: 'token', name: v.$token };
  if (v.unset === true) return { kind: 'unset' };
  if (typeof v.v === 'number' && typeof v.u === 'string') {
    return { kind: 'number', v: v.v, u: v.u };
  }
  if (isComplexLen(value)) return { kind: 'complex', shown: formatLen(value) };
  return { kind: 'empty' };
}

/** Giá trị có kiểu → chuỗi hiện trong ô. */
export function formatLen(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);

  const v = value as Record<string, unknown>;
  if (typeof v.$token === 'string') return v.$token;
  if ('v' in v && 'u' in v) return `${String(v.v)}${String(v.u)}`;
  if ('clamp' in v) return 'clamp(…)';
  if ('calc' in v) return 'calc(…)';
  if ('min' in v) return 'min(…)';
  if ('max' in v) return 'max(…)';
  return '';
}

export type ParseResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; error: string };

const BARE_NUMBER_RE = /^-?\d*\.?\d+$/;

/**
 * Chuỗi → Len.
 *
 * Chấp nhận: "16px", "1.5rem", "50%", số trần ("16" — xem `currentUnit`), tên
 * token ("space-l", "--space-l"), hoặc một trong các từ khoá được truyền vào.
 * Chuỗi rỗng = xoá giá trị.
 *
 * `currentUnit` là đơn vị ô đang mang. Số trần kế thừa nó; ô trống thì mặc định
 * `px`.
 */
export function parseLen(
  input: string,
  opts: {
    tokens: Set<string>;
    keywords?: readonly string[];
    /** Đơn vị giá trị hiện tại của ô, để số trần kế thừa. */
    currentUnit?: string | null;
  } = { tokens: new Set() },
): ParseResult<Len | string> {
  const text = input.trim();
  if (!text) return { ok: true, value: null };

  if (opts.keywords?.includes(text)) return { ok: true, value: text };

  const name = text.replace(/^(--|\$)/, '');
  if (opts.tokens.has(name)) return { ok: true, value: { $token: name } };

  const match = LEN_RE.exec(text);
  if (match) {
    return {
      ok: true,
      value: { v: roundLen(Number(match[1])), u: match[2]!.toLowerCase() as Unit },
    };
  }

  if (BARE_NUMBER_RE.test(text)) {
    // Đơn vị hiện tại chỉ được dùng nếu nó là đơn vị hợp lệ — dữ liệu cũ có thể
    // mang thứ không nằm trong UNITS, và im lặng ghi lại thứ đó là truyền bệnh.
    const unit = (UNITS as readonly string[]).includes(opts.currentUnit ?? '')
      ? (opts.currentUnit as Unit)
      : 'px';
    return { ok: true, value: { v: roundLen(Number(text)), u: unit } };
  }

  // Token gõ sai chính tả là lỗi thường gặp nhất, và validator sẽ chặn ở server.
  // Bắt sớm ở đây để người dùng biết ngay tên nào mới có thật.
  return { ok: false, error: `Không hiểu "${text}". Dùng số kèm đơn vị, hoặc tên token có thật.` };
}

/**
 * Tăng/giảm giá trị trong ô bằng phím mũi tên.
 *
 * Trả `null` khi ô không phải dạng số — token, từ khoá, `clamp()` đều không có
 * khái niệm "cộng thêm 1", và bịa ra một con số để cộng sẽ NUỐT MẤT token.
 *
 * Nhận cả số trần: ô đang là `16px` mà người dùng đã xoá thành `16` rồi mới bấm
 * mũi tên thì vẫn phải chạy.
 */
export function stepLen(
  display: string,
  delta: number,
  currentUnit?: string | null,
): string | null {
  const text = display.trim();

  if (BARE_NUMBER_RE.test(text)) {
    return String(roundLen(Number(text) + delta));
  }

  const match = LEN_RE.exec(text);
  if (match) return `${roundLen(Number(match[1]) + delta)}${match[2]!.toLowerCase()}`;

  // Ô trống: bấm mũi tên là cách nhanh nhất để bắt đầu từ 0.
  if (!text) {
    const unit = (UNITS as readonly string[]).includes(currentUnit ?? '')
      ? currentUnit
      : 'px';
    return `${roundLen(delta)}${unit}`;
  }

  return null;
}

/** Bước nhảy theo phím bổ trợ — quy ước chung của mọi công cụ thiết kế. */
export function stepSize(e: { shiftKey: boolean; altKey: boolean }): number {
  if (e.shiftKey) return 10;
  if (e.altKey) return 0.1;
  return 1;
}

export function formatColor(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;
  if (typeof v.$token === 'string') return v.$token;
  if (typeof v.hex === 'string') return v.hex;
  if ('mix' in v) return 'color-mix(…)';
  return '';
}

export function parseColor(
  input: string,
  tokens: Set<string>,
): ParseResult<ColorValue> {
  const text = input.trim();
  if (!text) return { ok: true, value: null };

  const name = text.replace(/^(--|\$)/, '');
  if (tokens.has(name)) return { ok: true, value: { $token: name } };

  if (HEX_RE.test(text)) {
    return { ok: true, value: { hex: text.startsWith('#') ? text : `#${text}` } };
  }

  if (/^(rgb|hsl|oklch)/i.test(text)) {
    return {
      ok: false,
      error: 'Chỉ nhận hex (#0d1321) hoặc tên token. Không nhận rgb()/hsl()/oklch().',
    };
  }
  return { ok: false, error: `Không hiểu "${text}". Dùng hex (#0d1321) hoặc tên token.` };
}

/**
 * Tên token → màu vẽ được, tra từ chính bảng token.
 *
 * ## Vì sao không dùng thẳng `var(--tên)`
 *
 * Vỏ builder CỐ Ý không nạp `tokens.css` (xem `(builder)/layout.tsx`): công cụ
 * và nội dung phải phân biệt được bằng mắt. Hệ quả là mọi `var(--color-*)` viết
 * trong chrome của builder đều resolve về rỗng, và ô xem trước màu thành ô
 * trắng — không báo lỗi, chỉ đơn giản là không hiện gì.
 *
 * ## Vì sao phải lần theo chuỗi
 *
 * `--color-bg: var(--color-ink)` là bí danh, khá nhiều trong bảng. Lấy giá trị
 * một tầng sẽ trả về đúng cái chuỗi `var()` vô dụng ban đầu.
 *
 * Trần 6 bước, không phải vì chuỗi thật dài thế, mà vì một vòng lặp
 * (`--a: var(--b); --b: var(--a)`) sẽ treo cả tab trình duyệt.
 */
export function resolveTokenColor(
  name: string,
  tokens: { name: string; value: string }[],
): string | null {
  const byName = new Map(tokens.map((t) => [t.name, t.value]));
  let value = byName.get(name);

  for (let hop = 0; value && hop < 6; hop++) {
    const alias = /^var\(\s*--([a-z0-9-]+)\s*\)$/i.exec(value.trim());
    if (!alias) return value;
    value = byName.get(alias[1]!);
  }
  return value ?? null;
}

/**
 * Màu để vẽ ô xem trước.
 *
 * `tokens` không bắt buộc để chỗ gọi cũ không vỡ, nhưng thiếu nó thì token trả
 * về `var()` — chỉ đúng trong ngữ cảnh có nạp `tokens.css`, tức là preview và
 * site thật, KHÔNG phải vỏ builder.
 */
export function colorPreview(
  value: unknown,
  tokens?: { name: string; value: string }[],
): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.$token === 'string') {
    return tokens ? resolveTokenColor(v.$token, tokens) : `var(--${v.$token})`;
  }
  if (typeof v.hex === 'string') return v.hex;
  return null;
}
