import { describe, expect, it } from 'vitest';

import { chromium, type Browser } from 'playwright';

import { assembleCloneDoc, collectAssetRefs } from './assemble';
import { buildCloneKit, CLONE_VIEWPORTS, extractorSource } from './kit';
import type { CloneExtraction } from './types';

/**
 * Chạy extractor trong một Chromium THẬT với một trang đồ chơi.
 *
 * Đây là phép kiểm duy nhất bắt được lỗi "mã nằm trong chuỗi chết lúc chạy ở trang khác" (helper
 * của bundler, tham chiếu tới hằng module…) — type-check và đọc mắt đều không thấy. Máy không có
 * Chromium thì bỏ qua, như e2e.
 */

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PAGE = `<!doctype html>
<html lang="vi"><head><title>Trang thử</title>
<meta name="description" content="Mô tả thử">
<style>
  body { margin: 0; font: 16px/1.5 Arial, sans-serif; color: #111; background: #fafafa; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; }
  .menu-mobile { display: none; }
  @media (max-width: 767px) { .menu-desktop { display: none; } .menu-mobile { display: block; } }
  .hero { padding: 80px 24px; background: linear-gradient(180deg, #112233 0%, #445566 100%); color: #fff; }
  .hero h1 { font-size: 48px; font-weight: 800; margin: 0 0 16px; }
  .cta { display: inline-block; padding: 12px 24px; background: #ff4d2e; color: #fff; border-radius: 8px; text-decoration: none; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; padding: 40px 24px; }
  @media (max-width: 767px) { .cards { grid-template-columns: 1fr; } }
  .card img { width: 100%; height: 120px; object-fit: cover; }
  .ghost { width: 0; height: 0; }
  footer { padding: 32px 24px; background: #222; color: #ccc; }
</style></head>
<body>
<header>
  <a href="/" class="logo">Quilder</a>
  <nav class="menu-desktop"><a href="/gioi-thieu">Giới thiệu</a> <a href="https://example.com/x">Ngoài</a></nav>
  <nav class="menu-mobile"><a href="#lien-he">Liên hệ</a></nav>
</header>
<main>
  <section class="hero" id="Hero_1">
    <h1>Tiết kiệm <em>thông minh</em> hơn</h1>
    <p>Đoạn mô tả ngắn.</p>
    <p class="note">Giá <span style="color:#ff0000;font-size:20px">đặc biệt</span> hôm nay <b>nay</b></p>
    <a class="cta" href="/dang-ky">Đăng ký ngay</a>
    <svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="currentColor"/></svg>
  </section>
  <section class="cards">
    <div class="card"><img src="${PNG_1PX}" alt="Thẻ 1"><h3>Thẻ một</h3></div>
    <div class="card"><img src="${PNG_1PX}" alt="Thẻ 2"><h3>Thẻ hai</h3></div>
    <div class="card"><img src="${PNG_1PX}" alt="Thẻ 3"><h3>Thẻ ba</h3></div>
    <div class="ghost"></div>
  </section>
  <section><canvas width="100" height="50"></canvas><iframe src="https://www.youtube.com/embed/x" width="200" height="100"></iframe></section>
</main>
<footer><p>Bản quyền</p></footer>
</body></html>`;

const TOKENS = [
  { name: 'color-ink', value: '#111111' },
  { name: 'color-accent', value: '#ff4d2e' },
  { name: 'space-l', value: '24px' },
  { name: 'space-m', value: '16px' },
  { name: 'radius-m', value: '8px' },
];

async function launch(): Promise<Browser | null> {
  try {
    return await chromium.launch();
  } catch {
    return null;
  }
}

const browser = await launch();

