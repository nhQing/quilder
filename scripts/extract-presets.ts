/**
 * Trích các section trong doc hiện tại thành Preset tái dùng được.
 *
 * Preset KHÔNG phải hộp đen. Nó chỉ là một cây node dựng sẵn: chèn xong thì mọi
 * node bên trong sửa được tự do như node bạn tự tạo. Đây là khác biệt then chốt
 * so với mô hình section-template kiểu Strapi, nơi bạn chỉ đổi được text và ảnh.
 *
 * Chạy: pnpm exec tsx scripts/extract-presets.ts
 */

import { PrismaClient } from '@prisma/client';

import { migrateDoc } from '../src/lib/doc/migrate';
import type { Doc, Node, NodeId } from '../src/lib/doc/types';

const prisma = new PrismaClient();

/** Section muốn trích: id trong doc → thông tin preset. */
const TARGETS: Array<{
  nodeId: NodeId;
  key: string;
  name: string;
  category: string;
  aiDescription: string;
}> = [
  {
    nodeId: 'n0000003', key: 'header', name: 'Header',
    category: 'layout',
    aiDescription:
      'Thanh điều hướng trên cùng: logo, menu chính, nút CTA. Thu gọn thành pill nổi khi cuộn.',
  },
  {
    nodeId: 'n0000102', key: 'footer', name: 'Footer',
    category: 'layout',
    aiDescription:
      'Chân trang: cột liên kết, thông tin giấy phép, liên hệ, mạng xã hội.',
  },
];

/** Cây con dưới dạng Doc con — id giữ nguyên, sẽ được sinh mới lúc chèn. */
function extractSubtree(doc: Doc, rootId: NodeId): { rootId: NodeId; nodes: Record<string, Node> } {
  const nodes: Record<string, Node> = {};
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const n = doc.nodes[id];
    if (!n) continue;
    nodes[id] = structuredClone(n);
    stack.push(...n.children);
  }
  // Gốc của preset không có cha — cha thật được quyết lúc chèn.
  nodes[rootId] = { ...nodes[rootId]!, parentId: null };
  return { rootId, nodes };
}

async function main() {
  const site = await prisma.site.findFirstOrThrow();
  const entry = await prisma.releaseEntry.findFirstOrThrow({
    where: { releaseId: site.activeReleaseId!, slug: '' },
    include: { version: true },
  });
  const doc = migrateDoc(entry.version.doc);

  for (const target of TARGETS) {
    if (!doc.nodes[target.nodeId]) {
      console.log(`bỏ qua ${target.key}: không tìm thấy node ${target.nodeId}`);
      continue;
    }
    const tree = extractSubtree(doc, target.nodeId);
    await prisma.preset.upsert({
      where: { key: target.key },
      create: {
        key: target.key, name: target.name, category: target.category,
        aiDescription: target.aiDescription, tree: tree as unknown as object,
      },
      update: {
        name: target.name, category: target.category,
        aiDescription: target.aiDescription, tree: tree as unknown as object,
      },
    });
    console.log(`${target.key.padEnd(10)} ${Object.keys(tree.nodes).length} node`);
  }

  /* ── Preset dựng tay: khối nhỏ, ghép nhanh ────────────────────────── */

  const handmade = [
    {
      key: 'section-blank', name: 'Section trống', category: 'layout',
      aiDescription: 'Một section rỗng, canh giữa, có padding dọc. Dùng làm khung để dựng nội dung mới.',
      tree: {
        rootId: 'p1',
        nodes: {
          p1: {
            id: 'p1', type: 'Section', tag: 'section', parentId: null, children: [],
            name: 'Section', effects: [],
            style: {
              base: {
                layout: { display: 'flex', align: 'center', gap: { $token: 'space-m' } },
                spacing: {
                  pt: { $token: 'space-3xl' }, pb: { $token: 'space-3xl' },
                  pl: { $token: 'gutter' }, pr: { $token: 'gutter' },
                },
              },
            },
          },
        },
      },
    },
    {
      key: 'heading-lede', name: 'Tiêu đề + mô tả', category: 'content',
      aiDescription: 'Cặp tiêu đề lớn và đoạn mô tả canh giữa, có hiệu ứng hiện dần khi cuộn.',
      tree: {
        rootId: 'p1',
        nodes: {
          p1: {
            id: 'p1', type: 'Stack', direction: { base: 'column' },
            parentId: null, children: ['p2', 'p3'], name: 'Cụm tiêu đề', effects: [],
            style: {
              base: {
                layout: { display: 'flex', align: 'center', gap: { $token: 'space-s' } },
                typography: { align: 'center' },
                size: { maxWidth: 'measure' },
              },
            },
          },
          p2: {
            id: 'p2', type: 'Text', tag: 'h2', parentId: 'p1', children: [],
            name: 'Tiêu đề',
            effects: [{ id: 'fx1', effect: 'text-split', params: { mode: 'lines' } }],
            style: {
              base: {
                typography: {
                  family: { $token: 'font-display' }, size: { $token: 'step-4' },
                  weight: 700, wrap: 'balance',
                },
              },
            },
            content: [{ t: 'text', v: 'Tiêu đề section' }],
          },
          p3: {
            id: 'p3', type: 'Text', tag: 'p', parentId: 'p1', children: [],
            name: 'Mô tả',
            effects: [{ id: 'fx1', effect: 'scroll-reveal', params: {} }],
            style: { base: { typography: { size: { $token: 'step-1' }, wrap: 'pretty' } } },
            content: [{ t: 'text', v: 'Một hoặc hai câu mô tả ngắn cho section này.' }],
          },
        },
      },
    },
    {
      key: 'cta-button', name: 'Nút CTA', category: 'content',
      aiDescription: 'Nút kêu gọi hành động chính, có hiệu ứng hút theo con trỏ.',
      tree: {
        rootId: 'p1',
        nodes: {
          p1: {
            id: 'p1', type: 'Button', parentId: null, children: [], name: 'CTA',
            variant: 'primary', action: { kind: 'none' },
            effects: [{ id: 'fx1', effect: 'magnetic', params: {} }],
            label: [{ t: 'text', v: 'Tải ứng dụng' }],
            style: { base: { spacing: { mt: { $token: 'space-s' } } } },
          },
        },
      },
    },
  ];

  for (const preset of handmade) {
    await prisma.preset.upsert({
      where: { key: preset.key },
      create: { ...preset, tree: preset.tree as unknown as object },
      update: { ...preset, tree: preset.tree as unknown as object },
    });
    console.log(`${preset.key.padEnd(10)} ${Object.keys(preset.tree.nodes).length} node (dựng tay)`);
  }

  console.log(`\nTổng: ${await prisma.preset.count()} preset`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
