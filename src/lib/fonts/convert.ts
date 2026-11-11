import { createRequire } from "node:module";
import path from "node:path";
import { Worker } from "node:worker_threads";

import type { InspectResult } from "./inspect";
import { FontError } from "./types";
import { SUBSET_CODEPOINTS, SUBSET_UNICODE_RANGE } from "./unicode";

/** Trần thời gian cắt một font (kế hoạch: 30 giây). */
const DEFAULT_TIMEOUT_MS = 30_000;

const TOO_SLOW =
  "Cắt bộ chữ quá lâu (quá giới hạn thời gian). Hãy dùng file woff2 đã cắt sẵn (ví dụ bộ latin + vietnamese) rồi tải lại.";

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

/** `subset-font` là external của Next (xem `serverExternalPackages`), nên resolve lúc chạy. */
function subsetModulePath(): string {
  return createRequire(path.join(process.cwd(), "package.json")).resolve("subset-font");
}

function runInWorker(bytes: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(bytes); // worker nhận bản sao, không chiếm buffer của người gọi
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        bytes: copy,
        codepoints: SUBSET_CODEPOINTS,
        modulePath: subsetModulePath(),
      },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    // Timer nằm ở luồng chính, còn wasm ở worker → timer luôn nổ đúng hạn.
    const timer = setTimeout(
      () => finish(() => reject(new FontError("too_large", TOO_SLOW))),
      timeoutMs,
    );
    worker.on("message", (msg: { ok: boolean; bytes?: Uint8Array; message?: string }) =>
      finish(() => {
        if (msg.ok && msg.bytes) resolve(new Uint8Array(msg.bytes));
        else
          reject(
            new FontError(
              "not_font",
              "Không cắt được bộ chữ của file font (file hỏng hoặc không hỗ trợ).",
            ),
          );
      }),
    );
    worker.on("error", () =>
      finish(() =>
        reject(
          new FontError(
            "not_font",
            "Không cắt được bộ chữ của file font (file hỏng hoặc không hỗ trợ).",
          ),
        ),
      ),
    );
    worker.on("exit", (code) =>
      finish(() =>
        reject(new FontError("not_font", `Tiến trình cắt font dừng bất thường (${code}).`)),
      ),
    );
  });
}

/**
 * Cắt font về bộ latin + latin-ext + vietnamese và xuất woff2. woff2 vào thì trả nguyên.
 * Quá `timeoutMs` (mặc định 30 giây) → `FontError('too_large')`.
 */
export async function toWoff2(
  bytes: Uint8Array,
  format: InspectResult["format"],
  opts: { timeoutMs?: number } = {},
): Promise<{ bytes: Uint8Array; unicodeRange: string }> {
  if (format === "woff2") return { bytes, unicodeRange: "" };
  const out = await runInWorker(bytes, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return { bytes: out, unicodeRange: SUBSET_UNICODE_RANGE };
}
