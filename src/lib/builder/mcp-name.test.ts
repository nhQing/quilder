import { describe, expect, it } from 'vitest';

import { mcpServerName, sanitizeMcpName } from './mcp-name';

describe('mcpServerName', () => {
  it('lấy theo domain, giữ cổng, gắn tiền tố quilder', () => {
    expect(mcpServerName('http://192.168.1.10:3002')).toBe('quilder-192-168-1-10-3002');
    expect(mcpServerName('http://localhost:3001')).toBe('quilder-localhost-3001');
    expect(mcpServerName('https://builder.abc.com')).toBe('quilder-builder-abc-com');
  });

  it('domain đã có chữ quilder thì không lặp tiền tố, bỏ www', () => {
    expect(mcpServerName('https://builder.quilder.io')).toBe('builder-quilder-io');
    expect(mcpServerName('https://www.quilder.io')).toBe('quilder-io');
  });

  it('hai builder khác domain hoặc khác cổng ra hai tên khác nhau', () => {
    const names = ['http://192.168.1.10:3002', 'http://192.168.1.10:3003', 'https://dev.abc.com', 'https://abc.com'].map(mcpServerName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('chuỗi không phải URL vẫn ra một tên dùng được', () => {
    expect(mcpServerName('')).toBe('quilder');
    expect(mcpServerName('???')).toBe('quilder');
  });
});

describe('sanitizeMcpName', () => {
  it('chỉ giữ chữ thường, số, - và _; bỏ dấu tiếng Việt', () => {
    expect(sanitizeMcpName('Builder Dự Án Đẹp!')).toBe('builder-du-an-dep');
    expect(sanitizeMcpName('  --abc__def--  ')).toBe('abc__def');
    expect(sanitizeMcpName('a/b\\c:d')).toBe('a-b-c-d');
  });

  it('cắt ở 48 ký tự, không để gạch ở cuối', () => {
    const out = sanitizeMcpName('x'.repeat(47) + '-yyyy');
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out.endsWith('-')).toBe(false);
  });
});
