import { describe, expect, it } from 'vitest';

import { applyEntryLocale, localeCoverage } from './i18n';

const DATA = { title: 'Lãi suất tháng 8', excerpt: 'Mô tả tiếng Việt', views: 12 };

describe('applyEntryLocale', () => {
  it('phủ field đã dịch lên data', () => {
    const r = applyEntryLocale(DATA, { en: { title: 'August rates' } }, 'en', null);
    expect(r.title).toBe('August rates');
  });

  it('field CHƯA dịch rơi về bản gốc, không bao giờ để trống', () => {
    // Để trống thì trang tiếng Anh trông như lỗi chứ không như "chưa xong" — đúng
    // lý do model Locale có cờ `enabled`.
    const r = applyEntryLocale(DATA, { en: { title: 'August rates' } }, 'en', null);
    expect(r.excerpt).toBe('Mô tả tiếng Việt');
  });

  it('locale không có bản dịch nào thì trả nguyên data', () => {
    expect(applyEntryLocale(DATA, { en: { title: 'x' } }, 'fr', null)).toEqual(DATA);
  });

  it('i18n không phải object thì trả nguyên data, không ném lỗi', () => {
    expect(applyEntryLocale(DATA, null, 'en', null)).toEqual(DATA);
    expect(applyEntryLocale(DATA, 'rác', 'en', null)).toEqual(DATA);
  });

  it('KHÔNG phủ giá trị rỗng: ô dịch để trống nghĩa là chưa dịch', () => {
    const r = applyEntryLocale(DATA, { en: { title: '' } }, 'en', null);
    expect(r.title).toBe('Lãi suất tháng 8');
  });

  it('không sửa data gốc', () => {
    const copy = { ...DATA };
    applyEntryLocale(DATA, { en: { title: 'x' } }, 'en', null);
    expect(DATA).toEqual(copy);
  });

  it('số 0 là giá trị THẬT, không phải rỗng — phải phủ được', () => {
    // Nếu `isBlank(0)` là true thì lớp phủ bỏ qua nó, và trang tiếng Anh lặng lẽ
    // hiện số của tiếng Việt. Không có triệu chứng nào ngoài "con số hơi lạ".
    const r = applyEntryLocale({ views: 12 }, { en: { views: 0 } }, 'en', null);
    expect(r.views).toBe(0);
  });

  it('false là giá trị THẬT, không phải rỗng — phải phủ được', () => {
    const r = applyEntryLocale({ pinned: true }, { en: { pinned: false } }, 'en', null);
    expect(r.pinned).toBe(false);
  });
});

describe('localeCoverage', () => {
  it('đếm số field đã dịch trên tổng số field có giá trị', () => {
    expect(localeCoverage(DATA, { en: { title: 'x' } }, 'en', null)).toEqual({ translated: 1, total: 3 });
  });

  it('locale trống thì 0', () => {
    expect(localeCoverage(DATA, {}, 'en', null)).toEqual({ translated: 0, total: 3 });
  });
});

/**
 * `isBlank` không được export, nên nó được kiểm QUA hai hàm gọi nó. Đó cũng là
 * đúng cách: hành vi cần khoá là "coverage nói thật" và "lớp phủ không ghi rỗng",
 * không phải chữ ký của một hàm nội bộ.
 */
