import { describe, expect, it } from 'vitest';

import { parseCompositeParams } from '@/lib/composites/registry';
import {
  checkEndpointTable,
  ENDPOINT_KEY_RE,
  insecureEndpoint,
  readEndpointTable,
  suggestEndpointKey,
} from './endpoint-table';
import { endpointFormsIn } from './endpoint-usage';
import type { Node } from './types';
import { siteEndpoint } from './site-bindings';

const composite = (id: string, composite: string, params: Record<string, unknown> = {}) => ({
  id, type: 'Composite', composite, params, slots: {}, parentId: null, children: [], effects: [], style: { base: {} },
});

describe('readEndpointTable', () => {
  it('lấy bảng con, bỏ giá trị không phải chuỗi', () => {
    expect(readEndpointTable({ endpoint: { subscribe: 'https://a.vn/s', bad: 3 }, hotline: '1900' })).toEqual({
      subscribe: 'https://a.vn/s',
    });
  });

  it('không có / sai kiểu → bảng rỗng', () => {
    expect(readEndpointTable({})).toEqual({});
    expect(readEndpointTable({ endpoint: 'https://a.vn' })).toEqual({});
    expect(readEndpointTable({ endpoint: ['x'] })).toEqual({});
  });
});

describe('checkEndpointTable', () => {
  it('bảng đúng → không lỗi', () => {
    expect(checkEndpointTable({ subscribe: 'https://admin-api.example.com/v1/core-service/subscribe' })).toBeNull();
    expect(checkEndpointTable({})).toBeNull();
  });

  it.each([
    [{ Subscribe: 'https://a.vn' }, /không hợp lệ/],
    [{ '1x': 'https://a.vn' }, /không hợp lệ/],
    [{ subscribe: '' }, /chưa có URL/],
    [{ subscribe: 'javascript:alert(1)' }, /https:\/\//],
    [{ subscribe: 'ftp://a.vn' }, /https:\/\//],
    [{ subscribe: 'https://' }, /không hợp lệ/],
  ])('%o bị từ chối', (table, msg) => {
    expect(checkEndpointTable(table as Record<string, string>)).toMatch(msg);
  });

  it('URL lưu được thì render cũng nhận (cùng luật với siteEndpoint)', () => {
    const table = { subscribe: 'http://localhost:4000/s' };
    expect(checkEndpointTable(table)).toBeNull();
    expect(siteEndpoint({ endpoint: table }, 'subscribe')).toBe(table.subscribe);
  });

  it('luật khoá trùng với registry: khoá lưu được thì Form nhận được', () => {
    // Schema của Form `.catch` về mặc định khi khoá sai, nên "nhận được" = giữ đúng khoá.
    const formKey = (key: string) =>
      (parseCompositeParams('Form', { endpointKey: key }) as { endpointKey: string }).endpointKey;
    for (const key of ['newsletter', 'lien-he', 'a', 'x'.repeat(40)]) {
      expect(ENDPOINT_KEY_RE.test(key)).toBe(true);
      expect(formKey(key)).toBe(key);
    }
    for (const key of ['Lien', 'lien_he', '9a', 'x'.repeat(41)]) {
      expect(ENDPOINT_KEY_RE.test(key)).toBe(false);
      expect(formKey(key)).not.toBe(key);
    }
  });
});

describe('suggestEndpointKey', () => {
  it('slug từ tên tiếng Việt, hợp luật khoá', () => {
    const key = suggestEndpointKey('Form danh sách chờ — Đăng ký', new Set());
    expect(key).toBe('form-danh-sach-cho-dang-ky');
    expect(ENDPOINT_KEY_RE.test(key)).toBe(true);
  });

  it('tên lớp CSS / tên bắt đầu bằng số vẫn ra khoá hợp lệ', () => {
    expect(suggestEndpointKey('s8-modal__form', new Set())).toBe('s8-modal-form');
    expect(suggestEndpointKey('2024 khảo sát', new Set())).toBe('khao-sat');
    expect(suggestEndpointKey('!!!', new Set())).toBe('form');
  });

  it('trùng thì đánh số', () => {
    expect(suggestEndpointKey('Footer', new Set(['footer', 'footer-2']))).toBe('footer-3');
  });

  it('tên rất dài vẫn trong 40 ký tự kể cả hậu tố số', () => {
    const long = 'Form đăng ký nhận bản tin hằng tuần của Mai Money cho khách hàng mới';
    const key = suggestEndpointKey(long, new Set([suggestEndpointKey(long, new Set())]));
    expect(key.length).toBeLessThanOrEqual(40);
    expect(ENDPOINT_KEY_RE.test(key)).toBe(true);
  });
});

describe('insecureEndpoint', () => {
  it('http tới máy khác bị cảnh báo, localhost và https thì không', () => {
    expect(insecureEndpoint('http://api.example.com/s')).toBe(true);
    expect(insecureEndpoint('http://localhost:4000/s')).toBe(false);
    expect(insecureEndpoint('https://api.example.com/s')).toBe(false);
  });
});

describe('endpointFormsIn', () => {
  const tree = (nodes: Record<string, unknown>) => ({ nodes }) as unknown as { nodes: Record<string, Node> };
  const keys = (t: ReturnType<typeof tree>) => endpointFormsIn(t).map((f) => [f.nodeId, f.key]);

  it('mọi Form và NavChart kèm khoá, áp mặc định của registry', () => {
    const t = tree({
      f1: composite('f1', 'Form', { endpointKey: 'subscribe' }),
      f2: composite('f2', 'Form', { endpointKey: 'subscribe' }),
      f3: composite('f3', 'Form'), // mặc định newsletter
      n1: composite('n1', 'NavChart'), // mặc định nav
      a1: composite('a1', 'Accordion'),
    });
    expect(keys(t)).toEqual([['f1', 'subscribe'], ['f2', 'subscribe'], ['f3', 'newsletter'], ['n1', 'nav']]);
  });

  it('params hỏng → khoá renderer thật sự dùng (mặc định), không theo khoá thô', () => {
    // `fields: []` vi phạm min(1) → schema `.catch` về FORM_DEFAULTS → form gửi tới `newsletter`.
    const t = tree({ f1: composite('f1', 'Form', { endpointKey: 'lien-he', fields: [] }) });
    expect(keys(t)).toEqual([['f1', 'newsletter']]);
  });

  it('nhãn: tên node → chữ tiêu đề (slot heading) → tên loại', () => {
    const t = tree({
      named: { ...composite('named', 'Form'), name: 'Form đăng ký footer' },
      titled: { ...composite('titled', 'Form'), slots: { heading: ['h'] } },
      h: { id: 'h', type: 'Text', tag: 'h3', content: [{ t: 'text', v: 'Nhận tin mới' }], children: [], effects: [], style: { base: {} } },
      bare: composite('bare', 'NavChart'),
    });
    expect(Object.fromEntries(endpointFormsIn(t).map((f) => [f.nodeId, f.label]))).toEqual({
      named: 'Form đăng ký footer',
      titled: 'Nhận tin mới',
      bare: 'Biểu đồ NAV',
    });
  });

  it('giữ params THÔ để đường đổi khoá ghi lại nguyên phần còn lại', () => {
    const raw = { endpointKey: 'a', submitLabel: 'Gửi' };
    expect(endpointFormsIn(tree({ f: composite('f', 'Form', raw) }))[0]?.params).toEqual(raw);
  });
});
