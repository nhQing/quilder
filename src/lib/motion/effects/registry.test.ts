/**
 * Registry lặp lại `gates` của từng module để kiểm được mà không phải tải chunk.
 * Trùng lặp thì trôi dạt — test này chặn chuyện đó.
 *
 * Nó cũng canh những bất biến mà validator tầng semantic của Phase 3 sẽ dựa vào:
 * key khớp nhau, params mặc định parse được, và statesWritten có mặt cho mọi
 * effect ghi data-attribute.
 */

import { describe, expect, it } from 'vitest';

import { CORE_EFFECTS, EFFECT_REGISTRY, gatesFor, isKnownEffect, loadEffect } from './registry';

const keys = Object.keys(EFFECT_REGISTRY);

describe('registry effect', () => {
  it('có ít nhất một effect', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it.each(keys)('%s — key trong module khớp key trong registry', async (key) => {
    const mod = await loadEffect(key)!;
    expect(mod.key).toBe(key);
  });

  it.each(keys)('%s — gates trong registry khớp gates trong module', async (key) => {
    const mod = await loadEffect(key)!;
    // Đây là chỗ dễ trôi dạt nhất: sửa gates trong module mà quên registry thì
    // effect bị chặn (hoặc được cho qua) sai ở phép kiểm sớm, và triệu chứng là
    // "effect im lặng không chạy" — rất khó truy.
    expect(gatesFor(key) ?? {}).toEqual(mod.gates ?? {});
  });

  it.each(keys)('%s — requiredParams khớp đúng với schema', async (key) => {
    const mod = await loadEffect(key)!;
    const parsed = mod.paramsSchema.safeParse({});
    const required = mod.requiredParams ?? [];

    if (required.length === 0) {
      // Không khai gì bắt buộc thì gắn vào phải chạy được ngay.
      expect(parsed.success).toBe(true);
      return;
    }

    // Có khai thì schema PHẢI từ chối object rỗng, và từ chối đúng những trường
    // đã khai — không thừa, không thiếu. Lệch nghĩa là AI nhận sai thông tin về
    // cái gì bắt buộc.
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const missing = parsed.error.issues.map((i) => String(i.path[0])).sort();
    expect([...new Set(missing)]).toEqual([...required].sort());
  });

  it.each(keys)('%s — có aiDescription và runtimeCost', async (key) => {
    const mod = await loadEffect(key)!;
    expect(mod.aiDescription.length).toBeGreaterThan(20);
    expect(['light', 'medium', 'heavy']).toContain(mod.runtimeCost);
  });

  it('isKnownEffect phân biệt đúng', () => {
    expect(isKnownEffect(keys[0]!)).toBe(true);
    expect(isKnownEffect('khong-ton-tai')).toBe(false);
  });

  it('loadEffect trả null cho key lạ, và cache theo key', async () => {
    expect(loadEffect('khong-ton-tai')).toBeNull();
    const a = loadEffect(keys[0]!);
    const b = loadEffect(keys[0]!);
    expect(a).toBe(b);
  });
});

describe('xung đột effect', () => {
  /*
   * Chỉ trong LÕI: effect của gói dự án khai xung đột MỘT chiều với effect lõi (lõi không
   * biết tên effect của gói nào). Không sao — validator (`doc/validate.ts`) kiểm
   * conflicts của cả hai phía, nên thứ tự gắn không đổi được kết quả.
   */
  it('quan hệ conflicts trong lõi là hai chiều', async () => {
    const mods = await Promise.all(Object.keys(CORE_EFFECTS).map((k) => loadEffect(k)!));
    for (const mod of mods) {
      for (const other of mod.conflicts ?? []) {
        const target = mods.find((m) => m.key === other);
        // Bỏ qua effect chưa port. Khi đã port thì phải khai ngược lại — nếu
        // không, thứ tự gắn sẽ quyết định effect nào bị chặn, tức là không
        // xác định.
        if (!target) continue;
        expect(target.conflicts ?? []).toContain(mod.key);
      }
    }
  });
});

describe('manifest đủ để đồng bộ xuống bảng Effect', () => {
  /**
   * `scripts/sync-effects.ts` đọc thẳng manifest rồi ghi vào DB. Nên thiếu một
   * field ở đây không còn là chuyện nội bộ — nó thành một hàng DB rỗng mà
   * `list_effects` phát cho mọi Agent.
   */
  it('mọi effect có nhãn tiếng Việt không rỗng', async () => {
    for (const key of keys) {
      const mod = await loadEffect(key)!;
      expect(mod.name?.trim(), `${key} thiếu name`).toBeTruthy();
      // Nhãn phải KHÁC key: 'scroll-reveal' không phải một nhãn, nó là một id.
      expect(mod.name, `${key}: name trùng key`).not.toBe(key);
    }
  });

  it('nhãn không trùng nhau', async () => {
    const mods = await Promise.all(keys.map((k) => loadEffect(k)!));
    const names = mods.map((m) => m.name);
    expect(new Set(names).size, `nhãn trùng: ${names.join(', ')}`).toBe(names.length);
  });
});

/**
 * Module có mặt trên đĩa nhưng KHÔNG có entry registry thì không bao giờ tải
 * được — `isKnownEffect` trả false, validator từ chối, và không có lỗi nào chỉ
 * ra rằng file đó tồn tại.
 *
 * Phát hiện 25/08/2026: `text-split.ts` đúng ca đó. Nó là target của inline node
 * `{ t: 'split' }` và được `types.ts` nhắc tới, nhưng chưa từng vào registry.
 *
 * Danh sách miễn dưới đây là để chuyện đó HIỆN RA. Thêm một module mới mà quên
 * registry sẽ làm test này đỏ, chứ không im lặng.
 */
const UNREGISTERED_ON_PURPOSE: Record<string, string> = {
  'text-split': 'Chưa vào registry — target của inline node `split`, port sau. Xem HANDOFF §2.',
};

describe('không có module effect mồ côi', () => {
  it('mọi module trong thư mục đều có entry registry, hoặc được miễn có lý do', async () => {
    const { readdirSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const here = dirname(fileURLToPath(import.meta.url));
    const modules = readdirSync(join(here))
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => !['registry.ts', 'types.ts'].includes(f))
      // `*-model.ts` là số học thuần tách khỏi effect, không phải effect.
      .filter((f) => !f.endsWith('-model.ts'))
      .map((f) => f.replace(/\.ts$/, ''));

    const orphans = modules.filter(
      (m) => !isKnownEffect(m) && !(m in UNREGISTERED_ON_PURPOSE),
    );
    expect(orphans, `module không có entry registry: ${orphans.join(', ')}`).toEqual([]);

    // Và chiều ngược lại: một module đã vào registry thì phải RỜI danh sách miễn,
    // nếu không danh sách đó thành nơi chứa thông tin sai.
    const stale = Object.keys(UNREGISTERED_ON_PURPOSE).filter((k) => isKnownEffect(k));
    expect(stale, `đã vào registry nhưng còn trong danh sách miễn: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('tên state khai đúng dạng attribute', () => {
  /**
   * `statesWritten` là tên ATTRIBUTE, không phải tên thuộc tính JS.
   *
   * `el.dataset.fooBar = 'x'` ghi ra `data-foo-bar` — DOM tự đổi camelCase sang
   * kebab. Compiler CSS thì sinh `[data-<tên>]` từ đúng chuỗi trong danh sách
   * này, và validator ngữ nghĩa đối chiếu `style.states` với nó.
   *
   * Nên một tên camelCase sai cả hai chiều và không báo gì: tên đúng bị từ chối,
   * tên sai được nhận rồi sinh ra một selector không bao giờ khớp. `carousel`
   * khai `'carouselReady'` cho tới 25/08/2026 — bug này chỉ lộ ra khi manifest bị
   * đọc ra để đồng bộ xuống DB.
   */
  it('mọi statesWritten là kebab-case, chữ thường', async () => {
    for (const key of keys) {
      const mod = await loadEffect(key)!;
      for (const state of mod.statesWritten ?? []) {
        expect(state, `${key}: "${state}" phải là kebab-case chữ thường`).toMatch(
          /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
        );
      }
    }
  });
});
