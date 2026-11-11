// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FontFamilyControl, type TokenOption } from './controls';
import { useEditor } from '@/lib/builder/store';
import { firstFamilyName } from '@/lib/fonts/css';
import type { Node } from '@/lib/doc/types';

/**
 * Ô chọn họ font — cần DOM (`<select>` + sự kiện change), nên chạy dưới happy-dom.
 * Repo không cài @testing-library: dựng bằng `createRoot` như `form-dialog.test.tsx`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKENS: TokenOption[] = [
  // Token LÕI hạng font (Inter) — spec §11.5 bắt buộc có trong danh sách.
  { name: 'font-body', value: '"Inter Variable", system-ui, sans-serif', category: 'font', core: true },
  { name: 'font-gilroy', value: 'gilroy, Arial, sans-serif', category: 'font' },
  { name: 'space-l', value: '2rem', category: 'space' },
];

const node = { id: 'n1', type: 'Text', style: {} } as unknown as Node;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let dispatch: ReturnType<typeof vi.fn>;

async function mount(n: Node = node, tokens: TokenOption[] = TOKENS) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(FontFamilyControl, {
        node: n,
        breakpoint: 'base',
        group: 'typography',
        field: 'family',
        tokens,
      }),
    );
  });
}

beforeEach(() => {
  dispatch = vi.fn().mockResolvedValue(true);
  useEditor.setState({ dispatch } as never);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const select = () => host.querySelector('select')!;
const labels = () => [...select().querySelectorAll('option')].map((o) => o.textContent);

describe('FontFamilyControl', () => {
  it('chỉ liệt kê token hạng font — gồm cả token lõi — nhãn là tên họ đầu, bỏ nháy', async () => {
    await mount();
    expect(labels()).toEqual(['—', 'Inter Variable', 'gilroy']);
  });

  it('chọn một họ → setStyle { $token }', async () => {
    await mount();
    await act(async () => {
      select().value = 'font-gilroy';
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(dispatch.mock.calls[0]![0])).toContain('{"typography":{"family":{"$token":"font-gilroy"}}}');
  });

  it('chọn mục rỗng → gỡ (null)', async () => {
    const withFamily = {
      ...node,
      style: { base: { typography: { family: { $token: 'font-gilroy' } } } },
    } as unknown as Node;
    await mount(withFamily);
    expect(select().value).toBe('font-gilroy');
    await act(async () => {
      select().value = '';
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(JSON.stringify(dispatch.mock.calls[0]![0])).toContain('{"typography":{"family":null}}');
  });

  it('có link "Quản lý font →" tới màn cài đặt font', async () => {
    await mount();
    const a = [...host.querySelectorAll('a')].find((x) => x.textContent === 'Quản lý font →');
    expect(a?.getAttribute('href')).toBe('/builder/settings/fonts');
  });
});

describe('firstFamilyName', () => {
  it.each([
    ['"Inter Variable", system-ui', 'Inter Variable'],
    ['gilroy, Arial, sans-serif', 'gilroy'],
    ["'Be Vietnam Pro', sans-serif", 'Be Vietnam Pro'],
    ['"A \\"B\\" C", serif', 'A "B" C'],
    ['"A, B", serif', 'A, B'],
    ['', ''],
  ])('%s → %s', (stack, expected) => {
    expect(firstFamilyName(stack)).toBe(expected);
  });
});
