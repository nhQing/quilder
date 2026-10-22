import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PageHeader, PageShell } from './Page';
import { SkeletonHeader, SkeletonPage } from './Skeleton';

/**
 * Khung đang tải của một màn phải đứng ĐÚNG CHỖ trang thật sắp hiện.
 *
 * `SkeletonPage` là `<div>` chứ không dùng thẳng `PageShell` (`<main>`) — lý do ở docblock của
 * nó — nên hai bên giữ hai bản chuỗi class. Lệch một bên (đổi `gap-6`, đổi lề) thì khung vẫn
 * "trông ổn", chỉ là lúc trang thật thay vào thì cả màn nhảy một đoạn — đúng loại lỗi không ai
 * báo. Test này là chỗ hai bản phải khớp.
 */

const classOf = (html: string, tag: string) => html.match(new RegExp(`<${tag}[^>]*class="([^"]*)"`))?.[1];

describe('SkeletonPage khớp PageShell', () => {
  for (const width of ['default', 'wide', 'narrow'] as const) {
    it(`mức bề rộng ${width}`, () => {
      const real = classOf(renderToStaticMarkup(<PageShell width={width}>x</PageShell>), 'main');
      const skeleton = classOf(renderToStaticMarkup(<SkeletonPage width={width}>x</SkeletonPage>), 'div');
      expect(real).toBeTruthy();
      expect(skeleton).toBe(real);
    });
  }

  it('không phải landmark, không đọc với screen reader', () => {
    const html = renderToStaticMarkup(<SkeletonPage>x</SkeletonPage>);
    expect(html).not.toContain('<main');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('SkeletonHeader khớp PageHeader', () => {
  it('cùng hộp ngoài, cột tiêu đề và cụm nút', () => {
    const real = renderToStaticMarkup(<PageHeader title="Trang" description="mô tả" actions={<b>nút</b>} />);
    const skeleton = renderToStaticMarkup(<SkeletonHeader description={1} actions={1} />);

    // Hộp ngoài: `<header>` thật, `<div>` khung — so chuỗi class.
    expect(classOf(skeleton, 'div')).toBe(classOf(real, 'header'));

    const inner = (html: string) => [...html.matchAll(/<div class="([^"]*)"/g)].map((m) => m[1]);
    const realDivs = inner(real);
    const skeletonDivs = inner(skeleton);
    // Cột tiêu đề và cụm hành động có cùng class ở cả hai bên.
    for (const cls of [realDivs[0], realDivs[realDivs.length - 1]]) {
      expect(skeletonDivs).toContain(cls);
    }
  });

  it('không có heading: e2e tìm heading theo tên, và một heading rỗng là rác cho screen reader', () => {
    const html = renderToStaticMarkup(<SkeletonHeader crumbs description={2} actions={2} />);
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).not.toContain('<nav');
  });
});
