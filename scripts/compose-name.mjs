/**
 * Tên project Docker Compose của stack dev — tiền tố của container (`<tên>-db`, `<tên>-s3`,
 * `<tên>-app`) và của volume (`<tên>_builder-pgdata`).
 *
 * Mặc định `quilder`. Máy đã có dữ liệu dưới tên cũ đặt `COMPOSE_PROJECT_NAME` trong `.env`
 * (đúng tên project cũ) để giữ nguyên volume: đổi tên project là Compose tạo volume MỚI
 * trống trơn, trông như mất sạch dữ liệu dev trong khi volume cũ vẫn nằm đó.
 *
 * Đọc biến môi trường trước, rồi `.env` — script chạy bằng `node` trần không tự nạp `.env`.
 */

import { existsSync, readFileSync } from 'node:fs';

export const DEFAULT_COMPOSE_NAME = 'quilder';

export function composeName(env = process.env, envFile = '.env') {
  if (env.COMPOSE_PROJECT_NAME?.trim()) return env.COMPOSE_PROJECT_NAME.trim();
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => /^\s*COMPOSE_PROJECT_NAME\s*=/.test(l));
    const value = line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }
  return DEFAULT_COMPOSE_NAME;
}
