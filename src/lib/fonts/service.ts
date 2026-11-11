/**
 * Dịch vụ font: thêm/thay/xoá face, sửa/xoá họ, đồng bộ token `font-<slug>`, ghi
 * `AuditLog`, gọi `revalidateTag('fonts')`. Route `/api/fonts`, nhập Google Fonts, tool MCP
 * và script chuyển font của gói đều đi qua đây — luật nằm ở một chỗ (spec §4, §7.1, §9, §10).
 *
 * ## Thứ tự trong `addFace`
 *
 *  1. Kiểm rẻ trước (fallback, giấy phép), rồi đọc metadata (`inspectFont`).
 *  2. Mọi phép kiểm tên/slug/token chạy TRƯỚC khi chạm S3: một lỗi `name_reserved` không
 *     được để lại object nào trên bucket.
 *  3. `dryRun` dừng ở đây: không cắt, không tải lên, không ghi hàng, không audit.
 *  4. Cắt sang woff2 (trừ khi `prepared` — file Google đã cắt sẵn) rồi `uploadAsset`. Bước
 *     này nằm NGOÀI transaction: nó tự lành (khoá theo nội dung), và giữ một transaction
 *     mở trong lúc PUT lên S3 là giữ kết nối Postgres vô ích.
 *  5. Ghi họ/face/token/audit trong MỘT transaction.
 *
 * ## Token đi kèm
 *
 * Mỗi họ sở hữu đúng một hàng `Token` tên `font-<slug>`, hạng `font`, `custom: true`, giá trị
 * `"<cssName>", <fallback>`. Hàng đó chỉ được tạo/sửa/xoá ở đây (route design-tokens từ chối
 * xoá nó). Slug BẤT BIẾN: đổi tên họ chỉ đổi `value` của token, không đổi tên token.
 */

import { prisma } from '@/lib/db';
import { uploadAsset } from '@/lib/builder/upload-asset';
import { isSafeTokenValue } from '@/lib/design/token-value';
import { CUSTOM_TOKENS_TAG } from '@/lib/render/custom-tokens';
import { revalidateTag } from 'next/cache';

import { BUILTIN_FAMILIES, isReservedFamilyName } from './builtin';
import { toWoff2 } from './convert';
import { familyNameKey } from './css';
import { inspectFont } from './inspect';
import { fontSealOf } from './seal';
import { describeFontFamily, fontTokenName, fontTokenValue } from './token';
import { SUBSET_UNICODE_RANGE } from './unicode';
import { type TokenUsage, type UsageRef, tokenUsage, tokenUsageMany } from './usage';
import {
  type FontSealFace,
  type FontSource,
  type FontStyle,
  type FontWarningCode,
  FALLBACKS,
  FONTS_TAG,
  FontError,
} from './types';

export interface Actor {
  email: string;
  sub: string;
}

export interface AddFaceInput {
  bytes: Uint8Array;
  fileName: string;
  family?: string;
  weight?: string;
  style?: FontStyle;
  /** Chuỗi đã chọn; mặc định `FALLBACKS.sans`. */
  fallback?: string;
  licenseConfirmed: boolean;
  licenseNote?: string;
  dryRun?: boolean;
  /** Mặc định `'upload'`. */
  source?: FontSource;
  googleFamily?: string;
  /** File Google (hoặc woff2 của gói): đã cắt sẵn, bỏ bước `toWoff2`. */
  prepared?: { unicodeRange: string; subset: string };
  /** Chỉ script adopt: nhận lại token tự tạo cùng tên thay vì `slug_taken`. */
  adoptToken?: boolean;
  /**
   * Cảnh báo cấp HỌ mà chỉ người gọi biết, gộp vào cảnh báo của face (lưu và trả về như nhau).
   * Nhập Google: họ không có bộ `vietnamese` thì mọi face mang `missing_vietnamese`, dù từng
   * file đều đủ chữ trong dải của nó.
   */
  extraWarnings?: FontWarningCode[];
  /**
   * "Thay file" ở màn Font: face này (phải thuộc họ được chọn) nhận file mới, kể cả khi dải
   * ký tự của file mới khác dải cũ (woff2 "" ↔ TTF đã cắt ↔ dải Google). Không có thì face
   * được thay chỉ khi trùng đúng (weight, style, unicodeRange).
   */
  replaceFaceId?: string;
}

