import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Form, serverNotice } from './Form';
import { parseCompositeParams, parseFormParamsStrict, type FormParams } from './registry';

const params = (raw: unknown) => parseCompositeParams('Form', raw) as FormParams;

describe('Form — ô ẩn, captcha', () => {
  it('ô ẩn ra input type=hidden mang giá trị, không có nhãn', () => {
    const p = params({
      fields: [
        { name: 'email', kind: 'email', label: 'Email', required: true },
        { name: 'event', kind: 'hidden', label: 'Sự kiện', value: 'The Money Date' },
      ],
    });
    const out = renderToStaticMarkup(createElement(Form, { ...p, action: 'https://x/a' }));
    expect(out).toContain('<input type="hidden" name="event" value="The Money Date"/>');
    expect(out).not.toContain('>Sự kiện<');
  });

  it('bật captcha mà server chưa có site key: form tắt, nói rõ lý do', () => {
    const p = params({ captcha: 'turnstile' });
    const out = renderToStaticMarkup(createElement(Form, { ...p, action: 'https://x/a', captchaSiteKey: null }));
    expect(out).toContain('TURNSTILE_SITE_KEY');
    expect(out).toMatch(/<button[^>]*disabled/);
  });

  it('có site key: có ô chứa captcha, nút bật', () => {
    const p = params({ captcha: 'turnstile' });
    const out = renderToStaticMarkup(createElement(Form, { ...p, action: 'https://x/a', captchaSiteKey: 'k' }));
    expect(out).toContain('data-part="captcha"');
    expect(out).not.toMatch(/<button[^>]*disabled/);
  });

  it('đường nghiêm: ô ẩn thiếu giá trị bị báo đúng ô', () => {
    const r = parseFormParamsStrict({ fields: [{ name: 'event', kind: 'hidden', label: 'Sự kiện' }] });
    expect(r.ok).toBe(false);
  });
});

describe('serverNotice', () => {
  const res = (body: unknown) => new Response(JSON.stringify(body), { status: 409 });
  it('chỉ đọc userMessage và field hợp lệ', async () => {
    expect(await serverNotice(res({ userMessage: ' Đã đăng ký. ', field: 'email', message: 'stack…' }))).toEqual({
      message: 'Đã đăng ký.',
      field: 'email',
    });
  });
  it('khoá khác, chữ quá dài, body không phải JSON → rỗng', async () => {
    expect(await serverNotice(res({ message: 'nội bộ' }))).toEqual({ message: undefined, field: undefined });
    expect((await serverNotice(res({ userMessage: 'x'.repeat(301) }))).message).toBeUndefined();
    expect(await serverNotice(new Response('<html>', { status: 500 }))).toEqual({});
  });
});