describe('isBlank với RichText và RichDoc', () => {
  const BLANK_RT = [{ t: 'text', v: '' }];
  const BLANK_DOC = [{ b: 'p', children: [{ t: 'text', v: '' }] }];
  const REAL_DOC = [{ b: 'p', children: [{ t: 'text', v: 'August rates' }] }];

  it('RichDoc là một MẢNG nên isBlank đọc được nó — giả định mà zRichDoc dựa vào', () => {
    // Nếu `RichDoc` là `{ type:'doc', content:[…] }` kiểu Tiptap thì nhánh
    // `Array.isArray` không bao giờ chạy, `isBlank` trả false cho mọi giá trị kể cả
    // `{}`, và MỌI field richdoc hoá "đã dịch". Ca này là phép kiểm của điều đó.
    expect(localeCoverage({ body: REAL_DOC }, { en: { body: [] } }, 'en', null).translated).toBe(0);
    expect(localeCoverage({ body: REAL_DOC }, { en: { body: REAL_DOC } }, 'en', null).translated).toBe(1);
  });

  it('richdoc chỉ có khối rỗng KHÔNG tính là đã dịch', () => {
    // Luật cũ ("có ≥1 phần tử") tính nó là đã dịch: mở tab tiếng Anh rồi lưu mà
    // không gõ gì sẽ cho coverage 100%.
    expect(localeCoverage({ body: REAL_DOC }, { en: { body: BLANK_DOC } }, 'en', null).translated).toBe(0);
  });

  it('richtext chỉ có chữ rỗng KHÔNG tính là đã dịch', () => {
    expect(localeCoverage({ body: [{ t: 'text', v: 'x' }] }, { en: { body: BLANK_RT } }, 'en', null).translated).toBe(0);
  });

  it('KHÔNG phủ một cây chữ rỗng lên bản gốc', () => {
    const r = applyEntryLocale({ body: REAL_DOC }, { en: { body: BLANK_DOC } }, 'en', null);
    expect(r.body).toEqual(REAL_DOC);
  });

  it('richdoc có chữ ở bất kỳ tầng nào cũng là đã dịch — kể cả alt của ảnh', () => {
    const onlyFigure = [{ b: 'figure', assetId: 'a1', alt: 'Maintenance schedule' }];
    expect(localeCoverage({ body: REAL_DOC }, { en: { body: onlyFigure } }, 'en', null).translated).toBe(1);
    const inList = [{ b: 'ul', items: [{ children: [{ t: 'text', v: 'Deposits paused' }] }] }];
    expect(localeCoverage({ body: REAL_DOC }, { en: { body: inList } }, 'en', null).translated).toBe(1);
  });

  it('mảng KHÔNG phải cây chữ giữ đúng luật cũ — không field nào hoá rỗng oan', () => {
    // Phép siết chỉ được áp cho cây chữ. `relation`, `image` nhiều ảnh và `blocks`
    // đều là mảng và đều KHÔNG có chữ nào cho `treeText` tìm được — đọc chúng bằng
    // luật mới sẽ làm mọi bản dịch của chúng biến mất khỏi coverage.
    const data = { rel: ['x'], gallery: [{ assetId: 'a1', alt: 'x' }], zone: [{ __type: 'quote' }] };
    const c = localeCoverage(data, { en: data }, 'en', null);
    expect(c).toEqual({ translated: 3, total: 3 });
  });

  it('mục nhóm lặp có field tên "t" không bị đọc lầm thành node chữ', () => {
    // `zKey` cho phép một khoá field đúng là `t`. Khoá lạ đi kèm (`title`) là thứ
    // phân biệt nó với một inline node thật.
    const items = [{ t: 'a', title: 'Xin chào' }];
    expect(localeCoverage({ ctas: items }, { en: { ctas: items } }, 'en', null).translated).toBe(1);
  });
});

describe('field seo trong lớp phủ', () => {
  const BASE = {
    title: 'Lãi suất',
    seo: { metaTitle: 'SEO VI', canonicalUrl: '/blogs/vi', noindex: true, ogImage: { assetId: 'img1', alt: 'VI' } },
  };

  it('KHÔNG có lớp phủ vẫn lột canonical/chữ/noindex của bản gốc — chỉ giữ ảnh OG', () => {
    const r = applyEntryLocale(BASE, null, 'en', 'seo');
    expect(r.seo).toEqual({ ogImage: { assetId: 'img1' } });
    expect(r.title).toBe('Lãi suất');
    expect(applyEntryLocale(BASE, { en: { title: 'Rates' } }, 'en', 'seo').seo).toEqual({ ogImage: { assetId: 'img1' } });
  });

  it('lớp phủ có seo thì theo luật localizeSeo', () => {
    const r = applyEntryLocale(BASE, { en: { seo: { metaTitle: 'SEO EN', ogImage: { alt: 'EN' } } } }, 'en', 'seo');
    expect(r.seo).toEqual({ metaTitle: 'SEO EN', ogImage: { assetId: 'img1', alt: 'EN' } });
  });

  it('bài không có khoá seo và lớp phủ không có seo: không đẻ ra khoá seo', () => {
    expect(applyEntryLocale({ title: 'A' }, null, 'en', 'seo')).toEqual({ title: 'A' });
  });

  it('seoKey null: khoá seo phủ cạn như hành vi cũ', () => {
    expect(applyEntryLocale(BASE, null, 'en', null)).toEqual(BASE);
  });

  it('độ phủ: SEO chỉ đếm khi có CHỮ', () => {
    const onlyFlags = { title: 'A', seo: { noindex: true, ogImage: { assetId: 'i' } } };
    expect(localeCoverage(onlyFlags, { en: { title: 'B' } }, 'en', 'seo')).toEqual({ translated: 1, total: 1 });
    expect(localeCoverage(BASE, { en: { title: 'B' } }, 'en', 'seo')).toEqual({ translated: 1, total: 2 });
    expect(localeCoverage(BASE, { en: { title: 'B', seo: { noindex: true } } }, 'en', 'seo').translated).toBe(1);
    expect(localeCoverage(BASE, { en: { title: 'B', seo: { metaTitle: 'EN' } } }, 'en', 'seo').translated).toBe(2);
  });
});
