import { describe, expect, it } from 'vitest';

import { freshTranslationSnapshot, mergeTranslationSnapshot, nodeIdsOf, planReleaseEntries } from './plan';

/**
 * Mọi phép kiểm ở đây là về một lỗi IM LẶNG.
 *
 * Publish sai không ném exception và không đỏ ở đâu cả — nó chỉ làm site thật
 * mang nội dung mà không ai chọn. Nên mỗi `it` dưới đây đặt tên theo hậu quả
 * trên site, không theo tên hàm.
 */

const page = (id: string, slug: string, draft: string | null) => ({
  id, slug, draftVersionId: draft,
});

describe('planReleaseEntries — publish cả site', () => {
  it('lấy bản nháp của mọi trang, bỏ qua trang chưa từng có nháp', () => {
    const result = planReleaseEntries({
      sitePages: [page('a', '', 'va2'), page('b', 'gioi-thieu', 'vb2'), page('c', 'moi', null)],
      liveEntries: [],
      selection: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toEqual([
      { id: 'a', slug: '', versionId: 'va2' },
      { id: 'b', slug: 'gioi-thieu', versionId: 'vb2' },
    ]);
    expect(result.publishedIds).toEqual(['a', 'b']);
  });
});

describe('planReleaseEntries — publish từng trang', () => {
  const sitePages = [
    page('a', '', 'va2'),
    page('b', 'gioi-thieu', 'vb2'),
    page('c', 'tin-tuc', 'vc2'),
  ];
  const liveEntries = [
    { pageId: 'a', slug: '', versionId: 'va1' },
    { pageId: 'b', slug: 'gioi-thieu', versionId: 'vb1' },
    { pageId: 'c', slug: 'tin-tuc', versionId: 'vc1' },
  ];

  it('chỉ trang được chọn lên bản nháp; trang khác giữ NGUYÊN bản đang chạy', () => {
    const result = planReleaseEntries({ sitePages, liveEntries, selection: ['b'] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = Object.fromEntries(result.pages.map((p) => [p.id, p.versionId]));
    expect(byId).toEqual({ a: 'va1', b: 'vb2', c: 'vc1' });
    expect(result.publishedIds).toEqual(['b']);
  });

  it('release mới vẫn ĐẦY ĐỦ: không trang nào rơi khỏi site', () => {
    // Đây là bất biến giữ cho lùi bản còn đúng. Nếu release chỉ chứa trang vừa
    // publish thì bấm nút trên một trang là gỡ mọi trang khác khỏi site — im lặng.
    const result = planReleaseEntries({ sitePages, liveEntries, selection: ['b'] });
    if (!result.ok) throw new Error(result.error);
    expect(result.pages.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('slug của trang KHÔNG publish lấy từ release, không lấy từ Page', () => {
    // Đổi slug là một thay đổi nháp. Lấy `Page.slug` ở đây sẽ đẩy URL mới lên
    // sóng qua nút Publish của một trang khác.
    const renamed = [page('a', '', 'va2'), page('b', 've-chung-toi', 'vb2')];
    const result = planReleaseEntries({
      sitePages: renamed,
      liveEntries: [
        { pageId: 'a', slug: '', versionId: 'va1' },
        { pageId: 'b', slug: 'gioi-thieu', versionId: 'vb1' },
      ],
      selection: ['a'],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.pages.find((p) => p.id === 'b')?.slug).toBe('gioi-thieu');
  });

  it('slug MỚI lên sóng khi chính trang đó được publish', () => {
    const renamed = [page('b', 've-chung-toi', 'vb2')];
    const result = planReleaseEntries({
      sitePages: renamed,
      liveEntries: [{ pageId: 'b', slug: 'gioi-thieu', versionId: 'vb1' }],
      selection: ['b'],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.pages).toEqual([{ id: 'b', slug: 've-chung-toi', versionId: 'vb2' }]);
  });

  it('trang đã lưu trữ/xoá KHÔNG được release mới hồi sinh', () => {
    const result = planReleaseEntries({
      sitePages: [page('a', '', 'va2')],
      liveEntries: [
        { pageId: 'a', slug: '', versionId: 'va1' },
        { pageId: 'z', slug: 'da-go', versionId: 'vz1' },
      ],
      selection: ['a'],
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.pages.map((p) => p.id)).toEqual(['a']);
  });

  it('site chưa publish lần nào: chỉ có đúng trang được chọn', () => {
    const result = planReleaseEntries({ sitePages, liveEntries: [], selection: ['c'] });
    if (!result.ok) throw new Error(result.error);
    expect(result.pages).toEqual([{ id: 'c', slug: 'tin-tuc', versionId: 'vc2' }]);
  });

  it('id trùng nhau không tạo hai entry cho cùng một trang', () => {
    const result = planReleaseEntries({ sitePages, liveEntries, selection: ['b', 'b'] });
    if (!result.ok) throw new Error(result.error);
    expect(result.pages.filter((p) => p.id === 'b')).toHaveLength(1);
    expect(result.publishedIds).toEqual(['b']);
  });

  it('từ chối id không tồn tại thay vì publish nhầm phần còn lại', () => {
    const result = planReleaseEntries({ sitePages, liveEntries, selection: ['b', 'khong-co'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('khong-co');
  });

  it('từ chối trang chưa có bản nháp', () => {
    const result = planReleaseEntries({
      sitePages: [page('d', 'trong', null)],
      liveEntries: [],
      selection: ['d'],
    });
    expect(result.ok).toBe(false);
  });

  it('từ chối danh sách rỗng thay vì im lặng publish cả site', () => {
    // `[]` mà rơi xuống nhánh "không có pageIds" là đúng cái bug mà cả tính năng
    // này sinh ra để chặn: một lần bấm nhầm đẩy mọi bản nháp lên site.
    const result = planReleaseEntries({ sitePages, liveEntries, selection: [] });
    expect(result.ok).toBe(false);
  });
});

describe('mergeTranslationSnapshot', () => {
  it('giữ bản dịch của trang không publish, cả khoá dạng cũ lẫn dạng mới', () => {
    const merged = mergeTranslationSnapshot(
      { 'en:hn1:content': 'Legacy', '@p-khac': true, 'en@p-khac:n1:content': 'Other page' },
      {},
      new Set(['p-cua-toi']),
    );
    expect(merged).toEqual({
      'en:hn1:content': 'Legacy', '@p-khac': true, 'en@p-khac:n1:content': 'Other page',
    });
  });

  it('bản dịch VỪA BỊ XOÁ không sống lại từ ảnh chụp cũ', () => {
    // Chỉ trộn đè (`{...cũ, ...mới}`) sẽ để nguyên khoá này, và trang tiếng Anh
    // hiện lại đúng chuỗi người dùng vừa bỏ — không có lỗi nào báo ra.
    const merged = mergeTranslationSnapshot(
      { '@p1': true, 'en@p1:n1:content': 'Cũ', 'en@p2:n1:content': 'Giữ' },
      freshTranslationSnapshot([], ['p1']),
      new Set(['p1']),
    );
    expect(merged).toEqual({ '@p1': true, 'en@p2:n1:content': 'Giữ' });
  });

  it('bản dịch mới của trang được publish ghi đè bản cũ', () => {
    const merged = mergeTranslationSnapshot(
      { '@p1': true, 'en@p1:n1:content': 'Cũ' },
      freshTranslationSnapshot([{ pageId: 'p1', locale: 'en', nodeId: 'n1', field: 'content', value: 'Mới' }], ['p1']),
      new Set(['p1']),
    );
    expect(merged).toEqual({ '@p1': true, 'en@p1:n1:content': 'Mới' });
  });

  it('hai trang trùng id node KHÔNG đè nhau (17/11/2026: /maicash vs /maigreen)', () => {
    const fresh = freshTranslationSnapshot(
      [
        { pageId: 'maicash', locale: 'en', nodeId: 'n0000130', field: 'content', value: 'Questions?' },
        { pageId: 'maigreen', locale: 'en', nodeId: 'n0000130', field: 'content', value: '8.5% per year' },
        { pageId: 'maicash', locale: 'en', nodeId: '$meta', field: 'title', value: 'MaiCash+' },
        { pageId: 'maigreen', locale: 'en', nodeId: '$meta', field: 'title', value: 'MaiGreen' },
      ],
      ['maicash', 'maigreen'],
    );
    expect(fresh['en@maicash:n0000130:content']).toBe('Questions?');
    expect(fresh['en@maigreen:n0000130:content']).toBe('8.5% per year');
    expect(fresh['en@maicash:$meta:title']).toBe('MaiCash+');
    expect(fresh['en@maigreen:$meta:title']).toBe('MaiGreen');
  });

  it('ảnh chụp cũ vắng mặt thì kết quả đúng bằng bản mới', () => {
    const fresh = freshTranslationSnapshot([{ pageId: 'p1', locale: 'en', nodeId: 'n1', field: 'content', value: 'Mới' }], ['p1']);
    expect(mergeTranslationSnapshot(null, fresh, new Set(['p1']))).toEqual(fresh);
  });
});

describe('freshTranslationSnapshot', () => {
  it('đặt cờ cho MỌI trang được publish, kể cả trang không có bản dịch', () => {
    expect(freshTranslationSnapshot([], ['a', 'b'])).toEqual({ '@a': true, '@b': true });
  });
});

describe('nodeIdsOf', () => {
  it('gom id từ nhiều doc', () => {
    expect(nodeIdsOf([{ nodes: { a: {}, b: {} } }, { nodes: { b: {}, c: {} } }])).toEqual(
      new Set(['a', 'b', 'c']),
    );
  });

  it('doc hỏng hoặc rỗng không làm ngã cả lần publish', () => {
    expect(nodeIdsOf([null, undefined, {}, { nodes: null }])).toEqual(new Set());
  });
});
