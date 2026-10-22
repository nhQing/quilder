import { NextResponse } from 'next/server';

/**
 * "Khối lặp này đang khớp bao nhiêu bài" — cho panel *Lặp theo* của Inspector.
 *
 * ## Vì sao đây là API của BUILDER, không phải của namespace công khai
 *
 * Nó đọc bảng LIVE và nó nhận một `RepeatSpec` từ client. Cả hai điều đó chỉ chấp
 * nhận được sau một phiên đăng nhập: một `RepeatSpec` là một truy vấn có tham số,
 * và mở nó cho người lạ là mở đúng bề mặt mà `/api/public/v1` cố ý không có.
 *
 * ## Vì sao dùng lại `resolveRepeat` chứ không tự đếm
 *
 * Con số này là công cụ soát duy nhất trả lời "vì sao danh sách của tôi trống".
 * Một truy vấn thứ hai cho cùng câu hỏi sẽ lệch với thứ site thật render, và bản
 * nói "có 10 bài" là bản người dùng tin. Xem docblock `MatchCount` trong
 * `src/components/builder/Inspector.tsx`.
 *
 * ## Ba nguồn đếm được, hai nguồn không
 *
 * `related` và `field` cần một bài đang mở; `group-entries` cần danh mục của khối
 * cha. Không có ngữ cảnh đó thì `resolveRepeat` trả rỗng — ĐÚNG, nhưng "0 bài" là
 * một câu trả lời sai lệch cho một cấu hình không sai. Nên route nói thẳng bằng
 * `needsContext` thay vì để panel hiện số 0. Panel hiện chỉ gọi với ba nguồn đếm
 * được (xem điều kiện quanh `<MatchCount>`), nhưng route không dựa vào điều đó —
 * một client bỏ qua nó phải nhận một câu trả lời trung thực, không phải số 0.
 *
 * ## Ca thứ tư: điều kiện lọc lấy giá trị từ ĐOẠN ĐỘNG của URL
 *
 * `{ from: 'url' }` — của `taxonomy` hay của `relation` — đọc một thứ chỉ tồn tại khi
 * đang render một URL thật. Route này chạy trong builder, nên nó không có thứ ấy.
 *
 * Trước 14/09/2026 nó im lặng KHÔNG truyền ô ngữ cảnh nào, và `undefined` ở
 * `filterToWhere` nghĩa là "bỏ điều kiện" — nên panel đếm số bài KHÔNG LỌC và hiện
 * "10 bài" cho một khối mà site thật trả về ba. Cùng hình dạng lỗi với trang danh mục
 * trả danh sách đầy đủ, chỉ khác chỗ nó nói dối người dựng thay vì người đọc.
 *
 * Truyền `null` (tức "không khớp gì") sẽ cho `matched: 0` — đúng kiểu, nhưng vẫn là
 * một con số sai lệch cho một cấu hình không sai, đúng thứ đoạn trên vừa từ chối. Nên
 * ca này đi cùng đường với ba ca kia: `needsContext`.
 */

import { requireAuth } from '@/lib/auth/guard';
import { getAdminEntry, repeatEntryContext } from '@/lib/collections/admin-queries';
import { getCollectionTypes } from '@/lib/collections/queries';
import { resolveRepeat } from '@/lib/collections/resolve-repeat';
import { zRepeatSpec } from '@/lib/doc/schema';
import type { RepeatSpec } from '@/lib/doc/types';

export const dynamic = 'force-dynamic';

/** Số item gửi kèm để soát bằng mắt. Panel chỉ liệt kê vài dòng đầu. */
const PREVIEW_LIMIT = 5;

/** Loại nội dung mà một `RepeatSpec` đọc, nếu nguồn của nó có một loại cố định. */
function typeKeyOf(spec: RepeatSpec): string | null {
  const s = spec.source;
  if (s.kind === 'query') return s.query.typeKey;
  if (s.kind === 'related' || s.kind === 'taxonomy') return s.typeKey;
  return null;
}

/**
 * Nhãn một dòng cho một item.
 *
 * `titleField` là khai báo của loại, nên nó đúng cả khi loại đó gọi tiêu đề là
 * `cau_hoi`. Rơi về `name` vì item của nguồn `taxonomy` là một DANH MỤC, không phải
 * entry — `data.name` là tên danh mục (xem `resolveTaxonomyTree`).
 */
function titleOf(data: Record<string, unknown>, titleField: string | null, slug?: string): string {
  for (const key of [titleField, 'title', 'name'].filter((k): k is string => Boolean(k))) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return slug ?? '[chưa đặt tiêu đề]';
}

/**
 * Khối có lọc theo đoạn động của URL không.
 *
 * Chỉ nguồn `query` mang `CollectionFilter`, nên chỉ nó cần hỏi — năm nguồn kia không
 * có chỗ nào khai `from`.
 */
function readsUrlSegment(spec: RepeatSpec): boolean {
  if (spec.source.kind !== 'query') return false;
  return (spec.source.query.filter ?? []).some(
    (f) => (f.k === 'taxonomy' || f.k === 'relation') && f.from === 'url',
  );
}

interface Body {
  repeat?: unknown;
  entryId?: unknown;
}

export async function POST(request: Request) {
  // `read`, không `write`: route này không đổi gì. Nhưng vẫn đòi một phiên —
  // xem docblock đầu file.
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const parsed = zRepeatSpec.safeParse(body.repeat);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Cấu hình lặp không hợp lệ: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim() },
      { status: 400 },
    );
  }
  const spec = parsed.data as RepeatSpec;

  const entryId = typeof body.entryId === 'string' ? body.entryId : undefined;
  const entry = entryId ? await getAdminEntry(entryId) : null;

  // Nói rõ khi câu hỏi không trả lời được, thay vì trả `matched: 0`.
  const needsEntry =
    (spec.source.kind === 'related' || spec.source.kind === 'field' || spec.source.kind === 'relation') &&
    !entry;
  const needsUrl = readsUrlSegment(spec);
  const needsContext = needsEntry || needsUrl || spec.source.kind === 'group-entries';

  if (needsContext) {
    return NextResponse.json({
      matched: null,
      preview: [],
      needsContext: needsUrl
        ? 'Khối này lọc theo đoạn động trên URL (danh mục của chính trang đang mở), nên chỉ đếm được khi render một địa chỉ thật. Mở trang danh mục để xem số đúng.'
        : spec.source.kind === 'group-entries'
          ? 'Nguồn này lấy danh mục từ khối lặp CHA, nên chỉ đếm được khi đang render trang thật.'
          : 'Nguồn này cần một bài đang mở. Gửi kèm entryId để đếm.',
    });
  }

  const items = await resolveRepeat(spec, {
    entry: entry ? repeatEntryContext(entry) : undefined,
  });

  const typeKey = typeKeyOf(spec);
  const titleField = typeKey
    ? ((await getCollectionTypes()).find((t) => t.key === typeKey)?.titleField ?? null)
    : null;

  return NextResponse.json({
    matched: items.length,
    preview: items.slice(0, PREVIEW_LIMIT).map((i) => ({
      key: i.key,
      title: titleOf(i.data, titleField, i.slug),
    })),
  });
}
