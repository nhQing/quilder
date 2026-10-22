import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { token: { findMany: vi.fn().mockResolvedValue([]) } } }));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

/**
 * `inline` + `js` là ca duy nhất trong `CustomCode` mà cho qua sẽ tạo ra một quả
 * bom hẹn giờ: JS nằm im trong database, không chạy vì renderer chưa hiện thực
 * `inline`, rồi sống lại **cùng lúc, trên mọi trang** vào ngày ai đó hiện thực nó.
 */

function docWith(node: Record<string, unknown>): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'Section', parentId: null, children: ['cc'], effects: [], style: { base: {} } },
      cc: { id: 'cc', type: 'CustomCode', parentId: 'root', children: [], effects: [], style: { base: {} }, ...node },
    },
  } as unknown as Doc;
}

const setProps = (props: Record<string, unknown>) => [{ op: 'setProps', nodeId: 'cc', props }];

describe('validateOps — CustomCode', () => {
  it('inline + js bị chặn, cả với người', async () => {
    const r = await validateOps(docWith({ mode: 'iframe' }), setProps({ mode: 'inline', js: 'alert(1)' }), 'human');
    expect(r.ok).toBe(false);
    expect(r.issues?.some((i) => i.code === 'customcode_inline_js')).toBe(true);
    expect(r.issues?.[0]?.message).toContain('iframe');
  });

  it('iframe + js ĐI QUA — đó là điểm của tính năng', async () => {
    const r = await validateOps(
      docWith({ mode: 'iframe' }),
      setProps({ mode: 'iframe', js: 'import * as T from "https://esm.sh/three"' }),
      'ai',
    );
    expect(r.ok).toBe(true);
  });

  it('inline không có js thì vẫn được — html/css tĩnh là ca hợp lệ', async () => {
    const r = await validateOps(docWith({ mode: 'iframe' }), setProps({ mode: 'inline', css: 'p{}' }), 'human');
    expect(r.ok).toBe(true);
  });

  it('sửa js mà KHÔNG nói tới mode thì không bị chặn', async () => {
    // Node đang là iframe; op chỉ đổi js. Chặn ở đây là chặn sai.
    const r = await validateOps(docWith({ mode: 'iframe' }), setProps({ js: 'x=1' }), 'ai');
    expect(r.ok).toBe(true);
  });

  it('insertNode mang inline + js cũng bị chặn', async () => {
    const r = await validateOps(
      docWith({ mode: 'iframe' }),
      [
        {
          op: 'insertNode',
          parentId: 'root',
          index: 0,
          node: {
            id: 'cc2', type: 'CustomCode', parentId: 'root', children: [],
            effects: [], style: { base: {} }, mode: 'inline', js: 'alert(1)',
          },
        },
      ],
      'human',
    );
    expect(r.ok).toBe(false);
    expect(r.issues?.some((i) => i.code === 'customcode_inline_js')).toBe(true);
  });
});
