/**
 * Build hai image rồi push lên registry, một lệnh.
 *
 *   pnpm release v1.0.0     # build + push, và GHI NHỚ tag
 *   pnpm release            # dùng lại tag đã nhớ
 *   pnpm release --show     # xem đang nhớ gì, không làm gì cả
 *   pnpm release --app-only # chỉ image app, bỏ qua bootstrap
 *   pnpm release --skip-ci  # KHÔNG kiểm CI — chỉ cho bản thử
 *
 * ## Vì sao nhớ tag
 *
 * Lần đầu bạn quyết định phiên bản; những lần sau bạn chỉ muốn đẩy lại đúng thứ
 * đó (build lại sau khi sửa một dòng, hoặc push lại vì mạng đứt giữa chừng). Gõ
 * lại chuỗi `v1.0.0` mỗi lần là một chỗ để gõ nhầm, và gõ nhầm ở đây tạo ra một
 * tag rác trên registry mà không ai dọn.
 *
 * Tag được ghi nhớ SAU KHI push thành công, không phải trước. Nhớ một tag chưa
 * bao giờ lên tới registry còn tệ hơn không nhớ gì.
 *
 * ## Vì sao từ chối ghi đè một tag đã có
 *
 * Đây là guardrail quan trọng nhất trong file này. `registry.ten-mien.vn/quilder/x:v1.0.0` phải
 * luôn là CÙNG một image — nếu không, "lùi về v1.0.0" không còn nghĩa gì, và bạn
 * mất đúng thứ mà cả kiến trúc release của dự án này được xây để bảo đảm
 * (`PageVersion` bất biến, `Asset.key` bất biến, `Release` chỉ tạo mới).
 *
 * Một tag đã có trên registry thì lệnh này DỪNG. Muốn đẩy đè thì phải nói rõ:
 * `--force`. Cách đúng gần như luôn là đặt một tag mới.
 *
 * ## Vì sao cảnh báo khi cây làm việc bẩn
 *
 * `v1.0.0` phải trỏ được về một commit. Build từ cây có thay đổi chưa commit tạo
 * ra một image không ai dựng lại được — và điều đó chỉ lộ ra vào lúc tệ nhất, khi
 * đang cần dựng lại nó. Commit hash được nướng vào image dưới dạng label, nên
 * `docker inspect` luôn trả lời được "image này là commit nào".
 *
 * ## Vì sao từ chối khi CI của commit chưa xanh
 *
 * Repo riêng tư của tài khoản Free không bật được branch protection (GitHub trả 403),
 * nên một commit đỏ vẫn nằm được trên `main`. Hook pre-push chỉ chặn trên máy đã cài,
 * và nó không chạy `visual`. Đây là cửa cuối trước khi code tới server, nên nó hỏi
 * thẳng GitHub: lượt CI mới nhất của ĐÚNG commit HEAD có xanh không (luật chi tiết ở
 * `ci-gate.mjs`). Chưa push, CI đang chạy, hay đỏ đều dừng, kèm lệnh làm tiếp.
 *
 * Cần `gh` đã `gh auth login`. Bản thử không cần CI thì `--skip-ci`.
 *
 * ## Vì sao là `.mjs`
 *
 * Cùng lý do `docker-stack.mjs`: máy dev là Windows, server là Linux. Một script
 * bash không chạy trong PowerShell và ngược lại; giữ hai bản là giữ hai bản của
 * một quy trình, và bản ít dùng hơn sẽ trôi.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ciVerdict } from './ci-gate.mjs';
import { parseAssetHosts } from './asset-hosts.mjs';

/**
 * Registry BẮT BUỘC (`RELEASE_REGISTRY`, biến môi trường hoặc `.env`): mỗi công ty dùng Quilder
 * đẩy lên registry của mình — một giá trị mặc định ở đây là đẩy image của người này lên kho
 * của người khác. Kiểm ở đầu `main`.
 */
const REGISTRY = readEnv('RELEASE_REGISTRY');

/** Tên image (`RELEASE_IMAGE`, mặc định `quilder`); image bootstrap là `<tên>-bootstrap`. */
const IMAGE = readEnv('RELEASE_IMAGE') || 'quilder';

