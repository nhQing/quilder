import { describe, expect, it } from 'vitest';

import { NODE_TYPES } from '@/lib/doc/types';
import { AI_CSS_ALLOWLIST } from '@/lib/doc/ai-css-allowlist';

import { SCHEMA_TOOLS } from './schema-tools';

/**
 * Tool `get_node_schema` là TÀI LIỆU, và tài liệu thì rữa.
 *
 * Ba phép kiểm dưới đây tồn tại để nó rữa ồn ào chứ không im lặng: thêm một node
 * type mà quên viết field bắt buộc, hay sửa allowlist CSS mà quên tool này, sẽ
 * làm test đỏ tại chỗ — thay vì để một Agent ở phiên nào đó phát hiện bằng cách
 * dựng ra một trang sai.
 */

const tool = SCHEMA_TOOLS.find((t) => t.name === 'get_node_schema')!;

async function output() {
  return (await tool.run({} as never, {} as never)) as {
    nodeTypes: { type: string; required: Record<string, string> }[];
    aiCssAllowlist: { properties: string[] };
    composites: { key: string; implemented: boolean }[];
    traps: string[];
  };
}

describe('get_node_schema', () => {
  it('phủ đúng mọi node type trong NODE_TYPES', async () => {
    const out = await output();
    const documented = out.nodeTypes.map((n) => n.type).sort();
    expect(documented).toEqual([...NODE_TYPES].sort());
  });

  it('mọi node type không phải hộp chứa đều khai ít nhất một field bắt buộc', async () => {
    const out = await output();
    // Section/Stack/Grid là hộp chứa thuần — chúng KHÔNG có field riêng, và đó
    // đúng là thông tin cần truyền đạt. Mọi type còn lại thì có.
    const containers = new Set(['Section', 'Stack', 'Grid']);
    for (const n of out.nodeTypes) {
      if (containers.has(n.type)) continue;
      expect(Object.keys(n.required).length, `${n.type} không khai field nào`).toBeGreaterThan(0);
    }
  });

  it('allowlist CSS phát ra khớp nguyên văn nguồn thật', async () => {
    const out = await output();
    expect(out.aiCssAllowlist.properties).toEqual([...AI_CSS_ALLOWLIST].sort());
  });

  it('lọc được theo một type', async () => {
    const one = (await tool.run({ type: 'image' } as never, {} as never)) as {
      nodeTypes: { type: string }[];
    };
    expect(one.nodeTypes).toHaveLength(1);
    expect(one.nodeTypes[0]!.type).toBe('Image');
  });

  it('có nêu bẫy Grid.columns', async () => {
    const out = await output();
    expect(out.traps.some((t) => t.includes('gridTemplateColumns'))).toBe(true);
  });
});
