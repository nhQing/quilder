import { describe, expect, it } from 'vitest';

import { pageMarkerKey, snapshotKey } from '@/lib/render/translations';
import { translationHighlightCss } from '@/lib/render/translation-highlight';
import { changedTranslationUnits, countComponentDrift, countTranslationDrift } from './pending-extra';

const nodes = new Set(['hero', 'i-header']);

describe('countTranslationDrift', () => {
  const snap = {
    [pageMarkerKey('p1')]: true,
    [snapshotKey('en', 'hero', 'content', 'p1')]: [{ t: 'text', v: 'Hello' }],
    [snapshotKey('en', '$meta', 'title', 'p1')]: 'Home',
  };

  it('bản nháp trùng bản đang chạy → 0', () => {
    const rows = [
      { locale: 'en', nodeId: 'hero', field: 'content', value: [{ t: 'text', v: 'Hello' }] },
      { locale: 'en', nodeId: '$meta', field: 'title', value: 'Home' },
    ];
    expect(countTranslationDrift(rows, snap, 'p1', ['en'], nodes)).toBe(0);
  });

  it('đếm bản dịch mới, đã sửa và đã xoá', () => {
    const rows = [
      { locale: 'en', nodeId: 'hero', field: 'content', value: [{ t: 'text', v: 'Hi' }] }, // sửa
      { locale: 'en', nodeId: 'i-header/n1', field: 'label', value: 'News' }, // mới
      // `$meta:title` vắng → đã xoá
    ];
    expect(countTranslationDrift(rows, snap, 'p1', ['en'], nodes)).toBe(3);
  });

  it('release cũ: không đếm bản dịch của trang KHÁC là "đã xoá"', () => {
    const legacy = {
      [snapshotKey('en', 'hn0000001', 'content')]: 'Other page',
      [snapshotKey('en', 'hero', 'content')]: 'Hello',
    };
    const rows = [{ locale: 'en', nodeId: 'hero', field: 'content', value: 'Hello' }];
    expect(countTranslationDrift(rows, legacy, 'p1', ['en'], nodes)).toBe(0);
  });

  it('bản dịch của node đã xoá khỏi trang không bị đếm (Publish không đưa nó lên)', () => {
    const rows = [
      { locale: 'en', nodeId: 'hero', field: 'content', value: [{ t: 'text', v: 'Hello' }] },
      { locale: 'en', nodeId: '$meta', field: 'title', value: 'Home' },
      { locale: 'en', nodeId: 'gone-note', field: 'content', value: [{ t: 'text', v: 'Old' }] },
      { locale: 'en', nodeId: 'gone-inst/x', field: 'label', value: 'Old' },
    ];
    expect(countTranslationDrift(rows, snap, 'p1', ['en'], nodes)).toBe(0);
  });

  it('trang chưa từng có bản dịch, giờ có → đếm đủ', () => {
    const rows = [{ locale: 'en', nodeId: 'hero', field: 'content', value: 'Hello' }];
    expect(countTranslationDrift(rows, null, 'p1', ['en'], nodes)).toBe(1);
  });
});

describe('countComponentDrift', () => {
  it('chỉ đếm component có cây khác ảnh chụp', () => {
    const sealed = { a: { rootId: 'r', nodes: { r: {} } }, b: { rootId: 'r', nodes: {} } };
    expect(
      countComponentDrift(
        [
          { id: 'a', tree: { rootId: 'r', nodes: { r: {} } } },
          { id: 'b', tree: { rootId: 'r', nodes: { x: {} } } },
          { id: 'c', tree: { rootId: 'r', nodes: {} } }, // chưa từng được chụp
        ],
        sealed,
      ),
    ).toBe(2);
  });
});

describe('changedTranslationUnits + translationHighlightCss', () => {
  const snap = {
    [pageMarkerKey('p1')]: true,
    [snapshotKey('en', 'hero', 'content', 'p1')]: [{ t: 'text', v: 'Hello' }],
  };
  const rows = [
    { locale: 'en', nodeId: 'hero', field: 'content', value: [{ t: 'text', v: 'Hello' }] }, // không đổi
    { locale: 'en', nodeId: 'i-header/nw-lt', field: 'content', value: [{ t: 'text', v: 'News' }] }, // mới
    { locale: 'en', nodeId: 'i-header/nw-ta', field: 'a11yLabel', value: 'News' }, // mới, không hiện ra mắt
    { locale: 'en', nodeId: 'gone', field: 'content', value: 'x' }, // node đã xoá khỏi trang
    { locale: 'fr', nodeId: 'hero', field: 'content', value: 'Salut' }, // ngôn ngữ khác
  ];

  it('chỉ lấy đơn vị mới/sửa của đúng ngôn ngữ và node còn trên trang', () => {
    const units = changedTranslationUnits(rows, snap, 'p1', 'en', nodes);
    expect(units.map((u) => `${u.nodeId}:${u.field}`)).toEqual([
      'i-header/nw-lt:content',
      'i-header/nw-ta:a11yLabel',
    ]);
  });

  it('CSS: node trong instance nhắm data-n + data-cn, bỏ a11yLabel, bỏ id lạ', () => {
    const css = translationHighlightCss([
      { nodeId: 'i-header/nw-lt', field: 'content' },
      { nodeId: 'i-header/nw-ta', field: 'a11yLabel' },
      { nodeId: 'hero', field: 'content' },
      { nodeId: 'x"]{}/y', field: 'content' },
    ]);
    expect(css).toContain('[data-n="i-header"] [data-cn="nw-lt"]');
    expect(css).toContain('[data-n="hero"]');
    expect(css).not.toContain('nw-ta');
    expect(css).not.toContain('x"]');
  });

  it('không có gì để tô → chuỗi rỗng', () => {
    expect(translationHighlightCss([])).toBe('');
  });
});
