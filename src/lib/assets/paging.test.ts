import { describe, expect, it } from 'vitest';

import { ASSET_PAGE_SIZE, assetPageNumber, assetPageSize } from './paging';

/**
 * Hai hàm này đứng ngay sau `searchParams`, tức là sau một chuỗi người dùng gõ được.
 * Chúng chỉ có một việc: KHÔNG bao giờ trả về thứ làm truy vấn Prisma sai — `skip`
 * âm, hay `take` bằng `NaN`. Nên phần được test là rác, không phải đường đẹp.
 */
describe('assetPageNumber', () => {
  it('vắng mặt hoặc rỗng = trang 1', () => {
    expect(assetPageNumber(undefined)).toBe(1);
    expect(assetPageNumber('')).toBe(1);
  });

  it('đọc số hợp lệ', () => {
    expect(assetPageNumber('2')).toBe(2);
    expect(assetPageNumber('137')).toBe(137);
  });

  it('kẹp về 1 với số âm, 0 và số thập phân', () => {
    expect(assetPageNumber('-5')).toBe(1);
    expect(assetPageNumber('0')).toBe(1);
    // 2.9 → 2, không phải 3: `skip` phải là số nguyên.
    expect(assetPageNumber('2.9')).toBe(2);
  });

  it('kẹp về 1 với rác và Infinity', () => {
    expect(assetPageNumber('abc')).toBe(1);
    expect(assetPageNumber('Infinity')).toBe(1);
  });
});

describe('assetPageSize', () => {
  it('vắng mặt = cỡ mặc định', () => {
    expect(assetPageSize(undefined)).toBe(ASSET_PAGE_SIZE);
  });

  it('nhận đúng các cỡ có thật', () => {
    expect(assetPageSize('24')).toBe(24);
    expect(assetPageSize('48')).toBe(48);
    expect(assetPageSize('96')).toBe(96);
  });

  it('cỡ không có trong danh sách rơi về mặc định', () => {
    // 1000 là cỡ hợp lệ về mặt cú pháp; từ chối nó là chặn một truy vấn tải cả kho.
    expect(assetPageSize('1000')).toBe(ASSET_PAGE_SIZE);
    expect(assetPageSize('25')).toBe(ASSET_PAGE_SIZE);
    expect(assetPageSize('0')).toBe(ASSET_PAGE_SIZE);
    expect(assetPageSize('-48')).toBe(ASSET_PAGE_SIZE);
    expect(assetPageSize('abc')).toBe(ASSET_PAGE_SIZE);
  });
});
