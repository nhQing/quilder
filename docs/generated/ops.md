<!-- SINH TỰ ĐỘNG bởi scripts/gen-docs.ts từ src/lib/doc/schema.ts (zOp). Đừng sửa tay: chạy `pnpm docs:gen`. -->

# Op (15)

Mọi thay đổi doc — từ inspector, undo, AI — là một batch các op này, đi qua `validateOps` 4 tầng.

| Op | Trường |
|---|---|
| `insertNode` | `parentId`, `index`, `node` |
| `removeNode` | `nodeId` |
| `moveNode` | `nodeId`, `newParentId`, `newIndex` |
| `duplicateNode` | `nodeId`, `newId` |
| `setProps` | `nodeId`, `props` |
| `setStyle` | `nodeId`, `target`, `patch` |
| `setText` | `nodeId`, `field`, `value` |
| `attachEffect` | `nodeId`, `attachment` |
| `updateEffect` | `nodeId`, `instanceId`, `params` |
| `detachEffect` | `nodeId`, `instanceId` |
| `setCustomCss` | `nodeId`, `css` |
| `setName` | `nodeId`, `name` |
| `setLocked` | `nodeId`, `locked` |
| `setPresence` | `nodeId`, `render` |
| `setOverride` | `nodeId`, `localId`, `patch` |
