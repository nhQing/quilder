import 'server-only';

/**
 * Đọc/ghi bảng `ApiView`, và kiểm query của view theo cấu trúc loại.
 *
 * Kiểm query bằng CHÍNH `parsePublicParams` — cùng bộ đọc mà đường gọi thật dùng. Một
 * bộ kiểm riêng cho màn quản lý sẽ có ngày nhận một query mà API từ chối, và người phát
 * hiện là app mobile.
 */

import { prisma } from '@/lib/db';
import { checkViewInput, normalizeViewQuery, type ViewInput } from './api-view';
import { parsePublicParams } from './public-params';
import { getCollectionTypes } from './queries';

export interface ApiViewRow {
  id: string;
  key: string;
  name: string;
  typeKey: string;
  query: string;
  allow: string[];
  note: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Query đã chuẩn hoá có còn đọc được trên loại `typeKey` không. */
export async function checkViewQuery(
  typeKey: string,
  query: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const types = await getCollectionTypes();
  const type = types.find((t) => t.key === typeKey);
  if (!type) return { ok: false, error: `Không có loại nội dung "${typeKey}"` };
  const r = parsePublicParams(
    new URLSearchParams(query),
    typeKey,
    type.schema,
    (k) => types.find((t) => t.key === k)?.schema,
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function listApiViews(): Promise<ApiViewRow[]> {
  const rows = await prisma.apiView.findMany({ orderBy: [{ key: 'asc' }] });
  return rows.map(toRow);
}

type SaveResult = { ok: true; view: ApiViewRow } | { ok: false; status: number; error: string };

/**
 * Tạo (không có `id`) hoặc sửa một view. Kiểm theo ba lớp, rẻ trước: hình dạng ô nhập,
 * tham số lạ trong query, rồi query theo cấu trúc loại.
 */
export async function saveApiView(args: {
  id?: string;
  input: ViewInput;
  note?: string | null;
  actorSub: string;
}): Promise<SaveResult> {
  const input = { ...args.input, key: args.input.key.trim(), name: args.input.name.trim() };
  const shape = checkViewInput(input);
  if (!shape.ok) return { ok: false, status: 400, error: shape.error };

  const norm = normalizeViewQuery(input.query);
  if (!norm.ok) return { ok: false, status: 400, error: norm.error };

  const fit = await checkViewQuery(input.typeKey, norm.query);
  if (!fit.ok) return { ok: false, status: 400, error: fit.error };

  const clash = await prisma.apiView.findUnique({ where: { key: input.key }, select: { id: true } });
  if (clash && clash.id !== args.id) return { ok: false, status: 409, error: `Khoá "${input.key}" đã có view khác dùng` };

  const data = {
    key: input.key,
    name: input.name,
    typeKey: input.typeKey,
    query: norm.query,
    // Giữ thứ tự của danh sách gốc, bỏ trùng — thứ tự này là thứ hiện trong thông báo lỗi.
    allow: [...new Set(input.allow)],
    note: args.note?.trim() || null,
    updatedBy: args.actorSub,
  };

  if (args.id) {
    const before = await prisma.apiView.findUnique({ where: { id: args.id } });
    if (!before) return { ok: false, status: 404, error: 'Không có view này' };
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.apiView.update({ where: { id: args.id }, data });
      await tx.auditLog.create({
        data: {
          userId: args.actorSub, action: 'api-view.update', targetType: 'ApiView', targetId: r.id,
          meta: { key: r.key, previousKey: before.key, query: r.query, allow: r.allow },
        },
      });
      return r;
    });
    return { ok: true, view: toRow(row) };
  }

  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.apiView.create({ data });
    await tx.auditLog.create({
      data: {
        userId: args.actorSub, action: 'api-view.create', targetType: 'ApiView', targetId: r.id,
        meta: { key: r.key, typeKey: r.typeKey, query: r.query, allow: r.allow },
      },
    });
    return r;
  });
  return { ok: true, view: toRow(row) };
}

export async function deleteApiView(args: {
  id: string;
  actorSub: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const before = await prisma.apiView.findUnique({ where: { id: args.id } });
  if (!before) return { ok: false, status: 404, error: 'Không có view này' };
  await prisma.$transaction([
    prisma.apiView.delete({ where: { id: args.id } }),
    prisma.auditLog.create({
      data: {
        userId: args.actorSub, action: 'api-view.delete', targetType: 'ApiView', targetId: before.id,
        meta: { key: before.key, typeKey: before.typeKey, query: before.query, allow: before.allow },
      },
    }),
  ]);
  return { ok: true };
}

function toRow(r: {
  id: string; key: string; name: string; typeKey: string; query: string; allow: string[];
  note: string | null; updatedAt: Date; updatedBy: string | null;
}): ApiViewRow {
  return {
    id: r.id, key: r.key, name: r.name, typeKey: r.typeKey, query: r.query,
    allow: r.allow, note: r.note, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy,
  };
}
