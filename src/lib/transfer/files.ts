import 'server-only';

import { createHash } from 'node:crypto';

import { assetKeyBase, assetKeyFromDigest } from '@/lib/assets/key';
import { uploadAsset } from '@/lib/builder/upload-asset';
import { issue } from '@/lib/transfer/guides';

export interface StoreImportFileArgs {
  bytes: Uint8Array;
  sha256: string;
  name: string;
  /** Thư mục người dùng đã chọn; không bao giờ tự chọn. `null` = chưa phân loại. */
  folder: string | null;
  actor: { email: string; sub: string };
}

export interface StoreImportFileResult {
  status: number;
  body: unknown;
}

/**
 * Phần không phụ thuộc request của route tải file: kiểm sha256, ghi kho, kiểm khoá.
 * Tách riêng để test được mà không cần dựng multipart.
 *
 * sha256 do server tính lại phải khớp manifest; khoá sinh ra phải đúng khoá preview đã
 * đoán, nếu không lần commit sẽ không tìm thấy file.
 */
export async function storeImportFile(a: StoreImportFileArgs): Promise<StoreImportFileResult> {
  const items = [{ label: a.name }];
  const actual = createHash('sha256').update(a.bytes).digest('hex');
  if (actual !== a.sha256) {
    return {
      status: 422,
      body: { error: 'File không khớp mã kiểm tra', issues: [issue('file-corrupt', 'block', { items })] },
    };
  }

  const r = await uploadAsset({
    bytes: a.bytes,
    fileName: a.name,
    actorEmail: a.actor.email,
    actorSub: a.actor.sub,
    folder: a.folder,
  });
  if (!r.ok) {
    const issues =
      r.status === 413 ? [issue('file-too-large', 'block', { items })]
      : r.status === 415 ? [issue('file-rejected', 'block', { items, vars: { reason: r.error.split('\n')[0]! } })]
      : [];
    return { status: r.status, body: { error: r.error, issues } };
  }

  const expected = assetKeyFromDigest(assetKeyBase(a.name), a.sha256);
  if (r.asset.key !== expected) {
    return {
      status: 500,
      body: { error: `Khoá sinh ra (${r.asset.key}) khác khoá đoán trước (${expected})` },
    };
  }
  return { status: 200, body: { assetId: r.asset.id, key: r.asset.key } };
}
