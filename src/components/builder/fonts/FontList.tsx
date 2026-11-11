'use client';

/**
 * Danh sách họ font + hai nút thêm font (§11.2). Dữ liệu từ `listFonts()` ở server; sau
 * mỗi thao tác ghi, `router.refresh()` đọc lại cả danh sách và `@font-face` của trang.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { FontListItem } from '@/lib/fonts/service';

import { Button } from '../ui/Button';
import { Note } from '../ui/Note';
import { FontRow } from './FontRow';
import { FontUploadDialog } from './FontUploadDialog';
import { GoogleFontDialog } from './GoogleFontDialog';

export function FontList({
  fonts,
  canWrite,
  isAdmin,
}: {
  fonts: FontListItem[];
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<'google' | 'upload' | null>(null);
  const refresh = () => router.refresh();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Note tone="info" className="min-w-0 flex-[1_1_20rem]">
          <p>Sửa font hiện ngay trong builder; site thật đổi sau lần Publish tới.</p>
        </Note>
        {canWrite && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="md" onClick={() => setDialog('google')}>
              Nhập từ Google Fonts
            </Button>
            <Button variant="primary" size="md" icon="upload" onClick={() => setDialog('upload')}>
              Tải file font
            </Button>
          </div>
        )}
      </div>

      {fonts.length === 0 ? (
        <Note tone="info">
          <p>Chưa có font nào.</p>
        </Note>
      ) : (
        <ul className="flex flex-col divide-y divide-shell-line overflow-hidden rounded-xl border border-shell-line bg-shell-panel">
          {fonts.map((f) => (
            <FontRow key={f.id ?? f.token} font={f} canWrite={canWrite} isAdmin={isAdmin} onChanged={refresh} />
          ))}
        </ul>
      )}

      {canWrite && (
        <>
          <FontUploadDialog
            open={dialog === 'upload'}
            onClose={() => setDialog(null)}
            onSaved={refresh}
          />
          <GoogleFontDialog
            open={dialog === 'google'}
            onClose={() => setDialog(null)}
            onSaved={refresh}
          />
        </>
      )}
    </div>
  );
}
