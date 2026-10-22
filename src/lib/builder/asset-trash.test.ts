import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetRef, OldReleaseRef } from '@/lib/assets/trash-types';

/**
 * Thùng rác ảnh — phần logic, với Prisma, S3 và `assetReferences` giả.
 *
 * ## Vì sao Prisma giả phải LƯỜI
 *
 * Prisma thật trả `PrismaPromise`: gọi `prisma.asset.deleteMany(...)` chưa làm gì cả,
 * chỉ `$transaction([...])` (hoặc `await`) mới chạy nó. Bản giả mà chạy ngay lúc gọi
 * sẽ cho test "DB lỗi thì không gọi S3" xanh vì một lý do sai. Nên mỗi thao tác ghi
 * trả một `op` lười, và chỉ `$transaction` hoặc `await` mới ghi nó vào `events`.
 *
 * `events` là dòng thời gian chung của DB và S3 — test thứ tự đọc thẳng từ đó.
 */

type Args = Record<string, unknown>;

interface Row {
  id: string;
  key: string;
  url: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  folder: string | null;
  trashedAt: Date | null;
  trashedBy: string | null;
}

interface Op {
  name: string;
  args: Args;
  run: () => unknown;
  then: (res: (v: unknown) => void, rej: (e: unknown) => void) => void;
}

const events: string[] = [];
const ran: Array<{ name: string; args: Args }> = [];
let rows: Row[] = [];
let txBatches: string[][] = [];
let txFail = false;
let deleteCountOverride: number | null = null;
const recreatedKeys = new Set<string>();
const s3FailKeys = new Set<string>();
let refsById: Record<string, { blocking: AssetRef[]; oldReleases: OldReleaseRef[] } | undefined> =
  {};
let auditLogs: Array<{ meta: unknown }> = [];
let users: Array<{ email: string; name: string | null }> = [];
/** Release nằm trong cửa sổ rollback. Rỗng = mọi release cũ đều ngoài cửa sổ (hành vi trước E2). */
let windowIds = new Set<string>();
let holds: Array<{ key: string; releaseIds: string[] }> = [];

process.env.AUTH_SECRET = 'day-la-mot-auth-secret-du-dai-de-test-thung-rac';

function lazy(name: string, args: Args, result: () => unknown): Op {
  const run = () => {
    const label = name === 'auditLog.create' ? `${name}:${String((args.data as Args).action)}` : name;
    events.push(label);
    ran.push({ name: label, args });
    return result();
  };
  return {
    name,
    args,
    run,
    then(res, rej) {
      try {
        res(run());
      } catch (e) {
        rej(e);
      }
    },
  };
}

/** Lọc `rows` theo đúng các dạng `where` mà file nguồn dùng. */
function matchRows(where: Args | undefined): Row[] {
  let out = rows;
  const id = where?.id as { in?: string[] } | undefined;
  const key = where?.key as { in?: string[] } | undefined;
  const trashed = where?.trashedAt as { not?: null } | null | undefined;
  if (id?.in) out = out.filter((r) => id.in!.includes(r.id));
  if (key?.in) out = out.filter((r) => key.in!.includes(r.key));
  if (trashed && 'not' in trashed) out = out.filter((r) => r.trashedAt !== null);
  if (trashed === null) out = out.filter((r) => r.trashedAt === null);
  return out;
}

const findMany = vi.fn(async (a: Args) => matchRows(a.where as Args | undefined));
const findUnique = vi.fn(async (a: Args) => {
  const key = (a.where as { key: string }).key;
  events.push(`db:findUnique:${key}`);
  return recreatedKeys.has(key) ? { id: 'hang-moi' } : null;
});
const count = vi.fn(async (a: Args) => matchRows(a.where as Args | undefined).length);
const auditFindMany = vi.fn(async (_a: Args) => auditLogs);
const userFindMany = vi.fn(async (_a: Args) => users);
const holdFindMany = vi.fn(async (a: Args) => {
  const keys = ((a.where as Args | undefined)?.key as { in?: string[] } | undefined)?.in;
  return keys ? holds.filter((h) => keys.includes(h.key)) : holds;
});

