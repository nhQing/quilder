/**
 * So TỪNG chữ, nút, ảnh của một trang trong builder với trang thật — theo section.
 *
 *   MM_BUILDER_URL=http://10.60.0.79:3002 MM_BUILDER_TOKEN=<token MCP> \
 *     node scripts/size-check.mjs <pageId> <url trang thật> [390,1440,1920]
 *
 * ## Vì sao không chỉ dùng `compare_with_url`
 *
 * Tool MCP đó chỉ in những dòng vượt ngưỡng nặng nhất và ghép chữ khá lỏng, nên nó
 * từng bỏ sót cả một tiêu đề 48px ↔ 60px và một nút 150×45 ↔ 281×78 trên /maicash
 * (26/10/2026). Script này liệt kê HẾT: mỗi đoạn chữ của trang thật được tìm lại
 * trong bản nháp theo nội dung; ảnh ghép theo thứ tự trong section; nút theo nhãn.
 *
 * Bản nháp mở qua `/preview/<pageId>` với token làm cookie phiên — cùng cách
 * `screenshot_page` của mcp/server.mjs làm.
 */

import { chromium } from 'playwright';

const BASE = (process.env.MM_BUILDER_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.MM_BUILDER_TOKEN ?? '';
const [pageId, liveUrl, widthsArg = '390,1440,1920'] = process.argv.slice(2);
if (!BASE || !TOKEN || !pageId || !liveUrl) {
  console.error('Cần MM_BUILDER_URL, MM_BUILDER_TOKEN, <pageId> và <url trang thật>.');
  process.exit(1);
}

/** Chạy TRONG trang: gom chữ / ảnh / nút theo section. */
function collect() {
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const skip = (e) =>
    e.closest('header, footer, [data-n="i-header"], [data-n="i-footer"], [aria-hidden="true"]');
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    const c = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.opacity !== '0' && !skip(e);
  };
  const out = { texts: [], imgs: [], btns: [] };
  const sections = [...document.querySelectorAll('main section')].filter(
    (s) => !s.parentElement.closest('main section'),
  );
  for (const s of sections) {
    const sec = norm(s.innerText || '').slice(0, 25);
    for (const e of s.querySelectorAll('*')) {
      if (!visible(e)) continue;
      const c = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const own = [...e.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent)
        .join(' ');
      if (own.trim()) {
        let blk = e;
        while (blk.parentElement && getComputedStyle(blk).display === 'inline') blk = blk.parentElement;
        const b = blk.getBoundingClientRect();
        out.texts.push({
          sec, t: norm(own).slice(0, 40), fs: parseFloat(c.fontSize),
          lh: c.lineHeight === 'normal' ? 0 : parseFloat(c.lineHeight), fw: Number(c.fontWeight),
          w: Math.round(b.width), h: Math.round(b.height), color: c.color, id: e.dataset.n || blk.dataset.n || '',
        });
      }
      if (e.tagName === 'IMG' || e.tagName === 'VIDEO') {
        out.imgs.push({ sec, w: Math.round(r.width), h: Math.round(r.height), id: e.dataset.n || '' });
      }
      const isBtn = e.tagName === 'BUTTON' || /btn|Button_button/.test(String(e.className));
      if (isBtn) {
        out.btns.push({
          sec, t: norm(e.innerText).slice(0, 25), w: Math.round(r.width), h: Math.round(r.height),
          bg: c.backgroundColor, radius: c.borderRadius, id: e.dataset.n || '',
        });
      }
    }
  }
  return out;
}

async function grab(browser, url, width, cookie) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  if (cookie) await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
  // Cuộn hết trang cho lazy-load và hiệu ứng vào chạy xong, rồi dừng mọi dải trượt.
  for (let y = 0; y < 30_000; y += 600) {
    await page.evaluate((v) => scrollTo(0, v), y);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('.swiper').forEach((s) => s.swiper?.autoplay?.stop()));
  const data = await page.evaluate(collect);
  await ctx.close();
  return data;
}

const browser = await chromium.launch();
const cookie = { name: 'mm_session', value: TOKEN, domain: new URL(BASE).hostname, path: '/', httpOnly: true };

for (const width of widthsArg.split(',').map(Number)) {
  const [ours, live] = await Promise.all([
    grab(browser, `${BASE}/preview/${pageId}`, width, cookie),
    grab(browser, liveUrl, width),
  ]);
  console.log(`\n######## ${width}px`);
  let n = 0;
  const used = new Set();

  for (const l of live.texts) {
    const i = ours.texts.findIndex(
      (x, k) =>
        !used.has(k) &&
        (x.t === l.t || (l.t.length > 12 && (x.t.startsWith(l.t.slice(0, 20)) || l.t.startsWith(x.t.slice(0, 20))))),
    );
    if (i < 0) {
      console.log(`THIẾU chữ [${l.sec}] "${l.t}"`);
      n++;
      continue;
    }
    used.add(i);
    const o = ours.texts[i];
    const d = [];
    if (Math.abs(o.fs - l.fs) >= 1) d.push(`fs ${l.fs}→${o.fs}`);
    if (l.lh && o.lh && Math.abs(o.lh - l.lh) >= 2) d.push(`lh ${l.lh}→${o.lh}`);
    if (o.fw !== l.fw) d.push(`fw ${l.fw}→${o.fw}`);
    if (Math.abs(o.w - l.w) > 12) d.push(`w ${l.w}→${o.w}`);
    if (Math.abs(o.h - l.h) > 6) d.push(`h ${l.h}→${o.h}`);
    if (o.color !== l.color) d.push(`color ${l.color}→${o.color}`);
    if (d.length) {
      console.log(`chữ [${l.sec}] "${l.t.slice(0, 30)}" ${o.id}: ${d.join(', ')}`);
      n++;
    }
  }

  const same = (a, b) => a.slice(0, 15) === b.slice(0, 15);
  for (const sec of new Set(live.imgs.map((x) => x.sec))) {
    const li = live.imgs.filter((x) => same(x.sec, sec));
    const oi = ours.imgs.filter((x) => same(x.sec, sec));
    if (li.length !== oi.length) console.log(`ảnh [${sec}] số lượng ${li.length}→${oi.length}`);
    li.forEach((l, k) => {
      const o = oi[k];
      if (o && (Math.abs(o.w - l.w) > 8 || Math.abs(o.h - l.h) > 8)) {
        console.log(`ảnh [${sec}] #${k} ${o.id}: ${l.w}x${l.h}→${o.w}x${o.h}`);
        n++;
      }
    });
  }

  for (const l of live.btns) {
    if (!l.t) continue;
    const o = ours.btns.find((x) => x.t === l.t);
    if (!o) {
      console.log(`THIẾU nút [${l.sec}] "${l.t}" ${l.w}x${l.h}`);
      continue;
    }
    const d = [];
    if (Math.abs(o.w - l.w) > 6) d.push(`w ${l.w}→${o.w}`);
    if (Math.abs(o.h - l.h) > 4) d.push(`h ${l.h}→${o.h}`);
    if (o.bg !== l.bg) d.push(`bg ${l.bg}→${o.bg}`);
    if (o.radius !== l.radius) d.push(`radius ${l.radius}→${o.radius}`);
    if (d.length) {
      console.log(`nút [${l.sec}] "${l.t}" ${o.id}: ${d.join(', ')}`);
      n++;
    }
  }
  console.log(`→ ${n} chỗ lệch ở ${width}px`);
}

await browser.close();
