/**
 * Đối chiếu mọi `{ $token }` trong các doc đang lưu với tập biến thật trong
 * src/styles/tokens.css.
 *
 * Vì sao cần: token sai tên KHÔNG làm CSS hỏng — `var(--khong-ton-tai)` là cú pháp
 * hợp lệ, nó chỉ âm thầm không có giá trị. Node trông vẫn render, chỉ là mất
 * padding hoặc mất màu. Đây đúng loại lỗi lọt qua review bằng mắt, nên nó phải
 * thành một cổng chặn tự động.
 *
 * Ở Phase 3 việc này chuyển vào validator tầng semantic (đối chiếu bảng Token khi
 * ghi). Script này là bản chạy tay cho tới lúc đó.
 *
 * Chạy: pnpm exec tsx scripts/check-tokens.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { allDeclaredNames, rootTokens, TOKENS_CSS } from '../src/lib/design/token-source';
import { projectFile } from '../src/lib/project/files';

const prisma = new PrismaClient();

/** `tokens.css` của lõi + `styles/tokens.css` của gói dự án đang bật (token tĩnh của gói). */
function readTokensCss(): string {
  const pack = projectFile('styles/tokens.css');
  return [TOKENS_CSS, ...(pack ? [pack] : [])]
    .map((p) => readFileSync(join(process.cwd(), p), 'utf8'))
    .join('\n');
}

