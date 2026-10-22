/**
 * Git pre-push: chạy đúng các cổng của job `check` trên CI TRƯỚC khi push.
 *
 * Vì sao có: repo riêng tư của tài khoản Free không bật được branch protection
 * (GitHub trả 403), nên CI chỉ BÁO đỏ sau khi code đã nằm trên `main`. Hook này là
 * chỗ chặn duy nhất còn lại — và nó chỉ chặn trên máy đã cài (`pnpm hooks:install`).
 *
 * Bỏ qua một lần khi thật sự cần: `git push --no-verify` (hoặc `MM_SKIP_PREPUSH=1`).
 *
 * Hai điều cần biết về thứ được kiểm:
 *  - Kiểm CÂY LÀM VIỆC, không phải đúng commit đang push. Có thay đổi chưa commit thì
 *    hook nói ra, vì kết quả có thể khác cái CI sẽ thấy.
 *  - File chưa track bị loại khỏi lint: chúng không đi theo lần push này, và một file
 *    nháp chưa commit không được chặn việc push code đã xong.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ZERO = /^0+$/;

/** stdin của pre-push: `<local ref> <local sha> <remote ref> <remote sha>` mỗi dòng. */
function pushesCommits() {
  let input = '';
  try {
    input = readFileSync(0, 'utf8');
  } catch {
    return true; // không đọc được thì cứ kiểm
  }
  const lines = input.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return true;
  // Chỉ xoá nhánh trên remote (local sha toàn số 0) thì không có code nào để kiểm.
  return lines.some((l) => !ZERO.test(l.split(' ')[1] ?? ''));
}

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

/** Đặt trong ngoặc kép cho shell của Windows khi cần (pnpm là file .cmd, phải qua shell). */
function quote(arg) {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function step(name, args) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(['pnpm', ...args].map(quote).join(' '), { shell: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ name, code, out, ms: Date.now() - started }));
  });
}

function report(r) {
  const s = (r.ms / 1000).toFixed(1);
  console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.name} (${s}s)`);
  if (r.code !== 0) {
    const tail = r.out.trim().split(/\r?\n/).slice(-40).join('\n');
    console.log(`\n${tail}\n`);
  }
}

async function main() {
  if (process.env.MM_SKIP_PREPUSH === '1') {
    console.log('[pre-push] bỏ qua (MM_SKIP_PREPUSH=1)');
    return 0;
  }
  if (!pushesCommits()) return 0;

  if (spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pnpm']).status !== 0) {
    console.error('[pre-push] không thấy pnpm trong PATH — không kiểm được. Push từ terminal có pnpm,');
    console.error('           hoặc bỏ qua một lần: git push --no-verify');
    return 1;
  }

  if (git(['diff', '--quiet', 'HEAD', '--']).status !== 0) {
    console.log('[pre-push] lưu ý: có thay đổi CHƯA commit — hook kiểm cây làm việc, nên kết quả có thể khác cái CI thấy.');
  }

  const untracked = (git(['ls-files', '--others', '--exclude-standard', '-z']).stdout ?? '')
    .split('\0')
    .filter(Boolean);
  const ignore = untracked.flatMap((f) => ['--ignore-pattern', f]);

  const started = Date.now();
  console.log('[pre-push] kiểm như job `check` của CI…');

  // Bốn bước không phụ thuộc nhau nên chạy CÙNG LÚC: ~35s thay vì ~95s nối tiếp (đo 08/10).
  // Báo đủ cả bốn kể cả khi một bước đỏ sớm — sửa một lần cho hết, không push-đỏ-sửa-lại.
  const results = await Promise.all([
    step('typecheck', ['typecheck']),
    step('lint', ['exec', 'eslint', '.', ...ignore]),
    step('test', ['test']),
    step('docs:check', ['docs:check']),
  ]);
  results.forEach(report);

  const failed = results.filter((r) => r.code !== 0).map((r) => r.name);
  const total = ((Date.now() - started) / 1000).toFixed(0);
  if (failed.length) {
    console.error(`[pre-push] CHẶN push: ${failed.join(', ')} đỏ (${total}s).`);
    if (failed.includes('docs:check')) {
      console.error('           docs:check vừa sinh lại docs/generated — xem `git status`, commit rồi push lại.');
    }
    console.error('           Sửa rồi push lại, hoặc bỏ qua một lần: git push --no-verify');
    return 1;
  }
  console.log(`[pre-push] xanh (${total}s) — push.`);
  return 0;
}

process.exit(await main());
