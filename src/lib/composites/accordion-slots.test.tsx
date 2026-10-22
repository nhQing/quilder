import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Accordion, itemsFrom } from './Accordion';
import { parseCompositeParams } from './registry';
import type { AccordionParams } from './registry';

/**
 * Accordion — ghép slot thành mục, và HTML mà nó phát ra.
 *
 * Tính chất chịu lực nhất không nằm ở việc ghép: nó là **không có JavaScript
 * nào**. `<details>`/`<summary>` cho mở/đóng, bàn phím và `Ctrl+F` tìm được chữ
 * trong mục đang đóng; `<details name>` cho luật "một mục mở". Nên test kiểm
 * MARKUP, vì markup chính là toàn bộ cơ chế.
 */

const params = (raw: unknown = {}) => parseCompositeParams('Accordion', raw) as AccordionParams;

const render = (slots: Record<string, string[]>, raw: unknown = {}) =>
  renderToStaticMarkup(
    createElement(Accordion, {
      ...params(raw),
      slots,
      groupName: 'faq1',
      renderChild: (id: string) => createElement('span', { key: id }, id),
    }),
  );

describe('itemsFrom — ghép q-N với a-N', () => {
  it('ghép đúng cặp', () => {
    const items = itemsFrom({ 'q-1': ['q1'], 'a-1': ['a1'], 'q-2': ['q2'], 'a-2': ['a2'] });
    expect(items).toHaveLength(2);
    expect(items[0]!.question).toEqual(['q1']);
    expect(items[0]!.answer).toEqual(['a1']);
  });

  it('sắp theo SỐ, không theo chuỗi', () => {
    // Sắp theo chuỗi thì "q-10" nằm giữa "q-1" và "q-2" — cùng bẫy mà
    // `panelsFrom` đã phải xử lý.
    const items = itemsFrom({ 'q-10': ['x'], 'q-2': ['y'], 'q-1': ['z'] });
    expect(items.map((i) => i.n)).toEqual([1, 2, 10]);
  });

  it('bỏ qua mục không có câu hỏi — một summary rỗng là mục không bấm được', () => {
    const items = itemsFrom({ 'a-1': ['a1'], 'q-2': ['q2'] });
    expect(items.map((i) => i.n)).toEqual([2]);
  });

  it('GIỮ mục chưa có câu trả lời', () => {
    // Nội dung đang viết dở. Ẩn đi thì tác giả không thấy chỗ mình còn nợ.
    const items = itemsFrom({ 'q-1': ['q1'] });
    expect(items).toHaveLength(1);
    expect(items[0]!.answer).toEqual([]);
  });

  it('bỏ qua khoá lạ và slot rỗng', () => {
    expect(itemsFrom({ intro: ['x'], 'q-abc': ['y'], 'q-1': [] })).toEqual([]);
  });
});

describe('Accordion — markup LÀ cơ chế', () => {
  const slots = { 'q-1': ['q1'], 'a-1': ['a1'], 'q-2': ['q2'], 'a-2': ['a2'] };

  it('phát <details> và <summary> thật, không div + JS', () => {
    const out = render(slots);
    expect(out).toContain('<details');
    expect(out).toContain('<summary');
    // Cả câu hỏi lẫn câu trả lời có trong HTML: đó là điều kiện để Ctrl+F và
    // crawler tìm thấy nội dung của mục đang ĐÓNG.
    expect(out).toContain('a1');
    expect(out).toContain('a2');
  });

  it('single: true phát `name` — luật một-mục-mở ở tầng trình duyệt', () => {
    const out = render(slots, { single: true });
    expect(out).toContain('name="mm-acc-faq1"');
  });

  it('single: false thì KHÔNG có name', () => {
    expect(render(slots, { single: false })).not.toContain('name="mm-acc');
  });

  it('name lấy theo node, để hai accordion cùng trang không đóng nhau', () => {
    const out = renderToStaticMarkup(
      createElement(Accordion, {
        ...params({ single: true }),
        slots,
        groupName: 'faq2',
        renderChild: (id: string) => createElement('span', { key: id }, id),
      }),
    );
    expect(out).toContain('name="mm-acc-faq2"');
  });

  it('openFirst chỉ mở mục ĐẦU', () => {
    const out = render(slots, { openFirst: true });
    expect((out.match(/<details[^>]*open/g) ?? [])).toHaveLength(1);
    expect(out.indexOf('open')).toBeLessThan(out.indexOf('q2'));
  });

  it('mặc định không mở mục nào — FAQ thì danh sách câu hỏi mới là thứ có ích', () => {
    expect(render(slots)).not.toMatch(/<details[^>]*\sopen/);
  });

  it('không có slot nào thì hiện khung rỗng, không phải không gì cả', () => {
    // Một composite vô hình là một node không chọn được trong builder.
    expect(render({})).toContain('data-accordion-empty');
  });

  it('phát data-part để style được', () => {
    const out = render(slots);
    for (const part of ['accordion-item', 'accordion-q', 'accordion-a']) {
      expect(out, part).toContain(`data-part="${part}"`);
    }
  });
});

describe('accordionParams', () => {
  it('mặc định: một mục mở, không mở sẵn', () => {
    expect(params({})).toEqual({ single: true, openFirst: false });
  });

  it('params rác rơi về mặc định, KHÔNG ném', () => {
    expect(() => params({ single: 'có' })).not.toThrow();
    expect(params({ single: 'có' }).single).toBe(true);
  });
});
