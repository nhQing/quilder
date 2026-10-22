import { describe, expect, it } from 'vitest';

import type { RepeatSpec } from '@/lib/doc/types';
import { itemOverrides, toDateText, toRichText, type RepeatItem } from './repeat';

const SPEC: RepeatSpec = {
  source: { kind: 'query', query: { typeKey: 'news', limit: 10 } },
  map: {
    title: { nodeId: 'card__title', as: 'content' },
    excerpt: { nodeId: 'card__desc', as: 'content' },
    cover: { nodeId: 'card__img', as: 'assetId' },
    slug: { nodeId: 'card__link', as: 'href' },
  },
};

const ITEM: RepeatItem = {
  key: 'e1',
  typeKey: 'news',
  slug: 'lai-suat-thang-8',
  data: {
    title: 'Lãi suất tháng 8',
    excerpt: 'Mô tả ngắn',
    cover: { assetId: 'a1', alt: 'Ảnh bìa' },
  },
};

describe('itemOverrides', () => {
  it('chữ đi vào `content` dưới dạng RichText, không phải chuỗi', () => {
    // `ContentOverride.content` là RichText. Đưa chuỗi vào đây thì renderer nhận một
    // thứ không phải mảng và không render gì — im lặng.
    const o = itemOverrides(ITEM, SPEC, {});
    expect(o.card__title?.content).toEqual([{ t: 'text', v: 'Lãi suất tháng 8' }]);
  });

  it('field richtext giữ nguyên cây, không bọc thêm một lớp', () => {
    const item = { ...ITEM, data: { title: [{ t: 'strong', children: [{ t: 'text', v: 'Đậm' }] }] } };
    const o = itemOverrides(item, SPEC, {});
    expect(o.card__title?.content).toEqual([{ t: 'strong', children: [{ t: 'text', v: 'Đậm' }] }]);
  });

  it('ảnh lấy assetId, và alt đi kèm mà không cần ánh xạ riêng', () => {
    const o = itemOverrides(ITEM, SPEC, {});
    expect(o.card__img?.assetId).toBe('a1');
    expect(o.card__img?.alt).toBe('Ảnh bìa');
  });

  it('slug thành đường dẫn đầy đủ khi biết gốc trang chi tiết', () => {
    const o = itemOverrides(ITEM, SPEC, { detailBase: '/tin-tuc' });
    expect(o.card__link?.href).toBe('/tin-tuc/lai-suat-thang-8');
  });

  it('gốc có dấu / thừa vẫn ra một đường dẫn, không phải hai dấu //', () => {
    const o = itemOverrides(ITEM, SPEC, { detailBase: '/tin-tuc/' });
    expect(o.card__link?.href).toBe('/tin-tuc/lai-suat-thang-8');
  });

  it('không biết gốc thì href là chính slug — không bao giờ là "undefined"', () => {
    const o = itemOverrides(ITEM, SPEC, {});
    expect(o.card__link?.href).toBe('lai-suat-thang-8');
  });

  it('field vắng mặt thì KHÔNG sinh override — thẻ giữ nội dung của component', () => {
    const o = itemOverrides({ ...ITEM, slug: undefined, data: { title: 'Chỉ có tiêu đề' } }, SPEC, {});
    expect(o.card__desc).toBeUndefined();
    expect(o.card__img).toBeUndefined();
    expect(o.card__link).toBeUndefined();
  });

  it('hai field ánh xạ vào cùng một node thì gộp, không ghi đè lẫn nhau', () => {
    const spec: RepeatSpec = {
      source: SPEC.source,
      map: {
        title: { nodeId: 'n1', as: 'content' },
        slug: { nodeId: 'n1', as: 'href' },
      },
    };
    const o = itemOverrides(ITEM, spec, {});
    expect(o.n1?.content).toBeDefined();
    expect(o.n1?.href).toBe('lai-suat-thang-8');
  });

  it('số được đổi thành chữ theo tiếng Việt', () => {
    const spec: RepeatSpec = { source: SPEC.source, map: { views: { nodeId: 'n', as: 'content' } } };
    const o = itemOverrides({ ...ITEM, data: { views: 1234 } }, spec, {});
    expect(o.n?.content).toEqual([{ t: 'text', v: '1.234' }]);
  });

  it('mốc thời gian ISO thành ngày đọc được, không phải chuỗi ISO thô', () => {
    // Không có bước này thì thẻ tin hiện "2026-08-15T00:00:00.000Z" — vẫn là chữ,
    // vẫn hiện, nên nó đi thẳng ra production.
    const spec: RepeatSpec = { source: SPEC.source, map: { published_at: { nodeId: 'n', as: 'content' } } };
    const o = itemOverrides({ ...ITEM, data: { published_at: '2026-08-15T00:00:00.000Z' } }, spec, {});
    const first = o.n?.content?.[0];
    expect(first && 't' in first && first.t === 'text' ? first.v : '').toContain('2026');
    expect(first && 't' in first && first.t === 'text' ? first.v : '').not.toContain('T00:00');
  });

  it('giá trị object không ánh xạ được thì BỎ QUA, không ném', () => {
    const spec: RepeatSpec = { source: SPEC.source, map: { zone: { nodeId: 'n', as: 'content' } } };
    const o = itemOverrides({ ...ITEM, data: { zone: [{ __type: 'quote' }] } }, spec, {});
    expect(o.n).toBeUndefined();
  });

  it('link dạng { href, label } lấy đúng href', () => {
    const spec: RepeatSpec = { source: SPEC.source, map: { cta: { nodeId: 'n', as: 'href' } } };
    const o = itemOverrides({ ...ITEM, data: { cta: { href: 'https://a.vn', label: 'Xem' } } }, spec, {});
    expect(o.n?.href).toBe('https://a.vn');
  });
});

