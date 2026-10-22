/**
 * Ghi lại hợp đồng MCP hiện tại vào `mcp/contract.snapshot.json`.
 *
 *   pnpm mcp:snapshot
 *
 * Chạy sau khi thêm, bớt hay đổi schema một tool, rồi commit file kết quả. Diff của
 * file đó là thứ người review nhìn: "thêm một tool GHI" phải được thấy tận mắt, không
 * lọt qua trong một PR lớn. Xem `src/lib/ai/contract.ts`.
 */

import { writeFileSync } from 'node:fs';

import { contractHash, opContract, toolContracts } from '../src/lib/ai/contract';
import { TOOLS } from '../src/lib/ai/tools';

const snapshot = {
  $comment: 'SINH TỰ ĐỘNG bởi scripts/mcp-snapshot.ts. Đổi tool thì chạy `pnpm mcp:snapshot` và commit.',
  hash: contractHash(TOOLS),
  ops: opContract(),
  writeTools: toolContracts(TOOLS).filter((t) => !t.readOnly).map((t) => t.name),
  tools: toolContracts(TOOLS),
};

writeFileSync('mcp/contract.snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `mcp/contract.snapshot.json: hash ${snapshot.hash}, ${snapshot.tools.length} tool, ` +
    `${snapshot.writeTools.length} tool ghi`,
);
process.exit(0);
