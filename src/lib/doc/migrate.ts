/**
 * Migration của Doc schema — forward-only, ÁP LÚC ĐỌC.
 *
 * Đây là cách chặn rủi ro R6: `PageVersion.doc` là JSONB immutable, nên sáu tháng
 * nữa khi `StyleProps` đổi shape, một version một năm tuổi vẫn phải render được —
 * đúng lúc cần rollback nhất. Bytes đã lưu KHÔNG BAO GIỜ bị sửa tại chỗ; ta nâng
 * cấp bản đọc ra trong bộ nhớ.
 *
 * Thêm version mới: viết một hàm `1 -> 2` vào MIGRATIONS rồi tăng
 * CURRENT_SCHEMA_VERSION. Không sửa hàm cũ.
 */

import { CURRENT_SCHEMA_VERSION, type Doc } from './types';

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * `visibility: Responsive<boolean>` → `render: boolean`.
 *
 * Bốn khoá breakpoint của trường cũ CHƯA TỪNG có tác dụng — `NodeRenderer` chỉ
 * đọc `.base` — nên phép chuyển không mất thông tin nào đang được dùng: một node
 * `{base:false, lg:true}` vẫn đang bị cắt khỏi DOM ở mọi bề rộng, và `render:
 * false` nói đúng điều đó. Ai muốn hành vi mà `lg:true` gợi ra thì phải đặt lại
 * bằng `style.lg.layout.display`, và đó là thay đổi CÓ Ý — không phải thứ
 * migration được đoán hộ.
 *
 * `render` chỉ được ghi khi giá trị là `false`: mặc định là có render, nên một doc
 * đầy `render: true` là tiếng ồn trong mọi diff về sau.
 *
 * LUÔN trả về object mới, kể cả khi không node nào có `visibility` — KHÔNG "tối
 * ưu" bằng cách trả lại chính đầu vào. Vòng lặp trong `migrateDoc` ghi
 * `current.schemaVersion = version` sau mỗi bước; trả lại đầu vào nghĩa là dòng
 * đó mutate doc của người gọi, và người gọi thường đang giữ bản đọc từ Prisma.
 * (`stripScaffolding` giữ referential equality được vì nó chạy SAU vòng lặp.)
 */
const visibilityToRender: Migration = (doc) => {
  const nodes = doc.nodes as Record<string, Record<string, unknown>> | undefined;
  if (!nodes) return doc;

  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (!('visibility' in node)) {
      out[id] = node;
      continue;
    }
    const old = node.visibility as { base?: unknown } | null | undefined;
    const copy = { ...node };
    delete copy.visibility;
    if (old && typeof old === 'object' && old.base === false) copy.render = false;
    out[id] = copy;
  }
  return { ...doc, nodes: out };
};

/** Khóa là version NGUỒN: MIGRATIONS[1] nâng doc v1 lên v2. */
const MIGRATIONS: Record<number, Migration> = {
  1: visibilityToRender,
};

export class DocVersionError extends Error {}

