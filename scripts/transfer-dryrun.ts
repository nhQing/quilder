/**
 * Nhập thử các gói .zip xuất trang vào một môi trường TRẮNG TINH — không DB, không mạng.
 *
 *   pnpm tsx scripts/transfer-dryrun.ts <file.zip | thư mục chứa .zip> … [tuỳ chọn]
 *
 *   --globals <file.json>    Site.globals sẽ đặt ở đích (mặc định {} — đúng như site mới).
 *   --locales vi,en          Ngôn ngữ BẬT ở đích (mặc định: đúng như `DEFAULT_LOCALES`, chỉ vi).
 *   --collections a,b        Loại nội dung đã tạo sẵn ở đích (khoá). Mặc định: không có.
 *   --embed host1,host2      Hostname được phép nhúng ở đích. Mặc định: không có.
 *   --json                   In kết quả dạng JSON thay cho bảng chữ.
 *
 * Chạy với `QUILDER_PROJECT=maimoney` để token tĩnh của gói dự án được tính là "có sẵn" —
 * đúng như production sau `bootstrap.sh` (import-tokens đọc cả CSS của gói).
 *
 * ## Nó làm gì
 *
 * Dựng ảnh chụp đích y như `ensureSiteDefaults` + `import-tokens` để lại trên một DB mới
 * (trang chủ, trang 404, mẫu hệ thống, token tĩnh, locale mặc định, `globals` rỗng), rồi với TỪNG
 * gói theo thứ tự truyền vào:
 *   1. `openBundle` — đọc zip, kiểm sha256 từng file (đúng hàm của hộp thoại nhập).
 *   2. `checkBundle` — bản builder này đọc được không, gói có kín không.
 *   3. `buildImportPlan` — đúng hàm mà `/api/transfer/preview` và `commit` dùng.
 *   4. Quét binding `source:'site'` (hotline, số giấy phép…). Kế hoạch nhập KHÔNG bắt cái này:
 *      khoá thiếu ở đích làm chữ rơi về `fallback` mà trang vẫn trả 200.
 *   5. Ghi lại thứ lần nhập này sẽ tạo (component, token, ảnh, họ font, trang) vào ảnh chụp, để
 *      gói SAU thấy đích đã có chúng — như khi bạn nhập lần lượt từng trang thật.
 *
 * Bước 5 là thứ bắt được lỗi hay gặp nhất khi chuyển nhiều trang: gói xuất ở hai thời điểm mang
 * hai bản Header khác nhau → gói sau nhận `component-differs` và trang đó chạy bằng Header của
 * gói TRƯỚC.
 *
 * Mã thoát 1 nếu có gói bị chặn hoặc có khoá `site` thiếu.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { rootTokens, TOKENS_CSS } from '../src/lib/design/token-source';
import { projectFile } from '../src/lib/project/files';
import { blankSnapshot, dryRunOne, type BlankSiteOptions, type PageReport } from '../src/lib/transfer/dryrun';
import { renderGuide } from '../src/lib/transfer/guides';

// ── tham số ────────────────────────────────────────────────────────────────

interface Options extends BlankSiteOptions {
  inputs: string[];
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { inputs: [], globals: {}, locales: null, collections: [], embed: [], json: false };
  const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') o.json = true;
    else if (a === '--globals') o.globals = JSON.parse(readFileSync(argv[++i]!, 'utf8')) as Record<string, unknown>;
    else if (a === '--locales') o.locales = list(argv[++i]);
    else if (a === '--collections') o.collections = list(argv[++i]);
    else if (a === '--embed') o.embed = list(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`Tuỳ chọn lạ: ${a}`);
    else o.inputs.push(a);
  }
  return o;
}

/** Thư mục → các .zip bên trong, theo tên. File → chính nó. Giữ thứ tự người dùng gõ. */
function zipFiles(inputs: string[]): string[] {
  const out: string[] = [];
  for (const p of inputs) {
    if (statSync(p).isDirectory()) {
      out.push(...readdirSync(p).filter((f) => f.toLowerCase().endsWith('.zip')).sort().map((f) => join(p, f)));
    } else out.push(p);
  }
  return out;
}

