/**
 * Nội dung mẫu cho máy dev và stack e2e: ba component (Header builtin, thẻ tính năng, chân
 * trang) với instance trên trang chủ, và mười "khối mẫu" làm trang chủ dài và nhiều node.
 *
 * Lý do tồn tại: pane Component, chế độ sửa component, cây Lớp (gập/mở, tìm, cuộn tới node
 * ở sâu) và việc "nhảy tới chỗ dùng" không thử được trên một trang chủ ngắn vài node, hoặc khi
 * kho component trống. Trang chủ trung tính của site THẬT (màn cài đặt) không đi qua đây.
 *
 * Ghi BẢN NHÁP trang chủ (một version mới, cha là bản nháp hiện tại); publish đi qua
 * `/api/publish` (scripts/publish-drafts.ts). Idempotent: chạy lại thì cập nhật cây component
 * và đặt lại đúng các node của mình.
 *
 *   pnpm exec tsx scripts/seed-demo-content.ts
 */

import { PrismaClient } from '@prisma/client';

import type { Doc, Node } from '../src/lib/doc/types';
import { CURRENT_SCHEMA_VERSION } from '../src/lib/doc/types';
import { zDoc } from '../src/lib/doc/schema';

const prisma = new PrismaClient();
const t = (name: string) => ({ $token: name });

const base = { children: [] as string[], effects: [], style: { base: {} } };
const text = (id: string, parentId: string, tag: string, name: string, v: string, style = {}) =>
  ({ ...base, id, parentId, type: 'Text', tag, name, content: [{ t: 'text', v }], style: { base: style } }) as unknown as Node;

function tree(root: Node, kids: Node[]) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rootId: root.id,
    nodes: Object.fromEntries([root, ...kids].map((n) => [n.id, n])),
  };
}

const COMPONENTS = [
  {
    // Khoá `header`, builtin: dáng của component trích tự động từ site cũ — thư viện component
    // phải thử được cả cảnh báo builtin lẫn việc không cho xoá.
    key: 'header',
    name: 'Header',
    builtin: true,
    category: 'layout',
    aiDescription: 'Thanh đầu trang: tên site, năm link điều hướng, nút Đăng nhập và Dùng thử.',
    tree: tree(
      {
        ...base, id: 'h1', parentId: null, type: 'Section', tag: 'header', name: 'Đầu trang',
        children: ['h2', 'hnav', 'hact'],
        style: {
          base: {
            layout: { display: 'flex', align: 'center', justify: 'between', gap: t('space-m') },
            spacing: { pt: t('space-s'), pb: t('space-s'), pl: t('gutter'), pr: t('gutter') },
          },
        },
      } as unknown as Node,
      [
        text('h2', 'h1', 'p', 'Tên site', 'Quilder Demo', { typography: { weight: 700 } }),
        {
          ...base, id: 'hnav', parentId: 'h1', type: 'Stack', direction: { base: 'row' }, name: 'Điều hướng',
          children: ['hn1', 'hn2', 'hn3', 'hn4', 'hn5'],
          style: { base: { layout: { gap: t('space-s') } } },
        } as unknown as Node,
        ...(['Tính năng', 'Bảng giá', 'Khách hàng', 'Blog', 'Về chúng tôi'] as const).map(
          (v, i) =>
            ({
              ...base, id: `hn${i + 1}`, parentId: 'hnav', type: 'Button', name: `Link ${v}`, variant: 'ghost',
              action: { kind: 'link', href: i === 4 ? '/gioi-thieu' : '/' }, label: [{ t: 'text', v }],
            }) as unknown as Node,
        ),
        {
          ...base, id: 'hact', parentId: 'h1', type: 'Stack', direction: { base: 'row' }, name: 'Nút hành động',
          children: ['hlogin', 'hcta'],
          style: { base: { layout: { gap: t('space-xs') } } },
        } as unknown as Node,
        {
          ...base, id: 'hlogin', parentId: 'hact', type: 'Button', name: 'Đăng nhập', variant: 'ghost',
          action: { kind: 'link', href: '/' }, label: [{ t: 'text', v: 'Đăng nhập' }],
        } as unknown as Node,
        {
          ...base, id: 'hcta', parentId: 'hact', type: 'Button', name: 'Dùng thử', variant: 'primary',
          action: { kind: 'link', href: '/' }, label: [{ t: 'text', v: 'Dùng thử' }],
        } as unknown as Node,
      ],
    ),
  },
  {
    key: 'the-tinh-nang',
    name: 'Thẻ tính năng',
    builtin: false,
    category: 'content',
    aiDescription: 'Thẻ một tính năng: tiêu đề ngắn và một câu mô tả.',
    tree: tree(
      {
        ...base, id: 'c1', parentId: null, type: 'Section', tag: 'section', name: 'Thẻ tính năng',
        children: ['c2', 'c3'],
        style: {
          base: {
            layout: { display: 'flex', flexDirection: 'column', gap: t('space-xs') },
            spacing: { pt: t('space-l'), pb: t('space-l'), pl: t('gutter'), pr: t('gutter') },
          },
        },
      } as unknown as Node,
      [
        text('c2', 'c1', 'h3', 'Tiêu đề thẻ', 'Sửa trực tiếp trên bản xem trước', { typography: { size: t('step-1'), weight: 600 } }),
        text('c3', 'c1', 'p', 'Mô tả thẻ', 'Bấm vào chữ là sửa được, không cần form riêng.'),
      ],
    ),
  },
  {
    key: 'chan-trang',
    name: 'Chân trang',
    builtin: false,
    category: 'layout',
    aiDescription: 'Chân trang: một dòng bản quyền.',
    tree: tree(
      {
        ...base, id: 'f1', parentId: null, type: 'Section', tag: 'footer', name: 'Chân trang',
        children: ['f2'],
        style: { base: { spacing: { pt: t('space-xl'), pb: t('space-xl'), pl: t('gutter'), pr: t('gutter') } } },
      } as unknown as Node,
      [text('f2', 'f1', 'p', 'Bản quyền', '© Quilder Demo', { typography: { size: t('step--1') } })],
    ),
  },
] as const;