export function migrateDoc(raw: unknown): Doc {
  if (typeof raw !== 'object' || raw === null) {
    throw new DocVersionError('doc không phải object');
  }

  let current = raw as Record<string, unknown>;
  let version = Number(current.schemaVersion ?? 0);

  if (!Number.isInteger(version) || version < 1) {
    throw new DocVersionError(`schemaVersion không hợp lệ: ${String(current.schemaVersion)}`);
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    // Xảy ra khi rollback code về bản cũ trong lúc DB đã có doc mới hơn.
    // Fail rõ ràng còn hơn render sai.
    throw new DocVersionError(
      `doc ở schemaVersion ${version}, code này chỉ hiểu tới ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new DocVersionError(`thiếu migration từ v${version}`);
    current = step(current);
    version += 1;
    current.schemaVersion = version;
  }

  return stripScaffolding(current) as unknown as Doc;
}

/**
 * Trường giàn giáo mà `scripts/migrate/html-to-doc.ts` để lại trên node.
 *
 * `_src` là đường dẫn ảnh gốc trong `../new-website`, để
 * `scripts/wire-page-assets.ts` biết nối `assetId` nào vào node nào. Script đó đã
 * chạy xong — 11/11 asset đã nối — nên trường này là **dữ liệu chết**.
 */
const SCAFFOLDING_KEYS = ['_src'] as const;

/**
 * Bỏ trường giàn giáo khỏi mọi node.
 *
 * ## Vì sao đây là BUG THẬT, không phải dọn cho gọn
 *
 * `zNode` là `.strict()`. `invert()` sinh nghịch đảo của `removeNode` bằng cách gói
 * lại chính node vừa xoá thành `insertNode` — kèm `_src`. Validator từ chối, nên
 * **hoàn tác sau khi xoá một node có `_src` báo lỗi**:
 *
 *     5.node: Unrecognized key(s) in object: '_src'
 *
 * Người dùng báo đúng lỗi này ngày 19/08/2026. Xoá thì được (`removeNode` không
 * kiểm hình dạng node), hoàn tác thì không — node biến mất và nút undo không lấy
 * lại được.
 *
 * ## Vì sao sửa ở ĐÂY chứ không sửa dữ liệu
 *
 * `migrateDoc` chạy trên MỌI đường đọc, nên một chỗ sửa là mọi chỗ đúng — kể cả
 * `Release.components` và các `PageVersion` cũ, vốn bất biến và không được ghi lại.
 * Và vì `applyOpsToPage` ghi `result.doc` xuống version mới, dữ liệu tự sạch dần
 * theo từng lần ghi. Không cần script di trú.
 *
 * ## Vì sao KHÔNG nới `zNode` cho nhận `_src`
 *
 * Nới schema để chứa giàn giáo là biến giàn giáo thành một phần của hợp đồng, và
 * người sau sẽ không biết nó còn được dùng hay không.
 */
function stripScaffolding(doc: Record<string, unknown>): Record<string, unknown> {
  const nodes = doc.nodes as Record<string, Record<string, unknown>> | undefined;
  if (!nodes) return doc;

  let touched = false;
  const clean: Record<string, Record<string, unknown>> = {};

  for (const [id, node] of Object.entries(nodes)) {
    const hit = SCAFFOLDING_KEYS.filter((k) => k in node);
    if (!hit.length) {
      clean[id] = node;
      continue;
    }
    touched = true;
    const copy = { ...node };
    for (const k of hit) delete copy[k];
    clean[id] = copy;
  }

  // Không đụng gì thì trả về chính object cũ, giữ referential equality — cùng lý lẽ
  // như `applyPatchWithMinimalMutationChain` của Builder.io (BENCHMARK §1.4).
  return touched ? { ...doc, nodes: clean } : doc;
}

/**
 * Nâng cấp một cây COMPONENT lên schema hiện tại.
 *
 * ## Vì sao dùng lại đúng bảng MIGRATIONS ở trên
 *
 * `Preset.tree` là "đúng hình dạng `Doc` trừ `schemaVersion`", nên mọi phép biến
 * đổi node áp được y nguyên. Viết bảng thứ hai là tạo hai bản của một luật, và bản
 * ít được nhớ tới sẽ trôi — cùng lý do `overrideSlots()` dùng lại `extractUnits`
 * chứ không tự duyệt cây.
 *
 * ## Vì sao đây là việc BẮT BUỘC, không phải phòng xa
 *
 * Trước đây `apply-to-preset.ts` gắn `CURRENT_SCHEMA_VERSION` lên bất cứ cây nào
 * đọc ra — tức nó KHẲNG ĐỊNH cây đã ở schema mới nhất mà không kiểm gì. Với mô
 * hình "mỗi domain một bản builder, nâng cấp được", nâng cấp CHÍNH LÀ lúc
 * `schemaVersion` tăng. Ngày `Doc` lên 2: trang migrate, component thì không, các
 * node `Instance` render từ cây chưa nâng cấp, và `pnpm verify` vẫn xanh.
 *
 * ## Vì sao thiếu `schemaVersion` là v1, không phải lỗi
 *
 * Khác `migrateDoc` đúng một điểm, và có lý do dữ liệu: 5 preset cùng 56
 * `Release.components` đã được ghi TRƯỚC khi trường này tồn tại. Ném ở đây là làm
 * trắng mọi trang có instance, để đổi lấy một lời cảnh báo không ai cần.
 *
 * Mặc định là **1**, KHÔNG phải `CURRENT_SCHEMA_VERSION`: cây thiếu trường này là
 * cây ghi trước khi trường tồn tại, tức cây v1. Dùng `CURRENT` sẽ gắn nhãn "mới
 * nhất" cho dữ liệu cũ và bỏ qua mọi bước migration — đúng cái lỗi hàm này sinh ra
 * để sửa. Khi `CURRENT_SCHEMA_VERSION` lên 2, kiểm lại rằng dòng dưới vẫn là `?? 1`.
 */
export function migratePresetTree(raw: unknown): { rootId: string; nodes: Doc['nodes'] } {
  if (typeof raw !== 'object' || raw === null) {
    throw new DocVersionError('cây component không phải object');
  }

  const tree = raw as Record<string, unknown>;
  const doc = migrateDoc({ ...tree, schemaVersion: tree.schemaVersion ?? 1 });

  // Trả về hình dạng `ComponentTree`, KHÔNG kèm `schemaVersion`: trường đó sẽ lọt
  // vào mọi chỗ so sánh cây và làm chúng lệch vì một thứ không ai đọc.
  return { rootId: doc.rootId, nodes: doc.nodes };
}

/**
 * Cây component → `Doc` ĐÃ migrate, dùng được ở cả client.
 *
 * ## Vì sao cần bản này bên cạnh `treeToDoc`
 *
 * `treeToDoc` sống trong `apply-to-preset.ts`, và file đó khai `server-only`. Ba
 * chỗ ở phía client (editor component, `EditorShell.openComponent`, chuẩn hoá kết
 * quả lưu trong `store`) vì thế đã tự ghép `{ ...tree, schemaVersion: 1 }` — tức
 * DÁN NHÃN v1 cho một cây có thể ở version bất kỳ, và bỏ qua mọi migration.
 *
 * Nó vô hại chừng nào `CURRENT_SCHEMA_VERSION` còn là 1. Từ lúc nó lên 2 thì
 * client hiện một cây hình dạng cũ trong khi đường ghi migrate nó — hai bên nói
 * hai chuyện, và thứ lệch là chính trường vừa đổi tên.
 *
 * Hàm này thuần (chỉ `./types`), nên client import được và luật chỉ có một bản.
 */
export function presetTreeToDoc(raw: unknown): Doc {
  const { rootId, nodes } = migratePresetTree(raw);
  return { schemaVersion: CURRENT_SCHEMA_VERSION, rootId, nodes };
}
