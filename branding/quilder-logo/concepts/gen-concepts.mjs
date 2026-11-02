// Bảng so sánh các phương án logo — chỉ để CHỌN, không phải file chính thức.
// node branding/quilder-logo/concepts/gen-concepts.mjs  → concepts.html + concepts.png
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const f = (n) => +n.toFixed(2);
const pt = (cx, cy, rad, deg) => [f(cx + rad * Math.cos((deg * Math.PI) / 180)), f(cy + rad * Math.sin((deg * Math.PI) / 180))];
// Vành khuyên từ góc a0 tới a1, theo chiều kim đồng hồ trên màn (0° = phải, 90° = dưới).
function annulus(cx, cy, R, r, a0, a1) {
  const L = (a1 - a0 + 360) % 360 > 180 ? 1 : 0;
  const [x0, y0] = pt(cx, cy, R, a0), [x1, y1] = pt(cx, cy, R, a1), [x2, y2] = pt(cx, cy, r, a1), [x3, y3] = pt(cx, cy, r, a0);
  return `M${x0} ${y0}A${R} ${R} 0 ${L} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${L} 0 ${x3} ${y3}Z`;
}
function arc(cx, cy, rad, a0, a1) {
  const L = (a1 - a0 + 360) % 360 > 180 ? 1 : 0;
  const [x0, y0] = pt(cx, cy, rad, a0), [x1, y1] = pt(cx, cy, rad, a1);
  return `M${x0} ${y0}A${rad} ${rad} 0 ${L} 1 ${x1} ${y1}`;
}
// Khối góc: vuông ngoài (bo K), khuyết tròn bán kính r ở góc trên-trái (tâm cx,cy), lệch D.
function cornerBlock(cx, cy, R, r, D, K) {
  const o = [cx + D, cy + D];
  const [x, y] = o;
  return `M${x + r} ${y}H${x + R - K}A${K} ${K} 0 0 1 ${x + R} ${y + K}V${y + R - K}A${K} ${K} 0 0 1 ${x + R - K} ${y + R}H${x + K}A${K} ${K} 0 0 1 ${x} ${y + R - K}V${y + r}A${r} ${r} 0 0 0 ${x + r} ${y}Z`;
}
// Vòng kín: hai đường tròn, lỗ bằng evenodd (cung 360° không vẽ được bằng một lệnh A).
const ring = (cx, cy, R, r) => `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0ZM${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
let uid = 0;
// Mỗi phương án: (ink, accent, cut) → nội dung SVG 64×64. `cut` = màu nền, chỉ để tham khảo;
// khe hở luôn làm bằng mask nên đặt lên nền nào cũng đúng.
const concepts = [
  {
    key: 'A', name: 'Khối góc trượt (bản hiện tại)',
    note: 'Vòng dày + khối góc trượt chéo ra như đang được kéo vào ghép.',
    draw: (ink, acc) => `<path d="${annulus(30, 30, 26, 12, 90, 360)}" fill="${ink}"/><path d="${cornerBlock(30, 30, 26, 12, 4, 4)}" fill="${acc}"/>`,
  },
  {
    key: 'B', name: 'Ba vòng nét',
    note: 'Q vẽ bằng 3 cung đồng tâm, đầu nét tròn như bộ icon của app. Nhẹ, nhiều đường nét.',
    draw: (ink, acc) => `<g fill="none" stroke="${ink}" stroke-width="4.6" stroke-linecap="round">${[26, 18.5, 11].map((rr) => `<path d="${arc(30, 30, rr, 90, 360)}"/>`).join('')}</g><rect x="36" y="36" width="24" height="24" rx="5" fill="${acc}"/>`,
  },
  {
    key: 'C', name: 'Các section xếp tầng',
    note: 'Vòng bị cắt ngang thành từng dải như các section của một trang web xếp chồng.',
    draw: (ink, acc) => {
      const id = `c${uid++}`;
      const cuts = [14.5, 25.5, 36.5, 47.5].map((y) => `<rect x="0" y="${y}" width="64" height="2.6"/>`).join('');
      return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><g fill="#000">${cuts}</g></mask></defs><g mask="url(#${id})"><path d="${annulus(30, 30, 26, 12, 90, 360)}" fill="${ink}"/><path d="${cornerBlock(30, 30, 26, 12, 4, 4)}" fill="${acc}"/></g>`;
    },
  },
  {
    key: 'D', name: 'Đang được chọn',
    note: 'Vòng tròn nằm trong khung chọn của editor; tay nắm resize góc dưới-phải chính là đuôi Q.',
    draw: (ink, acc) => {
      const h = (x, y) => `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" rx="1.5" fill="none" stroke="${ink}" stroke-width="1.8"/>`;
      const frame = `<path d="M9 6H51M6 9V51M9 54H47M54 9V47" fill="none" stroke="${ink}" stroke-width="1.8"/>`;
      return `<path d="${ring(30, 30, 19.5, 9.5)}" fill-rule="evenodd" fill="${ink}"/>${frame}${h(6, 6)}${h(54, 6)}${h(6, 54)}<rect x="46" y="46" width="13" height="13" rx="3" fill="${acc}"/>`;
    },
  },
  {
    key: 'E', name: 'Ghép mô-đun',
    note: 'Vòng chia 3 mảnh rời bằng khe đều, cộng khối góc — Q ghép từ các mô-đun.',
    draw: (ink, acc) => {
      const g = 4.5; // độ của khe
      return [[90 + g / 2, 180 - g / 2], [180 + g / 2, 270 - g / 2], [270 + g / 2, 360]].map(([a, b]) => `<path d="${annulus(30, 30, 26, 12, a, b)}" fill="${ink}"/>`).join('') + `<path d="${cornerBlock(30, 30, 26, 12, 4, 4)}" fill="${acc}"/>`;
    },
  },
  {
    key: 'F', name: 'Con trỏ',
    note: 'Vòng tròn + con trỏ chuột làm đuôi Q — "bấm vào là sửa", khe hở cắt vào vòng.',
    draw: (ink, acc) => {
      const id = `f${uid++}`;
      const cur = 'M0 0V18.5L4.8 14L8.3 21.6L11.6 20.1L8.2 12.7H14.6Z';
      const t = 'translate(38.5 38.5)';
      return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><path d="${cur}" transform="${t}" fill="#000" stroke="#000" stroke-width="6" stroke-linejoin="round"/></mask></defs><path mask="url(#${id})" d="${ring(29, 29, 25, 13)}" fill-rule="evenodd" fill="${ink}"/><path d="${cur}" transform="${t}" fill="${acc}" stroke="${acc}" stroke-width="1.2" stroke-linejoin="round"/>`;
    },
  },
];

const svg = (body, size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${body}</svg>`;
const rows = concepts.map((c) => `
<section>
  <div class="meta"><b>${c.key}</b><div><h3>${c.name}</h3><p>${c.note}</p></div></div>
  <div class="cell light">${svg(c.draw('#0F1A2E', '#2A62D9'), 128)}</div>
  <div class="cell brand"><span class="tile">${svg(c.draw('#FFFFFF', '#FFFFFF'), 32)}</span><span class="big">${svg(c.draw('#FFFFFF', '#FFFFFF'), 96)}</span></div>
  <div class="cell dark">${svg(c.draw('#E7ECF3', '#6C9BFF'), 96)}</div>
  <div class="cell light small">${svg(c.draw('#0F1A2E', '#2A62D9'), 32)}${svg(c.draw('#0F1A2E', '#2A62D9'), 16)}</div>
</section>`).join('');
const html = `<!doctype html><meta charset="utf-8"><title>Quilder — phương án logo</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&display=block">
<style>
body{margin:0;padding:32px;background:#eef3f9;font-family:'Be Vietnam Pro',sans-serif;color:#0f1a2e;width:1240px;box-sizing:border-box}
h1{font-size:26px;margin:0 0 4px}.sub{color:#536176;margin:0 0 20px;font-size:14px}
.head,section{display:grid;grid-template-columns:300px 220px 220px 200px 1fr;gap:12px;align-items:stretch}
.head{font-size:12px;color:#536176;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
section{margin-bottom:12px}
.meta{display:flex;gap:12px;background:#fff;border-radius:20px;padding:16px}
.meta b{font-size:22px;color:#2a62d9;min-width:22px}.meta h3{margin:0 0 4px;font-size:16px}.meta p{margin:0;font-size:13px;color:#536176;line-height:1.45}
.cell{border-radius:20px;display:flex;align-items:center;justify-content:center;gap:18px;min-height:168px}
.light{background:#fff}.brand{background:#2a62d9}.dark{background:#111722}
.tile{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#2a62d9;box-shadow:0 0 0 1px #ffffff55}
</style>
<h1>Quilder — phương án logo</h1><p class="sub">Màu theo token vỏ builder: shell-ink #0F1A2E, brand #2A62D9; nền tối #111722, accent tối #6C9BFF.</p>
<div class="head"><span>Phương án</span><span>Nền sáng</span><span>Trắng / ô 44px ở menu</span><span>Nền tối</span><span>32px · 16px</span></div>
${rows}`;
writeFileSync(resolve(here, 'concepts.html'), html);

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 800 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(here, 'concepts.png'), fullPage: true });
await browser.close();
console.log('concepts.html, concepts.png');