vi.mock('@/lib/builder/rollback-window', () => ({
  loadRollbackWindow: async () => windowIds,
  ROLLBACK_WINDOW_TEXT: '30 release gần nhất và mọi release trong 90 ngày',
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    asset: {
      findMany: (a: Args) => findMany(a),
      findUnique: (a: Args) => findUnique(a),
      count: (a: Args) => count(a),
      updateMany: (a: Args) =>
        lazy('asset.updateMany', a, () => ({ count: matchRows(a.where as Args).length })),
      deleteMany: (a: Args) =>
        lazy('asset.deleteMany', a, () => ({
          count: deleteCountOverride ?? ((a.where as Args).id as { in: string[] }).in.length,
        })),
    },
    auditLog: {
      create: (a: Args) => lazy('auditLog.create', a, () => ({ id: 'log' })),
      findMany: (a: Args) => auditFindMany(a),
    },
    user: { findMany: (a: Args) => userFindMany(a) },
    assetHold: {
      upsert: (a: Args) => lazy('assetHold.upsert', a, () => ({ key: (a.where as { key: string }).key })),
      findMany: (a: Args) => holdFindMany(a),
      deleteMany: (a: Args) =>
        lazy('assetHold.deleteMany', a, () => {
          const keys = ((a.where as Args).key as { in: string[] }).in;
          holds = holds.filter((h) => !keys.includes(h.key));
          return { count: keys.length };
        }),
    },
    $transaction: async (ops: Op[]) => {
      if (txFail) throw new Error('Postgres sập');
      events.push('tx');
      txBatches.push(ops.map((o) => o.name));
      return ops.map((o) => o.run());
    },
  },
}));

const deleteObject = vi.fn(async (key: string) => {
  events.push(`s3:${key}`);
  if (s3FailKeys.has(key)) throw new Error('S3 503');
});
vi.mock('@/lib/assets/s3', () => ({ deleteObject: (k: string) => deleteObject(k) }));

const assetReferences = vi.fn(async (ids: readonly string[]) => {
  const m = new Map<string, { blocking: AssetRef[]; oldReleases: OldReleaseRef[] }>();
  for (const id of ids) {
    if (id in refsById) {
      const r = refsById[id];
      if (r) m.set(id, r);
    } else {
      m.set(id, { blocking: [], oldReleases: [] });
    }
  }
  return m;
});
vi.mock('@/lib/builder/asset-references', () => ({
  assetReferences: (ids: readonly string[]) => assetReferences(ids),
}));

const ensureFolderRows = vi.fn((paths: readonly (string | null)[], actorSub: string | null) =>
  lazy('assetFolder.createMany', { paths, actorSub }, () => ({ count: paths.length })),
);
vi.mock('@/lib/builder/asset-folders', () => ({
  ensureFolderRows: (p: readonly (string | null)[], s: string | null) => ensureFolderRows(p, s),
}));

import { issueConfirm } from '@/lib/confirm-token';

import {
  countTrashed,
  listTrashedAssets,
  MAX_PURGE_BATCH,
  previewPurge,
  PURGE_CONFIRM_ACTION,
  purgeAssets,
  PurgeConfirmError,
  restoreAssets,
  retryPurgeS3,
  sweepAssetHolds,
  trashAssets,
} from './asset-trash';

const actor = { email: 'admin@example.com', sub: 'u-admin' };

/** Token của lô đầu mà dialog sẽ gửi; không có lô nào thì token của danh sách rỗng. */
async function tokenFor(ids: string[]): Promise<string> {
  const p = await previewPurge({ ids });
  return p.batches[0]?.confirmToken ?? issueConfirm(PURGE_CONFIRM_ACTION, { ids: [], held: [], broken: [] });
}

/** Đúng luồng của dialog: xem trước, rồi xoá với token vừa nhận. */
async function purge(ids: string[]) {
  return purgeAssets(ids, actor, await tokenFor(ids));
}
const TRASHED_AT = new Date('2026-10-01T08:00:00.000Z');

function row(id: string, extra: Partial<Row> = {}): Row {
  return {
    id,
    key: `k/${id}.png`,
    url: `https://cdn/k/${id}.png`,
    mime: 'image/png',
    bytes: 1000,
    width: 10,
    height: 10,
    folder: null,
    trashedAt: null,
    trashedBy: null,
    ...extra,
  };
}

const inTrash = (id: string, extra: Partial<Row> = {}) =>
  row(id, { trashedAt: TRASHED_AT, trashedBy: 'editor@example.com', ...extra });

const release = (id: string, createdAt: string): OldReleaseRef => ({
  id,
  label: id,
  createdAt,
});

/** `data` của lượt `auditLog.create` có action này (đã thật sự chạy). */
function audit(action: string): { userId: string; targetType: string; meta: Args } {
  const hit = ran.find((r) => r.name === `auditLog.create:${action}`);
  if (!hit) throw new Error(`Không có audit ${action}`);
  return hit.args.data as { userId: string; targetType: string; meta: Args };
}

