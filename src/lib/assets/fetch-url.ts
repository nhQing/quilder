import 'server-only';

/**
 * Tải byte từ một URL do người dùng/AI đưa — dùng cho `POST /api/fonts` (font).
 * `upload_asset` cố ý KHÔNG dùng hàm này (giữ nguyên hành vi cũ: nó tải được cả host nội bộ).
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
  | { ok: false; status: number; error: string; code?: 'too_large' };

function isPrivateV4(a: number, b: number, c = 0): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** IPv6 → 16 byte; `null` nếu không đọc được. Nhận cả đuôi dạng a.b.c.d. */
function parseV6(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0] ?? '';
  const tail = /(d+).(d+).(d+).(d+)$/.exec(text);
  if (tail) {
    const o = tail.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    text = text.slice(0, tail.index) +
      ((o[0]! << 8) | o[1]!).toString(16) + ':' + ((o[2]! << 8) | o[3]!).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === '' ? [] : h.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...rest];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    out.push(n >> 8, n & 255);
  }
  return out.length === 16 ? out : null;
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
    return isPrivateV4(a, b, c);
  }
  const x = parseV6(ip);
  if (!x) return true; // không đọc được thì coi là không an toàn
  const zeros = (n: number) => x.slice(0, n).every((v) => v === 0);
  // ::ffff:0:0/96 (IPv4-mapped, URL parser đổi sang dạng hex), ::/96 (IPv4-compatible),
  // 64:ff9b::/96 (NAT64): kiểm IPv4 nhúng ở 4 byte cuối.
  const mapped = zeros(10) && x[10] === 0xff && x[11] === 0xff;
  const nat64 = x[0] === 0 && x[1] === 0x64 && x[2] === 0xff && x[3] === 0x9b && x.slice(4, 12).every((v) => v === 0);
  if (mapped || zeros(12) || nat64) return isPrivateV4(x[12]!, x[13]!, x[14]!);
  // 2002::/16 (6to4): IPv4 nằm ở byte 2..5.
  if (x[0] === 0x20 && x[1] === 0x02) return isPrivateV4(x[2]!, x[3]!, x[4]!);
  return (
    (x[0]! & 0xfe) === 0xfc || // fc00::/7
    (x[0] === 0xfe && (x[1]! & 0xc0) === 0x80) || // fe80::/10
    (x[0] === 0xfe && (x[1]! & 0xc0) === 0xc0) || // fec0::/10
    x[0] === 0xff // multicast
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
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) {
      return { ok: false, status: 502, error: `Tải ${url.href} trả về ${res.status}` };
    }

    const bytes = await readCapped(res, cap);
    if (!bytes) {
      return { ok: false, status: 413, code: 'too_large', error: `${what} ở URL đó vượt ${cap / 1024 / 1024} MB` };
    }
    let fileName = url.pathname.split('/').pop() ?? '';
    try {
      fileName = decodeURIComponent(fileName);
    } catch {
      /* giữ nguyên dạng mã hoá */
    }
    fileName ||= 'download';
    return { ok: true, bytes, fileName };
  }
  return { ok: false, status: 502, error: `Quá ${MAX_REDIRECTS} lần chuyển hướng khi tải ${sourceUrl}` };
}
