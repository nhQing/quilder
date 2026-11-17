// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/blogs';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { isInternalNavigation, NavProgress } from './NavProgress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const here = { href: 'https://www.maimoney.com/blogs', origin: 'https://www.maimoney.com', pathname: '/blogs', search: '' } as Location;

function clickOn(html: string, init: MouseEventInit = {}): MouseEvent {
  const box = document.createElement('div');
  box.innerHTML = html;
  document.body.append(box);
  const e = new MouseEvent('click', { bubbles: true, button: 0, ...init });
  Object.defineProperty(e, 'target', { value: box.querySelector('span') ?? box.firstElementChild });
  return e;
}

describe('isInternalNavigation', () => {
  it('link nội bộ sang trang khác → có', () => {
    expect(isInternalNavigation(clickOn('<a href="/en/blogs"><span>EN</span></a>'), here)).toBe(true);
    expect(isInternalNavigation(clickOn('<a href="/blogs?page=2">2</a>'), here)).toBe(true);
  });

  it('neo trong trang, cùng URL, domain khác, tab mới, Ctrl → không', () => {
    expect(isInternalNavigation(clickOn('<a href="#about-us">x</a>'), here)).toBe(false);
    expect(isInternalNavigation(clickOn('<a href="/blogs">x</a>'), here)).toBe(false);
    expect(isInternalNavigation(clickOn('<a href="https://facebook.com/x">x</a>'), here)).toBe(false);
    expect(isInternalNavigation(clickOn('<a href="/ve-chung-toi" target="_blank">x</a>'), here)).toBe(false);
    expect(isInternalNavigation(clickOn('<a href="/ve-chung-toi">x</a>', { ctrlKey: true }), here)).toBe(false);
    expect(isInternalNavigation(clickOn('<a href="/file.pdf" download>x</a>'), here)).toBe(false);
  });
});

describe('NavProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pathname = '/blogs';
    window.history.replaceState(null, '', '/blogs');
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('hiện khi bấm link nội bộ, chạy tới 100% và ẩn khi đường dẫn đổi', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<NavProgress />));
    const bar = () => host.querySelector<HTMLElement>('[data-nav-progress]')!;
    expect(bar().style.opacity).toBe('0');

    const a = document.createElement('a');
    a.href = '/en/blogs';
    document.body.append(a);
    act(() => a.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
    expect(bar().style.opacity).toBe('1');
    act(() => vi.advanceTimersByTime(1000));
    const inner = bar().firstElementChild as HTMLElement;
    expect(inner.style.transform).toMatch(/scaleX\(0\.[1-8]/);

    pathname = '/en/blogs';
    act(() => root.render(<NavProgress />));
    expect(inner.style.transform).toBe('scaleX(1)');
    act(() => vi.advanceTimersByTime(600));
    expect(bar().style.opacity).toBe('0');
    act(() => root.unmount());
  });
});
