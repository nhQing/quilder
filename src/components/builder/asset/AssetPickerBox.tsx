'use client';

/**
 * Khung xem trước vuông + mở `AssetDialog`. MỘT bộ chọn asset cho cả builder.
 *
 * ## Vì sao có file này: trước nó có BA bộ chọn
 *
 * `NodeAssetPicker` (Inspector) và `AssetField` (form nội dung) mỗi cái tự dựng một
 * lưới inline riêng, tự nạp `/api/assets`, tự quyết định "không phải ảnh thì hiện
 * gì" và tự viết trạng thái lỗi/đang tải. `AssetDialog` — bộ chọn của Favicon —
 * thì đã có đủ: `<dialog>` thật, tab Thư viện | Tải lên, lọc theo mime, cây thư
 * mục, tìm kiếm, kéo-thả.
 *
 * Nên đây KHÔNG phải bộ chọn thứ tư. Nó là cái vỏ để ba chỗ dùng chung một dialog,
 * và nó xoá hai lưới inline kia. Ba bản của một luật thì bản ít được nhớ nhất là
 * bản trôi — và ở đây "trôi" nghĩa là ba chỗ trong cùng một sản phẩm chọn ảnh theo
 * ba cách khác nhau.
 *
 * ## Quyết định 07/09/2026 THAY THẾ quyết định cũ ở `NodeAssetPicker`
 *
 * Docblock cũ ghi rõ nó cố ý KHÔNG phải modal: *"modal sẽ che mất canvas — đúng
 * thứ người dùng cần nhìn để biết file nào hợp."* Lập luận đó có thật, và giờ nó
 * bị đánh đổi có ý thức, không phải bị bỏ quên:
 *
 *  - Lưới inline trong panel rộng 260px cho ra ô 60px — không đủ để biết file nào
 *    hợp, tức nó không thật sự giải quyết vấn đề mà nó nêu ra.
 *  - Lưới inline không có tìm kiếm, không có thư mục, không tải lên được. Người
 *    dùng vẫn phải rời sang trang Thư viện — che canvas cả một lượt điều hướng,
 *    lâu hơn một dialog nhiều.
 *  - Dialog đóng lại là thấy ngay kết quả trên canvas.
 *
 * ## Vì sao khung VUÔNG
 *
 * Chốt với chủ dự án: ô vuông cố định nên không có ô nào cao vọt lên đẩy phần dưới
 * của panel xuống.
 *
 * Ảnh VỪA khung (`object-contain`, không padding) — chốt 13/10/2026. Trước đó
 * (24/09) là `object-cover` vì ảnh contain + padding lọt thỏm giữa khoảng trống;
 * nhưng cover cắt mép — logo mất nửa, ảnh chia sẻ mất chữ — mà xem trước là để
 * biết mình chọn ĐÚNG file. Không padding thì ảnh vẫn chạm mép theo chiều dài
 * nhất, không còn cảm giác lọt thỏm.
 *
 * ## Vì sao nền ô kẻ
 *
 * PNG và SVG có nền trong suốt. Trên nền phẳng, một logo trắng trên nền trong suốt
 * trông y như một ô rỗng — và đó chính là ca của favicon. Ô kẻ làm vùng trong suốt
 * thấy được, đúng quy ước của mọi trình sửa ảnh.
 */

import { useEffect, useMemo, useState } from 'react';

import { IMAGE_KINDS, assetKind, type AssetKind } from '@/lib/assets/kind';
import { loadAssets, type AssetOption } from '@/lib/builder/asset-cache';
import { cn } from '@/lib/builder/cn';

import { AssetDialog, type DialogAsset } from '../AssetDialog';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { AssetThumb } from './AssetThumb';
import { displayName } from './types';

