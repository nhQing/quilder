import { NextResponse } from 'next/server';

import { crossOrigin, type FormHandler } from '@/lib/project/forms';
import forms from '@project/forms';

/**
 * `POST /api/forms/<key>` — chạy bộ nhận form mà gói dự án khai (`projects/<tên>/forms.ts`).
 * Xem `src/lib/project/forms.ts`.
 *
 * Công khai (khách của site gửi form), nên mọi kiểm tra — captcha, giới hạn tần suất,
 * validate — là việc của handler. Ở đây chỉ chặn hai thứ chung cho mọi handler: khoá
 * không có, và request từ origin khác (form của builder luôn gửi cùng origin).
 */

export const dynamic = 'force-dynamic';

const KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;

function handlerFor(key: string): FormHandler | undefined {
  if (!KEY_RE.test(key)) return undefined;
  const table = forms as Record<string, FormHandler>;
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const handler = handlerFor(key);
  if (!handler) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (crossOrigin(request)) return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });

  try {
    return await handler(request, { key });
  } catch {
    // Không log chi tiết: handler làm việc với dữ liệu cá nhân, và message lỗi của
    // thư viện hay mang nguyên payload.
    console.error(`[forms] handler "${key}" ném lỗi`);
    return NextResponse.json(
      { error: 'internal', userMessage: 'Hệ thống đang bận. Bạn thử lại sau ít phút giúp.' },
      { status: 500 },
    );
  }
}
