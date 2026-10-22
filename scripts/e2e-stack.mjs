/**
 * Stack e2e DÙNG MỘT LẦN: Postgres + MinIO riêng, dev server riêng, xoá sạch sau khi chạy.
 *
 *   pnpm e2e                 # up → seed → dev → test → down (một lệnh, tự dọn)
 *   pnpm e2e -- e2e/mcp.spec.ts   # chỉ chạy một số spec, tham số đi thẳng vào Playwright
 *   pnpm e2e:up              # dựng và GIỮ stack để lặp nhanh khi viết test
 *   pnpm e2e:test [spec…]    # chạy test trên stack đang giữ
 *   pnpm e2e:restart         # chỉ khởi động lại dev server (giữ DB) — khi vừa thêm file CSS/route mới
 *   pnpm e2e:visual [--update]  # visual regression trong container Playwright (stack --scripted)
 *   pnpm e2e:down            # dọn
 *   pnpm e2e:shared          # chạy trên DB DEV như trước 08/10/2026 — chỉ khi biết mình làm gì
 *
 * ## Vì sao tồn tại
 *
 * Trước 08/10/2026, 41 spec chạy thẳng trên dev server và DB dev dùng chung. Sự cố
 * 19/08 (HANDOFF §3.35): một test publish bản nháp bẩn và trang chủ mất section hero.
 * Mỗi lần chạy e2e còn để lại version, token và trang rác trong dữ liệu người ta đang
 * làm việc thật. Mẫu là Webstudio (apps/builder/backend/lib.sh): compose project riêng,
 * "Disposable modes must never share the persistent development volume".
 *
 * ## Dữ liệu lấy từ đâu
 *
 * Mặc định `--scripted` (21/10/2026): `prisma/seed.ts` + các script seed dựng lại một site
 * TRUNG TÍNH từ repo — Quilder thuần, không gói dự án. Bộ e2e lõi chạy trên đúng thứ đó, nên
 * nó qua được trên mọi bản clone, không cần dữ liệu của ai.
 *
 *   E2E_PROJECT=<gói>   bật gói dự án (seed của gói + `projects/<gói>/e2e`)
 *   --from-dev hoặc E2E_FROM_DEV=1   `pg_dump` DB dev (CHỈ ĐỌC) thay cho seed bằng script —
 *                       ảnh trong bản sao vẫn trỏ MinIO dev (chỉ đọc); ảnh e2e tải lên đi vào
 *                       MinIO e2e. Không đường nào ghi vào kho dev.
 *
 * ## Vì sao dev server chứ không phải bản build
 *
 * Một phần suite cần `window.__mm`, chỉ có ở `next dev` (xem playwright.config.ts).
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { composeName } from './compose-name.mjs';

const PROJECT = 'mm-e2e';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'docker-compose.e2e.yml'];
const PORT = 3003;
const BASE = `http://localhost:${PORT}`;
const STATE_DIR = '.e2e-cache';
/** Thư mục build của dev server e2e — tách khỏi `.next` của dev server thường (xem next.config.mjs). */
const DIST_DIR = '.next-e2e';
const ENV_FILE = `${STATE_DIR}/env.json`;
const PID_FILE = `${STATE_DIR}/dev.pid`;
const LOG_FILE = `${STATE_DIR}/dev.log`;
/** Container DB dev — cố định trong docker-compose.yml. Đổi được qua biến môi trường. */
const DEV_DB_CONTAINER = process.env.E2E_SOURCE_CONTAINER ?? `${composeName()}-db`;
const BUCKET = 'builder-e2e';

const NODE = process.execPath;
const BIN = {
  next: 'node_modules/next/dist/bin/next',
  prisma: 'node_modules/prisma/build/index.js',
  playwright: 'node_modules/@playwright/test/cli.js',
};

