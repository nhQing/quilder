import { describe, expect, it } from 'vitest';

import { extOf, fileNameOfKey, renamedBase, replaceBlocked } from './rename';

describe('fileNameOfKey', () => {
  it('bỏ thư mục và đuôi băm', () => {
    expect(fileNameOfKey('public/builder/image-920253cc46-b168fc4e.png')).toBe('image-920253cc46.png');
    expect(fileNameOfKey('public/cms/Frame_32_fcb51707e0.png')).toBe('Frame_32_fcb51707e0.png');
  });
});

describe('renamedBase', () => {
  it('giữ đuôi cũ khi tên mới không có đuôi', () => {
    expect(renamedBase('Điện thoại MaiGreen', 'public/builder/image-b168fc4e.png')).toEqual({
      ok: true,
      base: 'public/builder/dien-thoai-maigreen.png',
    });
  });
  it('dùng đuôi người dùng đặt nếu có', () => {
    expect(renamedBase('hero.webp', 'public/builder/a-b168fc4e.png')).toEqual({ ok: true, base: 'public/builder/hero.webp' });
  });
  it('từ chối tên rỗng hoặc toàn ký tự lạ', () => {
    expect(renamedBase('  ', 'public/builder/a.png').ok).toBe(false);
    expect(renamedBase('!!!', 'public/builder/a').ok).toBe(false);
  });
  it('extOf', () => {
    expect(extOf('a/b/C.PNG')).toBe('.png');
    expect(extOf('.gitkeep')).toBe('');
  });
});

describe('replaceBlocked', () => {
  it('ảnh ↔ svg được, video ↔ ảnh không, font không', () => {
    expect(replaceBlocked('image', 'svg')).toBeNull();
    expect(replaceBlocked('video', 'video')).toBeNull();
    expect(replaceBlocked('image', 'video')).not.toBeNull();
    expect(replaceBlocked('font', 'font')).not.toBeNull();
  });
});
