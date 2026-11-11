import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { categorize, importDesignTokens, planTokenUpdates } from './design-tokens';

describe('categorize', () => {
  it('font stack → hạng font', () => {
    expect(categorize('font-body', '"Inter Variable", system-ui').category).toBe('font');
    expect(categorize('lv-font-head', 'gilroy, Arial, sans-serif').category).toBe('font');
  });

  it('giá trị không phải font stack → giữ luật cũ', () => {
    expect(categorize('font-size-l', '1.25rem').category).toBe('typography');
    expect(categorize('font-x', 'var(--font-body)').category).toBe('typography');
    expect(categorize('font-size-fluid', 'clamp(1rem,2vw,2rem)').category).toBe('typography');
    expect(categorize('font-weight-bold', 'bold').category).toBe('typography');
    expect(categorize('weight-bold', '700').category).toBe('typography');
    expect(categorize('color-ink', '#000').category).toBe('color');
  });

  it('không có giá trị thì dựa vào tên', () => {
    expect(categorize('font-body').category).toBe('font');
    expect(categorize('font-size-l').category).toBe('typography');
    expect(categorize('font-weight-bold').category).toBe('typography');
    expect(categorize('font-leading-tight').category).toBe('typography');
  });
});

describe('planTokenUpdates', () => {
  it('hàng font-body cũ hạng typography → update category font, kể cả khi giá trị không đổi', () => {
    const plans = planTokenUpdates(
      new Map([['font-body', { baseValue: null }]]),
      new Map([['font-body', { value: '"Inter Variable", system-ui', comment: null }]]),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]?.update).toMatchObject({ category: 'font' });
    expect(plans[0]?.kind).toBe('updated');
  });

  it('hàng đã sửa trong builder: giữ value nhưng vẫn đổi category', () => {
    const [plan] = planTokenUpdates(
      new Map([['font-body', { baseValue: 'x' }]]),
      new Map([['font-body', { value: 'Georgia, serif', comment: null }]]),
    );
    expect(plan?.kind).toBe('kept');
    expect(plan?.update).toMatchObject({ category: 'font', baseValue: 'Georgia, serif' });
    expect(plan?.update).not.toHaveProperty('value');
  });
});

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
