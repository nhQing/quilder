import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nửa NỐI DÂY của field SEO trong `generateMetadata`, đọc ở mức nguồn.
 *
 * Cùng lý do với `site-page-routing.test.ts`: `[[...slug]]/page.tsx` là một RSC kéo theo
 * Prisma. Phần có logic — thứ tự ưu tiên, robots, canonical, alt, ở cả `vi` lẫn `en` —
 * có test thật ở `src/lib/render/entry-meta.test.ts`. Ở đây chỉ khoá rằng trang THẬT
 * dùng phần đó, vì "validator nhận ≠ renderer đọc" là đúng loại lỗi một dòng thiếu gây ra.
 */
const src = readFileSync(join(__dirname, '(site)', '[[...slug]]', 'page.tsx'), 'utf8');
const view = readFileSync(join(__dirname, '(site)', 'PublishedPageView.tsx'), 'utf8');

describe('generateMetadata đọc field SEO', () => {
  it('đi qua applySeoToMeta, và trả đúng các khoá của nó', () => {
    expect(src).toContain('applySeoToMeta(');
    expect(src).toContain('title: meta.titleMeta');
    expect(src).toContain('description: meta.description');
    expect(src).toContain('robots: meta.robots');
    expect(src).toContain('meta.keywords');
    expect(src).toContain('const canonical = meta.canonical');
  });

  it('ảnh OG của SEO là ứng viên ĐẦU TIÊN, trước ảnh trang và ảnh site', () => {
    const a = src.indexOf('imageCandidates.push(meta.imageAssetId)');
    const b = src.indexOf('imageCandidates.push(page.ogImageId)');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });

  it('trang danh mục đọc SEO của bản ghi đích, CHỈ giá trị ghi đè', () => {
    expect(src).toContain('relationEntry: target');
    expect(src).toContain('{ derive: false }');
  });

  it('JSON-LD đi qua pickJsonLd', () => {
    expect(view).toContain('pickJsonLd({');
    expect(view).toContain('jsonForScript(jsonLd)');
  });
});
