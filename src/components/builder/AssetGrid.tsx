'use client';

/**
 * Thư viện: điều phối panel thư mục, tải lên, lưới thư mục con + lưới file, thanh
 * chọn nhiều và các hộp thoại.
 *
 * File này giữ TRẠNG THÁI và gọi API; phần vẽ nằm ở `components/builder/asset/*`.
 * Ranh giới đó có lý do cụ thể: kéo-thả cần biết ảnh nào đang được chọn, mà vùng
 * chọn thì thuộc lưới còn bãi thả thuộc cây — hai thành phần chị em không nói
 * chuyện với nhau được, nên state phải ở đúng một cấp trên cả hai.
 *
 * ## Vì sao tải lên đi qua `/api/assets` chứ không có đường riêng
 *
 * Đó là đúng endpoint mà tool MCP `upload_asset` dùng. Một đường ghi duy nhất nghĩa
 * là luật khoá-theo-nội-dung, phép dò kiểu từ magic bytes, và trần 10 MB chỉ tồn tại
 * một bản. Thêm đường thứ hai là mời chúng trôi khỏi nhau.
 *
 * ## Vì sao hiện "đang dùng ở đâu" ngay trên thẻ
 *
 * Người dùng mở trang này để quyết định: thay ảnh nào, ảnh nào bỏ được. Con số đó là
 * dữ kiện của quyết định ấy, nên nó phải ở nơi mắt nhìn tới trước — không phải sau
 * một cú bấm.
 *
 * ## Thư mục và "đang dùng ở đâu" trả lời hai câu khác nhau
 *
 * Thư mục là chỗ người dùng XẾP; usage là chỗ hệ thống BIẾT. Một ảnh dùng ở ba
 * trang chỉ nằm được trong một thư mục, nên nếu chỉ có thư mục thì câu "ảnh này
 * còn ai dùng không" vẫn không trả lời được. Giữ cả hai, và không để cái này giả
 * vờ làm cái kia.
 *
 * ## Thùng rác là một phạm vi, không phải một bộ lọc
 *
 * `?trash=1` (prop `inTrash`) là một địa chỉ riêng như `?folder=`: chia sẻ được, F5/Back
 * chạy đúng. Trong đó bộ lọc dùng/chưa dùng và bãi thả tải lên tắt (ảnh trong rác không
 * được tính là dùng, và không tải vào rác). Thao tác (xoá mềm, khôi phục, xoá hoàn toàn)
 * nằm ở `useAssetTrash`; file này chỉ nối chúng vào thẻ, thanh chọn và hộp xác nhận.
 *
 * ## Vì sao đổi thư mục đi qua URL chứ không phải state
 *
 * `?folder=` làm mỗi thư mục thành một địa chỉ: chia sẻ được, F5 không mất, nút Back
 * chạy đúng. Lọc bằng `useState` thì cả ba thứ đó đều mất, và không đổi lại được
 * lượt truy vấn nào — dữ liệu vẫn phải lấy từ server.
 *
 * ## Màn mặc định là GỐC của Thư viện
 *
 * `/builder/assets` (phạm vi "Chưa phân loại", xem `page.tsx`) vẽ như thư mục gốc của
 * một trình quản lý file: tiêu đề "Thư viện", các thư mục cấp gốc thành thẻ, rồi file
 * chưa có thư mục. Thẻ thư mục ở đó vừa là đường vào vừa là bãi thả — đúng chỗ người
 * dùng cần khi họ mở trang để xếp file mới tải lên.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';

import { AssetBulkBar } from './asset/AssetBulkBar';
import { AssetCard } from './asset/AssetCard';
import { AssetFolderCard } from './asset/AssetFolderCard';
import { AssetFolderTree, folderMenu, useFolderDrop } from './asset/AssetFolderTree';
import { AssetNote, type AssetNoteData } from './asset/AssetNote';
import { AssetPager } from './asset/AssetPager';
import { AssetTrashDialog } from './asset/AssetTrashDialog';
import { AssetTrashPager } from './asset/AssetTrashPager';
import { AssetDropArea, AssetUploadButton } from './asset/AssetUploadBox';
import { FolderDeleteDialog, FolderNameDialog, type FolderEdit } from './asset/FolderDialogs';
import {
  human,
  scopeHref,
  trashHref,
  type AssetItem,
  type FolderItem,
  type Scope,
  type TrashMeta,
} from './asset/types';
import { useAssetTrash } from './asset/useAssetTrash';
import { Button } from './ui/Button';
import { SearchField } from './ui/Field';
import { Icon } from './ui/Icon';
import { EmptyState, PageHeader, Section, type Crumb } from './ui/Page';
import { Tabs } from './ui/Tabs';

export type { AssetItem, FolderItem, Scope } from './asset/types';

type UsedTab = 'all' | 'used' | 'unused';

/**
 * Lời dặn ở chân panel thư mục.
 *
 * Cảnh báo về hợp đồng, không phải trang trí. File tải lên nằm trong BẢN NHÁP theo
 * nghĩa "chưa release nào chụp nó", nhưng object trên S3 thì đã ghi thật; chỉ Xoá hoàn
 * toàn (admin, hai bước) mới gỡ nó. Người dùng cần biết sự khác biệt đó TRƯỚC khi tải
 * — nên nó nằm ngay dưới nút tải lên, không phải ở một trang trợ giúp.
 */
