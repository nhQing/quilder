// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FontListItem } from '@/lib/fonts/service';

import { FontRow } from './FontRow';

/**
 * Hàng họ font — luồng "Thay file" và phần "Chỗ dùng". Dựng bằng `createRoot` như
 * `controls.font.test.tsx` (repo không cài @testing-library).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FONT: FontListItem = {
  id: 'fam1',
  cssName: 'Gilroy',
  token: 'font-gilroy',
  source: 'upload',
  fallback: 'system-ui, sans-serif',
  faces: [{ id: 'face0', weight: '400', style: 'normal', subset: '', bytes: 2048, warnings: [] }],
  usage: { pages: [], components: [], variables: [] },
  unpublished: false,
  licenseNote: null,
  licenseConfirmedBy: 'a@b.c',
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fetchMock: ReturnType<typeof vi.fn>;

async function mount(font: FontListItem = FONT) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(FontRow, { font, canWrite: true, isAdmin: true, onChanged: () => {} }));
  });
}

const buttons = (label: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent === label);

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, warnings: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('FontRow — Chỗ dùng qua biến CSS', () => {
  it('họ chỉ được nhắc tên qua biến: tóm tắt đếm biến, "Chỗ dùng" liệt kê, Xoá họ bị khoá', async () => {
    await mount({ ...FONT, usage: { pages: [], components: [], variables: ['--font-display', '--lv-font-head'] } });
    expect(host.textContent).toContain('Dùng ở 2 biến CSS');
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    const vars = [...host.querySelectorAll('[data-font-usage-var]')].map((li) => li.textContent);
    expect(vars).toEqual(['dùng bởi biến --font-display', 'dùng bởi biến --lv-font-head']);
    expect(host.textContent).not.toContain('Chưa dùng ở đâu');
    expect(buttons('Xoá họ')[0]!.disabled).toBe(true);
  });
});

describe('FontRow — Thay file', () => {
  it('dryRun và lần lưu thật đều gửi replaceFaceId của face được chọn', async () => {
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    await act(async () => buttons('Thay file')[0]!.click());

    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File([new Uint8Array([1, 2, 3])], 'Gilroy-Regular.ttf');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));

    const dry = fetchMock.mock.calls[0]![1].body as FormData;
    expect(dry.get('replaceFaceId')).toBe('face0');
    expect(dry.get('dryRun')).toBe('true');

    const ack = host.querySelector<HTMLInputElement>('[data-font-replace] input[type=checkbox]')!;
    await act(async () => ack.click());
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('[data-font-replace] button')].find(
      (b) => b.textContent === 'Thay file',
    )!;
    await act(async () => confirm.click());

    const real = fetchMock.mock.calls[1]![1].body as FormData;
    expect(real.get('replaceFaceId')).toBe('face0');
    expect(real.get('dryRun')).toBeNull();
  });
});
