import { NextResponse } from 'next/server';

/**
 * Danh sách font và thêm một face (§10).
 *
 * `POST` nhận ba dạng thân:
 *  - multipart: `file`, `family?`, `weight?`, `style?`, `fallback?`, `licenseConfirmed`,
 *    `licenseNote?`, `dryRun?` — dạng chính (cả MCP `filePath` lẫn màn Cài đặt);
 *  - JSON `{ sourceUrl, … }`: server tải file về (cùng helper và trần 10 MB với `upload_asset`);
 *  - JSON `{ google: { family, weights?, italic? }, … }`: nối ở Task 8, tạm trả 501.
 *
 * Luật (kiểm file, tên, token, audit) nằm ở `lib/fonts/service`; route chỉ chuẩn hoá đầu vào
 * (`weight`, `style`, `fallback`) và đổi `FontError` thành HTTP.
 */

import { fetchUrlBytes } from '@/lib/assets/fetch-url';
import { requireAuth } from '@/lib/auth/guard';
import { MAX_ASSET_BYTES } from '@/lib/builder/upload-asset';
import { fontErrorResponse, resolveFallback } from '@/lib/fonts/http';
import { addFace, listFonts, type AddFaceInput } from '@/lib/fonts/service';
import {
  parseWeight,
  type FontStyle,
} from '@/lib/fonts/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;
const asBool = (v: unknown): boolean => v === true || v === 'true';

class BadField extends Error {}

type Fields = Omit<AddFaceInput, 'bytes' | 'fileName'>;

/** Chuẩn hoá các trường chung của cả ba dạng thân. Ném `FontError` khi sai. */
function readFields(raw: Record<string, unknown>): Fields {
  const style = asString(raw.style);
  if (style !== undefined && style !== 'normal' && style !== 'italic') {
    throw new BadField('Kiểu chữ (style) chỉ nhận "normal" hoặc "italic".');
  }
  const fb = asString(raw.fallback);
  return {
    family: asString(raw.family),
    weight: parseWeight(raw.weight),
    style: style as FontStyle | undefined,
    fallback: fb === undefined ? undefined : resolveFallback(fb),
    licenseConfirmed: asBool(raw.licenseConfirmed),
    licenseNote: asString(raw.licenseNote),
    dryRun: asBool(raw.dryRun),
  };
}

export async function GET() {
  const auth = await requireAuth('read');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ fonts: await listFonts() });
}

export async function POST(request: Request) {
  const auth = await requireAuth('write');
  if (auth instanceof NextResponse) return auth;
  const actor = { email: auth.email, sub: auth.sub };

  try {
    const type = request.headers.get('content-type') ?? '';

    if (type.includes('application/json')) {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return bad('Thân JSON không hợp lệ');
      }
      if (!body || typeof body !== 'object') return bad('Thân JSON không hợp lệ');
      const fields = readFields(body);

      if (body.google !== undefined) {
        return bad('Nhập từ Google Fonts chưa được bật trên server này', 501);
      }
      const url = asString(body.sourceUrl);
      if (!url) return bad('Cần "sourceUrl" hoặc "google" trong thân JSON');
      const got = await fetchUrlBytes(url, 'Font');
      if (!got.ok) {
        return NextResponse.json(
          { error: got.error, ...(got.code ? { code: got.code } : {}) },
          { status: got.status },
        );
      }
      return NextResponse.json(await addFace({ ...fields, bytes: got.bytes, fileName: got.fileName }, actor));
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return bad('Cần multipart/form-data với trường "file" hoặc JSON với "sourceUrl"');
    }
    const file = form.get('file');
    if (!(file instanceof File)) return bad('Thiếu trường "file"');
    // Kiểm trước khi đọc vào bộ nhớ, như /api/assets.
    if (file.size > MAX_ASSET_BYTES) {
      return NextResponse.json(
        { error: `Tối đa ${MAX_ASSET_BYTES / 1024 / 1024} MB`, code: 'too_large' },
        { status: 413 },
      );
    }
    const fields = readFields(Object.fromEntries(form.entries()));
    const bytes = new Uint8Array(await file.arrayBuffer());
    return NextResponse.json(await addFace({ ...fields, bytes, fileName: file.name }, actor));
  } catch (e) {
    if (e instanceof BadField) return bad(e.message, 422);
    return fontErrorResponse(e);
  }
}
