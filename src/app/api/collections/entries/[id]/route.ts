import { NextResponse } from 'next/server';

/**
 * Sửa entry (PATCH), đổi trạng thái (POST), lưu trữ / xoá hẳn (DELETE).
 *
 * Hai method chứ không một: "lưu nháp" và "đăng" là hai hành động khác nhau trong
 * đầu người dùng, và gộp chúng vào một body có cờ `publish` là cách chắc chắn để
 * một lần lưu nháp vô tình đưa bài lên sóng.
 */

import { requireAuth } from '@/lib/auth/guard';
import {
  archiveEntry, purgeEntry, setEntryLocaleState, setEntryStatus, unarchiveEntry, updateEntry,
} from '@/lib/collections/entry-write';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  let body: { data?: unknown; i18n?: Record<string, unknown>; taxonomyIds?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const result = await updateEntry({
    entryId: id,
    data: body.data,
    i18n: body.i18n,
    taxonomyIds: body.taxonomyIds,
    actorEmail: auth.email,
    actorSub: auth.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, entry: result.entry });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  let body: {
    status?: 'draft' | 'published';
    publishedAt?: string | null;
    /** Có mặt = đang nói về MỘT ngôn ngữ, không phải bản gốc. */
    locale?: string;
    /** Chỉ cùng `locale`. `null` = bỏ slug riêng, quay về slug gốc. */
    slug?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  const at = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null ? null : new Date(v);

  /*
   * Slug của một ngôn ngữ đi cùng trạng thái đăng ở ĐÂY, không ở PATCH.
   *
   * Ranh giới của file này là "nội dung ở PATCH, trạng thái ở POST", và slug riêng
   * của một ngôn ngữ nằm cùng hàng `EntryLocale` với `status`/`publishedAt` — nó là
   * trạng thái công bố, không phải nội dung. Tách hai nửa của một hàng ra hai method
   * nghĩa là hai lượt ghi, hai dòng audit, và một cửa sổ để chúng lệch nhau.
   *
   * `status` KHÔNG bắt buộc ở nhánh này: đổi riêng slug của bản tiếng Anh là một
   * việc có thật, và bắt kèm `status` mời chỗ gọi gửi lại một trạng thái nó không
   * định đổi.
   */
  if (body.locale !== undefined) {
    if (body.status !== undefined && body.status !== 'draft' && body.status !== 'published') {
      return NextResponse.json({ error: 'status phải là draft hoặc published' }, { status: 400 });
    }
    const out = await setEntryLocaleState({
      entryId: id,
      locale: body.locale,
      slug: body.slug,
      status: body.status,
      publishedAt: at(body.publishedAt),
      actorEmail: auth.email,
      actorSub: auth.sub,
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true, entry: out.entry });
  }

  if (body.status !== 'draft' && body.status !== 'published') {
    return NextResponse.json({ error: 'status phải là draft hoặc published' }, { status: 400 });
  }

  const result = await setEntryStatus({
    entryId: id,
    status: body.status,
    publishedAt: at(body.publishedAt),
    actorEmail: auth.email,
    actorSub: auth.sub,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, entry: result.entry });
}

/**
 * DELETE = LƯU TRỮ, không phải xoá hẳn.
 *
 * `?purge=1` mới là xoá hẳn, và nó chỉ chạy được với entry đã ở trong lưu trữ —
 * luật đó nằm trong `purgeEntry`, không ở đây. `?restore=1` bỏ lưu trữ.
 *
 * Vì sao động từ mặc định là an toàn: bên gọi là một cú bấm trong UI và một dòng
 * dọn dẹp trong e2e. Nếu mặc định là xoá hẳn thì một trong hai chỗ đó sẽ làm mất
 * bài viết thật, và chỗ nào thì chỉ biết sau khi đã mất.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const sp = new URL(request.url).searchParams;

  if (sp.get('purge') === '1') {
    const result = await purgeEntry({ entryId: id, actorSub: auth.sub });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, purged: true });
  }

  const result =
    sp.get('restore') === '1'
      ? await unarchiveEntry({ entryId: id, actorEmail: auth.email, actorSub: auth.sub })
      : await archiveEntry({ entryId: id, actorEmail: auth.email, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, entry: result.entry });
}
