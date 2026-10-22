import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { assetKeyBase, assetKeyFromDigest, nextAssetKey } from './key';

/**
 * `Asset.key` phải BẤT BIẾN.
 *
 * Đây là điều kiện để `Release.assets` chụp metadata mà không chụp file: release
 * cũ trỏ tới `key` cũ, nên `key` đó phải mãi mãi là cùng một byte.
 *
 * Ghi đè key là vết nứt duy nhất còn lại trong hợp đồng "lùi release là lùi mọi
 * thứ" — lùi sẽ lùi bố cục, chữ, token, CSS, nhưng ảnh thì không. Người soát thấy
 * một trang GẦN ĐÚNG, và không có gì chỉ ra chỗ sai.
 */

const A = new TextEncoder().encode('anh-mot');
const B = new TextEncoder().encode('anh-hai');

describe('nextAssetKey', () => {
  it('cùng nội dung ra cùng khoá — nạp lại đúng file không tạo rác', () => {
    expect(nextAssetKey('img/hero.png', A)).toBe(nextAssetKey('img/hero.png', A));
  });

  it('khác nội dung ra khác khoá — đây LÀ cả điểm của hàm này', () => {
    expect(nextAssetKey('img/hero.png', A)).not.toBe(nextAssetKey('img/hero.png', B));
  });

  it('giữ phần mở rộng, vì S3 và trình duyệt đều đoán mime từ nó', () => {
    expect(nextAssetKey('img/hero.png', A)).toMatch(/\.png$/);
  });

  it('giữ thư mục và tên gốc để còn đọc được bằng mắt khi soi S3', () => {
    expect(nextAssetKey('img/section2/hero.png', A)).toMatch(
      /^img\/section2\/hero-[0-9a-f]{8}\.png$/,
    );
  });

  it('tên không có phần mở rộng vẫn ra khoá hợp lệ', () => {
    expect(nextAssetKey('data/blob', A)).toMatch(/^data\/blob-[0-9a-f]{8}$/);
  });

  it('tên bắt đầu bằng dấu chấm không bị coi là phần mở rộng', () => {
    // `.htaccess` → tên là `.htaccess`, không phải tên rỗng với đuôi `htaccess`.
    expect(nextAssetKey('.gitkeep', A)).toMatch(/^\.gitkeep-[0-9a-f]{8}$/);
  });

  it('nhiều dấu chấm thì chỉ dấu cuối là phần mở rộng', () => {
    expect(nextAssetKey('img/hero.min.png', A)).toMatch(/^img\/hero\.min-[0-9a-f]{8}\.png$/);
  });

  it('không có thư mục vẫn đúng', () => {
    expect(nextAssetKey('hero.png', A)).toMatch(/^hero-[0-9a-f]{8}\.png$/);
  });
});

describe('assetKeyFromDigest — khoá tính từ sha256, không cần byte', () => {
  // Màn nhập trang biết sha256 của file (trong manifest) TRƯỚC khi tải nó lên, và cần
  // đoán đúng khoá mà `uploadAsset` sẽ sinh ra để biết đích "đã có file này" chưa.
  it('ra đúng khoá như nextAssetKey với cùng nội dung', () => {
    const hex = createHash('sha256').update(A).digest('hex');
    for (const base of ['img/hero.png', 'data/blob', 'public/builder/a.b.webp', '.gitkeep']) {
      expect(assetKeyFromDigest(base, hex)).toBe(nextAssetKey(base, A));
    }
  });

  it('assetKeyBase giữ quy tắc cũ: bỏ dấu, chữ thường, tiền tố public/builder/', () => {
    expect(assetKeyBase('Ảnh Hero Đẹp.PNG')).toBe('public/builder/anh-hero-dep.png');
    expect(assetKeyBase('')).toBe('public/builder/asset');
  });
});
