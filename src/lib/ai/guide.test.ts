import { describe, expect, it } from 'vitest';

import { fullInstructions, GUIDE_VERSION, guide, INSTRUCTIONS, promptList, renderPrompt } from './guide';

describe('INSTRUCTIONS', () => {
  it('có mục KHI CLONE với các luật cứng', () => {
    expect(INSTRUCTIONS).toContain('KHI CLONE MỘT TRANG WEB');
    expect(INSTRUCTIONS).toMatch(/folder/);
    expect(INSTRUCTIONS).toMatch(/HỎI chủ site/);
    expect(INSTRUCTIONS).toMatch(/noindex/);
    expect(INSTRUCTIONS).toMatch(/compare_with_url/);
    expect(INSTRUCTIONS).toMatch(/CustomCode/);
  });

  it('có mục LINK TỪ BUILDER: gọi open_builder_link trước, không hỏi vị trí', () => {
    expect(INSTRUCTIONS).toContain('LINK TỪ BUILDER');
    expect(INSTRUCTIONS).toMatch(/open_builder_link/);
    expect(INSTRUCTIONS).toMatch(/Đừng hỏi người dùng element nằm ở đâu/);
    expect(INSTRUCTIONS).toMatch(/ĐỔI MỌI TRANG/);
  });

  it('vẫn giữ ranh giới "không có tool publish"', () => {
    expect(INSTRUCTIONS).toContain('Không có tool publish');
  });
});

describe('prompt clone_website', () => {
  it('nằm trong danh sách và khai url + slug là bắt buộc', () => {
    const p = promptList().find((x) => x.name === 'clone_website');
    expect(p).toBeDefined();
    const required = p!.arguments.filter((a) => a.required).map((a) => a.name);
    expect(required).toEqual(['url', 'slug']);
    expect(JSON.stringify(promptList())).not.toContain('render');
  });

  it('thiếu tham số bắt buộc thì lỗi nói rõ thiếu gì', () => {
    const r = renderPrompt('clone_website', { url: 'https://a.test' });
    expect(r).toEqual({ ok: false, error: 'Thiếu tham số bắt buộc: slug' });
  });

  it('tên lạ thì lỗi', () => {
    expect(renderPrompt('khong-co', {}).ok).toBe(false);
  });

  it('mang đủ luật của quy trình clone', () => {
    const r = renderPrompt('clone_website', { url: 'https://a.test', slug: 'clone-a', title: 'A' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.text;
    expect(t).toContain('https://a.test');
    expect(t).toContain('/clone-a');
    // Nguồn chuẩn là trang thật đo bằng trình duyệt; không dựng tay.
    expect(t).toMatch(/trang THẬT/);
    expect(t).toMatch(/KHÔNG dựng tay/);
    // Giá trị thật, không ép token gần nhất.
    expect(t).toMatch(/không ép về token/i);
    // Hành vi chưa có → báo, không giả bằng CustomCode.
    expect(t).toMatch(/CustomCode/);
    // Header/footer thành component.
    expect(t).toMatch(/HEADER và FOOTER/);
    expect(t).toMatch(/Instance/);
    // Kiểm bằng compare_with_url ở hai khổ; không publish.
    expect(t).toMatch(/compare_with_url/);
    expect(t).toMatch(/1440/);
    expect(t).toMatch(/390/);
    expect(t).toMatch(/Không publish/);
  });

  it('chưa có folder thì prompt bắt HỎI chủ site, không tự đặt', () => {
    const r = renderPrompt('clone_website', { url: 'https://a.test', slug: 'x' });
    expect(r.ok && r.text).toMatch(/CHƯA CÓ — hỏi chủ site/);
    const withFolder = renderPrompt('clone_website', { url: 'https://a.test', slug: 'x', folder: 'clone/a' });
    expect(withFolder.ok && withFolder.text).toContain('Thư mục ảnh: clone/a');
  });
});

describe('guide()', () => {
  it('có phiên bản để server.mjs nhận ra hình dạng', () => {
    const g = guide();
    expect(g.guideVersion).toBe(GUIDE_VERSION);
    // Có gói dự án bật thì kèm ghi chú của gói — so với `fullInstructions()`, không với INSTRUCTIONS.
    expect(g.instructions).toBe(fullInstructions());
    expect(g.instructions.startsWith(INSTRUCTIONS)).toBe(true);
    expect(g.prompts.length).toBeGreaterThan(0);
  });
});

describe('fullInstructions — luật riêng của gói dự án', () => {
  it('không có ghi chú: y hệt INSTRUCTIONS', () => {
    expect(fullInstructions('')).toBe(INSTRUCTIONS);
    expect(fullInstructions('  ')).toBe(INSTRUCTIONS);
  });

  it('có ghi chú: nối sau, dưới tiêu đề riêng', () => {
    const out = fullInstructions('Không dựng chức năng giao dịch.');
    expect(out.startsWith(INSTRUCTIONS)).toBe(true);
    expect(out).toContain('LUẬT RIÊNG CỦA DỰ ÁN\nKhông dựng chức năng giao dịch.');
  });
});