/**
 * Tên image ↔ stage trong Dockerfile.
 *
 * Hai image, vì `runner` không cần Prisma CLI và migration không được chạy đồng
 * thời từ nhiều replica — xem `entrypoint.sh`.
 *
 * ## Vì sao KHÔNG có `<tên>-migrate`
 *
 * Stage `migrate` vẫn còn trong Dockerfile — `bootstrap` kế thừa từ nó
 * (`FROM migrate AS bootstrap`). Nhưng nó không được publish nữa: `bootstrap` là
 * tập cha thật sự, chứa đúng Prisma CLI đó cộng khả năng seed. Đẩy cả hai lên
 * registry là đẩy hai artifact cho một việc, và tạo ra câu hỏi "dùng cái nào"
 * mà không có câu trả lời hay.
 *
 * Vẫn chạy migrate-KHÔNG-seed được, khi cần đúng một lần đó:
 *
 *   docker run --rm --network <net> --env-file .env \
 *     --entrypoint ./node_modules/.bin/prisma \
 *     <registry>/<tên>-bootstrap:<tag> \
 *     migrate deploy --schema ./prisma/schema.prisma
 *
 * ## Vì sao `bootstrap` KHÔNG bỏ được
 *
 * `runner` cố ý không có Prisma CLI. `bootstrap` là thứ DUY NHẤT trong release
 * chạy được `migrate deploy`. Bỏ nó khỏi đây nghĩa là không còn cách áp migration
 * lên server — và điều đó chỉ lộ ra lúc container mới fail-fast vì DB cũ hơn code.
 *
 * Thứ bỏ được là *build lại nó khi không có gì đổi*. `--app-only` làm việc đó, và
 * lệnh này TỪ CHỐI `--app-only` nếu schema/migration đã đổi kể từ tag đã nhớ. Chỗ
 * duy nhất biết được điều đó là ở đây, không phải trong đầu bạn ba tuần sau.
 */
const IMAGES = [
  { name: IMAGE, target: 'runner' },
  { name: `${IMAGE}-bootstrap`, target: 'bootstrap' },
];

const STATE_FILE = '.release.json';
const TAG_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,126}$/;

let step = 0;
const say = (m) => console.log(`\n[${++step}] ${m}`);
const detail = (m) => console.log(`    ${m}`);

function fail(m) {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
}

