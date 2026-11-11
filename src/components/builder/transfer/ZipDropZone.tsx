'use client';

/**
 * Ô chọn gói .zip: kéo thả file vào, hoặc bấm nút để mở hộp chọn file.
 *
 * Thay cho `<input type="file">` trần: ô mặc định của trình duyệt nói tiếng Anh
 * ("Choose File / No file chosen"), nhỏ, và không nhận kéo thả — trong khi người dùng
 * vừa tải gói về từ môi trường nguồn và việc tự nhiên nhất là kéo nó từ thư mục Tải về
 * thả vào đây. Phần kéo thả nằm ở `FileDropZone` (dùng chung với ô tải font).
 */

import { FileDropZone } from './FileDropZone';

const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';

export function ZipDropZone({ onFile }: { onFile: (file: File) => void }) {
  return (
    <FileDropZone
      data={{ 'data-zip-drop': '' }}
      accept=".zip,application/zip"
      title="Kéo file gói .zip vào đây"
      buttonLabel="Chọn file .zip"
      inputLabel="File gói (.zip)"
      filter={([f]) => {
        if (!f) return { accepted: [] };
        if (!isZip(f)) {
          return {
            accepted: [],
            message: `"${f.name}" không phải file .zip. Chọn gói đã xuất từ menu ⋯ › "Xuất trang (.zip)".`,
          };
        }
        return { accepted: [f] };
      }}
      onFiles={([f]) => f && onFile(f)}
    />
  );
}
