import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BREAKPOINTS, DEFAULT_SCREENS, breakpointForWidth } from '@/lib/design/breakpoints';

/**
 * `mcp/server.mjs` không import được TS (nó chạy bằng `node` trần trên máy người
 * dùng), nên bảng khổ màn của `screenshot_page` / `verify_page` là một bản CHÉP của
 * `DEFAULT_SCREENS`. Bản chép đã trôi một lần: tới 08/10/2026 nó vẫn là lưới cũ, và
 * "chụp md" (900px) ra bố cục của lớp `sm`. Test này đọc thẳng file để giữ hai bên khớp.
 */
const source = readFileSync('mcp/server.mjs', 'utf8');
const match = source.match(/const SCREEN_WIDTH = (\{[^}]+\});/);

describe('khổ màn của MCP proxy', () => {
  it('có bảng SCREEN_WIDTH', () => {
    expect(match, 'không tìm thấy `const SCREEN_WIDTH = {…}` trong mcp/server.mjs').toBeTruthy();
  });

  const table = Function(`return (${match?.[1] ?? '{}'})`)() as Record<string, number>;

  it('mỗi khổ rơi đúng vào lớp style mang tên nó', () => {
    for (const bp of BREAKPOINTS) {
      expect(table[bp], `thiếu khổ ${bp}`).toBeTypeOf('number');
      expect(breakpointForWidth(table[bp]!), `${bp} = ${table[bp]}px`).toBe(bp);
    }
  });

  it('dùng đúng các bề rộng của DEFAULT_SCREENS', () => {
    expect(Object.values(table).sort((a, b) => a - b)).toEqual(
      DEFAULT_SCREENS.map((s) => s.width).sort((a, b) => a - b),
    );
  });
});
