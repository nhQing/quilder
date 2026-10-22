<!-- SINH TỰ ĐỘNG bởi scripts/gen-docs.ts từ src/lib/doc/schema.ts (NODE_TYPE_LIST, zPropsFor). Đừng sửa tay: chạy `pnpm docs:gen`. -->

# Node type (11)

9 primitive, cộng `Composite` và `Instance`. Bộ này **đóng băng** (README, mục "Bộ node type bị đóng băng").

| Type | Lá (không có con) | Props riêng |
|---|---|---|
| `Section` | — | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `tag` |
| `Stack` | — | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `direction` |
| `Grid` | — | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `areas`, `columns` |
| `Text` | có | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `tag`, `content` |
| `Image` | có | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `assetId`, `alt`, `decorative`, `fit`, `ratio` |
| `Button` | có | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `label`, `action`, `variant` |
| `Video` | có | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `assetId`, `posterAssetId`, `autoplay`, `loop`, `muted`, `controls`, `preload` |
| `Canvas` | — | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `program`, `uniforms`, `fallbackChildId` |
| `CustomCode` | có | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `html`, `css`, `js`, `mode`, `height` |
| `Composite` | — | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `composite`, `params`, `slots` |
| `Instance` | có | `name`, `render`, `a11y`, `htmlId`, `part`, `customCss`, `locked`, `componentId`, `overrides`, `repeat` |
