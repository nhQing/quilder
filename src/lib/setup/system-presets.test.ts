import { describe, expect, it } from 'vitest';

import { structuralIssues } from '@/lib/doc/structure';
import { SYSTEM_PRESETS } from './system-presets';

describe('mẫu hệ thống', () => {
  it('cây hợp lệ về cấu trúc — slot là con thật của form (nếu không, mọi op trên bản sao bị 422)', () => {
    for (const p of SYSTEM_PRESETS) expect(structuralIssues(p.tree)).toEqual([]);
  });
});