/**
 * File đã biết sẵn, khỏi phải tra kho. Ba trường đi CÙNG NHAU, không tách prop.
 *
 * Bản đầu là ba prop `knownUrl`/`knownMime`/`knownKey` rời, và màn Cài đặt chỉ
 * truyền url — `assetKind('', '')` ra hạng `file`, nên ô favicon vẽ một tờ giấy xám
 * không nhãn trong khi chính favicon đó đang hiện đúng trên tab. Thiếu mime thì
 * không biết vẽ ảnh hay vẽ tờ giấy; thiếu key thì không có tên file dưới khung.
 */
export interface KnownAsset {
  url: string;
  mime: string;
  key: string;
}

export function AssetPickerBox({
  value,
  onPick,
  label = 'ảnh',
  kinds = IMAGE_KINDS,
  mimes,
  mimeLabel,
  accept,
  dialogTitle,
  /**
   * File đã biết sẵn — xem `KnownAsset`.
   *
   * Màn Cài đặt có sẵn file của favicon/ảnh chia sẻ/logo từ server, nên nó không cần
   * chờ `loadAssets()` chỉ để vẽ đúng thứ nó đã biết. Các chỗ còn lại bỏ trống và ô
   * tự tra.
   */
  known,
  className,
}: {
  value: string | null;
  /** `null` = gỡ. Bên gọi tự quyết định ghi bằng gì — op, state, hay callback form. */
  onPick: (asset: DialogAsset | null) => void;
  /** Tên trường, chữ thường: "ảnh", "video", "ảnh chờ", "tệp". Vào cả nút và title. */
  label?: string;
  /** Hạng nào hợp lệ. Chỉ dùng để CẢNH BÁO khi file đang gắn sai hạng — xem dưới. */
  kinds?: ReadonlySet<AssetKind>;
  mimes?: ReadonlySet<string>;
  mimeLabel?: string;
  accept?: string;
  dialogTitle?: string;
  known?: KnownAsset | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * File vừa chọn trong dialog.
   *
   * Ưu tiên hơn kết quả tra kho: `loadAssets()` là một promise dùng chung đã được
   * cache, nên ngay sau khi TẢI LÊN một file mới, bản cache chưa có nó. Không giữ
   * riêng ở đây thì ô vừa chọn báo "không còn trong kho" cho tới lần nạp lại sau.
   */
  const [picked, setPicked] = useState<DialogAsset | null>(null);

  // Nạp khi CÓ VIỆC: đang giữ một id cần xem trước, và chưa biết sẵn url của nó.
  // Ô rỗng thì không có gì để hiện, nên không nạp.
  const needsLookup = Boolean(value) && !known && !picked;

  useEffect(() => {
    if (!needsLookup || assets) return;
    let alive = true;
    loadAssets()
      .then((list) => {
        if (alive) setAssets(list);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [needsLookup, assets]);

  /** Thứ đang được xem trước, gộp từ ba nguồn theo độ tin cậy. */
  const shown = useMemo(() => {
    if (!value) return null;
    if (picked && picked.id === value) {
      return { url: picked.url, mime: picked.mime, key: picked.key };
    }
    if (known) return known;
    const hit = (assets ?? []).find((a) => a.id === value);
    return hit ? { url: hit.url, mime: hit.mime, key: hit.key } : null;
  }, [value, picked, known, assets]);

  /*
   * Cảnh báo khi file đang gắn KHÔNG thuộc hạng hợp lệ.
   *
   * Không tự gỡ nó: giá trị đó có thể do MCP hoặc một bản schema cũ ghi vào, và
   * xoá dữ liệu của người khác vì ta không thích nó là quá tay. Nói ra thì họ
   * quyết định.
   */
  const wrongKind =
    shown && shown.mime ? !kinds.has(assetKind(shown.mime, shown.key).kind) : false;

  /*
   * Ba trạng thái của một ô ĐÃ gắn file mà chưa có gì để vẽ — trước đây gộp chung thành
   * "đang nạp…", nên một file đã bị xoá khỏi kho hiện "đang nạp…" mãi mãi:
   *   looking  đang tra kho → khung shimmer
   *   missing  tra xong, kho không có id này → nói thẳng ra
   *   (lỗi mạng có dòng `error` riêng bên dưới)
   */
  const looking = Boolean(value) && !shown && assets === null && !error;
  const missing = Boolean(value) && !shown && assets !== null;

  const cta = value ? `Đổi ${label}` : `Chọn ${label}`;

  return (
    <div className={className}>
      {/*
        Khung là một `<div>`, không phải một `<button>` bọc cả khung như bản đầu.

        Trong khung có HAI hành động — chọn và bỏ — nên một nút bọc cả khung sẽ phải
        lồng nút vào nút: HTML không cho phép, và bàn phím sẽ không tới được nút bên
        trong. Vùng bấm "chọn" vẫn là cả khung, chỉ là nó thành một `<button>` phủ
        `inset-0` nằm DƯỚI lớp chữ chứ không bọc lớp chữ.
      */}
      <div
        className={cn(
          'group relative aspect-square w-full overflow-hidden rounded border transition-colors',
          'border-shell-line-strong hover:border-shell-accent focus-within:border-shell-accent',
          'focus-within:ring-3 focus-within:ring-shell-accent-soft',
          value ? 'bg-shell-panel' : 'border-dashed bg-shell-raised',
        )}
        style={
          value
            ? {
                /* Ô kẻ: làm vùng trong suốt của PNG/SVG thấy được. Inline vì nó là
                   một gradient bốn lớp — một class Tailwind cho nó sẽ dài hơn và
                   chỉ dùng ở đúng chỗ này. */
                backgroundImage:
                  'linear-gradient(45deg, var(--color-shell-raised) 25%, transparent 25%),' +
                  'linear-gradient(-45deg, var(--color-shell-raised) 25%, transparent 25%),' +
                  'linear-gradient(45deg, transparent 75%, var(--color-shell-raised) 75%),' +
                  'linear-gradient(-45deg, transparent 75%, var(--color-shell-raised) 75%)',
                backgroundSize: '12px 12px',
                backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
              }
            : undefined
        }
      >
        {shown ? (
          <AssetThumb
            mime={shown.mime}
            assetKey={shown.key}
            url={shown.url}
            /* Vừa khung bằng `object-contain` mặc định của AssetThumb — xem
               "Vì sao khung VUÔNG" ở đầu file. */
            className="size-full"
          />
        ) : looking ? (
          // Đang tra kho để biết url của file đã gắn: khung shimmer, không in chữ.
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : missing ? (
          <span className="absolute inset-0 grid place-items-center text-shell-muted">
            <Icon name="alert" size={20} />
          </span>
        ) : null}

        {/* Đích bấm mở dialog: cả khung, và không bọc gì cả.

            `peer`: icon chọn/đổi ở lớp trên sáng lên khi nút này được hover hay focus
            — xem icon bên dưới. `title` là tên HÀNH ĐỘNG, không phải tên file: tên
            file đã nằm ngay dưới khung, còn "di chuột vào thì bấm được gì" thì chưa
            chỗ nào nói. `cursor-pointer` tường minh vì Tailwind v4 để nút ở
            `cursor: default`. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={cta}
          aria-label={cta}
          className="peer absolute inset-0 cursor-pointer focus-visible:outline-none"
        />

        {/*
          Chữ nằm trong một HỘP NHỎ giữa khung, không phải một lớp phủ kín khung.

          Phủ kín thì phải làm mờ cả ảnh để chữ đọc được — mà ảnh chính là thứ người
          dùng đang soi để biết mình chọn đúng file. Hộp nhỏ nền đặc thì chữ đọc được
          trên mọi ảnh, kể cả logo trắng, và ảnh vẫn thấy gần hết.

          `pointer-events-none` cho cả cụm để cú bấm đi xuyên xuống nút phủ khung bên
          dưới; riêng nút "bỏ" bật lại `pointer-events-auto` vì nó là hành động khác.

          `group-focus-within` đi cùng `group-hover`: người dùng bàn phím phải thấy
          được cùng một gợi ý, nếu không thì ô này trông như một khung ảnh trơ.
        */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5',
            'transition-opacity',
            value
              ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              : 'opacity-100',
          )}
        >
          {/* Icon thay chữ: cộng = chọn, bút = đổi. Tên file/"chưa chọn" bên dưới
              đã nói ô này là gì; tên hành động nằm ở `aria-label`/`title` của nút phủ.

              Icon chỉ là hình (cú bấm đi xuyên xuống nút phủ khung), nên nó không tự
              có `:hover` — trước 13/10/2026 trỏ vào bút chì không đổi gì, trong khi
              nút thùng rác ngay dưới đổi đỏ. Giờ nó sáng màu nhấn theo trạng thái của
              nút phủ: `.peer:hover ~ * &` — cụm này là anh em đứng sau nút đó. Trỏ
              vào thùng rác thì nút phủ KHÔNG hover, nên hai icon không cùng sáng. */}
          <span
            className={cn(
              'grid size-8 place-items-center rounded shadow-shell-card transition-colors',
              value ? 'bg-shell-panel text-shell-ink' : 'bg-shell-accent-soft text-shell-accent',
              '[.peer:hover~*_&]:bg-shell-accent [.peer:hover~*_&]:text-shell-on-accent',
              '[.peer:focus-visible~*_&]:bg-shell-accent [.peer:focus-visible~*_&]:text-shell-on-accent',
            )}
          >
            <Icon name={value ? 'edit' : 'plus'} size={16} />
          </span>
          {value && (
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                onPick(null);
              }}
              title={`Gỡ ${label}. Node vẫn còn, chỉ là không có ${label}.`}
              aria-label={`Gỡ ${label}`}
              /*
                Icon-only, cùng kiểu với icon "đổi" ngay trên nó: nhãn chữ chỉ làm
                cụm giữa khung to thêm và che ảnh thêm. `aria-label` + `title` giữ
                nguyên nghĩa cho screen reader và cho người hover.

                Đỏ sẵn, không chờ hover: đây là hành động phá, và một nút phá trông
                như nút thường cho tới lúc trỏ vào là một nút bấm nhầm được.
              */
              className={cn(
                'pointer-events-auto grid size-7 cursor-pointer place-items-center rounded-full shadow-shell-card',
                'bg-shell-panel text-shell-danger transition-colors',
                'hover:bg-shell-danger hover:text-shell-on-danger',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-danger',
              )}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tên file nằm NGOÀI khung. Nút bỏ thì không: nó ở giữa khung, ngay dưới hộp
          chữ, nên hai hành động của cùng một ô nằm cùng một chỗ. */}
      {looking ? (
        // Cùng chiều cao với dòng chữ (`text-mini` 12px × 1.45), để phần dưới không nhảy
        // khi tên file hiện ra.
        <Skeleton className="mt-1.5 h-3 w-2/3" />
      ) : (
        <span className="mt-1 block truncate text-mini text-shell-muted" title={shown?.key || undefined}>
          {!value
            ? 'chưa chọn'
            : shown?.key
              ? displayName(shown.key)
              : missing
                ? 'tệp không còn trong kho'
                : ''}
        </span>
      )}

      {error && <p className="mt-1 text-mini text-shell-danger">{error}</p>}
      {wrongKind && (
        <p className="mt-1 text-mini leading-relaxed text-shell-warn">
          Tệp đang gắn không phải {label}. Nó vẫn được giữ — đổi hoặc bỏ nếu không đúng ý.
        </p>
      )}

      <AssetDialog
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onPick={(a) => {
          setPicked(a);
          onPick(a);
        }}
        mimes={mimes}
        mimeLabel={mimeLabel}
        accept={accept}
        title={dialogTitle ?? `Chọn ${label}`}
      />
    </div>
  );
}
