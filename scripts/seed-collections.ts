/**
 * Seed `news` + `faq` + danh mục + 3 nhóm field.
 *
 * Chạy được nhiều lần: mọi thao tác là `upsert` theo `key`. Nhưng nó GHI ĐÈ cấu
 * trúc đã sửa tay — cùng cảnh báo với `Preset.builtin`.
 *
 * Vì sao seed đúng hai loại này: chúng là hai hình dạng khác nhau. `news` có
 * richtext, ảnh, nhóm lặp và Dynamic Zone; `faq` chỉ có hai field và một danh mục.
 * Một loại thôi thì không phát hiện được thứ chỉ sai khi có loại thứ hai.
 */

import { PrismaClient } from '@prisma/client';

import type { FieldDef } from '../src/lib/collections/field-def';

const prisma = new PrismaClient();

const GROUPS: { key: string; name: string; icon: string; schema: FieldDef[] }[] = [
  {
    key: 'cta', name: 'Khối CTA', icon: '▭',
    schema: [
      { t: 'text', key: 'heading', label: 'Tiêu đề', required: true, maxLength: 120 },
      { t: 'link', key: 'action', label: 'Đường dẫn' },
      { t: 'enum', key: 'tone', label: 'Kiểu nút', options: [{ value: 'primary', label: 'Nút chính' }, { value: 'ghost', label: 'Nút phụ' }] },
    ],
  },
  {
    key: 'quote', name: 'Khối trích dẫn', icon: '❝',
    schema: [
      { t: 'text', key: 'text', label: 'Câu trích', required: true, multiline: true, maxLength: 400 },
      { t: 'text', key: 'author', label: 'Người nói', maxLength: 80 },
      { t: 'text', key: 'role', label: 'Chức danh', maxLength: 80 },
    ],
  },
  {
    key: 'figure', name: 'Ảnh + chú thích', icon: '▣',
    schema: [
      { t: 'image', key: 'image', label: 'Ảnh', required: true, requireAlt: true },
      { t: 'text', key: 'caption', label: 'Chú thích', maxLength: 200 },
      { t: 'text', key: 'source', label: 'Nguồn', maxLength: 120 },
    ],
  },
];

const NEWS: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề', required: true, maxLength: 120 },
  { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
  { t: 'text', key: 'excerpt', label: 'Mô tả ngắn', multiline: true, maxLength: 200, help: 'Dùng cho thẻ tin và cho og:description' },
  { t: 'image', key: 'cover', label: 'Ảnh bìa', required: true, requireAlt: true },
  { t: 'richtext', key: 'body', label: 'Nội dung', required: true },
  { t: 'group', key: 'ctas', label: 'Đoạn CTA', groupKey: 'cta', repeatable: true, max: 3 },
  { t: 'blocks', key: 'zone', label: 'Khối nội dung', allowed: ['quote', 'figure', 'cta'] },
  { t: 'taxonomy', key: 'cats', label: 'Danh mục', required: true, multiple: true },
  { t: 'relation', key: 'related', label: 'Tin liên quan (chọn tay)', typeKey: 'news', cardinality: 'many' },
];

const FAQ: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Câu hỏi', required: true, maxLength: 200 },
  { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
  { t: 'richtext', key: 'answer', label: 'Trả lời', required: true },
  { t: 'taxonomy', key: 'cats', label: 'Danh mục', required: true, multiple: false },
];

const TAXONOMIES: Record<string, string[]> = {
  news: ['Tin tức', 'Sản phẩm', 'Báo chí', 'Hướng dẫn'],
  faq: ['Về chúng tôi', 'Tài khoản', 'Thanh toán', 'Sản phẩm', 'Phí', 'Bảo mật', 'Khác'],
};

const toKey = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function main() {
  for (const g of GROUPS) {
    await prisma.fieldGroupDef.upsert({
      where: { key: g.key },
      create: { key: g.key, name: g.name, icon: g.icon, schema: g.schema as unknown as object },
      update: { name: g.name, icon: g.icon, schema: g.schema as unknown as object },
    });
  }
  console.log(`✓ ${GROUPS.length} nhóm field`);

  const types = [
    { key: 'news', name: 'Tin tức', namePlural: 'Tin tức', icon: '▤', schema: NEWS },
    { key: 'faq', name: 'Câu hỏi thường gặp', namePlural: 'Câu hỏi thường gặp', icon: '?', schema: FAQ },
  ];

  for (const t of types) {
    await prisma.collectionType.upsert({
      where: { key: t.key },
      create: {
        key: t.key, name: t.name, namePlural: t.namePlural, icon: t.icon,
        schema: t.schema as unknown as object, titleField: 'title', slugField: 'slug',
      },
      update: {
        name: t.name, namePlural: t.namePlural, icon: t.icon,
        schema: t.schema as unknown as object, titleField: 'title', slugField: 'slug',
      },
    });

    for (const [i, name] of (TAXONOMIES[t.key] ?? []).entries()) {
      await prisma.taxonomy.upsert({
        where: { typeKey_key: { typeKey: t.key, key: toKey(name) } },
        create: { typeKey: t.key, key: toKey(name), name, order: i },
        update: { name, order: i },
      });
    }
    console.log(`✓ ${t.key} + ${(TAXONOMIES[t.key] ?? []).length} danh mục`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
