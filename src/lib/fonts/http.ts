import { NextResponse } from 'next/server';

import { FALLBACKS, FONT_ERROR_STATUS, FontError } from './types';

/** `FontError` → `{ error, code }` với mã HTTP của §10. Lỗi khác ném tiếp (500). */
export function fontErrorResponse(e: unknown): NextResponse {
  if (e instanceof FontError) {
    return NextResponse.json(
      { ...(e.extra ?? {}), error: e.message, code: e.code },
      { status: FONT_ERROR_STATUS[e.code] },
    );
  }
  throw e;
}

/** `sans|serif|mono` → chuỗi mặc định; chuỗi khác đi nguyên (service kiểm bằng `isSafeTokenValue`). */
export function resolveFallback(v: string): string {
  return Object.hasOwn(FALLBACKS, v) ? FALLBACKS[v as keyof typeof FALLBACKS] : v;
}
