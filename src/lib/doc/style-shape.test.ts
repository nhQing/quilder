import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { zStyleProps } from './schema';
import { nearestStylePaths, styleShape } from './style-shape';

/**
 * Hình dạng `style` mà tầng tool công bố.
 *
 * Test này canh cho một sự cố cụ thể không lặp lại. 07/09/2026: một agent cần làm
 * mờ nền phía sau một node, thử `fill.blur`, `backdrop.blur`,
 * `effect.backdropBlur`, `fill.backdropBlur` — tất cả bị từ chối là unrecognized
 * key — rồi kết luận builder THIẾU tính năng và đề xuất xây lại nó. Đường đúng là
 * `effects.backdropBlur`, có từ đầu, và compiler còn phát cả bản `-webkit-`.
 *
 * Nên hai tính chất dưới đây là hợp đồng, không phải chi tiết cài đặt: bảng phải
 * phủ ĐÚNG schema thật (bảng thiếu thì agent vẫn phải đoán), và một khoá gõ sai
 * phải được gợi đúng đường.
 */

const GROUPS = [
  'layout', 'size', 'spacing', 'position', 'typography', 'fill', 'border', 'effects', 'container',
] as const;

describe('styleShape — phủ đúng schema thật', () => {
  it('có đủ mọi nhóm của zStyleProps', () => {
    const { groups } = styleShape();
    for (const g of GROUPS) expect(groups[g], `thiếu nhóm ${g}`).toBeDefined();
  });

  it('field của mỗi nhóm khớp CHÍNH XÁC schema — không thiếu, không bịa', () => {
    // Duyệt schema thật thay vì so với một danh sách viết tay: bảng viết tay sẽ
    // trôi, và bảng trôi nói sai một cách tự tin.
    const shape = (zStyleProps as unknown as z.ZodObject<z.ZodRawShape>).shape;
    const { groups } = styleShape();

    for (const g of GROUPS) {
      let entry = shape[g]!;
      while (entry && !(entry instanceof z.ZodObject)) {
        const inner = (entry as unknown as { unwrap?: () => z.ZodTypeAny }).unwrap?.();
        if (!inner) break;
        entry = inner;
      }
      const real = Object.keys((entry as z.ZodObject<z.ZodRawShape>).shape).sort();
      expect(Object.keys(groups[g]!).sort(), `nhóm ${g}`).toEqual(real);
    }
  });

  it('backdrop blur nằm ở effects, và đủ ba field đi cùng', () => {
    const { groups, paths } = styleShape();
    expect(groups.effects).toHaveProperty('backdropBlur');
    expect(groups.effects).toHaveProperty('backdropSaturate');
    expect(groups.effects).toHaveProperty('backdropFallbackColor');
    expect(paths).toContain('effects.backdropBlur');
    // `effects.blur` là làm mờ CHÍNH node — hai thứ khác nhau, cùng nhóm.
    expect(paths).toContain('effects.blur');
  });

  it('enum được liệt kê giá trị, không chỉ nói "enum"', () => {
    const { groups } = styleShape();
    expect(groups.layout!.display).toContain('"flex"');
    expect(groups.layout!.display).toContain('"none"');
  });

  it('font-weight liệt kê đủ bốn bậc, gồm 600', () => {
    // Bốn bậc phản chiếu bốn token trong tokens.css. 600 thêm 07/09/2026.
    expect(styleShape().groups.typography!.weight).toBe('400 | 500 | 600 | 700');
  });
});

describe('nearestStylePaths — gợi khoá gõ sai', () => {
  it('đúng tên field, SAI NHÓM — ca hay gặp nhất', () => {
    expect(nearestStylePaths('fill.backdropBlur')).toContain('effects.backdropBlur');
    expect(nearestStylePaths('effect.backdropBlur')).toContain('effects.backdropBlur');
  });

  it('sai tên field trong nhóm đúng', () => {
    expect(nearestStylePaths('effects.backdropBlurr')).toContain('effects.backdropBlur');
  });

  it('khoá trần không có nhóm', () => {
    expect(nearestStylePaths('backdropBlur')).toContain('effects.backdropBlur');
  });

  it('không có gì đủ gần thì KHÔNG bịa', () => {
    // Một câu "ý bạn là" bịa ra dẫn agent đi thêm một vòng sai — tệ hơn im lặng.
    expect(nearestStylePaths('zzzzzzzzzzzz')).toEqual([]);
  });

  it('trả tối đa `limit` gợi ý', () => {
    expect(nearestStylePaths('gap', 2).length).toBeLessThanOrEqual(2);
  });
});
