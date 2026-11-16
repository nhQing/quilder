import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth/guard';
import { buildExport, type ExportProgress } from '@/lib/transfer/export';
import { putExport } from '@/lib/transfer/export-cache';
import { bundleFileName } from '@/lib/transfer/manifest';
import type { CheckEvent } from '@/lib/transfer/progress';

export const dynamic = 'force-dynamic';

/** Báo tiến độ dày nhất mỗi lần này — trang 1200 khung không bắn 1200 dòng qua mạng. */
const PROGRESS_EVERY_MS = 150;

/**
 * Kiểm trước khi xuất — chưa tải gì. Lỗi trả về thành chữ kèm chỗ xảy ra (spec §5.1).
 *
 * Gửi `accept: application/x-ndjson` thì nhận một stream NDJSON: các dòng `progress` (đã đọc bao
 * nhiêu file/byte) rồi đúng một dòng `result` mang status + body y hệt bản JSON. Không gửi thì vẫn
 * là JSON một lần như trước (e2e, script).
 *
 * Kiểm xong mà không bị chặn thì gói được giữ lại (`export-cache.ts`) và `summary.token` cho lượt
 * tải dùng lại, khỏi đọc lại cả kho.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const run = async (onProgress?: ExportProgress): Promise<{ status: number; body: unknown }> => {
    const r = await buildExport(id, auth.email, onProgress);
    if (!r.ok) return { status: r.status, body: { error: r.error } };
    const blocked = r.issues.some((i) => i.level === 'block');
    return {
      status: 200,
      body: {
        ok: !blocked,
        issues: r.issues,
        // Khi bị chặn, `bundle` có thể không có (doc-invalid) — không đọc.
        summary: blocked ? null : {
          files: r.files.length,
          bytes: r.bundle.assets.reduce((s, a) => s + a.bytes, 0),
          fileName: bundleFileName(r.bundle.page.slug, new Date()),
          token: putExport({ pageId: id, user: auth.email, bundle: r.bundle, files: r.files }),
        },
      },
    };
  };

  if (!(req.headers.get('accept') ?? '').includes('application/x-ndjson')) {
    const { status, body } = await run();
    return NextResponse.json(body, { status });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: CheckEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      let last = 0;
      try {
        const result = await run((p) => {
          const now = Date.now();
          // Dòng đầu (tổng) và dòng cuối (xong hết) luôn gửi; ở giữa thì thưa ra.
          if (p.done.files === 0 || p.done.files === p.total.files || now - last >= PROGRESS_EVERY_MS) {
            last = now;
            send({ type: 'progress', done: p.done, total: p.total });
          }
        });
        send({ type: 'result', ...result });
      } catch (e) {
        send({ type: 'result', status: 500, body: { error: String((e as Error)?.message ?? e).slice(0, 200) } });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Proxy kiểu nginx gom buffer thì người dùng chỉ thấy 0% rồi nhảy 100%.
      'x-accel-buffering': 'no',
    },
  });
}
