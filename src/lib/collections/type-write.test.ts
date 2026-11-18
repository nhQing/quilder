import { describe, expect, it } from 'vitest';

import { createCollectionType, mentionsGroup } from './type-write';

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

describe('mentionsGroup — nhóm field còn được trỏ tới không (chặn xoá nhóm đang dùng)', () => {
  it('thấy field group trỏ trực tiếp', () => {
    expect(mentionsGroup([{ t: 'group', key: 'a', groupKey: 'file-dinh-kem' }], 'file-dinh-kem')).toBe(true);
  });
  it('thấy field blocks cho phép nhóm đó', () => {
    expect(mentionsGroup([{ t: 'blocks', key: 'b', allowed: ['x', 'y'] }], 'y')).toBe(true);
  });
  it('thấy tham chiếu lồng sâu trong schema', () => {
    const schema = [{ t: 'group', key: 'g', groupKey: 'outer', fields: [{ t: 'group', key: 'h', groupKey: 'inner' }] }];
    expect(mentionsGroup(schema, 'inner')).toBe(true);
  });
  it('không báo khi không ai trỏ tới, hoặc schema rỗng/hỏng', () => {
    expect(mentionsGroup([{ t: 'group', key: 'a', groupKey: 'khac' }], 'file-dinh-kem')).toBe(false);
    expect(mentionsGroup([], 'x')).toBe(false);
    expect(mentionsGroup(null, 'x')).toBe(false);
    expect(mentionsGroup('rac', 'x')).toBe(false);
  });
});
