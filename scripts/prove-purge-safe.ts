/**
 * Chứng minh "Xoá hoàn toàn" ảnh vừa có xác nhận (C3) vừa không làm vỡ rollback (E2),
 * trên một server đang chạy — đi đúng các đường HTTP mà builder dùng.
 *
 *   1. Ảnh A nằm trong release R1, rồi bị gỡ khỏi trang và publish R2. A chỉ còn ở R1.
 *   2. Xoá hoàn toàn A: thiếu token → 400, token rác → 409, token đúng → 200.
 *   3. Object của A CÒN trên S3 (R1 trong cửa sổ rollback), có hàng AssetHold.
 *   4. Lùi site về R1: trang công khai trỏ tới A và URL của A tải được.
 *   5. Đẩy R1 ra khỏi cửa sổ (30 lần publish + đồng hồ +91 ngày), chạy lượt dọn:
 *      object của A bị xoá, hàng AssetHold gỡ.
 *   6. Ảnh B: xem trước khi chưa ai dùng, rồi publish một release dùng B, rồi xoá với
 *      token cũ → 409, B còn nguyên.
 *
 * Chỉ chạy trên DB dùng một lần: script publish hàng chục release. `e2e-stack.mjs
 * proofs` gọi nó với địa chỉ stack; chạy tay thì phải có MM_E2E=1.
 *
 * Chạy: node --conditions=react-server --import tsx scripts/prove-purge-safe.ts http://localhost:3003
 */

import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

import { sweepAssetHolds } from '../src/lib/builder/asset-trash';

const BASE = process.argv[2] ?? 'http://localhost:3003';
const DAY = 86_400_000;

if (process.env.MM_E2E !== '1') {
  console.error('Script này publish hàng chục release. Chỉ chạy trên stack e2e (MM_E2E=1).');
  process.exit(2);
}

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
});
const BUCKET = process.env.S3_BUCKET ?? '';

let cookie = '';
let failures = 0;

