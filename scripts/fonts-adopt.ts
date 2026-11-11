/**
 * Chuyển font của gói dự án vào kho font (FontFamily / FontFace / Token) — §5.2.
 *
 * Chạy:
 *   pnpm fonts:adopt --actor <email>            # chỉ in kế hoạch
 *   pnpm fonts:adopt --actor <email> --apply    # ghi thật
 *   pnpm fonts:adopt --actor <email> --css projects/maimoney/styles/fonts.css
 *
 * Mặc định đọc `projects/$QUILDER_PROJECT/styles/fonts.css`. Chạy lại không tạo thêm gì
 * (họ đã có cùng sha các face thì in `đã có`). KHÔNG BAO GIỜ xoá file của gói: người dùng
 * tự làm sau khi Publish (§5.2 bước 4).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { licenseNoteOf, parseFontFaceCss, planAdoption } from '../src/lib/fonts/adopt';
import { toWoff2 } from '../src/lib/fonts/convert';
import { inspectFont } from '../src/lib/fonts/inspect';
import { readFontSeal } from '../src/lib/fonts/seal';
import { addFace } from '../src/lib/fonts/service';

const prisma = new PrismaClient();

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** `revalidateTag` chỉ chạy trong Next; ở script nó ném sau khi dữ liệu đã ghi xong. */
const isNoNextContext = (e: unknown) => /static generation store|workStore|Invariant/i.test(String((e as Error)?.message ?? e));

async function main() {
  const email = (argOf('actor') ?? '').toLowerCase();
  const apply = process.argv.includes('--apply');
  const pack = process.env.QUILDER_PROJECT?.trim() || '';
  const cssPath = argOf('css') ?? (pack ? `projects/${pack}/styles/fonts.css` : '');
  if (!email) fail('Dùng: pnpm fonts:adopt --actor <email> [--css <đường dẫn>] [--apply]');
  if (!cssPath) fail('Thiếu --css và QUILDER_PROJECT chưa đặt.');
  // Tên gói để đổi `/p/<x>` thành `projects/<gói>/public/<x>`: lấy từ đường dẫn CSS nếu có.
  const packName = /(?:^|[\\/])projects[\\/]([^\\/]+)[\\/]/.exec(cssPath)?.[1] ?? pack;
  if (!packName) fail('Không suy ra được tên gói từ --css; đặt QUILDER_PROJECT.');

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true },
  });
  if (!user) return fail(`Không có tài khoản ${email}. Tạo bằng: pnpm user:create ${email} <mật-khẩu>`);
  if (user.role === 'viewer') return fail(`Tài khoản ${email} có vai trò "viewer", không thêm font được.`);
  const actor = { email: user.email, sub: user.id };

  const css = readFileSync(resolve(cssPath), 'utf8');
  const faces = parseFontFaceCss(css, packName);
  if (!faces.length) return fail(`Không thấy @font-face nào trong ${cssPath}.`);
  const licenseNote = licenseNoteOf(css);

  const bytesOf = (file: string) => new Uint8Array(readFileSync(resolve(file)));
  // sha của byte SẼ lưu: woff2 giữ nguyên, ttf/otf là kết quả cắt (deterministic).
  const shas = new Map<string, string>();
  for (const f of faces) {
    const bytes = bytesOf(f.file);
    const info = inspectFont(bytes);
    const stored = info.format === 'woff2' ? bytes : (await toWoff2(bytes, info.format)).bytes;
    shas.set(f.file, sha256(stored));
  }
  const shaOf = (file: string) => shas.get(file) ?? '';

  const existing = await readFontSeal(prisma);
  const existingShas = new Map<string, Set<string>>();
  for (const fam of existing.families) {
    const set = new Set<string>();
    for (const face of fam.faces) {
      const m = /-([0-9a-f]{8})\.[^./]+$/.exec(face.key);
      if (m?.[1]) set.add(m[1]);
    }
    existingShas.set(fam.slug, set);
  }

  const plan = planAdoption(faces, existing, shaOf, existingShas);
  console.log(`Kế hoạch (${cssPath}): ${plan.length} họ / ${faces.length} face`);
  for (const p of plan) {
    console.log(
      p.action === 'skip'
        ? `  đã có   ${p.family} (${p.slug})`
        : `  tạo     ${p.family} (${p.slug}, token font-${p.slug}): ${p.faces.map((f) => `${f.weight}${f.style === 'italic' ? 'i' : ''}`).join(', ')}`,
    );
  }
  if (!apply) {
    console.log('Chưa ghi gì. Thêm --apply để chuyển vào kho.');
    return;
  }

  let written = 0;
  for (const p of plan) {
    if (p.action === 'skip') continue;
    for (const f of p.faces) {
      const bytes = bytesOf(f.file);
      const isWoff2 = inspectFont(bytes).format === 'woff2';
      try {
        const r = await addFace(
          {
            bytes,
            fileName: f.file.split(/[\\/]/).pop() ?? f.file,
            family: p.family,
            weight: f.weight,
            style: f.style,
            licenseConfirmed: true,
            licenseNote,
            source: 'upload',
            adoptToken: true,
            // woff2 của gói đã cắt sẵn: giữ byte và `unicode-range` của CSS (R3).
            ...(isWoff2 ? { prepared: { unicodeRange: f.unicodeRange, subset: '' } } : {}),
          },
          actor,
        );
        console.log(`  ghi ${p.family} ${f.weight} ${f.style}${r.family.created ? ' (họ mới)' : ''}`);
      } catch (e) {
        if (!isNoNextContext(e)) throw e;
        console.log(`  ghi ${p.family} ${f.weight} ${f.style} (cache của app chưa làm mới)`);
      }
      written++;
    }
  }
  console.log(`Xong: ${written} face. Publish một lần để Release.fonts có họ mới; file trong gói giữ nguyên.`);
  console.log(
    'Builder còn cache kho font cũ trên đĩa (.next/cache/fetch-cache): xoá thư mục đó rồi khởi động lại app — xem docs/huong-dan/font.md, bước 3.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
