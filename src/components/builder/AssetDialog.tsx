'use client';

/**
 * Chọn một ảnh trong kho, hoặc tải lên ảnh mới — trong một `<dialog>` giữa màn.
 *
 * ## Vì sao là modal, khác với hai bộ chọn kia
 *
 * `NodeAssetPicker` cố ý KHÔNG phải modal, vì nó gắn ảnh cho một node đang chọn và
 * modal sẽ che mất canvas — thứ người dùng cần nhìn để biết ảnh nào hợp. Ở đây
 * không có canvas nào để che: nền là một form cài đặt tĩnh, và việc đang làm là
 * "duyệt cả kho ảnh", cần chỗ rộng hơn một popover.
 *
 * ## Vì sao tab "Tải lên" KHÔNG phải đường ghi thứ hai
 *
 * Nó POST đúng `/api/assets` mà `AssetGrid` và tool MCP `upload_asset` đang
 * dùng. Luật khoá-theo-nội-dung, phép dò kiểu từ magic bytes và trần 10 MB vẫn
 * chỉ tồn tại một bản ở `uploadAsset`. Cái bị cấm là một *endpoint* thứ hai, chứ
 * không phải một nút thứ hai — và bắt người dùng rời trang Cài đặt, sang Ảnh,
 * tải file, chép id, quay lại dán, là bắt họ làm thủ công đúng việc mà cái nút
 * này làm bằng một request.
 *
 * ## Vì sao lọc theo mime NGAY TRONG LƯỚI
 *
 * Favicon chỉ nhận PNG/SVG. Hiện cả kho rồi để `updateSiteSettings` từ chối lúc
 * bấm Lưu nghĩa là người dùng đi hết một vòng để biết một điều lẽ ra thấy ngay
 * lúc nhìn. Nhưng lưới cũng NÓI RA số ảnh bị ẩn — một lưới trống không giải
 * thích thì người ta sẽ tưởng kho rỗng và đi tải lại ảnh đã có.
 *
 * ## Vì sao `<dialog>` thật
 *
 * Esc đóng, focus bị bẫy bên trong, nền bị chặn tương tác — cả ba là hành vi có
 * sẵn của thẻ, và cả ba là thứ một `div` với `position: fixed` phải viết tay rồi
 * viết sai. Cùng lý do đã ghi ở `PageHistory` và `PageRename`.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { extOf } from '@/lib/assets/kind';
import { invalidateAssets } from '@/lib/builder/asset-cache';
import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { AssetThumb } from './asset/AssetThumb';
import { displayName, extLabel } from './asset/types';
import { Button, IconButton } from './ui/Button';
import { SearchField, SelectField } from './ui/Field';
import { Icon } from './ui/Icon';
import { Skeleton } from './ui/Skeleton';
import { Tabs } from './ui/Tabs';

export interface DialogAsset {
  id: string;
  key: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  folder: string | null;
}

interface FolderNode {
  path: string;
  name: string;
  depth: number;
  total: number;
}

type Tab = 'pick' | 'upload';

export function AssetDialog({
  open,
  onClose,
  value,
  onPick,
  mimes,
  mimeLabel,
  accept,
  title = 'Chọn ảnh',
}: {
  open: boolean;
  onClose: () => void;
  /** Id ảnh đang chọn, để đánh dấu trong lưới. */
  value: string | null;
  onPick: (asset: DialogAsset) => void;
  /** Chỉ hiện những mime này. Bỏ trống = nhận mọi thứ trong kho. */
  mimes?: ReadonlySet<string>;
  /** Cách gọi bộ mime đó trong câu thông báo, ví dụ "PNG hoặc SVG". */
  mimeLabel?: string;
  /** Gợi ý cho hộp thoại chọn file của hệ điều hành. */
  accept?: string;
  title?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('pick');
  const [assets, setAssets] = useState<DialogAsset[] | null>(null);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  /*
   * `showModal()` phải gọi bằng tay, không đặt thuộc tính `open`.
   *
   * `<dialog open>` render một dialog KHÔNG modal: không backdrop, không bẫy
   * focus, Esc không đóng. Nó trông giống nhưng hành xử khác, và khác đúng ở ba
   * thứ là lý do dùng thẻ này.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Esc và `close()` của trình duyệt không đi qua React — không đồng bộ ngược về
  // state thì lần bấm mở tiếp theo không làm gì cả, vì state vẫn đang là `open`.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCloseEvent = () => onClose();
    el.addEventListener('close', onCloseEvent);
    return () => el.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [aRes, fRes] = await Promise.all([
        fetch('/api/assets'),
        fetch('/api/assets/folders'),
      ]);
      const aJson = (await aRes.json()) as { assets?: DialogAsset[]; error?: string };
      if (!aRes.ok) throw new Error(aJson.error ?? `Lỗi ${aRes.status}`);
      setAssets(aJson.assets ?? []);

      // Cây thư mục hỏng thì lưới vẫn dùng được — chỉ mất bộ lọc. Không để nó kéo
      // theo cả dialog.
      if (fRes.ok) {
        const fJson = (await fRes.json()) as { folders?: FolderNode[] };
        setFolders(fJson.folders ?? []);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  // Nạp LÚC MỞ, không lúc mount: form Cài đặt dựng dialog này ngay cả khi không ai
  // bấm vào nó.
  useEffect(() => {
    if (!open || assets) return;
    void load();
  }, [open, assets, load]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;

    /*
     * Chặn mime sai NGAY Ở CLIENT, trước khi tốn một round-trip.
     *
     * Không phải để thay phép kiểm ở server — `uploadAsset` vẫn dò magic bytes, và
     * `file.type` là thứ trình duyệt đoán từ đuôi file nên không tin được. Đây chỉ
     * là để câu "JPEG không làm favicon được" đến ngay lúc chọn file, thay vì sau
     * khi tải xong 4 MB.
     */
    const file = list[0]!;
    if (mimes && file.type && !mimes.has(file.type)) {
      setError(`“${file.name}” là ${file.type}. Favicon cần ${mimeLabel ?? 'đúng kiểu ảnh'}.`);
      return;
    }

    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/assets', { method: 'POST', body: form });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        asset?: DialogAsset & { reused: boolean };
      };
      if (!res.ok || !json.ok || !json.asset) {
        throw new Error(json.error ?? `Lỗi ${res.status}`);
      }

      // Server có thể trả về một ảnh ĐÃ CÓ (cùng nội dung, khoá theo hash). Chọn
      // luôn nó là đúng ý người dùng — họ vừa chỉ vào file này.
      /*
       * Kho vừa có thêm một file, nên bản cache phía client đã cũ.
       *
       * `AssetField` và `NodeAssetPicker` chia nhau một promise (xem
       * `lib/builder/asset-cache.ts`). Không xoá ở đây thì người dùng tải một ảnh lên
       * từ dialog favicon rồi mở ô chọn ảnh ở chỗ khác trong cùng phiên — và ảnh vừa
       * tải KHÔNG có trong danh sách, không một dòng nào giải thích.
       */
      invalidateAssets();

      const picked = json.asset;
      setAssets((all) => {
        if (!all) return all;
        return all.some((a) => a.id === picked.id) ? all : [picked, ...all];
      });
      onPick(picked);
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const all = assets ?? [];
  const inFolder = all.filter((a) => {
    if (folder === null) return true;
    return a.folder === folder || a.folder?.startsWith(`${folder}/`);
  });
  const eligible = mimes ? inFolder.filter((a) => mimes.has(a.mime)) : inFolder;
  const hiddenByMime = inFolder.length - eligible.length;

  const q = query.trim().toLowerCase();
  const shown = q ? eligible.filter((a) => a.key.toLowerCase().includes(q)) : eligible;

  const folderOptions = [
    { value: '', label: 'Tất cả thư mục' },
    ...folders.map((f) => ({ value: f.path, label: `${'— '.repeat(f.depth)}${f.name} (${f.total})` })),
  ];

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${uid}-t`}
      // Bấm ra nền thì đóng. `event.target` là chính thẻ `<dialog>` chỉ khi cú bấm
      // rơi vào vùng backdrop — bấm vào ruột dialog cho ra một thẻ con.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(ui.dialog, 'w-[min(56rem,94vw)]')}
    >
      <div className="flex max-h-[82vh] flex-col">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-shell-line px-6 py-4">
          <h2 id={`${uid}-t`} className="text-section font-semibold">
            {title}
          </h2>
          <Tabs<Tab>
            label="Nguồn file"
            items={[
              { id: 'pick', label: 'Kho ảnh' },
              { id: 'upload', label: 'Tải lên' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <IconButton icon="x" label="Đóng" onClick={onClose} className="ml-auto" />
        </div>

        {error && (
          <p role="alert" className="border-b border-shell-line bg-shell-danger-soft px-6 py-2.5 text-small text-shell-danger">
            {error}
          </p>
        )}
        {note && <p className="border-b border-shell-line px-6 py-2.5 text-small text-shell-muted">{note}</p>}

        {tab === 'pick' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-shell-line px-6 py-3">
              <SearchField
                label="Tìm theo tên tệp"
                placeholder="Tìm theo tên tệp"
                size="md"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                wrapperClassName="w-60"
              />
              <SelectField
                label="Thư mục"
                hideLabel
                size="md"
                value={folder ?? ''}
                onChange={(e) => setFolder(e.target.value || null)}
                options={folderOptions}
                wrapperClassName="w-56"
              />
              <span className="ml-auto text-small text-shell-muted tabular-nums">{shown.length} ảnh</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {assets === null ? (
                // Khung đúng hình thẻ bên dưới (ảnh h-22 + tên + dòng phụ), để lưới thật
                // hiện ra đúng chỗ của nó thay vì đẩy một dòng chữ đi.
                <ul aria-busy="true" aria-label="Đang tải kho" className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
                  {Array.from({ length: 10 }, (_, i) => (
                    <li key={i} className="flex flex-col gap-2 p-1.5">
                      <Skeleton className="h-22" />
                      <span className="flex flex-col gap-1.5 px-1 pb-0.5">
                        <Skeleton className="h-3.5 w-4/5" />
                        <Skeleton className="h-3 w-1/2" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : shown.length === 0 ? (
                <p className="py-10 text-center text-ui text-shell-muted">
                  {hiddenByMime > 0
                    ? `Không có ảnh ${mimeLabel} nào ở đây.`
                    : 'Kho chưa có ảnh nào khớp.'}
                </p>
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
                  {shown.map((a) => {
                    const on = a.id === value;
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            onPick(a);
                            onClose();
                          }}
                          className={cn(
                            'flex w-full flex-col gap-2 rounded-md border-2 p-1.5 text-left transition-colors',
                            focusRing,
                            on
                              ? 'border-shell-accent bg-shell-accent-soft'
                              : 'border-transparent hover:bg-shell-raised',
                          )}
                        >
                          <span className="block h-22 overflow-hidden rounded bg-shell-raised">
                            <AssetThumb mime={a.mime} assetKey={a.key} url={a.url} lazy sheet="sm" className="size-full" />
                          </span>
                          <span className="flex min-w-0 flex-col gap-0.5 px-1 pb-0.5">
                            <span className="block truncate text-small font-semibold" title={a.key}>
                              {displayName(a.key)}
                            </span>
                            <span className="block truncate text-mini text-shell-muted">
                              {extLabel(extOf(a.key)) || a.mime}
                              {a.width && a.height ? (
                                <>
                                  {' · '}
                                  <span className="font-shell-mono">
                                    {a.width}×{a.height}
                                  </span>
                                </>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/*
                Nói ra số ảnh bị ẩn. Một lưới thiếu ảnh mà không giải thích sẽ làm
                người dùng tưởng kho rỗng, rồi đi tải lại đúng file đã có.
              */}
              {hiddenByMime > 0 && (
                <p className="mt-4 text-small text-shell-muted">
                  {hiddenByMime} ảnh khác bị ẩn vì không phải {mimeLabel}.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="px-6 py-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void upload(e.dataTransfer.files);
              }}
              className={cn(
                'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
                dragging ? 'border-shell-accent bg-shell-accent-soft' : 'border-shell-line-strong',
              )}
            >
              <span className="grid size-14 place-items-center rounded-md bg-shell-accent-soft text-shell-accent">
                <Icon name="upload" size={26} />
              </span>
              <p className="text-ui">Kéo ảnh vào đây, hoặc</p>
              <Button variant="primary" loading={busy} onClick={() => fileRef.current?.click()}>
                {busy ? 'Đang tải…' : 'Chọn tệp'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept={accept}
                hidden
                onChange={(e) => e.target.files && void upload(e.target.files)}
              />
              {mimeLabel && (
                <p className="max-w-[46ch] text-small leading-relaxed text-shell-muted">
                  Chỉ nhận {mimeLabel}, tối đa 10 MB. Tải xong là ảnh được chọn luôn.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
