/**
 * Thư mục ảo cho kho ảnh.
 *
 * ## Vì sao thư mục KHÔNG nằm trong `Asset.key`
 *
 * Đây là quyết định quan trọng nhất của tính năng này, và nó đi ngược cách làm
 * hiển nhiên ("cứ nhét thư mục vào khoá S3 cho bucket đẹp").
 *
 * `key` được đánh địa chỉ theo **nội dung** (`nextAssetKey`) và **bất biến theo
 * hợp đồng** — `Release.assets` chụp metadata mà không chụp file, nên một khoá
 * phải mãi mãi trỏ tới cùng byte. Xem `src/lib/assets/key.ts`.
 *
 * Hai hệ quả giết chết phương án "thư mục trong khoá":
 *
 *  1. **Chống trùng.** Cùng một ảnh dùng ở hai trang là MỘT hàng `Asset` —
 *     `uploadAsset` bước 3 trả lại hàng cũ thay vì ghi lần nữa. Nếu thư mục nằm
 *     trong khoá thì `hero.jpg` ở trang chủ và ở trang giới thiệu buộc phải thành
 *     hai object, hai hàng, hai lần dung lượng.
 *  2. **Đổi tên.** Đổi tên thư mục = đổi khoá = phá hợp đồng bất biến, tức mọi
 *     release cũ trỏ tới một khoá không còn tồn tại.
 *
 * Nên hai chuyện đang bị gộp phải tách: `key` là **danh tính lưu trữ** (không đổi,
 * bao giờ), `folder` là **cách người dùng duyệt kho** (đổi tự do). Cột này không
 * xuất hiện trong `AssetSeal` — render không đọc nó, và chụp nó vào release là mời
 * người sau tưởng nó có tác dụng lúc render.
 *
 * ## Vì sao chuỗi đường dẫn chứ không phải một bảng
 *
 * Một bảng `AssetFolder` + khoá ngoại cho phép đổi tên ở đúng một chỗ. Nhưng nó
 * thêm một join vào mọi truy vấn kho ảnh, và một trạng thái mới phải dọn (thư mục
 * rỗng). Với chuỗi thì đổi tên là một câu UPDATE tiền tố — xem `renameFolder()` —
 * và thư mục rỗng đơn giản là không tồn tại.
 *
 * File này THUẦN: không prisma, không `server-only`. Luật tên thư mục phải test
 * được mà không cần Postgres.
 */

/** Sâu tối đa. Ba cấp đủ cho "trang/khu vực"; hơn nữa là cây không ai duyệt nổi. */
export const MAX_FOLDER_DEPTH = 3;

/** Trần độ dài cả đường dẫn, để nó còn hiện được trong một ô giao diện. */
export const MAX_FOLDER_LENGTH = 120;

/** Một đoạn hợp lệ SAU khi chuẩn hoá. */
export const FOLDER_SEGMENT_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type FolderResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Một đoạn tên do người dùng gõ → slug ascii.
 *
 * Cùng phép biến đổi với `assetKeyBase`: bỏ dấu tiếng Việt, `đ` → `d`, mọi thứ
 * khác thành gạch nối. Người dùng gõ "Trang chủ" và nhận "trang-chu" thay vì một
 * lỗi — bắt họ tự slug hoá là bắt họ làm việc của máy.
 */
export function slugSegment(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * Chuẩn hoá đường dẫn thư mục người dùng gõ.
 *
 * Rỗng, chỉ có gạch chéo, hay `undefined` đều thành `null` — nghĩa là "Chưa phân
 * loại". `null` chứ không phải chuỗi rỗng: một cột nullable nói đúng rằng ảnh
 * KHÔNG thuộc thư mục nào, còn `''` là một thư mục tên rỗng, và hai thứ đó sẽ tách
 * đôi mọi phép nhóm về sau.
 */
export function normalizeFolder(raw: string | null | undefined): FolderResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  const segments = raw
    .split('/')
    .map((s) => slugSegment(s.trim()))
    .filter(Boolean);

  if (!segments.length) return { ok: true, value: null };

  if (segments.length > MAX_FOLDER_DEPTH) {
    return {
      ok: false,
      error: `Thư mục sâu tối đa ${MAX_FOLDER_DEPTH} cấp, nhận ${segments.length}.`,
    };
  }

  const bad = segments.filter((s) => !FOLDER_SEGMENT_RE.test(s));
  if (bad.length) {
    return { ok: false, error: `Tên thư mục không hợp lệ: ${bad.join(', ')}` };
  }

  const value = segments.join('/');
  if (value.length > MAX_FOLDER_LENGTH) {
    return { ok: false, error: `Đường dẫn thư mục quá dài (${value.length}/${MAX_FOLDER_LENGTH}).` };
  }

  return { ok: true, value };
}

