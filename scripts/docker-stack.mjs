/**
 * Dựng và chạy toàn bộ dự án bằng Docker, một lệnh.
 *
 *   node scripts/docker-stack.mjs up      # build + migrate + chạy, rồi kiểm là sống
 *   node scripts/docker-stack.mjs build   # chỉ build image
 *   node scripts/docker-stack.mjs down    # tắt app, GIỮ postgres/minio và dữ liệu
 *   node scripts/docker-stack.mjs logs    # theo log của app
 *
 * hoặc qua pnpm: `pnpm docker:up`, `pnpm docker:build`, `pnpm docker:down`, `pnpm docker:logs`.
 *
 * ## Vì sao là `.mjs` chứ không phải `.sh` hay `.ps1`
 *
 * Máy dev là Windows, deploy là Linux. Một script bash không chạy được trong
 * PowerShell, một script PowerShell không chạy trên server; giữ cả hai bản là giữ hai
 * bản của một quy trình, và bản ít dùng hơn sẽ trôi. Node có sẵn ở cả hai nơi và
 * `node:child_process` không quan tâm shell nào đang gọi nó.
 *
 * ## Vì sao KHÔNG chỉ là `docker compose up --build`
 *
 * Ba việc compose không làm được, và cả ba đều từng làm mất thời gian thật:
 *
 *  1. **Đổi hostname trong biến môi trường.** Trong container, `localhost` là chính
 *     container đó. `DATABASE_URL` trỏ `localhost:5433` sẽ nối vào hư không, và lỗi
 *     hiện ra là "không kết nối được DB" — không nói gì về nguyên nhân thật.
 *  2. **Tạo bucket MinIO.** Bucket không tự sinh; thiếu nó thì app khởi động bình
 *     thường rồi lỗi ở lần tải ảnh đầu tiên, tức giữa một phiên làm việc.
 *  3. **Chạy migration đúng một lần.** Entrypoint cố ý không migrate (xem
 *     `entrypoint.sh`), nên phải có ai đó làm việc đó.
 *
 * Mỗi bước dưới đây in ra nó đang làm gì và vì sao, để khi đỏ thì biết đỏ ở đâu.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { composeName } from './compose-name.mjs';

const APP_PORT = 3002;
const IMAGE = 'quilder:local';
const MIGRATE_IMAGE = 'quilder:migrate';
const BUCKET_FALLBACK = 'quilder-assets';
/** Tiền tố container của stack dev — xem scripts/compose-name.mjs. */
const STACK = composeName();

/** Biến bắt buộc — cùng danh sách mà `entrypoint.sh` kiểm, cố ý trùng. */
const REQUIRED = [
  'DATABASE_URL',
  'AUTH_SECRET',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_PUBLIC_BASE_URL',
];

let step = 0;
const say = (msg) => console.log(`\n[${++step}] ${msg}`);
const detail = (msg) => console.log(`    ${msg}`);

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/** Chạy một lệnh, in trực tiếp ra terminal, ném nếu exit code khác 0. */
function run(cmd, args, { quiet = false } = {}) {
  const res = spawnSync(cmd, args, {
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
  });
  if (res.error) fail(`không chạy được \`${cmd}\`: ${res.error.message}`);
  if (res.status !== 0) {
    if (quiet) {
      process.stderr.write(res.stdout ?? '');
      process.stderr.write(res.stderr ?? '');
    }
    fail(`\`${cmd} ${args.join(' ')}\` thoát với mã ${res.status}`);
  }
  return (res.stdout ?? '').toString();
}

/** Như `run` nhưng KHÔNG ném — dùng cho lệnh mà thất bại là một kết quả hợp lệ. */
function tryRun(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  return {
    ok: res.status === 0,
    out: (res.stdout ?? '').toString() + (res.stderr ?? '').toString(),
  };
}

/**
 * Đọc `.env` thành map.
 *
 * Parser tối giản có chủ đích: chỉ `KEY=VALUE`, bỏ dấu nháy ngoài cùng. Không hỗ trợ
 * nội suy `${...}` — nếu ai đó dùng nó thì `.env.docker` sinh ra sẽ khác `.env`, và
 * đó là loại lệch không ai tìm ra. Compose cũng đọc lại chính `.env`, nên file này
 * chỉ dùng để BIẾT giá trị, không phải để truyền chúng.
 */
function readEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/* ── Bước 0: điều kiện cần ─────────────────────────────────────────────── */

