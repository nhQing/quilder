import { describe, expect, it } from 'vitest';

import {
  checkCollectionPairing,
  parsePageCollection,
  templateBase,
  type PageCollection,
} from './page-collection';

const C = (typeKey: string, param: PageCollection['param']): PageCollection => ({ typeKey, param });

/** Vai `relation`: đoạn động mang slug của một bản ghi thuộc loại đích của `field`. */
const R = (typeKey: string, field: string): PageCollection => ({ typeKey, param: 'relation', field });

describe('parsePageCollection', () => {
  it('nhận ba vai hợp lệ', () => {
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'list' })).toEqual(C('tin-tuc', 'list'));
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'entry' })).toEqual(C('tin-tuc', 'entry'));
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'taxonomy' })).toEqual(
      C('tin-tuc', 'taxonomy'),
    );
  });

  it('nhận vai relation khi có `field`', () => {
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'relation', field: 'category' })).toEqual(
      R('tin-tuc', 'category'),
    );
  });

  /*
   * `field` là thứ DUY NHẤT nói đoạn động tra vào loại nào: nó trỏ tới một field
   * `relation` của `typeKey`, và loại ĐÍCH của field ấy là loại mang slug trên URL.
   * Thiếu nó thì không có gì phân giải được đoạn động — đúng hình dạng "mẫu không khai
   * collection" mà `listPageTemplates` đã loại khỏi bảng định tuyến.
   */
  it('từ chối vai relation KHÔNG có `field`', () => {
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'relation' })).toBeNull();
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'relation', field: '' })).toBeNull();
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'relation', field: 7 })).toBeNull();
  });

  it('ba vai cũ KHÔNG mang `field` ra ngoài, kể cả khi hàng trong DB có', () => {
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'list', field: 'category' })).toEqual(
      C('tin-tuc', 'list'),
    );
  });

  it('từ chối mọi hình dạng khác', () => {
    expect(parsePageCollection(null)).toBeNull();
    expect(parsePageCollection(undefined)).toBeNull();
    expect(parsePageCollection('tin-tuc')).toBeNull();
    expect(parsePageCollection({})).toBeNull();
    expect(parsePageCollection({ typeKey: 'tin-tuc' })).toBeNull();
    expect(parsePageCollection({ typeKey: '', param: 'list' })).toBeNull();
    expect(parsePageCollection({ typeKey: 'tin-tuc', param: 'archive' })).toBeNull();
  });

  it('từ chối hình dạng CŨ `{mode}` thay vì im lặng đi qua', () => {
    // `{mode: 'detail'}` không nói được đoạn động trỏ vào entry hay vào danh mục.
    // Nhận nó là để một trang danh mục render như trang chi tiết.
    expect(parsePageCollection({ typeKey: 'tin-tuc', mode: 'detail' })).toBeNull();
    expect(parsePageCollection({ typeKey: 'tin-tuc', mode: 'list' })).toBeNull();
  });
});

describe('templateBase', () => {
  it('bỏ đoạn động', () => {
    expect(templateBase('blogs/post/[slug]')).toBe('/blogs/post');
    expect(templateBase('blogs/[category]')).toBe('/blogs');
  });

  it('trang không có đoạn động thì gốc là chính nó', () => {
    expect(templateBase('blogs')).toBe('/blogs');
    expect(templateBase('')).toBe('/');
  });
});

describe('checkCollectionPairing', () => {
  it('ba cặp đúng đi qua', () => {
    expect(checkCollectionPairing('blogs', C('tin-tuc', 'list'))).toBeNull();
    expect(checkCollectionPairing('blogs/post/[slug]', C('tin-tuc', 'entry'))).toBeNull();
    expect(checkCollectionPairing('blogs/[category]', C('tin-tuc', 'taxonomy'))).toBeNull();
    expect(checkCollectionPairing('gioi-thieu', null)).toBeNull();
    expect(checkCollectionPairing('blogs/[category-slug]', R('tin-tuc', 'category'))).toBeNull();
  });

  it('mẫu KHÔNG khai loại là một URL 404 im lặng — từ chối', () => {
    expect(checkCollectionPairing('blogs/[category]', null)).toMatch(/phải chọn loại nội dung/);
  });

  it('trang danh sách không được có đoạn động', () => {
    expect(checkCollectionPairing('blogs/[category]', C('tin-tuc', 'list'))).toMatch(
      /không được có đoạn động/,
    );
  });

  it('vai entry / taxonomy mà slug không có đoạn động thì vô nghĩa', () => {
    expect(checkCollectionPairing('blogs', C('tin-tuc', 'entry'))).toMatch(/blogs\/post\/\[slug\]/);
    expect(checkCollectionPairing('blogs', C('tin-tuc', 'taxonomy'))).toMatch(/blogs\/\[category\]/);
  });

  it('vai relation mà slug không có đoạn động thì vô nghĩa', () => {
    expect(checkCollectionPairing('blogs', R('tin-tuc', 'category'))).toContain(
      'blogs/[category-slug]',
    );
  });

  /*
   * Hàng rào cho một `PageCollection` dựng BẰNG TAY, không đi qua
   * `parsePageCollection`: `CollectionInput` của đường ghi là `{ typeKey, param }`,
   * nên một vai `relation` thiếu `field` vẫn lọt tới đây được về mặt KIỂU.
   */
  it('vai relation thiếu `field` bị chặn ở cả đường ghi', () => {
    expect(
      checkCollectionPairing('blogs/[category-slug]', { typeKey: 'tin-tuc', param: 'relation' }),
    ).toMatch(/field/i);
  });

  it('trang chủ không khai gì là hợp lệ', () => {
    expect(checkCollectionPairing('', null)).toBeNull();
  });
});
