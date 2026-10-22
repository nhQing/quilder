/**
 * `expandPreset` là phép trộn mà cả tính năng preset dựa vào, và nó có đúng hai
 * cách hỏng im lặng: trộn sai chiều (preset đè lên thứ người gắn tự gõ), và trộn
 * SÂU (preset với người gắn cùng khai `breakpoints` thì kết quả là một thứ không
 * ai gõ). Test này canh cả hai.
 *
 * Phần đọc DB (`loadEffectPresets`) không có ở đây: nó là một `findMany` trần,
 * và kiểm nó là kiểm Prisma.
 */

import { describe, expect, it } from 'vitest';

import { expandPreset, type EffectPresetRow } from './effect-presets';

function presets(...rows: Array<Partial<EffectPresetRow> & { key: string }>) {
  return new Map(
    rows.map((r) => [
      r.key,
      {
        name: r.key,
        aiDescription: 'mô tả',
        effectKey: 'slider',
        params: {},
        note: null,
        ...r,
      } as EffectPresetRow,
    ]),
  );
}

describe('expandPreset', () => {
  it('đổi tên effect và trộn params', () => {
    const table = presets({
      key: 'dai-logo-chay',
      effectKey: 'slider',
      params: { preset: 'marquee', spaceBetween: 48 },
    });

    expect(expandPreset('dai-logo-chay', {}, table)).toEqual({
      effect: 'slider',
      params: { preset: 'marquee', spaceBetween: 48 },
      fromPreset: 'dai-logo-chay',
    });
  });

  it('params người gắn THẮNG params của preset', () => {
    // Chiều ngược lại là chiều hiển nhiên sai: người gắn gõ một giá trị rồi
    // không thấy nó có tác dụng, và không có gì báo.
    const table = presets({ key: 'p', params: { preset: 'marquee', speedMs: 5000 } });

    expect(expandPreset('p', { speedMs: 200 }, table)?.params).toEqual({
      preset: 'marquee',
      speedMs: 200,
    });
  });

  it('trộn NÔNG: breakpoints của người gắn thay cả khoá, không hợp nhất', () => {
    const table = presets({ key: 'p', params: { breakpoints: { sm: { slidesPerView: 2 } } } });

    const out = expandPreset('p', { breakpoints: { lg: { slidesPerView: 4 } } }, table);
    // Hợp nhất sâu sẽ cho `{ sm: …, lg: … }` — một dải có hai mốc trong khi lệnh
    // của người gắn chỉ nhắc tới một.
    expect(out?.params.breakpoints).toEqual({ lg: { slidesPerView: 4 } });
  });

  it('key không phải preset trả null, không ném', () => {
    // Bao gồm cả key gõ sai. Phân biệt "gõ sai" với "không phải preset" là việc
    // của `validateOps` (nhánh `isKnownEffect`), không phải của hàm này.
    expect(expandPreset('slider', {}, presets({ key: 'p' }))).toBeNull();
    expect(expandPreset('dai-logo-chai', {}, presets({ key: 'dai-logo-chay' }))).toBeNull();
  });

  it('preset trỏ tới effect khác slider vẫn giải đúng', () => {
    const table = presets({ key: 'hien-dan-cham', effectKey: 'scroll-reveal', params: { delay: 300 } });

    expect(expandPreset('hien-dan-cham', { stagger: 60 }, table)).toEqual({
      effect: 'scroll-reveal',
      params: { delay: 300, stagger: 60 },
      fromPreset: 'hien-dan-cham',
    });
  });
});
