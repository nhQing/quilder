import 'server-only';

/**
 * Bảng tra `FieldGroupDef.key` → field của nó.
 *
 * ## Vì sao một module riêng
 *
 * Cả đường GHI (`entry-write`, `type-write`) lẫn đường ĐỌC (`queries`,
 * `admin-queries`, `public-read`) đều cần nó. Để nó nằm trong một trong hai bên
 * nghĩa là bên còn lại phải import ngược, và thứ tự tạo file trở thành một ràng
 * buộc ngầm.
 *
 * ## Vì sao ba lượt
 *
 * `validateCollectionSchema` đo độ sâu bằng cách tra bảng nhóm. Lượt một điền mọi
 * khoá với mảng rỗng để lượt hai đo được nhóm-lồng-nhóm. Một lượt duy nhất thì mọi
 * nhóm lồng đều thấy bảng thiếu và bị tính như lá — một schema sâu 3 đo ra 2 và
 * lọt qua luật giới hạn.
 *
 * Lượt ba đo LẠI khi bảng đã đầy, và vô hiệu hoá nhóm nằm trong vòng: ở lượt hai,
 * nhóm nào được validate trước thì các nhóm sau nó vẫn còn `[]`, nên một vòng A→B→A
 * lọt qua cả hai lượt. Bảng trả về từ hàm này KHÔNG BAO GIỜ có vòng — mốc 2 render
 * `FieldGroupDef` đệ quy và dựa vào đúng điều đó.
 */

import { prisma } from '@/lib/db';
import { MAX_FIELD_DEPTH, schemaDepth, validateCollectionSchema, type FieldDef, type GroupTable } from './field-def';

export async function loadGroupTable(): Promise<GroupTable> {
  const rows = await prisma.fieldGroupDef.findMany({ select: { key: true, schema: true } });
  const groups: GroupTable = {};
  for (const r of rows) groups[r.key] = [];
  for (const r of rows) {
    const parsed = validateCollectionSchema(r.schema, groups, 'group');
    // Nhóm có cấu trúc hỏng thành mảng rỗng, không ném: một hàng hỏng không được
    // làm mọi loại nội dung dùng nó không mở được nữa.
    groups[r.key] = parsed.ok ? parsed.fields : [];
  }

  // Lượt ba: nhóm nào tạo vòng thì trả về RỖNG.
  //
  // Hai lượt trên không bắt được A→B→A: lúc validate B thì `groups.a` còn `[]`, nên
  // B→A trông như trỏ tới một nhóm mồ côi và được tính như một lá. Bảng có vòng đi ra
  // ngoài là một quả mìn cho mốc 2, nơi màn cấu trúc render `FieldGroupDef` ĐỆ QUY và
  // không đi qua `validateCollectionSchema` của một type.
  //
  // Rỗng chứ không ném: một nhóm hỏng không được làm cả màn Nội dung không mở được —
  // mà đó chính là chỗ sửa nó.
  for (const key of Object.keys(groups)) {
    if (schemaDepth([{ t: 'group', key: '_', label: '_', groupKey: key }], groups) > MAX_FIELD_DEPTH) {
      groups[key] = [];
    }
  }

  return groups;
}

/** Mọi khoá nhóm mà một danh sách field trỏ tới TRỰC TIẾP, qua `group`/`blocks`. */
export function directGroupRefs(fields: FieldDef[]): string[] {
  return fields.flatMap((f) => (f.t === 'group' ? [f.groupKey] : f.t === 'blocks' ? f.allowed : []));
}

/**
 * Bao đóng NGƯỢC: mọi khoá nhóm mà SỬA nó cũng đổi cấu trúc hiệu dụng của
 * nhóm `key` — tức mọi nhóm A sao cho tồn tại một đường A → … → `key` trong
 * đồ thị tham chiếu `group`/`blocks`. Luôn chứa `key` (sửa chính nó dĩ nhiên
 * đổi nó).
 *
 * Rút ra từ `upsertFieldGroup` (`type-write.ts`) — nơi DUY NHẤT viết phép này
 * trước khi hàm này tồn tại. Không viết bản thứ hai: hai bản đo cùng một thứ
 * sẽ trôi lệch nhau qua thời gian, và bản trong `upsertFieldGroup` còn kiêm
 * phép kiểm độ sâu nên nó là bản có khả năng bị sửa tiếp cao nhất.
 *
 * Không cần `seen` chống vòng: `touched` chỉ LỚN LÊN và số nhóm hữu hạn, nên
 * vòng lặp ngoài tự dừng khi một lượt không thêm được gì (kể cả khi đồ thị có
 * vòng A↔B — lượt tiếp theo không còn gì mới để thêm).
 */
export function groupClosure(groups: GroupTable, key: string): Set<string> {
  const touched = new Set([key]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [gk, fields] of Object.entries(groups)) {
      if (touched.has(gk)) continue;
      if (directGroupRefs(fields).some((r) => touched.has(r))) {
        touched.add(gk);
        grew = true;
      }
    }
  }
  return touched;
}

/**
 * Loại nội dung nào có field `group`/`blocks` trỏ tới BẤT KỲ khoá nào trong
 * `closure` — tức đổi theo khi một nhóm trong bao đóng đó bị sửa, trực tiếp
 * hoặc gián tiếp qua một nhóm khác.
 *
 * Truyền `closure = new Set([key])` (không gọi `groupClosure`) để chỉ đếm
 * tham chiếu TRỰC TIẾP tới đúng `key`.
 */
export function typesUsing(
  types: { key: string; schema: FieldDef[] }[],
  closure: ReadonlySet<string>,
): string[] {
  return types.filter((t) => directGroupRefs(t.schema).some((r) => closure.has(r))).map((t) => t.key);
}
