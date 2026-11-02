import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2] ?? '.');

// "Đang được chọn": chữ Q là một vòng tròn nằm trong khung chọn của editor. Đuôi Q là nét
// chéo từ vòng kéo ra tay nắm resize góc dưới-phải — tay nắm đặc, mang màu brand, như
// đang được kéo. Ba tay nắm còn lại rỗng. Lưới 64: khung 6…54, vòng tâm (30,30).
const C = 30, R = 19.5, r = 9.5;             // vòng
const F0 = 6, F1 = 54, H = 6.5, SW = 2.2;     // khung, cạnh tay nắm rỗng, độ dày nét
const BH = 13, BK = 3.2;                      // tay nắm đặc (đuôi Q): cạnh, bo góc
const b0 = F1 - BH / 2 + 1;                   // tay nắm đặc lệch ra ngoài 1 để cân thị giác
const ring = `M${C - R} ${C}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0ZM${C - r} ${C}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const g = H / 2;
const frame = `M${F0 + g} ${F0}H${F1 - g}M${F1} ${F0 + g}V${b0}M${F0} ${F0 + g}V${F1 - g}M${F0 + g} ${F1}H${b0}`;
const handle = (x, y) => `<rect x="${x - g}" y="${y - g}" width="${H}" height="${H}" rx="1.6"/>`;
// Đuôi Q: nét ngắn chéo 45° CẮT QUA thân vòng (đầu trong lòi vào lỗ, đầu ngoài nhô ra
// ngoài vòng) rồi dừng trước tay nắm. Không nối tới tay nắm: nối thì thành cán kính lúp.
const tail = `M${C + 3.5} ${C + 3.5}L${C + 15.5} ${C + 15.5}`;

const symbol = ({ ring: ink, block = ink }) =>
  `<path d="${ring}" fill-rule="evenodd" fill="${ink}"/>` +
  `<path d="${tail}" stroke="${ink}" stroke-width="7"/>` +
  `<path d="${frame}" fill="none" stroke="${ink}" stroke-width="${SW}"/>` +
  `<g fill="none" stroke="${ink}" stroke-width="${SW}">${handle(F0, F0)}${handle(F1, F0)}${handle(F0, F1)}</g>` +
  `<rect x="${b0}" y="${b0}" width="${BH}" height="${BH}" rx="${BK}" fill="${block}"/>`;

// Màu = token của vỏ builder (src/styles/builder.css): shell-ink, brand; bản tối = shell-ink
// và shell-accent của theme tối.
const INK = '#0F1A2E', WHITE = '#FFFFFF', BRAND = '#2A62D9';
const COLOR = { ring: INK, block: BRAND };
const COLOR_ON_DARK = { ring: '#E7ECF3', block: '#6C9BFF' };

const svg = (vb, w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" role="img" aria-label="Quilder"><title>Quilder</title>${body}</svg>\n`;
const word = (fill) => `<text x="74" y="44" font-family="'Be Vietnam Pro', Inter, 'Segoe UI', system-ui, sans-serif" font-size="36" font-weight="700" letter-spacing="-1" fill="${fill}">Quilder</text>`;

const files = {
  'quilder-symbol.svg': svg('0 0 64 64', 64, 64, symbol(COLOR)),
  'quilder-symbol-white.svg': svg('0 0 64 64', 64, 64, symbol({ ring: WHITE })),
  'quilder-symbol-ink.svg': svg('0 0 64 64', 64, 64, symbol({ ring: INK })),
  'quilder-wordmark.svg': svg('0 0 214 64', 214, 64, symbol(COLOR) + word(INK)),
  'quilder-wordmark-white.svg': svg('0 0 214 64', 214, 64, symbol({ ring: WHITE }) + word(WHITE)),
  'quilder-wordmark-on-dark.svg': svg('0 0 214 64', 214, 64, symbol(COLOR_ON_DARK) + word('#E7ECF3')),
};
for (const [n, s] of Object.entries(files)) writeFileSync(`${out}/${n}`, s);
console.log(Object.keys(files).join(' '));

// PNG: vẽ SVG bằng Chromium của Playwright (đã có trong devDependencies).
if (process.argv.includes('--png')) {
  const { chromium } = await import('playwright');
  mkdirSync(`${out}/png`, { recursive: true });
  // [tên file, svg nguồn, rộng, cao, nền, lề (tỉ lệ), bo góc nền (tỉ lệ)]
  // App icon = logo trắng trên ô màu brand, như ô logo ở BuilderNav (bg-shell-accent rounded-md).
  // apple-touch-icon để vuông tràn: iOS tự bo.
  const jobs = [
    ...[32, 64, 128, 256, 512, 1024].map((s) => [`quilder-symbol-${s}.png`, files['quilder-symbol.svg'], s, s, null, 0]),
    ['quilder-symbol-ink-512.png', files['quilder-symbol-ink.svg'], 512, 512, null, 0],
    ['quilder-symbol-white-512.png', files['quilder-symbol-white.svg'], 512, 512, null, 0],
    ['quilder-app-icon-512.png', files['quilder-symbol-white.svg'], 512, 512, BRAND, 0.2, 0.27],
    ['apple-touch-icon-180.png', files['quilder-symbol-white.svg'], 180, 180, BRAND, 0.2, 0],
    ['quilder-wordmark-1284.png', files['quilder-wordmark.svg'], 1284, 384, null, 0],
    ['quilder-wordmark-on-dark-1284.png', files['quilder-wordmark-on-dark.svg'], 1284, 384, null, 0],
    ['quilder-wordmark-white-1284.png', files['quilder-wordmark-white.svg'], 1284, 384, null, 0],
  ];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, src, w, h, bg, pad, round = 0] of jobs) {
    await page.setViewportSize({ width: w, height: h });
    const p = Math.round(w * pad);
    await page.setContent(
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@700&display=block">` +
      `<style>html,body{margin:0;background:transparent}div{width:${w}px;height:${h}px;box-sizing:border-box;padding:${p}px;background:${bg ?? 'transparent'};border-radius:${Math.round(w * round)}px}svg{width:100%;height:100%;display:block}</style><div>${src}</div>`,
      { waitUntil: 'networkidle' },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/png/${name}`, omitBackground: true });
  }
  await browser.close();
  console.log(`png: ${jobs.length} file`);
}
