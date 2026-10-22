import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { token: { findMany: vi.fn().mockResolvedValue([]) } } }));

import { validateOps } from './validate';
import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

/**
 * `Grid.columns` parse được nhưng renderer không đọc — xem docblock của luật
 * `grid_columns_legacy` trong `validate.ts`.
 *
 * Luật này chặn ĐƯỜNG GHI chứ không gỡ field khỏi schema, nên hai chiều đều phải
 * có test: doc mới không sinh thêm field chết, và doc cũ vẫn dọn được.
 */

function gridDoc(): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: 'root',
    nodes: {
      root: {
        id: 'root', type: 'Grid', parentId: null,
        children: [], effects: [], style: { base: {} },
      },
    },
  } as unknown as Doc;
}

const TRACKS = { base: [{ kind: 'fr', v: 1 }, { kind: 'fr', v: 1 }] };

describe('validateOps — Grid.columns là field chết', () => {
  it('setProps đặt columns bị chặn, kèm mã lỗi đọc được', async () => {
    const r = await validateOps(
      gridDoc(),
      [{ op: 'setProps', nodeId: 'root', props: { columns: TRACKS } }],
      'human',
    );
    expect(r.ok).toBe(false);
    expect(r.issues?.some((i) => i.code === 'grid_columns_legacy')).toBe(true);
    // Thông điệp phải nêu đường ĐÚNG, không chỉ nói "sai".
    expect(r.issues?.[0]?.message).toContain('gridTemplateColumns');
  });

  it('insertNode mang columns cũng bị chặn', async () => {
    const r = await validateOps(
      gridDoc(),
      [
        {
          op: 'insertNode',
          parentId: 'root',
          index: 0,
          node: {
            id: 'g2', type: 'Grid', parentId: 'root',
            children: [], effects: [], style: { base: {} },
            columns: TRACKS,
          },
        },
      ],
      'human',
    );
    expect(r.ok).toBe(false);
    expect(r.issues?.some((i) => i.code === 'grid_columns_legacy')).toBe(true);
  });

  it('columns: null ĐI QUA — đó là thao tác dọn field khỏi node cũ', async () => {
    const r = await validateOps(
      gridDoc(),
      [{ op: 'setProps', nodeId: 'root', props: { columns: null } }],
      'human',
    );
    expect(r.ok).toBe(true);
  });

  it('cách đúng thì đi qua', async () => {
    const r = await validateOps(
      gridDoc(),
      [
        {
          op: 'setStyle',
          nodeId: 'root',
          target: 'base',
          patch: { layout: { display: 'grid', gridTemplateColumns: TRACKS.base } },
        },
      ],
      'human',
    );
    expect(r.ok).toBe(true);
  });

  it('chặn cả AI lẫn người — field chết với mọi actor', async () => {
    for (const actor of ['human', 'ai'] as const) {
      const r = await validateOps(
        gridDoc(),
        [{ op: 'setProps', nodeId: 'root', props: { columns: TRACKS } }],
        actor,
      );
      expect(r.ok, `actor ${actor}`).toBe(false);
    }
  });
});
