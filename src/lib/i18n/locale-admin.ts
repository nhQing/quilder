import 'server-only';

/**
 * Thêm, bật/tắt, xoá ngôn ngữ — ba thao tác của ô "Ngôn ngữ" ở màn Cài đặt.
 * Xem docs/superpowers/specs/2026-10-21-them-ngon-ngu-design.md.
 *
 * Danh sách ngôn ngữ KHÔNG niêm phong theo release: đổi ở đây có hiệu lực ngay (tag
 * `locales`). Bản dịch thì có — nó lên site ở lần Publish kế tiếp.
 */

import type { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';

import { prisma } from '@/lib/db';
import { checkLocaleCode, checkLocaleLabel, slugsBlockingLocale } from './locale-rules';
import { LOCALES_TAG } from './queries';

export type LocaleResult = { ok: true } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): LocaleResult => ({ ok: false, status, error });

async function audit(userId: string, action: string, code: string, meta: Prisma.InputJsonObject = {}) {
  await prisma.auditLog.create({ data: { userId, action, targetType: 'Locale', targetId: code, meta } });
}

export async function createLocale(userId: string, input: { code: string; label: string }): Promise<LocaleResult> {
  const code = input.code.trim();
  const existing = (await prisma.locale.findMany({ select: { code: true } })).map((l) => l.code);
  const bad = checkLocaleCode(code, existing) ?? checkLocaleLabel(input.label);
  if (bad) return fail(400, bad);

  // Tạo ở trạng thái TẮT: dịch trước, bật sau.
  await prisma.locale.create({ data: { code, label: input.label.trim(), enabled: false, isDefault: false } });
  await audit(userId, 'locale.create', code, { label: input.label.trim() });
  revalidateTag(LOCALES_TAG);
  return { ok: true };
}

export async function setLocaleEnabled(userId: string, code: string, enabled: boolean): Promise<LocaleResult> {
  const loc = await prisma.locale.findUnique({ where: { code } });
  if (!loc) return fail(404, `Không có ngôn ngữ "${code}".`);
  if (loc.isDefault) return fail(400, 'Ngôn ngữ mặc định luôn bật.');

  if (enabled) {
    const pages = await prisma.page.findMany({ where: { archivedAt: null }, select: { slug: true } });
    const blocking = slugsBlockingLocale(code, pages.map((p) => p.slug));
    if (blocking.length) {
      return fail(
        409,
        `Trang ${blocking.map((s) => `/${s}`).join(', ')} bắt đầu bằng "${code}" — bật ngôn ngữ này thì ` +
          'địa chỉ đó bị hiểu là tiền tố ngôn ngữ. Đổi đường dẫn trang trước.',
      );
    }
  }

  await prisma.locale.update({ where: { code }, data: { enabled } });
  await audit(userId, enabled ? 'locale.enable' : 'locale.disable', code);
  revalidateTag(LOCALES_TAG);
  return { ok: true };
}

export async function deleteLocale(userId: string, code: string): Promise<LocaleResult> {
  const loc = await prisma.locale.findUnique({ where: { code } });
  if (!loc) return fail(404, `Không có ngôn ngữ "${code}".`);
  if (loc.isDefault) return fail(400, 'Không xoá được ngôn ngữ mặc định.');

  const [translations, entries] = await Promise.all([
    prisma.translation.count({ where: { locale: code } }),
    prisma.entryLocale.count({ where: { locale: code } }),
  ]);
  // Cascade xoá bản dịch trang (`Translation`) và bản dịch bài viết (`EntryLocale`).
  await prisma.locale.delete({ where: { code } });
  await audit(userId, 'locale.delete', code, { label: loc.label, translations, entries });
  revalidateTag(LOCALES_TAG);
  return { ok: true };
}
