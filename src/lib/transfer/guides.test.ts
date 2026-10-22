import { describe, expect, it } from 'vitest';

import { GUIDES, issue, renderGuide, type TransferCode } from './guides';

const ALL: TransferCode[] = [
  'asset-row-missing', 'asset-file-missing', 'storage-unreachable', 'component-missing',
  'doc-invalid', 'too-large', 'interrupted', 'file-over-import-limit', 'entries-not-included',
  'proxy-too-large', 'file-too-large', 'builder-too-old', 'file-corrupt', 'target-changed',
  'target-fixture', 'network', 'collection-type-missing', 'target-shape-mismatch', 'file-rejected',
  'endpoint-missing', 'locale-missing', 'locale-disabled', 'embed-origin-missing',
  'collection-missing', 'component-differs', 'collection-field-missing', 'publish',
];

describe('hướng dẫn từng bước', () => {
  it('mã nào phát ra được thì có hướng dẫn, và hướng dẫn có ít nhất một bước', () => {
    for (const code of ALL) {
      const g = GUIDES[code];
      expect(g, code).toBeDefined();
      expect(g.title.length, code).toBeGreaterThan(3);
      expect(g.steps.length, code).toBeGreaterThan(0);
    }
    expect(Object.keys(GUIDES).sort()).toEqual([...ALL].sort());
  });

  it('nhãn X/W/G/C khớp spec', () => {
    expect(GUIDES['asset-row-missing'].tag).toBe('X1');
    expect(GUIDES['interrupted'].tag).toBe('X7');
    expect(GUIDES['proxy-too-large'].tag).toBe('G1');
    expect(GUIDES['target-shape-mismatch'].tag).toBe('G9');
    expect(GUIDES['endpoint-missing'].tag).toBe('C1');
    expect(GUIDES['publish'].tag).toBe('C6');
  });

  it('thay biến trong bước; biến thiếu giữ nguyên dấu ngoặc để thấy ngay', () => {
    const g = renderGuide(issue('endpoint-missing', 'todo', { vars: { key: 'subscribe', form: 'Đăng ký' } }));
    expect(g.steps.join(' ')).toContain('subscribe');
    expect(g.steps.join(' ')).toContain('Đăng ký');
    const raw = renderGuide(issue('endpoint-missing', 'todo'));
    expect(raw.steps.join(' ')).toContain('{key}');
  });

  it('G1 hướng dẫn đúng dòng cấu hình Nginx và Caddy', () => {
    const s = GUIDES['proxy-too-large'].steps.join('\n');
    expect(s).toContain('client_max_body_size 12m;');
    expect(s).toContain('request_body');
  });
});
