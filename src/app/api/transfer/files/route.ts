import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { MAX_ASSET_BYTES } from '@/lib/builder/upload-asset';
import { storeImportFile } from '@/lib/transfer/files';
import { issue } from '@/lib/transfer/guides';

export const dynamic = 'force-dynamic';

/**
 * Tải MỘT file của gói lên kho ảnh — mỗi request ≤ 10 MB, cùng cỡ thư viện ảnh đã gửi được qua
 * proxy hôm nay (spec §6). Logic kiểm sha256 và khoá nằm ở `storeImportFile`.
 */
export async function POST(req: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const sha256 = String(form?.get('sha256') ?? '');
  const name = String(form?.get('name') ?? '');
  // Thư mục do người dùng chọn, chuyển nguyên; uploadAsset chuẩn hoá và từ chối giá trị sai.
  const folder = String(form?.get('folder') ?? '') || null;
  if (!(file instanceof Blob) || !/^[0-9a-f]{64}$/.test(sha256) || !name) {
    return NextResponse.json({ error: 'Thiếu file, sha256 hoặc tên' }, { status: 400 });
  }

  // Từ chối sớm theo cỡ khai của multipart, trước khi đọc byte vào bộ nhớ.
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json(
      { error: `Tối đa ${MAX_ASSET_BYTES / 1024 / 1024} MB`, issues: [issue('file-too-large', 'block', { items: [{ label: name }] })] },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await storeImportFile({ bytes, sha256, name, folder, actor: { email: auth.email, sub: auth.sub } });
  return NextResponse.json(r.body, { status: r.status });
}
