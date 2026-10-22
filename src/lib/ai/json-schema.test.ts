/**
 * Chốt chặn cho ngân sách prompt.
 *
 * Danh mục tool đi vào prompt của model ở MỖI LƯỢT. Một tool có inputSchema
 * phình là một lỗi toàn cục: nó không làm tool đó hỏng, nó làm mọi phiên chat
 * nối tới builder chết bằng "prompt too long" sau vài câu — rất khó truy về đây.
 *
 * Test này là nơi phát hiện chuyện đó, chứ không phải một phiên chat của người
 * dùng. Xem lịch sử ở `json-schema.ts`.
 */

import { describe, expect, it } from 'vitest';

import { inputSchemaBytes, MAX_INPUT_SCHEMA_BYTES, toolInputSchema } from './json-schema';
import { TOOLS } from './tools';

describe('ngân sách inputSchema', () => {
  it.each(TOOLS.map((t) => [t.name, t] as const))(
    '%s nằm dưới trần',
    (name, tool) => {
      const bytes = inputSchemaBytes(tool);
      expect(
        bytes,
        `inputSchema của "${name}" là ${bytes.toLocaleString()} byte, vượt trần ` +
          `${MAX_INPUT_SCHEMA_BYTES.toLocaleString()}. Gần như chắc chắn bạn vừa đưa một ` +
          `union đệ quy (zOp / zNode / zStylePatch) vào \`input\`. Đừng nâng trần: khai ` +
          `input LỎNG ở tầng công bố (z.array(z.unknown()), z.record(z.unknown())) và để ` +
          `validator thật chạy trong handler — xem chú thích ở json-schema.ts.`,
      ).toBeLessThan(MAX_INPUT_SCHEMA_BYTES);
    },
  );

  it('tổng danh mục vẫn vừa một prompt', () => {
    const total = TOOLS.reduce((sum, t) => sum + inputSchemaBytes(t), 0);
    // ~30k token cho toàn bộ schema. Vượt là dấu hiệu bộ tool cần chia nhỏ.
    expect(total).toBeLessThan(100_000);
  });

  it('không còn dạng tuple mà client từ chối', () => {
    const hasArrayItems = (node: unknown): boolean => {
      if (Array.isArray(node)) return node.some(hasArrayItems);
      if (node === null || typeof node !== 'object') return false;
      return Object.entries(node as Record<string, unknown>).some(
        ([key, value]) => (key === 'items' && Array.isArray(value)) || hasArrayItems(value),
      );
    };

    for (const tool of TOOLS) {
      expect(hasArrayItems(toolInputSchema(tool)), `${tool.name} còn items dạng mảng`).toBe(false);
    }
  });
});
