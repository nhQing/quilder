// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetDialog } from './AssetDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Kho giả 150 ảnh; route trả đúng trang được hỏi — như `GET /api/assets?take=`. */
const KHO = Array.from({ length: 150 }, (_, i) => ({
  id: `a${i}`,
  key: `public/builder/anh-${i}.png`,
  url: `https://cdn.example/public/builder/anh-${i}.png`,
  mime: 'image/png',
  width: 10,
  height: 10,
  folder: null,
}));

const calls: string[] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: string) => {
    calls.push(input);
    const u = new URL(input, 'http://x');
    if (u.pathname === '/api/assets/folders') return new Response(JSON.stringify({ folders: [] }));
    const take = Number(u.searchParams.get('take'));
    const skip = Number(u.searchParams.get('skip'));
    const q = u.searchParams.get('q') ?? '';
    const hit = KHO.filter((a) => a.key.includes(q));
    return new Response(JSON.stringify({ assets: hit.slice(skip, skip + take), total: hit.length, hiddenByMime: 0 }));
  }),
);

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('AssetDialog — phân trang ở server', () => {
  afterEach(() => {
    calls.length = 0;
    document.body.innerHTML = '';
  });

  it('mở ra chỉ nạp MỘT trang, không nạp cả kho', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<AssetDialog open onClose={() => {}} value={null} onPick={() => {}} />);
    });
    await flush();

    const listCalls = calls.filter((c) => c.startsWith('/api/assets?'));
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]).toContain('take=60');
    expect(listCalls[0]).toContain('skip=0');
    expect(host.querySelectorAll('li').length).toBe(60);
    expect(host.textContent).toContain('150 ảnh');
    expect(host.textContent).toContain('Đang hiện 60/150 ảnh');

    // "Hiện thêm" hỏi trang kế, nối vào lưới.
    const more = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Hiện thêm')!;
    await act(async () => more.click());
    await flush();
    expect(calls.filter((c) => c.startsWith('/api/assets?')).at(-1)).toContain('skip=60');
    expect(host.querySelectorAll('li').length).toBe(120);
    act(() => root.unmount());
  });
});