/** Instance trên trang chủ: đầu trang ở đầu, thẻ ở giữa, chân trang ở CUỐI (dưới màn đầu). */
const INSTANCES = [
  { id: 'seedhead', key: 'header', name: 'Header', at: 'start' },
  { id: 'seedcard', key: 'the-tinh-nang', name: 'Thẻ tính năng', at: 'middle' },
  { id: 'seedfoot', key: 'chan-trang', name: 'Chân trang', at: 'end' },
] as const;

/**
 * Mười khối mẫu: tiêu đề, đoạn chữ, lưới ba thẻ — 13 node mỗi khối. Đủ dài để có node nằm
 * dưới màn thứ ba, đủ nhiều để cây Lớp có trên 100 hàng.
 */
function demoBlocks(parentId: string): { ids: string[]; nodes: Node[] } {
  const ids: string[] = [];
  const nodes: Node[] = [];
  for (let b = 1; b <= 10; b++) {
    const id = `demo${b}`;
    const grid = `${id}g`;
    ids.push(id);
    nodes.push({
      ...base, id, parentId, type: 'Section', tag: 'section', name: `Khối mẫu ${b}`,
      children: [`${id}h`, `${id}p`, grid],
      style: { base: { spacing: { pt: t('space-3xl'), pb: t('space-3xl'), pl: t('gutter'), pr: t('gutter') } } },
    } as unknown as Node);
    nodes.push(text(`${id}h`, id, 'h2', `Tiêu đề khối ${b}`, `Khối mẫu số ${b}`, { typography: { size: t('step-3'), weight: 700 } }));
    const lede = text(`${id}p`, id, 'p', `Mô tả khối ${b}`, 'Một khối ví dụ: tiêu đề, một câu mô tả và lưới ba thẻ.');
    // Khối 1 mang chữ CÓ CẤU TRÚC (chữ đậm + link) — bảng Văn bản phải có ô "có cấu trúc" để thử.
    if (b === 1) {
      (lede as unknown as { content: unknown }).content = [
        { t: 'text', v: 'Tiết kiệm tiền và thời gian: ' },
        { t: 'strong', children: [{ t: 'text', v: 'sửa ngay trên khung' }] },
        { t: 'text', v: ', xem thêm ở ' },
        { t: 'link', href: '/gioi-thieu', children: [{ t: 'text', v: 'trang giới thiệu' }] },
        { t: 'text', v: '.' },
      ];
    }
    nodes.push(lede);
    const cards = [1, 2, 3].map((c) => `${id}c${c}`);
    nodes.push({
      ...base, id: grid, parentId: id, type: 'Grid', name: `Lưới thẻ ${b}`, children: cards,
      style: { base: { layout: { gap: t('space-m') }, spacing: { mt: t('space-l') } } },
    } as unknown as Node);
    for (const [i, card] of cards.entries()) {
      nodes.push({
        ...base, id: card, parentId: grid, type: 'Stack', direction: { base: 'column' }, name: `Thẻ ${b}.${i + 1}`,
        children: [`${card}t`, `${card}d`],
      } as unknown as Node);
      nodes.push(text(`${card}t`, card, 'h3', `Tiêu đề thẻ ${b}.${i + 1}`, `Thẻ ${b}.${i + 1}`, { typography: { weight: 600 } }));
      nodes.push(text(`${card}d`, card, 'p', `Mô tả thẻ ${b}.${i + 1}`, 'Chữ mẫu, sửa được trực tiếp trên khung.'));
    }
  }
  return { ids, nodes };
}

