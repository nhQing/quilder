'use client';

/**
 * Tải lên: nút "Tải file lên" ở đầu panel thư mục, và cả vùng nội dung là bãi thả.
 *
 * File rơi vào thư mục ĐANG XEM. Đó là điều người dùng chờ đợi khi họ mở một thư mục
 * rồi kéo file vào, và nó tiết kiệm đúng một thao tác cho ca thường gặp nhất. Ở "Tất
 * cả" hoặc "Chưa phân loại" thì không đoán gì cả.
 *
 * Muốn tải vào một thư mục KHÁC thư mục đang xem thì kéo file thả thẳng lên node đó
 * ở cây bên trái, hoặc lên thẻ thư mục trong lưới — xem `useFolderDrop`.
 *
 * ## Vì sao không còn ô tải lên giữa trang
 *
 * Tải file là việc thỉnh thoảng; duyệt kho là việc thường xuyên. Một ô tải lên đứng
 * thường trực trên lưới đẩy hàng ảnh đầu tiên xuống, tức thứ ít dùng nhất được ưu
 * tiên nhìn thấy nhất. Giờ bãi thả là CẢ vùng nội dung, và nó chỉ hiện ra khi có file
 * đang được kéo tới — đúng lúc nó cần thành một đích to.
 */

import { useRef, useState } from 'react';

import { UPLOAD_ACCEPT } from '@/lib/assets/kind';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';

import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { ASSET_DND_MIME } from './types';

/** Kéo FILE TỪ MÁY tới — không phải ảnh trong kho đang được kéo đi dời. */
function isFileDrag(dt: DataTransfer): boolean {
  return dt.types.includes('Files') && !dt.types.includes(ASSET_DND_MIME);
}

function Destination({ folder }: { folder: string | null }) {
  return folder ? <span className="font-shell-mono">{folder}</span> : <>Chưa phân loại</>;
}

export function AssetUploadButton({
  uploadFolder,
  busy,
  onFiles,
}: {
  /** Thư mục file sẽ rơi vào; `null` = chưa phân loại. */
  uploadFolder: string | null;
  busy: boolean;
  onFiles: (files: FileList, folder: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files, uploadFolder);
          e.target.value = '';
        }}
      />
      <Button variant="primary" icon="upload" full loading={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Đang xử lý…' : 'Tải file lên'}
      </Button>
      {/* Đích đến nói ra chỉ khi nó KHÁC mặc định. Một dòng "sẽ vào Chưa phân loại"
          hiện thường trực là chữ không mang tin. */}
      {uploadFolder && (
        <p className="truncate px-1 text-center text-mini text-shell-muted" title={uploadFolder}>
          Tải vào <Destination folder={uploadFolder} />
        </p>
      )}
    </div>
  );
}

/**
 * Bãi thả bao quanh vùng nội dung.
 *
 * Bãi con (thẻ thư mục, có `data-drop-target`) tự xử lý cú thả của nó; khi con trỏ
 * đang ở trên một bãi con thì lớp phủ của vùng này tắt, để không có hai đích cùng
 * sáng và nói hai điều khác nhau.
 */
export function AssetDropArea({
  uploadFolder,
  onFiles,
  disabled,
  className,
  children,
}: {
  uploadFolder: string | null;
  onFiles: (files: FileList, folder: string | null) => void;
  /** Thùng rác: không tải vào rác. */
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<'off' | 'zone' | 'child'>('off');

  if (disabled) return <div className={className}>{children}</div>;

  return (
    <div
      className={cn('relative', className)}
      onDragOverCapture={(e) => {
        if (!isFileDrag(e.dataTransfer)) return;
        const overChild = (e.target as Element | null)?.closest?.('[data-drop-target]');
        setState(overChild ? 'child' : 'zone');
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setState('off');
      }}
      onDropCapture={() => setState('off')}
      onDrop={(e) => {
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files, uploadFolder);
      }}
    >
      {children}
      {state === 'zone' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-40 rounded-xl border-2 border-dashed border-shell-accent bg-shell-accent-soft/70"
        >
          <div className="sticky top-1/3 flex justify-center pt-24">
            <p className={cn(ui.pop, 'inline-flex items-center gap-2.5 px-4 py-3 text-ui font-semibold')}>
              <Icon name="upload" size={18} className="text-shell-accent" />
              Thả để tải lên vào <Destination folder={uploadFolder} />
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
