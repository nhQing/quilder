import { describe, expect, it } from 'vitest';

import { createCollectionType } from './type-write';

/**
 * Chỉ test được nhánh chặn khoá dành riêng: nó trả về TRƯỚC lần gọi Prisma đầu
 * tiên (`prisma.collectionType.findUnique`), nên không cần DB thật. Mọi nhánh
 * khác của `createCollectionType`/`updateCollectionSchema`/`upsertFieldGroup`
 * đụng Prisma thật ngay từ đầu và không test được ở đây.
 */
describe('createCollectionType — khoá dành riêng cho đường dẫn', () => {
  it('từ chối khoá "types" — trùng segment tĩnh /builder/content/types/[key]', async () => {
    const r = await createCollectionType({
      key: 'types',
      name: 'Types',
      namePlural: 'Types',
      actorEmail: 'a@b.com',
      actorSub: 'sub',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain('types');
    }
  });

  it('từ chối khoá "taxonomies" — trùng segment tĩnh /builder/content/[typeKey]/taxonomies', async () => {
    const r = await createCollectionType({
      key: 'taxonomies',
      name: 'Taxonomies',
      namePlural: 'Taxonomies',
      actorEmail: 'a@b.com',
      actorSub: 'sub',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain('taxonomies');
    }
  });

  it('từ chối khoá "groups" — trùng segment tĩnh /builder/content/groups/[key] (màn cấu trúc nhóm field)', async () => {
    const r = await createCollectionType({
      key: 'groups',
      name: 'Groups',
      namePlural: 'Groups',
      actorEmail: 'a@b.com',
      actorSub: 'sub',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain('groups');
    }
  });

  it('từ chối khoá "views" — trùng /api/public/v1/views/[viewKey], đường gọi của app', async () => {
    const r = await createCollectionType({
      key: 'views',
      name: 'Views',
      namePlural: 'Views',
      actorEmail: 'a@b.com',
      actorSub: 'sub',
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('tên sinh khoá dành riêng qua toSlug cũng bị chặn, không chỉ chuỗi gõ đúng y', async () => {
    // "Types" -> toSlug -> "types". Phép chặn nằm SAU toSlug, đúng nơi client
    // không kiểm soát được — client gửi `name`, server tự suy `key`.
    const r = await createCollectionType({
      key: 'Types',
      name: 'Types',
      namePlural: 'Types',
      actorEmail: 'a@b.com',
      actorSub: 'sub',
    });
    expect(r.ok).toBe(false);
  });
});