/** Đúng hình dạng phản hồi `POST /api/fonts` (§10). */
export interface FontUploadResult {
  ok: true;
  dryRun: boolean;
  family: { id?: string; slug: string; cssName: string; token: string; created: boolean };
  faces: { weight: string; style: FontStyle; subset: string; bytes: number; replaced: boolean }[];
  warnings: { code: FontWarningCode; message: string }[];
}

/** Dữ liệu cho `GET /api/fonts` và tool `list_fonts`. */
export interface FontListItem {
  id: string | null;
  cssName: string;
  token: string;
  source: 'builtin' | FontSource;
  fallback: string;
  faces: {
    id: string | null;
    weight: string;
    style: FontStyle;
    subset: string;
    bytes: number | null;
    warnings: FontWarningCode[];
  }[];
  usage: { pages: UsageRef[]; components: UsageRef[] };
  unpublished: boolean;
  licenseNote: string | null;
  licenseConfirmedBy: string | null;
}

// ── Hằng số và hàm nhỏ ─────────────────────────────────────────────────────

/** `font-` + slug phải lọt `TOKEN_NAME_RE` (tối đa 49 ký tự). */
const MAX_SLUG = 44;

const WARNING_MESSAGES: Record<FontWarningCode, string> = {
  missing_vietnamese:
    'Font thiếu một số chữ tiếng Việt có dấu (ạ ả ã ế ộ ữ ơ ư Ư Đ). Chữ thiếu sẽ hiện bằng font dự phòng.',
  restricted_embedding:
    'File font bật cờ cấm nhúng (Restricted License). Chỉ dùng khi bạn chắc chắn có quyền dùng font này trên web.',
  google_truncated:
    'Họ font này có hơn 60 file; chỉ nhập 60 file đầu. Hãy chọn weight cụ thể để nhập phần còn lại.',
};

/** Tên họ → slug: bỏ dấu tiếng Việt, chữ thường, nối bằng `-`. */
export function slugify(cssName: string): string {
  return cssName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
}

const warningMessages = (codes: FontWarningCode[]): FontUploadResult['warnings'] =>
  codes.map((code) => ({ code, message: WARNING_MESSAGES[code] }));

const asStyle = (s: string): FontStyle => (s === 'italic' ? 'italic' : 'normal');
const asWarnings = (codes: string[]): FontWarningCode[] =>
  codes.filter((c): c is FontWarningCode => c in WARNING_MESSAGES);

/** Phần sau tên họ đầu tiên của một font stack (dấu phẩy đầu tiên nằm ngoài nháy). */
function fallbackPartOf(value: string): string | null {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ',') return value.slice(i + 1).trim() || null;
  }
  return null;
}

function cleanFallback(raw: string | undefined): string {
  const fallback = raw?.trim() || FALLBACKS.sans;
  if (!isSafeTokenValue(fallback)) {
    throw new FontError(
      'bad_fallback',
      'Font dự phòng không hợp lệ (có ký tự như ; { } < > hoặc quá dài). Chọn Sans, Serif, Mono hoặc gõ lại danh sách tên font cách nhau bằng dấu phẩy.',
    );
  }
  return fallback;
}

/**
 * Các họ có tên trùng `name` theo `familyNameKey` (không phân biệt hoa thường, khoảng trắng).
 *
 * So trong JS chứ không `cssName: { equals, mode: 'insensitive' }`: Prisma dịch cái đó thành
 * ILIKE mà không escape `_ % \`, nên "My-Font" khớp "My_Font" và face rơi nhầm họ. Bảng họ
 * font chỉ có vài chục hàng — đọc hết rẻ hơn mọi cách escape.
 */
