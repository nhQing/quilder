'use client';

/**
 * Ô kéo thả file dùng chung: kéo file vào, hoặc bấm nút để mở hộp chọn file.
 *
 * Gốc của `ZipDropZone` (gói .zip, một file) và ô tải font (nhiều file). Input thật vẫn nằm
 * trong DOM (ẩn) để bàn phím, trình đọc màn hình và e2e (`setInputFiles`) dùng được.
 * Lọc loại file và lời nhắn "bỏ qua" là việc của nơi gọi (`filter`).
 */

import { useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';

import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

export function FileDropZone({
  onFiles,
  filter,
  accept,
  multiple,
  title,
  overTitle = 'Thả file vào đây',
  buttonLabel,
  inputLabel,
  data,
  className,
}: {
  onFiles: (files: File[]) => void;
  /** Tách file nhận được và lời nhắn cho phần bị bỏ; không truyền thì nhận hết. */
  filter?: (files: File[]) => { accepted: File[]; message?: string | null };
  accept?: string;
  multiple?: boolean;
  title: string;
  overTitle?: string;
  buttonLabel: string;
  inputLabel: string;
  /** Thuộc tính `data-*` gắn lên ô (selector cho test). */
  data?: Record<`data-${string}`, string>;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  const take = (list: FileList | null | undefined) => {
    const all = Array.from(list ?? []);
    if (all.length === 0) return;
    const { accepted, message } = filter ? filter(all) : { accepted: all, message: null };
    setWrong(message ?? null);
    if (accepted.length) onFiles(multiple ? accepted : accepted.slice(0, 1));
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        {...data}
        data-over={over || undefined}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          over ? 'border-shell-accent bg-shell-accent-soft/70' : 'border-shell-line',
          className,
        )}
      >
        <Icon name="upload" size={24} className={over ? 'text-shell-accent' : 'text-shell-muted'} />
        <p className="font-semibold">{over ? overTitle : title}</p>
        <p className="text-small text-shell-muted">hoặc</p>
        <Button variant="primary" icon="upload" onClick={() => input.current?.click()}>
          {buttonLabel}
        </Button>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          aria-label={inputLabel}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {wrong && (
        <p role="alert" className="text-small text-shell-danger">
          {wrong}
        </p>
      )}
    </div>
  );
}
