'use client';

/**
 * Một thẻ file trong lưới Thư viện (FileCard của design system): xem, chọn, kéo, đổi
 * thư mục.
 *
 * ## Widget chỉ hiện khi có việc cho nó
 *
 * Bản đầu để checkbox và ô `<select>` thư mục hiện thường trực trên MỌI thẻ. Với 15
 * ảnh, đó là 30 widget cùng nhìn thấy, hai mươi chín cái trong đó đang không được
 * dùng — và tất cả chúng cạnh tranh chú ý với thứ duy nhất người dùng vào trang này
 * để nhìn: bản thân cái ảnh.
 *
 * Nên: ô chọn tròn góc trái và nút "⋮" góc phải hiện khi rê chuột, khi focus vào thẻ,
 * khi thẻ được chọn, hoặc (riêng ô chọn) khi trong lưới đã có ảnh nào được chọn — lúc
 * đó người dùng đang ở "chế độ chọn" và cần thấy đích để bấm. Ô chọn thư mục dùng biến
 * thể `quiet` — không viền không nền cho tới khi rê chuột — nên nó vẫn là MỘT control
 * chứ không phải một nhãn chữ phải bấm để lộ ra ô chọn thật.
 *
 * ## Vì sao vùng bấm để CHỌN là phần ảnh, không phải cả thẻ
 *
 * Phần dưới thẻ có tên file để đọc và một ô chọn thư mục để bấm. Cho cả thẻ nhận cú
 * bấm "chọn" nghĩa là mọi lần bấm hụt cạnh ô chọn lại chọn thêm một ảnh, và thanh
 * thao tác hàng loạt hiện lên không rõ vì sao.
 *
 * ## Kéo mang theo cả nhóm đang chọn
 *
 * Kéo một ảnh nằm trong vùng chọn = kéo cả vùng chọn. Kéo một ảnh ngoài vùng chọn =
 * chỉ kéo nó. Đó là quy ước của mọi trình quản lý file, và làm khác đi thì người
 * dùng chọn 8 ảnh, kéo một cái, rồi phát hiện chỉ có một ảnh được dời.
 */

import { assetKind, extOf } from '@/lib/assets/kind';
import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { MenuButton, type MenuEntry } from '../ui/Overlay';
import { AssetThumb } from './AssetThumb';
import { FolderSelect } from './FolderSelect';
import {
  ASSET_DND_MIME,
  displayName,
  extLabel,
  human,
  kindBg,
  type AssetItem,
  type FolderItem,
  type TrashMeta,
} from './types';

/**
 * Nền ô kẻ cho vùng xem trước.
 *
 * Không phải trang trí: `shell-panel` ở theme sáng là trắng, nên logo trắng trên nền
 * trong suốt (logo chữ trắng) biến mất hoàn toàn và người dùng thấy một ô
 * rỗng. Ô kẻ nói "chỗ này trong suốt" theo đúng quy ước mọi trình xem ảnh dùng.
 *
 * Rất nhạt và ô nhỏ. Bản đầu để 14px ở opacity 40% và cả lưới 15 thẻ trông như ảnh
 * tải lỗi — nền báo hiệu một thuộc tính của file thì không được to tiếng hơn chính
 * cái file.
 */
const CHECKER = {
  backgroundImage: 'repeating-conic-gradient(var(--color-shell-line-strong) 0% 25%, transparent 0% 50%)',
  backgroundSize: '10px 10px',
} as const;

/**
 * Định dạng này có kênh alpha không.
 *
 * JPEG thì không, bao giờ cũng vậy — vẽ ô kẻ sau một ảnh JPEG là hứa một thứ không
 * thể xảy ra, và với kho ảnh chụp thì đó là phần lớn số thẻ.
 */
function mayBeTransparent(mime: string): boolean {
  return mime !== 'image/jpeg' && mime !== 'image/jpg';
}

/**
 * Danh sách trang đang dùng ảnh, đọc được.
 *
 * Trang chủ có `slug` rỗng, nên cách viết cũ `/${slug}` cho ra dòng "Dùng ở /" —
 * đúng về kỹ thuật và vô nghĩa với người đọc. Ở màn quản trị thì tên trang thắng
 * đường dẫn khi hai thứ lệch nhau.
 */