let step = 0;
const say = (msg) => console.log(`\n[e2e ${++step}] ${msg}`);
const detail = (msg) => console.log(`    ${msg}`);

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, { env, quiet = false, input } = {}) {
  const res = spawnSync(cmd, args, {
    stdio: [input === undefined ? 'inherit' : 'pipe', quiet ? 'pipe' : 'inherit', quiet ? 'pipe' : 'inherit'],
    env: env ? { ...process.env, ...env } : process.env,
    input,
    maxBuffer: 1024 * 1024 * 1024,
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

function tryRun(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/* ── Môi trường của stack ─────────────────────────────────────────────── */

/**
 * Biến môi trường cho server e2e VÀ cho Playwright — cùng một bộ.
 *
 * `AUTH_SECRET` sinh mới cho mỗi stack: `mcp.spec.ts` tự ký token bằng nó, nên server
 * và test phải đọc cùng một giá trị. Token thật của dev (ký bằng secret dev) vì vậy
 * cũng vô dụng trong bản sao — đúng ý.
 */
function stackEnv() {
  /*
   * Gói dự án tính MỖI LẦN, không lưu vào env.json: đổi `E2E_PROJECT` giữa hai lệnh phải có tác
   * dụng. Chuỗi rỗng chứ không `undefined`: Next không đè biến ĐÃ CÓ bằng `.env` — để trống ở
   * đây thì `QUILDER_PROJECT=…` trong `.env` của máy dev không lọt vào stack lõi.
   */
  return { ...persistedEnv(), QUILDER_PROJECT: process.env.E2E_PROJECT ?? '' };
}

function persistedEnv() {
  if (existsSync(ENV_FILE)) return JSON.parse(readFileSync(ENV_FILE, 'utf8'));
  mkdirSync(STATE_DIR, { recursive: true });
  const env = {
    MM_E2E: '1',
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://e2e:e2e@localhost:5434/mm_e2e',
    AUTH_SECRET: randomBytes(48).toString('base64'),
    S3_ENDPOINT: 'http://localhost:9010',
    S3_BUCKET: BUCKET,
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'e2e-minio',
    S3_SECRET_ACCESS_KEY: 'e2e-minio-secret',
    S3_PUBLIC_BASE_URL: `http://localhost:9010/${BUCKET}`,
    BUILDER_EMAIL: 'e2e-admin@example.com',
    BUILDER_PASSWORD: `e2e-${randomBytes(9).toString('base64url')}`,
    E2E_BASE_URL: BASE,
    PUBLIC_URL: BASE,
    MM_BUILDER_URL: BASE,
  };
  writeFileSync(ENV_FILE, JSON.stringify(env, null, 2));
  return env;
}

/* ── up ───────────────────────────────────────────────────────────────── */

function up() {
  say('Dựng Postgres + MinIO dùng một lần (project mm-e2e, dữ liệu trên tmpfs)');
  const docker = tryRun('docker', ['version', '--format', '{{.Server.Version}}']);
  if (!docker.ok) fail('Docker chưa chạy. Mở Docker Desktop rồi thử lại.');
  run('docker', [...COMPOSE, 'up', '-d', '--wait']);

  const env = stackEnv();
  const mc = (...args) => run('docker', [...COMPOSE, 'exec', '-T', 'minio', 'mc', ...args], { quiet: true });
  mc('alias', 'set', 'local', 'http://localhost:9000', env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY);
  mc('mb', '--ignore-existing', `local/${BUCKET}`);
  // CHỈ ĐỌC, cùng luật với bucket dev (docker-compose.yml): `public` mở cả quyền ghi.
  mc('anonymous', 'set', 'download', `local/${BUCKET}`);
  detail(`Postgres :5434, MinIO :9010 (bucket ${BUCKET}, anonymous download)`);
}

/* ── seed ─────────────────────────────────────────────────────────────── */

function devDbAvailable() {
  const res = tryRun('docker', ['inspect', '-f', '{{.State.Running}}', DEV_DB_CONTAINER]);
  return res.ok && res.out.trim().startsWith('true');
}

function seedFromDev() {
  say(`Sao chép dữ liệu từ DB dev (\`${DEV_DB_CONTAINER}\`) — pg_dump, chỉ ĐỌC trên dev`);
  const dump = spawnSync(
    'docker',
    ['exec', DEV_DB_CONTAINER, 'sh', '-c',
      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl'],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  if (dump.status !== 0) fail(`pg_dump thất bại:\n${dump.stderr}`);
  detail(`bản dump ${(dump.stdout.length / 1024 / 1024).toFixed(1)} MB`);

  run('docker', [...COMPOSE, 'exec', '-T', 'postgres',
    'psql', '-q', '-U', 'e2e', '-d', 'mm_e2e', '-v', 'ON_ERROR_STOP=1'],
  { input: dump.stdout, quiet: true });
  detail('đã nạp vào mm_e2e');
}

function seedScripted(env) {
  say('Seed bằng script (không có DB dev để sao chép)');
  run(NODE, [BIN.prisma, 'migrate', 'deploy'], { env });
  run(NODE, ['--import', 'tsx', 'prisma/seed.ts'], { env });
  run(NODE, ['--import', 'tsx', 'scripts/seed-second-page.ts'], { env });
  run(NODE, ['--import', 'tsx', 'scripts/seed-demo-content.ts'], { env });
  run(NODE, ['--import', 'tsx', 'scripts/seed-collections.ts'], { env });
  if (env.QUILDER_PROJECT) detail(`gói dự án: ${env.QUILDER_PROJECT}`);
}

function seed(mode) {
  const env = stackEnv();

  /*
   * Cache dữ liệu của Next (`unstable_cache`) nằm trên ĐĨA, trong `.next/cache/fetch-cache`
   * của thư mục làm việc — nó sống qua `down`/`up`, còn DB thì không. Bản sao DB dev mới
   * lại có đúng id release đang chạy như bản sao cũ, nên trang công khai đọc ra dữ liệu
   * của LẦN CHẠY TRƯỚC: đo ngày 08/10, `/gioi-thieu` trả 500 vì một ảnh mà proof của lần
   * trước tạo ra — ảnh không có trong DB e2e lẫn DB dev. DB mới thì cache cũng phải mới.
   */
  rmSync(`${DIST_DIR}/cache/fetch-cache`, { recursive: true, force: true });
  const fromDev = mode === 'from-dev' || (mode !== 'scripted' && process.env.E2E_FROM_DEV === '1');
  if (fromDev && !devDbAvailable()) fail(`--from-dev: container ${DEV_DB_CONTAINER} không chạy.`);
  if (fromDev) seedFromDev();
  else seedScripted(env);

  say('Áp migration của nhánh này, bổ sung dữ liệu tối thiểu, sync effect, tạo tài khoản e2e');
  run(NODE, [BIN.prisma, 'migrate', 'deploy'], { env, quiet: true });
  // Cùng bước với bootstrap prod: bản sao DB dev có thể chưa có trang 404 hệ thống.
  run(NODE, ['--import', 'tsx', 'scripts/ensure-defaults.ts'], { env, quiet: true });
  run(NODE, ['--import', 'tsx', 'scripts/sync-effects.ts'], { env, quiet: true });
  run(NODE, ['--import', 'tsx', 'scripts/create-user.ts', env.BUILDER_EMAIL, env.BUILDER_PASSWORD, 'admin'],
    { env, quiet: true });
  detail(`tài khoản ${env.BUILDER_EMAIL} (admin), mật khẩu ngẫu nhiên trong ${ENV_FILE}`);
  return !fromDev;
}

/**
 * Seed bằng script chỉ dựng BẢN NHÁP (trang thứ hai, link điều hướng); release đi qua
 * `/api/publish` nên phải chờ dev server. Bản sao DB dev thì đã có release của nó.
 */
function publishSeed() {
  const env = stackEnv();
  say('Nạp ảnh mẫu vào kho, rồi publish bản nháp vừa seed');
  run(NODE, ['--import', 'tsx', 'scripts/seed-assets.ts'], { env });
  run(NODE, ['--import', 'tsx', 'scripts/publish-drafts.ts', 'seed e2e'], { env });
}

/* ── dev server ───────────────────────────────────────────────────────── */

async function waitFor(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // chưa lên
    }
    await sleep(1000);
  }
  return false;
}

async function dev() {
  say(`Chạy dev server trên DB e2e, cổng ${PORT}`);
  if (await waitFor(`${BASE}/api/e2e/ping`, 1000)) {
    detail('đã có server e2e đang chạy — dùng lại');
    return;
  }
  const env = stackEnv();
  mkdirSync(STATE_DIR, { recursive: true });
  const out = openSync(LOG_FILE, 'w');
  const child = spawn(NODE, [BIN.next, 'dev', '-p', String(PORT)], {
    // Thư mục build riêng — xem `distDir` trong next.config.mjs.
    env: { ...process.env, ...env, NEXT_DIST_DIR: DIST_DIR },
    stdio: ['ignore', out, out],
    detached: true,
    // Windows: `detached` cho tiến trình con một cửa sổ console RIÊNG, hiện trên màn
    // hình. Đóng cửa sổ trống đó là Next nhận tín hiệu đóng và thoát êm. Ngày 09/10/2026
    // server thoát êm ba lần giữa lượt chạy (log chỉ còn `[?25h`, không lỗi, không crash
    // trong Event Log) — nghi là vì thế, chưa chứng minh được.
    windowsHide: true,
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  // `/api/e2e/ping` chỉ trả 200 khi MM_E2E=1, nên đợi nó cũng là kiểm luôn rằng
  // server vừa lên là server e2e chứ không phải một thứ khác đang chiếm cổng.
  if (!(await waitFor(`${BASE}/api/e2e/ping`, 240_000))) {
    fail(`dev server không lên sau 240 giây. Xem ${LOG_FILE}`);
  }
  detail(`sẵn sàng ở ${BASE} (log: ${LOG_FILE})`);
}

function stopDev() {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, 'utf8'));
  if (process.platform === 'win32') tryRun('taskkill', ['/pid', String(pid), '/T', '/F']);
  else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // đã chết
    }
  }
  rmSync(PID_FILE, { force: true });
}

/* ── test ─────────────────────────────────────────────────────────────── */

function test(args) {
  say('Chạy Playwright trên stack e2e');
  const env = stackEnv();
  const res = spawnSync(NODE, [BIN.playwright, 'test', ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return res.status ?? 1;
}

/** Smoke MCP, check:tokens và các phép chứng minh, cho CI. Cần stack đang chạy (chúng đọc DB). */
function proofs() {
  const env = stackEnv();
  say('mcp:smoke với một token service vừa cấp');
  const token = run(NODE, ['--import', 'tsx', 'scripts/mint-service-token.ts', env.BUILDER_EMAIL, '1'],
    { env, quiet: true }).trim().split(/\r?\n/).pop();
  run(NODE, ['mcp/smoke.mjs'], { env: { ...env, MM_BUILDER_TOKEN: token } });

  say('check:tokens');
  run(NODE, ['--import', 'tsx', 'scripts/check-tokens.ts'], { env });

  // Hai script này nhận địa chỉ server ở tham số đầu, mặc định là dev :3001.
  for (const script of ['prove-rollback.ts', 'prove-release-sealed.ts']) {
    say(`chứng minh: ${script}`);
    run(NODE, ['--import', 'tsx', `scripts/${script}`, env.E2E_BASE_URL], { env });
  }
  for (const script of ['prove-version-seq.ts', 'prove-concurrent-ops.ts']) {
    say(`chứng minh: ${script}`);
    run(NODE, ['--conditions=react-server', '--import', 'tsx', `scripts/${script}`], { env });
  }

  // Cuối cùng: nó publish hàng chục release và đẩy cửa sổ rollback trôi.
  say('chứng minh: prove-purge-safe.ts');
  run(NODE, ['--conditions=react-server', '--import', 'tsx', 'scripts/prove-purge-safe.ts', env.E2E_BASE_URL], { env });
}

/* ── visual ───────────────────────────────────────────────────────────── */

/**
 * Visual regression (D1) trong container `mcr.microsoft.com/playwright` cùng phiên bản
 * với repo — xem docblock `e2e/visual/visual.spec.ts` cho lý do container và seed bằng
 * script. `--update` ghi lại ảnh mẫu vào `e2e/visual/__screenshots__`.
 *
 * Container chép spec + config ra `/tmp` và cài riêng `@playwright/test`: `node_modules`
 * của repo là bản của máy chủ (trên Windows là junction của pnpm), không dùng được trong
 * Linux. Ảnh mẫu và kết quả vẫn ghi về repo qua thư mục mount.
 */
function visual(args) {
  const env = stackEnv();
  const update = args.includes('--update');
  const version = JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8')).version;
  const image = `mcr.microsoft.com/playwright:v${version}-noble`;
  // Linux (CI) dùng mạng của máy chủ; Docker Desktop thì đi qua host.docker.internal.
  const linux = process.platform === 'linux';
  const base = linux ? BASE : `http://host.docker.internal:${PORT}`;

  const pageId = run('docker', [...COMPOSE, 'exec', '-T', 'postgres', 'psql', '-tA', '-U', 'e2e', '-d', 'mm_e2e',
    '-c', 'SELECT id FROM "Page" WHERE slug = \'gioi-thieu\' AND "archivedAt" IS NULL'], { quiet: true }).trim();

  say(`Visual regression trong ${image}${update ? ' — GHI LẠI ảnh mẫu' : ''}`);
  const inner = [
    'set -e',
    'mkdir -p /tmp/v',
    'cp /work/e2e/visual/visual.spec.ts /work/e2e/visual/playwright.config.mjs /work/e2e/visual/hide-dev.css /tmp/v/',
    'cd /tmp/v',
    'npm init -y >/dev/null',
    `npm i --no-audit --no-fund --loglevel=error @playwright/test@${version}`,
    `npx playwright test -c playwright.config.mjs${update ? ' --update-snapshots' : ''}`,
  ].join('\n');
  const res = spawnSync('docker', [
    'run', '--rm', '--ipc=host',
    ...(linux ? ['--network', 'host'] : ['--add-host', 'host.docker.internal:host-gateway']),
    '-v', `${process.cwd()}:/work`,
    '-e', `VISUAL_BASE_URL=${base}`,
    '-e', 'VISUAL_SNAPSHOTS=/work/e2e/visual/__screenshots__',
    '-e', 'VISUAL_OUT=/work/test-results/visual',
    '-e', `BUILDER_EMAIL=${env.BUILDER_EMAIL}`,
    '-e', `BUILDER_PASSWORD=${env.BUILDER_PASSWORD}`,
    '-e', `VISUAL_DRAFT_PAGE_ID=${pageId}`,
    image, 'bash', '-c', inner,
  ], { stdio: 'inherit' });
  if (res.error) fail(`không chạy được docker: ${res.error.message}`);
  return res.status ?? 1;
}

/* ── down ─────────────────────────────────────────────────────────────── */

function down() {
  say('Dọn stack e2e (dev server, container, tmpfs)');
  stopDev();
  run('docker', [...COMPOSE, 'down', '-v', '--remove-orphans'], { quiet: true });
  rmSync(ENV_FILE, { force: true });
  detail('không còn gì của stack e2e');
}

/* ── shared: đường cũ, có chủ đích ────────────────────────────────────── */

function shared(args) {
  console.warn(
    '\n⚠  e2e:shared chạy trên DB DEV và dev server :3001 — test sẽ ghi version, token,\n' +
      '   trang và có thể publish vào dữ liệu đang dùng thật. Dùng `pnpm e2e` nếu không\n' +
      '   có lý do cụ thể.\n',
  );
  const res = spawnSync(NODE, ['--env-file=.env', BIN.playwright, 'test', ...args], {
    stdio: 'inherit',
    env: { ...process.env, E2E_ALLOW_SHARED_DB: '1' },
  });
  process.exit(res.status ?? 1);
}

/* ── main ─────────────────────────────────────────────────────────────── */

const [command = 'run', ...rest] = process.argv.slice(2);
const seedMode = rest.includes('--scripted') ? 'scripted' : rest.includes('--from-dev') ? 'from-dev' : 'auto';
const passthrough = rest.filter((a) => a !== '--scripted' && a !== '--from-dev' && a !== '--keep');

switch (command) {
  case 'up':
    up();
    {
      const scripted = seed(seedMode);
      await dev();
      if (scripted) publishSeed();
    }
    break;
  case 'test':
    process.exit(test(passthrough));
    break;
  case 'proofs':
    proofs();
    break;
  case 'restart':
    stopDev();
    // Đợi cổng nhả ra: Windows giữ socket thêm một nhịp sau khi tiến trình chết.
    await sleep(1500);
    await dev();
    break;
  case 'visual':
    process.exit(visual(passthrough));
    break;
  case 'down':
    down();
    break;
  case 'shared':
    shared(passthrough);
    break;
  case 'run':
  case 'ci': {
    up();
    {
      const scripted = seed(seedMode);
      await dev();
      if (scripted) publishSeed();
    }
    const status = test(passthrough);
    if (status === 0 && command === 'ci') proofs();
    if (!rest.includes('--keep')) down();
    else detail('--keep: stack vẫn chạy, dọn bằng `pnpm e2e:down`');
    process.exit(status);
    break;
  }
  default:
    fail(`Không có lệnh "${command}". Dùng: run | ci | up | test | proofs | visual | restart | down | shared`);
}
