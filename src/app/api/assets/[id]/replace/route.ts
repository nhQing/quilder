import { NextResponse } from 'next/server';

/**
 * Thay file của một ảnh, giữ nguyên assetId — vỏ HTTP của `replaceAsset()`.
 *
 * Multipart (trường `file`, tuỳ chọn `name`) vì cùng lý do với `POST /api/assets`: tool
 * MCP `replace_asset` với `filePath` để `mcp/server.mjs` đọc file trên máy người dùng và
 * POST thẳng vào đây — byte không đi qua context của model.
 */

import { requireAuth } from '@/lib/auth/guard';
import { replaceAsset } from '@/lib/builder/replace-asset';
import { MAX_ASSET_BYTES } from '@/lib/builder/upload-asset';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Cần multipart/form-data với trường "file"' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Thiếu trường "file"' }, { status: 400 });
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: `Tối đa ${MAX_ASSET_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }
  const name = form.get('name');

  const result = await replaceAsset({
    assetId: id,
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    name: typeof name === 'string' && name.trim() ? name : undefined,
    actorSub: auth.sub,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.existingAssetId ? { existingAssetId: result.existingAssetId } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, asset: result.asset });
}
