import { describe, expect, it } from 'vitest';

import { zBlock, zRichDoc } from './schema';

/** Tài liệu có đủ 5 loại khối, dùng lại làm nền cho các ca từ chối. */
const OK = [
  { b: 'p', children: [{ t: 'text', v: 'Chúng tôi sẽ ' }, { t: 'strong', children: [{ t: 'text', v: 'bảo trì' }] }] },
  { b: 'h2', children: [{ t: 'text', v: 'Việc gì bị ảnh hưởng' }] },
  { b: 'h3', children: [{ t: 'text', v: 'Nạp rút' }] },
  { b: 'h4', children: [{ t: 'text', v: 'Ghi chú' }] },
  { b: 'ul', items: [{ children: [{ t: 'text', v: 'Nạp và rút tạm dừng' }] }] },
  { b: 'ol', items: [{ children: [{ t: 'text', v: 'Mở app' }] }] },
  { b: 'quote', children: [{ t: 'text', v: 'Số dư không đổi.' }] },
  { b: 'figure', assetId: 'ast_7f3', alt: 'Lịch bảo trì', caption: [{ t: 'text', v: 'Giờ Việt Nam.' }] },
  { b: 'hr' },
];

describe('zRichDoc', () => {
  it('nhận tài liệu có đủ năm loại khối', () => {
    expect(zRichDoc.safeParse(OK).success).toBe(true);
  });

  it('KHÔNG nhận hình dạng { type:"doc", content:[] } của Tiptap', () => {
    // Đây là hình dạng mà một lần cắm editor sai sẽ gửi lên, và nó là hình dạng
    // nguy hiểm nhất trong ba: `isBlank` (collections/i18n.ts) đọc "rỗng" bằng
    // `Array.isArray(v) && v.length === 0`, nên một object luôn "không rỗng" —
    // mọi field richdoc sẽ được tính là đã dịch, kể cả `{}`.
    expect(zRichDoc.safeParse({ type: 'doc', content: [] }).success).toBe(false);
    expect(zRichDoc.safeParse({ type: 'doc', content: OK }).success).toBe(false);
  });

  it('từ chối chuỗi HTML', () => {
    expect(zRichDoc.safeParse('<p>xin chào</p>').success).toBe(false);
    expect(zRichDoc.safeParse([{ b: 'p', children: '<b>x</b>' }]).success).toBe(false);
  });

  it('từ chối mảng rỗng — tài liệu trống phải là một khối p rỗng', () => {
    // `[]` chính là giá trị mà `isBlank` đọc là "chưa dịch", nên một thân bài lưu
    // thành `[]` sẽ bị lớp phủ bản dịch bỏ qua thay vì ghi đè.
    expect(zRichDoc.safeParse([]).success).toBe(false);
    expect(zRichDoc.safeParse([{ b: 'p', children: [{ t: 'text', v: '' }] }]).success).toBe(true);
  });

  it('danh sách khối là ĐÓNG: h1, h5, table, div đều bị từ chối', () => {
    for (const b of ['h1', 'h5', 'h6', 'table', 'div', 'section']) {
      expect(zRichDoc.safeParse([{ b, children: [{ t: 'text', v: 'x' }] }]).success).toBe(false);
    }
  });

  it('từ chối khoá lạ trong khối — mọi nhánh .strict()', () => {
    expect(zBlock.safeParse({ b: 'p', children: [], className: 'lead' }).success).toBe(false);
    expect(zBlock.safeParse({ b: 'hr', height: 2 }).success).toBe(false);
    expect(zBlock.safeParse({ b: 'ul', items: [{ children: [], marker: '•' }] }).success).toBe(false);
  });

  it('ul/ol dùng items, không dùng children', () => {
    // `children` phẳng cho cả danh sách nghĩa là ranh giới giữa các mục phải mã hoá
    // bằng `br` — tức mất cấu trúc ngay ở tầng dữ liệu.
    expect(zBlock.safeParse({ b: 'ul', children: [{ t: 'text', v: 'x' }] }).success).toBe(false);
    expect(zBlock.safeParse({ b: 'ul', items: [{ children: [{ t: 'text', v: 'x' }] }] }).success).toBe(true);
  });

  it('chặn href scheme xấu — dùng chung zInline với doc', () => {
    // Không có phép kiểm href RIÊNG nào ở tầng khối: nếu ca này xanh thì `zHref`
    // thật đang chạy, và mọi luật tương lai của nó tự áp cho richdoc.
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(
        zRichDoc.safeParse([{ b: 'p', children: [{ t: 'link', href, children: [{ t: 'text', v: 'x' }] }] }]).success,
      ).toBe(false);
    }
    expect(
      zRichDoc.safeParse([{ b: 'p', children: [{ t: 'link', href: '/tin-tuc', children: [{ t: 'text', v: 'x' }] }] }])
        .success,
    ).toBe(true);
  });

  it('caption và mục danh sách cũng đi qua zInline, không phải một union thứ hai', () => {
    const bad = { t: 'link', href: 'javascript:x', children: [{ t: 'text', v: 'x' }] };
    expect(zBlock.safeParse({ b: 'figure', assetId: 'a1', alt: 'x', caption: [bad] }).success).toBe(false);
    expect(zBlock.safeParse({ b: 'ul', items: [{ children: [bad] }] }).success).toBe(false);
  });

  it('figure phải có assetId — một figure không ảnh là một khối vô hình', () => {
    expect(zBlock.safeParse({ b: 'figure', assetId: '', alt: 'x' }).success).toBe(false);
    expect(zBlock.safeParse({ b: 'figure', alt: 'x' }).success).toBe(false);
    expect(zBlock.safeParse({ b: 'figure', assetId: 'a1', alt: 'x' }).success).toBe(true);
  });

  it('figure nhận alt rỗng ở tầng cú pháp — luật decorative thuộc tầng ngữ nghĩa', () => {
    // Cùng lý do với `ImageNode`: `.refine()` biến nhánh thành ZodEffects và
    // `discriminatedUnion` không nhận ZodEffects làm nhánh.
    expect(zBlock.safeParse({ b: 'figure', assetId: 'a1', alt: '' }).success).toBe(true);
    expect(zBlock.safeParse({ b: 'figure', assetId: 'a1', alt: '', decorative: true }).success).toBe(true);
  });

  it('inline node hiếm vẫn dùng được trong khối — counter, bind, split', () => {
    const doc = [
      { b: 'p', children: [{ t: 'counter', to: 1200, decimals: 0, suffix: '+' }] },
      { b: 'p', children: [{ t: 'bind', ref: { source: 'site', path: 'hotline' }, fallback: '1900' }] },
      { b: 'h2', children: [{ t: 'split', mode: 'words', children: [{ t: 'text', v: 'x' }] }] },
    ];
    expect(zRichDoc.safeParse(doc).success).toBe(true);
  });
});
