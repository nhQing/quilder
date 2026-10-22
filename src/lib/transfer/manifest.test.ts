import { describe, expect, it } from 'vitest';

import { sampleBundle, SHA } from './fixtures';
import { bundleFileName, fileEntryName, parseBundle, uploadNameOf } from './manifest';

describe('parseBundle', () => {
  it('nhận gói đúng', () => {
    expect(parseBundle(sampleBundle()).ok).toBe(true);
  });

  it('nhận gói xuất trước khi đổi tên (định dạng cũ), ghi ra thì luôn định dạng mới', () => {
    expect(sampleBundle().format).toBe('quilder-page');
    expect(parseBundle(sampleBundle({ format: 'maimoney-page' })).ok).toBe(true);
  });

  it('từ chối định dạng lạ và phiên bản định dạng lạ', () => {
    expect(parseBundle(sampleBundle({ format: 'khac' })).ok).toBe(false);
    expect(parseBundle(sampleBundle({ formatVersion: 2 })).ok).toBe(false);
  });

  it('từ chối sha256 sai hình dạng và đường dẫn file lạ trong zip', () => {
    const bad = sampleBundle();
    (bad.assets[0] as { sha256: string }).sha256 = 'xyz';
    expect(parseBundle(bad).ok).toBe(false);
    const evil = sampleBundle();
    (evil.assets[0] as { file: string }).file = '../../etc/passwd';
    expect(parseBundle(evil).ok).toBe(false);
  });

  it('câu lỗi nói đường dẫn của chỗ hỏng', () => {
    const r = parseBundle(sampleBundle({ page: { slug: 1 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('page');
  });
});

describe('tên file', () => {
  it('file trong zip theo sha256 + đuôi của khoá', () => {
    expect(fileEntryName(SHA, 'public/builder/hero-aaaaaaaa.png')).toBe(`files/${SHA}.png`);
    expect(fileEntryName(SHA, 'data/blob')).toBe(`files/${SHA}`);
  });

  it('tên tải lên bỏ đuôi hash 8 hex để uploadAsset sinh lại đúng khoá', () => {
    expect(uploadNameOf('public/builder/hero-1a2b3c4d.png')).toBe('hero.png');
    expect(uploadNameOf('img/section2/a.png')).toBe('a.png');
    expect(uploadNameOf('data/blob-1a2b3c4d')).toBe('blob');
  });

  it('tên gói có slug và thời điểm; trang chủ ra "trang-chu"', () => {
    const at = new Date(2026, 9, 14, 15, 30);
    expect(bundleFileName('blogs/[slug]', at)).toBe('blogs-slug-20261014-1530.zip');
    expect(bundleFileName('', at)).toBe('trang-chu-20261014-1530.zip');
  });
});

describe('thông báo lỗi tiếng Việt', () => {
  it('kiểu sai và định dạng sai đều ra tiếng Việt, không lọt chữ tiếng Anh', () => {
    const wrongType = parseBundle(sampleBundle({ page: { slug: 1 } }));
    const wrongFormat = parseBundle(sampleBundle({ format: 'khac' }));
    const badSha = sampleBundle();
    (badSha.assets[0] as { sha256: string }).sha256 = 'xyz';
    const wrongSha = parseBundle(badSha);
    for (const r of [wrongType, wrongFormat, wrongSha]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toMatch(/Expected|received|Invalid|Required/);
    }
    if (!wrongType.ok) expect(wrongType.error).toContain('sai kiểu dữ liệu');
    if (!wrongFormat.ok) expect(wrongFormat.error).toContain('giá trị không đúng');
    if (!wrongSha.ok) expect(wrongSha.error).toContain('sha256 phải là 64 ký tự hex');
  });

  it('trường thiếu báo "thiếu giá trị"', () => {
    const bad: Record<string, unknown> = { ...sampleBundle() };
    delete bad.exportedBy;
    const r = parseBundle(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('thiếu giá trị');
  });
});

describe('đuôi file trong zip', () => {
  it('đuôi không phải [a-z0-9]{1,8} bị bỏ, đuôi viết hoa được hạ chữ thường', () => {
    expect(fileEntryName(SHA, 'a/b.tar_gz')).toBe(`files/${SHA}`);
    expect(fileEntryName(SHA, 'a/b.abcdefghi')).toBe(`files/${SHA}`);
    expect(fileEntryName(SHA, 'a/b.PNG')).toBe(`files/${SHA}.png`);
  });
});

describe('trường doc bắt buộc', () => {
  it('thiếu doc thì từ chối', () => {
    const bad: Record<string, unknown> = { ...sampleBundle() };
    delete bad.doc;
    const r = parseBundle(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('"doc"');
  });

  it('doc = undefined cũng bị từ chối', () => {
    const r = parseBundle(sampleBundle({ doc: undefined }));
    expect(r.ok).toBe(false);
  });
});
