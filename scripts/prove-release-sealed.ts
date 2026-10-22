/**
 * Chứng minh hợp đồng của Đợt 1: "release đã niêm phong".
 *
 * Hai câu, và cả hai phải đúng:
 *
 *  1. Sửa token, globals hay ảnh trong bản nháp KHÔNG đổi site đang chạy.
 *  2. Nâng cấp builder (đổi CSS trong code) KHÔNG đổi site đang chạy.
 *
 * Đây là lý do tồn tại của cả đợt, nên nó phải được ĐO chứ không phải được hứa.
 *
 * ## Vì sao sửa thẳng DB thay vì gọi API
 *
 * API tự gọi `revalidateTag`, nên đi qua API là đi qua đúng con đường mà bug KHÔNG
 * đi qua — test sẽ xanh vì cache, không vì niêm phong. Đường bypass là đường ĐỌC,
 * nên phải chọc vào đúng nguồn mà nó đọc.
 *
 * ## Vì sao không phải một test vitest
 *
 * `vitest.config.ts` chỉ include `src/**` và không có Postgres. Cùng khuôn với
 * `scripts/prove-rollback.ts`, và cùng lý do.
 *
 * Chạy: pnpm prove:sealed [baseUrl]
 */

import { PrismaClient } from '@prisma/client';

import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const BASE = process.argv[2] ?? 'http://localhost:3001';

let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    return;
  }
  failed += 1;
  console.log(`  ✗ THẤT BẠI: ${msg}`);
}