function ranArgs(name: string): Args {
  const hit = ran.find((r) => r.name === name);
  if (!hit) throw new Error(`Không chạy ${name}`);
  return hit.args;
}

beforeEach(() => {
  events.length = 0;
  ran.length = 0;
  rows = [];
  txBatches = [];
  txFail = false;
  deleteCountOverride = null;
  recreatedKeys.clear();
  s3FailKeys.clear();
  refsById = {};
  auditLogs = [];
  users = [];
  windowIds = new Set();
  holds = [];
  vi.clearAllMocks();
});

describe('purgeAssets — thứ tự DB trước S3', () => {
  it('xoá hàng + AuditLog trong MỘT transaction, rồi mới gọi S3', async () => {
    rows = [inTrash('a'), inTrash('b')];

    const res = await purge(['a', 'b']);

    expect(res).toEqual({ purged: ['a', 'b'], skipped: [], s3Failed: [], held: [] });
    expect(txBatches).toEqual([['asset.deleteMany', 'auditLog.create']]);

    const tx = events.indexOf('tx');
    const firstS3 = events.findIndex((e) => e.startsWith('s3:'));
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(firstS3).toBeGreaterThan(tx);
    expect(events.indexOf('auditLog.create:asset.purge')).toBeLessThan(firstS3);
    expect(deleteObject.mock.calls.map((c) => c[0]).sort()).toEqual(['k/a.png', 'k/b.png']);
  });

  it('DB lỗi → ném, KHÔNG gọi S3', async () => {
    rows = [inTrash('a')];
    txFail = true;

    await expect(purge(['a'])).rejects.toThrow('Postgres sập');
    expect(deleteObject).not.toHaveBeenCalled();
    expect(ran).toEqual([]);
  });

  it('deleteMany chỉ xoá hàng còn ở thùng rác', async () => {
    rows = [inTrash('a')];
    await purge(['a']);
    expect(ranArgs('asset.deleteMany').where).toEqual({
      id: { in: ['a'] },
      trashedAt: { not: null },
    });
  });

  it('AuditLog asset.purge ghi keys, url, bytes, folder, oldReleases', async () => {
    rows = [inTrash('a', { folder: 'trang-chu/hero', bytes: 2048 })];
    refsById = { a: { blocking: [], oldReleases: [release('r1', '2026-09-01T00:00:00.000Z')] } };

    await purge(['a']);

    const log = audit('asset.purge');
    expect(log.userId).toBe('u-admin');
    expect(log.targetType).toBe('Asset');
    expect(log.meta).toMatchObject({
      count: 1,
      keys: ['k/a.png'],
      bytes: 2048,
      items: [
        {
          id: 'a',
          key: 'k/a.png',
          url: 'https://cdn/k/a.png',
          bytes: 2048,
          folder: 'trang-chu/hero',
          oldReleases: ['r1'],
        },
      ],
      oldReleases: [{ id: 'r1', label: 'r1' }],
    });
  });
});

describe('purgeAssets — S3 lỗi', () => {
  it('ảnh vẫn tính là đã xoá, key vào s3Failed, có audit, KHÔNG ném', async () => {
    rows = [inTrash('a'), inTrash('b')];
    s3FailKeys.add('k/b.png');

    const res = await purge(['a', 'b']);

    expect(res.purged).toEqual(['a', 'b']);
    expect(res.s3Failed).toEqual(['k/b.png']);
    const log = audit('asset.purge.s3_failed');
    expect(log.meta).toMatchObject({ keys: ['k/b.png'], errors: { 'k/b.png': 'S3 503' } });
  });

  it('ghi audit s3_failed lỗi cũng KHÔNG ném', async () => {
    rows = [inTrash('a')];
    s3FailKeys.add('k/a.png');
    const { prisma } = await import('@/lib/db');
    const spy = vi.spyOn(prisma.auditLog, 'create');
    spy.mockImplementationOnce(((a: Args) => lazy('auditLog.create', a, () => ({}))) as never);
    spy.mockImplementationOnce((() => {
      throw new Error('ghi log hỏng');
    }) as never);

    const res = await purge(['a']);
    expect(res).toEqual({ purged: ['a'], skipped: [], s3Failed: ['k/a.png'], held: [] });
    spy.mockRestore();
  });

  it('kiểm lại key lỗi → không xoá mù, tính là s3Failed', async () => {
    rows = [inTrash('a')];
    findUnique.mockRejectedValueOnce(new Error('mất kết nối'));

    const res = await purge(['a']);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(res.s3Failed).toEqual(['k/a.png']);
  });
});

