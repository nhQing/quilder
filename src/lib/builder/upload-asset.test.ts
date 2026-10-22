import { describe, expect, it } from 'vitest';

import { assetKeyBase } from './upload-asset';

/**
 * Tên file người dùng gửi lên → phần gốc của khoá S3.
 *
 * Tên file là dữ liệu KHÔNG tin được. Nó đi thẳng vào khoá object, nên một tên
 * chứa `../`, khoảng trắng hay ký tự Unicode sẽ tạo ra khoá phải escape, khoá trỏ
 * ra ngoài tiền tố dự định, hoặc khoá không gõ lại được khi cần soi bucket.
 *
 * `uploadAsset()` chạm S3 và Prisma nên không test được ở đây — vitest không có
 * mạng lẫn DB. Nhưng phép chuẩn hoá này thuần, và nó là hàng rào duy nhất giữa tên
 * người dùng đặt và khoá lưu trữ.
 */

describe('assetKeyBase', () => {
  it('luôn có tiền tố builder/ để phân biệt với ảnh đi kèm mã nguồn', () => {
    // 11 asset trong `public/` không mang tiền tố này. Nhìn khoá là biết ảnh đến
    // từ đâu, và đó là điều kiện để hai nguồn cùng tồn tại mà không lẫn.
    expect(assetKeyBase('hero.png')).toBe('public/builder/hero.png');
  });

  it('bỏ đường dẫn, chỉ giữ tên file', () => {
    expect(assetKeyBase('C:\\Users\\ai\\anh.png')).toBe('public/builder/anh.png');
    expect(assetKeyBase('/home/ai/anh.png')).toBe('public/builder/anh.png');
  });

  it('CHẶN đường dẫn tương đối — không tạo được khoá trỏ ra ngoài', () => {
    // `../../etc/passwd` phải không còn dấu chấm dẫn đường sau khi chuẩn hoá.
    const key = assetKeyBase('../../etc/passwd');
    expect(key.startsWith('public/builder/')).toBe(true);
    expect(key).not.toContain('..');
    expect(key).not.toContain('/etc/');
  });

  it('bỏ dấu tiếng Việt', () => {
    expect(assetKeyBase('Ảnh Bìa.png')).toBe('public/builder/anh-bia.png');
  });

  it('khoảng trắng và ký tự lạ thành gạch nối', () => {
    expect(assetKeyBase('anh  bìa (1)!.png')).toBe('public/builder/anh-bia-1-.png');
  });

  it('không để gạch nối hay chấm ở đầu/cuối', () => {
    expect(assetKeyBase('...anh...')).toBe('public/builder/anh');
    expect(assetKeyBase('---anh---')).toBe('public/builder/anh');
  });

  it('tên rỗng hoặc toàn ký tự lạ vẫn ra khoá dùng được', () => {
    // Chuỗi rỗng làm khoá kết thúc bằng `/`, và S3 coi đó là một "thư mục" —
    // object tồn tại nhưng không tải về được bằng URL bình thường.
    expect(assetKeyBase('')).toBe('public/builder/asset');
    expect(assetKeyBase('!!!')).toBe('public/builder/asset');
  });

  it('cắt tên rất dài', () => {
    expect(assetKeyBase(`${'a'.repeat(300)}.png`).length).toBeLessThanOrEqual('public/builder/'.length + 60);
  });
});