function assert(ok: boolean, label: string, detail?: unknown) {
  console.log(`  ${ok ? '✓' : '✗ THẤT BẠI:'} ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log('    ', JSON.stringify(detail).slice(0, 400));
  }
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.BUILDER_EMAIL, password: process.env.BUILDER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Đăng nhập thất bại: ${res.status}`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

async function api<T = Record<string, unknown>>(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { status: res.status, json };
}

/** PNG nhỏ nhất, kích thước khác nhau → nội dung khác → khoá S3 khác. */
function pngBytes(w: number, h: number): ArrayBuffer {
  const b = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b.buffer;
}

async function upload(name: string) {
  const form = new FormData();
  const w = 2 + Math.floor(Math.random() * 9000);
  form.append('file', new Blob([pngBytes(w, w + 1)]), `${name}.png`);
  const res = await fetch(`${BASE}/api/assets`, { method: 'POST', headers: { cookie }, body: form });
  const json = (await res.json()) as { asset?: { id: string; key: string; url: string }; error?: string };
  if (!json.asset) throw new Error(`Tải ảnh thất bại: ${res.status} ${json.error ?? ''}`);
  return json.asset;
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function publish(pageId: string): Promise<string> {
  const r = await api<{ releaseId?: string }>('/api/publish', { pageIds: [pageId] });
  if (r.status !== 200 || !r.json.releaseId) throw new Error(`Publish thất bại: ${r.status} ${r.json.error ?? ''}`);
  return r.json.releaseId;
}

async function ops(pageId: string, list: unknown[], label: string) {
  const r = await api('/api/ops', { pageId, ops: list, label });
  return r;
}

function imageNode(id: string, parentId: string, assetId: string) {
  return {
    id, parentId, type: 'Image', name: id, children: [], effects: [], style: { base: {} },
    assetId, alt: 'ảnh thử xoá hoàn toàn', fit: { base: 'cover' },
  };
}

async function main() {
  console.log(`Kiểm xoá hoàn toàn ảnh (C3 + E2) trên ${BASE}\n`);
  await login();

  const page = await prisma.page.findFirstOrThrow({
    where: { slug: 'gioi-thieu', archivedAt: null },
    select: { id: true, slug: true, draftVersion: { select: { doc: true } } },
  });
  const rootId = (page.draftVersion?.doc as { rootId: string }).rootId;
  const site = await prisma.site.findFirstOrThrow({ select: { activeReleaseId: true } });
  const originalRelease = site.activeReleaseId;

  /* ── 1. A chỉ còn trong một release cũ ─────────────────────────────── */
  console.log('1. Ảnh A chỉ còn trong release cũ R1');
  const a = await upload('prove-purge-a');
  const nodeA = `prove-purge-a-${Date.now().toString(36)}`;
  const insA = await ops(page.id, [{ op: 'insertNode', parentId: rootId, index: 0, node: imageNode(nodeA, rootId, a.id) }], 'prove purge: thêm A');
  assert(insA.status === 200, 'chèn A vào /gioi-thieu', insA.json);
  const r1 = await publish(page.id);
  const rmA = await ops(page.id, [{ op: 'removeNode', nodeId: nodeA }], 'prove purge: gỡ A');
  assert(rmA.status === 200, 'gỡ A khỏi bản nháp', rmA.json);
  const r2 = await publish(page.id);
  assert(r1 !== r2, `R1 ${r1.slice(-6)} có A, R2 ${r2.slice(-6)} không có`);

  const trashA = await api<{ trashed?: string[] }>('/api/assets/trash', { ids: [a.id] });
  assert(trashA.json.trashed?.includes(a.id) === true, 'A vào thùng rác', trashA.json);

  /* ── 2. Token xác nhận ─────────────────────────────────────────────── */
  console.log('\n2. Xoá hoàn toàn A cần đúng token');
  const noToken = await api('/api/assets/purge', { ids: [a.id] });
  assert(noToken.status === 400, `thiếu token → 400 (nhận ${noToken.status})`);
  const junk = await api<{ reason?: string }>('/api/assets/purge', { ids: [a.id], confirmToken: 'abc' });
  assert(junk.status === 409 && junk.json.reason === 'malformed', `token rác → 409 malformed (nhận ${junk.status} ${junk.json.reason})`);

  const preview = await api<{
    batches: { ids: string[]; confirmToken: string }[];
    oldReleases: { id: string; inWindow?: boolean }[];
  }>('/api/assets/purge', { dryRun: true, ids: [a.id] });
  const r1Ref = preview.json.oldReleases?.find((r) => r.id === r1);
  assert(r1Ref?.inWindow === true, 'xem trước: R1 dùng A và nằm trong cửa sổ rollback', preview.json.oldReleases);
  const tokenA = preview.json.batches?.[0]?.confirmToken ?? '';

  const otherToken = await api<{ reason?: string }>('/api/assets/purge', { ids: [a.id, 'khong-ton-tai'], confirmToken: tokenA });
  assert(otherToken.status === 200, `token đúng dù gửi kèm id không xoá được (id lạ bị bỏ qua) → ${otherToken.status}`);

  /* ── 3. Object được giữ ────────────────────────────────────────────── */
  console.log('\n3. Object của A được giữ cho R1');
  const purged = otherToken.json as { purged?: string[]; held?: string[] };
  assert(purged.purged?.includes(a.id) === true, 'hàng Asset của A đã xoá');
  assert(purged.held?.includes(a.key) === true, 'phản hồi báo A được giữ', purged);
  assert(!(await prisma.asset.findUnique({ where: { id: a.id } })), 'A không còn trong thư viện');
  assert(await objectExists(a.key), 'object S3 của A còn nguyên');
  const hold = await prisma.assetHold.findUnique({ where: { key: a.key } });
  assert(hold?.releaseIds.includes(r1) === true, 'AssetHold ghi R1 là release giữ A', hold);

  /* ── 4. Lùi về R1 vẫn đúng ─────────────────────────────────────────── */
  console.log('\n4. Lùi site về R1');
  const back = await api('/api/publish', { action: 'rollback', releaseId: r1 });
  assert(back.status === 200, 'lùi về R1');
  // Kiểm MÃ TRẠNG THÁI trước: trang lỗi 500 của `next dev` cũng in URL ảnh trong thông
  // báo lỗi, nên chỉ dò chuỗi thì một trang hỏng vẫn qua — đúng chuyện đã xảy ra ngày 08/10.
  const pageRes = await fetch(`${BASE}/${page.slug}`, { cache: 'no-store' });
  const html = await pageRes.text();
  assert(pageRes.status === 200, `trang công khai của R1 trả 200 (nhận ${pageRes.status})`);
  const imgTag = html.match(/<img[^>]+>/g)?.find((t) => t.includes(encodeURIComponent(a.key)) || t.includes(a.key));
  assert(!!imgTag, 'trang công khai của R1 có thẻ <img> trỏ tới A');
  const img = await fetch(a.url, { cache: 'no-store' });
  assert(img.ok, `URL của A tải được sau khi xoá hoàn toàn (${img.status})`);
  await api('/api/publish', { action: 'rollback', releaseId: r2 });

  /* ── 5. Ra khỏi cửa sổ thì lượt dọn xoá object ─────────────────────── */
  console.log('\n5. R1 ra khỏi cửa sổ → lượt dọn xoá object');
  const early = await sweepAssetHolds();
  assert(!early.deleted.includes(a.key) && (await objectExists(a.key)), 'dọn lúc R1 còn trong cửa sổ: A vẫn giữ');
  for (let i = 0; i < 30; i++) await publish(page.id);
  const late = await sweepAssetHolds({ now: new Date(Date.now() + 91 * DAY) });
  assert(late.deleted.includes(a.key), 'sau 30 release và 91 ngày: lượt dọn xoá A', late);
  assert(!(await objectExists(a.key)), 'object S3 của A đã mất');
  assert(!(await prisma.assetHold.findUnique({ where: { key: a.key } })), 'hàng AssetHold của A đã gỡ');

  /* ── 6. Danh sách đổi giữa xem trước và xoá ────────────────────────── */
  console.log('\n6. Publish một release dùng B giữa lúc xem trước và lúc xoá');
  const b = await upload('prove-purge-b');
  await api('/api/assets/trash', { ids: [b.id] });
  const previewB = await api<{ batches: { confirmToken: string }[] }>('/api/assets/purge', { dryRun: true, ids: [b.id] });
  const tokenB = previewB.json.batches?.[0]?.confirmToken ?? '';
  assert(!!tokenB, 'xem trước B: xoá được, có token');

  const nodeB = `prove-purge-b-${Date.now().toString(36)}`;
  const insB = await ops(page.id, [{ op: 'insertNode', parentId: rootId, index: 0, node: imageNode(nodeB, rootId, b.id) }], 'prove purge: thêm B');
  assert(insB.status === 200, 'chèn B (đang ở thùng rác) vào trang', insB.json);
  const r3 = await publish(page.id);

  const stale = await api<{ reason?: string }>('/api/assets/purge', { ids: [b.id], confirmToken: tokenB });
  assert(stale.status === 409 && stale.json.reason === 'changed', `xoá B bằng token cũ → 409 changed (nhận ${stale.status} ${stale.json.reason})`);
  assert(!!(await prisma.asset.findUnique({ where: { id: b.id } })), 'hàng Asset của B còn');
  assert(await objectExists(b.key), 'object S3 của B còn');

  /* ── dọn ───────────────────────────────────────────────────────────── */
  console.log('\ndọn:');
  await ops(page.id, [{ op: 'removeNode', nodeId: nodeB }], 'prove purge: gỡ B');
  await api('/api/assets/restore', { ids: [b.id] });
  if (originalRelease) await api('/api/publish', { action: 'rollback', releaseId: originalRelease });
  console.log(`  ✓ gỡ B khỏi bản nháp, khôi phục B, site về release ban đầu (R3 ${r3.slice(-6)} để lại trong lịch sử)`);

  console.log(failures ? `\n${failures} phép thử thất bại.` : '\nXoá hoàn toàn có xác nhận và không làm vỡ rollback.');
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