function preflight() {
  say('Kiểm điều kiện cần');

  const version = tryRun('docker', ['version', '--format', '{{.Server.Version}}']);
  if (!version.ok) {
    fail(
      'Docker chưa chạy. Mở Docker Desktop rồi thử lại.\n' +
        `  chi tiết: ${version.out.trim().split('\n')[0] ?? '(không có)'}`,
    );
  }
  detail(`Docker Engine ${version.out.trim()}`);

  if (!existsSync('.env')) {
    fail('Không có `.env`. Chạy `cp .env.example .env` rồi điền, xem README mục "Chạy local".');
  }

  const env = readEnv('.env');
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    fail(
      `\`.env\` thiếu ${missing.length} biến: ${missing.join(', ')}\n` +
        '  Đây đúng là danh sách `entrypoint.sh` kiểm; thiếu thì container sẽ tự thoát.',
    );
  }
  detail(`.env đủ ${REQUIRED.length} biến bắt buộc`);
  return env;
}

/* ── Bước 1: .env.docker ───────────────────────────────────────────────── */

/**
 * Sinh `.env.docker` — chỉ những biến phải KHÁC khi chạy trong container.
 *
 * Đây là bước dễ bị bỏ qua nhất và là bước hay hỏng nhất. Trong container,
 * `localhost` là chính container đó, nên mọi địa chỉ `localhost` trong `.env` (vốn
 * viết cho `pnpm dev` trên máy thật) phải đổi sang tên service của compose.
 *
 * Chỉ đổi HAI biến, và có ranh giới rõ:
 *
 *  - `DATABASE_URL`: server nối tới DB → `postgres:5432` (cổng NỘI BỘ, không phải
 *    5433 — 5433 chỉ là cổng publish ra máy thật).
 *  - `S3_ENDPOINT`: server nối tới kho asset → `minio:9000`, và CHỈ khi nó đang trỏ
 *    localhost. Trỏ AWS thật thì để nguyên.
 *
 * `S3_PUBLIC_BASE_URL` thì **KHÔNG được đổi**: đó là URL mà TRÌNH DUYỆT tải ảnh, và
 * trình duyệt chạy trên máy thật. Đổi nó thành `minio:9000` là mọi ảnh 404 trong khi
 * server vẫn báo upload thành công — một lỗi rất khó lần ra vì hai nửa đều "đúng".
 */