describe('toRichText', () => {
  it('chuỗi rỗng trả undefined, không phải một đoạn rỗng', () => {
    // Một đoạn rỗng ghi đè chữ của component bằng chữ trắng — thẻ trông như hỏng.
    expect(toRichText('')).toBeUndefined();
    expect(toRichText('   ')).toBeUndefined();
  });

  it('boolean và null trả undefined', () => {
    expect(toRichText(null)).toBeUndefined();
    expect(toRichText(true)).toBeUndefined();
  });

  it('mảng rỗng trả undefined — richtext chưa gõ gì không được xoá chữ gốc', () => {
    expect(toRichText([])).toBeUndefined();
  });
});

describe('toDateText', () => {
  it('chỉ nhận dạng ISO đầy đủ có giờ', () => {
    expect(toDateText('2026-08-15T00:00:00.000Z')).toBeDefined();
    // Một tiêu đề là "2026" vẫn phải là chữ "2026", không phải ngày 1/1/2026.
    expect(toDateText('2026')).toBeUndefined();
    expect(toDateText('2026-08-15')).toBeUndefined();
    expect(toDateText('19/08/2026')).toBeUndefined();
  });
});

describe('khoá ảo', () => {
  const one = (key: string, as: 'content' | 'href' | 'assetId' = 'content'): RepeatSpec => ({
    source: SPEC.source,
    map: { [key]: { nodeId: 'n', as } },
  });
  const text = (o: ReturnType<typeof itemOverrides>) => {
    const first = o.n?.content?.[0];
    return first && 't' in first && first.t === 'text' ? first.v : undefined;
  };

  it('huy hiệu danh mục lấy danh mục ĐẦU TIÊN — đây là lỗi đang có trên site thật', () => {
    // stg.example.com/blogs/san-pham, bản đã publish: mọi thẻ mang chữ mẫu
    // 'Danh mục' vì danh mục nằm ở bảng nối, không nằm trong `data`.
    const item = {
      ...ITEM,
      taxonomies: [{ key: 'san-pham', name: 'Sản phẩm' }, { key: 'dau-tu', name: 'Đầu tư' }],
    };
    expect(text(itemOverrides(item, one('taxonomy'), {}))).toBe('Sản phẩm');
  });

  it('taxonomies nối mọi danh mục bằng dấu phẩy', () => {
    const item = {
      ...ITEM,
      taxonomies: [{ key: 'san-pham', name: 'Sản phẩm' }, { key: 'dau-tu', name: 'Đầu tư' }],
    };
    expect(text(itemOverrides(item, one('taxonomies'), {}))).toBe('Sản phẩm, Đầu tư');
  });

  it('bài chưa gắn danh mục nào thì KHÔNG override — thẻ giữ chữ gốc', () => {
    expect(itemOverrides({ ...ITEM, taxonomies: [] }, one('taxonomy'), {}).n).toBeUndefined();
    expect(itemOverrides({ ...ITEM, taxonomies: [] }, one('taxonomies'), {}).n).toBeUndefined();
  });

  it('published_at đọc được từ CỘT, không cần ai nhét vào data', () => {
    const item = { ...ITEM, publishedAt: '2026-08-15T00:00:00.000Z' };
    expect(text(itemOverrides(item, one('published_at'), {}))).toContain('2026');
  });

  it('field cùng tên THẮNG cột published_at — cột hệ thống không đè dữ liệu tác giả', () => {
    const item = {
      ...ITEM,
      publishedAt: '2026-08-15T00:00:00.000Z',
      data: { published_at: 'Số tháng 7' },
    };
    expect(text(itemOverrides(item, one('published_at'), {}))).toBe('Số tháng 7');
  });

  const AUTHOR = { email: 'lan@example.com', name: 'Lan Nguyễn', avatarAssetId: 'a9', locked: false };

  it('byline lấy tên tác giả, và avatar đi kèm alt mà không cần ánh xạ riêng', () => {
    const item = { ...ITEM, author: AUTHOR };
    expect(text(itemOverrides(item, one('author'), {}))).toBe('Lan Nguyễn');

    const o = itemOverrides(item, one('author_avatar', 'assetId'), {});
    expect(o.n?.assetId).toBe('a9');
    expect(o.n?.alt).toBe('Lan Nguyễn');
  });

  it('tài khoản chưa đặt tên thì byline rơi về email, KHÔNG để trống', () => {
    // Byline trống trông như thẻ hỏng, và không nói cho ai biết phải sửa ở đâu.
    const item = { ...ITEM, author: { ...AUTHOR, name: null } };
    expect(text(itemOverrides(item, one('author'), {}))).toBe('lan@example.com');
  });

  it('tài khoản ĐÃ KHOÁ vẫn đứng tên bài họ viết', () => {
    // Giữ lại lịch sử chính là mục đích của việc khoá thay vì xoá.
    const item = { ...ITEM, author: { ...AUTHOR, locked: true } };
    expect(text(itemOverrides(item, one('author'), {}))).toBe('Lan Nguyễn');
  });

  it('tác giả chưa có ảnh thì KHÔNG override — thẻ giữ ảnh mẫu của component', () => {
    const item = { ...ITEM, author: { ...AUTHOR, avatarAssetId: null } };
    expect(itemOverrides(item, one('author_avatar', 'assetId'), {}).n).toBeUndefined();
  });

  it('cột slug THẮNG field cùng tên — field giữ chữ chưa qua toSlug', () => {
    // Lấy nhầm bản trong `data` là mọi thẻ bấm ra 404.
    const item = { ...ITEM, slug: 'lai-suat-thang-8', data: { ...ITEM.data, slug: 'Lãi suất tháng 8' } };
    expect(itemOverrides(item, one('slug', 'href'), {}).n?.href).toBe('lai-suat-thang-8');
  });
});
