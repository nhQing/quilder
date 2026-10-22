/**
 * Tạo trang thứ hai `/gioi-thieu` và thêm link qua lại giữa hai trang.
 *
 * Lý do tồn tại: test rò rỉ của rủi ro R2 chỉ có nghĩa khi có ĐIỀU HƯỚNG PHÍA
 * CLIENT thật. Reload cả trang thì mọi trạng thái cấp module reset sạch, nên
 * không chứng minh được gì về rò rỉ. Cần hai trang và một next/link giữa chúng.
 *
 * Chạy: pnpm exec tsx scripts/seed-second-page.ts
 */

import { PrismaClient } from '@prisma/client';

import type { Doc } from '../src/lib/doc/types';
import { api } from './api-client';

const prisma = new PrismaClient();
const t = (name: string) => ({ $token: name });

const aboutDoc: Doc = {
  schemaVersion: 1,
  rootId: 'ab000001',
  nodes: {
    ab000001: {
      id: 'ab000001', type: 'Section', tag: 'main',
      parentId: null, children: ['ab000002', 'ab000003', 'ab000004'],
      name: 'Giới thiệu', effects: [],
      style: {
        base: {
          layout: { display: 'flex', align: 'center', gap: t('space-m') },
          spacing: { pt: t('space-3xl'), pb: t('space-3xl'), pl: t('gutter'), pr: t('gutter') },
          size: { minHeight: { v: 100, u: 'svh' } },
          typography: { align: 'center' },
        },
      },
    },
    ab000002: {
      id: 'ab000002', type: 'Text', tag: 'h1',
      parentId: 'ab000001', children: [], name: 'Tiêu đề',
      // Gắn reveal để trang này cũng có effect thật, không phải trang trống.
      effects: [{ id: 'fx1', effect: 'scroll-reveal', params: { stagger: 0.1 } }],
      style: {
        base: {
          typography: { family: t('font-display'), size: t('step-4'), weight: 700, wrap: 'balance' },
          size: { maxWidth: 'measure' },
        },
      },
      content: [{ t: 'text', v: 'Về chúng tôi' }],
    },
    ab000003: {
      id: 'ab000003', type: 'Text', tag: 'p',
      parentId: 'ab000001', children: [], name: 'Lede',
      effects: [{ id: 'fx2', effect: 'scroll-reveal', params: {} }],
      style: { base: { typography: { size: t('step-1') }, size: { maxWidth: 'measure' } } },
      content: [{ t: 'text', v: 'Trang thứ hai, tồn tại để kiểm chứng điều hướng phía client.' }],
    },
    ab000004: {
      id: 'ab000004', type: 'Button',
      parentId: 'ab000001', children: [], name: 'Về trang chủ',
      variant: 'primary',
      action: { kind: 'link', href: '/' },
      effects: [],
      label: [{ t: 'text', v: 'Về trang chủ' }],
      style: { base: { spacing: { mt: t('space-s') } } },
    },
  },
};

async function main() {
  await prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirstOrThrow();
    const home = await tx.page.findFirstOrThrow({ where: { siteId: site.id, slug: '' } });

    const about = await tx.page.upsert({
      where: { siteId_slug: { siteId: site.id, slug: 'gioi-thieu' } },
      create: {
        // `fixture` ở cả create lẫn update: chạy lại script này là cách dựng lại đồ
        // gá sau khi có ai đó dựng nội dung thật lên đây, nên nó phải khôi phục luôn
        // cờ — không thì lần dọn thứ hai lại mở cửa cho lần bẩn thứ ba.
        fixture: true,
        siteId: site.id, slug: 'gioi-thieu',
        title: 'Về chúng tôi',
        description: 'Trang giới thiệu.',
      },
      update: { fixture: true },
    });

    const aboutVersion = await tx.pageVersion.create({
      data: {
        pageId: about.id, doc: aboutDoc as unknown as object,
        schemaVer: 1, label: 'seed-second-page', createdBy: 'script',
      },
    });
    await tx.page.update({ where: { id: about.id }, data: { draftVersionId: aboutVersion.id } });

    // Thêm nút dẫn sang trang mới vào doc trang chủ, để điều hướng đi được cả hai chiều.
    const homeEntry = await tx.releaseEntry.findFirstOrThrow({
      where: { releaseId: site.activeReleaseId!, pageId: home.id },
      include: { version: true },
    });
    const homeDoc = JSON.parse(JSON.stringify(homeEntry.version.doc)) as Doc;
    const rootId = homeDoc.rootId;
    const root = homeDoc.nodes[rootId]!;

    // Idempotent: chạy lại script không được append thêm cùng một id.
    // Bản trước append vô điều kiện, và sau ba lần chạy trang chủ có ba node
    // cùng data-n="navlink1" — renderer vẽ ba lần, click-to-select nhắm nhầm,
    // và Playwright báo "strict mode violation". Validator giờ cũng chặn.
    root.children = root.children.filter((c) => c !== 'navlink1');

    homeDoc.nodes.navlink1 = {
      id: 'navlink1', type: 'Button',
      parentId: rootId, children: [], name: 'Tới giới thiệu',
      variant: 'ghost',
      action: { kind: 'link', href: '/gioi-thieu' },
      effects: [],
      label: [{ t: 'text', v: 'Tới trang giới thiệu' }],
      style: { base: { spacing: { mt: t('space-s') } } },
    };
    root.children = [...root.children, 'navlink1'];

    const homeVersion = await tx.pageVersion.create({
      data: {
        pageId: home.id, doc: homeDoc as unknown as object,
        schemaVer: 1, label: 'thêm link điều hướng', createdBy: 'script',
        parentId: homeEntry.versionId,
      },
    });
    await tx.page.update({ where: { id: home.id }, data: { draftVersionId: homeVersion.id } });

    console.log(`nháp đã dựng: / và /gioi-thieu`);
  });

  /**
   * Publish qua API chứ KHÔNG tự ghi Release ở đây.
   *
   * Bản trước tự tạo Release rồi đổi `activeReleaseId` trong cùng transaction.
   * Nó "chạy" nhưng trang public vẫn phục vụ bản cũ tới 3600s, vì `revalidateTag`
   * chỉ gọi được từ trong Next — script chạy ở tiến trình riêng thì không.
   *
   * Đây đúng là lỗ hổng mà /api/publish sinh ra để bịt, nên script phải đi qua
   * nó thay vì đi vòng. Mọi đường publish chỉ nên có MỘT.
   */
  try {
    const json = await api<{ pageCount: number; ms: number }>('/api/publish', {
      action: 'publish',
      label: 'Hai trang + link',
    });
    console.log(`đã publish ${json.pageCount} trang trong ${json.ms}ms`);
  } catch (e) {
    console.log(`publish không chạy: ${e instanceof Error ? e.message : e}`);
    console.log('Bản nháp đã dựng; bật dev server rồi bấm Publish trong builder.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
