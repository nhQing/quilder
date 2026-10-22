/**
 * Phần chạy ở TRÌNH DUYỆT của màn nhập: mở zip, kiểm sha256 từng file, và đọc phản hồi của
 * server mà không tin nó là JSON — proxy phía trước app trả trang HTML khi chặn (spec §9, G1).
 */

import { strFromU8, unzipSync } from 'fflate';

import { issue, type TransferIssue } from './guides';
import { parseBundle, type PageBundle } from './manifest';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function classifyResponse(res: { status: number; contentType: string | null; bodyText: string; requestBytes: number }):
  | { ok: true; data: unknown }
  | { ok: false; issues: TransferIssue[]; error: string } {
  const isJson = (res.contentType ?? '').includes('application/json');
  if (!isJson) {
    const error = `Máy chủ trả ${res.status} không phải từ app`;
    // Chỉ 413 mới là "proxy chặn request lớn". 502/504 hay trang đăng nhập (hết phiên) cũng là
    // HTML, nhưng bảo người dùng đi sửa client_max_body_size thì sai hướng.
    if (res.status === 413) {
      return { ok: false, error, issues: [issue('proxy-too-large', 'block', { vars: { size: mb(res.requestBytes) } })] };
    }
    return {
      ok: false, error,
      issues: [issue('network', 'block', { detail: `${error} (có thể hết phiên đăng nhập hoặc máy chủ quá tải)` })],
    };
  }
  let data: { error?: string; issues?: TransferIssue[] };
  try {
    data = JSON.parse(res.bodyText);
  } catch {
    return { ok: false, error: 'Phản hồi hỏng', issues: [issue('network', 'block')] };
  }
  if (res.status >= 200 && res.status < 300) return { ok: true, data };
  return { ok: false, error: data.error ?? `Lỗi ${res.status}`, issues: data.issues?.length ? data.issues : [] };
}

async function send(url: string, init: RequestInit, requestBytes: number) {
  let res: Response;
  let bodyText: string;
  try {
    res = await fetch(url, init);
    bodyText = await res.text();
  } catch {
    // Huỷ chủ động (đóng hộp thoại) không phải mất mạng: người gọi cần phân biệt để im lặng dừng.
    if (init.signal?.aborted) return { ok: false as const, error: 'Đã huỷ', issues: [], aborted: true as const };
    return { ok: false as const, error: 'Mất kết nối', issues: [issue('network', 'block')] };
  }
  return classifyResponse({ status: res.status, contentType: res.headers.get('content-type'), bodyText, requestBytes });
}

export function postJson(url: string, body: unknown, signal?: AbortSignal) {
  const text = JSON.stringify(body);
  // Cỡ request tính bằng byte UTF-8 (chữ có dấu > 1 byte) — số này hiện ở hướng dẫn G1.
  return send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, signal }, new TextEncoder().encode(text).length);
}

export function postFile(url: string, form: FormData, bytes: number, signal?: AbortSignal) {
  return send(url, { method: 'POST', body: form, signal }, bytes);
}

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function openBundle(zip: Uint8Array): Promise<
  { ok: true; bundle: PageBundle; fileOf: (entry: string) => Uint8Array } | { ok: false; issues: TransferIssue[] }
> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    return { ok: false, issues: [issue('file-corrupt', 'block', { detail: 'File không phải gói .zip hợp lệ.' })] };
  }
  const raw = files['manifest.json'];
  if (!raw) return { ok: false, issues: [issue('file-corrupt', 'block', { detail: 'Gói thiếu manifest.json.' })] };
  let parsed: ReturnType<typeof parseBundle>;
  try {
    parsed = parseBundle(JSON.parse(strFromU8(raw)));
  } catch {
    return { ok: false, issues: [issue('file-corrupt', 'block', { detail: 'manifest.json không đọc được.' })] };
  }
  if (!parsed.ok) return { ok: false, issues: [issue('file-corrupt', 'block', { detail: parsed.error })] };

  const bad: string[] = [];
  const checked = new Set<string>();
  for (const a of parsed.bundle.assets) {
    if (checked.has(a.file)) continue;
    checked.add(a.file);
    const bytes = files[a.file];
    if (!bytes || (await sha256hex(bytes)) !== a.sha256) bad.push(a.name);
  }
  if (bad.length) return { ok: false, issues: [issue('file-corrupt', 'block', { items: bad.map((label) => ({ label })) })] };
  return { ok: true, bundle: parsed.bundle, fileOf: (entry) => files[entry]! };
}
