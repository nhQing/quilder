/**
 * Chụp và so ảnh trang công khai — phép thử "không đổi một pixel" khi refactor lớn.
 *
 *   node scripts/shots.mjs capture <thư-mục> <gốc-url> <đường-dẫn…>
 *   node scripts/shots.mjs compare <thư-mục-a> <thư-mục-b>
 *
 * Chụp: mỗi đường dẫn × 3 khổ (375/768/1440), full page, `reducedMotion: 'reduce'` +
 * `animations: 'disabled'` để effect không làm ảnh khác nhau giữa hai lần chụp. Lưu kèm
 * HTML và bó CSS (`/mm-css/<hash>.css`) để khi ảnh lệch còn so được nguyên nhân.
 *
 * So: đếm pixel khác nhau trong trình duyệt (canvas), không cần thư viện ảnh. Khác kích
 * thước là khác. Ghi ảnh diff (đỏ = khác) cạnh ảnh b. Thoát mã 1 nếu có ảnh nào khác.
 */

import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const WIDTHS = [375, 768, 1440];
const [mode, a, b, ...rest] = process.argv.slice(2);

const fileName = (path, w) => `${(path.replace(/^\//, '') || 'home').replace(/[^a-z0-9-]+/gi, '_')}-${w}`;

async function capture(dir, base, paths) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  for (const path of paths) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 180000 });
      // Cuộn hết trang để ảnh lazy nạp, rồi về đầu.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        scrollTo(0, 0);
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      const name = fileName(path, w);
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true, animations: 'disabled' });
      if (w === WIDTHS[0]) {
        writeFileSync(join(dir, `${name}.html`), await page.content());
        const css = await page.evaluate(async () => {
          const l = document.querySelector('link[href*="/mm-css/"]');
          return l ? (await fetch(l.href)).text() : '';
        });
        writeFileSync(join(dir, `${name}.css`), css);
      }
      console.log(`${res?.status()} ${path} @${w} → ${name}.png`);
      await ctx.close();
    }
  }
  await browser.close();
}

async function compare(dirA, dirB) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let bad = 0;
  for (const f of readdirSync(dirA).filter((x) => x.endsWith('.png') && !x.endsWith('.diff.png'))) {
    if (!existsSync(join(dirB, f))) { console.log(`THIẾU ${f}`); bad++; continue; }
    const da = `data:image/png;base64,${readFileSync(join(dirA, f)).toString('base64')}`;
    const db = `data:image/png;base64,${readFileSync(join(dirB, f)).toString('base64')}`;
    const r = await page.evaluate(async ([ua, ub]) => {
      const load = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = u; });
      const [ia, ib] = await Promise.all([load(ua), load(ub)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} ≠ ${ib.width}x${ib.height}` };
      const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
      const x = c.getContext('2d');
      x.drawImage(ia, 0, 0); const pa = x.getImageData(0, 0, c.width, c.height);
      x.drawImage(ib, 0, 0); const pb = x.getImageData(0, 0, c.width, c.height);
      const out = x.createImageData(c.width, c.height);
      let n = 0;
      for (let i = 0; i < pa.data.length; i += 4) {
        const d = Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]);
        if (d > 0) { n++; out.data[i] = 255; out.data[i + 3] = 255; } else { out.data[i + 3] = 40; out.data[i] = out.data[i + 1] = out.data[i + 2] = pb.data[i]; }
      }
      x.putImageData(out, 0, 0);
      return { n, diff: n ? c.toDataURL('image/png') : null };
    }, [da, db]);
    if (r.size) { console.log(`KHÁC KÍCH THƯỚC ${f}: ${r.size}`); bad++; continue; }
    if (r.n) {
      bad++;
      writeFileSync(join(dirB, f.replace('.png', '.diff.png')), Buffer.from(r.diff.split(',')[1], 'base64'));
      console.log(`KHÁC ${f}: ${r.n} pixel`);
    } else console.log(`giống ${f}`);
  }
  await browser.close();
  console.log(bad ? `\n${bad} ảnh khác` : '\nTất cả giống nhau');
  process.exit(bad ? 1 : 0);
}

if (mode === 'capture') await capture(a, b, rest);
else if (mode === 'compare') await compare(a, b);
else { console.error('Dùng: capture <dir> <base> <path…> | compare <dirA> <dirB>'); process.exit(2); }
