import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { importDesignTokens } from './design-tokens';

/*
 * 22/10/2026 — deploy v1.2.0 lên server: stage `bootstrap` không chép `projects/`, nên
 * `import-tokens` không thấy `styles/tokens.css` của gói và đánh dấu deprecated mọi token
 * của gói. Sửa Dockerfile rồi chạy lại cũng KHÔNG cứu được, vì nhánh update của upsert
 * không đặt lại `deprecated: false` — token đã deprecated thì kẹt mãi.
 */

function fakePrisma() {
  const upserts: { where: { name: string }; update: Record<string, unknown> }[] = [];
  const updateMany = vi.fn(async () => ({ count: 0 }));
  const prisma = {
    token: {
      findUnique: vi.fn(async () => ({ baseValue: null })),
      upsert: vi.fn(async (args: (typeof upserts)[number]) => {
        upserts.push(args);
        return {};
      }),
      updateMany,
    },
  } as unknown as PrismaClient;
  return { prisma, upserts, updateMany };
}

describe('importDesignTokens', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('token có trong CSS thì hết deprecated — kể cả hàng đã bị đánh dấu từ lần trước', async () => {
    vi.stubEnv('QUILDER_PROJECT', '');
    const { prisma, upserts } = fakePrisma();
    await importDesignTokens(prisma);
    const space = upserts.find((u) => u.where.name === 'space-m');
    expect(space?.update).toMatchObject({ deprecated: false });
  });

  it('QUILDER_PROJECT đặt mà thiếu thư mục gói thì DỪNG, không đánh dấu deprecated hàng loạt', async () => {
    vi.stubEnv('QUILDER_PROJECT', 'goi-khong-ton-tai');
    const { prisma, updateMany } = fakePrisma();
    await expect(importDesignTokens(prisma)).rejects.toThrow(/goi-khong-ton-tai/);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
