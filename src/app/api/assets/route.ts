import { NextResponse } from 'next/server';

/**
 * Tải ảnh lên kho asset, và liệt kê ảnh đang có.
 *
 * Vỏ HTTP mỏng quanh `uploadAsset()` — luật nằm ở `@/lib/builder/upload-asset`, vì
 * tool MCP `upload_asset` cũng gọi đúng hàm ấy.
 *
 * ## Vì sao multipart chứ không JSON + base64
 *
 * Base64 phình 33% và bắt cả hai đầu phải giữ toàn bộ ảnh trong bộ nhớ dưới dạng
 * chuỗi. Với đường MCP thì tệ hơn nhiều: một ảnh 400 KB thành ~530 KB văn bản, tức
 * khoảng 130 nghìn token nếu nó đi qua context của model. `mcp/server.mjs` chạy
 * trên máy người dùng nên nó đọc file rồi POST thẳng vào đây — byte không bao giờ
 * đi qua model.
 */

import { normalizeFolder } from '@/lib/assets/folder';
import { requireAuth } from '@/lib/auth/guard';
import { MAX_ASSET_BYTES, uploadAsset } from '@/lib/builder/upload-asset';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  /*
   * Ba trạng thái, không phải hai: không có `folder` = không lọc; `folder=` (rỗng)
   * = nhóm chưa phân loại; `folder=x` = nhánh x. Gộp hai cái đầu lại sẽ làm "xem
   * ảnh chưa phân loại" trở thành "xem tất cả".
   */
  const raw = new URL(request.url).searchParams.get('folder');
  let where = {};
  if (raw !== null) {
    const folder = normalizeFolder(raw);
    if (!folder.ok) return NextResponse.json({ error: folder.error }, { status: 400 });
    where = folder.value === null
      ? { folder: null }
      : { OR: [{ folder: folder.value }, { folder: { startsWith: `${folder.value}/` } }] };
  }

  const rows = await prisma.asset.findMany({
    // Ảnh trong thùng rác không hiện ở picker/lưới; chỉ là cờ hiển thị.
    where: { AND: [where, { trashedAt: null }] },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, key: true, url: true, mime: true,
      width: true, height: true, bytes: true, createdAt: true, folder: true,
    },
  });

  return NextResponse.json({
    assets: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
}

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Cần multipart/form-data với trường "file"' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Thiếu trường "file"' }, { status: 400 });
  }

  // Kiểm kích thước TRƯỚC khi đọc vào bộ nhớ. `arrayBuffer()` nạp toàn bộ file, nên
  // kiểm sau đó là đã trả giá rồi mới từ chối.
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json(
      { error: `Tối đa ${MAX_ASSET_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  // Trường form là chuỗi hoặc vắng mặt; `uploadAsset` tự chuẩn hoá và tự từ chối.
  const folderField = form.get('folder');

  const result = await uploadAsset({
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    actorEmail: auth.email,
    actorSub: auth.sub,
    folder: typeof folderField === 'string' ? folderField : null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, asset: result.asset });
}