function usedByLabel(asset: AssetItem): string {
  return asset.usedBy.map((u) => (u.slug ? `/${u.slug}` : 'Trang chủ')).join(', ');
}

/** `2026-10-07T07:32:00Z` → `07/10/2026 14:32` (giờ địa phương, dd/MM/yyyy HH:mm). */
function formatTrashedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Thư mục cũ, ngắn gọn: quá 2 cấp thì giữ 2 đoạn cuối (`…/ban-nhap/ban-cuoi`). */
function oldFolderLabel(folder: string | null): string {
  if (!folder) return 'Chưa phân loại';
  const parts = folder.split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : folder;
}

/** Hiện khi rê chuột / focus vào thẻ; luôn hiện trên màn cảm ứng (không có hover). */
const ON_HOVER =
  'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100';

export function AssetCard({
  asset,
  folders,
  selected,
  selectionActive,
  busy,
  onToggle,
  onDragIds,
  onMove,
  trashed,
  onTrash,
  onTrashBlocked,
  onRestore,
  onPurge,
}: {
  asset: AssetItem;
  folders: FolderItem[];
  selected: boolean;
  /** Trong lưới đã có ảnh nào được chọn chưa — quyết định ô chọn có hiện sẵn. */
  selectionActive: boolean;
  busy: boolean;
  /** `range` = giữ Shift lúc bấm. */
  onToggle: (id: string, range: boolean) => void;
  /** Trả về danh sách id sẽ đi cùng cú kéo này. */
  onDragIds: (id: string) => string[];
  onMove: (id: string, folder: string | null) => void;
  /**
   * Có = thẻ ở THÙNG RÁC: mờ, không kéo được, hiện dòng "Xoá … · người" và "Thư mục
   * cũ" (lấy từ `asset.folder`), ẩn thư mục/nhãn chưa dùng/nơi dùng/mục xoá mềm.
   */
  trashed?: TrashMeta;
  /** Thư viện: chuyển ảnh vào thùng rác. Không truyền = không có mục. */
  onTrash?: (id: string) => void;
  /** Chọn "Vào thùng rác" của ảnh ĐANG DÙNG — để nơi gọi mở danh sách nơi dùng. */
  onTrashBlocked?: (id: string) => void;
  /** Thùng rác: khôi phục. Không truyền = không có mục. */
  onRestore?: (id: string) => void;
  /** Thùng rác, chỉ admin: xoá hoàn toàn. Không truyền = không có mục. */
  onPurge?: (id: string) => void;
}) {
  const info = assetKind(asset.mime, asset.key);
  const ext = extOf(asset.key);
  const dims = asset.width && asset.height ? `${asset.width}×${asset.height}` : null;
  const name = displayName(asset.key);
  const inUse = asset.useCount > 0;
  /** Có ảnh/khung hình thật thì nhãn đuôi file nằm ở góc dưới; không thì tờ giấy đã in nó. */
  const hasPicture = info.previewable || info.kind === 'video';

  const menu: MenuEntry[] = [];
  if (trashed) {
    if (onRestore) {
      menu.push({ label: 'Khôi phục về thư mục cũ', icon: 'undo', disabled: busy, onSelect: () => onRestore(asset.id) });
    }
    if (onPurge) {
      if (menu.length) menu.push({ separator: true });
      menu.push({ label: 'Xoá hoàn toàn', icon: 'trash', danger: true, disabled: busy, onSelect: () => onPurge(asset.id) });
    }
  } else if (onTrash) {
    /*
     * Ảnh đang dùng: mục vẫn bấm được nhưng không gọi API — nó mở danh sách nơi dùng
     * qua `onTrashBlocked`. Một mục `disabled` không nói được VÌ SAO, còn câu trả lời
     * "đang dùng ở đâu" chính là thứ người dùng cần để gỡ ảnh ra trước.
     */
    menu.push(
      inUse
        ? {
            label: (
              <span className="flex flex-col py-1 leading-snug">
                Vào thùng rác
                <span className="text-mini font-normal text-shell-muted">
                  Đang dùng ở {asset.useCount} nơi — xem nơi dùng
                </span>
              </span>
            ),
            icon: 'trash',
            disabled: busy,
            onSelect: () => onTrashBlocked?.(asset.id),
          }
        : { label: 'Vào thùng rác', icon: 'trash', danger: true, disabled: busy, onSelect: () => onTrash(asset.id) },
    );
  }

  return (
    <li
      draggable={!trashed}
      onDragStart={(e) => {
        const ids = onDragIds(asset.id);
        e.dataTransfer.setData(ASSET_DND_MIME, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'move';
      }}
      /*
        KHÔNG `overflow-hidden` ở đây.

        Nó là cách hiển nhiên để bo góc ảnh xem trước, và nó cắt cụt dropdown thư mục
        lẫn menu "⋮" — một menu mở ra rồi bị chặt ngang ở mép thẻ. Việc bo góc thuộc
        về đúng phần tử cần bo, tức cái nút ảnh bên dưới.
      */
      className={cn(
        ui.card,
        'group relative flex min-w-0 flex-col border-2',
        selected ? 'border-shell-accent' : 'border-transparent',
        !trashed && [ui.cardHover, 'cursor-grab'],
        // Dropdown đang mở phải nổi trên thẻ hàng dưới (hover `translate` tạo stacking context).
        'has-[[aria-expanded=true]]:z-30',
      )}
    >
      <button
        type="button"
        onClick={(e) => onToggle(asset.id, e.shiftKey)}
        aria-pressed={selected}
        aria-label={`Chọn ${name}`}
        title={selected ? 'Bỏ chọn' : 'Chọn (giữ Shift để chọn dải)'}
        className={cn(
          'relative block aspect-[4/3] w-full overflow-hidden rounded-t-[calc(var(--radius-lg)-2px)] bg-shell-raised',
          focusRing,
        )}
      >
        {info.previewable && mayBeTransparent(asset.mime) && (
          <span aria-hidden className="absolute inset-0 opacity-[0.12]" style={CHECKER} />
        )}

        {info.kind === 'video' ? (
          /*
           * `preload="metadata"` — tải đủ để có khung đầu làm ảnh xem trước, không
           * tải cả file. `preload="auto"` trên một lưới 20 video là vài trăm MB mà
           * người dùng không yêu cầu.
           *
           * Không `controls`: cả vùng này là nút CHỌN của thẻ, và một hàng điều
           * khiển video nằm trong nút sẽ ăn mất cú bấm.
           */
          <video
            src={asset.url}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          /*
           * Ảnh thật vừa khung (`contain`); file không phải ảnh thì là tờ giấy theo đuôi (xem
           * `AssetThumb`), không phải `<img>` trỏ vào một file PDF — thứ trông y như
           * một ảnh hỏng và làm người dùng đi tải lại file.
           */
          <AssetThumb
            mime={asset.mime}
            assetKey={asset.key}
            url={asset.url}
            lazy
            className={cn('absolute inset-0 size-full', trashed && 'opacity-70')}
          />
        )}

        {hasPicture && ext && (
          <span
            aria-hidden
            className={cn(
              'absolute bottom-2 left-2 rounded-xs px-1.5 py-px text-micro font-bold tracking-[0.04em] text-kind-label',
              kindBg(ext),
            )}
          >
            {extLabel(ext)}
          </span>
        )}

        <span
          aria-hidden
          className={cn(
            'absolute top-2 left-2 grid size-5.5 place-items-center rounded-full border-2 shadow-shell-card transition-[opacity,background-color]',
            selected
              ? 'border-shell-accent bg-shell-accent text-shell-on-accent'
              : 'border-shell-line-strong bg-shell-panel text-transparent',
            // Ẩn hẳn khi không có việc: xem mục đầu file.
            selected || selectionActive ? 'opacity-100' : ON_HOVER,
          )}
        >
          <Icon name="check" size={12} strokeWidth={3} />
        </span>
      </button>

      {/*
        "⋮" NGOÀI `<button>` chọn (không lồng nút trong nút), đặt lên góc ảnh.
      */}
      {menu.length > 0 && (
        <MenuButton
          label={`Tuỳ chọn cho ${name}`}
          icon="more-v"
          size="sm"
          items={menu}
          className={cn(
            'absolute top-2 right-2 rounded-sm bg-shell-panel shadow-shell-card',
            selected ? 'opacity-100' : ON_HOVER,
            'has-[[aria-expanded=true]]:opacity-100',
          )}
        />
      )}

      <div className="flex flex-1 flex-col gap-1 px-3.5 pt-3 pb-3">
        {/*
          Tên ngắn to, khoá đầy đủ ở `title`.

          Trước đây hiện cả `key` trên một dòng và nó bị cắt thành
          `public/builder/ima…` — mất đúng phần phân biệt hai ảnh với nhau. Phần
          đầu đường dẫn và đuôi băm thì giống nhau ở gần như mọi ảnh, nên chúng là
          thứ nhường chỗ (xem `displayName`).
        */}
        <p className="truncate text-ui font-semibold" title={asset.key}>
          {name}
        </p>
        {/*
          Dung lượng + kích thước. Với PDF hay MP3 thì không có kích thước nào để đọc,
          và câu đúng là không nói gì cả — `?×?` còn tệ hơn im lặng: nó khẳng định có
          một kích thước, chỉ là không đọc được.
        */}
        <p className="flex justify-between gap-2 text-mini text-shell-muted tabular-nums" title={info.label}>
          <span className="whitespace-nowrap">{human(asset.bytes)}</span>
          {dims && <span className="font-shell-mono truncate">{dims}</span>}
        </p>

        {trashed ? (
          <div className="mt-auto flex min-w-0 flex-col gap-0.5 pt-1.5">
            {/* Ngày không co; người co + `title`. Email dùng mono. */}
            <p className="flex min-w-0 text-mini text-shell-muted">
              <span className="shrink-0 whitespace-nowrap tabular-nums" suppressHydrationWarning>
                Xoá {formatTrashedAt(trashed.at)}
              </span>
              <span className="shrink-0 whitespace-pre"> · </span>
              <span
                className={cn('min-w-0 flex-1 truncate', trashed.by?.includes('@') && 'font-shell-mono')}
                title={trashed.by ?? 'không rõ'}
              >
                {trashed.by ?? 'không rõ'}
              </span>
            </p>
            <p className="min-w-0 truncate text-mini text-shell-muted" title={asset.folder ?? 'Chưa phân loại'}>
              Thư mục cũ: {oldFolderLabel(asset.folder)}
            </p>
          </div>
        ) : (
          <>
            {/*
              Một control, không phải chip-rồi-mới-ra-dropdown: bản trước phải bấm chip
              để lộ ô chọn, rồi bấm ô chọn để mở danh sách — hai cú bấm cho một việc.
              `-mx-2` để chữ trong ô thẳng hàng với tên file bên trên.
            */}
            <div className="-mx-2 mt-auto pt-1">
              <FolderSelect
                folders={folders}
                value={asset.folder}
                disabled={busy}
                quiet
                onPick={(folder) => onMove(asset.id, folder)}
              />
            </div>
            {inUse ? (
              <p className="truncate text-mini text-shell-muted" title={usedByLabel(asset)}>
                Dùng ở {usedByLabel(asset)}
              </p>
            ) : (
              /*
                Chip nhạt, không phải chip đặc màu cảnh báo, và nằm dưới ảnh chứ không
                đè lên ảnh. "Chưa dùng" là một dữ kiện để cân nhắc, không phải một lỗi
                cần xử lý — một chip cam đặc trên bốn thẻ hút mắt mạnh hơn chính những
                cái ảnh, tức nó đảo đúng thứ tự ưu tiên của trang.
              */
              <span>
                <Badge tone="warn" size="sm" title="Chưa trang nào dùng file này">
                  chưa dùng
                </Badge>
              </span>
            )}
          </>
        )}
      </div>
    </li>
  );
}
