/**
 * JSON Schema công bố cho từng tool — và cái trần giữ nó không phình.
 *
 * ## Vì sao có file này thay vì gọi thẳng zodToJsonSchema trong route
 *
 * 21/08/2026: `apply_ops` công bố một inputSchema 7,3 MB (~2 triệu token). MCP
 * client nhồi tools/list vào prompt MỖI LƯỢT, nên mọi phiên Claude nối tới
 * builder đều chết bằng "prompt too long" sau vài câu — không phải lỗi của phiên
 * nào, và không sửa được từ phía phiên đó.
 *
 * Nguyên nhân: `$refStrategy: 'none'` inline lại schema ở mọi lần xuất hiện, còn
 * `zOp` là union 15 op, nhiều op nhúng `zNode` (union node type, `children` đệ
 * quy) và `zStylePatch` (hàng trăm prop, mỗi prop lại là union `zLen`/`zColor`
 * đệ quy). Nhân dồn ra ~104× so với bản dùng $ref. Đo được: zStylePatch 76 KB,
 * zNode 7,26 MB, zOp 7,35 MB.
 *
 * Bài học không phải "đổi sang $refStrategy khác" — mà là: schema Zod dùng để
 * VALIDATE và schema JSON dùng để MÔ TẢ CHO MODEL là hai thứ khác nhau, và cái
 * thứ hai phải có ngân sách. Một union đệ quy diễn đạt chính xác luật thì tốt
 * cho validator, nhưng với model nó chỉ là hàng trăm nghìn dòng nhiễu; model học
 * hình dạng op từ phần mô tả và từ các tool đọc (`get_node`,
 * `get_design_system`, `search_tokens`), rồi dựa vào `dryRun` để dò.
 *
 * Nên: tool nào có input to thì khai một Zod input LỎNG ở tầng công bố
 * (`z.array(z.unknown())`) và để validator thật chạy trong handler — nó vẫn trả
 * `issues` có `index` đọc được. `apply_component_ops` đã làm vậy từ đầu.
 *
 * Chốt chặn là `MAX_INPUT_SCHEMA_BYTES` + `json-schema.test.ts`: thêm một tool
 * có schema quá to thì test đỏ ngay tại chỗ, chứ không phải phát hiện qua việc
 * một phiên chat lạ chết không rõ lý do.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import type { ToolDef } from './tools';

/**
 * Trần cho MỘT inputSchema, tính bằng byte JSON.
 *
 * 24 KB ≈ 7k token. Đủ rộng cho tool đọc có enum dài (`resolve_style`), đủ chặt
 * để một union đệ quy lọt vào là vỡ ngay. Con số này là ngân sách prompt, không
 * phải giới hạn kỹ thuật của client — client chịu được nhiều hơn, nhưng nhiều
 * hơn thì người dùng trả bằng context.
 */
export const MAX_INPUT_SCHEMA_BYTES = 24_000;

/**
 * Gỡ dạng tuple của JSON Schema draft-7 khỏi output zodToJsonSchema.
 *
 * `z.tuple([a, b, c])` sinh ra `items: [schemaA, schemaB, schemaC]`. Hợp lệ theo
 * draft-7, nhưng Anthropic tool API (và MCP client đi kèm) đòi `items` là MỘT
 * schema — mảng làm cả tool bị loại khỏi danh mục, không phải bị cắt bớt âm
 * thầm.
 *
 * Tuple ở đây đều đồng nhất (`clamp` ba zLen, `mix` hai zColor), nên gộp về một
 * schema không mất thông tin gì. Trường hợp không đồng nhất thì `anyOf` giữ lại
 * đủ ràng buộc, và minItems/maxItems vẫn chốt đúng độ dài.
 */
function widenTupleItems(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(widenTupleItems);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'items' && Array.isArray(value)) {
      const members = value.map(widenTupleItems);
      const serialized = members.map((m) => JSON.stringify(m));
      const homogeneous = serialized.every((m) => m === serialized[0]);
      out.items = members.length === 0 ? {} : homogeneous ? members[0] : { anyOf: members };
      continue;
    }
    out[key] = widenTupleItems(value);
  }
  return out;
}

/**
 * JSON Schema của input một tool, dạng tự chứa.
 *
 * `$refStrategy: 'none'` vẫn giữ: MCP client và Anthropic tool API đều không đảm
 * bảo resolve được $ref. Cái giá của nó là phình, và cái phanh cho phình là
 * `MAX_INPUT_SCHEMA_BYTES` — không phải đổi strategy.
 */
export function toolInputSchema(tool: Pick<ToolDef, 'input'>): unknown {
  return widenTupleItems(
    zodToJsonSchema(tool.input, { target: 'jsonSchema7', $refStrategy: 'none' }),
  );
}

/** Số byte JSON của một inputSchema. Dùng cho test và cho thông điệp lỗi. */
export function inputSchemaBytes(tool: Pick<ToolDef, 'input'>): number {
  return JSON.stringify(toolInputSchema(tool)).length;
}
