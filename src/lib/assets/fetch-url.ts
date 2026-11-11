import 'server-only';

/**
 * Tải byte từ một URL do người dùng/AI đưa — dùng chung cho `upload_asset` (ảnh)
 * và `POST /api/fonts` (font).
 *
 * Server fetch URL tuỳ ý là cửa SSRF, nên: chỉ http(s), tên miền phải phân giải ra
 * địa chỉ công khai (chặn loopback, mạng riêng, link-local/metadata), chuyển hướng
 * đi tay và kiểm lại từng chặng, và đọc theo luồng để dừng ngay khi vượt trần.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { MAX_ASSET_BYTES } from '@/lib/builder/upload-asset';

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

export type FetchUrlResult =
  | { ok: true; bytes: Uint8Array; fileName: string }
  | { ok: false; status: number; error: string };

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIp(mapped[1] ?? '');
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') ||
    /^fe[89ab]/.test(v6)
  );
}

async function assertPublicHost(url: URL): Promise<string | null> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Chỉ nhận URL http hoặc https';
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return 'URL trỏ vào máy nội bộ';
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
      return 'URL trỏ vào địa chỉ nội bộ';
    }
  } catch {
    return `Không phân giải được tên miền ${host}`;
  }
  return null;
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * @param what danh từ dùng trong lời nhắn lỗi ("Ảnh", "Font").
 */
export async function fetchUrlBytes(
  sourceUrl: string,
  what = 'File',
  cap = MAX_ASSET_BYTES,
): Promise<FetchUrlResult> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return { ok: false, status: 400, error: `URL không hợp lệ: ${sourceUrl}` };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = await assertPublicHost(url);
    if (blocked) return { ok: false, status: 400, error: `${blocked}: ${url.href}` };

    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      return { ok: false, status: 502, error: `Không tải được ${url.href}: ${String(e)}` };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, status: 502, error: `Tải ${url.href} chuyển hướng không có đích` };
      try {
        url = new URL(loc, url);
      } catch {
        return { ok: false, status: 502, error: `Tải ${url.href} chuyển hướng tới URL hỏng` };
      }
      continue;
    }
    if (!res.ok) {
      return { ok: false, status: 502, error: `Tải ${url.href} trả về ${res.status}` };
    }

    const bytes = await readCapped(res, cap);
    if (!bytes) {
      return { ok: false, status: 413, error: `${what} ở URL đó vượt ${cap / 1024 / 1024} MB` };
    }
    const fileName = decodeURIComponent(url.pathname.split('/').pop() ?? '') || 'download';
    return { ok: true, bytes, fileName };
  }
  return { ok: false, status: 502, error: `Quá ${MAX_REDIRECTS} lần chuyển hướng khi tải ${sourceUrl}` };
}
