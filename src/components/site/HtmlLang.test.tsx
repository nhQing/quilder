// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { HtmlLang } from './HtmlLang';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('HtmlLang', () => {
  afterEach(() => {
    document.documentElement.lang = '';
  });

  it('đổi <html lang> theo trang khi điều hướng phía client', () => {
    document.documentElement.lang = 'vi'; // layout render server, không chạy lại
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<HtmlLang code="en" />));
    expect(document.documentElement.lang).toBe('en');
    act(() => root.render(<HtmlLang code="vi" />));
    expect(document.documentElement.lang).toBe('vi');
    act(() => root.unmount());
  });
});