async function familiesNamed(name: string) {
  const key = familyNameKey(name);
  const rows = await prisma.fontFamily.findMany({
    select: {
      id: true,
      slug: true,
      cssName: true,
      source: true,
      faces: { select: { id: true, weight: true, style: true, unicodeRange: true } },
    },
  });
  return rows.filter((r) => familyNameKey(r.cssName) === key);
}

/** Luật tên cho một họ MỚI hoặc tên mới của họ (`excludeId` = chính họ đang đổi tên). */
async function checkFamilyName(name: string, fallback: string, excludeId?: string): Promise<void> {
  if (!name) {
    throw new FontError('name_required', 'File font không ghi tên họ. Hãy nhập tên họ font.');
  }
  if (isReservedFamilyName(name)) {
    throw new FontError(
      'name_reserved',
      `"${name}" là tên font có sẵn hoặc tên dự phòng của hệ thống, dùng nó sẽ trộn với font đó. Hãy đặt tên khác, ví dụ "${name} Web".`,
    );
  }
  const other = (await familiesNamed(name)).find((f) => f.id !== excludeId);
  if (other) {
    throw new FontError(
      'name_reserved',
      `Đã có họ font "${other.cssName}" (tên font không phân biệt hoa thường). Hãy đặt tên khác, ví dụ "${name} Web".`,
    );
  }
  if (!isSafeTokenValue(fontTokenValue(name, fallback))) {
    throw new FontError(
      'name_required',
      'Tên họ có ký tự không dùng được trong CSS (" \\ ; { } < > ! @) hoặc quá dài. Hãy nhập tên khác.',
    );
  }
}

function inUse(what: string, usage: TokenUsage): FontError {
  const parts = [
    usage.pages.length ? `${usage.pages.length} trang` : '',
    usage.components.length ? `${usage.components.length} component` : '',
  ].filter(Boolean);
  return new FontError(
    'in_use',
    `${what} đang được dùng ở ${parts.join(', ')}. Đổi font ở những chỗ đó trước rồi xoá lại.`,
    { usage },
  );
}

function revalidate(tokenChanged: boolean): void {
  revalidateTag(FONTS_TAG);
  // Giá trị token nằm trong khối `:root` của custom-tokens — không làm mới thì node gán
  // token vừa tạo hiện bằng font mặc định tới lúc cache hết hạn.
  if (tokenChanged) revalidateTag(CUSTOM_TOKENS_TAG);
}

/**
 * Luật chọn họ cho một tên (dùng chung cho ghi thật và dryRun): tìm họ cũ không phân biệt hoa
 * thường; họ mới thì kiểm tên, slug và token.
 */
async function planFamily(name: string, fallback: string, adoptToken?: boolean) {
  if (!name) {
    throw new FontError('name_required', 'File font không ghi tên họ. Hãy nhập tên họ font.');
  }

  // Tên họ so KHÔNG phân biệt hoa thường: "GILROY" khi đã có "gilroy" là thêm face vào họ cũ.
  const existing = (await familiesNamed(name))[0] ?? null;

  let slug: string;
  let adopt: { id: string } | null = null;
  if (existing) {
    slug = existing.slug;
  } else {
    await checkFamilyName(name, fallback);
    slug = slugify(name);
    if (!slug) {
      throw new FontError('name_required', 'Tên họ phải có chữ cái hoặc chữ số. Hãy nhập tên khác.');
    }
    const sameSlug = await prisma.fontFamily.findUnique({ where: { slug }, select: { cssName: true } });
    if (sameSlug) {
      throw new FontError(
        'slug_taken',
        `Tên "${name}" ra token font-${slug}, trùng với họ "${sameSlug.cssName}". Hãy đặt tên khác.`,
      );
    }
    const token = await prisma.token.findUnique({
      where: { name: fontTokenName(slug) },
      select: { id: true, custom: true },
    });
    if (token) {
      if (adoptToken && token.custom) adopt = { id: token.id };
      else {
        throw new FontError(
          'slug_taken',
          `Đã có biến "${fontTokenName(slug)}" trong design system. Hãy đặt tên họ khác để không đè lên nó.`,
        );
      }
    }
  }

  return { existing, slug, adopt };
}

