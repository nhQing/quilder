import { describe, expect, it } from 'vitest';

/**
 * Chuỗi người gõ ↔ giá trị có kiểu.
 *
 * Doc không lưu string tự do, nhưng người dùng gõ "16px". Đây là chỗ duy nhất
 * dịch qua lại — nên cũng là chỗ duy nhất quyết định "thế nào là hợp lệ", và là
 * hàng rào đầu tiên trước khi validator ở server từ chối.
 */

import {
  colorPreview, formatColor, formatLen, isComplexLen, parseColor, parseLen,
  resolveTokenColor, splitLen, stepLen, stepSize, UNIT_CHOICES,
} from './value-io';

const tokens = new Set(['space-l', 'color-accent', 'radius-pill']);

describe('parseLen', () => {
  it('số kèm đơn vị', () => {
    expect(parseLen('16px', { tokens })).toEqual({ ok: true, value: { v: 16, u: 'px' } });
    expect(parseLen('1.5rem', { tokens })).toEqual({ ok: true, value: { v: 1.5, u: 'rem' } });
    expect(parseLen('50%', { tokens })).toEqual({ ok: true, value: { v: 50, u: '%' } });
    expect(parseLen('-8px', { tokens })).toEqual({ ok: true, value: { v: -8, u: 'px' } });
  });

  it('đơn vị container query — site thật dùng cqw khá nhiều', () => {
    expect(parseLen('5.55cqw', { tokens })).toEqual({ ok: true, value: { v: 5.55, u: 'cqw' } });
  });

  it('tên token, chấp nhận cả tiền tố -- và $', () => {
    for (const input of ['space-l', '--space-l', '$space-l']) {
      expect(parseLen(input, { tokens })).toEqual({ ok: true, value: { $token: 'space-l' } });
    }
  });

  it('chuỗi rỗng = xoá giá trị', () => {
    expect(parseLen('', { tokens })).toEqual({ ok: true, value: null });
    expect(parseLen('   ', { tokens })).toEqual({ ok: true, value: null });
  });

  it('từ khoá chỉ hợp lệ khi được khai báo', () => {
    expect(parseLen('auto', { tokens, keywords: ['auto'] })).toEqual({ ok: true, value: 'auto' });
    expect(parseLen('auto', { tokens }).ok).toBe(false);
  });

  it('số trần kế thừa đơn vị đang có trong ô', () => {
    // Thao tác thường gặp nhất: ô đang `24px`, bôi đen gõ `16`. Bắt gõ lại "px"
    // mỗi lần đã biến việc này thành một lỗi đỏ.
    expect(parseLen('16', { tokens, currentUnit: 'rem' }))
      .toEqual({ ok: true, value: { v: 16, u: 'rem' } });
    expect(parseLen('50', { tokens, currentUnit: '%' }))
      .toEqual({ ok: true, value: { v: 50, u: '%' } });
  });

  it('ô trống thì số trần mặc định px', () => {
    expect(parseLen('16', { tokens })).toEqual({ ok: true, value: { v: 16, u: 'px' } });
    expect(parseLen('16', { tokens, currentUnit: null }))
      .toEqual({ ok: true, value: { v: 16, u: 'px' } });
  });

  it('đơn vị hiện tại không hợp lệ thì KHÔNG truyền bệnh, quay về px', () => {
    // Dữ liệu cũ có thể mang đơn vị ngoài danh sách. Im lặng ghi lại thứ đó là
    // nhân bản một giá trị sai.
    expect(parseLen('16', { tokens, currentUnit: 'parsec' }))
      .toEqual({ ok: true, value: { v: 16, u: 'px' } });
  });

  it('làm tròn về 2 chữ số thập phân', () => {
    expect(parseLen('33.333333333333336%', { tokens }))
      .toEqual({ ok: true, value: { v: 33.33, u: '%' } });
    expect(parseLen('16.567px', { tokens })).toEqual({ ok: true, value: { v: 16.57, u: 'px' } });
    // Giá trị nhỏ hơn một nửa bước cuối KHÔNG được biến thành 0 — một con số
    // người dùng cố ý gõ mà biến mất thì tệ hơn lệch chút ít.
    expect(parseLen('0.04px', { tokens })).toEqual({ ok: true, value: { v: 0.04, u: 'px' } });
    // Số 0 thừa ở đuôi bị bỏ — không sinh ra chuỗi "16.00px".
    expect(parseLen('16.00px', { tokens })).toEqual({ ok: true, value: { v: 16, u: 'px' } });
  });

  it('token gõ sai chính tả bị bắt ngay, không đợi server', () => {
    const res = parseLen('space-large', { tokens });
    expect(res.ok).toBe(false);
  });

  it('không nhận đơn vị lạ', () => {
    expect(parseLen('10parsec', { tokens }).ok).toBe(false);
    expect(parseLen('10pt', { tokens }).ok).toBe(false);
  });
});