/** Đi qua schema thật: một cây viết tay sai là hỏng ngay ở đây, không phải ở lần render đầu. */
function check(label: string, d: unknown) {
  const r = zDoc.safeParse(d);
  if (!r.success) throw new Error(`${label}: ${JSON.stringify(r.error.issues.slice(0, 3))}`);
}

async function main() {
  for (const c of COMPONENTS) check(`component ${c.key}`, c.tree);
  const ids = new Map<string, string>();
  for (const c of COMPONENTS) {
    const data = { name: c.name, category: c.category, aiDescription: c.aiDescription, tree: c.tree as object, builtin: c.builtin };
    const preset = await prisma.preset.upsert({
      where: { key: c.key },
      create: { key: c.key, ...data, versions: { create: { tree: c.tree as object, label: 'seed', createdBy: 'script' } } },
      update: data,
      select: { id: true },
    });
    ids.set(c.key, preset.id);
  }

  const site = await prisma.site.findFirstOrThrow();
  const home = await prisma.page.findFirstOrThrow({
    where: { siteId: site.id, slug: '' },
    include: { draftVersion: true },
  });
  const doc = structuredClone(home.draftVersion!.doc) as unknown as Doc;
  const root = doc.nodes[doc.rootId]!;
  const ours = new Set<string>(INSTANCES.map((i) => i.id));
  root.children = root.children.filter((c) => !ours.has(c) && !c.startsWith('demo'));
  for (const id of Object.keys(doc.nodes)) if (id.startsWith('demo')) delete doc.nodes[id];

  // Khối mẫu nằm trước chân trang (chân trang thêm sau, ở cuối).
  const demo = demoBlocks(doc.rootId);
  for (const n of demo.nodes) doc.nodes[n.id] = n;
  root.children.push(...demo.ids);

  for (const i of INSTANCES) {
    doc.nodes[i.id] = {
      ...base, id: i.id, parentId: doc.rootId, type: 'Instance', componentId: ids.get(i.key)!,
      name: i.name, overrides: {},
    } as unknown as Node;
    if (i.at === 'start') root.children.unshift(i.id);
    else if (i.at === 'end') root.children.push(i.id);
    else root.children.splice(Math.ceil(root.children.length / 2), 0, i.id);
  }

  check('trang chủ', doc);
  const version = await prisma.pageVersion.create({
    data: {
      pageId: home.id, doc: doc as unknown as object, schemaVer: CURRENT_SCHEMA_VERSION,
      label: 'seed-demo-content', createdBy: 'script', parentId: home.draftVersionId,
    },
  });
  await prisma.page.update({ where: { id: home.id }, data: { draftVersionId: version.id } });
  console.log(`component: ${COMPONENTS.length}, instance trên trang chủ: ${INSTANCES.length}, khối mẫu: ${demo.ids.length}`);
}

main().finally(() => prisma.$disconnect());