export interface PreviewFace {
  weight: string;
  style: FontStyle;
  unicodeRange: string;
  subset: string;
  bytes?: number;
}

/** Xem trước (không ghi, không đụng file): cùng luật `addFace`, `replaced` tính từ face đã có. */
export async function previewFaces(input: {
  family: string;
  fallback?: string;
  faces: PreviewFace[];
  /** Cảnh báo cấp họ, như `AddFaceInput.extraWarnings`. */
  extraWarnings?: FontWarningCode[];
}): Promise<FontUploadResult> {
  const fallback = cleanFallback(input.fallback);
  const name = input.family.trim().replace(/\s+/g, ' ');
  const { existing, slug } = await planFamily(name, fallback);
  return {
    ok: true,
    dryRun: true,
    family: {
      ...(existing ? { id: existing.id } : {}),
      slug,
      cssName: existing?.cssName ?? name,
      token: fontTokenName(slug),
      created: !existing,
    },
    faces: input.faces.map((f) => ({
      weight: f.weight,
      style: f.style,
      subset: f.subset,
      bytes: f.bytes ?? 0,
      replaced: !!existing?.faces.some(
        (x) => x.weight === f.weight && x.style === f.style && x.unicodeRange === f.unicodeRange,
      ),
    })),
    warnings: warningMessages(input.extraWarnings ?? []),
  };
}

// ── addFace ────────────────────────────────────────────────────────────────

