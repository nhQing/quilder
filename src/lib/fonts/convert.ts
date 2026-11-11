// Import tĩnh có chủ đích: `subset-font` nằm trong `serverExternalPackages` nên webpack chỉ phát
// một `require` ngoài, và trình theo vết file của Next nhờ đó mang subset-font → fontverter →
// p-limit/harfbuzzjs vào bản standalone. Nạp nó không có tác dụng phụ (index.js chỉ require
// fontverter và p-limit; wasm chỉ được khởi tạo lười ở lần gọi đầu) — worker dưới đây mới là
// nơi chạy thật.
import 'subset-font';

import { createRequire } from 'node:module';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { InspectResult } from './inspect';
import { FontError } from './types';
import { SUBSET_CODEPOINTS, SUBSET_UNICODE_RANGE } from './unicode';

/** Trần thời gian cắt một font (kế hoạch: 30 giây). */
const DEFAULT_TIMEOUT_MS = 30_000;

const TOO_SLOW =
  'Cắt bộ chữ quá lâu (quá giới hạn thời gian). Hãy dùng file woff2 đã cắt sẵn (ví dụ bộ latin + vietnamese) rồi tải lại.';
const BAD_FILE = 'Không cắt được bộ chữ của file font (file hỏng hoặc không hỗ trợ).';

/**
 * Mã chạy trong worker. `subset-font` chạy wasm đồng bộ nên sẽ chặn event loop của luồng
 * gọi; đặt nó vào worker để `Worker.terminate()` thực sự dừng được khi quá hạn. Dạng chuỗi
 * (`eval: true`) để không phụ thuộc đường dẫn file khi bundler/standalone đóng gói lại.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const subsetFont = require(workerData.modulePath);
const fn = subsetFont.default || subsetFont;
fn(Buffer.from(workerData.bytes), String.fromCodePoint(...workerData.codepoints), {
  targetFormat: 'woff2',
}).then(
  (out) => {
    const copy = new Uint8Array(out);
    parentPort.postMessage({ ok: true, bytes: copy }, [copy.buffer]);
  },
  (err) => parentPort.postMessage({ ok: false, message: String((err && err.message) || err) }),
);
`;

/**
 * Đường dẫn tuyệt đối tới `subset-font` để worker `require`. Thử theo vị trí module này; nếu
 * bundler đã đổi `import.meta.url` thành đường dẫn lúc build (không còn tồn tại) thì thử theo
 * `process.cwd()` — server standalone của Next chdir vào thư mục của nó, nơi `node_modules`
 * chứa gói đã được theo vết (nhờ `import 'subset-font'` ở đầu file). Task 15 phải kiểm cách
 * này trên bản standalone đã chuyển sang thư mục khác. Cả hai thất bại → FontError.
 */
function subsetModulePath(): string {
  const causes: string[] = [];
  const bases = [() => import.meta.url, () => path.join(process.cwd(), 'package.json')];
  for (const base of bases) {
    try {
      return createRequire(base()).resolve('subset-font');
    } catch (e) {
      causes.push(String((e as Error)?.message ?? e));
    }
  }
  throw new FontError('not_font', 'Server thiếu thư viện cắt font (subset-font).', {
    cause: causes.join(' | '),
  });
}

function runInWorker(bytes: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let modulePath: string;
    try {
      modulePath = subsetModulePath();
    } catch (e) {
      reject(e);
      return;
    }
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      // Worker nhận bản sao, không chiếm buffer của người gọi.
      workerData: { bytes: new Uint8Array(bytes), codepoints: SUBSET_CODEPOINTS, modulePath },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const fail = (cause: string) =>
      finish(() => reject(new FontError('not_font', BAD_FILE, { cause })));
    // Timer nằm ở luồng chính, còn wasm ở worker → timer luôn nổ đúng hạn.
    const timer = setTimeout(
      () => finish(() => reject(new FontError('too_large', TOO_SLOW))),
      timeoutMs,
    );
    worker.on('message', (msg: { ok: boolean; bytes?: Uint8Array; message?: string }) => {
      if (msg.ok && msg.bytes) {
        const out = new Uint8Array(msg.bytes);
        finish(() => resolve(out));
      } else fail(msg.message ?? 'unknown');
    });
    worker.on('error', (e) => fail(String(e?.message ?? e)));
    worker.on('exit', (code) => fail(`worker exit ${code}`));
  });
}

/**
 * Cắt font về bộ latin + latin-ext + vietnamese và xuất woff2. woff2 vào thì trả nguyên.
 * Quá `timeoutMs` (mặc định 30 giây) → `FontError('too_large')`.
 */
export async function toWoff2(
  bytes: Uint8Array,
  format: InspectResult['format'],
  opts: { timeoutMs?: number } = {},
): Promise<{ bytes: Uint8Array; unicodeRange: string }> {
  if (format === 'woff2') return { bytes, unicodeRange: '' };
  const out = await runInWorker(bytes, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return { bytes: out, unicodeRange: SUBSET_UNICODE_RANGE };
}
