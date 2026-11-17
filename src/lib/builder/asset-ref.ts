/**
 * Dòng "Copy cho Claude" của một ảnh trong Thư viện (17/11/2026).
 *
 * Cùng dáng với dòng chép của node (`buildClipboardLine` ở `ai-link.ts`): mở đầu `[Quilder]`,
 * đường đi nối bằng ` › `. Thứ model cần là `assetId` — mọi tool ảnh (`replace_asset`,
 * `rename_asset`, `setProps { assetId }`) nhận đúng id đó; thư mục và tên file để NGƯỜI đọc
 * lại dòng đã dán còn biết đó là ảnh nào.
 *
 * File THUẦN: thẻ ảnh dùng để dựng, test dùng để kiểm.
 */

export function buildAssetClipboardLine(args: { id: string; folder: string | null; name: string }): string {
  const folder = args.folder?.trim() || 'Chưa phân loại';
  const name = args.name.replace(/\s+/g, ' ').trim() || 'ảnh';
  return `[Quilder] Thư viện › ${folder} › ${name} — assetId: ${args.id}`;
}
