import { PrismaClient } from '@prisma/client';

/**
 * Một PrismaClient duy nhất. Trong dev, Next hot-reload module liên tục — không
 * cache lại thì mỗi lần reload mở thêm một connection pool và Postgres hết slot
 * sau vài chục lần sửa file.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