describe('stepLen', () => {
  it('tăng giảm giữ nguyên đơn vị', () => {
    expect(stepLen('16px', 1)).toBe('17px');
    expect(stepLen('16px', -1)).toBe('15px');
    expect(stepLen('1.5rem', 0.1)).toBe('1.6rem');
    expect(stepLen('50%', 10)).toBe('60%');
  });

  it('không đẻ ra đuôi dấu phẩy động', () => {
    // 0.1 + 0.2 = 0.30000000000000004 trong mọi ngôn ngữ dùng IEEE 754, và con
    // số đó sẽ đi thẳng vào stylesheet nếu không làm tròn.
    expect(stepLen('0.1rem', 0.2)).toBe('0.3rem');
  });

  it('số trần vẫn bước được', () => {
    // Người dùng xoá "px" đi rồi mới bấm mũi tên — ô đang là "16", không phải
    // "16px", nhưng ý định vẫn rõ ràng.
    expect(stepLen('16', 1)).toBe('17');
  });

  it('ô trống bắt đầu từ 0 với đơn vị đang có', () => {
    expect(stepLen('', 1)).toBe('1px');
    expect(stepLen('', 1, 'rem')).toBe('1rem');
    expect(stepLen('', -1)).toBe('-1px');
  });

  it('KHÔNG bước trên token, từ khoá hay clamp — cộng vào đó là nuốt mất giá trị', () => {
    expect(stepLen('space-l', 1)).toBeNull();
    expect(stepLen('auto', 1)).toBeNull();
    expect(stepLen('clamp(…)', 1)).toBeNull();
  });

  it('stepSize theo phím bổ trợ', () => {
    expect(stepSize({ shiftKey: false, altKey: false })).toBe(1);
    expect(stepSize({ shiftKey: true, altKey: false })).toBe(10);
    expect(stepSize({ shiftKey: false, altKey: true })).toBe(0.1);
  });
});

describe('resolveTokenColor', () => {
  const palette = [
    { name: 'color-ink', value: '#0b0b0f' },
    { name: 'color-bg', value: 'var(--color-ink)' },
    { name: 'color-surface', value: 'var(--color-bg)' },
    { name: 'loop-a', value: 'var(--loop-b)' },
    { name: 'loop-b', value: 'var(--loop-a)' },
  ];

  it('trả giá trị thật, không phải var() — vỏ builder không nạp tokens.css', () => {
    expect(resolveTokenColor('color-ink', palette)).toBe('#0b0b0f');
  });

  it('lần theo bí danh nhiều tầng', () => {
    expect(resolveTokenColor('color-bg', palette)).toBe('#0b0b0f');
    expect(resolveTokenColor('color-surface', palette)).toBe('#0b0b0f');
  });

  it('vòng lặp không treo trình duyệt', () => {
    // Không có trần thì `--a: var(--b); --b: var(--a)` quay vô hạn và treo tab.
    expect(() => resolveTokenColor('loop-a', palette)).not.toThrow();
  });

  it('tên không có thì trả null, không ném', () => {
    expect(resolveTokenColor('khong-ton-tai', palette)).toBeNull();
  });
});

