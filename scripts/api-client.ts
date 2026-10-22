/**
 * Gọi API của builder từ script.
 *
 * Script đăng nhập qua ĐÚNG đường mà con người dùng, rồi giữ cookie phiên. Cách
 * khác — một token dịch vụ đi vòng qua middleware — sẽ tạo ra một cửa thứ hai
 * vào hệ thống, và cửa đó không bao giờ được test kỹ như cửa chính.
 *
 * Biến môi trường: BUILDER_EMAIL, BUILDER_PASSWORD, E2E_BASE_URL.
 */

/*
 * Mặc định 3001 — CỔNG CỦA DỰ ÁN NÀY.
 *
 * Trước đây mặc định 3000, và 3000 là cổng của một dự án Next KHÁC trên máy dev
 * (lý do `next dev` ở đây tự nhảy sang 3001). Hệ quả: `pnpm seed:second` dựng
 * nháp xong rồi chết ở bước publish với câu "Đăng nhập thất bại: 404" — 404 vì
 * app kia không có `/api/auth/login`, không phải vì sai mật khẩu. Người đọc mất
 * thời gian đi kiểm tài khoản trong khi lỗi nằm ở cổng.
 *
 * Đây là chỗ THỨ BA cùng một cái bẫy (hai chỗ kia: `playwright.config.ts` và
 * `mcp/server.mjs`). Nếu còn chỗ thứ tư thì nên rút ra một hằng số dùng chung.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';

let cookie: string | null = null;

export async function login(): Promise<void> {
  const email = process.env.BUILDER_EMAIL;
  const password = process.env.BUILDER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Thiếu BUILDER_EMAIL / BUILDER_PASSWORD. Tạo tài khoản bằng:\n' +
        '  pnpm exec tsx scripts/create-user.ts <email> <mật-khẩu>',
    );
  }

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    // 404 ở đây gần như luôn là SAI CỔNG, không phải sai tài khoản: route
    // `/api/auth/login` tồn tại ở mọi bản của dự án này.
    const goiY =
      res.status === 404
        ? ` — không thấy /api/auth/login ở ${BASE}. Nhiều khả năng builder đang chạy ở cổng khác;`
          + ' kiểm dòng "- Local:" của `pnpm dev` rồi đặt E2E_BASE_URL cho khớp.'
        : '';
    throw new Error(`Đăng nhập thất bại: ${json.error ?? res.status}${goiY}`);
  }

  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('Server không trả cookie phiên');
  cookie = setCookie.split(';')[0]!;
}

export async function api<T = unknown>(
  path: string,
  body: unknown,
): Promise<T> {
  if (!cookie) await login();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookie! },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${path} → ${res.status}`);
  return json;
}

/** POST multipart (tải file) — cùng phiên đăng nhập với `api`. */
export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  if (!cookie) await login();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { cookie: cookie! }, body: form });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${path} → ${res.status}`);
  return json;
}
