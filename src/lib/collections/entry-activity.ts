/**
 * Nhật ký của một bài — ai tạo, ai sửa gần nhất, và lịch sử cập nhật (22/10/2026).
 *
 * Nguồn là `AuditLog`, thứ mọi đường ghi của `entry-write.ts` đã ghi từ trước: không có
 * cột mới, không có bảng mới. Lịch sử này nói AI làm GÌ lúc NÀO — không phải lịch sử
 * phiên bản: entry vẫn không có bản cũ để lùi về (khác `PageVersion` của trang).
 *
 * Thuần, không `server-only`: hai hàm nhãn chạy được ở cả server lẫn form.
 */

export interface ActivityPerson {
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface ActivityRow {
  id: string;
  at: Date;
  label: string;
  /** `null` = tài khoản đã bị xoá khỏi bảng `User`. */
  person: ActivityPerson | null;
}

export interface EntryActivity {
  /** Tác giả — `Entry.createdBy`, thứ site hiện ở byline. Đổi được. */
  writer: ActivityPerson;
  /** Người bấm tạo bài thật — dòng `entry.create` của nhật ký. */
  createdBy: ActivityPerson | null;
  updatedBy: ActivityPerson | null;
  history: ActivityRow[];
}

/** Một tài khoản trong danh sách chọn tác giả. */
export interface WriterOption extends ActivityPerson {
  /** Tài khoản đã khoá vẫn chọn được — tác giả nghỉ việc, bài vẫn đứng tên họ. */
  locked: boolean;
}

/** Số dòng lịch sử hiện ra. Nhiều hơn thì đó là việc của màn nhật ký hệ thống. */
export const ACTIVITY_LIMIT = 20;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * `AuditLog.action` + `meta` → câu cho biên tập viên.
 *
 * Action lạ trả NGUYÊN VĂN chứ không một câu chung: "entry.khac" vẫn còn lần ra được,
 * còn "Thao tác khác" thì không.
 */
export function activityLabel(action: string, meta: unknown): string {
  const m = (typeof meta === 'object' && meta !== null ? meta : {}) as Record<string, unknown>;
  const loc = typeof m.locale === 'string' ? m.locale.toUpperCase() : '';

  switch (action) {
    case 'entry.create':
      return 'Tạo bài';
    case 'entry.update': {
      const fields = strings(m.fields);
      const locales = strings(m.locales).map((l) => l.toUpperCase());
      // Không trường nào và không bản dịch nào: lượt ghi chỉ đổi `taxonomyIds`.
      if (Array.isArray(m.fields) && !fields.length && !locales.length) return 'Đổi danh mục';
      if (!locales.length) return 'Sửa nội dung';
      if (!fields.length) return `Sửa bản ${locales.join(', ')}`;
      return `Sửa nội dung và bản ${locales.join(', ')}`;
    }
    case 'entry.published':
      return 'Đăng';
    case 'entry.draft':
      return 'Gỡ xuống bản nháp';
    case 'entry.archive':
      return 'Đưa vào lưu trữ';
    case 'entry.unarchive':
      return 'Khôi phục từ lưu trữ';
    case 'entry.author':
      return 'Đổi tác giả';
    case 'entry.locale.published':
      return `Đăng bản ${loc}`;
    case 'entry.locale.draft':
      return `Gỡ bản ${loc} xuống bản nháp`;
    default:
      return action;
  }
}

/** Tên, rơi về email — cùng luật với byline (`VIRTUAL_KEYS.author`). */
export function personLabel(p: Pick<ActivityPerson, 'name' | 'email'> | null): string {
  if (!p) return 'Tài khoản đã xoá';
  return p.name?.trim() || p.email;
}