describe('formatLen', () => {
  it('hiện lại đúng thứ gõ vào', () => {
    expect(formatLen({ v: 16, u: 'px' })).toBe('16px');
    expect(formatLen({ $token: 'space-l' })).toBe('space-l');
    expect(formatLen(undefined)).toBe('');
    expect(formatLen('auto')).toBe('auto');
  });

  it('giá trị phức tạp hiện dạng rút gọn', () => {
    expect(formatLen({ clamp: [1, 2, 3] })).toBe('clamp(…)');
    expect(formatLen({ calc: {} })).toBe('calc(…)');
  });

  it('không ném với giá trị không phải độ dài (cờ `border.hidden` đi qua LayerMap)', () => {
    // 22/10/2026: bấm "ẩn" nét viền → `LayerMap` gọi formatLen(true) → `'v' in true` ném.
    expect(formatLen(true)).toBe('');
    expect(formatLen(false)).toBe('');
  });

  it('vòng tròn parse → format giữ nguyên', () => {
    for (const input of ['16px', '1.5rem', '50%', 'space-l']) {
      const parsed = parseLen(input, { tokens });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatLen(parsed.value)).toBe(input);
    }
  });
});

describe('isComplexLen', () => {
  it('nhận diện đúng thứ không sửa được bằng ô text', () => {
    expect(isComplexLen({ clamp: [] })).toBe(true);
    expect(isComplexLen({ calc: {} })).toBe(true);
    expect(isComplexLen({ min: [] })).toBe(true);
    expect(isComplexLen({ max: [] })).toBe(true);
    expect(isComplexLen({ v: 1, u: 'px' })).toBe(false);
    expect(isComplexLen({ $token: 'x' })).toBe(false);
  });
});

describe('parseColor', () => {
  it('hex ở cả bốn độ dài, tự thêm #', () => {
    expect(parseColor('#0d1321', tokens)).toEqual({ ok: true, value: { hex: '#0d1321' } });
    expect(parseColor('0d1321', tokens)).toEqual({ ok: true, value: { hex: '#0d1321' } });
    expect(parseColor('#fff', tokens)).toEqual({ ok: true, value: { hex: '#fff' } });
    expect(parseColor('#0d132180', tokens)).toEqual({ ok: true, value: { hex: '#0d132180' } });
  });

  it('token màu', () => {
    expect(parseColor('color-accent', tokens)).toEqual({
      ok: true, value: { $token: 'color-accent' },
    });
  });

  it('rgb()/hsl() bị từ chối kèm lý do', () => {
    const res = parseColor('rgb(13, 19, 33)', tokens);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('hex');
  });

  it('tên màu CSS bị từ chối — schema chỉ nhận hex hoặc token', () => {
    expect(parseColor('red', tokens).ok).toBe(false);
  });

  it('rỗng = xoá', () => {
    expect(parseColor('', tokens)).toEqual({ ok: true, value: null });
  });
});

describe('colorPreview', () => {
  it('token vẽ bằng var() để ô xem trước khớp trang thật', () => {
    // Không tự tra giá trị token: var() để trình duyệt tự tính, nên ô xem trước
    // vẫn đúng khi đổi theme.
    expect(colorPreview({ $token: 'color-accent' })).toBe('var(--color-accent)');
    expect(colorPreview({ hex: '#fff' })).toBe('#fff');
    expect(colorPreview(undefined)).toBeNull();
  });
});

describe('formatColor', () => {
  it('vòng tròn parse → format giữ nguyên', () => {
    for (const input of ['#0d1321', 'color-accent']) {
      const parsed = parseColor(input, tokens);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatColor(parsed.value)).toBe(input);
    }
  });
});

