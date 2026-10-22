import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const f = (n) => +n.toFixed(2);
const C = { x: 29, y: 29 };
const R = 22, r = 12.5, mid = (R + r) / 2, k = 3.3, gap = 1.6;
const seams = [20, 110, 200, 290];          // độ, chiều kim đồng hồ (y hướng xuống)
const pt = (deg, rad) => { const a = (deg * Math.PI) / 180; return { x: C.x + rad * Math.cos(a), y: C.y + rad * Math.sin(a) }; };
const P = (p) => `${f(p.x)} ${f(p.y)}`;
function annulus(a0, a1) {
  const large = (a1 - a0 + 360) % 360 > 180 ? 1 : 0;
  return `M${P(pt(a0, R))}A${R} ${R} 0 ${large} 1 ${P(pt(a1, R))}L${P(pt(a1, r))}A${r} ${r} 0 ${large} 0 ${P(pt(a0, r))}Z`;
}
// Đường ráp: tia từ trong ra ngoài, giữa đường vòng nửa tròn sang mảnh KẾ TIẾP (núm).
function seam(deg) {
  const a = pt(deg, mid - k), b = pt(deg, mid + k);
  return `M${P(pt(deg, r - 1))}L${P(a)}A${k} ${k} 0 0 1 ${P(b)}L${P(pt(deg, R + 1))}`;
}
function knob(deg) {
  const a = pt(deg, mid - k), b = pt(deg, mid + k);
  return `M${P(a)}A${k} ${k} 0 0 1 ${P(b)}Z`;
}
// Sao 4 cánh = AI, làm đuôi chữ Q.
function sparkle(cx, cy, s, w) {
  return `M${f(cx)} ${f(cy - s)}C${f(cx + w)} ${f(cy - w)} ${f(cx + w)} ${f(cy - w)} ${f(cx + s)} ${f(cy)}C${f(cx + w)} ${f(cy + w)} ${f(cx + w)} ${f(cy + w)} ${f(cx)} ${f(cy + s)}C${f(cx - w)} ${f(cy + w)} ${f(cx - w)} ${f(cy + w)} ${f(cx - s)} ${f(cy)}C${f(cx - w)} ${f(cy - w)} ${f(cx - w)} ${f(cy - w)} ${f(cx)} ${f(cy - s)}Z`;
}
const tail = pt(45, R + 3.5);
function symbol(colors, id, opts = {}) {
  const pieces = seams.map((s, i) => `<path d="${annulus(s, seams[(i + 1) % 4])}" fill="${colors.pieces[i]}"/>`).join('');
  // núm của mảnh i nằm ở đường ráp CUỐI mảnh i (seams[i+1]), lồi sang mảnh i+1, cùng màu mảnh i
  const knobs = seams.map((s, i) => `<path d="${knob(seams[(i + 1) % 4])}" fill="${colors.pieces[i]}"/>`).join('');
  const cuts = seams.map((s) => `<path d="${seam(s)}"/>`).join('');
  const star = sparkle(tail.x, tail.y, 10.5, 2.2);
  const starCut = sparkle(tail.x, tail.y, 10.5 + 2.4, 2.2 + 1.6);
  return `<defs><mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
<rect width="64" height="64" fill="#fff"/>
<g fill="none" stroke="#000" stroke-width="${gap}" stroke-linecap="round" stroke-linejoin="round">${cuts}</g>
<path d="${starCut}" fill="#000"/>
</mask>${opts.defs ?? ''}</defs>
<g mask="url(#${id}m)">${pieces}${knobs}</g>
<path d="${star}" fill="${colors.star}"/>
<circle cx="${f(tail.x + 9.5)}" cy="${f(tail.y - 9)}" r="1.7" fill="${colors.star}"/>`;
}
const COLOR = { pieces: ['#4F46E5', '#0EA5E9', '#14B8A6', '#8B5CF6'], star: 'url(#qstar)' };
const starGrad = `<linearGradient id="qstar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBBF24"/><stop offset="1" stop-color="#F97316"/></linearGradient>`;
const WHITE = { pieces: ['#FFFFFF', 'rgba(255,255,255,.82)', 'rgba(255,255,255,.66)', 'rgba(255,255,255,.9)'], star: '#FFFFFF' };
const INK = { pieces: ['#111827', '#1F2937', '#374151', '#0B1120'], star: '#111827' };
const svg = (vb, w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const files = {
  'quilder-symbol.svg': svg('0 0 64 64', 64, 64, symbol(COLOR, 'a', { defs: starGrad }), 'Quilder'),
  'quilder-symbol-white.svg': svg('0 0 64 64', 64, 64, symbol(WHITE, 'b'), 'Quilder'),
  'quilder-symbol-ink.svg': svg('0 0 64 64', 64, 64, symbol(INK, 'c'), 'Quilder'),
};
const word = (fill) => `<text x="74" y="43" font-family="'Be Vietnam Pro', Inter, 'Segoe UI', system-ui, sans-serif" font-size="34" font-weight="700" letter-spacing="-0.5" fill="${fill}">Quilder</text>`;
files['quilder-wordmark.svg'] = svg('0 0 214 64', 214, 64, symbol(COLOR, 'd', { defs: starGrad }) + word('#111827'), 'Quilder');
files['quilder-wordmark-white.svg'] = svg('0 0 214 64', 214, 64, symbol(WHITE, 'e') + word('#FFFFFF'), 'Quilder');
files['quilder-wordmark-on-dark.svg'] = svg('0 0 214 64', 214, 64, symbol(COLOR, 'g', { defs: starGrad }) + word('#F9FAFB'), 'Quilder');
for (const [n, s] of Object.entries(files)) writeFileSync(`${out}/${n}`, s);
console.log(Object.keys(files).join(' '));