async function home(): Promise<string> {
  const res = await fetch(`${BASE}/`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET / → ${res.status}`);
  return res.text();
}

/**
 * Mọi chuỗi mồi mà script này chèn vào database.
 *
 * Bước hoàn nguyên kiểm sự VẮNG MẶT của từng chuỗi, chứ không so cả trang.
 *
 * ## Vì sao không so byte-for-byte cả HTML
 *
 * Bản đầu của script làm vậy và đỏ, nhưng vì tiếng ồn của công cụ chứ không vì hợp
 * đồng sai. Hai nguồn không tất định trong `next dev`, cả hai đã đo:
 *
 *  1. timestamp chống cache trên URL chunk — `webpack.js?v=1787051020396`
 *  2. **thông tin gỡ lỗi RSC** trong flight payload — thời gian thực thi của từng
 *     component (`"start":3.3686,"end":182.3789`) và owner stack
 *
 * Cái thứ hai không lọc được bằng một regex tử tế. Và một phép thử phải đỏ khi hợp
 * đồng sai, không đỏ khi framework in thêm số — nên phép so đúng là phép so thứ ta
 * thật sự quan tâm: chuỗi mồi đã biến mất, và database đã về giá trị cũ.
 */
const SENTINELS = ['SO-DA-DOI-BOI-PROVE', 'DA-DOI-BOI-PROVE', 'prove-sealed-x', 'DA-DOI'];

/** Gốc URL công khai của kho asset — để đọc lại object đã ghi. */
const BASE_S3 = (process.env.S3_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');

/** Khoá do script này tạo, xoá ở cuối. */
const cleanupKeys: string[] = [];

/**
 * Client S3 dựng TẠI CHỖ thay vì dùng `src/lib/assets/s3.ts`.
 *
 * Module đó khai `server-only`, vốn ném ngay khi được import ngoài bối cảnh RSC —
 * và đó là một rào chắn thật, không nên gỡ để chiều một script. `vitest` giải bằng
 * cách alias sang module rỗng; ở đây thì rẻ hơn là dựng lại client, vì script chỉ
 * cần hai lệnh đọc/xoá.
 *
 * Đường GHI thì cố ý đi qua HTTP `/api/assets` — xem `uploadViaApi`.
 */
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

/** Cookie phiên, lấy một lần rồi dùng lại. */
let cookie = '';

async function login(): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.BUILDER_EMAIL,
      password: process.env.BUILDER_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Đăng nhập thất bại: ${res.status}`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Đăng nhập không trả cookie');
}

/**
 * Tải ảnh lên QUA API, không gọi thẳng `uploadAsset()`.
 *
 * Khác chủ ý so với các phép thử khác trong file này. Chúng sửa thẳng DB vì đường
 * bypass cần kiểm là đường ĐỌC, nên phải chọc vào đúng nguồn nó đọc. Còn ở đây thứ
 * cần kiểm là một đường GHI MỚI, và nó phải được kiểm đúng như client dùng nó —
 * kể cả phần multipart và phần quyền.
 */
async function uploadViaApi(bytes: Uint8Array, fileName: string) {
  const form = new FormData();
  // `new Blob([bytes])` không qua được typecheck: `Uint8Array` có thể trỏ tới
  // `SharedArrayBuffer`, mà `Blob` chỉ nhận `ArrayBuffer`. Cắt ra một buffer mới là
  // cách nói với trình biên dịch điều ta vốn đã biết, và nó cũng đúng về ngữ nghĩa —
  // ta không muốn Blob chia sẻ bộ nhớ với mảng gọi vào.
  const body = bytes.slice().buffer as ArrayBuffer;
  form.append('file', new Blob([body]), fileName);
  const res = await fetch(`${BASE}/api/assets`, { method: 'POST', headers: { cookie }, body: form });
  const json = (await res.json()) as { ok?: boolean; asset?: Record<string, never>; error?: string };
  return { status: res.status, ...json };
}

/**
 * PNG hợp lệ nhỏ nhất, kích thước tuỳ ý.
 *
 * Dựng tại chỗ thay vì đọc một file có sẵn: script phải chạy được ở bất cứ đâu, và
 * nó cần HAI ảnh khác nội dung để chứng minh bất biến khoá.
 */
function pngBytes(w = 1, h = 1): Uint8Array {
  const b = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

async function main() {
  console.log(`Kiểm hợp đồng niêm phong release trên ${BASE}\n`);

  const before = await home();
  assert(before.includes('/mm-css/'), 'trang phục vụ bó CSS của release qua /mm-css/');
  assert(before.includes('<img'), 'trang có ảnh — nếu không thì phép thử ảnh dưới đây vô nghĩa');

  const site = await prisma.site.findFirstOrThrow({
    where: { activeReleaseId: { not: null } },
    select: { id: true, globals: true, activeReleaseId: true },
  });

  /* ── globals ─────────────────────────────────────────────────────────── */
  console.log('\nglobals:');
  const originalGlobals = site.globals;
  await prisma.site.update({
    where: { id: site.id },
    data: {
      globals: {
        ...(originalGlobals as Record<string, unknown>),
        hotline: 'SO-DA-DOI-BOI-PROVE',
      },
    },
  });
  assert(!(await home()).includes('SO-DA-DOI-BOI-PROVE'), 'sửa globals KHÔNG lên site');
  await prisma.site.update({
    where: { id: site.id },
    data: { globals: originalGlobals as object },
  });

  /* ── asset ───────────────────────────────────────────────────────────── */
  console.log('\nasset:');
  const asset = await prisma.asset.findFirst({ select: { id: true, url: true } });
  if (asset) {
    await prisma.asset.update({
      where: { id: asset.id },
      data: { url: '/img/DA-DOI-BOI-PROVE.png' },
    });
    assert(!(await home()).includes('DA-DOI-BOI-PROVE'), 'thay URL ảnh KHÔNG lên site');
    await prisma.asset.update({ where: { id: asset.id }, data: { url: asset.url } });
  } else {
    console.log('  – bỏ qua: không có asset nào');
  }

  /* ── token tự tạo ────────────────────────────────────────────────────── */
  console.log('\ntoken tự tạo:');
  const token = await prisma.token.create({
    data: { name: 'prove-sealed-x', value: '#abcdef', category: 'color', custom: true },
  });
  // Dò khai báo `--tên`, không dò tên trần: dưới `next dev`, React gắn giá trị trả về
  // của `readEmittedTokens` (cả bảng Token) vào payload RSC làm thông tin debug, nên
  // tên trần luôn có trong HTML dù CSS không khai báo nó. Bản production không có
  // phần debug đó. Token lọt thật thì phải thành một khai báo biến CSS.
  assert(!(await home()).includes('--prove-sealed-x'), 'thêm token tự tạo KHÔNG lên site');
  await prisma.token.delete({ where: { id: token.id } });

  /* ── component ───────────────────────────────────────────────────────── */
  console.log('\ncây component:');
  const preset = await prisma.preset.findFirst({ select: { id: true, name: true } });
  if (preset) {
    await prisma.preset.update({
      where: { id: preset.id },
      data: { name: `${preset.name} DA-DOI` },
    });
    assert(!(await home()).includes('DA-DOI'), 'đổi component KHÔNG lên site');
    await prisma.preset.update({ where: { id: preset.id }, data: { name: preset.name } });
  } else {
    console.log('  – bỏ qua: không có preset nào');
  }

  /* ── asset TẢI LÊN qua đường ghi mới của Đợt 2 ───────────────────────── */
  console.log('\nảnh tải lên (đường ghi mới):');

  // Đợt 1 đóng bốn đường bypass. Đợt 2 mở một đường GHI mới, nên nó phải chứng
  // minh lại tính chất đó chứ không được thừa hưởng.
  await login();
  const uploaded = await uploadViaApi(pngBytes(), 'prove-sealed-probe.png');

  if (!uploaded.ok || !uploaded.asset) {
    assert(false, `tải ảnh lên được: ${uploaded.status} ${uploaded.error ?? ''}`);
  } else {
    const a = uploaded.asset as unknown as {
      key: string; width: number; height: number; mime: string;
    };
    assert(true, `tải lên thành công, khoá ${a.key}`);
    assert(a.width === 1 && a.height === 1, 'kích thước đọc từ NỘI DUNG, không từ tên file');
    assert(a.mime === 'image/png', 'kiểu dò từ magic bytes');
    assert(
      !(await home()).includes(a.key),
      'ảnh vừa tải lên KHÔNG xuất hiện trên site (chưa publish)',
    );

    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: a.key }));
    assert(
      head.CacheControl?.includes('immutable') ?? false,
      'object mang cache-control immutable — header là VĨNH VIỄN, ghi sai thì phải tạo khoá mới',
    );
    assert(head.ContentType === 'image/png', `content-type trên object: ${head.ContentType}`);

    // Bất biến khoá: tải một ảnh KHÁC cùng tên file phải ra khoá khác, và object cũ
    // vẫn còn. Đó là điều kiện để `Release.assets` chụp metadata mà không chụp file
    // — release cũ trỏ tới khoá cũ, nên khoá cũ phải sống mãi.
    const other = await uploadViaApi(pngBytes(2, 3), 'prove-sealed-probe.png');
    const b = other.asset as unknown as { key: string } | undefined;
    if (b) {
      assert(b.key !== a.key, 'ảnh KHÁC nội dung, cùng tên file → KHOÁ KHÁC');
      const still = await fetch(`${BASE_S3}/${a.key}`, { cache: 'no-store' });
      assert(still.ok, 'object của khoá CŨ vẫn tải được sau khi có ảnh mới');
      cleanupKeys.push(b.key);
    }

    // Tải lại ĐÚNG file đầu: phải dùng lại, không tạo bản trùng.
    const again = await uploadViaApi(pngBytes(), 'prove-sealed-probe.png');
    const c = again.asset as unknown as { key: string; reused: boolean } | undefined;
    assert(c?.reused === true && c.key === a.key, 'tải lại đúng file thì DÙNG LẠI, không tạo bản trùng');

    cleanupKeys.push(a.key);
  }

  /* ── CSS tĩnh ────────────────────────────────────────────────────────── */
  console.log('\nCSS tĩnh:');
  const release = await prisma.release.findUniqueOrThrow({
    where: { id: site.activeReleaseId! },
    select: { cssHash: true, tokens: true, globals: true, assets: true, components: true },
  });
  assert(release.cssHash !== null, 'release đang chạy có bó CSS được niêm phong');
  assert(release.assets !== null, 'release đang chạy có ảnh chụp asset');
  assert(release.globals !== null, 'release đang chạy có ảnh chụp globals');
  assert(release.components !== null, 'release đang chạy có ảnh chụp component');

  if (release.cssHash) {
    const url = `${BASE}/mm-css/${release.cssHash}.css`;
    const res = await fetch(url, { cache: 'no-store' });
    assert(res.ok, `bó CSS của release tải được: ${res.status}`);
    assert(
      res.headers.get('cache-control')?.includes('immutable') ?? false,
      'bó CSS đặt cache immutable — an toàn vì hash nằm trong URL',
    );
    assert(
      before.includes(`/mm-css/${release.cssHash}.css`),
      'trang đang trỏ tới ĐÚNG bó của release, không phải bó của code hiện tại',
    );
  }

  /* ── hoàn nguyên ─────────────────────────────────────────────────────── */
  console.log('\nsau khi hoàn nguyên:');
  const after = await home();
  for (const s of SENTINELS) {
    assert(!after.includes(s), `không còn dấu vết "${s}" trên trang`);
  }

  // Và database đã thật sự về chỗ cũ — trang sạch có thể chỉ nghĩa là ảnh chụp
  // đang che một bản nháp bẩn, mà bản nháp bẩn sẽ lên site ở lần publish sau.
  const siteNow = await prisma.site.findUniqueOrThrow({
    where: { id: site.id },
    select: { globals: true },
  });
  assert(
    JSON.stringify(siteNow.globals) === JSON.stringify(originalGlobals),
    'Site.globals đã về giá trị cũ',
  );
  assert(
    (await prisma.token.count({ where: { name: 'prove-sealed-x' } })) === 0,
    'token mồi đã bị xoá khỏi bảng',
  );
  if (asset) {
    const assetNow = await prisma.asset.findUniqueOrThrow({
      where: { id: asset.id },
      select: { url: true },
    });
    assert(assetNow.url === asset.url, 'Asset.url đã về giá trị cũ');
  }
  if (preset) {
    const presetNow = await prisma.preset.findUniqueOrThrow({
      where: { id: preset.id },
      select: { name: true },
    });
    assert(presetNow.name === preset.name, 'Preset.name đã về giá trị cũ');
  }

  /* ── dọn object và hàng Asset do script tạo ──────────────────────────── */
  //
  // Bắt buộc, không phải lịch sự: object ghi với `immutable` thì rác không bao giờ
  // hết hạn, và mỗi lần chạy script sẽ để lại thêm một file trả tiền lưu trữ mãi.
  if (cleanupKeys.length) {
    console.log('\ndọn:');
    for (const key of cleanupKeys) {
      await prisma.asset.deleteMany({ where: { key } });
      await s3
        .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
        .catch(() => undefined);
    }
    const left = await prisma.asset.count({ where: { key: { in: cleanupKeys } } });
    assert(left === 0, `đã xoá ${cleanupKeys.length} asset thử nghiệm`);
  }

  if (failed) {
    console.log(`\n${failed} phép thử thất bại. Release CHƯA được niêm phong.`);
    process.exitCode = 1;
  } else {
    console.log('\nHợp đồng đúng: release đã niêm phong.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
