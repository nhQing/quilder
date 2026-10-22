import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AssetPickerBox } from './AssetPickerBox';

/**
 * Ô đã biết sẵn file (màn Cài đặt: favicon, ảnh chia sẻ, logo builder) phải vẽ ẢNH.
 *
 * Bản cũ nhận `knownUrl` mà không bắt kèm mime/key, và màn Cài đặt chỉ truyền url —
 * nên `assetKind('', '')` ra hạng `file`, ô vẽ một tờ giấy xám không nhãn thay cho
 * favicon đang hiện đúng trên tab trình duyệt, và dòng tên file dưới khung trống.
 */
describe('AssetPickerBox với file đã biết sẵn', () => {
  const render = (known: { url: string; mime: string; key: string }) =>
    renderToStaticMarkup(<AssetPickerBox value="a1" onPick={() => {}} known={known} />);

  it('PNG: vẽ <img> và in tên file', () => {
    const html = render({ url: '/uploads/favicon-9f3a.png', mime: 'image/png', key: 'public/builder/favicon-9f3a.png' });
    expect(html).toContain('<img');
    expect(html).toContain('src="/uploads/favicon-9f3a.png"');
    expect(html).toContain('favicon');
  });

  it('SVG: cũng là ảnh, không phải tờ giấy', () => {
    const html = render({ url: '/uploads/logo.svg', mime: 'image/svg+xml', key: 'public/builder/logo.svg' });
    expect(html).toContain('<img');
  });

  // Chốt 13/10/2026: thấy TRỌN ảnh, không cắt — logo, favicon hay ảnh chia sẻ đều
  // phải nhìn được mép để biết mình chọn đúng file.
  it('ảnh vừa khung (contain), không bị cắt mép', () => {
    const html = render({ url: '/uploads/share.png', mime: 'image/png', key: 'public/builder/share.png' });
    expect(html).toMatch(/<img[^>]*class="[^"]*object-contain/);
    expect(html).not.toMatch(/<img[^>]*class="[^"]*object-cover/);
  });
});