/** Mọi `$token` xuất hiện trong một doc, kèm đường dẫn để báo lỗi cho có ích. */
function usedTokens(value: unknown, path = '', out: Map<string, string[]> = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => usedTokens(v, `${path}[${i}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$token === 'string') {
      const list = out.get(obj.$token) ?? [];
      list.push(path || '(root)');
      out.set(obj.$token, list);
      return out;
    }
    for (const [k, v] of Object.entries(obj)) {
      usedTokens(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

async function main() {
  const css = readTokensCss();
  const declared = allDeclaredNames(css);
  console.log(`tokens.css khai báo ${declared.size} biến`);
  // Token tự tạo (`custom`) không nằm trong CSS nào — renderer phát chúng từ bảng Token.
  const custom = await prisma.token.findMany({
    where: { custom: true, deprecated: false },
    select: { name: true },
  });
  for (const t of custom) declared.add(t.name);
  console.log(`+ ${custom.length} token tự tạo trong DB\n`);

  const drifted = await checkDrift(css);

  const versions = await prisma.pageVersion.findMany({
    select: { id: true, label: true, doc: true },
  });
  if (!versions.length) {
    console.log('Chưa có PageVersion nào. Chạy seed trước.');
    return;
  }

  /*
   * Cây COMPONENT cũng phải quét, không chỉ cây trang.
   *
   * Bỏ sót nó là lặp lại đúng lỗi của Webflow: Audit panel của họ KHÔNG kiểm bên
   * trong component, nên càng componentize — tức càng làm đúng hướng bảo trì —
   * càng nhiều thứ nằm ngoài tầm kiểm tra tự động.
   *
   * Đo được lúc thêm nhánh này: 154 tham chiếu `$token` sống trong `Preset.tree`.
   * Xoá hay đổi tên một token thì `pnpm verify` vẫn xanh trong khi MỌI trang dùng
   * component đó mất padding hoặc mất màu — đúng loại lỗi mà script này sinh ra để
   * chặn, chỉ khác chỗ trú.
   *
   * `Preset.tree` là `{ rootId, nodes }`, và `usedTokens` duyệt theo cấu trúc chứ
   * không theo hình dạng `Doc`, nên nó dùng lại được nguyên vẹn.
   */
  const presets = await prisma.preset.findMany({
    select: { id: true, name: true, tree: true },
  });

  const targets: Array<{ label: string; doc: unknown }> = [
    ...versions.map((v) => ({ label: v.label ?? v.id, doc: v.doc })),
    ...presets.map((c) => ({ label: 'component: ' + c.name, doc: c.tree })),
  ];

  let missing = 0;
  for (const v of targets) {
    const used = usedTokens(v.doc);
    const bad = [...used.entries()].filter(([name]) => !declared.has(name));
    const label = v.label;

    if (!bad.length) {
      console.log(`✓ ${label} — ${used.size} token, tất cả đều tồn tại`);
      continue;
    }

    console.log(`✗ ${label} — ${bad.length} token KHÔNG tồn tại:`);
    for (const [name, paths] of bad) {
      console.log(`    --${name}`);
      for (const p of paths.slice(0, 3)) console.log(`        tại ${p}`);
      missing += 1;
    }
  }

  if (missing) {
    console.log(
      `\n${missing} token sai tên. Chúng không làm CSS hỏng — chúng âm thầm không có tác dụng.`,
    );
  } else {
    console.log('\nMọi token đều resolve được.');
  }

  if (missing || drifted) process.exitCode = 1;
}

/**
 * Bảng `Token` có khớp `:root` của `tokens.css` không.
 *
 * Vì sao phép kiểm này phải tồn tại: `tokens.css` là NGUỒN THẬT (trình duyệt đọc
 * nó, và nó được niêm phong vào release qua `cssHash`), còn bảng `Token` là bản
 * SAO để mô tả cho inspector và cho AI. Đồng bộ một chiều không có test canh thì
 * drift sẽ xảy ra — và nó đã xảy ra: 25/08/2026, 7 token màu trong DB giữ giá trị
 * theme SÁNG trong khi site render theme TỐI, vì `import-tokens.ts` đọc cả khối
 * `[data-theme="light"]`.
 *
 * Chỉ so token `custom: false`. Token tự tạo KHÔNG có trong file CSS — đó là toàn
 * bộ lý do cột `custom` tồn tại — nên so chúng ở đây là báo động giả.
 *
 * ## `baseValue != null` là ĐÃ SỬA CÓ Ý, không phải drift
 *
 * Từ 03/09/2026 màn Cài đặt sửa được 12 token nền tảng, và một token đã sửa thì cột
 * `value` của nó CỐ Ý khác `tokens.css` — cột `baseValue` giữ giá trị của file, và
 * nút "Về mặc định" đọc nó.
 *
 * Bản trước của hàm này so `value` với `:root` cho MỌI hàng, nên nó biến thành: đổi
 * một màu ở màn Cài đặt là `pnpm verify` đỏ vĩnh viễn, kèm lời khuyên chạy
 * `pnpm tokens:import` — mà chạy lệnh đó cũng không sửa được gì, vì `import-tokens.ts`
 * cố ý GIỮ NGUYÊN `value` của token đã sửa. Một phép kiểm đỏ mà cách sửa nó in ra
 * không có tác dụng là phép kiểm dạy người ta bỏ qua nó.
 *
 * Nên với token đã sửa, thứ phải khớp `:root` là `baseValue`. Phép kiểm vẫn bắt được
 * đúng cái nó sinh ra để bắt (sự cố 25/08: `import-tokens.ts` đọc cả khối
 * `[data-theme="light"]` nên 7 token màu giữ giá trị theme sáng), vì lúc đó `baseValue`
 * mới là con số sai.
 */
async function checkDrift(css: string): Promise<number> {
  const atRoot = rootTokens(css);
  const rows = await prisma.token.findMany({
    where: { custom: false, deprecated: false },
    select: { name: true, value: true, baseValue: true },
    orderBy: { name: 'asc' },
  });

  /** Giá trị đáng ra bằng `:root`: `baseValue` nếu đã sửa, còn không thì `value`. */
  const baseline = (r: { value: string; baseValue: string | null }) => r.baseValue ?? r.value;

  const bad = rows.filter((r) => {
    const real = atRoot.get(r.name);
    return real !== undefined && real.value !== baseline(r);
  });
  const edited = rows.filter((r) => r.baseValue !== null);

  if (!bad.length) {
    console.log(`\n✓ bảng Token khớp :root (${rows.length} token tĩnh)`);
    if (edited.length) {
      // In ra, nhưng KHÔNG tính là lỗi. Người đọc log cần biết site đang chạy với
      // mấy giá trị không có trong file — đó là thông tin, không phải sự cố.
      console.log(`  ${edited.length} token đã sửa ở màn Cài đặt (giá trị gốc vẫn khớp):`);
      for (const r of edited) console.log(`    --${r.name}: ${r.baseValue} → ${r.value}`);
    }
    return 0;
  }

  console.log(`\n✗ bảng Token LỆCH :root ở ${bad.length} token:`);
  for (const r of bad) {
    console.log(`    --${r.name}`);
    console.log(`        DB:     ${baseline(r)}${r.baseValue === null ? '' : '  (giá trị gốc)'}`);
    console.log(`        :root:  ${atRoot.get(r.name)!.value}`);
  }
  console.log('    Chạy `pnpm tokens:import` để nạp lại.');
  return bad.length;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
