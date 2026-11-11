import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fontFaceCss } from '@/lib/fonts/css';
import { EMPTY_FONT_SEAL } from '@/lib/fonts/types';

/**
 * `PublishedPage.fonts` — bản niêm phong font đọc từ `Release.fonts` (Review Focus 3).
 *
 * Release tạo TRƯỚC tính năng font có `fonts = null`; một hàng hỏng có thể mang JSON
 * rác. Cả hai phải cho trang render bình thường, chỉ không có `@font-face` nào — ném ở
 * đây là cả site thật trắng trang sau lần deploy.
 */

const release = { fonts: null as unknown };

const db = {
  releaseEntry: {
    findFirst: vi.fn(async () => ({
      pageId: 'p1',
      slug: '',
      version: {
        doc: {
          schemaVersion: 2,
          rootId: 'root',
          nodes: {
            root: {
              id: 'root', type: 'Section', parentId: null, children: [], effects: [],
              style: { base: {} },
            },
          },
        },
      },
      release: {
        translations: {}, components: {}, tokens: {}, globals: {}, assets: {},
        fonts: release.fonts,
      },
    })),
  },
  page: {
    findUnique: vi.fn(async () => ({
      title: 'Trang chủ', description: null, ogImageId: null, canonical: null,
      noindex: false, jsonLd: null, archivedAt: null, collection: null, system: null,
    })),
  },
};

vi.mock('next/cache', () => ({
  unstable_cache: (f: (...a: unknown[]) => unknown) => f,
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  get prisma() {
    return db;
  },
}));

import { getReleasePage } from './page';

const SEAL = {
  families: [
    {
      slug: 'gilroy',
      cssName: 'Gilroy',
      faces: [{ key: 'public/fonts/gilroy-700-1a2b3c4d.woff2', weight: '700', style: 'normal', unicodeRange: '' }],
    },
  ],
};

beforeEach(() => {
  release.fonts = null;
  db.releaseEntry.findFirst.mockClear();
});

describe('loadFromRelease — fonts', () => {
  it('select cột fonts của release', async () => {
    await getReleasePage('r1', '');
    const arg = (db.releaseEntry.findFirst.mock.calls[0] as unknown as [
      { select: { release: { select: Record<string, unknown> } } },
    ])[0];
    expect(arg.select.release.select).toHaveProperty('fonts', true);
  });

  it('release có bản niêm phong → page.fonts mang nguyên bản đó', async () => {
    release.fonts = SEAL;
    const page = await getReleasePage('r1', '');
    expect(page!.fonts).toEqual(SEAL);
  });

  it('release trước tính năng (fonts null) → EMPTY_FONT_SEAL', async () => {
    release.fonts = null;
    const page = await getReleasePage('r1', '');
    expect(page!.fonts).toEqual(EMPTY_FONT_SEAL);
  });

  it('fonts là JSON rác → rỗng, không ném', async () => {
    for (const junk of ['rác', 42, [1, 2], { families: 'x' }, { families: [{ slug: 1 }] }]) {
      release.fonts = junk;
      const page = await getReleasePage('r1', '');
      expect(page!.fonts).toEqual(EMPTY_FONT_SEAL);
    }
  });

  it('bản rỗng cho CSS rỗng → view không in thẻ data-mm-fonts', async () => {
    const page = await getReleasePage('r1', '');
    expect(fontFaceCss(page!.fonts)).toBe('');
    expect(fontFaceCss(EMPTY_FONT_SEAL)).toBe('');
  });
});
