import { NextResponse } from 'next/server';

/**
 * Cây thư mục ảo: đọc, tạo, đổi tên, xoá.
 *
 * ## Ba mức quyền khác nhau trên một route, và vì sao
 *
 *  - `GET` cần `write` — cây thư mục chỉ có ích cho người sắp xếp được kho.
 *  - `POST` cần `write` — tạo một thư mục rỗng không chạm ảnh nào, hoàn tác bằng
 *    một lần xoá.
 *  - `PATCH` (đổi tên) cần `admin` — nó viết lại đường dẫn của hàng loạt ảnh cùng
 *    lúc và không có nút hoàn tác.
 *  - `DELETE` cần `write` **cộng quyền sở hữu**: người tạo xoá được thư mục của
 *    mình, admin xoá được mọi thứ. Luật ở `mayDeleteFolder`, không ở đây — route
 *    chỉ nói cho tầng lib biết người gọi có phải admin không.
 *
 * Vì sao xoá nhẹ hơn đổi tên dù cả hai đều chạm nhiều ảnh: xoá đưa ảnh về "Chưa
 * phân loại", một trạng thái nhìn thấy được và xếp lại được. Đổi tên rải ảnh vào
 * một cây mới mà không ai nhớ hình dạng cũ.
 */

import { requireAuth } from '@/lib/auth/guard';
import {
  createFolder,
  deleteFolder,
  listFolders,
  renameFolder,
} from '@/lib/builder/asset-folders';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json(await listFolders());
}

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  let body: { path?: string };
  try {
    body = (await request.json()) as { path?: string };
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  if (!body.path) return NextResponse.json({ error: 'Cần "path"' }, { status: 400 });

  const result = await createFolder({ path: body.path, actorSub: auth.sub });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Trả lại đường dẫn ĐÃ chuẩn hoá: người dùng gõ "Trang chủ", thư mục thật tên
  // `trang-chu`, và giao diện phải điều hướng tới cái thứ hai.
  return NextResponse.json({ ok: true, path: result.path });
}

export async function PATCH(request: Request) {
  const auth = await requireAuth('admin');
  if (auth instanceof NextResponse) return auth;

  let body: { from?: string; to?: string };
  try {
    body = (await request.json()) as { from?: string; to?: string };
  } catch {
    return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  }

  if (!body.from || !body.to) {
    return NextResponse.json({ error: 'Cần cả "from" và "to"' }, { status: 400 });
  }

  const result = await renameFolder({ from: body.from, to: body.to, actorSub: auth.sub });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, moved: result.moved });
}

export async function DELETE(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;

  const path = new URL(request.url).searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'Cần tham số "path"' }, { status: 400 });

  const result = await deleteFolder({
    path,
    actorSub: auth.sub,
    isAdmin: auth.role === 'admin',
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // `moved` là số ảnh đã về Chưa phân loại — giao diện nói lại con số đó, vì "đã
  // xoá thư mục" một mình sẽ để người dùng đoán ảnh đi đâu.
  return NextResponse.json({ ok: true, moved: result.moved });
}
