import { describe, expect, it } from 'vitest';

import { assetSnapshot, tokenSnapshot } from './release-snapshot';

/**
 * Hàm dựng ảnh chụp cho một `Release`.
 *
 * Tách khỏi route publish để test được: vitest ở dự án này KHÔNG có Postgres
 * (`vitest.config.ts` chỉ include `src/**`), nên mọi logic đáng test phải nằm
 * trong hàm thuần, và phần còn lại trong route chỉ là truy vấn.
 */

describe('tokenSnapshot', () => {
  it('map name → value', () => {
    expect(tokenSnapshot([{ name: 'brand-x', value: '#fff' }])).toEqual({ 'brand-x': '#fff' });
  });

  it('bỏ tiền tố -- nếu ai đó lỡ để vào tên', () => {
    // `Token.name` được quy ước là KHÔNG có '--' (xem schema), nhưng dữ liệu vào
    // được qua seed, qua prisma studio, qua script. Chuẩn hoá ở đây thì
    // `tokenCssFromSeal` không bao giờ phát `----x`.
    expect(tokenSnapshot([{ name: '--brand-x', value: '#fff' }])).toEqual({ 'brand-x': '#fff' });
  });

  it('rỗng vào thì rỗng ra — 0 token tự tạo là trạng thái BÌNH THƯỜNG hôm nay', () => {
    expect(tokenSnapshot([])).toEqual({});
  });
});

describe('assetSnapshot', () => {
  it('giữ đúng năm field mà renderer đọc', () => {
    expect(
      assetSnapshot([
        {
          id: 'a1',
          url: '/img/x.png',
          width: 447,
          height: 677,
          blurhash: 'L1',
          mime: 'image/png',
        },
      ]),
    ).toEqual({
      a1: { url: '/img/x.png', width: 447, height: 677, blurhash: 'L1', mime: 'image/png' },
    });
  });

  it('không nuốt null — width null phải ra null, không phải undefined', () => {
    // JSON.stringify bỏ hẳn key có giá trị undefined, nên một `undefined` ở đây
    // biến thành "field không tồn tại" trong JSONB. `NodeRenderer` đọc
    // `asset.width` và sẽ thấy undefined ở cả hai trường hợp — nhưng ảnh chụp
    // phải nói được "đã đo và không có kích thước" khác với "chưa đo".
    expect(
      assetSnapshot([
        {
          id: 'a1',
          url: '/x.svg',
          width: null,
          height: null,
          blurhash: null,
          mime: 'image/svg+xml',
        },
      ]).a1,
    ).toEqual({
      url: '/x.svg',
      width: null,
      height: null,
      blurhash: null,
      mime: 'image/svg+xml',
    });
  });

  it('nhiều asset giữ đủ, khoá theo id', () => {
    const out = assetSnapshot([
      { id: 'a', url: '/a.png', width: 1, height: 1, blurhash: null, mime: 'image/png' },
      { id: 'b', url: '/b.png', width: 2, height: 2, blurhash: null, mime: 'image/png' },
    ]);
    expect(Object.keys(out).sort()).toEqual(['a', 'b']);
  });

  it('rỗng vào thì rỗng ra', () => {
    expect(assetSnapshot([])).toEqual({});
  });
});