/**
 * `splitLen` — giá trị lưu trong doc → dạng mà ô "số + đơn vị" phải bày.
 *
 * Bộ điều khiển mới chỉ diễn đạt được một dạng: số + đơn vị. Bốn dạng còn lại (token,
 * từ khoá, `clamp()`, `unset`) vẫn phải nhận ra ĐÚNG, vì nhận sai nghĩa là ô hiện
 * trống trong khi trang đang có style — rồi người dùng gõ giá trị mới lên và xoá mất
 * một token của design system hoặc một công thức có chủ đích.
 */
describe('splitLen', () => {
  it('số + đơn vị', () => {
    expect(splitLen({ v: 24, u: 'px' })).toEqual({ kind: 'number', v: 24, u: 'px' });
    expect(splitLen({ v: 1.5, u: 'rem' })).toEqual({ kind: 'number', v: 1.5, u: 'rem' });
  });

  it('số TRẦN là number với đơn vị rỗng — z-index và opacity không có đơn vị', () => {
    expect(splitLen(3)).toEqual({ kind: 'number', v: 3, u: '' });
    expect(splitLen(0.5)).toEqual({ kind: 'number', v: 0.5, u: '' });
  });

  it('token', () => {
    expect(splitLen({ $token: 'space-m' })).toEqual({ kind: 'token', name: 'space-m' });
  });

  it('từ khoá lưu thành chuỗi trần', () => {
    expect(splitLen('auto')).toEqual({ kind: 'keyword', word: 'auto' });
    expect(splitLen('measure')).toEqual({ kind: 'keyword', word: 'measure' });
  });

  it('clamp/calc/min/max là complex, và mang chuỗi để hiện chỉ-đọc', () => {
    const c = splitLen({ clamp: [{ v: 1, u: 'rem' }, { v: 2, u: 'vw' }, { v: 3, u: 'rem' }] });
    expect(c.kind).toBe('complex');
    expect(c.kind === 'complex' && c.shown).toBe('clamp(…)');
    expect(splitLen({ calc: { op: 'add', a: { v: 1, u: 'px' }, b: 2 } }).kind).toBe('complex');
    expect(splitLen({ max: [{ v: 1, u: 'px' }] }).kind).toBe('complex');
  });

  it('{ unset: true } KHÔNG bị lẫn thành rỗng', () => {
    // Lẫn hai thứ này là bug im lặng: `unset` nghĩa là "ở khổ này bỏ hẳn thứ base đã
    // đặt", còn rỗng nghĩa là "kế thừa". Hiện sai thì người dùng không phân biệt được.
    expect(splitLen({ unset: true })).toEqual({ kind: 'unset' });
  });

  it('rỗng, và object lạ, đều là empty', () => {
    expect(splitLen(null)).toEqual({ kind: 'empty' });
    expect(splitLen(undefined)).toEqual({ kind: 'empty' });
    expect(splitLen({})).toEqual({ kind: 'empty' });
  });
});

describe('UNIT_CHOICES', () => {
  it('mọi đơn vị bày ra đều PARSE được — bày thứ không nhận là bẫy', () => {
    for (const u of UNIT_CHOICES) {
      const r = parseLen(`12${u}`, { tokens: new Set() });
      expect(r.ok, `parseLen từ chối "12${u}"`).toBe(true);
      expect(r.ok && r.value).toEqual({ v: 12, u });
    }
  });

  it('là tập CON của những gì parseLen nhận, không phải tập bằng', () => {
    // `cqi`, `cqh`, `fr` cố ý không bày (xem docblock), nhưng vẫn phải nhận được:
    // dữ liệu cũ và Agent qua MCP không được bị hẹp lại vì một quyết định giao diện.
    for (const u of ['cqi', 'cqh', 'fr']) {
      expect(parseLen(`12${u}`, { tokens: new Set() }).ok, u).toBe(true);
      expect((UNIT_CHOICES as readonly string[]).includes(u)).toBe(false);
    }
  });
});
