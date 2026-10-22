import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RichDoc } from '@/lib/doc/types';
import type { AssetInfo } from './NodeRenderer';
import { RichDocView, collectDocAssetIds, plainDoc } from './richdoc';

const ASSETS: Record<string, AssetInfo> = {
  ast_7f3: { url: '/media/bao-tri.png', width: 1200, height: 630, mime: 'image/png' },
};

const DOC: RichDoc = [
  {
    b: 'p',
    children: [
      { t: 'text', v: 'Chúng tôi sẽ ' },
      { t: 'strong', children: [{ t: 'text', v: 'bảo trì' }] },
      { t: 'text', v: ' đêm nay. ' },
      { t: 'link', href: 'https://example.vn/tin', children: [{ t: 'text', v: 'Chi tiết' }] },
    ],
  },
  { b: 'h2', children: [{ t: 'text', v: 'Việc gì bị ảnh hưởng' }] },
  { b: 'h3', children: [{ t: 'text', v: 'Nạp rút' }] },
  { b: 'h4', children: [{ t: 'text', v: 'Ghi chú' }] },
  { b: 'ul', items: [{ children: [{ t: 'text', v: 'Nạp tiền' }] }, { children: [{ t: 'text', v: 'Rút tiền' }] }] },
  { b: 'ol', items: [{ children: [{ t: 'text', v: 'Mở app' }] }] },
  { b: 'quote', children: [{ t: 'em', children: [{ t: 'text', v: 'Số dư không đổi.' }] }] },
  { b: 'figure', assetId: 'ast_7f3', alt: 'Lịch bảo trì', caption: [{ t: 'text', v: 'Giờ Việt Nam.' }] },
  { b: 'hr' },
];

const html = (value: RichDoc, assets: Record<string, AssetInfo> = ASSETS) =>
  renderToStaticMarkup(createElement(RichDocView, { value, assets, id: 'd' }));

describe('plainDoc', () => {
  it('ghép chữ của mọi loại khối, kể cả mục danh sách và chú thích ảnh', () => {
    const s = plainDoc(DOC);
    expect(s).toContain('bảo trì');
    expect(s).toContain('Nạp tiền');
    expect(s).toContain('Rút tiền');
    expect(s).toContain('Giờ Việt Nam.');
  });

  it('đếm cả alt của ảnh', () => {
    // Bỏ alt khỏi phép đếm nghĩa là một trần "2000 ký tự" không chặn được một tài
    // liệu ba mươi ảnh, mỗi ảnh một câu alt dài — và alt LÀ chữ đi vào trang.
    expect(plainDoc(DOC)).toContain('Lịch bảo trì');
  });

  it('khối không mang chữ không thêm gì', () => {
    expect(plainDoc([{ b: 'hr' }])).toBe('');
  });

  it('ngăn cách các khối bằng khoảng trắng, không dán liền', () => {
    // Dán liền làm số ký tự đúng nhưng số TỪ sai, và thanh trạng thái của ô soạn
    // đọc chính hàm này.
    const s = plainDoc([
      { b: 'h2', children: [{ t: 'text', v: 'Tiêu đề' }] },
      { b: 'p', children: [{ t: 'text', v: 'Nội dung' }] },
    ]);
    expect(s).toBe('Tiêu đề Nội dung');
  });
});

describe('collectDocAssetIds', () => {
  it('chỉ lấy assetId của figure, và không lấy trùng', () => {
    const ids = collectDocAssetIds([
      { b: 'figure', assetId: 'a1', alt: '' },
      { b: 'figure', assetId: 'a1', alt: '' },
      { b: 'figure', assetId: 'a2', alt: '' },
      { b: 'p', children: [{ t: 'text', v: 'x' }] },
    ]);
    expect(ids).toEqual(['a1', 'a2']);
  });
});

describe('BlockView / RichDocView', () => {
  it('năm loại khối ra đúng thẻ HTML', () => {
    const out = html(DOC);
    expect(out).toContain('<p>');
    expect(out).toContain('<h2>');
    expect(out).toContain('<h3>');
    expect(out).toContain('<h4>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<ol>');
    expect(out).toContain('<li>');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<figure>');
    expect(out).toContain('<figcaption>');
    expect(out).toContain('<hr');
  });

  it('inline đi qua RichTextView đang có, không qua một bộ render thứ hai', () => {
    const out = html(DOC);
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
    // `target="_blank"` là luật của `renderInline` cho link ngoài — nếu nó có mặt
    // thì hàm đó thật đang chạy, và mọi luật tương lai của nó tự áp cho richdoc.
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('ESCAPE chữ của tác giả — không có đường nào cho HTML thô vào trang', () => {
    // Đây là lý do cả `RichDoc` tồn tại thay vì lưu HTML: repo không có thư viện
    // sanitize nào, và an toàn đến từ việc renderer là JSX.
    const out = html([{ b: 'p', children: [{ t: 'text', v: '<script>alert(1)</script>' }] }], {});
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('cả file không có dangerouslySetInnerHTML', () => {
    // Phép kiểm trên nguồn, không trên đầu ra: một chuỗi HTML thêm vào sau này sẽ
    // vượt qua mọi test render mà vẫn mở đúng lỗ hổng này.
    const src = readFileSync(new URL('./richdoc.tsx', import.meta.url), 'utf8');
    // Tìm cách DÙNG nó, không tìm tên nó: docblock của chính file có nhắc tên
    // để giải thích vì sao không dùng, và một phép kiểm bắt cả câu giải thích là
    // một phép kiểm dạy người ta xoá lời giải thích.
    expect(src).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });

  it('figure lấy URL từ bảng assets được truyền vào, không tự truy vấn', () => {
    const out = html([{ b: 'figure', assetId: 'ast_7f3', alt: 'Lịch' }]);
    expect(out).toContain('src="/media/bao-tri.png"');
    expect(out).toContain('alt="Lịch"');
    expect(out).toContain('width="1200"');
  });

  it('asset đã bị xoá thì hiện CHỮ nói ảnh mất, không im lặng biến mất', () => {
    // Trang công khai trả `null` là đúng (xem `ImageNode`). Đây là màn xem trước
    // của người biên tập, và thứ họ cần biết chính là "ảnh này mất".
    const out = html([{ b: 'figure', assetId: 'da_xoa', alt: 'x' }], {});
    expect(out).toContain('da_xoa');
    expect(out).toContain('<figure>');
  });

  it('ảnh trang trí: alt rỗng và aria-hidden', () => {
    const out = html([{ b: 'figure', assetId: 'ast_7f3', alt: 'bỏ qua', decorative: true }]);
    expect(out).toContain('alt=""');
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain('bỏ qua');
  });

  it('chú thích vắng mặt hoặc rỗng thì KHÔNG có figcaption', () => {
    // Một `<figcaption>` rỗng vẫn chiếm chỗ trong bố cục và vẫn được screen reader
    // thông báo là có chú thích.
    expect(html([{ b: 'figure', assetId: 'ast_7f3', alt: 'x' }])).not.toContain('figcaption');
    expect(html([{ b: 'figure', assetId: 'ast_7f3', alt: 'x', caption: [] }])).not.toContain('figcaption');
  });
});