/**
 * `a/b/c` → `['a', 'a/b', 'a/b/c']`.
 *
 * Giao diện dựng cây từ đây: thư mục cha KHÔNG được lưu ở đâu cả, nó được suy ra
 * từ đường dẫn của con. Nhờ vậy không có thư mục rỗng để dọn, và tạo thư mục lồng
 * nhau chỉ là gõ một đường dẫn.
 */
export function folderParents(path: string): string[] {
  const out: string[] = [];
  let acc = '';
  for (const seg of path.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg;
    out.push(acc);
  }
  return out;
}

/** `path` có nằm trong `root` (hoặc chính là nó) không. */
export function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Đổi tiền tố `from` thành `to` trên một đường dẫn nằm dưới nó.
 *
 * Trả `null` nếu không nằm dưới — bên gọi coi đó là "không đụng tới hàng này".
 */
export function reparent(path: string, from: string, to: string): string | null {
  if (!isUnder(path, from)) return null;
  return to + path.slice(from.length);
}

/**
 * Ai được xoá một nhánh thư mục.
 *
 * Xoá thư mục là hành động DUY NHẤT ở đây mà `write` làm được dù nó chạm hàng loạt
 * ảnh, nên luật phải hẹp: admin xoá được mọi thứ; người khác chỉ xoá được nhánh mà
 * họ tạo ra TOÀN BỘ.
 *
 * `owners` là `createdBy` của mọi hàng `AssetFolder` trong nhánh, kể cả thư mục con.
 * Đòi sở hữu cả nhánh chứ không chỉ gốc: xoá `a` cuốn theo `a/cua-nguoi-khac`, và
 * cho phép điều đó là biến quyền xoá thư mục của mình thành quyền xoá thư mục của
 * người khác chỉ bằng cách tạo một thư mục cha.
 *
 * `null` trong `owners` là "không biết ai tạo" — thư mục có trước bảng registry, hoặc
 * do Agent tạo bằng token service. Nó KHÔNG khớp với bất kỳ ai, nên chỉ admin qua
 * được. Đoán chủ sở hữu ở đây là trao quyền xoá 40 ảnh cho nhầm người.
 *
 * Nhánh rỗng (`owners` không có phần tử nào) nghĩa là không có gì để xoá; trả `true`
 * để bên gọi báo 404 "không có thư mục này" thay vì 403 "không đủ quyền" — nói sai
 * loại lỗi làm người dùng đi tìm quyền trong khi vấn đề là gõ nhầm tên.
 */
export function mayDeleteFolder(args: {
  owners: readonly (string | null)[];
  actorSub: string;
  isAdmin: boolean;
}): boolean {
  if (args.isAdmin) return true;
  return args.owners.every((o) => o !== null && o === args.actorSub);
}

/**
 * Mọi đường dẫn cần có hàng trong registry để `paths` hiện đủ trong cây.
 *
 * Gộp cả cấp cha và loại trùng: dời ba ảnh vào `a/b`, `a/c`, `a/b` chỉ cần đảm bảo
 * `a`, `a/b`, `a/c`. Trả mảng đã sắp xếp để thứ tự ghi ổn định giữa các lần chạy —
 * transaction ghi theo thứ tự khác nhau là công thức của deadlock khi hai người
 * cùng dời ảnh.
 */
export function foldersToEnsure(paths: readonly (string | null)[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    if (!p) continue;
    for (const parent of folderParents(p)) out.add(parent);
  }
  return [...out].sort();
}
