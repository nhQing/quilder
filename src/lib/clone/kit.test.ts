import { describe, expect, it } from 'vitest';

import { BREAKPOINT_PX } from '@/lib/design/breakpoints';
import { CURRENT_SCHEMA_VERSION } from '@/lib/doc/types';
import { buildCloneKit, CLONE_VIEWPORTS, compareSource, extractorSource } from './kit';
import { CLONE_KIT_VERSION } from './types';

describe('buildCloneKit', () => {
  const kit = buildCloneKit(
    [
      { name: 'color-accent', value: '#ff4d2e' },
      { name: 'space-l', value: 'clamp(16px, 2vw, 32px)' },
      { name: 'bad name', value: '1px' },
      { name: 'evil', value: 'red; } body { display: none' },
      { name: 'evil2', value: '</style><script>x</script>' },
    ],
    10 * 1024 * 1024,
  );

  it('mang phiên bản của kit và của schema', () => {
    expect(kit.kitVersion).toBe(CLONE_KIT_VERSION);
    expect(kit.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('chỉ giữ token an toàn — không ghép bừa giá trị phá khối CSS', () => {
    expect(kit.tokenNames).toEqual(['color-accent', 'space-l']);
    expect(kit.tokensCss).toBe(':root{--color-accent:#ff4d2e;--space-l:clamp(16px, 2vw, 32px)}');
  });

  it('khổ đo đọc từ breakpoint của builder, không chép số', () => {
    expect(CLONE_VIEWPORTS.map((v) => v.layer)).toEqual(['base', 'sm', 'md', 'lg', 'xl']);
    expect(CLONE_VIEWPORTS.find((v) => v.layer === 'sm')?.width).toBe(BREAKPOINT_PX.sm);
    expect(CLONE_VIEWPORTS.find((v) => v.layer === 'xl')?.width).toBe(BREAKPOINT_PX.xl);
    expect(kit.viewports).toBe(CLONE_VIEWPORTS);
  });

  it('mã gửi đi là chuỗi hợp lệ, tự đủ', () => {
    expect(() => new Function(kit.extractorSource)).not.toThrow();
    expect(() => new Function(`return ${kit.compareSource}`)).not.toThrow();
    expect(extractorSource()).toContain('__mmClone');
    expect(compareSource()).toContain('compareMeasurements');
  });

  it('trần asset đi theo kho ảnh', () => {
    expect(kit.maxAssetBytes).toBe(10 * 1024 * 1024);
  });
});
