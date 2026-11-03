import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `Form.tsx` chạy trên site thật: import GIÁ TRỊ từ `registry.ts` kéo zod, `nav-series` và
 * gói dự án vào bundle của mọi trang có form. Chỉ import KIỂU từ registry được phép (bị
 * xoá lúc biên dịch); hàm cần lúc chạy lấy từ module nhỏ như `form-mode.ts`.
 */
describe('bundle của Form trên site', () => {
  it('Form.tsx không import giá trị nào từ registry', () => {
    const src = readFileSync(join(__dirname, 'Form.tsx'), 'utf8');
    const fromRegistry = [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'[^']*registry';/gms)];
    expect(fromRegistry.length).toBeGreaterThan(0);
    for (const m of fromRegistry) expect(m[1], m[0]).toBeTruthy();
  });

  it('form-mode.ts không import gì', () => {
    const src = readFileSync(join(__dirname, 'form-mode.ts'), 'utf8');
    expect(src).not.toMatch(/^import /m);
  });
});
