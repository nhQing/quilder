/**
 * Thêm / xem / xoá một `EffectPreset` — tức thêm một "hiệu ứng" KHÔNG cần deploy.
 *
 *   pnpm effect:preset ls
 *   pnpm effect:preset add <key> <effectKey> <params-json> --name <nhãn> --about <mô tả> [--note <ghi chú>]
 *   pnpm effect:preset add <key> <effectKey> --params-file <đường dẫn> --name <nhãn> --about <mô tả>
 *   pnpm effect:preset rm <key>
 *
 * Ví dụ (bash / Git Bash):
 *   pnpm effect:preset add dai-logo-chay slider '{"preset":"marquee","spaceBetween":48}' \
 *     --name "Dải logo chạy" \
 *     --about "Hàng logo đối tác chạy ngang liên tục, không điểm đầu cuối."
 *
 * ## Trên PowerShell phải đi qua `--params-file`
 *
 * PowerShell 5.1 GỠ dấu nháy kép khi truyền tham số sang một exe gốc:
 * `'{"preset":"marquee"}'` tới script thành `{preset:marquee}`. Đo ngày
 * 11/09/2026. Nó fail to, không im lặng — nhưng câu "JSON không hợp lệ" trỏ vào
 * một chuỗi mà người gõ NHÌN THẤY là đúng trong lệnh của mình, nên họ sẽ đi tìm
 * lỗi ở chỗ khác. `--params-file` đọc thẳng từ đĩa, không shell nào chạm vào.
 * Một bộ params thật có `breakpoints` lồng bên trong thì đằng nào cũng không gõ
 * nổi trên một dòng lệnh.
 *
 * ## Vì sao là script chứ không phải một tool MCP
 *
 * Cùng lý lẽ `set-site-domain.ts` đã viết: đây là việc VẬN HÀNH, không phải việc
 * soạn nội dung. Nhưng ở đây còn một lý do nặng hơn — một preset là một cái tên
 * mà từ đó về sau mọi Agent sẽ thấy trong `list_effects` và sẽ tin. Để AI tự
 * đặt tên cho hiệu ứng nghĩa là danh mục hiệu ứng của site lớn dần theo từng
 * phiên chat, mỗi phiên thêm một cái tên hơi khác cho cùng một thứ. Một người
 * phải đứng ở cửa đó.
 *
 * ## Vì sao script này VALIDATE params, và vì sao đó là phần quan trọng nhất
 *
 * Không validate thì `{"pre set":"marquee"}` hay `{"autoplayDelay":0}` vào DB
 * êm ru, và hỏng ở tận đầu kia: `EffectRuntime` parse params thất bại rồi bỏ
 * qua effect (`paramsSchema` của `slider` là `.strict()`), nên dải đứng im và
 * dòng cảnh báo duy nhất nằm trong console của người xem trang — không phải
 * console của người tạo preset. Khoảng cách giữa nguyên nhân và triệu chứng là
 * hai tuần và hai người.
 *
 * Nên script parse params bằng ĐÚNG `paramsSchema` của effect, ở đây, lúc ghi.
 * Nó import module effect thật trong Node — đường này đã được
 * `scripts/sync-effects.ts` chứng minh, và `slider.ts` cố ý không `import` CSS
 * nào để nó còn đi được.
 *
 * ## Ba thứ script này TỪ CHỐI, và vì sao
 *
 *  - **Key trùng một effect trong registry.** `validateOps` chỉ đi tìm preset
 *    khi key lạ với registry, nên một preset tên `slider` là một hàng chết,
 *    im lặng.
 *  - **`effectKey` không có trong registry.** Hàng đó gắn được nhưng không chạy
 *    được — `list_effects` sẽ báo `runnable: false`, nhưng thà chặn ngay.
 *  - **Params không parse được.** Xem trên.
 */

import { readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

import { EFFECT_REGISTRY, isKnownEffect, loadEffect } from '../src/lib/motion/effects/registry';

const prisma = new PrismaClient();

const KEY_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** `--name "x" --about "y"` → `{ name: 'x', about: 'y' }`. Phần còn lại là positional. */
function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`Cờ ${arg} thiếu giá trị.`);
        process.exit(1);
      }
      flags[arg.slice(2)] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function list() {
  const rows = await prisma.effectPreset.findMany({ orderBy: { key: 'asc' } });
  if (!rows.length) {
    console.log('Chưa có preset nào.');
    return;
  }
  for (const r of rows) {
    const dead = isKnownEffect(r.key)
      ? '  ← CHẾT: trùng key với một effect thật, không bao giờ được giải'
      : '';
    const gone = isKnownEffect(r.effectKey) ? '' : '  ← effectKey không có trong registry';
    console.log(`${r.key}  →  ${r.effectKey}${dead}${gone}`);
    console.log(`  ${r.name} — ${r.aiDescription}`);
    console.log(`  params: ${JSON.stringify(r.params)}`);
    if (r.note) console.log(`  ghi chú: ${r.note}`);
    console.log('');
  }
}