// ── ảnh chụp một site mới ────────────────────────────────────────────────

/** Token tĩnh mà `import-tokens.ts` ghi vào bảng `Token` của một DB mới. */
function staticTokenNames(): Set<string> {
  const names = new Set(rootTokens(readFileSync(join(process.cwd(), TOKENS_CSS), 'utf8')).keys());
  const pack = projectFile('styles/tokens.css');
  if (pack) for (const n of rootTokens(readFileSync(join(process.cwd(), pack), 'utf8')).keys()) names.add(n);
  return names;
}

// ── in kết quả ───────────────────────────────────────────────────────────

const LEVEL = { block: 'CHẶN', warn: 'Cảnh báo', todo: 'Việc cần làm' } as const;

function printReport(r: PageReport) {
  const blocked = r.issues.some((i) => i.level === 'block');
  console.log(`\n${blocked ? '✗' : '✓'} /${r.slug} — ${r.title}  (${basename(r.file)}, nhập vào ${r.target})`);
  console.log(`   ảnh/font: tải lên ${r.counts.upload}, dùng lại ${r.counts.reuse} · tạo component ${r.counts.createComponents} · tạo token ${r.counts.createTokens}`);
  // 'publish' luôn có — nhắc chung một lần ở cuối, không lặp mỗi trang.
  for (const i of r.issues.filter((x) => x.code !== 'publish')) {
    const g = renderGuide(i);
    console.log(`   [${LEVEL[i.level]}] ${g.title}${i.detail ? ` — ${i.detail}` : ''}`);
    for (const it of (i.items ?? []).slice(0, 5)) console.log(`        · ${it.label}`);
    if ((i.items?.length ?? 0) > 5) console.log(`        · … và ${(i.items!.length - 5)} chỗ nữa`);
  }
  for (const m of r.missingSiteKeys) {
    console.log(`   [THIẾU Site.globals] "${m.key}" — chữ sẽ rơi về fallback gõ sẵn (${m.where.length} chỗ: ${m.where.slice(0, 3).join(', ')}${m.where.length > 3 ? '…' : ''})`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = zipFiles(opts.inputs);
  if (!files.length) {
    console.error('Cách dùng: pnpm tsx scripts/transfer-dryrun.ts <file.zip | thư mục> … [--globals g.json] [--locales vi,en] [--collections news] [--embed www.youtube.com] [--json]');
    process.exit(2);
  }
  const snap = blankSnapshot(opts, staticTokenNames());
  const reports: PageReport[] = [];
  for (const f of files) reports.push(await dryRunOne(f, new Uint8Array(readFileSync(f)), snap, opts.globals));

  const blocked = reports.filter((r) => r.issues.some((i) => i.level === 'block'));
  const siteKeys = new Set(reports.flatMap((r) => r.missingSiteKeys.map((m) => m.key)));

  if (opts.json) {
    console.log(JSON.stringify({ reports, blocked: blocked.length, missingSiteKeys: [...siteKeys] }, null, 2));
  } else {
    console.log(`Nhập thử ${files.length} gói vào một site TRẮNG (locale: ${[...snap.locales.keys()].join(', ')}; ` +
      `QUILDER_PROJECT=${process.env.QUILDER_PROJECT ?? '(không đặt)'})`);
    for (const r of reports) printReport(r);
    console.log('\n──────────');
    console.log(`${reports.length - blocked.length}/${reports.length} gói nhập được.`);
    if (blocked.length) console.log(`Bị chặn: ${blocked.map((r) => `/${r.slug}`).join(', ')}`);
    if (siteKeys.size) console.log(`Cần đặt trong Cài đặt site (Site.globals) TRƯỚC khi publish: ${[...siteKeys].join(', ')}`);
    console.log('Mọi lần nhập chỉ ghi BẢN NHÁP — xem lại rồi Publish ở đích.');
  }
  process.exit(blocked.length || siteKeys.size ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