describe('purgeAssets — rào chắn', () => {
  it.each([
    ['entry', 'Bài viết: Hướng dẫn thẻ tín dụng'],
    ['favicon', 'Favicon của site'],
    ['live-release', 'Release đang chạy v38'],
  ] as const)('ảnh bị chặn bởi %s thì bỏ qua, không xoá DB lẫn S3', async (kind, label) => {
    rows = [inTrash('a')];
    refsById = { a: { blocking: [{ kind, label }], oldReleases: [] } };

    const res = await purge(['a']);

    expect(res.purged).toEqual([]);
    expect(res.skipped).toEqual([
      {
        id: 'a',
        key: 'k/a.png',
        url: 'https://cdn/k/a.png',
        mime: 'image/png',
        reason: 'in-use',
        refs: [{ kind, label }],
      },
    ]);
    expect(txBatches).toEqual([]);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('kiểm tham chiếu LẠI ngay lúc xoá: ảnh vừa thành đang dùng → 409, không xoá gì', async () => {
    rows = [inTrash('a'), inTrash('b')];
    const token = await tokenFor(['a', 'b']);
    // Trong lúc dialog mở, ảnh b được gắn vào một bài viết.
    refsById = { b: { blocking: [{ kind: 'entry', label: 'Bài mới' }], oldReleases: [] } };

    await expect(purgeAssets(['a', 'b'], actor, token)).rejects.toMatchObject({
      name: 'PurgeConfirmError',
      reason: 'changed',
    });
    expect(assetReferences).toHaveBeenCalledTimes(2);
    expect(txBatches).toEqual([]);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('ảnh chưa ở thùng rác bị từ chối (not-trashed), id không có → missing', async () => {
    rows = [row('song'), inTrash('rac')];

    const res = await purge(['song', 'rac', 'ma']);

    expect(res.purged).toEqual(['rac']);
    expect(res.skipped.map((s) => [s.id, s.reason])).toEqual([
      ['song', 'not-trashed'],
      ['ma', 'missing'],
    ]);
    expect(ranArgs('asset.deleteMany').where).toMatchObject({ id: { in: ['rac'] } });
    // Ảnh đang sống không bị đem đi kiểm như ứng viên xoá.
    expect(assetReferences).toHaveBeenCalledWith(['rac']);
  });

  it('kết quả kiểm thiếu id → coi như đang dùng (nghiêng về giữ lại)', async () => {
    rows = [inTrash('a')];
    refsById = { a: undefined };

    const res = await purge(['a']);
    expect(res.purged).toEqual([]);
    expect(res.skipped[0]).toMatchObject({ id: 'a', reason: 'in-use', refs: [] });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it(`quá ${MAX_PURGE_BATCH} id → ném trước khi đụng DB`, async () => {
    const ids = Array.from({ length: MAX_PURGE_BATCH + 1 }, (_, i) => `id${i}`);
    await expect(purgeAssets(ids, actor, 'x')).rejects.toThrow(String(MAX_PURGE_BATCH));
    expect(findMany).not.toHaveBeenCalled();
  });

  it('đúng 100 id trùng nhau thì đếm theo id duy nhất', async () => {
    rows = [inTrash('a')];
    const ids = Array.from({ length: MAX_PURGE_BATCH + 50 }, () => 'a');
    const res = await purge(ids);
    expect(res.purged).toEqual(['a']);
  });

  it('key vừa được tải lại (có hàng mới cùng key) → KHÔNG xoá object S3', async () => {
    rows = [inTrash('a'), inTrash('b')];
    recreatedKeys.add('k/a.png');

    const res = await purge(['a', 'b']);

    expect(res).toEqual({ purged: ['a', 'b'], skipped: [], s3Failed: [], held: [] });
    expect(deleteObject.mock.calls.map((c) => c[0])).toEqual(['k/b.png']);
    // Phép kiểm lại diễn ra SAU transaction và TRƯỚC lần xoá S3 của chính key đó.
    expect(events.indexOf('db:findUnique:k/a.png')).toBeGreaterThan(events.indexOf('tx'));
    expect(events.indexOf('db:findUnique:k/b.png')).toBeLessThan(events.indexOf('s3:k/b.png'));
  });

  it('ảnh được khôi phục giữa lúc kiểm và lúc xoá → không báo là đã xoá', async () => {
    rows = [inTrash('a'), inTrash('b')];
    const token = await tokenFor(['a', 'b']);
    deleteCountOverride = 1;
    // Sau transaction, b vẫn còn hàng (đã được khôi phục, nên deleteMany bỏ qua nó).
    findMany.mockImplementationOnce(async (a: Args) => matchRows(a.where as Args));
    findMany.mockImplementationOnce(async () => [row('b')]);

    const res = await purgeAssets(['a', 'b'], actor, token);

    expect(res.purged).toEqual(['a']);
    expect(res.skipped.map((s) => [s.id, s.reason])).toEqual([['b', 'not-trashed']]);
    expect(deleteObject.mock.calls.map((c) => c[0])).toEqual(['k/a.png']);
  });

  it('không có ảnh nào xoá được → không mở transaction', async () => {
    rows = [row('song')];
    const res = await purge(['song']);
    expect(res.purged).toEqual([]);
    expect(txBatches).toEqual([]);
  });
});

describe('trashAssets', () => {
  it('cập nhật cờ + AuditLog asset.trash trong CÙNG transaction', async () => {
    rows = [row('a'), row('b')];

    const res = await trashAssets(['a', 'b'], actor);

    expect(res).toEqual({ trashed: ['a', 'b'], skipped: [] });
    expect(txBatches).toEqual([['asset.updateMany', 'auditLog.create']]);
    const upd = ranArgs('asset.updateMany') as { where: Args; data: Args };
    expect(upd.where).toEqual({ id: { in: ['a', 'b'] }, trashedAt: null });
    expect(upd.data.trashedBy).toBe('admin@example.com');
    expect(upd.data.trashedAt).toBeInstanceOf(Date);
    const log = audit('asset.trash');
    expect(log.userId).toBe('u-admin');
    expect(log.meta).toEqual({ ids: ['a', 'b'], count: 2 });
  });

  it('bỏ qua ảnh đang dùng (kèm nơi dùng) và id không tồn tại', async () => {
    rows = [row('a'), row('dung')];
    const refs: AssetRef[] = [{ kind: 'site-og', label: 'Ảnh chia sẻ của site' }];
    refsById = { dung: { blocking: refs, oldReleases: [] } };

    const res = await trashAssets(['a', 'dung', 'ma'], actor);

    expect(res.trashed).toEqual(['a']);
    expect(res.skipped.map((s) => [s.id, s.reason, s.refs])).toEqual([
      ['dung', 'in-use', refs],
      ['ma', 'missing', []],
    ]);
    expect(audit('asset.trash').meta).toEqual({ ids: ['a'], count: 1 });
  });

  it('ảnh đã ở thùng rác tính là xong, không ghi lại cờ', async () => {
    rows = [inTrash('cu'), row('moi')];

    const res = await trashAssets(['cu', 'moi'], actor);

    expect(res).toEqual({ trashed: ['cu', 'moi'], skipped: [] });
    expect((ranArgs('asset.updateMany').where as Args).id).toEqual({ in: ['moi'] });
    expect(assetReferences).toHaveBeenCalledWith(['moi']);
  });

  it('chỉ có ảnh đã ở thùng rác → không mở transaction, không lỗi', async () => {
    rows = [inTrash('cu')];
    const res = await trashAssets(['cu'], actor);
    expect(res).toEqual({ trashed: ['cu'], skipped: [] });
    expect(txBatches).toEqual([]);
  });

  it('actor không có sub → AuditLog.userId là email', async () => {
    rows = [row('a')];
    await trashAssets(['a'], { email: 'x@example.com' });
    expect(audit('asset.trash').userId).toBe('x@example.com');
  });
});

describe('restoreAssets', () => {
  it('xoá cờ, GIỮ thư mục, đảm bảo registry + AuditLog trong CÙNG transaction', async () => {
    rows = [inTrash('a', { folder: 'trang-chu/hero' }), inTrash('b'), row('song')];

    const res = await restoreAssets(['a', 'b', 'song', 'ma'], actor);

    expect(res.restored).toEqual(['a', 'b']);
    expect(res.skipped.map((s) => [s.id, s.reason])).toEqual([
      ['song', 'not-trashed'],
      ['ma', 'missing'],
    ]);
    expect(txBatches).toEqual([['assetFolder.createMany', 'asset.updateMany', 'auditLog.create']]);
    expect(ensureFolderRows).toHaveBeenCalledWith(['trang-chu/hero'], 'u-admin');
    const upd = ranArgs('asset.updateMany') as { where: Args; data: Args };
    expect(upd.where).toEqual({ id: { in: ['a', 'b'] }, trashedAt: { not: null } });
    expect(upd.data).toEqual({ trashedAt: null, trashedBy: null });
    expect('folder' in upd.data).toBe(false);
    expect(audit('asset.restore').meta).toMatchObject({ ids: ['a', 'b'], count: 2 });
  });

  it('không có ảnh nào ở thùng rác → không ghi gì', async () => {
    rows = [row('song')];
    const res = await restoreAssets(['song'], actor);
    expect(res.restored).toEqual([]);
    expect(txBatches).toEqual([]);
  });
});

describe('previewPurge', () => {
  it('chạy thử: không transaction, không S3, không audit', async () => {
    rows = [inTrash('a'), inTrash('dung'), row('song')];
    refsById = {
      a: { blocking: [], oldReleases: [release('r1', '2026-09-01T00:00:00.000Z')] },
      dung: { blocking: [{ kind: 'page', label: '/gioi-thieu' }], oldReleases: [] },
    };

    const p = await previewPurge({ ids: ['a', 'dung', 'song', 'ma'] });

    expect(p.deletable).toEqual([
      {
        id: 'a',
        key: 'k/a.png',
        url: 'https://cdn/k/a.png',
        mime: 'image/png',
        bytes: 1000,
        oldReleases: [{ ...release('r1', '2026-09-01T00:00:00.000Z'), inWindow: false }],
      },
    ]);
    expect(p.blocked.map((s) => [s.id, s.reason])).toEqual([
      ['dung', 'in-use'],
      ['song', 'not-trashed'],
      ['ma', 'missing'],
    ]);
    expect(ran).toEqual([]);
    expect(txBatches).toEqual([]);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('all: mọi ảnh trong thùng rác, hợp release cũ không trùng, mới nhất trước', async () => {
    rows = [inTrash('a'), inTrash('b'), row('song')];
    const r1 = release('r1', '2026-08-01T00:00:00.000Z');
    const r2 = release('r2', '2026-09-01T00:00:00.000Z');
    refsById = {
      a: { blocking: [], oldReleases: [r1, r2] },
      b: { blocking: [], oldReleases: [r1] },
    };

    const p = await previewPurge({ all: true });

    expect(findMany.mock.calls[0]![0].where).toEqual({ trashedAt: { not: null } });
    expect(p.deletable.map((d) => d.id)).toEqual(['a', 'b']);
    expect(p.oldReleases).toEqual([
      { ...r2, inWindow: false },
      { ...r1, inWindow: false },
    ]);
    expect(ran).toEqual([]);
  });
});

describe('retryPurgeS3', () => {
  it('chỉ xoá key mồ côi CÓ trong audit asset.purge', async () => {
    rows = [row('song', { key: 'k/con-hang.png' })];
    auditLogs = [{ meta: { keys: ['k/mo-coi.png', 'k/con-hang.png', 'k/s3-loi.png'] } }];
    s3FailKeys.add('k/s3-loi.png');

    const res = await retryPurgeS3(
      ['k/mo-coi.png', 'k/con-hang.png', 'k/khong-co-trong-so.png', 'k/s3-loi.png'],
      actor,
    );

    expect(res).toEqual({
      deleted: ['k/mo-coi.png'],
      skipped: ['k/con-hang.png', 'k/khong-co-trong-so.png'],
      failed: ['k/s3-loi.png'],
    });
    expect(deleteObject.mock.calls.map((c) => c[0]).sort()).toEqual([
      'k/mo-coi.png',
      'k/s3-loi.png',
    ]);
    const where = auditFindMany.mock.calls[0]![0].where as Args;
    expect(where.action).toBe('asset.purge');
    expect(audit('asset.purge.s3_retry').meta).toMatchObject({ deleted: ['k/mo-coi.png'] });
  });

  it('key vừa có hàng mới giữa chừng → bỏ qua, không xoá', async () => {
    auditLogs = [{ meta: { keys: ['k/a.png'] } }];
    recreatedKeys.add('k/a.png');

    const res = await retryPurgeS3(['k/a.png'], actor);
    expect(res).toEqual({ deleted: [], skipped: ['k/a.png'], failed: [] });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('meta audit lạ không làm key lọt qua', async () => {
    auditLogs = [{ meta: { keys: 'k/a.png' } }, { meta: null }, { meta: ['k/a.png'] }];
    const res = await retryPurgeS3(['k/a.png'], actor);
    expect(res.skipped).toEqual(['k/a.png']);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe('listTrashedAssets / countTrashed', () => {
  it('lọc thùng rác, xoá mới nhất trước, tên người xoá join theo email', async () => {
    rows = [
      inTrash('a', { trashedBy: 'thu@example.com' }),
      inTrash('b', { trashedBy: 'mat-tich@example.com' }),
      inTrash('c', { trashedBy: null }),
    ];
    users = [{ email: 'thu@example.com', name: 'Nguyễn Thị Phương Anh Thư' }];

    const p = await listTrashedAssets({ q: ' logo ', page: 2, pageSize: 24 });

    const args = findMany.mock.calls[0]![0] as Args;
    expect(args.where).toEqual({
      trashedAt: { not: null },
      key: { contains: 'logo', mode: 'insensitive' },
    });
    expect(args.orderBy).toEqual([{ trashedAt: 'desc' }, { id: 'desc' }]);
    expect(args.skip).toBe(24);
    expect(args.take).toBe(24);
    expect(userFindMany.mock.calls[0]![0].where).toEqual({
      email: { in: ['thu@example.com', 'mat-tich@example.com'] },
    });
    expect(p.items.map((i) => [i.id, i.trashedBy, i.trashedByName])).toEqual([
      ['a', 'thu@example.com', 'Nguyễn Thị Phương Anh Thư'],
      ['b', 'mat-tich@example.com', null],
      ['c', null, null],
    ]);
    expect(p.items[0]!.trashedAt).toBe(TRASHED_AT.toISOString());
    expect(p).toMatchObject({ total: 3, page: 2, pageSize: 24 });
  });

  it('countTrashed đếm ảnh có trashedAt', async () => {
    rows = [inTrash('a'), row('b')];
    expect(await countTrashed()).toBe(1);
    expect(count.mock.calls[0]![0].where).toEqual({ trashedAt: { not: null } });
  });
});

describe('token xác nhận (C3)', () => {
  it.each([
    ['không có token', undefined, 'missing'],
    ['token rác', 'abc', 'malformed'],
  ] as const)('%s → PurgeConfirmError, không ghi gì', async (_label, token, reason) => {
    rows = [inTrash('a')];
    await expect(purgeAssets(['a'], actor, token)).rejects.toMatchObject({ reason });
    expect(txBatches).toEqual([]);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('token hết hạn → expired', async () => {
    rows = [inTrash('a')];
    const old = issueConfirm(PURGE_CONFIRM_ACTION, { ids: ['a'], held: [], broken: [] }, Date.now() - 6 * 60_000);
    await expect(purgeAssets(['a'], actor, old)).rejects.toMatchObject({ reason: 'expired' });
    expect(txBatches).toEqual([]);
  });

  it('token của tập id khác → changed', async () => {
    rows = [inTrash('a'), inTrash('b')];
    const forA = await tokenFor(['a']);
    await expect(purgeAssets(['a', 'b'], actor, forA)).rejects.toBeInstanceOf(PurgeConfirmError);
    expect(txBatches).toEqual([]);
  });

  it('publish một release dùng ảnh giữa lúc xem trước và lúc xoá → 409', async () => {
    rows = [inTrash('a')];
    const token = await tokenFor(['a']);
    refsById = { a: { blocking: [{ kind: 'live-release', label: 'Release đang chạy v121' }], oldReleases: [] } };

    await expect(purgeAssets(['a'], actor, token)).rejects.toMatchObject({ reason: 'changed' });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('cửa sổ rollback trôi giữa hai bước (release giữ ảnh thành release sẽ vỡ) → 409', async () => {
    rows = [inTrash('a')];
    refsById = { a: { blocking: [], oldReleases: [release('r1', '2026-09-01T00:00:00.000Z')] } };
    windowIds = new Set(['r1']);
    const token = await tokenFor(['a']);
    windowIds = new Set();

    await expect(purgeAssets(['a'], actor, token)).rejects.toMatchObject({ reason: 'changed' });
  });

  it('dọn sạch: chia lô theo trần server, mỗi lô một token khớp đúng lô đó', async () => {
    rows = Array.from({ length: 250 }, (_, i) => inTrash(`id${String(i).padStart(3, '0')}`));
    const p = await previewPurge({ all: true });

    expect(p.batches.map((b) => b.ids.length)).toEqual([100, 100, 50]);
    expect(p.batches.flatMap((b) => b.ids)).toEqual(p.deletable.map((d) => d.id));

    const [first, second] = p.batches;
    // Token của lô 1 không mở được lô 2.
    await expect(purgeAssets(second!.ids, actor, first!.confirmToken)).rejects.toBeInstanceOf(PurgeConfirmError);
    const res = await purgeAssets(first!.ids, actor, first!.confirmToken);
    expect(res.purged).toHaveLength(100);
  });
});

describe('giữ object cho release trong cửa sổ rollback (E2)', () => {
  const r1 = release('r1', '2026-09-20T00:00:00.000Z');
  const r0 = release('r0', '2026-05-01T00:00:00.000Z');

  it('release trong cửa sổ dùng ảnh → xoá hàng, GIỮ object, AssetHold cùng transaction', async () => {
    rows = [inTrash('a'), inTrash('b')];
    refsById = { a: { blocking: [], oldReleases: [r1] }, b: { blocking: [], oldReleases: [] } };
    windowIds = new Set(['r1']);

    const res = await purge(['a', 'b']);

    expect(res).toEqual({ purged: ['a', 'b'], skipped: [], s3Failed: [], held: ['k/a.png'] });
    expect(txBatches).toEqual([['asset.deleteMany', 'auditLog.create', 'assetHold.upsert']]);
    expect(deleteObject.mock.calls.map((c) => c[0])).toEqual(['k/b.png']);

    const upsert = ranArgs('assetHold.upsert') as { create: Args };
    expect(upsert.create).toMatchObject({ key: 'k/a.png', releaseIds: ['r1'], purgedBy: 'admin@example.com' });

    // "Thử xoá lại" lọc theo `keys`: khoá đang giữ không được nằm ở đó.
    const log = audit('asset.purge');
    expect(log.meta).toMatchObject({ keys: ['k/b.png'], held: ['k/a.png'] });
  });

  it('chỉ release ngoài cửa sổ dùng ảnh → xoá object như cũ, không giữ', async () => {
    rows = [inTrash('a')];
    refsById = { a: { blocking: [], oldReleases: [r0] } };
    windowIds = new Set(['r1']);

    const res = await purge(['a']);

    expect(res.held).toEqual([]);
    expect(deleteObject.mock.calls.map((c) => c[0])).toEqual(['k/a.png']);
    expect(txBatches).toEqual([['asset.deleteMany', 'auditLog.create']]);
  });

  it('xem trước tách release giữ ảnh và release sẽ vỡ', async () => {
    rows = [inTrash('a')];
    refsById = { a: { blocking: [], oldReleases: [r1, r0] } };
    windowIds = new Set(['r1']);

    const p = await previewPurge({ ids: ['a'] });

    expect(p.oldReleases).toEqual([
      { ...r1, inWindow: true },
      { ...r0, inWindow: false },
    ]);
    expect(p.rollbackWindow).toContain('30 release');
  });

  it('retryPurgeS3 không bao giờ xoá khoá đang giữ', async () => {
    auditLogs = [{ meta: { keys: ['k/giu.png'] } }];
    holds = [{ key: 'k/giu.png', releaseIds: ['r1'] }];

    const res = await retryPurgeS3(['k/giu.png'], actor);

    expect(res).toEqual({ deleted: [], skipped: ['k/giu.png'], failed: [] });
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe('sweepAssetHolds', () => {
  it('xoá object khi mọi release giữ nó đã ra khỏi cửa sổ; release còn trong cửa sổ thì để nguyên', async () => {
    holds = [
      { key: 'k/het-han.png', releaseIds: ['r0'] },
      { key: 'k/con-giu.png', releaseIds: ['r0', 'r1'] },
    ];
    windowIds = new Set(['r1']);

    const res = await sweepAssetHolds();

    expect(res).toEqual({ deleted: ['k/het-han.png'], released: [], failed: [], kept: 1 });
    expect(deleteObject.mock.calls.map((c) => c[0])).toEqual(['k/het-han.png']);
    expect(holds.map((h) => h.key)).toEqual(['k/con-giu.png']);
    expect(audit('asset.hold.sweep').userId).toBe('system');
  });

  it('khoá vừa được tải lại (có hàng Asset) → chỉ gỡ hàng giữ, KHÔNG xoá object', async () => {
    holds = [{ key: 'k/tai-lai.png', releaseIds: ['r0'] }];
    recreatedKeys.add('k/tai-lai.png');

    const res = await sweepAssetHolds();

    expect(res.released).toEqual(['k/tai-lai.png']);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(holds).toEqual([]);
  });

  it('S3 lỗi → giữ hàng để lượt sau thử lại', async () => {
    holds = [{ key: 'k/loi.png', releaseIds: ['r0'] }];
    s3FailKeys.add('k/loi.png');

    const res = await sweepAssetHolds();

    expect(res).toEqual({ deleted: [], released: [], failed: ['k/loi.png'], kept: 1 });
    expect(holds).toHaveLength(1);
  });

  it('không có hàng giữ → không đọc cửa sổ, không ghi gì', async () => {
    const res = await sweepAssetHolds();
    expect(res).toEqual({ deleted: [], released: [], failed: [], kept: 0 });
    expect(ran).toEqual([]);
  });
});
