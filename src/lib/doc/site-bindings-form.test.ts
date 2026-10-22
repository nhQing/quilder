import { describe, expect, it } from 'vitest';

import { ENDPOINT_KEY, findSiteBindings } from './site-bindings';

/**
 * `Form` và `NavChart` giữ một khoá `globals` mà KHÔNG qua `bind`.
 *
 * Xoá khoá `endpoint` ở màn Cài đặt là gỡ đích gửi của mọi form trên site.
 * Không đếm nó thì màn đó báo "khoá này không được dùng ở đâu" cho một khoá đang
 * giữ một form sống — cùng loại câu trả lời sai mà `findSiteBindings` tồn tại để
 * ngăn với số giấy phép.
 */

const formNode = (id: string, endpointKey = 'newsletter') => ({
  id,
  type: 'Composite',
  composite: 'Form',
  params: { endpointKey },
  slots: {},
  parentId: null,
  children: [],
  effects: [],
  style: { base: {} },
});

describe('findSiteBindings — endpoint của Form', () => {
  it('đếm node Form dưới khoá formEndpoint', () => {
    const usage = findSiteBindings({ nodes: { f1: formNode('f1') } });
    expect(usage.get(ENDPOINT_KEY)).toEqual(['f1']);
  });

  it('hai form trên cùng trang thành hai nodeId, không trùng', () => {
    const usage = findSiteBindings({
      nodes: { f1: formNode('f1'), f2: formNode('f2', 'lien-he') },
    });
    expect(usage.get(ENDPOINT_KEY)).toEqual(['f1', 'f2']);
  });

  it('composite KHÁC không bị tính', () => {
    const usage = findSiteBindings({
      nodes: {
        s1: { ...formNode('s1'), composite: 'Accordion' },
      },
    });
    expect(usage.has(ENDPOINT_KEY)).toBe(false);
  });

  it('vẫn thấy `bind` nằm trong cùng node — không `return` sớm', () => {
    // Node Form có thể mang binding ở chỗ khác; bỏ qua chúng là bỏ sót thật.
    const usage = findSiteBindings({
      nodes: {
        f1: {
          ...formNode('f1'),
          a11y: { label: 'x' },
          params: {
            endpointKey: 'newsletter',
            note: [{ t: 'bind', ref: { source: 'site', path: 'phone' }, fallback: '1900' }],
          },
        },
      },
    });
    expect(usage.get(ENDPOINT_KEY)).toEqual(['f1']);
    expect(usage.get('phone')).toEqual(['f1']);
  });
});
