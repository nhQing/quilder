'use client';

/**
 * Chọn một asset cho MỘT trường của node đang chọn.
 *
 * ## Vì sao nó mỏng đi hẳn (07/09/2026)
 *
 * Bản trước tự dựng lưới chọn inline: tự nạp `/api/assets`, tự lọc theo hạng, tự
 * viết trạng thái đang-tải / lỗi / kho-rỗng — khoảng 120 dòng làm lại thứ
 * `AssetDialog` đã làm đầy đủ hơn. Giờ nó chỉ còn một việc: **ghi bằng op nào.**
 * Phần chọn nằm ở `AssetPickerBox`, dùng chung với form nội dung và với Favicon.
 *
 * ## Vì sao không còn tên `ImagePicker`
 *
 * Bản đầu chỉ phục vụ node `Image`. Nhưng schema có cả node `Video` với HAI trường
 * asset — `assetId` (nguồn) và `posterAssetId` (ảnh chờ) — và cả hai không có ô
 * chọn nào: đặt nguồn video chỉ làm được qua MCP. Một node dựng được trong UI mà
 * không cấu hình được trong UI là một ngõ cụt, không phải một tính năng còn thiếu.
 *
 * Nên component nhận `field` và `kinds`, và Inspector dựng nó một lần cho `Image`,
 * hai lần cho `Video`.
 *
 * ## Vì sao ghi bằng `setProps`, không phải một op riêng
 *
 * `assetId` là một prop của node như mọi prop khác, và `setProps` đã có validator
 * cho nó. Thêm op mới ở đây là thêm một luật thứ hai cho cùng một trường.
 *
 * Đây cũng là đường mà AI dùng (`apply_ops` + `setProps`), nên hai bên ghi giống
 * hệt nhau — điều kiện để undo, audit và diff nói cùng một chuyện.
 */

import { useState } from 'react';

import { IMAGE_KINDS, type AssetKind } from '@/lib/assets/kind';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { useEditor } from '@/lib/builder/store';

import { AssetPickerBox } from './asset/AssetPickerBox';

/** Hạng dùng được ở nguồn của một node Video. */
export const VIDEO_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(['video']);

export function NodeAssetPicker({
  nodeId,
  assetId,
  field = 'assetId',
  label = 'ảnh',
  kinds = IMAGE_KINDS,
  emptyNote,
}: {
  nodeId: string;
  assetId: string | null;
  /** Prop nào của node được ghi. */
  field?: 'assetId' | 'posterAssetId';
  /** Nhãn ngắn trên đầu ô, chữ thường — nó là tên một trường, không phải tiêu đề. */
  label?: string;
  /** Hạng nào được bày ra. Xem `lib/assets/kind.ts`. */
  kinds?: ReadonlySet<AssetKind>;
  /** Câu nói khi node chưa gắn gì. Bỏ trống thì không cảnh báo. */
  emptyNote?: string;
}) {
  const dispatch = useEditor((s) => s.dispatch);
  const [busy, setBusy] = useState(false);

  const write = async (next: string | null) => {
    setBusy(true);
    try {
      await dispatch([{ op: 'setProps', nodeId, props: { [field]: next } }], {
        label: next ? `đổi ${label}` : `gỡ ${label}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 py-2">
      <span className={cn(ui.label, 'mb-1.5 block')}>{label}</span>

      {/*
        `busy` làm mờ chứ không tháo ô ra khỏi cây.
        Tháo ra thì dialog đang mở bị đóng đột ngột giữa lúc lưu, và người dùng
        không biết mình vừa chọn được hay chưa.
      */}
      <AssetPickerBox
        value={assetId}
        onPick={(a) => void write(a?.id ?? null)}
        label={label}
        kinds={kinds}
        className={busy ? 'pointer-events-none opacity-50' : undefined}
      />

      {!assetId && emptyNote && <p className="mt-1.5 text-mini font-medium text-shell-warn">{emptyNote}</p>}
    </div>
  );
}
