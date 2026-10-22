import 'server-only';

/**
 * Phần dùng chung của các route thùng rác: kiểm quyền + đọc body bằng zod.
 *
 * Token service (MCP) bị chặn ở đây: xoá/khôi phục/dọn ảnh chỉ dành cho phiên người.
 * Quyết định này cố ý — không có tool MCP cho thùng rác.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth, type Action } from '@/lib/auth/guard';
import type { AssetTrashActor } from '@/lib/builder/asset-trash';

export const MAX_BATCH = 200;

/** Mảng id không rỗng, khử trùng. `max` tính SAU khi khử trùng. */
export function idList(max: number) {
  return z
    .array(z.string().min(1, 'id không được rỗng'))
    .transform((a) => [...new Set(a)])
    .pipe(
      z
        .array(z.string())
        .min(1, 'Cần ít nhất 1 mục')
        .max(max, `Tối đa ${max} mục một lần`),
    );
}

export interface HumanAuth {
  actor: AssetTrashActor;
}

export async function requireHuman(action: Action): Promise<HumanAuth | NextResponse> {
  const auth = await requireAuth(action);
  if (auth instanceof NextResponse) return auth;
  if (auth.kind === 'service') {
    return NextResponse.json(
      { error: 'Token service không được dùng thùng rác ảnh' },
      { status: 403 },
    );
  }
  return { actor: { email: auth.email, sub: auth.sub } };
}

export async function readBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S> | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `"${issue.path.join('.')}": ` : '';
    return NextResponse.json({ error: `${where}${issue?.message ?? 'Đầu vào sai'}` }, { status: 400 });
  }
  return parsed.data;
}
