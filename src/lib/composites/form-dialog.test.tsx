// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Form } from './Form';
import { parseCompositeParams } from './registry';
import type { FormParams } from './registry';

/**
 * Hộp thoại sau khi gửi — cần DOM thật (`showModal`, focus), nên file này chạy
 * dưới happy-dom; phần SSR nằm ở `form-render.test.tsx`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const params = (raw: unknown = {}) => parseCompositeParams('Form', raw) as FormParams;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function mount(over: Partial<Parameters<typeof Form>[0]> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(Form, {
        ...params({ afterSubmit: 'dialog' }),
        action: 'https://api.example/n',
        success: createElement('p', null, 'Cảm ơn'),
        error: createElement('p', null, 'Gửi hỏng'),
        ...over,
      }),
    );
  });
}

async function submit() {
  // Qua mốc "gửi quá nhanh" (2 giây) rồi bắn submit.
  vi.setSystemTime(Date.now() + 5000);
  const form = host.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Form — hộp thoại sau khi gửi', () => {
  it('trước khi gửi: không có dialog[open], slot chưa mount', async () => {
    await mount();
    expect(host.querySelector('dialog[open]')).toBeNull();
    expect(host.textContent).not.toContain('Cảm ơn');
  });

  it('gửi thành công: dialog[open] chứa slot success và nút Đóng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await mount();
    await submit();
    const dlg = host.querySelector('dialog[open]');
    expect(dlg).not.toBeNull();
    expect(dlg!.textContent).toContain('Cảm ơn');
    expect(dlg!.textContent).not.toContain('Gửi hỏng');
    expect(dlg!.querySelector('button[aria-label="Đóng"]')).not.toBeNull();
  });

  it('gửi thất bại: dialog chứa slot error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await mount();
    await submit();
    const dlg = host.querySelector('dialog[open]');
    expect(dlg!.textContent).toContain('Gửi hỏng');
    expect(dlg!.textContent).not.toContain('Cảm ơn');
  });

  it('bấm Đóng: dialog đóng và focus về nút gửi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await mount();
    await submit();
    const close = host.querySelector<HTMLButtonElement>('dialog button[aria-label="Đóng"]')!;
    await act(async () => close.click());
    expect(host.querySelector('dialog[open]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-part="submit"]'));
  });

  it('slot trỏ id không tồn tại (slot rỗng) thì không ném', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await mount({ success: null, error: undefined });
    await submit();
    expect(host.querySelector('dialog[open]')).not.toBeNull();
  });

  it('chế độ inline không mở dialog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await mount({ afterSubmit: 'inline' });
    await submit();
    expect(host.querySelector('dialog')).toBeNull();
    expect(host.querySelector('[data-part="status"]')!.textContent).toBeTruthy();
  });
});