/** Thêm một file font vào kho: tạo họ (và token) khi chưa có, thêm hoặc thay face (§7.1). */
export async function addFace(input: AddFaceInput, actor: Actor): Promise<FontUploadResult> {
  const source: FontSource = input.source ?? 'upload';
  const dryRun = !!input.dryRun;
  const fallback = cleanFallback(input.fallback);
  // Bản dryRun là bước xem trước, chạy TRƯỚC khi người dùng tick giấy phép (§7.3, §11.3).
  if (source === 'upload' && !input.licenseConfirmed && !dryRun) {
    throw new FontError(
      'license_required',
      'Cần xác nhận "Tôi có quyền dùng font này trên web" trước khi lưu font tải lên.',
    );
  }

  // Face mang `unicode-range` (Google, woff2 của gói) chỉ bị kiểm chữ Việt trong dải đó. File
  // sẽ cắt thì dải là bộ cắt (chứa cả bộ kiểm), woff2 tải lên là "" — cả hai = kiểm cả bộ.
  const info = inspectFont(input.bytes, { unicodeRange: input.prepared?.unicodeRange });
  const name = (input.family ?? info.family ?? '').trim().replace(/\s+/g, ' ');
  const warningCodes = [...new Set([...info.warnings, ...(input.extraWarnings ?? [])])];
  const warnings = warningMessages(warningCodes);

  // File giữ nguyên byte: Google/gói đã cắt sẵn (`prepared`), hoặc woff2 tải lên (§7.1 bước 4).
  const keepBytes = !!input.prepared || info.format === 'woff2';
  const subset = input.prepared?.subset ?? '';

  /**
   * Họ và face đích theo trạng thái DB LÚC GỌI. Tách thành hàm vì phải chạy lại khi transaction
   * đụng P2002 (ai đó vừa tạo cùng họ): mọi thứ suy từ `planFamily` đều nằm ở đây.
   */
  const resolve = async (unicodeRange: string) => {
    const plan = await planFamily(name, fallback, input.adoptToken);
    const { existing } = plan;
    const target = input.replaceFaceId ? existing?.faces.find((f) => f.id === input.replaceFaceId) : undefined;
    if (input.replaceFaceId && !target) {
      throw new FontError(
        'not_found',
        `Không tìm thấy face cần thay trong họ "${existing?.cssName ?? name}" (có thể đã bị xoá). Tải lại trang rồi thử lại.`,
      );
    }
    // Thay file giữ weight/kiểu của face cũ trừ khi người gọi đè.
    const weight = (input.weight?.trim() || target?.weight || info.weight).replace(/\s+/g, ' ');
    const style: FontStyle = input.style ?? (target ? asStyle(target.style) : info.style);
    const same = (f: { id: string; weight: string; style: string; unicodeRange: string }) =>
      f.weight === weight && f.style === style && f.unicodeRange === unicodeRange;
    return {
      ...plan,
      target,
      weight,
      style,
      unicodeRange,
      match: target ?? existing?.faces.find(same),
      // Face thay theo id đổi descriptor; một face KHÁC đã mang đúng (weight, style, dải mới) là
      // bản trùng mà file mới thay luôn — để lại thì đụng @@unique của FontFace.
      clash: target ? existing?.faces.find((f) => f.id !== target.id && same(f)) : undefined,
      cssName: existing?.cssName ?? name,
      tokenName: fontTokenName(plan.slug),
    };
  };
  type Resolved = Awaited<ReturnType<typeof resolve>>;
  const familyOut = (r: Resolved) => ({ slug: r.slug, cssName: r.cssName, token: r.tokenName, created: !r.existing });

  // Dải ký tự đoán được mà không cần cắt: giữ byte thì là dải đã cho ("" cho woff2), còn lại là tập cắt.
  const predicted = input.prepared?.unicodeRange ?? (keepBytes ? '' : SUBSET_UNICODE_RANGE);
  let plan = await resolve(predicted);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      family: { ...(plan.existing ? { id: plan.existing.id } : {}), ...familyOut(plan) },
      faces: [{ weight: plan.weight, style: plan.style, subset, bytes: input.bytes.length, replaced: !!plan.match }],
      warnings,
    };
  }

  // ── Ghi ────────────────────────────────────────────────────────────────
  let fileBytes = input.bytes;
  if (!keepBytes) {
    const out = await toWoff2(input.bytes, info.format);
    fileBytes = out.bytes;
    if (out.unicodeRange !== predicted) plan = await resolve(out.unicodeRange);
  }
  // Đuôi khoá theo định dạng THẬT của byte lưu, không theo tên client gửi: tên không đuôi,
  // `download` của sourceUrl hay woff2 đặt tên `.ttf` sẽ ra khoá `/mm-font` từ chối (404) hoặc
  // content-type sai.
  const storedFormat = keepBytes ? info.format : 'woff2';
  const fileName = input.fileName.replace(/(\.[^./\\]*)?$/, `.${storedFormat}`);
  const up = await uploadAsset({
    bytes: fileBytes,
    fileName,
    actorEmail: actor.email,
    actorSub: actor.sub,
    folder: `fonts/${plan.slug}`,
  });
  if (!up.ok) {
    throw new FontError(up.status === 413 ? 'too_large' : 'not_font', up.error);
  }
  const asset = up.asset;

  const write = (r: Resolved) => prisma.$transaction(async (tx) => {
    const { existing, slug, adopt, target, weight, style, unicodeRange, match, clash, cssName, tokenName } = r;
    let familyId = existing?.id;
    if (!familyId) {
      const fam = await tx.fontFamily.create({
        data: {
          slug,
          cssName,
          fallback,
          source,
          googleFamily: input.googleFamily ?? null,
          licenseNote: input.licenseNote?.trim() || null,
          licenseConfirmedBy: source === 'upload' ? actor.email : null,
          createdBy: actor.email,
        },
        select: { id: true },
      });
      familyId = fam.id;
    }

    const faceData = { assetId: asset.id, subset, warnings: warningCodes };
    let faceId: string;
    if (match) {
      if (clash) await tx.fontFace.delete({ where: { id: clash.id } });
      await tx.fontFace.update({
        where: { id: match.id },
        // Thay theo id: dải/weight/kiểu đi theo file mới. Thay vì trùng: ba thứ đó vốn đã bằng.
        data: target ? { ...faceData, unicodeRange, weight, style } : faceData,
      });
      faceId = match.id;
    } else {
      const face = await tx.fontFace.create({
        data: { familyId, weight, style, unicodeRange, ...faceData },
        select: { id: true },
      });
      faceId = face.id;
    }

    const facesAfter = [
      ...(existing?.faces ?? []).filter((f) => f.id !== match?.id && f.id !== clash?.id),
      { weight, style },
    ];
    const aiDescription = describeFontFamily(cssName, existing?.source ?? source, facesAfter);
    if (existing) {
      await tx.token.updateMany({ where: { name: tokenName }, data: { aiDescription } });
    } else if (adopt) {
      // Token tự tạo cùng tên (font của gói): nhận lại, đổi hạng, GIỮ value đang chạy.
      await tx.token.update({ where: { id: adopt.id }, data: { category: 'font', aiDescription } });
    } else {
      await tx.token.create({
        data: { name: tokenName, value: fontTokenValue(cssName, fallback), category: 'font', custom: true, aiDescription },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actor.sub,
        action: match ? 'font.face.replace' : 'font.face.add',
        targetType: 'FontFace',
        targetId: faceId,
        meta: {
          familyId,
          slug,
          cssName,
          weight,
          style,
          unicodeRange,
          assetId: asset.id,
          key: asset.key,
          source,
          createdFamily: !existing,
          ...(adopt ? { adoptedToken: tokenName } : {}),
          ...(target ? { replacedById: true, before: { weight: target.weight, style: target.style, unicodeRange: target.unicodeRange } } : {}),
          ...(clash ? { removedDuplicateFaceId: clash.id } : {}),
        },
      },
    });
    return { familyId };
  });

  let ids: { familyId: string };
  try {
    ids = await write(plan);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Một yêu cầu khác vừa tạo cùng họ/token/face giữa lúc lập kế hoạch và lúc ghi. File đã lên
    // kho (khoá theo nội dung) nên chỉ cần lập kế hoạch lại theo DB mới — lần này họ đã "có".
    plan = await resolve(plan.unicodeRange);
    try {
      ids = await write(plan);
    } catch (e2) {
      if (!isUniqueViolation(e2)) throw e2;
      throw new FontError(
        'conflict',
        'Có người vừa thêm font cùng tên cùng lúc nên chưa lưu được. Hãy thử lại — file đã tải lên sẽ được dùng lại, không tải lại.',
      );
    }
  }

  revalidate(!plan.existing);
  return {
    ok: true,
    dryRun: false,
    family: { id: ids.familyId, ...familyOut(plan) },
    faces: [{ weight: plan.weight, style: plan.style, subset, bytes: asset.bytes, replaced: !!plan.match }],
    warnings,
  };
}