function writeDockerEnv(env) {
  say('Sinh `.env.docker` (chỉ các biến phải khác trong container)');

  const lines = [
    '# SINH TỰ ĐỘNG bởi scripts/docker-stack.mjs — đừng sửa tay, chạy lại script.',
    '#',
    '# Chỉ chứa các biến phải KHÁC khi app chạy TRONG container: "localhost" ở trong',
    '# container là chính container đó, không phải máy thật.',
    '',
  ];

  const dbUrl = env.DATABASE_URL ?? '';
  const dbInside = dbUrl.replace(/@localhost:\d+\//, '@postgres:5432/').replace(/@127\.0\.0\.1:\d+\//, '@postgres:5432/');
  if (dbInside !== dbUrl) {
    detail(`DATABASE_URL: localhost → postgres:5432 (cổng nội bộ, không phải 5433)`);
  } else {
    detail('DATABASE_URL: không phải localhost, giữ nguyên');
  }
  lines.push(`DATABASE_URL=${dbInside}`);

  const endpoint = env.S3_ENDPOINT ?? '';
  if (/localhost|127\.0\.0\.1/.test(endpoint)) {
    const inside = endpoint.replace(/localhost|127\.0\.0\.1/, 'minio');
    lines.push(`S3_ENDPOINT=${inside}`);
    detail(`S3_ENDPOINT: ${endpoint} → ${inside}`);
  } else {
    detail(
      endpoint
        ? `S3_ENDPOINT: ${endpoint} (không phải localhost, giữ nguyên)`
        : 'S3_ENDPOINT rỗng = AWS S3 thật, giữ nguyên',
    );
  }

  lines.push('');
  writeFileSync('.env.docker', lines.join('\n'), 'utf8');
  detail('S3_PUBLIC_BASE_URL cố ý KHÔNG đổi — đó là URL trình duyệt tải ảnh');
  return { usesMinio: /localhost|127\.0\.0\.1|minio/.test(endpoint) };
}

/* ── Bước 2: build ─────────────────────────────────────────────────────── */

function build() {
  say('Build image');
  detail('stage `runner`: next build với output standalone, + Prisma query engine');
  run('docker', ['build', '--target', 'runner', '-t', IMAGE, '.']);

  detail('stage `migrate`: chỉ Prisma CLI + schema, để migrate một lần khi deploy');
  run('docker', ['build', '--target', 'migrate', '-t', MIGRATE_IMAGE, '.']);

  const size = tryRun('docker', ['image', 'inspect', IMAGE, '--format', '{{.Size}}']);
  if (size.ok) {
    detail(`image ${IMAGE}: ${(Number(size.out.trim()) / 1024 / 1024).toFixed(0)} MB`);
  }
}

/* ── Bước 3: nền (postgres + minio) ────────────────────────────────────── */

async function startInfra() {
  say('Dựng postgres + minio, chờ healthy');
  run('docker', ['compose', 'up', '-d', 'postgres', 'minio']);

  for (const name of [`${STACK}-db`, `${STACK}-s3`]) {
    for (let i = 0; ; i += 1) {
      const st = tryRun('docker', [
        'inspect', name, '--format', '{{.State.Health.Status}}',
      ]);
      const status = st.out.trim();
      if (status === 'healthy') {
        detail(`${name}: healthy`);
        break;
      }
      if (i > 60) fail(`${name} không healthy sau 60 giây (trạng thái: ${status || 'không rõ'})`);
      await sleep(1000);
    }
  }
}

/* ── Bước 4: bucket MinIO ──────────────────────────────────────────────── */

/**
 * Tạo bucket nếu đang dùng MinIO.
 *
 * `anonymous set download` là CHỈ ĐỌC. Không dùng `public` — nó mở cả quyền GHI, và
 * đó là lỗi cấu hình S3 phổ biến nhất: không có triệu chứng nào cho tới khi bị lợi
 * dụng. Ghi chú này trùng với `docker-compose.yml` một cách có chủ đích — luật quan
 * trọng thì đứng ở cả chỗ khai báo lẫn chỗ thực thi.
 */
function ensureBucket(env, usesMinio) {
  say('Bucket kho asset');
  if (!usesMinio) {
    detail('S3_ENDPOINT không trỏ MinIO → dùng S3 thật, không tạo bucket gì');
    return;
  }

  const bucket = env.S3_BUCKET || BUCKET_FALLBACK;
  const mc = (...args) => tryRun('docker', ['exec', `${STACK}-s3`, 'mc', ...args]);

  const alias = mc('alias', 'set', 'local', 'http://localhost:9000', 'builder', 'builderbuilder');
  if (!alias.ok) fail(`không đặt được alias mc:\n${alias.out}`);

  const made = mc('mb', '--ignore-existing', `local/${bucket}`);
  if (!made.ok) fail(`không tạo được bucket ${bucket}:\n${made.out}`);
  detail(`bucket \`${bucket}\` đã có`);

  const acl = mc('anonymous', 'set', 'download', `local/${bucket}`);
  if (!acl.ok) fail(`không đặt được quyền đọc cho ${bucket}:\n${acl.out}`);
  detail('quyền: anonymous download (CHỈ ĐỌC — `public` sẽ mở cả quyền ghi)');
}

/* ── Bước 5: migration ─────────────────────────────────────────────────── */

function migrate() {
  say('Áp migration (một lần, không phải mỗi lần container start)');
  detail('entrypoint cố ý không migrate: nhiều replica cùng migrate là race condition');
  run('docker', ['compose', '--profile', 'migrate', 'run', '--rm', 'migrate']);
}

/* ── Bước 6: chạy app và CHỨNG MINH nó sống ────────────────────────────── */

async function startApp() {
  say(`Chạy app trên cổng ${APP_PORT}`);
  detail('3002 chứ không phải 3000/3001: 3000 là dự án khác, 3001 là dev server repo này');
  run('docker', ['compose', '--profile', 'app', 'up', '-d', 'app']);

  /*
   * Chờ ĐÚNG 200 trên trang login, không phải "bất kỳ mã dưới 500".
   *
   * Bản đầu nhận mọi mã < 500 và tự tuyên bố thành công trên một **404** — vì nó gọi
   * `/login`, còn đường dẫn thật là `/builder/login` (route nằm trong group
   * `(builder)`, và `builder` là thư mục thật nên vẫn có trong URL). Một 404 chứng
   * minh Next đang chạy nhưng KHÔNG chứng minh app dựng được trang nào, và đó đúng là
   * thứ bước này tồn tại để chứng minh.
   */
  detail('chờ HTTP 200 — "container đang chạy" KHÔNG có nghĩa là app sống');
  const url = `http://localhost:${APP_PORT}/builder/login`;
  for (let i = 0; ; i += 1) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status === 200) {
        detail(`${url} → HTTP 200`);
        break;
      }
      if (i > 5 && i % 10 === 0) detail(`vẫn là HTTP ${res.status}, chờ tiếp…`);
    } catch {
      // chưa mở cổng, thử lại
    }
    if (i > 90) {
      console.error('\n--- 40 dòng log cuối của app ---');
      run('docker', ['compose', 'logs', '--tail', '40', 'app']);
      fail(`app không trả lời sau 90 giây tại ${url}`);
    }
    await sleep(1000);
  }
}

