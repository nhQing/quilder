import 'server-only';

/**
 * Trạng thái cài đặt — thứ màn `/builder/setup` cần biết trước khi có ai đăng nhập.
 *
 * Đi qua một route CÔNG KHAI, nên chỉ trả TRẠNG THÁI: env nào đã đặt là boolean,
 * không bao giờ là giá trị. Ngoại lệ duy nhất là `siteUrlEnv` — URL site vốn công
 * khai, và màn cần nó để khoá ô domain đúng giá trị đang chạy. Chi tiết lỗi kết nối
 * DB KHÔNG ra ngoài (nó có thể chứa host và user của DB); người vận hành đọc nó ở
 * log server.
 */

import { prisma } from '@/lib/db';
import { setupTokenRequired } from '@/lib/auth/setup-policy';
import { siteUrlFromEnv } from '@/lib/site/origin';
import { checkSchema } from './schema-check';

export type DbState = 'ok' | 'unreachable' | 'needs-migration';

export interface SetupStatus {
  db: DbState;
  /** Đã có ít nhất một tài khoản — màn cài đặt đã đóng. */
  installed: boolean;
  tokenRequired: boolean;
  /** `true` khi chạy `next dev` — màn chọn lệnh hướng dẫn theo nó. */
  dev: boolean;
  env: {
    authSecret: boolean;
    s3: boolean;
    siteUrlEnv: string | null;
  };
}

const S3_VARS = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'];

export async function setupStatus(): Promise<SetupStatus> {
  const schema = await checkSchema(prisma);
  if (schema.db === 'unreachable') {
    console.error('[setup] không nối được DB:', schema.detail);
  }

  let installed = false;
  if (schema.db === 'ok') {
    installed = (await prisma.user.count()) > 0;
  }

  return {
    db: schema.db,
    installed,
    tokenRequired: setupTokenRequired(),
    dev: process.env.NODE_ENV !== 'production',
    env: {
      authSecret: (process.env.AUTH_SECRET?.length ?? 0) >= 32,
      s3: S3_VARS.every((k) => Boolean(process.env[k])),
      siteUrlEnv: siteUrlFromEnv(),
    },
  };
}