/** P2002: đụng ràng buộc unique. Kiểm theo `code`, không `instanceof` (lớp lỗi Prisma có thể bị nạp hai bản). */
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

// ── Sửa / xoá ──────────────────────────────────────────────────────────────

async function loadFamily(id: string) {
  const fam = await prisma.fontFamily.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      cssName: true,
      fallback: true,
      source: true,
      faces: { select: { id: true, weight: true, style: true, unicodeRange: true } },
    },
  });
  if (!fam) throw new FontError('not_found', 'Không tìm thấy họ font (có thể đã bị xoá).');
  return fam;
}

/** Sửa `cssName`, `fallback`, `licenseNote`. Đổi tên/fallback thì cập nhật `value` của token. */
export async function updateFamily(
  id: string,
  patch: { cssName?: string; fallback?: string; licenseNote?: string | null },
  actor: Actor,
): Promise<void> {
  const fam = await loadFamily(id);
  const data: { cssName?: string; fallback?: string; licenseNote?: string | null } = {};

  if (patch.fallback !== undefined) {
    data.fallback = cleanFallback(patch.fallback);
  }
  if (patch.cssName !== undefined) {
    const name = patch.cssName.trim().replace(/\s+/g, ' ');
    if (name !== fam.cssName) {
      await checkFamilyName(name, data.fallback ?? fam.fallback, fam.id);
      data.cssName = name;
    }
  }
  if (patch.licenseNote !== undefined) {
    data.licenseNote = patch.licenseNote?.trim() || null;
  }
  if (!Object.keys(data).length) return;

  const tokenName = fontTokenName(fam.slug);
  const tokenChanged = data.cssName !== undefined || data.fallback !== undefined;
  await prisma.$transaction(async (tx) => {
    await tx.fontFamily.update({ where: { id }, data });
    if (tokenChanged) {
      const token = await tx.token.findUnique({ where: { name: tokenName }, select: { id: true, value: true } });
      if (token) {
        const cssName = data.cssName ?? fam.cssName;
        // Đổi tên giữ phần fallback đang có trong value (token nhận lại từ gói có thể khác
        // `fam.fallback`); đổi fallback thì dùng fallback mới.
        const fb = data.fallback ?? fallbackPartOf(token.value) ?? fam.fallback;
        await tx.token.update({
          where: { id: token.id },
          data: {
            value: fontTokenValue(cssName, fb),
            aiDescription: describeFontFamily(cssName, fam.source, fam.faces),
          },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        userId: actor.sub,
        action: 'font.family.update',
        targetType: 'FontFamily',
        targetId: id,
        meta: { slug: fam.slug, before: { cssName: fam.cssName, fallback: fam.fallback }, patch: data },
      },
    });
  });
  revalidate(tokenChanged);
}

/** Xoá một face. Chặn khi đó là face cuối của một họ đang được dùng. */
export async function deleteFace(familyId: string, faceId: string, actor: Actor): Promise<void> {
  const fam = await loadFamily(familyId);
  const face = fam.faces.find((f) => f.id === faceId);
  if (!face) throw new FontError('not_found', 'Không tìm thấy face này trong họ font.');

  const tokenName = fontTokenName(fam.slug);
  if (fam.faces.length === 1) {
    const usage = await tokenUsage(tokenName);
    if (usage.pages.length || usage.components.length) {
      throw inUse(`Đây là face cuối của họ "${fam.cssName}", và họ này`, usage);
    }
  }

  const rest = fam.faces.filter((f) => f.id !== faceId);
  await prisma.$transaction(async (tx) => {
    await tx.fontFace.delete({ where: { id: faceId } });
    await tx.token.updateMany({
      where: { name: tokenName },
      data: { aiDescription: describeFontFamily(fam.cssName, fam.source, rest) },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.sub,
        action: 'font.face.delete',
        targetType: 'FontFace',
        targetId: faceId,
        meta: { familyId, slug: fam.slug, weight: face.weight, style: face.style, unicodeRange: face.unicodeRange },
      },
    });
  });
  revalidate(false);
}

