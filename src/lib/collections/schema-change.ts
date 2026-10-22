/**
 * Luật đổi cấu trúc khi loại nội dung ĐÃ CÓ entry.
 *
 * ## Vì sao không migrate hàng loạt
 *
 * Forward-only, áp LÚC ĐỌC — đúng khuôn `migrateDoc`. `UPDATE` 500 hàng JSONB để
 * đổi một field là một thao tác không hoàn lại được, chạy trong một request HTTP,
 * trên dữ liệu mà không có bản chụp nào. Áp lúc đọc thì sai cũng chỉ sai một lượt
 * đọc.
 *
 * Đổi `key` KHÔNG có trong danh sách thay đổi, có chủ đích: key nằm trong binding
 * của doc và trong URL API mà mobile gọi, nên đổi nó là làm chết cả hai — im lặng.
 * `diffSchema` thấy đổi key thành một cặp remove + add, và đó là mô tả ĐÚNG việc
 * đang xảy ra.
 */

import type { FieldDef, FieldType } from './field-def';

export type SchemaChange =
  | { kind: 'add'; field: FieldDef }
  | { kind: 'remove'; key: string }
  | { kind: 'retype'; key: string; from: FieldType; to: FieldType }
  | { kind: 'reconfig'; key: string }
  | { kind: 'reorder' };

/**
 * Cặp đổi kiểu KHÔNG mất dữ liệu. Mọi cặp ngoài bảng này bị chặn khi đã có entry.
 *
 * Ngắn có chủ đích: mỗi dòng thêm vào đây phải trả lời được "giá trị cũ đọc ra
 * bằng kiểu mới thì thành gì", và với hầu hết cặp thì câu trả lời là "mất".
 */
export const SAFE_RETYPE: Record<string, readonly FieldType[]> = {
  text: ['richtext', 'slug'],
  slug: ['text'],
  number: ['text'],
  enum: ['text'],
};

/*
 * `richtext → richdoc` KHÔNG có trong bảng trên, có chủ đích — và cặp ngược lại
 * cũng vậy.
 *
 * Hai kiểu này nghe như một kiểu đậm hơn của nhau, nên đây là dòng mà người sau
 * sẽ muốn thêm vào. Nhưng hình dạng của chúng khác nhau ở tầng ngoài cùng:
 * `richtext` lưu `InlineNode[]`, `richdoc` lưu `Block[]`. Đọc một giá trị
 * `richtext` cũ bằng `zRichDoc` sẽ trượt ở mọi phần tử (`{ t:'text' }` không có
 * `b`), nên field hoá rỗng trên toàn bộ entry cũ — và vì `checkSchemaChange` chỉ
 * chặn LÚC ĐỔI CẤU TRÚC, không ai thấy gì cho tới lần mở bài đầu tiên.
 *
 * Chuyển được về mặt kỹ thuật (bọc mỗi `InlineNode[]` thành một khối `p`), nhưng
 * chỗ chuyển đó phải là một hàm migrate áp lúc đọc như `migrateDoc` — hiện chưa
 * có, và một dòng trong bảng này thì KHÔNG gọi nó. Thêm dòng trước khi có hàm là
 * cách mất dữ liệu im lặng.
 *
 * ## `html` cũng không có trong bảng, và lý do KHÁC
 *
 * `richdoc → html` chuyển được và ĐÚNG hướng (cây khối → HTML là chiếu một-một, và
 * `richDocToHtml` trong `public-shape.ts` đã làm đúng phép chiếu đó). Nhưng giá trị
 * cũ trong JSONB là một MẢNG, và ô soạn `html` đọc `typeof value === 'string'` — nên
 * một dòng `richdoc: ['html']` ở đây làm mọi bài cũ hiện ra TRỐNG trong ô soạn, và
 * bài đầu tiên được lưu lại sẽ ghi đè cái trống đó lên nội dung thật.
 *
 * Đường chuyển đúng là một SCRIPT chạy một lần (`scripts/richdoc-to-html.ts`): nó
 * đọc từng entry, chiếu `Block[]` sang chuỗi, ghi lại, RỒI mới đổi kiểu field. Thứ
 * tự đó quan trọng — đổi kiểu trước là làm validator từ chối mảng cũ, và script
 * không đọc được gì nữa.
 *
 * Chiều `html → richdoc` thì KHÔNG chuyển được, không phải chưa: HTML nhận bảng,
 * iframe, `h1`, màu chữ, canh lề — `Block[]` không có chỗ nào biểu diễn chúng. Đổi
 * chiều đó là mất nội dung thật, nên nó phải ở ngoài bảng mãi mãi.
 */

export function diffSchema(before: FieldDef[], after: FieldDef[]): SchemaChange[] {
  const out: SchemaChange[] = [];
  const beforeByKey = new Map(before.map((f) => [f.key, f]));
  const afterByKey = new Map(after.map((f) => [f.key, f]));

  for (const f of after) {
    const old = beforeByKey.get(f.key);
    if (!old) {
      out.push({ kind: 'add', field: f });
      continue;
    }
    if (old.t !== f.t) {
      out.push({ kind: 'retype', key: f.key, from: old.t, to: f.t });
      continue;
    }
    if (JSON.stringify(old) !== JSON.stringify(f)) out.push({ kind: 'reconfig', key: f.key });
  }

  for (const f of before) {
    if (!afterByKey.has(f.key)) out.push({ kind: 'remove', key: f.key });
  }

  const sameSet =
    before.length === after.length && before.every((f) => afterByKey.has(f.key));
  const orderChanged =
    sameSet && before.some((f, i) => after[i]?.key !== f.key);
  if (orderChanged && out.length === 0) out.push({ kind: 'reorder' });

  return out;
}

export type ChangeChecked =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string };

export function checkSchemaChange(changes: SchemaChange[], entryCount: number): ChangeChecked {
  const warnings: string[] = [];
  if (entryCount === 0) return { ok: true, warnings };

  for (const c of changes) {
    if (c.kind === 'retype') {
      const safe = SAFE_RETYPE[c.from] ?? [];
      if (!safe.includes(c.to)) {
        return {
          ok: false,
          error: `Không đổi được field "${c.key}" từ ${c.from} sang ${c.to} khi đã có ${entryCount} entry — dữ liệu cũ sẽ mất. Tạo field mới rồi chuyển dần.`,
        };
      }
      warnings.push(`Field "${c.key}" đổi kiểu ${c.from} → ${c.to}; giá trị cũ được đọc theo kiểu mới.`);
    }

    if (c.kind === 'remove') {
      warnings.push(
        `Field "${c.key}" chỉ bị ẨN. Giá trị vẫn nằm trong ${entryCount} entry và sẽ hiện lại nếu thêm lại field cùng khoá.`,
      );
    }
  }

  return { ok: true, warnings };
}
