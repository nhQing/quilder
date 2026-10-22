import 'server-only';

import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import { readExportFile, type ExportFile } from './export';
import type { PageBundle } from './manifest';

/**
 * Stream zip: manifest nén deflate, media "store" (ảnh/video đã nén sẵn).
 *
 * Kéo theo nhịp người nhận (`pull`): mỗi lượt kéo mới đọc MỘT file từ kho. Đẩy hết trong
 * `start` thì một trang 1200 khung hình nằm trọn trong RAM server khi mạng người tải chậm.
 */
export function zipStream(bundle: PageBundle, files: ExportFile[]): ReadableStream<Uint8Array> {
  let zip: Zip;
  let next = -1; // -1: chưa ghi manifest
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) { controller.error(err); return; }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    async pull(controller) {
      try {
        if (next === -1) {
          const manifest = new ZipDeflate('manifest.json', { level: 6 });
          zip.add(manifest);
          manifest.push(strToU8(JSON.stringify(bundle)), true);
          next = 0;
          return;
        }
        if (next < files.length) {
          const f = files[next++]!;
          const bytes = await readExportFile(f);
          const entry = new ZipPassThrough(f.entry);
          zip.add(entry);
          entry.push(bytes, true);
          return;
        }
        zip.end();
      } catch (e) {
        controller.error(e);
      }
    },
  }, { highWaterMark: 1 });
}