function LibraryNote() {
  return (
    <div className={cn(ui.inset, 'flex flex-col gap-2 p-3.5 text-mini leading-relaxed text-shell-muted')}>
      <p>
        File tải lên chưa xuất hiện trên site thật cho tới lần <b className="font-semibold text-shell-ink">Publish</b>{' '}
        tiếp theo. Xoá chỉ chuyển file vào Thùng rác (lấy lại được); file trên máy chủ chỉ mất khi admin chọn Xoá
        hoàn toàn — và release cũ có thể vẫn đang trỏ tới nó.
      </p>
      <p>
        Nhận ảnh (PNG, JPEG, SVG), PDF, video (MP4, WebM), âm thanh (MP3, WAV, OGG) và font (WOFF, WOFF2), tối đa
        10 MB. Kiểu file đọc từ nội dung, không từ đuôi tên — docx, xlsx, zip và HTML chưa nhận.
      </p>
      <p>Kéo file thả vào thư mục để dời. Kéo file từ máy thả vào thư mục để tải thẳng vào đó.</p>
    </div>
  );
}

export function AssetGrid({
  assets,
  folders,
  unfiled,
  all,
  scope,
  q,
  used,
  canRename,
  page,
  pageSize,
  total,
  totalBytes,
  unused,
  inTrash,
  trashCount,
  trashMeta,
  canWrite,
  canPurge,
}: {
  /** Chỉ ảnh của trang đang xem — `total` mới là cả phạm vi. */
  assets: AssetItem[];
  folders: FolderItem[];
  unfiled: number;
  all: number;
  scope: Scope;
  /** Ô tìm đang gõ gì — lọc theo `key` (tên file đã slug hoá). */
  q: string;
  /** `undefined` = mọi trạng thái dùng. */
  used: 'used' | 'unused' | undefined;
  /** Người đang đăng nhập có phải admin không — đổi tên thư mục đòi quyền đó. */
  canRename: boolean;
  page: number;
  pageSize: number;
  total: number;
  /** Dung lượng của cả phạm vi đang lọc (không phải của trang). */
  totalBytes: number;
  /** Số file chưa dùng ở đâu trong phạm vi thư mục + tìm kiếm, KHÔNG áp bộ lọc dùng. */
  unused: number;
  /** Đang ở màn thùng rác (`?trash=1`): `assets` là ảnh trong rác, `total` là số ảnh rác. */
  inTrash: boolean;
  /** Số ảnh trong thùng rác (cả kho) — con số ở cây thư mục. */
  trashCount: number;
  /** Chỉ có ở màn rác: ai xoá, lúc nào, theo id ảnh. */
  trashMeta: Record<string, TrashMeta>;
  /** Editor/admin: được xoá (vào rác) và khôi phục. Viewer không thấy nút. */
  canWrite: boolean;
  /** Admin: được Xoá hoàn toàn và Dọn sạch. */
  canPurge: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [noteData, setNoteData] = useState<AssetNoteData | null>(null);
  /** Chuỗi trơn = thông báo thường (tông ok); lỗi/cảnh báo truyền `AssetNoteData`. */
  const setNote = (n: string | AssetNoteData | null) =>
    setNoteData(typeof n === 'string' ? { tone: 'ok', text: n } : n);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [qInput, setQInput] = useState(q);
  const [folderEdit, setFolderEdit] = useState<FolderEdit | null>(null);
  const [folderDelete, setFolderDelete] = useState<FolderItem | null>(null);
  /** Ô vừa bấm, để Shift+bấm chọn được cả dải. */
  const anchor = useRef<string | null>(null);

  /*
   * Điểm DUY NHẤT điều hướng của màn này — mọi thứ đi qua đây để `q`/`used` đang mở
   * luôn theo cùng, trừ khi patch nói khác. Thiếu bước này, đổi thư mục hay đổi
   * trang sẽ âm thầm xoá bộ lọc người dùng vừa đặt (xem docblock `scopeHref`).
   */
  function go(patch: { scope?: Scope; q?: string; used?: 'used' | 'unused' }) {
    const nextScope = 'scope' in patch ? patch.scope : scope;
    const nextQ = 'q' in patch ? patch.q : q;
    const nextUsed = 'used' in patch ? patch.used : used;
    // Đang ở rác mà chỉ đổi `q`/trang thì ở lại rác; đổi `scope` là rời rác.
    if (inTrash && !('scope' in patch)) {
      router.push(trashHref({ size: pageSize, q: nextQ }));
      return;
    }
    router.push(scopeHref(nextScope, { size: pageSize, q: nextQ, used: nextUsed }));
  }

  const trash = useAssetTrash({
    assets,
    busy,
    setBusy,
    setNote,
    clearSelection: () => setSelected(new Set()),
  });

  /*
   * Vùng chọn phải bỏ đi khi danh sách ảnh đổi (dời xong, đổi thư mục, tải thêm).
   * Giữ lại là để một thanh "5 file đã chọn" trỏ tới những ảnh không còn trên màn
   * hình, và cú dời tiếp theo sẽ đụng thứ người dùng không nhìn thấy.
   */
  useEffect(() => setSelected(new Set()), [assets]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelected(new Set());
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggle = useCallback(
    (id: string, range: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (range && anchor.current) {
          const from = assets.findIndex((a) => a.id === anchor.current);
          const to = assets.findIndex((a) => a.id === id);
          if (from !== -1 && to !== -1) {
            for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) {
              next.add(assets[i]!.id);
            }
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
    },
    [assets],
  );

  /**
   * Kéo một ảnh trong vùng chọn = kéo cả vùng chọn; kéo ảnh ngoài vùng chọn = chỉ
   * kéo nó. Quy ước của mọi trình quản lý file.
   */
  const dragIds = useCallback(
    (id: string) => (selected.has(id) ? [...selected] : [id]),
    [selected],
  );

  async function upload(files: FileList | File[], folder: string | null) {
    setBusy(true);
    setNote(null);

    const results: string[] = [];
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('file', file);
      if (folder) form.append('folder', folder);

      const res = await fetch('/api/assets', { method: 'POST', body: form });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        asset?: { key: string; reused: boolean; restored?: boolean };
      };

      if (!res.ok || !json.ok) {
        results.push(`${file.name}: ${json.error ?? res.status}`);
      } else if (json.asset?.restored) {
        // Upload trùng một ảnh đang ở thùng rác thì server khôi phục nó — nói ra, vì
        // người dùng không thấy ảnh "mới" mà thấy nó hiện lại ở thư mục cũ.
        results.push(`${file.name}: đã có trong thùng rác, đã khôi phục`);
      } else if (json.asset?.reused) {
        // Nói ra thay vì im lặng: người dùng vừa tải một file đã có, và nếu không
        // báo thì họ sẽ tưởng có hai bản và đi tìm bản thừa. Thêm một điều nữa phải
        // nói: ảnh cũ KHÔNG bị dời sang thư mục đích — xem `uploadAsset`.
        results.push(`${file.name}: đã có sẵn, giữ nguyên thư mục cũ`);
      } else {
        results.push(`${file.name}: xong`);
      }
    }

    setNote(results.join(' · '));
    setBusy(false);

    /*
     * Về trang 1 sau khi tải lên. Lưới xếp mới-nhất-trước, nên file vừa tải nằm ở
     * đầu trang 1 — đứng ở trang 4 mà `refresh()` thì người dùng thấy đúng lưới cũ
     * kèm một dòng "xong", và không có gì trên màn hình xác nhận file đã vào kho.
     */
    if (page > 1) go({});
    router.refresh();
  }

  /**
   * Dời một lô ảnh.
   *
   * Luôn đi qua endpoint hàng loạt, kể cả khi lô có một ảnh: một đường ghi thì luật
   * transaction và dòng nhật ký chỉ có một bản. `PATCH /api/assets/[id]` vẫn còn cho
   * MCP, nhưng giao diện không dùng nó nữa.
   */
  async function move(ids: string[], folder: string | null) {
    if (!ids.length) return;
    setBusy(true);
    const res = await fetch('/api/assets/move', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, folder }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; moved?: number };
    setNote(
      res.ok && json.ok
        ? `Đã dời ${json.moved} file vào ${folder ?? 'Chưa phân loại'}`
        : `Dời không được: ${json.error ?? res.status}`,
    );
    setBusy(false);
    setSelected(new Set());
    router.refresh();
  }

  async function createFolder(path: string) {
    setBusy(true);
    const res = await fetch('/api/assets/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; path?: string };
    setBusy(false);

    if (!res.ok || !json.ok) {
      setNote(`Không tạo được thư mục: ${json.error ?? res.status}`);
      return;
    }

    /*
     * Điều hướng vào thư mục vừa tạo, và dùng đường dẫn ĐÃ CHUẨN HOÁ mà server trả
     * về: người dùng gõ "Trang chủ", thư mục thật tên `trang-chu`, và đi tới cái họ
     * gõ sẽ ra một thư mục rỗng khác.
     */
    setNote(`Đã tạo thư mục ${json.path}`);
    go({ scope: json.path! });
    router.refresh();
  }

  async function renameFolder(from: string, to: string) {
    if (from === to) return;
    setBusy(true);
    const res = await fetch('/api/assets/folders', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; moved?: number };
    setBusy(false);

    if (!res.ok || !json.ok) {
      setNote(`Không đổi tên được: ${json.error ?? res.status}`);
      return;
    }

    setNote(`Đã đổi tên thành ${to} (${json.moved} file)`);
    // Đang đứng trong nhánh vừa đổi tên thì URL cũ trỏ vào hư không — đi theo nó.
    if (scope === from || (typeof scope === 'string' && scope.startsWith(`${from}/`))) {
      go({ scope: to + scope.slice(from.length) });
    }
    router.refresh();
  }

  /** Chạy sau khi người dùng xác nhận ở `FolderDeleteDialog`. */
  async function deleteFolder(folder: FolderItem) {
    setBusy(true);
    const res = await fetch(`/api/assets/folders?path=${encodeURIComponent(folder.path)}`, {
      method: 'DELETE',
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; moved?: number };
    setBusy(false);
    setFolderDelete(null);

    if (!res.ok || !json.ok) {
      setNote(`Không xoá được: ${json.error ?? res.status}`);
      return;
    }

    setNote(
      json.moved
        ? `Đã xoá thư mục — ${json.moved} file về Chưa phân loại`
        : 'Đã xoá thư mục rỗng',
    );
    if (typeof scope === 'string' && (scope === folder.path || scope.startsWith(`${folder.path}/`))) {
      go({ scope: null });
    }
    router.refresh();
  }

  const cardDrop = useFolderDrop({
    onDropAssets: (ids, folder) => void move(ids, folder),
    onDropFiles: (files, folder) => void upload(files, folder),
  });
  const menuOpts = {
    canRename,
    busy,
    onNewFolder: (parent: string) => setFolderEdit({ mode: 'create', parent }),
    onRenameFolder: (f: FolderItem) => setFolderEdit({ mode: 'rename', folder: f }),
    onDelete: (f: FolderItem) => setFolderDelete(f),
  };

  /* ── Đầu trang: tiêu đề theo phạm vi, đường dẫn là các cấp CHA ───────────── */
  const current = typeof scope === 'string' ? folders.find((f) => f.path === scope) : undefined;
  const home: Crumb = { label: 'Thư viện', href: scopeHref(null, { size: pageSize, q, used }) };
  let title: string;
  let titleCount: number;
  let crumbs: Crumb[] = [];
  if (inTrash) {
    title = 'Thùng rác';
    titleCount = trashCount;
    crumbs = [home];
  } else if (scope === null) {
    title = 'Thư viện';
    titleCount = all;
  } else if (scope === undefined) {
    title = 'Tất cả file';
    titleCount = all;
    crumbs = [home];
  } else {
    const parts = scope.split('/');
    title = parts[parts.length - 1] ?? scope;
    titleCount = current?.total ?? total;
    crumbs = [
      home,
      ...parts.slice(0, -1).map((seg, i) => ({
        label: seg,
        href: scopeHref(parts.slice(0, i + 1).join('/'), { size: pageSize, q, used }),
      })),
    ];
  }

  /* ── Thư mục con của phạm vi đang xem (gốc của Thư viện ở màn mặc định) ─── */
  const childFolders = inTrash
    ? []
    : scope === null
      ? folders.filter((f) => f.depth === 0)
      : current
        ? folders.filter((f) => f.depth === current.depth + 1 && f.path.startsWith(`${current.path}/`))
        : [];
  const directChildren = (f: FolderItem) =>
    folders.filter((c) => c.depth === f.depth + 1 && c.path.startsWith(`${f.path}/`)).length;

  /*
   * Số đếm của bộ lọc dùng/chưa dùng. `unused` luôn tính trên phạm vi thư mục + tìm
   * kiếm (không áp bộ lọc), `total` thì CÓ áp — nên "Mọi trạng thái" ở tab "Chưa dùng"
   * chỉ suy được từ số của cây, và số đó không biết gì về ô tìm. Không suy được thì
   * không ghi số, thay vì ghi một số sai.
   */
  const treeCount = scope === undefined ? all : scope === null ? unfiled : (current?.total ?? undefined);
  const scopeAll =
    used === undefined ? total : used === 'used' ? total + unused : q ? undefined : treeCount;
  const usedTabs = [
    { id: 'all' as const, label: 'Mọi trạng thái', count: scopeAll },
    { id: 'used' as const, label: 'Đang dùng', count: scopeAll === undefined ? undefined : scopeAll - unused },
    { id: 'unused' as const, label: 'Chưa dùng', count: unused },
  ];

  const filesTitle = scope === null ? 'Chưa phân loại' : scope === undefined ? 'Mọi file' : 'File';
  const filesDescription = [
    total > 0 ? human(totalBytes) : null,
    current && childFolders.length > 0 ? 'gồm cả file trong thư mục con' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const clearFilters = () => {
    setQInput('');
    go({ q: '', used: undefined });
  };

  const empty =
    /*
       Trang rỗng mà kho KHÔNG rỗng là một trạng thái riêng, không phải "chưa có
       file nào". Nó xảy ra thật: đang ở trang 4 rồi dời hết ảnh sang thư mục
       khác, hoặc mở một link `?page=9` cũ. Nói "thư mục này chưa có file nào" ở
       đó là một câu sai, và người dùng không có đường nào để ra.
    */
    inTrash && total === 0 ? (
      q ? (
        <EmptyState
          icon="search"
          title={`Không có ảnh nào khớp “${q}” trong thùng rác`}
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Bỏ tìm
            </Button>
          }
        />
      ) : (
        <EmptyState icon="trash" title="Thùng rác trống" description="Ảnh bạn xoá sẽ nằm ở đây để khôi phục khi cần." />
      )
    ) : total > 0 ? (
      <EmptyState
        icon="info"
        title={`Trang ${page} không còn file nào`}
        description={`${total} file nằm ở các trang trước.`}
        action={
          <Button variant="secondary" onClick={() => go({})}>
            Về trang 1
          </Button>
        }
      />
    ) : q || used ? (
      <EmptyState
        icon="search"
        title="Không có file nào khớp bộ lọc"
        action={
          <Button variant="secondary" onClick={clearFilters}>
            Bỏ lọc
          </Button>
        }
      />
    ) : scope === undefined ? (
      <EmptyState
        icon="image"
        title="Thư viện chưa có file nào"
        description="Bấm Tải file lên, hoặc kéo file từ máy thả vào đây."
      />
    ) : scope === null ? (
      <EmptyState
        icon="check"
        title="Không còn file nào chưa phân loại"
        description="File tải lên mà chưa chọn thư mục sẽ nằm ở đây cho tới khi được xếp."
        compact={childFolders.length > 0}
      />
    ) : (
      <EmptyState
        icon="folder"
        title="Thư mục này chưa có file nào"
        description="Kéo file từ thư mục khác vào, hoặc tải lên."
        compact={childFolders.length > 0}
      />
    );

  const grid =
    assets.length === 0 ? (
      empty
    ) : (
      /* 190px theo lưới thẻ file của design system: tên đã bỏ đuôi băm (xem
         `displayName`) nên vừa thẻ; khoá đầy đủ vẫn ở `title`. */
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5">
        {assets.map((a) => (
          <AssetCard
            key={a.id}
            asset={a}
            folders={folders}
            selected={selected.has(a.id)}
            selectionActive={selected.size > 0}
            busy={busy}
            onToggle={toggle}
            onDragIds={dragIds}
            onMove={(id, folder) => void move([id], folder)}
            trashed={inTrash ? (trashMeta[a.id] ?? { at: '', by: null }) : undefined}
            onTrash={canWrite && !inTrash ? (id) => void trash.trash([id]) : undefined}
            onTrashBlocked={canWrite && !inTrash ? (id) => void trash.showUsage(id) : undefined}
            onRestore={canWrite && inTrash ? (id) => void trash.restore([id]) : undefined}
            onPurge={canPurge && inTrash ? (id) => trash.openPurge([id]) : undefined}
          />
        ))}
      </ul>
    );

  return (
    <div className="flex flex-wrap items-stretch gap-5">
      <aside aria-label="Thư mục" className="flex min-w-0 max-w-full flex-[1_1_16.5rem] flex-col">
        <AssetFolderTree
          folders={folders}
          unfiled={unfiled}
          all={all}
          scope={scope}
          busy={busy}
          canRename={canRename}
          trash={trashCount}
          inTrash={inTrash}
          onNavigate={(s) => go({ scope: s })}
          onDropAssets={(ids, folder) => void move(ids, folder)}
          onDropFiles={(files, folder) => void upload(files, folder)}
          onNewFolder={menuOpts.onNewFolder}
          onRenameFolder={menuOpts.onRenameFolder}
          onDelete={menuOpts.onDelete}
          header={
            <AssetUploadButton
              uploadFolder={!inTrash && typeof scope === 'string' ? scope : null}
              busy={busy}
              onFiles={(files, folder) => void upload(files, folder)}
            />
          }
          footer={<LibraryNote />}
        />
      </aside>

      <div className="flex min-w-0 flex-[999_1_35rem] flex-col gap-6 py-1.5 md:px-2">
        <PageHeader
          title={title}
          count={`${titleCount} file`}
          crumbs={crumbs}
          actions={
            inTrash ? (
              canPurge && (
                <Button variant="danger" icon="trash" disabled={busy || total === 0} onClick={trash.openEmpty}>
                  Dọn sạch thùng rác
                </Button>
              )
            ) : (
              <Button
                variant="secondary"
                icon="folder-plus"
                disabled={busy}
                onClick={() => menuOpts.onNewFolder(typeof scope === 'string' ? scope : '')}
              >
                Thư mục mới
              </Button>
            )
          }
        />

        {/* ── Lọc theo trạng thái dùng · tìm theo tên ─────────────────────── */}
        <div className="flex flex-wrap items-center gap-2.5">
          {!inTrash && (
            <Tabs<UsedTab>
              label="Lọc theo trạng thái dùng"
              items={usedTabs}
              value={used ?? 'all'}
              onChange={(id) => go({ used: id === 'all' ? undefined : id })}
            />
          )}
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: qInput });
            }}
            className="ml-auto flex min-w-55 flex-[0_1_22rem] items-center gap-2"
          >
            <SearchField
              label={inTrash ? 'Tìm trong thùng rác' : 'Tìm file'}
              placeholder="Tìm theo tên file…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              wrapperClassName="flex-1"
            />
            {q && (
              <Button variant="ghost" onClick={clearFilters}>
                Bỏ tìm
              </Button>
            )}
          </form>
        </div>

        {inTrash && (
          <div role="note" className="flex items-center gap-2.5 rounded-lg bg-shell-warn-soft px-4 py-2.5 text-small">
            <Icon name="info" size={18} className="text-shell-warn" />
            {canPurge
              ? 'Ảnh ở đây không hiện trong thư viện nhưng vẫn nằm trên máy chủ. Xoá hoàn toàn là mất vĩnh viễn, không hoàn tác.'
              : 'Ảnh ở đây không hiện trong thư viện. Khôi phục để dùng lại. Chỉ admin xoá hoàn toàn được.'}
          </div>
        )}

        {/*
          Đóng được bằng tay, KHÔNG tự tắt theo hẹn giờ.

          Note ở đây mang kết quả một thao tác ghi — "3 ảnh vào trang-chu", hoặc một
          câu lỗi. Cho nó tự biến mất sau 4 giây là để người dùng vừa rời mắt đi mất
          luôn thông tin duy nhất nói cho họ biết thao tác vừa rồi có chạy hay không.
        */}
        {noteData && (
          <AssetNote
            note={noteData}
            busy={busy}
            onClose={() => setNote(null)}
            onUndo={canWrite ? (ids) => void trash.restore(ids) : undefined}
            onRetryS3={canPurge ? (keys) => void trash.retryS3(keys) : undefined}
          />
        )}

        <AssetBulkBar
          count={selected.size}
          total={assets.length}
          folders={folders}
          busy={busy}
          mode={inTrash ? 'trash' : 'library'}
          canPurge={canPurge}
          onMove={inTrash ? undefined : (folder) => void move([...selected], folder)}
          onTrash={canWrite && !inTrash ? () => void trash.trash([...selected]) : undefined}
          onRestore={canWrite && inTrash ? () => void trash.restore([...selected]) : undefined}
          onPurge={canPurge && inTrash ? () => trash.openPurge([...selected]) : undefined}
          onSelectAll={() => setSelected(new Set(assets.map((a) => a.id)))}
          onClear={() => setSelected(new Set())}
        />

        <AssetDropArea
          uploadFolder={typeof scope === 'string' ? scope : null}
          onFiles={(files, folder) => void upload(files, folder)}
          disabled={inTrash}
          className="flex flex-col gap-8"
        >
          {childFolders.length > 0 && (
            <Section title="Thư mục" count={childFolders.length}>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5">
                {childFolders.map((f) => (
                  <AssetFolderCard
                    key={f.path}
                    folder={f}
                    subfolders={directChildren(f)}
                    onOpen={() => go({ scope: f.path })}
                    drop={cardDrop(f.path)}
                    menu={folderMenu(f, menuOpts)}
                  />
                ))}
              </ul>
            </Section>
          )}

          {inTrash ? (
            grid
          ) : (
            <Section
              title={filesTitle}
              count={total}
              description={filesDescription || undefined}
              className={cn(childFolders.length > 0 && 'border-t border-shell-line pt-6')}
            >
              {grid}
            </Section>
          )}
        </AssetDropArea>

        {total > 0 && inTrash && (
          <AssetTrashPager q={q} page={page} pageSize={pageSize} total={total} shown={assets.length} />
        )}
        {total > 0 && !inTrash && (
          <AssetPager
            scope={scope}
            q={q}
            used={used}
            page={page}
            pageSize={pageSize}
            total={total}
            shown={assets.length}
          />
        )}
      </div>

      <FolderNameDialog
        edit={folderEdit}
        busy={busy}
        onClose={() => setFolderEdit(null)}
        onCreate={(path) => void createFolder(path)}
        onRename={(from, to) => void renameFolder(from, to)}
      />
      <FolderDeleteDialog
        folder={folderDelete}
        subfolders={folderDelete ? folders.filter((c) => c.path.startsWith(`${folderDelete.path}/`)).length : 0}
        busy={busy}
        onClose={() => setFolderDelete(null)}
        onConfirm={(f) => void deleteFolder(f)}
      />
      {trash.dialog && (
        <AssetTrashDialog
          mode={trash.dialog.mode}
          ids={trash.dialog.mode === 'purge-selected' ? trash.dialog.ids : undefined}
          onClose={trash.closeDialog}
          onDone={trash.onDialogDone}
        />
      )}
    </div>
  );
}
