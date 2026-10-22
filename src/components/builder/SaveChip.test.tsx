import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SaveChip } from './SaveChip';
import type { SaveState } from '@/lib/builder/save-state';

/**
 * HTML mà chip trạng thái lưu phát ra.
 *
 * `SaveChip` cố ý KHÔNG đọc store: `vitest.config.ts` chạy `environment: 'node'`
 * nên không có DOM, và một component đọc store thì không render được ở đây. Nhận
 * `state` qua prop làm nó test được bằng `renderToStaticMarkup`, cùng cách ba
 * test `composites/*.test.tsx` đang làm.
 *
 * Tính chất chịu lực: **thành công và thất bại không bao giờ dùng cùng một class
 * màu.** Đó là lỗi đã từng làm publish hỏng hiện chữ xanh.
 */

const html = (state: SaveState) =>
  renderToStaticMarkup(createElement(SaveChip, { state, onRetry: () => {} }));

describe('SaveChip', () => {
  it('đang lưu — tone muted, không có nút', () => {
    const out = html({ k: 'saving' });
    expect(out).toContain('đang lưu…');
    expect(out).toContain('text-shell-muted');
    expect(out).not.toContain('<button');
  });

  it('đã lưu — tone ok, mang số phiên bản', () => {
    const out = html({ k: 'clean', seq: 41 });
    expect(out).toContain('đã lưu · v41');
    expect(out).toContain('text-shell-ok');
  });

  it('lỗi lưu — tone danger, CÓ nút thử lại, câu lỗi ở title', () => {
    const out = html({ k: 'error', message: 'Image cần alt', retry: [] });
    expect(out).toContain('text-shell-danger');
    expect(out).toContain('<button');
    expect(out).toContain('thử lại');
    expect(out).toContain('title="Image cần alt"');
  });

  it('lỗi KHÔNG bao giờ mang class của thành công — đây là lỗi đã từng tồn tại', () => {
    const out = html({ k: 'error', message: 'x', retry: [] });
    expect(out).not.toContain('text-shell-ok');
  });

  it('đã lưu KHÔNG bao giờ mang class của lỗi', () => {
    const out = html({ k: 'clean', seq: 1 });
    expect(out).not.toContain('text-shell-danger');
  });
});