/** Biến môi trường, hoặc dòng `KEY=` của `.env` (release.mjs không tự nạp `.env`). */
function readEnv(key) {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync('.env')) return '';
  const re = new RegExp(`^${key}\\s*=`);
  const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => re.test(l));
  return line ? line.replace(re, '').trim().replace(/^["']|["']$/g, '').trim() : '';
}

/**
 * Gói dự án cho `--build-arg QUILDER_PROJECT` — trống = Quilder thuần. Đặt mà thư mục gói
 * không có thì dừng ngay, khỏi đợi `next build` trong Docker mới báo.
 */
function readProject() {
  const name = readEnv('QUILDER_PROJECT');
  if (name && !existsSync(`projects/${name}/index.ts`)) {
    fail(`QUILDER_PROJECT="${name}" nhưng không có projects/${name}/index.ts — clone gói vào trước.`);
  }
  return name;
}

/**
 * Host kho ảnh cho `--build-arg ASSET_HOSTS` — thông số LÚC BUILD (xem
 * scripts/asset-hosts.mjs). Đọc biến môi trường trước, rồi dòng `ASSET_HOSTS=` của
 * `.env`. Thiếu thì dừng TRƯỚC khi build: một image không có host này hiện mọi ảnh 400.
 */
function readAssetHosts() {
  const raw = readEnv('ASSET_HOSTS');
  if (!raw) {
    fail(
      'Thiếu ASSET_HOSTS — host kho ảnh (CDN/S3 public), bị đóng vào bản build.\n' +
        '  Đặt trong .env:   ASSET_HOSTS="https://cdn.ten-mien.vn"   (nhiều host cách nhau dấu phẩy)',
    );
  }
  try {
    parseAssetHosts(raw);
  } catch (e) {
    fail(e.message);
  }
  return raw;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (res.error) fail(`không chạy được \`${cmd}\`: ${res.error.message}`);
  if (res.status !== 0) fail(`\`${cmd} ${args.join(' ')}\` thoát với mã ${res.status}`);
}

/** Chạy im lặng, trả `{ ok, out, err, missing }`. Dùng cho phép hỏi, không phải phép làm. */
function ask(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  return {
    ok: res.status === 0,
    out: (res.stdout ?? '').toString().trim(),
    err: (res.stderr ?? '').toString().trim(),
    missing: res.error?.code === 'ENOENT',
  };
}

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const show = args.includes('--show');
  const appOnly = args.includes('--app-only');
  const skipCi = args.includes('--skip-ci');
  const input = args.find((a) => !a.startsWith('--'));

  const state = readState();

  if (show) {
    if (!state) return console.log('Chưa nhớ tag nào. Chạy: pnpm release <tag>');
    console.log(`tag     : ${state.tag}`);
    console.log(`registry: ${state.registry}`);
    console.log(`commit  : ${state.commit}`);
    console.log(`CI      : ${state.ci ?? '(không kiểm)'}`);
    console.log(`push lúc: ${state.pushedAt}`);
    return;
  }

  const tag = input ?? state?.tag;
  if (!tag) {
    fail('Chưa có tag. Lần đầu phải nói rõ:  pnpm release v1.0.0');
  }
  if (!TAG_RE.test(tag)) {
    fail(`Tag "${tag}" không hợp lệ. Docker chỉ nhận chữ, số, và . _ -`);
  }

  say(`Tag: ${tag}${input ? '' : '  (nhớ từ lần trước)'}`);
  if (!REGISTRY) {
    fail('Thiếu RELEASE_REGISTRY (biến môi trường hoặc .env), ví dụ RELEASE_REGISTRY=registry.ten-mien.vn/quilder.');
  }
  detail(`registry: ${REGISTRY}`);

  /* ── Commit ─────────────────────────────────────────────────────── */

  const sha = ask('git', ['rev-parse', 'HEAD']);
  if (!sha.ok) fail('không đọc được commit — đang ở trong một git repo chứ?');

  const dirty = ask('git', ['status', '--porcelain']);
  if (dirty.ok && dirty.out) {
    const n = dirty.out.split('\n').length;
    console.log(
      `\n    ⚠  Cây làm việc còn ${n} thay đổi CHƯA COMMIT.\n` +
        `       Image ${tag} sẽ không dựng lại được từ lịch sử git.\n` +
        '       Commit trước khi release, trừ khi đây là bản thử.',
    );
  }

  /* ── CI của commit này ──────────────────────────────────────────── */

  say('Kiểm CI của commit');
  const short = sha.out.slice(0, 7);
  let ciUrl = null;

  if (skipCi) {
    console.log('    ⚠  --skip-ci: KHÔNG kiểm CI. Image này chưa chắc đã qua check/visual.');
  } else {
    const gh = ask('gh', [
      'run', 'list', '--workflow', 'ci.yml', '--commit', sha.out, '--limit', '50',
      '--json', 'databaseId,status,conclusion,event,createdAt,url',
    ]);
    if (gh.missing) {
      fail(
        'Không thấy `gh` (GitHub CLI) — không hỏi được CI.\n' +
          '  Cài gh rồi `gh auth login`, hoặc bỏ qua cho bản thử:  pnpm release ' + tag + ' --skip-ci',
      );
    }
    if (!gh.ok) {
      fail(
        `gh không trả lời được:\n     ${(gh.err || gh.out).split('\n').join('\n     ')}\n\n` +
          '  Chưa đăng nhập thì `gh auth login`. Bản thử:  pnpm release ' + tag + ' --skip-ci',
      );
    }

    let runs;
    try {
      runs = JSON.parse(gh.out || '[]');
    } catch {
      fail(`gh trả về thứ không phải JSON:\n     ${gh.out.slice(0, 300)}`);
    }

    const v = ciVerdict(runs);
    if (v.kind === 'missing') {
      const pushed = ask('git', ['branch', '-r', '--contains', sha.out]);
      fail(
        `Chưa có lượt CI nào cho commit ${short}.\n` +
          (pushed.ok && pushed.out
            ? '  Commit đã lên GitHub nhưng CI không chạy cho nó: CI chỉ chạy khi push vào main\n' +
              '  hoặc mở PR.'
            : '  Commit CHƯA push. Push trước (hook pre-push sẽ kiểm), chờ CI xanh, rồi release.'),
      );
    }
    if (v.kind === 'pending') {
      fail(
        `CI của ${short} đang chạy (${v.run.status}): ${v.run.url}\n` +
          `  Chờ xong:     gh run watch ${v.run.databaseId} --exit-status\n` +
          `  rồi chạy lại: pnpm release ${tag}`,
      );
    }
    if (v.kind === 'failed') {
      fail(
        `CI của ${short} ĐỎ (${v.run.conclusion}): ${v.run.url}\n` +
          `  Xem lỗi:  gh run view ${v.run.databaseId} --log-failed\n` +
          '  Sửa, push, chờ xanh rồi release. Flake thì chạy lại: gh run rerun ' +
          v.run.databaseId + ' --failed',
      );
    }

    ciUrl = v.run.url;
    detail(`xanh (${v.run.event}): ${ciUrl}`);
    if (dirty.ok && dirty.out) {
      detail('⚠  xanh là của commit HEAD — các thay đổi chưa commit ở trên KHÔNG nằm trong đó');
    }
  }

  /* ── Bỏ bootstrap? ──────────────────────────────────────────────── */

  const images = appOnly ? IMAGES.filter((i) => i.target === 'runner') : IMAGES;

  if (appOnly) {
    if (!state?.commit) {
      fail(
        '--app-only cần một tag đã nhớ để biết so migration với cái gì.\n' +
          '  Chạy một lần đầy đủ trước:  pnpm release ' + tag,
      );
    }

    /*
     * Migration mới + `--app-only` = server pull về rồi fail-fast vì DB cũ hơn code,
     * và không có image nào để áp migration. Để LỆNH này biết, thay vì bạn phải nhớ.
     */
    const moved = ask('git', [
      'diff', '--name-only', state.commit, 'HEAD', '--',
      'prisma/migrations', 'prisma/schema.prisma',
    ]);
    const uncommitted = ask('git', [
      'status', '--porcelain', '--', 'prisma/migrations', 'prisma/schema.prisma',
    ]);
    const touched = [moved.out, uncommitted.out].filter(Boolean).join('\n');

    if (touched) {
      fail(
        `Schema/migration đã đổi kể từ ${state.tag}:\n     ` +
          touched.split('\n').join('\n     ') +
          '\n\n  --app-only sẽ đẩy app mới mà không đẩy cách áp migration.' +
          '\n  Chạy release đầy đủ (bỏ --app-only).',
      );
    }

    detail(`--app-only: bỏ bootstrap, không có migration mới từ ${state.tag}`);
  }

  /* ── Tag đã tồn tại trên registry chưa ──────────────────────────── */

  say('Kiểm tag đã tồn tại trên registry chưa');
  const taken = [];
  for (const { name } of images) {
    const ref = `${REGISTRY}/${name}:${tag}`;
    if (ask('docker', ['manifest', 'inspect', ref]).ok) taken.push(ref);
  }

  if (taken.length && !force) {
    fail(
      `Tag đã có trên registry:\n     ${taken.join('\n     ')}\n\n` +
        '  Đẩy đè nghĩa là "lùi về ' +
        tag +
        '" trỏ tới một image khác trước và sau hôm nay.\n' +
        '  Đặt tag mới, hoặc `pnpm release ' +
        tag +
        ' --force` nếu bạn thật sự muốn đè.',
    );
  }
  if (taken.length) {
    console.log(`    ⚠  --force: sẽ ĐÈ ${taken.length} tag đã có`);
  } else {
    detail('chưa có, an toàn');
  }

  /* ── Build ──────────────────────────────────────────────────────── */

  const assetHosts = readAssetHosts();
  detail(`ASSET_HOSTS=${assetHosts}`);
  const project = readProject();
  detail(project ? `QUILDER_PROJECT=${project}` : 'QUILDER_PROJECT trống — Quilder thuần');
  for (const { name, target } of images) {
    const ref = `${REGISTRY}/${name}:${tag}`;
    say(`Build ${target} → ${ref}`);
    run('docker', [
      'build',
      '--target', target,
      '--build-arg', `ASSET_HOSTS=${assetHosts}`,
      '--build-arg', `QUILDER_PROJECT=${project}`,
      '-t', ref,
      // Trả lời được "image này là commit nào" bằng `docker inspect`, mãi về sau.
      '--label', `org.opencontainers.image.revision=${sha.out}`,
      '--label', `org.opencontainers.image.version=${tag}`,
      '.',
    ]);
  }

  /* ── Push ───────────────────────────────────────────────────────── */

  for (const { name } of images) {
    const ref = `${REGISTRY}/${name}:${tag}`;
    say(`Push ${ref}`);
    run('docker', ['push', ref]);
  }

  /* ── Nhớ, SAU khi push xong ─────────────────────────────────────── */

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { tag, registry: REGISTRY, commit: sha.out, ci: ciUrl, pushedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`\n✓ Đã push ${images.length} image với tag ${tag}\n`);
  for (const { name } of images) console.log(`    ${REGISTRY}/${name}:${tag}`);
  console.log('\n  Trên server:');
  if (!appOnly) console.log(`    docker pull ${REGISTRY}/${IMAGE}-bootstrap:${tag}`);
  console.log(`    docker pull ${REGISTRY}/${IMAGE}:${tag}`);
  console.log(`\n  Lần sau chỉ cần:  pnpm release        (dùng lại ${tag})`);
  console.log(`  Phiên bản mới  :  pnpm release v1.0.1\n`);
}

main();
