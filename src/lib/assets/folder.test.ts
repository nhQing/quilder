import { describe, expect, it } from 'vitest';

import {
  folderParents,
  foldersToEnsure,
  isUnder,
  mayDeleteFolder,
  normalizeFolder,
  reparent,
  slugSegment,
} from './folder';

describe('slugSegment', () => {
  it('bỏ dấu tiếng Việt thay vì từ chối', () => {
    expect(slugSegment('Trang chủ')).toBe('trang-chu');
    expect(slugSegment('Sản phẩm')).toBe('san-pham');
  });

  it('đ và Đ đều thành d — normalize NFD không tách được chúng', () => {
    expect(slugSegment('Đầu tư')).toBe('dau-tu');
  });

  it('không để lại gạch nối ở hai đầu', () => {
    expect(slugSegment('  --- hero ---  ')).toBe('hero');
  });

  it('cắt ở 40 ký tự mà không để lại gạch nối cụt', () => {
    const out = slugSegment('a'.repeat(38) + ' bcd');
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('normalizeFolder', () => {
  it('undefined và null đều là "chưa phân loại"', () => {
    expect(normalizeFolder(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeFolder(null)).toEqual({ ok: true, value: null });
  });

  it('chuỗi rỗng hay toàn gạch chéo cũng là null, KHÔNG phải thư mục tên rỗng', () => {
    expect(normalizeFolder('')).toEqual({ ok: true, value: null });
    expect(normalizeFolder('///')).toEqual({ ok: true, value: null });
  });

  it('gộp gạch chéo thừa và bỏ gạch chéo ở hai đầu', () => {
    expect(normalizeFolder('/trang-chu//hero/')).toEqual({ ok: true, value: 'trang-chu/hero' });
  });

  it('slug hoá từng đoạn', () => {
    expect(normalizeFolder('Trang chủ/Ảnh nền')).toEqual({ ok: true, value: 'trang-chu/anh-nen' });
  });

  it('từ chối quá 3 cấp', () => {
    const r = normalizeFolder('a/b/c/d');
    expect(r.ok).toBe(false);
  });

  /*
   * `..` là chỗ nguy hiểm nhất nếu ai đó sau này quyết định ghép folder vào khoá S3.
   * Nó phải chết ở tầng chuẩn hoá, không phải ở tầng tin tưởng.
   */
  it('không có đường thoát ra ngoài: .. thành rỗng chứ không phải một cấp lên', () => {
    expect(normalizeFolder('../../etc')).toEqual({ ok: true, value: 'etc' });
    expect(normalizeFolder('a/../b')).toEqual({ ok: true, value: 'a/b' });
  });
});

describe('folderParents', () => {
  it('sinh mọi tiền tố để giao diện dựng cây mà không cần bảng thư mục', () => {
    expect(folderParents('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
    expect(folderParents('a')).toEqual(['a']);
  });
});

describe('isUnder', () => {
  it('chính nó cũng tính là nằm dưới', () => {
    expect(isUnder('a', 'a')).toBe(true);
  });

  it('không nhầm thư mục có tên bắt đầu giống nhau', () => {
    expect(isUnder('abc', 'a')).toBe(false);
    expect(isUnder('a/b', 'a')).toBe(true);
  });
});

describe('reparent', () => {
  it('đổi tiền tố và giữ nguyên phần đuôi', () => {
    expect(reparent('a/b/c', 'a', 'x')).toBe('x/b/c');
    expect(reparent('a', 'a', 'x')).toBe('x');
  });

  it('trả null khi không nằm dưới — bên gọi hiểu là không đụng tới', () => {
    expect(reparent('abc', 'a', 'x')).toBeNull();
  });
});

describe('mayDeleteFolder', () => {
  it('admin xoá được cả nhánh của người khác', () => {
    expect(
      mayDeleteFolder({ owners: ['u1', 'u2', null], actorSub: 'u9', isAdmin: true }),
    ).toBe(true);
  });

  it('người tạo xoá được nhánh mình tạo trọn vẹn', () => {
    expect(
      mayDeleteFolder({ owners: ['u1', 'u1'], actorSub: 'u1', isAdmin: false }),
    ).toBe(true);
  });

  it('một thư mục con của người khác là đủ để chặn — nếu không, tạo thư mục cha là cách xoá đồ người khác', () => {
    expect(
      mayDeleteFolder({ owners: ['u1', 'u2'], actorSub: 'u1', isAdmin: false }),
    ).toBe(false);
  });

  it('không rõ ai tạo thì chỉ admin, KHÔNG đoán là của người đang thao tác', () => {
    expect(
      mayDeleteFolder({ owners: [null], actorSub: 'u1', isAdmin: false }),
    ).toBe(false);
  });

  it('nhánh rỗng cho qua, để bên gọi báo 404 chứ không phải 403', () => {
    expect(mayDeleteFolder({ owners: [], actorSub: 'u1', isAdmin: false })).toBe(true);
  });
});

describe('foldersToEnsure', () => {
  it('bung ra cấp cha: dời ảnh vào a/b/c thì a và a/b cũng phải có thật', () => {
    expect(foldersToEnsure(['a/b/c'])).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('bỏ null và loại trùng giữa nhiều ảnh', () => {
    expect(foldersToEnsure(['a/b', null, 'a/c', 'a/b'])).toEqual(['a', 'a/b', 'a/c']);
  });

  it('sắp xếp ổn định — thứ tự ghi khác nhau giữa hai transaction là deadlock', () => {
    expect(foldersToEnsure(['z', 'a'])).toEqual(foldersToEnsure(['a', 'z']));
  });
});
