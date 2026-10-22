/**
 * Chuyển field `richdoc` → field `html` cho một loại nội dung. Chạy MỘT LẦN.
 *
 *     tsx scripts/richdoc-to-html.ts <typeKey> <fieldKey>          # thử, không ghi
 *     tsx scripts/richdoc-to-html.ts <typeKey> <fieldKey> --ghi    # ghi thật
 *
 * ## Vì sao là một script, không phải một dòng trong `SAFE_RETYPE`
 *
 * `checkSchemaChange` chặn `richdoc → html` có chủ đích, và docblock ở
 * `schema-change.ts` giải thích đầy đủ. Ngắn gọn: giá trị cũ trong JSONB là một MẢNG
 * `Block[]`, còn ô soạn `html` đọc `typeof value === 'string'`. Đổi kiểu field trước
 * khi đổi dữ liệu làm mọi bài cũ hiện ra TRỐNG, và bài đầu tiên được lưu lại sẽ ghi
 * cái trống đó lên nội dung thật.
 *
 * ## Thứ tự BẮT BUỘC
 *
 *  1. Chuyển DỮ LIỆU của mọi entry (kể cả lớp phủ bản dịch).
 *  2. RỒI mới đổi kiểu field trong `CollectionType.schema`.
 *
 * Đảo thứ tự thì bước 1 không chạy được: validator của kiểu mới từ chối mảng cũ.
 * Script này làm cả hai trong MỘT transaction, nên không có trạng thái nửa vời.
 *
 * ## Không chuyển ngược được
 *
 * `html → richdoc` là mất nội dung, không phải chưa làm: HTML nhận bảng, iframe,
 * `h1`, màu chữ, canh lề — `Block[]` không có chỗ biểu diễn chúng. Nên hãy chạy
 * `--ghi` chỉ khi đã có bản chụp database.
 */

import { PrismaClient } from '@prisma/client';

import { validateCollectionSchema, type FieldDef } from '../src/lib/collections/field-def';
import { loadGroupTable } from '../src/lib/collections/group-table';
import { sanitizeArticleHtml } from '../src/lib/collections/html-sanitize';
import { richDocToHtml, type AssetTable } from '../src/lib/collections/public-shape';
import { zRichDoc } from '../src/lib/doc/schema';
import type { RichDoc } from '../src/lib/doc/types';

const prisma = new PrismaClient();

/**
 * `richDocToHtml` phát `<figure><img>`, còn CKEditor nhận ra ảnh qua
 * `<figure class="image">`.
 *
 * Không sửa `richDocToHtml`: hàm đó là hợp đồng của API công khai (`?format=html`),
 * và thêm một class của một ô soạn cụ thể vào đó là để CKEditor rò vào một chỗ không
 * liên quan gì tới nó. Sửa ở đây, nơi việc "chuẩn bị dữ liệu cho CKEditor" là mục
 * đích của cả file.
 */
function markFigures(html: string): string {
  return html.replace(/<figure>(\s*<img\b)/g, '<figure class="image">$1');
}

function toHtml(value: unknown, assets: AssetTable): { html: string; changed: boolean } | null {
  // Đã là chuỗi: entry này đã chuyển rồi. Script chạy lại được mà không hỏng gì.
  if (typeof value === 'string') return { html: value, changed: false };
  if (!Array.isArray(value)) return null;

  const parsed = zRichDoc.safeParse(value);
  // Không parse được: KHÔNG chuyển, KHÔNG ghi gì. Một cây richdoc hỏng chuyển thành
  // HTML sai còn tệ hơn là để nguyên cho người xử lý tay — dữ liệu vẫn còn đó.
  if (!parsed.success) return null;

  const raw = markFigures(richDocToHtml(parsed.data as RichDoc, assets));
  // Đi qua đúng phép làm sạch của đường ghi. `iframeHosts: []` vì `richDocToHtml`
  // không phát `<iframe>` bao giờ — nếu một ngày nó phát thì đây là chỗ cần sửa.
  return { html: sanitizeArticleHtml(raw, { iframeHosts: [] }).html, changed: true };
}

/** Mọi `assetId` trong một cây richdoc — cùng phép quét mù với `collectAssetIds`. */
function assetIdsOf(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) assetIdsOf(v, into);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const rec = value as Record<string, unknown>;
  if (typeof rec.assetId === 'string') into.add(rec.assetId);
  for (const v of Object.values(rec)) assetIdsOf(v, into);
}

