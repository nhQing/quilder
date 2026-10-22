import { describe, expect, it } from 'vitest';

import { endpointOptions, readEndpointKey, withEndpointKey } from './endpoint-options';

const TABLE = {
  subscribe: 'https://admin-api.example.com/v1/core-service/subscribe',
  nav: 'https://stg-api.example.com/nav',
};

describe('endpointOptions', () => {
  it('mọi khoá trong bảng, sắp A→Z, nhãn là khoá — host', () => {
    expect(endpointOptions(TABLE, 'subscribe')).toEqual([
      { key: 'nav', host: 'stg-api.example.com', missing: false, label: 'nav — stg-api.example.com' },
      {
        key: 'subscribe',
        host: 'admin-api.example.com',
        missing: false,
        label: 'subscribe — admin-api.example.com',
      },
    ]);
  });

  it('khoá đang dùng mà bảng chưa có vẫn được bày, đánh dấu thiếu URL, đúng chỗ theo A→Z', () => {
    const opts = endpointOptions(TABLE, 'newsletter');
    expect(opts.map((o) => o.key)).toEqual(['nav', 'newsletter', 'subscribe']);
    expect(opts[1]).toEqual({ key: 'newsletter', host: null, missing: true, label: 'newsletter — chưa có URL' });
  });

  it('khoá đang dùng đã có trong bảng thì không lặp', () => {
    expect(endpointOptions(TABLE, 'nav')).toHaveLength(2);
  });

  it('bảng rỗng → chỉ còn khoá đang dùng, thiếu URL', () => {
    expect(endpointOptions({}, 'newsletter')).toEqual([
      { key: 'newsletter', host: null, missing: true, label: 'newsletter — chưa có URL' },
    ]);
  });

  it('URL không phải http(s) bị coi là thiếu — render cũng từ chối nó', () => {
    const [opt] = endpointOptions({ bad: 'javascript:alert(1)' }, 'bad');
    expect(opt).toMatchObject({ host: null, missing: true, label: 'bad — URL không hợp lệ' });
  });

  it('giữ cổng trong host — localhost:3000 khác localhost:4000', () => {
    const [opt] = endpointOptions({ dev: 'http://localhost:3000/api/x' }, 'dev');
    expect(opt?.label).toBe('dev — localhost:3000');
  });

  it('khoá trùng tên thuộc tính prototype không đọc nhầm prototype', () => {
    const [opt] = endpointOptions({}, 'constructor');
    expect(opt).toMatchObject({ key: 'constructor', missing: true, label: 'constructor — chưa có URL' });
  });
});

describe('readEndpointKey', () => {
  it('không đặt khoá → mặc định của từng composite, như renderer', () => {
    expect(readEndpointKey('Form', undefined)).toEqual({ key: 'newsletter', ignored: false });
    expect(readEndpointKey('Form', {})).toEqual({ key: 'newsletter', ignored: false });
    expect(readEndpointKey('NavChart', {})).toEqual({ key: 'nav', ignored: false });
  });

  it('khoá đã đặt và params hợp lệ → đúng khoá đó', () => {
    expect(readEndpointKey('Form', { endpointKey: 'subscribe' })).toEqual({ key: 'subscribe', ignored: false });
    expect(readEndpointKey('NavChart', { endpointKey: 'nav-stg', defaultRange: '3y' })).toEqual({
      key: 'nav-stg',
      ignored: false,
    });
  });

  it('một tham số khác hỏng → cả params về mặc định, và khoá đã ghi bị báo là không có tác dụng', () => {
    expect(readEndpointKey('Form', { endpointKey: 'subscribe', fields: [] })).toEqual({
      key: 'newsletter',
      ignored: true,
    });
    expect(readEndpointKey('Form', { endpointKey: 'Sai Khoa' })).toEqual({ key: 'newsletter', ignored: true });
  });

  it('composite không dùng bảng endpoint → null, kể cả khi params lỡ mang khoá', () => {
    expect(readEndpointKey('Accordion', {})).toBeNull();
    expect(readEndpointKey('Accordion', { endpointKey: 'x' })).toBeNull();
    expect(readEndpointKey('KhongCo', {})).toBeNull();
  });
});

describe('withEndpointKey', () => {
  it('giữ nguyên mọi tham số khác — setProps thay cả params, không gộp', () => {
    const raw = { endpointKey: 'newsletter', submitLabel: 'Gửi', fields: [{ name: 'email' }] };
    expect(withEndpointKey(raw, 'subscribe')).toEqual({
      endpointKey: 'subscribe',
      submitLabel: 'Gửi',
      fields: [{ name: 'email' }],
    });
    // Không sửa object gốc: nó là node trong doc của store.
    expect(raw.endpointKey).toBe('newsletter');
  });

  it('params không phải object → chỉ còn khoá', () => {
    expect(withEndpointKey(undefined, 'a')).toEqual({ endpointKey: 'a' });
    expect(withEndpointKey(null, 'a')).toEqual({ endpointKey: 'a' });
    expect(withEndpointKey(['x'], 'a')).toEqual({ endpointKey: 'a' });
    expect(withEndpointKey('x', 'a')).toEqual({ endpointKey: 'a' });
  });
});
