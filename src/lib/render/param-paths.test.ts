import { describe, expect, it } from 'vitest';

/**
 * Đường dẫn vào params của Composite.
 *
 * Tính chất chịu lực: chỉ chữ THẬT SỰ có trong params mới thành đơn vị (không có
 * đơn vị ma từ mặc định của schema), và ghi một đường không bao giờ sửa params gốc
 * hay tạo ra một ô chưa từng có.
 */

import {
  applyParamMap, isKnownParamPath, listParamPaths, paramKindLabel, paramMaxLength, setParamPath,
} from './param-paths';

const form = {
  endpointKey: 'newsletter',
  submitLabel: 'Đăng ký',
  fields: [
    { name: 'email', kind: 'email', label: 'Email', placeholder: 'ban@mail.com' },
    { name: 'topic', kind: 'select', label: 'Chủ đề', options: [{ value: 'a', label: 'Đầu tư' }] },
  ],
};

describe('listParamPaths', () => {
  it('chỉ phát chuỗi có thật trong bảng trắng, theo thứ tự bảng', () => {
    expect(listParamPaths('Form', form).map((u) => u.path)).toEqual([
      'submitLabel',
      'fields.0.label',
      'fields.1.label',
      'fields.0.placeholder',
      'fields.1.options.0.label',
    ]);
  });

  it('không phát endpointKey, name, value, kind', () => {
    const paths = listParamPaths('Form', form).map((u) => u.path);
    expect(paths.some((p) => /endpointKey|name|value|kind/.test(p))).toBe(false);
  });

  it('params rỗng không sinh đơn vị ma từ mặc định của schema', () => {
    expect(listParamPaths('Form', {})).toEqual([]);
    expect(listParamPaths('Form', undefined)).toEqual([]);
  });

  it('bỏ chuỗi rỗng và composite không có trong bảng', () => {
    expect(listParamPaths('Form', { submitLabel: '  ' })).toEqual([]);
    expect(listParamPaths('Accordion', { title: 'x' })).toEqual([]);
  });
});

describe('setParamPath / applyParamMap', () => {
  it('thay đúng một chuỗi và KHÔNG sửa params gốc', () => {
    const out = setParamPath(form, 'fields.0.placeholder', 'you@mail.com') as typeof form;
    expect(out.fields[0]!.placeholder).toBe('you@mail.com');
    expect(form.fields[0]!.placeholder).toBe('ban@mail.com');
    // Phần không đụng tới giữ nguyên reference.
    expect(out.fields[1]).toBe(form.fields[1]);
  });

  it('đường không tồn tại thì trả đúng object cũ, không tạo ô mới', () => {
    expect(setParamPath(form, 'fields.5.label', 'x')).toBe(form);
    expect(setParamPath(form, 'fields.0.help', 'x')).toBe(form);
    expect(setParamPath({}, 'submitLabel', 'x')).toEqual({});
  });

  it('bỏ qua đường ngoài bảng trắng và chuỗi vượt trần', () => {
    expect(applyParamMap(form, { endpointKey: 'evil' })).toBe(form);
    expect(applyParamMap(form, { submitLabel: 'x'.repeat(81) })).toBe(form);
    expect((applyParamMap(form, { submitLabel: 'Join' }) as typeof form).submitLabel).toBe('Join');
  });

  it('trần theo đường khớp registry', () => {
    expect(paramMaxLength('submitLabel')).toBe(80);
    expect(paramMaxLength('fields.3.help')).toBe(200);
    expect(paramMaxLength('fields.x.help')).toBeNull();
    expect(isKnownParamPath('fields.2.label')).toBe(true);
    expect(isKnownParamPath('endpointKey')).toBe(false);
  });

  it('nhãn loại đọc được', () => {
    expect(paramKindLabel('index.2.label')).toBe('mục lục 3');
    expect(paramKindLabel('fields.0.placeholder')).toBe('ô 1 · placeholder');
    expect(paramKindLabel('submitLabel')).toBe('nút gửi');
  });
});
