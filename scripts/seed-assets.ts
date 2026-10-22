/**
 * Nạp vài ảnh mẫu vào kho ảnh qua `/api/assets` — đúng đường tải lên thật (S3/MinIO, blurhash,
 * kích thước). Dùng cho máy dev mới và stack e2e: nhiều màn (kho ảnh, bộ chọn ảnh, favicon)
 * không thử được trên một kho trống.
 *
 * Ảnh lấy từ bộ nhận diện Quilder trong repo (`branding/quilder-logo/png`, `public/brand`).
 * Idempotent theo tên file: ảnh đã có thì bỏ qua.
 *
 *   E2E_BASE_URL=http://localhost:3003 pnpm exec tsx scripts/seed-assets.ts
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { apiForm } from './api-client';

const FILES = [
  ['branding/quilder-logo/png/quilder-symbol-512.png', 'image/png'],
  ['branding/quilder-logo/png/quilder-wordmark-1284.png', 'image/png'],
  ['branding/quilder-logo/png/quilder-app-icon-512.png', 'image/png'],
  ['public/brand/quilder-symbol.svg', 'image/svg+xml'],
] as const;

const prisma = new PrismaClient();

async function main() {
  const keys = (await prisma.asset.findMany({ select: { key: true } })).map((a) => a.key);
  let added = 0;
  for (const [path, mime] of FILES) {
    const name = basename(path);
    const stem = name.replace(/\.[^.]+$/, '');
    if (keys.some((k) => basename(k).startsWith(stem))) continue;
    const form = new FormData();
    form.set('file', new Blob([readFileSync(path)], { type: mime }), name);
    form.set('folder', 'mau');
    await apiForm('/api/assets', form);
    added++;
  }
  console.log(`kho ảnh: thêm ${added}, đã có ${FILES.length - added}`);
}

main().finally(() => prisma.$disconnect());
