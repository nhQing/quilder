/**
 * Hợp đồng giữa builder và vỏ MCP: hash của bộ tool.
 *
 * ## Vấn đề nó giải
 *
 * `mcp/server.mjs` được tải về máy người dùng (`/api/tokens/client`) rồi nằm đó hàng
 * tháng. Server thêm tool hay đổi schema thì bản trên máy không biết mình đã cũ:
 * Claude vẫn thấy danh mục lúc khởi động, gọi theo schema cũ, và nhận lỗi validate
 * mà không hiểu vì sao. Mẫu là Webstudio (`packages/protocol/src/contract-version.ts`):
 * version là hash cấu trúc của schema, lệch là biết ngay.
 *
 * Hash phủ đúng thứ client dựa vào: tên, đọc/ghi, input schema của từng tool, cộng
 * schema của op (`apply_ops` nhận op, nên đổi op là đổi hợp đồng). KHÔNG phủ mô tả:
 * sửa câu chữ không bắt client tải lại gì.
 *
 * `mcp/contract.snapshot.json` là bản commit của hợp đồng — `contract.test.ts` so
 * registry với nó, nên đổi tool là phải chạy `pnpm mcp:snapshot` và diff hiện trong PR.
 */

import { createHash } from 'node:crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { zOp } from '@/lib/doc/schema';
import { toolInputSchema } from './json-schema';
import type { ToolDef } from './tools';

/**
 * Phiên bản tối thiểu của `mcp/server.mjs` mà server còn phục vụ.
 *
 * Bản đó gửi `x-mm-client: <số>`. Bản cũ hơn (không gửi header) được tính là 1. Tăng
 * số này khi một thay đổi ở server làm vỡ bản proxy cũ — server sẽ trả lời bản cũ bằng
 * một thông điệp bảo người dùng tải lại, thay vì một lỗi khó hiểu.
 */
export const MIN_MCP_CLIENT = 1;

/** JSON với khoá sắp xếp — cùng dữ liệu ra cùng chuỗi, bất kể thứ tự khai báo. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export interface ToolContract {
  name: string;
  readOnly: boolean;
  /** 12 ký tự đầu của sha256 input schema — đủ để thấy tool nào đổi trong diff. */
  schema: string;
}

export function toolContracts(tools: readonly Pick<ToolDef, 'name' | 'readOnly' | 'input'>[]): ToolContract[] {
  return tools
    .map((tool) => ({
      name: tool.name,
      readOnly: tool.readOnly,
      schema: sha(canonicalJson(toolInputSchema(tool))).slice(0, 12),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function opContract(): string {
  // `root`: schema op đệ quy (style lồng calc lồng len), `none` sẽ nổ ra hàng MB.
  return sha(canonicalJson(zodToJsonSchema(zOp, { $refStrategy: 'root' }))).slice(0, 12);
}

export function contractHash(tools: readonly Pick<ToolDef, 'name' | 'readOnly' | 'input'>[]): string {
  return sha(canonicalJson({ tools: toolContracts(tools), ops: opContract() })).slice(0, 16);
}
