'use client';

/**
 * Ô chọn asset cho MỘT field của entry — dùng ở form nội dung và ở nút chèn ảnh
 * của ô soạn thân bài.
 *
 * ## Vì sao nó mỏng đi hẳn (07/09/2026)
 *
 * Bản trước tự dựng lưới chọn inline, tự nạp `/api/assets`, tự lọc `imageOnly`,
 * tự viết trạng thái đang-nạp / lỗi / kho-rỗng — và `NodeAssetPicker` có một bản
 * gần giống, còn `AssetDialog` có một bản đầy đủ hơn cả hai. Ba bản của một luật
 * thì bản ít được nhớ nhất là bản trôi.
 *
 * Giờ phần chọn nằm ở `AssetPickerBox` (khung vuông + `AssetDialog`), và file này
 * còn lại đúng hai việc: **dịch `imageOnly` thành tập hạng**, và **trả về `id`**
 * thay vì cả object.
 *
 * ## Vì sao vẫn là một file riêng, không gọi thẳng `AssetPickerBox`
 *
 * Hợp đồng với `FieldInput` là `onPick(id | null)` — nó nhồi id vào JSON của entry
 * và không biết gì về `DialogAsset`. Giữ lớp mỏng này là giữ `FieldInput` không
 * phải đổi, và giữ cho `imageOnly` (ngôn ngữ của `FieldDef`) không rò vào
 * component dùng chung.
 *
 * ## Vì sao KHÔNG dùng `NodeAssetPicker`
 *
 * Nó gắn cứng vào một Node của doc và vào store của editor (`useEditor`, dispatch
 * một op). Ở đây không có node và không có doc — chỉ có một `assetId` đi vào JSON
 * của entry. Dùng lại nó là kéo cả editor store vào màn nhập nội dung.
 */

import { IMAGE_KINDS, type AssetKind } from '@/lib/assets/kind';

import { AssetPickerBox } from './asset/AssetPickerBox';

/** Mọi hạng — dùng cho field `file`, nơi một PDF hay một font đều hợp lệ. */
const ANY_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>([
  'image', 'svg', 'video', 'audio', 'pdf', 'doc', 'font', 'data', 'file',
]);

export function AssetField({
  value,
  onPick,
  imageOnly,
}: {
  value: string | null;
  onPick: (id: string | null) => void;
  imageOnly: boolean;
}) {
  return (
    <AssetPickerBox
      value={value}
      onPick={(a) => onPick(a?.id ?? null)}
      label={imageOnly ? 'ảnh' : 'tệp'}
      kinds={imageOnly ? IMAGE_KINDS : ANY_KINDS}
      /*
       * Chặn bề rộng.
       *
       * Cột form nội dung rộng hơn panel Inspector nhiều, và một khung VUÔNG rộng
       * bằng cả cột là một ô cao 600px đẩy mọi field phía dưới xuống dưới màn hình.
       * `max-w` chứ không `w`: ở khổ hẹp nó vẫn co lại theo cột.
       */
      className="max-w-[13rem]"
    />
  );
}
