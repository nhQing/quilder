'use client';

/**
 * Ô chọn gói .zip: kéo thả file vào, hoặc bấm nút để mở hộp chọn file.
 *
 * Thay cho `<input type="file">` trần: ô mặc định của trình duyệt nói tiếng Anh
 * ("Choose File / No file chosen"), nhỏ, và không nhận kéo thả — trong khi người dùng
 * vừa tải gói về từ môi trường nguồn và việc tự nhiên nhất là kéo nó từ thư mục Tải về
 * thả vào đây.
 *
 * Input thật vẫn nằm trong DOM (ẩn) để bàn phím, trình đọc màn hình và e2e
 * (`setInputFiles`) dùng được.
 */

import { useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';

import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';

export function ZipDropZone({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  const take = (files: FileList | null | undefined) => {
    const f = files?.[0];
    if (!f) return;
    if (!isZip(f)) {
      setWrong(`"${f.name}" không phải file .zip. Chọn gói đã xuất từ menu ⋯ › "Xuất trang (.zip)".`);
      return;
    }
    setWrong(null);
    onFile(f);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        data-zip-drop
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
        )}
      >
        <Icon name="upload" size={24} className={over ? 'text-shell-accent' : 'text-shell-muted'} />
        <p className="font-semibold">{over ? 'Thả file vào đây' : 'Kéo file gói .zip vào đây'}</p>
        <p className="text-small text-shell-muted">hoặc</p>
        <Button variant="primary" icon="upload" onClick={() => input.current?.click()}>
          Chọn file .zip
        </Button>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          aria-label="File gói (.zip)"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {wrong && <p role="alert" className="text-small text-shell-danger">{wrong}</p>}
    </div>
  );
}