/** Xoá họ, face và token. Quyền admin kiểm ở route. Chặn (kèm danh sách) khi còn chỗ dùng. */
export async function deleteFamily(id: string, actor: Actor): Promise<void> {
  const fam = await loadFamily(id);
  const tokenName = fontTokenName(fam.slug);
  const usage = await tokenUsage(tokenName);
  if (usage.pages.length || usage.components.length) {
    throw inUse(`Họ font "${fam.cssName}"`, usage);
  }

  await prisma.$transaction(async (tx) => {
    await tx.token.deleteMany({ where: { name: tokenName } });
    await tx.fontFamily.delete({ where: { id } }); // face đi theo (onDelete: Cascade)
    await tx.auditLog.create({
      data: {
        userId: actor.sub,
        action: 'font.family.delete',
        targetType: 'FontFamily',
        targetId: id,
        meta: { slug: fam.slug, cssName: fam.cssName, faces: fam.faces.length },
      },
    });
  });
  revalidate(true);
}

// ── Danh sách ──────────────────────────────────────────────────────────────

/** Khoá so sánh phần niêm phong của một họ (thứ tự face không quan trọng). */
function sealKey(cssName: string, faces: FontSealFace[]): string {
  const sorted = faces
    .map((f) => [f.key, f.weight, f.style, f.unicodeRange].join('|'))
    .sort();
  return JSON.stringify([cssName, sorted]);
}

