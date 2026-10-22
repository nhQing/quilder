import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Form } from './Form';
import { parseCompositeParams } from './registry';
import type { FormParams } from './registry';
import { siteEndpoint } from '@/lib/doc/site-bindings';

/**
 * HTML mà `Form` phát ra ở SERVER.
 *
 * Kiểm bản SSR chứ không bản đã hydrate, và đó là chỗ chịu lực: composite khai
 * `'use client'` nên dễ tưởng nó chỉ sống ở client, nhưng App Router vẫn render
 * HTML đầu tiên ở server. Nếu HTML đó thiếu ô nhập thì crawler không thấy form,
 * và người dùng thấy một khoảng trống cho tới khi JS tải xong.
 */

const params = (raw: unknown = {}) => parseCompositeParams('Form', raw) as FormParams;

const html = (over: Partial<Parameters<typeof Form>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Form, {
      ...params(over.fields ? { fields: over.fields } : {}),
      action: 'https://api.example/newsletter',
      ...over,
    }),
  );

describe('Form — HTML ở server', () => {
  it('ô nhập có trong HTML đầu tiên, không chờ JS', () => {
    const out = html();
    expect(out).toContain('<form');
    expect(out).toContain('type="email"');
    expect(out).toContain('name="email"');
    expect(out).toContain('required');
  });

  it('label nối với input bằng for/id — không phải nhãn trôi nổi', () => {
    // Đây là lý do ô nhập là params chứ không phải node: `<label for>` ↔
    // `<input id>` là một hợp đồng, và tách ra thì người dùng xoá được nhãn.
    const out = html();
    const forId = /<label[^>]*for="([^"]+)"/.exec(out)?.[1];
    expect(forId).toBeTruthy();
    expect(out).toContain(`id="${forId}"`);
  });

  it('vùng thông báo LUÔN có trong DOM, kể cả khi rỗng', () => {
    // `aria-live` chỉ phát khi nội dung của một vùng ĐÃ TỒN TẠI thay đổi. Mount
    // vùng đó cùng lúc với thông báo thì screen reader thường không đọc.
    const out = html();
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('data-part="status"');
  });

  it('honeypot có mặt, và bị ẩn khỏi bàn phím lẫn screen reader', () => {
    const out = html();
    expect(out).toContain('name="website_url"');
    expect(out).toContain('tabindex="-1"');
    expect(out).toContain('aria-hidden="true"');
  });

  it('phát data-part cho từng phần để style được mà không cần data-n', () => {
    const out = html();
    for (const part of ['form', 'field', 'field-email', 'submit', 'status']) {
      expect(out, part).toContain(`data-part="${part}"`);
    }
  });

  it('nút gửi là type=submit', () => {
    expect(html()).toContain('type="submit"');
  });
});

describe('Form — thiếu cấu hình phải THẤY ĐƯỢC', () => {
  it('action null thì vô hiệu và NÓI LÝ DO', () => {
    // Rơi về một form trông bình thường mà bấm không có gì xảy ra là đúng loại im
    // lặng mà `Canvas.fallbackChildId` bắt buộc khai để tránh.
    const out = html({ action: null });
    expect(out).toContain('data-part="misconfig"');
    // Nói đúng KHOÁ của form này (mặc định `newsletter`) và đúng ô phải mở ở màn Cài
    // đặt — "thêm khoá endpoint" chung chung không chỉ ra form nào thiếu khoá nào.
    expect(out).toContain('<code>newsletter</code>');
    expect(out).toContain('Cài đặt › Form');
    expect(out).toContain('disabled');
  });

  it('action có thì KHÔNG hiện dòng đó', () => {
    expect(html()).not.toContain('data-part="misconfig"');
  });
});

describe('Form — từng kiểu ô', () => {
  it('textarea, select và checkbox ra đúng thẻ', () => {
    const out = html({
      fields: [
        { name: 'loi_nhan', kind: 'textarea', label: 'Lời nhắn', required: false },
        {
          name: 'chu_de', kind: 'select', label: 'Chủ đề', required: false,
          options: [{ value: 'quy', label: 'Quỹ mở' }],
        },
        { name: 'dong_y', kind: 'checkbox', label: 'Đồng ý', required: true },
      ] as FormParams['fields'],
    });
    expect(out).toContain('<textarea');
    expect(out).toContain('<select');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('value="quy"');
  });

  it('select required có lựa chọn rỗng bị disabled — để "bỏ trống" là trạng thái thật', () => {
    const out = html({
      fields: [
        {
          name: 'chu_de', kind: 'select', label: 'Chủ đề', required: true,
          options: [{ value: 'quy', label: 'Quỹ mở' }],
        },
      ] as FormParams['fields'],
    });
    expect(out).toMatch(/<option value=""[^>]*disabled/);
  });

  it('help vào aria-describedby, không chỉ là chữ nhỏ', () => {
    const out = html({
      fields: [
        { name: 'sdt', kind: 'tel', label: 'Điện thoại', required: false, help: 'Có mã vùng' },
      ] as FormParams['fields'],
    });
    const describedBy = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(describedBy).toBeTruthy();
    expect(out).toContain(`id="${describedBy}"`);
    expect(out).toContain('Có mã vùng');
  });
});

/**
 * `endpointKey` → URL, qua bảng dùng chung `Site.globals.endpoint`.
 *
 * Phép kiểm giao thức ở đây là lớp phòng thủ cuối: `params` không nhận URL, nhưng
 * `globals` thì người ta gõ tay, và một `javascript:` trong đó là XSS đi qua đường
 * cấu hình.
 *
 * MỘT bảng cho cả `Form` và `NavChart`: hai khoá gần giống nhau là hai chỗ để sửa
 * "URL của BE", và màn Cài đặt sẽ bày ra cả hai.
 */
describe('siteEndpoint', () => {
  it('đọc đúng khoá trong bảng endpoint', () => {
    expect(siteEndpoint({ endpoint: { newsletter: 'https://api.example/n' } }, 'newsletter'))
      .toBe('https://api.example/n');
  });

  it('khoá thiếu, bảng thiếu, hay globals rỗng đều trả null', () => {
    expect(siteEndpoint({ endpoint: {} }, 'newsletter')).toBeNull();
    expect(siteEndpoint({}, 'newsletter')).toBeNull();
    expect(siteEndpoint(undefined, 'newsletter')).toBeNull();
    expect(siteEndpoint({ endpoint: 'https://x' }, 'newsletter')).toBeNull();
  });

  it('chặn giao thức không phải http(s)', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://x']) {
      expect(siteEndpoint({ endpoint: { n: bad } }, 'n'), bad).toBeNull();
    }
  });
});