async function add(positional: string[], flags: Record<string, string>) {
  const [key, effectKey, inlineJson] = positional;

  /*
   * `--params-file` là đường THOÁT khỏi chuyện trích dẫn của shell.
   *
   * JSON trên dòng lệnh đi qua ba cách trích dẫn khác nhau (bash, PowerShell,
   * cmd) và PowerShell 5.1 thì gỡ mất nháy kép — xem nhánh bắt lỗi bên dưới.
   * Một bộ params thật có `breakpoints` lồng bên trong sẽ không gõ nổi trên
   * PowerShell. Đọc từ file thì không shell nào chạm vào nội dung.
   */
  let paramsJson = inlineJson;
  if (flags['params-file']) {
    if (inlineJson !== undefined) {
      console.error('Chọn một: params trên dòng lệnh HOẶC --params-file, không phải cả hai.');
      process.exit(1);
    }
    try {
      // Gỡ BOM: `Out-File -Encoding utf8` của PowerShell 5.1 LUÔN thêm BOM, và
      // `JSON.parse` chết vì nó với câu "Unexpected token" trỏ vào ký tự 0 —
      // một câu không ai truy ra được. Cách gọi ấy chính là cách được khuyến
      // nghị trong thông báo lỗi bên dưới, nên nó phải chạy được.
      paramsJson = readFileSync(flags['params-file'], 'utf8').replace(/^\uFEFF/, '');
    } catch (error) {
      console.error(`Không đọc được ${flags['params-file']}: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  if (!key || !effectKey || paramsJson === undefined) {
    /*
     * NÓI RA cái đã nhận, không chỉ nói "thiếu".
     *
     * Dòng usage có `…` làm chỗ trống, và `…` là một ký tự hợp lệ trong shell —
     * chép nguyên dòng usage rồi chạy thì script nhận đúng một positional tên
     * `…` và câu "Thiếu tham số" không chỉ ra được rằng đó chính là vấn đề. Đã
     * xảy ra thật ngày 11/09/2026.
     */
    console.error(
      `Thiếu tham số. Nhận ${positional.length} tham số vị trí: ` +
        `${positional.length ? positional.map((p) => JSON.stringify(p)).join(' ') : '(không có)'}\n` +
        'Cần <key> <effectKey> và params — params đi trên dòng lệnh, hoặc qua --params-file.\n\n' +
        'Ví dụ chạy được, chép nguyên (bash / Git Bash):\n' +
        '  pnpm effect:preset add dai-logo-chay slider \'{"preset":"marquee","spaceBetween":48}\' \\\n' +
        '    --name "Dải logo chạy" \\\n' +
        '    --about "Hàng logo đối tác chạy ngang liên tục, không có điểm đầu cuối."\n\n' +
        'Trên PowerShell thì đi qua file, vì PowerShell gỡ mất dấu nháy kép:\n' +
        '  pnpm effect:preset add dai-logo-chay slider --params-file params.json `\n' +
        '    --name "Dải logo chạy" --about "..."\n\n' +
        '`…` trong dòng hướng dẫn là chỗ trống, không phải thứ để gõ.',
    );
    process.exit(1);
  }
  if (!KEY_RE.test(key)) {
    console.error(`key phải là slug chữ thường (vd: dai-logo-chay). Nhận: ${key}`);
    process.exit(1);
  }
  if (isKnownEffect(key)) {
    console.error(
      `"${key}" đã là một effect thật trong registry. Preset trùng key với effect là một ` +
        'hàng CHẾT: validator chỉ đi tìm preset khi key lạ với registry, nên nó không bao ' +
        'giờ được giải và không ai báo gì. Đặt tên khác.',
    );
    process.exit(1);
  }
  if (!isKnownEffect(effectKey)) {
    console.error(
      `effectKey "${effectKey}" không có trong EFFECT_REGISTRY. Có: ` +
        `${Object.keys(EFFECT_REGISTRY).sort().join(', ')}`,
    );
    process.exit(1);
  }

  const name = flags.name;
  const about = flags.about;
  if (!name || !about) {
    // Không tự sinh từ key: `Effect.name` phải là NHÃN, và `aiDescription` là thứ
    // mọi Agent đọc để quyết định có dùng hay không. Một mô tả tự sinh từ slug là
    // một mô tả không ai viết và không ai đọc được.
    console.error('Cần --name "Nhãn tiếng Việt" và --about "Mô tả cho AI, đủ để retrieval khớp".');
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(paramsJson);
  } catch (error) {
    console.error(`params không phải JSON hợp lệ: ${(error as Error).message}`);
    console.error(`  nhận: ${paramsJson}`);

    /*
     * PowerShell 5.1 NUỐT dấu nháy kép khi truyền sang một exe gốc.
     *
     * `'{"preset":"marquee"}'` tới script thành `{preset:marquee}` — đã đo ngày
     * 11/09/2026. Câu "JSON không hợp lệ" đúng nhưng vô dụng ở đây: người gõ
     * NHÌN THẤY dấu nháy trong lệnh của mình và sẽ đi tìm lỗi ở chỗ khác. Dấu
     * hiệu nhận ra ca này rất gọn — mở bằng `{` mà trong cả chuỗi không còn một
     * dấu `"` nào.
     */
    if (paramsJson.trimStart().startsWith('{') && !paramsJson.includes('"')) {
      console.error(
        '\nChuỗi tới đây KHÔNG còn dấu nháy kép nào. Đây là PowerShell: nó gỡ nháy kép\n' +
          'khi truyền sang exe gốc. Ba cách, cách đầu là gọn nhất:\n\n' +
          '  1. Dùng file, không phụ thuộc shell:\n' +
          "       '{\"preset\":\"marquee\"}' | Out-File -Encoding utf8 params.json\n" +
          '       pnpm effect:preset add <key> <effectKey> --params-file params.json ...\n' +
          '  2. Thoát từng dấu nháy:  \'{\\"preset\\":\\"marquee\\"}\'\n' +
          '  3. Chạy trong Git Bash thay vì PowerShell.',
      );
    }
    process.exit(1);
  }

  const mod = await loadEffect(effectKey);
  if (!mod) {
    console.error(`Không nạp được module của "${effectKey}".`);
    process.exit(1);
  }

  /*
   * Parse rồi lưu bản ĐÃ PARSE hay bản THÔ?
   *
   * Lưu bản thô. Bản đã parse đã được Zod điền đầy default, nên một preset
   * `{ "preset": "marquee" }` sẽ nở thành mười một khoá — trong đó có bốn khoá
   * mà `slider` cố ý để `.optional()` cho preset quyết định. Lưu bản nở ra là
   * ghim cứng mặc định của NGÀY HÔM NAY vào preset, và lần sau đổi mặc định của
   * effect thì preset không đi theo. Parse ở đây chỉ để KIỂM.
   */
  const parsed = mod.paramsSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`params không hợp lệ với paramsSchema của "${effectKey}":`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(gốc)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  const existing = await prisma.effectPreset.findUnique({ where: { key } });
  const data = {
    name,
    aiDescription: about,
    effectKey,
    params: raw as object,
    note: flags.note ?? null,
  };
  await prisma.effectPreset.upsert({ where: { key }, create: { key, ...data }, update: data });

  console.log(`${existing ? '~' : '+'} ${key} → ${effectKey}  ${JSON.stringify(raw)}`);
  console.log(
    'Có hiệu lực NGAY — không cần deploy, không cần `pnpm effects:sync` (cái đó đồng bộ ' +
      'manifest của effect thật, không đụng bảng này).',
  );
  if (existing) {
    console.log(
      'LƯU Ý: các node ĐÃ gắn preset này không đổi. Preset là macro, giải một lần lúc ' +
        'gắn — xem docblock `model EffectPreset`. Muốn trang cũ đổi theo thì phải gắn lại.',
    );
  }
}

async function remove(positional: string[]) {
  const key = positional[0];
  if (!key) {
    console.error('  pnpm effect:preset rm <key>');
    process.exit(1);
  }
  const hit = await prisma.effectPreset.findUnique({ where: { key } });
  if (!hit) {
    console.error(`Không có preset "${key}".`);
    process.exit(1);
  }
  await prisma.effectPreset.delete({ where: { key } });
  console.log(
    `- ${key}. Các node đã gắn nó KHÔNG hỏng: chúng mang effect thật và params đã trộn, ` +
      'preset chỉ còn là một cái tên trong `fromPreset`.',
  );
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  switch (command) {
    case 'ls':
    case undefined:
      await list();
      break;
    case 'add':
      await add(rest, flags);
      break;
    case 'rm':
      await remove(rest);
      break;
    default:
      console.error(`Lệnh lạ: ${command}. Có: ls, add, rm.`);
      process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
