import { NextResponse } from 'next/server';

import { setupStatus } from '@/lib/setup/status';

/**
 * Trạng thái cài đặt cho màn `/builder/setup` — công khai, chỉ đọc.
 * Xem `src/lib/setup/status.ts` về việc cái gì được và không được trả ra.
 *
 * Site đã cài thì endpoint này coi như không tồn tại: 404, chỉ kèm `installed: true`
 * để màn cài đặt đang mở dở biết mà chuyển đi. Không lộ thêm env hay trạng thái DB
 * cho ai gõ thẳng vào khi màn cài đặt đã đóng.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = await setupStatus();
  if (status.installed) {
    return NextResponse.json({ installed: true }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
