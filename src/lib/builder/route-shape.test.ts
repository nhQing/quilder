import { describe, expect, it } from 'vitest';

import { routeShape } from './route-shape';

/**
 * Mỗi route builder ra đúng hình khung đang tải của nó.
 *
 * Tính chất chịu lực: id của một trang (`/builder/<id>`) là editor, còn các khu tĩnh cùng độ
 * sâu thì không — đoán sai ở đây là mở "Văn bản" mà thấy khung ba pane.
 */

describe('routeShape', () => {
  it.each([
    ['/builder', 'dashboard'],
    ['/builder/text', 'text'],
    ['/builder/content', 'content'],
    ['/builder/components', 'components'],
    ['/builder/assets', 'assets'],
    ['/builder/settings', 'settings'],
    ['/builder/releases', 'releases'],
    ['/builder/admin', 'users'],
    ['/builder/admin/tokens', 'tokens'],
    ['/builder/claude', 'tokens'],
    ['/builder/login', 'blank'],
    ['/builder/setup', 'blank'],
    ['/builder/cmsomo3vb0002qfx4wyta426a', 'editor'],
    ['/builder/components/abc', 'component-detail'],
    ['/builder/components/abc/edit', 'component-editor'],
    ['/builder/content/tin-tuc', 'entries'],
    ['/builder/content/tin-tuc/moi', 'entry-form'],
    ['/builder/content/tin-tuc/abc', 'entry-form'],
    ['/builder/content/tin-tuc/abc/preview', 'entry-preview'],
    ['/builder/content/tin-tuc/taxonomies', 'taxonomy'],
    ['/builder/content/types/tin-tuc', 'schema'],
    ['/builder/content/groups/seo', 'schema'],
  ])('%s → %s', (path, shape) => {
    expect(routeShape(path)).toBe(shape);
  });

  it('route lạ vẫn có khung, chỉ là khung chung', () => {
    expect(routeShape('/builder/content/types')).toBe('generic');
    expect(routeShape('/builder/admin/khac')).toBe('generic');
    expect(routeShape('/builder/components/abc/xyz')).toBe('generic');
    expect(routeShape('/preview/abc')).toBe('generic');
  });

  it('dấu gạch chéo cuối không đổi kết quả', () => {
    expect(routeShape('/builder/text/')).toBe('text');
  });
});