describe.skipIf(!browser)('extractor trong Chromium thật', () => {
  it('trích, gộp khổ và báo cáo phần không clone được', async () => {
    const b = browser as Browser;
    const kit = buildCloneKit(TOKENS, 10 * 1024 * 1024);
    const ctx = await b.newContext({ bypassCSP: true });
    const blank = await ctx.newPage();
    const page = await ctx.newPage();
    // Phục vụ qua HTTP giả để URL tương đối resolve được (about:blank thì không).
    await page.route('http://site.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }));
    await page.goto('http://site.test/trang-chu');
    await page.evaluate(extractorSource());
    await blank.evaluate(extractorSource());

    const passes: Array<{ layer: string; result: unknown }> = [];
    for (const vp of CLONE_VIEWPORTS) {
      // Widget dựng lại DOM mỗi lần đổi khổ (carousel vô hạn, SplitText): phần tử mới, cấu trúc cũ.
      if (vp.layer !== 'base') {
        await page.evaluate(() => {
          const g = document.querySelector('.cards') as HTMLElement;
          g.innerHTML = g.innerHTML;
        });
      }
      await page.setViewportSize({ width: vp.width, height: 900 });
      await blank.setViewportSize({ width: vp.width, height: 900 });
      const tables = await blank.evaluate(
        (o) => (window as unknown as { __mmClone: { tokenTables(x: unknown): unknown } }).__mmClone.tokenTables(o),
        { tokensCss: kit.tokensCss, tokenNames: kit.tokenNames },
      );
      const result = await page.evaluate(
        (o) => (window as unknown as { __mmClone: { extract(x: unknown): unknown } }).__mmClone.extract(o),
        { tables, layer: vp.layer },
      );
      passes.push({ layer: vp.layer, result });
    }
    const merged = (await page.evaluate(
      (p) => (window as unknown as { __mmClone: { merge(x: unknown): unknown } }).__mmClone.merge(p),
      passes,
    )) as CloneExtraction;
    await ctx.close();

    const nodes = Object.values(merged.nodes) as Array<Record<string, unknown> & { type: string }>;
    const types = (t: string) => nodes.filter((n) => n.type === t);

    expect(merged.rootId).toBe('root');
    expect(merged.page.title).toBe('Trang thử');
    expect(merged.page.description).toBe('Mô tả thử');

    // Menu mobile chỉ hiện ở khổ nhỏ, menu desktop chỉ hiện ở khổ lớn: cả hai đều phải còn.
    const texts = JSON.stringify(types('Text'));
    expect(texts).toContain('Giới thiệu');
    expect(texts).toContain('Liên hệ');
    // Phần tử 0×0 ở mọi khổ bị gỡ.
    expect(nodes.some((n) => n.name === 'ghost')).toBe(false);

    // htmlId được slug hoá.
    expect(nodes.some((n) => n.htmlId === 'hero-1')).toBe(true);
    // Link nội bộ → đường dẫn, link ngoài → URL tuyệt đối, anchor → #slug.
    const hrefs = JSON.stringify(nodes);
    expect(hrefs).toContain('"/dang-ky"');
    expect(hrefs).toContain('https://example.com/x');
    expect(hrefs).toContain('"#lien-he"');

    // Nút CTA, ảnh (3), SVG nội dòng → ảnh.
    expect(types('Button').some((n) => JSON.stringify(n.label).includes('Đăng ký ngay'))).toBe(true);
    expect(types('Image').filter((n) => typeof n._src === 'string' && !String(n._src).startsWith('svg:'))).toHaveLength(3);
    expect(Object.keys(merged.svgs)).toHaveLength(1);
    expect(Object.values(merged.svgs)[0]).toContain('rgb(255, 255, 255)'); // currentColor đã cố định thành màu chữ của hero

    // Grid: ba cột ở khổ lớn, một cột ở khổ nhỏ (qua override).
    const grid = nodes.find((n) => n.name === 'cards') as unknown as { style: Record<string, Record<string, Record<string, unknown>>> };
    expect(grid.style.base?.layout?.gridTemplateColumns).toEqual([{ kind: 'fr', v: 1 }]);
    expect(grid.style.sm?.layout?.gridTemplateColumns).toEqual([
      { kind: 'fr', v: 1 }, { kind: 'fr', v: 1 }, { kind: 'fr', v: 1 },
    ]);

    // Gradient tuyến tính thành fill.gradient, không rơi vào customCss.
    const hero = nodes.find((n) => n.name === 'hero') as unknown as { style: { base: { fill?: { gradient?: { kind: string } } } } };
    expect(hero.style.base.fill?.gradient?.kind).toBe('linear');

    // Token khớp chính xác: #ff4d2e là --color-accent.
    expect(JSON.stringify(nodes)).toContain('"$token":"color-accent"');

    // Id giữ ổn định dù DOM bị dựng lại giữa các khổ: không có phần tử "chỉ xuất hiện ở khổ lớn",
    // và ba thẻ ảnh vẫn còn (nếu id trôi thì cả nhánh biến khỏi lớp base).
    expect(merged.notes['pass-mismatch']).toBeUndefined();
    expect(types('Image').filter((n) => n.alt === 'Thẻ 1' || n.alt === 'Thẻ 2' || n.alt === 'Thẻ 3')).toHaveLength(3);

    // Đoạn nội dòng có style riêng (màu, cỡ chữ) được tách thành node chữ riêng, không bị gộp mất style;
    // còn đậm (<b>) vẫn là strong trong RichText.
    const note = nodes.find((n) => n.name === 'note') as unknown as {
      type: string; children: string[]; style: { base: { typography?: { size?: unknown } } };
    };
    expect(note.type).toBe('Stack');
    const accent = nodes.find((n) => JSON.stringify(n.content ?? '').includes('đặc biệt')) as unknown as {
      type: string; style: { base: { typography?: { size?: { v: number }; color?: { hex: string } } } };
    };
    expect(accent.type).toBe('Text');
    expect(accent.style.base.typography?.size).toEqual({ v: 20, u: 'px' });
    expect(accent.style.base.typography?.color).toEqual({ hex: '#ff0000' });
    expect(merged.notes['text-split']?.count).toBe(1);

    // Nút khai ĐỦ cỡ chữ/màu/nền để thắng `.btn` của builder.
    const cta = nodes.find((n) => n.name === 'cta') as unknown as {
      style: { base: { typography: { size: unknown; tracking: unknown; color: unknown }; fill: { color: unknown } } };
    };
    expect(cta.style.base.typography.size).toBeDefined();
    expect(cta.style.base.typography.tracking).toEqual({ v: 0, u: 'px' });
    expect(cta.style.base.fill.color).toBeDefined();

    // Báo cáo.
    expect(merged.notes.canvas?.count).toBe(1);
    expect(merged.notes.iframe?.samples[0]).toContain('youtube');
    expect(merged.notes['internal-link']).toBeDefined();

    // Qua bộ lắp ráp: doc hợp lệ với schema chặt, CSS biên dịch được, báo cáo đủ.
    const refs = collectAssetRefs(merged);
    expect(refs).toHaveLength(2); // cùng một ảnh dùng 3 lần là MỘT asset, cộng một SVG
    const assets = Object.fromEntries(refs.map((r, i) => [r.ref, { assetId: `asset${i}` }]));
    const out = assembleCloneDoc(merged, { assets, notes: merged.notes });
    expect(out.stats.images).toBe(4);
    expect(out.stats.imagesWired).toBe(4);
    expect(JSON.stringify(out.doc)).not.toContain('"_');
    const codes = out.report.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['canvas', 'iframe', 'weight-snapped', 'limits']));
    expect(out.landmarks.header).not.toBeNull();
    expect(out.landmarks.footer).not.toBeNull();
    // Nếu một asset hỏng thì node để trống VÀ báo lỗi, không im lặng.
    const failing = assembleCloneDoc(merged, {
      assets: { ...assets, [refs[0]!.ref]: { error: 'HTTP 404', code: 'fetch' } },
      notes: {},
    });
    expect(failing.report[0]?.code).toBe('assets-failed');
    expect(failing.stats.imagesWired).toBeLessThan(4);
  }, 60_000);

  it('mã nguồn gửi đi không còn dấu vết của bundler', () => {
    const src = extractorSource();
    expect(src).not.toMatch(/_object_spread|_async_to_generator|__vite|\$\$_|import\(/);
  });
});
