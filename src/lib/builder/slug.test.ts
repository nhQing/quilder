import { describe, expect, it } from 'vitest';

import {
  checkSlugPath,
  isTemplateSlug,
  matchSlugTemplate,
  paramNames,
  slugShape,
  toSlug,
  toSlugPath,
} from './slug';

/**
 * Bốn hàm ở đây đứng trên đường của MỌI địa chỉ mà site phục vụ. Một lỗi ở
 * `matchSlugTemplate` không hiện ra dưới dạng ngoại lệ — nó hiện ra dưới dạng
 * Google index một trang mẫu chưa bind dữ liệu. Nên phần được test là bẫy, không
 * phải đường đẹp.
 */

describe('toSlug', () => {
  it('giữ nguyên hành vi cũ: dấu / là rác, không phải ranh giới', () => {
    expect(toSlug('blogs/post')).toBe('blogs-post');
    expect(toSlug('Tin Tức Thị Trường')).toBe('tin-tuc-thi-truong');
    expect(toSlug('  ')).toBe('');
  });
});

describe('toSlugPath', () => {
  it('gộp dấu / thừa và bỏ đoạn rỗng', () => {
    expect(toSlugPath('//Blogs//Post/')).toBe('blogs/post');
    expect(toSlugPath('/')).toBe('');
    expect(toSlugPath('')).toBe('');
  });

  it('chuẩn hoá BÊN TRONG ngoặc, không xoá ngoặc', () => {
    expect(toSlugPath('Tin Tức/[Slug]')).toBe('tin-tuc/[slug]');
    expect(toSlugPath('blogs/[category]')).toBe('blogs/[category]');
  });

  it('ngoặc rỗng sau chuẩn hoá thì rụng cả đoạn, không thành đoạn tĩnh', () => {
    // `toSlug('[!!]')` trả `''`. Trả về `'blogs'` chứ KHÔNG `'blogs/'` hay `'blogs/[]'`.
    expect(toSlugPath('blogs/[!!]')).toBe('blogs');
  });
});

describe('slugShape / isTemplateSlug / paramNames', () => {
  it('mọi đoạn động thành *', () => {
    expect(slugShape('blogs/[category]')).toBe('blogs/*');
    expect(slugShape('blogs/[thang]')).toBe('blogs/*');
    expect(slugShape('blogs/post/[slug]')).toBe('blogs/post/*');
    expect(slugShape('blogs')).toBe('blogs');
  });

  it('nhận diện mẫu và đọc được tên đoạn', () => {
    expect(isTemplateSlug('blogs/[category]')).toBe(true);
    expect(isTemplateSlug('blogs')).toBe(false);
    expect(paramNames('blogs/post/[slug]')).toEqual(['slug']);
    expect(paramNames('blogs')).toEqual([]);
  });
});

describe('checkSlugPath', () => {
  it('trang chủ và đường dẫn thường đi qua', () => {
    expect(checkSlugPath('')).toBeNull();
    expect(checkSlugPath('blogs')).toBeNull();
    expect(checkSlugPath('blogs/post/[slug]')).toBeNull();
  });

  it('từ chối quá 4 đoạn', () => {
    expect(checkSlugPath('a/b/c/d')).toBeNull();
    expect(checkSlugPath('a/b/c/d/e')).toMatch(/tối đa 4 đoạn/);
  });

  it('từ chối hai đoạn động', () => {
    expect(checkSlugPath('blogs/[category]/[slug]')).toMatch(/MỘT đoạn động/);
  });

  it('từ chối đoạn động ở đầu — nó nuốt mọi địa chỉ một đoạn', () => {
    expect(checkSlugPath('[slug]')).toMatch(/không được đứng đầu/);
    expect(checkSlugPath('[slug]/chi-tiet')).toMatch(/không được đứng đầu/);
  });

  it('từ chối đoạn đầu trùng route hệ thống', () => {
    for (const w of ['api', 'preview', 'builder', 'render', 'mm-css']) {
      expect(checkSlugPath(`${w}/x`)).toMatch(/đường dẫn hệ thống/);
    }
    // Chỉ đoạn ĐẦU. `blogs/api` là một địa chỉ hợp lệ.
    expect(checkSlugPath('blogs/api')).toBeNull();
  });

  it('từ chối đoạn đầu trùng mã ngôn ngữ đang bật', () => {
    expect(checkSlugPath('en/blogs', { localeCodes: ['vi', 'en'] })).toMatch(/mã ngôn ngữ/);
    expect(checkSlugPath('en/blogs')).toBeNull();
  });

  it('từ chối ngoặc sai cú pháp thay vì im lặng coi nó là đoạn tĩnh', () => {
    expect(checkSlugPath('blogs/[Slug')).toMatch(/sai cú pháp/);
    expect(checkSlugPath('blogs/a[b]c')).toMatch(/sai cú pháp/);
  });
});

describe('matchSlugTemplate', () => {
  const T = (slug: string) => ({ slug });

  it('khớp một đoạn động và trả giá trị theo tên', () => {
    const hit = matchSlugTemplate('blogs/tin-tuc', [T('blogs/[category]')]);
    expect(hit?.template.slug).toBe('blogs/[category]');
    expect(hit?.params).toEqual({ category: 'tin-tuc' });
  });

  it('số đoạn phải bằng nhau — không có catch-all', () => {
    expect(matchSlugTemplate('blogs/post/x', [T('blogs/[category]')])).toBeNull();
    expect(matchSlugTemplate('blogs', [T('blogs/[category]')])).toBeNull();
  });

  it('tĩnh thắng động: chọn mẫu nhiều đoạn tĩnh nhất', () => {
    const hit = matchSlugTemplate('blogs/tin-tuc', [T('[a]/[b]'), T('blogs/[category]')]);
    expect(hit?.template.slug).toBe('blogs/[category]');
  });

  it('thứ tự mảng không đổi kết quả khi có hoà về số đoạn tĩnh', () => {
    const a = matchSlugTemplate('blogs/tin-tuc', [T('[a]/[b]'), T('blogs/[category]')]);
    const b = matchSlugTemplate('blogs/tin-tuc', [T('blogs/[category]'), T('[a]/[b]')]);
    expect(a?.template.slug).toBe(b?.template.slug);
  });

  it('gõ thẳng chuỗi có ngoặc thì KHÔNG khớp mẫu nào', () => {
    // Nếu khớp, bot nhận một trang mẫu chưa bind dữ liệu và Google index nó.
    expect(matchSlugTemplate('blogs/[category]', [T('blogs/[category]')])).toBeNull();
  });

  it('không có mẫu nào thì trả null, không ném', () => {
    expect(matchSlugTemplate('blogs/tin-tuc', [])).toBeNull();
  });
});
