import { describe, expect, it } from 'vitest';

import { COMPOSITE_DESCRIPTIONS, IMPLEMENTED, parseCompositeParams } from './registry';
import type { FormParams } from './registry';

/**
 * Params của composite `Form`.
 *
 * Ba tính chất chịu lực, và cả ba là hợp đồng với người dùng chứ không chi tiết
 * cài đặt:
 *
 *  1. **`.catch()` không được để một hàng JSONB hỏng làm section biến mất.** Cùng
 *     luật như `savingsParams`: `parse` mà ném thì renderer đứt giữa cây node và
 *     cả trang trắng.
 *  2. **`endpointKey` là KHOÁ, không phải URL.** Nếu params nhận URL tự do thì
 *     builder thành công cụ gửi dữ liệu khách tới bất kỳ đâu.
 *  3. **Tên trường không được lặp**, vì BE sẽ chỉ nhận được một giá trị và không
 *     có gì báo.
 */

const parse = (raw: unknown) => parseCompositeParams('Form', raw) as FormParams;

describe('formParams — mặc định và .catch()', () => {
  it('params rỗng cho ra một form email dùng được ngay', () => {
    const p = parse({});
    expect(p.fields).toHaveLength(1);
    expect(p.fields[0]!.kind).toBe('email');
    expect(p.fields[0]!.required).toBe(true);
    expect(p.submitLabel).toBeTruthy();
  });

  it('params rác rơi về mặc định, KHÔNG ném', () => {
    // Một hàng JSONB ghi trước khi schema tồn tại không đáng làm trắng cả trang.
    expect(() => parse({ fields: 'không phải mảng' })).not.toThrow();
    expect(parse({ fields: 'không phải mảng' }).fields).toHaveLength(1);
    expect(() => parse(null)).not.toThrow();
  });

  it('giữ nguyên field hợp lệ, và điền `required` mặc định', () => {
    const p = parse({
      fields: [
        { name: 'ho_ten', kind: 'text', label: 'Họ tên' },
        { name: 'email', kind: 'email', label: 'Email', required: true },
      ],
    });
    expect(p.fields).toHaveLength(2);
    expect(p.fields[0]!.required).toBe(false);
    expect(p.fields[1]!.required).toBe(true);
  });
});

describe('formParams — luật chặn', () => {
  it('endpointKey là slug, không nhận URL', () => {
    // Đây là phép chặn có giá trị nhất trong file: params là thứ content editor
    // và AI ghi được, nên một URL tự do ở đó là một lỗ dữ liệu, không phải một
    // lỗi gõ sai.
    expect(parse({ endpointKey: 'https://evil.example/collect' }).endpointKey).toBe('newsletter');
    expect(parse({ endpointKey: 'newsletter' }).endpointKey).toBe('newsletter');
    expect(parse({ endpointKey: 'lien-he' }).endpointKey).toBe('lien-he');
  });

  it('tên trường lặp bị từ chối', () => {
    const p = parse({
      fields: [
        { name: 'email', kind: 'email', label: 'A' },
        { name: 'email', kind: 'text', label: 'B' },
      ],
    });
    // Rơi về mặc định (một field email), không giữ cặp trùng.
    expect(p.fields).toHaveLength(1);
    expect(p.fields[0]!.label).toBe('Email của bạn');
  });

  it('select không có options bị từ chối — một menu rỗng là ô không dùng được', () => {
    const p = parse({ fields: [{ name: 'chu_de', kind: 'select', label: 'Chủ đề' }] });
    expect(p.fields[0]!.kind).toBe('email');
  });

  it('select CÓ options thì qua', () => {
    const p = parse({
      fields: [
        {
          name: 'chu_de',
          kind: 'select',
          label: 'Chủ đề',
          options: [{ value: 'quy', label: 'Quỹ mở' }],
        },
      ],
    });
    expect(p.fields[0]!.kind).toBe('select');
    expect(p.fields[0]!.options).toHaveLength(1);
  });

  it('tên trường sai bộ ký tự bị từ chối', () => {
    expect(parse({ fields: [{ name: 'Họ-Tên', kind: 'text', label: 'x' }] }).fields[0]!.name)
      .toBe('email');
  });

  it('trần 12 field', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      name: `f${i}`, kind: 'text' as const, label: `F${i}`,
    }));
    expect(parse({ fields: many }).fields).toHaveLength(1);
  });
});

describe('Form trong registry', () => {
  it('đã khai là có runtime', () => {
    expect(IMPLEMENTED.has('Form')).toBe(true);
  });

  it('mô tả cho AI nói rõ endpointKey là khoá, không phải URL', () => {
    // `get_design_system` phát chuỗi này ra; nếu nó không nói thì agent sẽ đoán,
    // và đoán ở đây nghĩa là nhét một URL vào params.
    const about = COMPOSITE_DESCRIPTIONS.Form;
    expect(about).toContain('endpointKey');
    expect(about).toMatch(/KHOÁ|khoá/);
    expect(about).toContain('slots');
  });
});
