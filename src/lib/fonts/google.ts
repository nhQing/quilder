/**
 * Nhập một họ font từ Google Fonts (§8): gọi css2, đọc phản hồi, tải woff2 từ
 * fonts.gstatic.com rồi thêm từng file làm một face qua `addFace`.
 *
 * Mọi lệnh mạng đi qua `fetchImpl` (mặc định `fetch`) để test chạy offline. Không gửi dữ liệu
 * dự án/người dùng sang Google: chỉ có tên họ và weight.
 */

import { MAX_ASSET_BYTES } from '@/lib/builder/upload-asset';

import { googleCssFamilyName, parseGoogleCss, parseGoogleFamily, type GoogleFace } from './google-parse';
import { addFace, previewFaces, slugify, type Actor, type FontUploadResult } from './service';
import { FontError, type FontWarningCode } from './types';

export interface GoogleImportRequest {
  family: string;
  weights?: number[];
  italic?: boolean;
  fallback?: string;
  dryRun?: boolean;
}

const CSS2 = 'https://fonts.googleapis.com/css2';
const GSTATIC_HOST = 'fonts.gstatic.com';
/** User-Agent của Chrome bản mới: Google trả woff2 theo UA. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_FILES = 60;
const DOWNLOAD_CONCURRENCY = 6;
const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const UNREACHABLE_MESSAGE =
  'Server không kết nối được Google Fonts. Hãy tải font về máy rồi dùng mục Tải file font.';
const unreachable = () => new FontError('google_unreachable', UNREACHABLE_MESSAGE);

/** Một request có trần 10 giây; lỗi mạng hay hết giờ đều thành `google_unreachable`. */
async function guarded<T>(fetchImpl: typeof fetch, url: string, read: (r: Response) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(unreachable());
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
        return read(res);
      })(),
      timeout,
    ]);
  } catch (e) {
    if (e instanceof FontError) throw e;
    throw unreachable();
  } finally {
    clearTimeout(timer);
  }
}

const cssUrl = (family: string, spec: string) =>
  `${CSS2}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${spec}&display=swap`;

/** Trả css khi 200, `null` khi Google nói không có tổ hợp này (400/404), còn lại là unreachable. */
async function fetchCss(fetchImpl: typeof fetch, url: string): Promise<string | null> {
  return guarded(fetchImpl, url, async (res) => {
    if (res.status === 200) return res.text();
    if (res.status === 400 || res.status === 404) return null;
    throw unreachable();
  });
}

