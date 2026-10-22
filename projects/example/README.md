# Gói dự án

Một **gói dự án** mang những thứ riêng của một website mà không thuộc lõi Quilder: khối tự dựng
DOM (bộ tính lãi, biểu đồ…), effect chuyển động riêng, CSS, font, ảnh, dữ liệu mẫu. Thư mục này
là gói MẪU — tài liệu sống, và là thứ test dùng để kiểm cơ chế gói.

## Cấu trúc

```
projects/<tên>/
  index.ts          defineProject({ name, composites, guideNotes })
  effects.ts        effect riêng: Record<string, Entry> — chạy CẢ ở trình duyệt, chỉ khai
                    import() động, đừng kéo code chỉ-server vào đây
  styles.css        @import './styles/index.css'   (đường bundler: canvas builder)
  styles/index.css  CSS của gói, nối SAU CSS lõi    (site công khai, niêm phong khi Publish)
  styles/tokens.css (tuỳ chọn) token tĩnh của gói — `:root { --x: … }`, có thể kèm @media
  public/           font, ảnh — phục vụ ở /p/<đường-dẫn> VÀ ở đường gốc (/img/…, /svg/…)
  src/              composite, effect (+ *.test.ts — vitest tự chạy)
  seed.ts           (tuỳ chọn) export default async (prisma, { siteId }) => …
  e2e/              (tuỳ chọn) spec Playwright, chạy bằng E2E_PROJECT=<tên> pnpm e2e
```

## Bật gói

`QUILDER_PROJECT=<tên>` trong `.env` (dev) hoặc `--build-arg QUILDER_PROJECT=<tên>` (Docker —
`pnpm release` tự đọc từ `.env`). Không đặt = Quilder thuần. Đặt tên mà thư mục không có
`index.ts` thì build DỪNG — thà dừng còn hơn ra một site mất hết khối riêng mà không báo lỗi.

Mỗi gói thật là **một repo git riêng**, clone vào `projects/<tên>/`. Repo Quilder bỏ qua
`projects/*` (trừ gói mẫu này), nên đồ của một khách hàng không bao giờ lọt vào lõi.

## Composite

```ts
export const hello = defineComposite({
  key: 'ExampleHello',                       // PascalCase, không trùng composite lõi
  params: z.object({ greeting: z.string().max(120).default('Xin chào') }).catch({ greeting: 'Xin chào' }),
  description: 'Mô tả cho AI — vào catalog get_node_schema.',
  translatableParams: [['greeting', 120]],   // chữ dịch được trong params
  Component: ({ params, slots, renderChild, site, data }) => <p>{params.greeting}</p>,
  loadData: async (nodes, site) => new Map(), // (tuỳ chọn) dữ liệu tầng trang, nạp trên server
});
```

- Lõi bọc `<div data-composite="<key>">` ngoài `Component` và parse `params` bằng chính schema
  của nó trước khi gọi. Nên `.catch()` cả object: một hàng JSONB hỏng rơi về mặc định thay vì
  làm trắng trang.
- Nội dung do người dựng sửa được thì đi qua **slot** (`renderChild(id)`), không qua params.
- Doc mang composite của một gói KHÔNG bật vẫn render: nội dung slot hiện ra, chỉ phần tự dựng
  DOM là vắng.

## Effect

`effects.ts` export `Record<string, Entry>`: `{ 'ten-effect': { load: () => import('./src/effects/x'), gates? } }`.
Module effect dùng `defineEffect` của lõi (`@/lib/motion/effects/types`). Trùng tên effect lõi
thì ném lúc nạp. `conflicts` chỉ cần khai MỘT phía — validator đọc cả hai.

## CSS

Mọi CSS của gói PHẢI vào layer `base` — `@import './x.css' layer(base);` hoặc khối
`@layer base { … }`. CSS ngoài layer thắng cả style của từng trang (`@layer doc`).

Token:

- Token một giá trị của dự án → **token tự tạo** trong bảng Token (màn builder hoặc script của
  gói), renderer tự phát và niêm phong vào release.
- Token cần đổi theo khổ màn (`@media`) → `styles/tokens.css` của gói. `pnpm tokens:import` và
  `pnpm check:tokens` đọc cả file này, nên token ở đây là token hợp lệ khi ghi trang.
- Font mặc định của lõi là Inter. Gói đè `--font-display` / `--font-body` trong CSS của nó.

## Script

Script chạy bằng `tsx` (seed, `effects:sync`) KHÔNG đi qua alias `@project` — alias đó chỉ có
trong bản build Next. Lõi nạp `seed.ts` và `effects.ts` của gói theo đường dẫn; script riêng của
gói import lõi bằng đường tương đối (`../../../src/…`) và chạy từ gốc repo.

## Luật cho AI

`guideNotes` nối vào cuối hướng dẫn Claude nhận qua MCP, dưới tiêu đề "LUẬT RIÊNG CỦA DỰ ÁN".
