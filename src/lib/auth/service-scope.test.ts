import { describe, expect, it } from 'vitest';

import { serviceMayReach } from './service-scope';

describe('serviceMayReach', () => {
  it('cho đúng ba đường mà mcp/server.mjs dùng', () => {
    expect(serviceMayReach('/api/ai/tool', 'GET')).toBe(true);
    expect(serviceMayReach('/api/ai/tool', 'POST')).toBe(true);
    expect(serviceMayReach('/api/assets', 'POST')).toBe(true);
    expect(serviceMayReach('/preview/abc123', 'GET')).toBe(true);
    expect(serviceMayReach('/preview/release/abc123', 'GET')).toBe(true);
    expect(serviceMayReach('/render/abc123', 'GET')).toBe(true);
    // Lời dặn/prompt và bộ clone mà proxy tải lúc khởi động và khi gọi tool clone.
    expect(serviceMayReach('/api/ai/guide', 'GET')).toBe(true);
    expect(serviceMayReach('/api/ai/guide', 'POST')).toBe(true);
    expect(serviceMayReach('/api/ai/clone-kit', 'GET')).toBe(true);
    expect(serviceMayReach('/api/ai/clone-kit', 'POST')).toBe(false);
  });

  it('chặn publish, rollback và ghi op trực tiếp', () => {
    // Đây là ba lỗ của ranh giới AI: publish site, và op không qua tool nên
    // không bị tính là actor 'ai'.
    expect(serviceMayReach('/api/publish', 'POST')).toBe(false);
    expect(serviceMayReach('/api/ops', 'POST')).toBe(false);
    expect(serviceMayReach('/api/pages/abc/revert', 'POST')).toBe(false);
  });

  it('chặn mọi route quản trị', () => {
    for (const path of ['/api/users', '/api/users/abc', '/api/tokens', '/api/settings']) {
      expect(serviceMayReach(path, 'GET'), path).toBe(false);
      expect(serviceMayReach(path, 'POST'), path).toBe(false);
    }
  });

  it('chỉ đọc trên /preview và /render, chỉ POST trên /api/assets', () => {
    expect(serviceMayReach('/preview/abc', 'POST')).toBe(false);
    expect(serviceMayReach('/render/abc', 'DELETE')).toBe(false);
    expect(serviceMayReach('/api/assets', 'GET')).toBe(false);
    expect(serviceMayReach('/api/assets', 'DELETE')).toBe(false);
  });

  it('khớp chính xác, không khớp theo tiền tố', () => {
    // `/api/ai/tool` mở không có nghĩa là `/api/ai/tool-admin` mở theo.
    expect(serviceMayReach('/api/ai/tool-x', 'POST')).toBe(false);
    expect(serviceMayReach('/api/assets/purge', 'POST')).toBe(false);
    expect(serviceMayReach('/api/assets/trash', 'POST')).toBe(false);
    // Không có dấu `/` sau tiền tố thì không phải trang preview.
    expect(serviceMayReach('/previewx', 'GET')).toBe(false);
    expect(serviceMayReach('/builder', 'GET')).toBe(false);
  });
});