async function downloadFile(fetchImpl: typeof fetch, url: string): Promise<Uint8Array> {
  return guarded(fetchImpl, url, async (res) => {
    if (!res.ok) throw unreachable();
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new FontError('too_large', `File font vượt quá ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
    }
    return bytes;
  });
}

/** Thứ tự §8: dải variable trước, không được thì từng weight × kiểu. `weights` bỏ qua bước variable. */
async function collectCss(
  fetchImpl: typeof fetch,
  family: string,
  weights: number[] | undefined,
  italic: boolean,
): Promise<string[]> {
  if (!weights?.length) {
    const spec = italic ? 'ital,wght@0,100..900;1,100..900' : 'wght@100..900';
    const css = await fetchCss(fetchImpl, cssUrl(family, spec));
    if (css !== null) return [css];
  }
  const combos: { w: number; ital: 0 | 1 }[] = [];
  for (const w of weights?.length ? weights : ALL_WEIGHTS) {
    combos.push({ w, ital: 0 });
    if (italic) combos.push({ w, ital: 1 });
  }
  const got = await Promise.all(
    combos.map(({ w, ital }) => fetchCss(fetchImpl, cssUrl(family, italic ? `ital,wght@${ital},${w}` : `wght@${w}`))),
  );
  return got.filter((c): c is string => c !== null);
}

/** Chỉ https://fonts.gstatic.com mới được tải. */
function isGstatic(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === GSTATIC_HOST;
  } catch {
    return false;
  }
}

/**
 * Gộp kết quả nhiều lần `addFace` thành một: họ lấy từ lần đầu (`created` đúng nếu BẤT KỲ lần
 * nào tạo họ), `faces` nối theo thứ tự, `warnings` gộp và bỏ trùng theo `code`.
 */
function aggregate(results: FontUploadResult[], extraWarnings: FontUploadResult['warnings']): FontUploadResult {
  const first = results[0]!;
  const warnings: FontUploadResult['warnings'] = [];
  for (const w of [...results.flatMap((r) => r.warnings), ...extraWarnings]) {
    if (!warnings.some((x) => x.code === w.code)) warnings.push(w);
  }
  return {
    ok: true,
    dryRun: false,
    family: { ...first.family, created: results.some((r) => r.family.created) },
    faces: results.flatMap((r) => r.faces),
    warnings,
  };
}

export async function importGoogleFamily(
  req: GoogleImportRequest,
  actor: Actor,
  fetchImpl: typeof fetch = fetch,
): Promise<FontUploadResult> {
  const requested = parseGoogleFamily(req.family);
  if (!requested) {
    throw new FontError('google_not_found', 'Cần nhập tên họ font hoặc link fonts.google.com/specimen/…');
  }

  const cssList = await collectCss(fetchImpl, requested, req.weights, req.italic !== false);
  const cssName = cssList.map(googleCssFamilyName).find(Boolean) ?? requested;

  // Gộp mọi phản hồi, bỏ face trùng, bỏ URL không nằm trên fonts.gstatic.com.
  const seen = new Set<string>();
  let faces: GoogleFace[] = [];
  for (const f of cssList.flatMap(parseGoogleCss)) {
    const id = `${f.weight}|${f.style}|${f.unicodeRange}`;
    if (seen.has(id) || !isGstatic(f.url)) continue;
    seen.add(id);
    faces.push(f);
  }
  if (!faces.length) {
    throw new FontError(
      'google_not_found',
      `Google Fonts không có họ "${requested}". Kiểm tra lại tên, hoặc tải font về máy rồi dùng mục Tải file font.`,
    );
  }

  const extra: FontUploadResult['warnings'] = [];
  if (faces.length > MAX_FILES) {
    faces = faces.slice(0, MAX_FILES);
    extra.push({
      code: 'google_truncated',
      message: `Họ font này có hơn ${MAX_FILES} file; chỉ nhập ${MAX_FILES} file đầu. Hãy chọn weight cụ thể để nhập phần còn lại.`,
    });
  }

  // Thiếu tiếng Việt là chuyện của CẢ HỌ: mỗi file chỉ bị kiểm chữ trong dải của nó (service),
  // còn họ không có bộ `vietnamese` thì chữ có dấu rơi về font dự phòng dù từng file đều "đủ".
  // Gắn cảnh báo vào mọi face để kết quả nhập, `FontFace.warnings` và nhãn ở màn Font khớp nhau.
  const familyWarnings: FontWarningCode[] = faces.some((f) => f.subset === 'vietnamese') ? [] : ['missing_vietnamese'];

  if (req.dryRun) {
    // Không tải file, không ghi gì. Luật tên/token/fallback và `replaced` do service tính.
    const preview = await previewFaces({
      family: cssName,
      fallback: req.fallback,
      faces: faces.map((f) => ({ weight: f.weight, style: f.style, unicodeRange: f.unicodeRange, subset: f.subset })),
      extraWarnings: familyWarnings,
    });
    return { ...preview, warnings: [...preview.warnings, ...extra] };
  }

  // Tải hết trước khi ghi: mất mạng giữa chừng không để lại họ nhập dở.
  const files: Uint8Array[] = [];
  for (let i = 0; i < faces.length; i += DOWNLOAD_CONCURRENCY) {
    files.push(...(await Promise.all(faces.slice(i, i + DOWNLOAD_CONCURRENCY).map((f) => downloadFile(fetchImpl, f.url)))));
  }

  // Ghi tuần tự: face đầu có thể tạo họ, các face sau phải thấy họ đó.
  const results: FontUploadResult[] = [];
  try {
    for (const [i, f] of faces.entries()) {
      results.push(
        await addFace(
          {
            bytes: files[i]!,
            fileName: `${slugify(cssName)}-${f.subset}-${f.weight.replace(/\s+/g, '-')}-${f.style}.woff2`,
            family: cssName,
            weight: f.weight,
            style: f.style,
            fallback: req.fallback,
            licenseConfirmed: true,
            licenseNote: 'Google Fonts (OFL/Apache)',
            source: 'google',
            googleFamily: cssName,
            prepared: { unicodeRange: f.unicodeRange, subset: f.subset },
            ...(familyWarnings.length ? { extraWarnings: familyWarnings } : {}),
          },
          actor,
        ),
      );
    }
  } catch (e) {
    if (!results.length) throw e;
    // Các face trước đã ghi (kèm họ và token): báo rõ để người gọi biết, thử lại là an toàn.
    const imported = results.flatMap((r) => r.faces.map(({ weight, style, subset }) => ({ weight, style, subset })));
    const list = imported.map((f) => `${f.subset} ${f.weight}${f.style === 'italic' ? ' italic' : ''}`).join(', ');
    const why = e instanceof Error ? e.message : String(e);
    throw new FontError(
      e instanceof FontError ? e.code : 'google_unreachable',
      `Nhập dở họ "${cssName}": đã lưu ${imported.length}/${faces.length} file (${list}), file tiếp theo lỗi: ${why} Nhập lại là an toàn, các face trùng sẽ được thay.`,
      { ...(e instanceof FontError ? e.extra : {}), imported, family: results[0]!.family.slug },
    );
  }
  return aggregate(results, extra);
}
