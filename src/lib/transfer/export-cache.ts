import 'server-only';

import { randomBytes } from 'node:crypto';

import type { ExportFile } from './export';
import type { PageBundle } from './manifest';

/**
 * Gói vừa kiểm xong, giữ trong RAM vài phút để lượt tải dùng lại.
 *
 * ## Vì sao
 *
 * Trước đây `export/check` và `export` đều gọi `buildExport`, mà `buildExport` ĐỌC TỪNG FILE để
 * tính sha256. Bấm "Tải về" nghĩa là đọc lại cả kho một lượt nữa trước khi byte đầu tiên của zip
 * ra khỏi server — với trang nhiều ảnh, đó là một quãng im lặng dài mà thanh tiến độ không đo
 * được. Giữ kết quả lượt kiểm thì lượt tải bắt đầu stream ngay.
 *
 * ## Vì sao an toàn
 *
 * - Thứ tải về đúng là thứ người dùng vừa xem kết quả kiểm — không phải một bản nháp đã đổi giữa
 *   hai lần bấm mà chưa ai kiểm.
 * - sha256 trong manifest vẫn được tính trên byte thật; zip đọc lại file khi stream, y như trước.
 *   Cửa sổ "file đổi giữa lúc tính sha và lúc nén" vẫn y như cũ, chỉ dài thêm tối đa `TTL_MS`.
 * - Khoá gồm token ngẫu nhiên + trang + người kiểm; lấy ra là xoá. Hết hạn hoặc trượt (server
 *   khởi động lại, nhiều instance) thì route tải tự dựng lại như cũ — không bao giờ hỏng, chỉ chậm.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 20;

interface Entry {
  pageId: string;
  user: string;
  at: number;
  bundle: PageBundle;
  files: ExportFile[];
}

const store = new Map<string, Entry>();

function prune(now: number) {
  for (const [k, e] of store) if (now - e.at > TTL_MS) store.delete(k);
  // Map giữ thứ tự chèn: cũ nhất ở đầu.
  while (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value!);
}

export function putExport(e: Omit<Entry, 'at'>, now = Date.now()): string {
  prune(now);
  const token = randomBytes(16).toString('hex');
  store.set(token, { ...e, at: now });
  return token;
}

export function takeExport(token: string | null, pageId: string, user: string, now = Date.now()): Omit<Entry, 'at'> | null {
  if (!token) return null;
  const e = store.get(token);
  if (!e) return null;
  store.delete(token);
  if (now - e.at > TTL_MS || e.pageId !== pageId || e.user !== user) return null;
  return { pageId: e.pageId, user: e.user, bundle: e.bundle, files: e.files };
}

/** Chỉ cho test. */
export function clearExportCache() {
  store.clear();
}
