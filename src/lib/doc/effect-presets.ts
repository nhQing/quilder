/**
 * Giải `EffectPreset` thành effect thật + params đã trộn.
 *
 * "Thêm một hiệu ứng đơn giản mà không phải deploy" hỏi đúng một thứ: một cái
 * tên mới trong `list_effects` mà không có file mới nào trong
 * `EFFECT_REGISTRY`. Toàn bộ phần còn lại — mô tả, schema params, chi phí, state
 * — đã là dữ liệu trong Postgres từ trước (`model Effect` +
 * `scripts/sync-effects.ts`), nên chỗ hở duy nhất là phép ĐỔI TÊN này.
 *
 * ## Vì sao giải ở VALIDATOR, không ở renderer
 *
 * Hai chỗ giải được, và chúng cho hai hệ thống khác nhau:
 *
 *  - **Ở renderer** (lưu `presetKey`, tra bảng mỗi lần render): sửa một hàng
 *    preset là đổi MỌI trang đã publish đang dùng nó, ngay lập tức, không qua
 *    nút Publish nào. Cả mô hình release ở repo này dựng lên để chuyện đó không
 *    xảy ra được — `StyleBundle` niêm phong CSS, `Release.translations` chụp bản
 *    dịch. Một đường vòng cho effect sẽ là lỗ thủng duy nhất trên tường ấy.
 *  - **Ở validator** (giải một lần, ghi kết quả vào doc): preset là một MACRO.
 *    Trang đã dựng đứng yên; sửa preset chỉ ảnh hưởng lần gắn sau.
 *
 * Chọn cái sau. Cái giá là thật và phải nói ra: sửa một preset KHÔNG sửa được
 * các trang đã gắn nó, phải gỡ và gắn lại từng chỗ. Với một dải logo thì đó là
 * việc vài phút; với một preset dùng trên ba mươi trang thì không. Nếu về sau
 * nhu cầu "sửa một chỗ, đổi mọi trang" là thật, đường đúng là một op
 * `reapplyPreset` chạy qua các trang rồi sinh version mới cho từng trang — vẫn
 * đi qua Publish, chứ không phải chuyển phép giải xuống renderer.
 *
 * ## Trộn nông, params người gắn thắng
 *
 * `{ ...preset.params, ...attachment.params }`. Nông chứ không sâu vì params của
 * effect chỉ có một tầng lồng (`breakpoints`), và trộn sâu ở đó sẽ cho ra thứ
 * không ai gõ: preset khai `breakpoints.sm` còn người gắn khai
 * `breakpoints.lg`, kết quả là một dải có hai mốc mà người gắn chỉ thấy một
 * trong hai trong lệnh của mình. Ghi đè cả khoá `breakpoints` thì cái gõ tay là
 * cái nhìn thấy được.
 */

import 'server-only';

import { prisma } from '@/lib/db';

export interface EffectPresetRow {
  key: string;
  name: string;
  aiDescription: string;
  effectKey: string;
  params: Record<string, unknown>;
  note: string | null;
}

function toRow(r: {
  key: string;
  name: string;
  aiDescription: string;
  effectKey: string;
  params: unknown;
  note: string | null;
}): EffectPresetRow {
  return {
    key: r.key,
    name: r.name,
    aiDescription: r.aiDescription,
    effectKey: r.effectKey,
    // Cột JSONB nhận được bất cứ thứ gì đã từng được ghi vào đó — kể cả `null`
    // hoặc một mảng, nếu có ai viết thẳng SQL. Không tin nó là object.
    params:
      r.params && typeof r.params === 'object' && !Array.isArray(r.params)
        ? (r.params as Record<string, unknown>)
        : {},
    note: r.note,
  };
}

/**
 * Toàn bộ preset, một lượt đọc mỗi request.
 *
 * KHÔNG cache: cùng lý lẽ `loadCollectionFields` trong `validate.ts` đã viết —
 * ở đường GHI, một validator đối chiếu với bản cache là một validator nói dối
 * trong đúng một giờ. Thêm một preset rồi gắn nó ngay trong cùng buổi làm việc
 * là ca dùng chính của cả tính năng này.
 */
export async function loadEffectPresets(): Promise<Map<string, EffectPresetRow>> {
  const rows = await prisma.effectPreset.findMany({
    select: {
      key: true,
      name: true,
      aiDescription: true,
      effectKey: true,
      params: true,
      note: true,
    },
  });
  return new Map(rows.map((r) => [r.key, toRow(r)]));
}

export interface PresetExpansion {
  effect: string;
  params: Record<string, unknown>;
  fromPreset: string;
}

/**
 * Một `attachEffect.effect` có phải tên preset không, và nếu phải thì nó ra gì.
 *
 * Trả `null` cho mọi thứ không phải preset — kể cả key không tồn tại ở đâu cả.
 * Phân biệt "sai chính tả" với "không phải preset" không phải việc của hàm này:
 * `validateOps` đã có nhánh `isKnownEffect` để từ chối key lạ, và gộp hai câu
 * trả lời vào một hàm sẽ cho ra hai thông báo lỗi cho cùng một lỗi.
 */
export function expandPreset(
  effect: string,
  params: Record<string, unknown>,
  presets: Map<string, EffectPresetRow>,
): PresetExpansion | null {
  const preset = presets.get(effect);
  if (!preset) return null;

  return {
    effect: preset.effectKey,
    params: { ...preset.params, ...params },
    fromPreset: preset.key,
  };
}
