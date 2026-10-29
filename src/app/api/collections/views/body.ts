import type { ViewInput } from '@/lib/collections/api-view';

/** Thân request tạo/sửa view → `ViewInput`. Chỉ kiểm KIỂU; luật nằm ở `saveApiView`. */
export async function readViewBody(
  request: Request,
): Promise<{ ok: true; input: ViewInput; note: string | null } | { ok: false; error: string }> {
  let raw: Record<string, unknown>;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'JSON không hợp lệ' };
  }
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : null);
  const key = str('key');
  const name = str('name');
  const typeKey = str('typeKey');
  const query = str('query') ?? '';
  if (key === null || name === null || typeKey === null) {
    return { ok: false, error: 'Thiếu key, name hoặc typeKey' };
  }
  const allow = raw.allow ?? [];
  if (!Array.isArray(allow) || !allow.every((a) => typeof a === 'string')) {
    return { ok: false, error: 'allow phải là mảng chuỗi' };
  }
  return { ok: true, input: { key, name, typeKey, query, allow }, note: str('note') };
}
