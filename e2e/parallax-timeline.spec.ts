import { expect, test } from '@playwright/test';

/**
 * `parallax` chạy bằng CSS scroll-driven animation khi trình duyệt có `animation-timeline`
 * (Chromium có), và chạy bằng GSAP khi không có. Xem docblock của
 * `src/lib/motion/effects/parallax.ts`.
 *
 * Thứ được khoá ở đây: đường CSS THẬT SỰ chuyển động — rule có mặt (module tự chèn, không
 * dựa vào bó CSS đã niêm phong của release), và transform đổi theo vị trí cuộn.
 */

test('parallax đi đường CSS timeline và chuyển động theo cuộn', async ({ page, request }) => {
  const pages = (await (await request.post('/api/ai/tool', { data: { tool: 'list_pages', input: {} } })).json())
    .result.pages as { id: string; path: string }[];
  const home = pages.find((p) => p.path === '/')!;
  // Một ảnh nằm SÂU trong trang và không ở trong khối ghim/cố định (logo trên thanh nav
  // không bao giờ cuộn qua viewport, nên timeline của nó đứng yên).
  await page.goto(`/preview/${home.id}`);
  await page.waitForLoadState('networkidle');
  const imageId = await page.evaluate(() => {
    const pinned = (el: Element | null): boolean => {
      for (let n = el; n; n = n.parentElement) {
        const p = getComputedStyle(n).position;
        if (p === 'fixed' || p === 'sticky') return true;
      }
      return false;
    };
    const imgs = [...document.querySelectorAll<HTMLElement>('img[data-n], [data-n] > img')];
    for (const img of imgs) {
      const host = img.matches('[data-n]') ? img : img.closest<HTMLElement>('[data-n]');
      const top = img.getBoundingClientRect().top + window.scrollY;
      if (host && top > 1200 && img.getBoundingClientRect().height > 30 && !pinned(img)) return host.dataset.n!;
    }
    return null;
  });
  test.skip(!imageId, 'trang chủ không có ảnh nào đủ sâu để thử');
  const image = { id: imageId! };

  const attach = await request.post('/api/ops', {
    data: {
      pageId: home.id,
      label: 'e2e parallax',
      ops: [{ op: 'attachEffect', nodeId: image.id, attachment: { id: 'e2epx', effect: 'parallax', params: { speed: 0.4 } } }],
    },
  });
  expect(attach.ok(), await attach.text()).toBe(true);

  try {
    await page.goto(`/preview/${home.id}`);
    await page.waitForLoadState('networkidle');

    const read = (y: number) =>
      page.evaluate(
        async ([id, y]) => {
          window.scrollTo(0, y as number);
          await new Promise((r) => setTimeout(r, 250));
          const el = document.querySelector(`[data-n="${id}"]`) as HTMLElement | null;
          const target =
            el && (el.matches('img, video, canvas, picture') ? el : el.querySelector('img, video, canvas, picture') ?? el);
          const cs = target ? getComputedStyle(target) : null;
          const top = el ? el.getBoundingClientRect().top + window.scrollY : 0;
          return { mode: el?.dataset.mmParallax, animation: cs?.animationName, transform: cs?.transform, top };
        },
        [image.id, y],
      );

    const first = await read(0);
    test.skip(
      !(await page.evaluate(() => CSS.supports('animation-timeline: view()'))),
      'trình duyệt này không có animation-timeline — đường GSAP',
    );
    expect(first.mode).toBe('timeline');
    expect(first.animation).toBe('mm-parallax');

    const before = await read(Math.max(0, first.top - 700));
    const after = await read(first.top);
    expect(after.transform, 'transform phải đổi khi cuộn qua element').not.toBe(before.transform);
  } finally {
    await request.post('/api/ops', {
      data: {
        pageId: home.id,
        label: 'e2e parallax — dọn',
        ops: [{ op: 'detachEffect', nodeId: image.id, instanceId: 'e2epx' }],
      },
    });
  }
});