async function main() {
  const [typeKey, fieldKey, ...flags] = process.argv.slice(2);
  const write = flags.includes('--ghi');

  if (!typeKey || !fieldKey) {
    console.error('Dùng: tsx scripts/richdoc-to-html.ts <typeKey> <fieldKey> [--ghi]');
    process.exit(1);
  }

  const type = await prisma.collectionType.findUnique({ where: { key: typeKey } });
  if (!type) {
    console.error(`Không có loại nội dung "${typeKey}"`);
    process.exit(1);
  }

  const groups = await loadGroupTable();
  const checked = validateCollectionSchema(type.schema, groups);
  if (!checked.ok) {
    console.error(`Cấu trúc của "${typeKey}" không hợp lệ: ${checked.error}`);
    process.exit(1);
  }

  const field = checked.fields.find((f) => f.key === fieldKey);
  if (!field) {
    console.error(`Loại "${typeKey}" không có field "${fieldKey}"`);
    process.exit(1);
  }
  if (field.t === 'html') {
    console.log(`Field "${fieldKey}" đã là kiểu html — không có gì để làm.`);
    return;
  }
  if (field.t !== 'richdoc') {
    console.error(`Field "${fieldKey}" là kiểu "${field.t}", script này chỉ chuyển richdoc.`);
    process.exit(1);
  }

  const entries = await prisma.entry.findMany({
    where: { typeKey },
    select: { id: true, slug: true, data: true, i18n: true },
  });

  // Một lượt đọc asset cho TẤT CẢ entry: mỗi cây `figure` cần URL thật, và một truy
  // vấn cho mỗi entry là N+1 trên đúng thao tác chỉ chạy một lần.
  const ids = new Set<string>();
  for (const e of entries) {
    assetIdsOf(e.data, ids);
    assetIdsOf(e.i18n, ids);
  }
  const rows = ids.size
    ? await prisma.asset.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, url: true, width: true, height: true, blurhash: true, mime: true },
      })
    : [];
  const assets: AssetTable = Object.fromEntries(rows.map((a) => [a.id, a]));

  const plan: { id: string; slug: string; data: Record<string, unknown>; i18n: Record<string, unknown> }[] = [];
  const skipped: { slug: string; why: string }[] = [];

  for (const e of entries) {
    const data = { ...(e.data as Record<string, unknown>) };
    const i18n = { ...((e.i18n ?? {}) as Record<string, unknown>) };
    let touched = false;

    const main = toHtml(data[fieldKey], assets);
    if (data[fieldKey] !== undefined && main === null) {
      skipped.push({ slug: e.slug, why: `data.${fieldKey} không đọc được bằng zRichDoc` });
      continue;
    }
    if (main?.changed) {
      data[fieldKey] = main.html;
      touched = true;
    }

    /*
     * Lớp phủ bản dịch cũng phải chuyển, và nó là chỗ dễ quên nhất.
     *
     * `applyEntryLocale` đặt giá trị của lớp phủ vào ĐÚNG vị trí của field đã
     * validate. Bỏ qua nó nghĩa là bản gốc thành chuỗi HTML còn bản tiếng Anh vẫn là
     * mảng — và trang tiếng Anh sẽ trắng, im lặng, sau khi ai đó tưởng đã chuyển xong.
     */
    for (const [code, overlay] of Object.entries(i18n)) {
      if (typeof overlay !== 'object' || overlay === null) continue;
      const o = { ...(overlay as Record<string, unknown>) };
      if (o[fieldKey] === undefined) continue;
      const t = toHtml(o[fieldKey], assets);
      if (t === null) {
        skipped.push({ slug: e.slug, why: `i18n.${code}.${fieldKey} không đọc được bằng zRichDoc` });
        continue;
      }
      if (t.changed) {
        o[fieldKey] = t.html;
        i18n[code] = o;
        touched = true;
      }
    }

    if (touched) plan.push({ id: e.id, slug: e.slug, data, i18n });
  }

  const nextFields: FieldDef[] = checked.fields.map((f) =>
    f.key === fieldKey
      ? {
          t: 'html' as const,
          key: f.key,
          label: f.label,
          // `'required' in f` chứ không `f.required`: nhánh `boolean` của
          // `FieldDef` không có trường đó (nó có `default`), nên đọc thẳng không
          // biên dịch được.
          ...('required' in f && f.required ? { required: true } : {}),
          // `maxBlocks` không có ở kiểu `html` (khối trong HTML không đếm được mà
          // không dựng cây) — chỉ `maxChars` đi theo, và nó đo cùng một thứ: số chữ.
          ...(f.t === 'richdoc' && f.maxChars !== undefined ? { maxChars: f.maxChars } : {}),
          ...(f.help ? { help: f.help } : {}),
        }
      : f,
  );

  const after = validateCollectionSchema(nextFields, groups);
  if (!after.ok) {
    console.error(`Cấu trúc mới không hợp lệ: ${after.error}`);
    process.exit(1);
  }

  console.log(`Loại "${typeKey}", field "${fieldKey}": ${entries.length} entry.`);
  console.log(`  sẽ chuyển: ${plan.length}`);
  for (const p of plan) console.log(`    · /${p.slug}`);
  if (skipped.length) {
    console.log(`  BỎ QUA ${skipped.length} (dữ liệu giữ nguyên, cần xử lý tay):`);
    for (const s of skipped) console.log(`    · /${s.slug} — ${s.why}`);
  }

  if (!write) {
    console.log('\nChưa ghi gì. Thêm --ghi để ghi thật.');
    if (skipped.length) {
      console.log('LƯU Ý: còn entry bỏ qua. Chạy --ghi vẫn đổi kiểu field, và những');
      console.log('entry đó sẽ hiện TRỐNG trong ô soạn (dữ liệu cũ còn trong JSONB).');
    }
    return;
  }

  /*
   * Một transaction cho CẢ dữ liệu và schema.
   *
   * Nửa vời ở đây là trạng thái tệ nhất có thể: schema nói `html` mà dữ liệu còn là
   * mảng nghĩa là mọi bài hiện trống và lần lưu đầu tiên xoá nội dung thật.
   */
  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      await tx.entry.update({
        where: { id: p.id },
        data: { data: p.data as never, i18n: p.i18n as never },
      });
    }
    await tx.collectionType.update({
      where: { key: typeKey },
      data: { schema: after.fields as never },
    });
  });

  console.log(`\nXong. Đã chuyển ${plan.length} entry và đổi kiểu field sang html.`);
  console.log('Nhớ chạy lại `pnpm dev` (hoặc revalidate) để cache của loại này được dựng lại.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