/** Họ tải lên (theo tên) rồi họ có sẵn của lõi, kèm chỗ dùng và nhãn "Chưa publish". */
export async function listFonts(): Promise<FontListItem[]> {
  const [rows, site] = await Promise.all([
    prisma.fontFamily.findMany({
      orderBy: { cssName: 'asc' },
      select: {
        id: true,
        slug: true,
        cssName: true,
        fallback: true,
        source: true,
        licenseNote: true,
        licenseConfirmedBy: true,
        faces: {
          orderBy: [{ weight: 'asc' }, { style: 'asc' }, { unicodeRange: 'asc' }],
          select: {
            id: true,
            weight: true,
            style: true,
            unicodeRange: true,
            subset: true,
            warnings: true,
            asset: { select: { key: true, bytes: true } },
          },
        },
      },
    }),
    prisma.site.findFirst({ select: { activeRelease: { select: { fonts: true } } } }),
  ]);

  const live = new Map(
    fontSealOf(site?.activeRelease?.fonts).families.map((f) => [f.slug, sealKey(f.cssName, f.faces)]),
  );

  const builtinTokens = BUILTIN_FAMILIES.flatMap((f) => f.tokens);
  const [usage, builtinRows] = await Promise.all([
    tokenUsageMany([...rows.map((r) => fontTokenName(r.slug)), ...builtinTokens]),
    prisma.token.findMany({ where: { name: { in: builtinTokens } }, select: { name: true, value: true } }),
  ]);
  const usageOf = (name: string): TokenUsage => usage.get(name) ?? { pages: [], components: [] };

  const uploaded: FontListItem[] = rows.map((r) => {
    const draft = sealKey(
      r.cssName,
      r.faces.map((f) => ({ key: f.asset.key, weight: f.weight, style: asStyle(f.style), unicodeRange: f.unicodeRange })),
    );
    return {
      id: r.id,
      cssName: r.cssName,
      token: fontTokenName(r.slug),
      source: r.source === 'google' ? 'google' : 'upload',
      fallback: r.fallback,
      faces: r.faces.map((f) => ({
        id: f.id,
        weight: f.weight,
        style: asStyle(f.style),
        subset: f.subset,
        bytes: f.asset.bytes,
        warnings: asWarnings(f.warnings),
      })),
      usage: usageOf(fontTokenName(r.slug)),
      unpublished: live.get(r.slug) !== draft,
      licenseNote: r.licenseNote,
      licenseConfirmedBy: r.licenseConfirmedBy,
    };
  });

  const builtin: FontListItem[] = BUILTIN_FAMILIES.map((fam) => {
    // `font-body` là token người dùng nhận ra (font mặc định của chữ thân).
    const token = fam.tokens.includes('font-body') ? 'font-body' : (fam.tokens[0] ?? '');
    const value = builtinRows.find((t) => t.name === token)?.value ?? '';
    const pages = new Map<string, UsageRef>();
    const components = new Map<string, UsageRef>();
    for (const t of fam.tokens) {
      for (const p of usageOf(t).pages) pages.set(p.id, p);
      for (const c of usageOf(t).components) components.set(c.id, c);
    }
    return {
      id: null,
      cssName: fam.cssName,
      token,
      source: 'builtin',
      fallback: fallbackPartOf(value) ?? '',
      faces: fam.faces.map(() => ({
        id: null,
        weight: fam.weight,
        style: 'normal' as const,
        subset: '',
        bytes: null,
        warnings: [],
      })),
      usage: { pages: [...pages.values()], components: [...components.values()] },
      unpublished: false,
      licenseNote: null,
      licenseConfirmedBy: null,
    };
  });

  return [...uploaded, ...builtin];
}