/* ── Bước 7: khói — site có CSS thật hay không ──────────────────────────── */

/**
 * Kiểm site trả HTML **và** bó CSS mà HTML đó trỏ tới.
 *
 * ## Vì sao phải kiểm riêng bó CSS
 *
 * Bước trước chỉ chứng minh Next dựng được một trang. Nó KHÔNG chứng minh trang đó
 * hiện ra đúng. Lần chạy image thật đầu tiên (19/08/2026): `/` trả 200 và 131KB HTML,
 * `/builder/login` trả 200 — mọi dấu hiệu đều xanh — nhưng
 * `/mm-css/<hash>.css` trả **500** và site hiện ra không có một dòng CSS nào, vì
 * `output: 'standalone'` không gom `src/styles` và `compileStaticCss` đọc file đó lúc
 * chạy.
 *
 * Một bước kiểm chỉ đáng tin nếu nó đi hết đường mà người dùng đi. Trang không CSS
 * vẫn trả 200.
 */
async function smoke() {
  say('Kiểm khói: site có CSS thật không');
  const base = `http://localhost:${APP_PORT}`;

  const res = await fetch(`${base}/`);
  if (res.status !== 200) fail(`site \`/\` trả HTTP ${res.status}`);
  const html = await res.text();
  detail(`/ → 200, ${(html.length / 1024).toFixed(0)}KB`);

  const link = html.match(/\/mm-css\/[0-9a-f]{64}\.css/)?.[0];
  if (!link) {
    fail(
      'HTML không trỏ tới bó CSS nào (`/mm-css/<hash>.css`).\n' +
        '  Site sẽ hiện ra không có CSS. Xem src/app/(site)/layout.tsx.',
    );
  }

  const css = await fetch(`${base}${link}`);
  const bytes = (await css.arrayBuffer()).byteLength;
  if (css.status !== 200 || bytes === 0) {
    fail(
      `bó CSS ${link} trả HTTP ${css.status}, ${bytes} byte.\n` +
        '  Site chạy nhưng KHÔNG CÓ CSS. Nếu là ENOENT src/styles/site.css thì image\n' +
        '  thiếu thư mục đó — xem dòng COPY src/styles trong Dockerfile.',
    );
  }
  detail(`${link} → 200, ${(bytes / 1024).toFixed(0)}KB`);
}

/* ── main ──────────────────────────────────────────────────────────────── */

const cmd = process.argv[2] ?? 'up';

if (cmd === 'down') {
  // Chỉ hạ app. GIỮ postgres/minio: hạ chúng là hạ luôn nền của `pnpm dev`, và
  // người chạy `docker:down` gần như không bao giờ có ý đó.
  console.log('Hạ app (giữ postgres, minio và toàn bộ dữ liệu)');
  run('docker', ['compose', '--profile', 'app', 'stop', 'app']);
  run('docker', ['compose', '--profile', 'app', 'rm', '-f', 'app']);
  console.log('\n✓ Đã hạ app. Dữ liệu còn nguyên; `pnpm db:down` mới hạ nền.');
  process.exit(0);
}

if (cmd === 'logs') {
  spawn('docker', ['compose', '--profile', 'app', 'logs', '-f', 'app'], { stdio: 'inherit' });
} else if (cmd === 'build') {
  preflight();
  build();
  console.log('\n✓ Xong. `pnpm docker:up` để chạy.');
} else if (cmd === 'up') {
  const env = preflight();
  const { usesMinio } = writeDockerEnv(env);
  build();
  await startInfra();
  ensureBucket(env, usesMinio);
  migrate();
  await startApp();
  await smoke();

  console.log(`
✓ Đang chạy — bản PRODUCTION, không phải dev server

    Builder    http://localhost:${APP_PORT}/builder/login
    Site       http://localhost:${APP_PORT}/
    MinIO UI   http://localhost:9001   (builder / builderbuilder)

  Log:   pnpm docker:logs
  Hạ:    pnpm docker:down          (giữ dữ liệu)

  Dev server trên 3001 và bản này DÙNG CHUNG một database. Sửa ở bản nào cũng
  thấy ở bản kia — trừ site thật, vì nó chỉ đổi khi Publish.
`);
} else {
  fail(`không hiểu lệnh \`${cmd}\`. Dùng: up | build | down | logs`);
}
