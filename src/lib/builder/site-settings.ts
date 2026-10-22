import 'server-only';

/**
 * Sửa cấu hình site: tên, domain, và `globals`.
 *
 * ## Vì sao tính năng này quan trọng hơn vẻ ngoài
 *
 * Màn Cài đặt chỉ ĐỌC cho tới 26/08/2026. Nghĩa là đổi **số hotline** hay **số
 * giấy phép** bắt buộc phải có một dev với quyền vào database.
 *
 * Đó chính là thứ vi phạm metric thành công duy nhất của dự án — *"một người
 * không phải dev publish được thay đổi mà không cần hỏi dev"* — và nó vi phạm ở
 * đúng loại nội dung mà `globals` được sinh ra để bảo vệ: chuỗi có nghĩa pháp lý,
 * xuất hiện ở nhiều nơi, phải luôn khớp nhau.
 *
 * ## Ba lớp bảo vệ, và vì sao mỗi lớp tồn tại
 *
 *  1. **Chỉ `admin`.** Không phải `write`. Số giấy phép không nên nằm sau cùng
 *     một quyền với "sửa tiêu đề trang".
 *  2. **Ghi `AuditLog` kèm giá trị TRƯỚC và SAU.** Với chuỗi tuân thủ, câu "ai
 *     đổi, từ gì sang gì, lúc nào" phải trả lời được — và trả lời được *sau* khi
 *     có người hỏi thì đã muộn.
 *  3. **Từ chối xoá khoá đang được dùng.** Xoá một khoá làm binding rơi về
 *     `fallback` — chuỗi tác giả gõ sẵn từ lâu. Trang vẫn 200, và có thể đang
 *     hiện một số giấy phép cũ. Nó *trông* bình thường.
 *
 * ## Vì sao `globals` sửa được mà không cần Publish… nhưng site vẫn chưa đổi
 *
 * `Release.globals` là ẢNH CHỤP. `render/page.ts` đọc `entry.release.globals`,
 * không đọc bảng live — nên sửa ở đây **không đổi site thật cho tới khi Publish**.
 * Màn hình PHẢI nói câu đó, nếu không người ta sửa hotline rồi tưởng đã xong.
 */

import type { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';

import { prisma } from '@/lib/db';
import { FAVICON_MIMES } from '@/lib/assets/favicon-mimes';
import { SITE_ICONS_TAG } from '@/lib/render/site-icons';
import { BUILDER_BRANDING_TAG } from '@/lib/builder/branding';
import type { SessionPayload } from '@/lib/auth/session';
import { applyOpsToPage } from '@/lib/doc/apply-to-page';
import { applyOpsToPreset } from '@/lib/doc/apply-to-preset';
import {
  checkEndpointTable,
  ENDPOINT_KEY_RE,
  readEndpointTable,
  suggestEndpointKey,
  type EndpointTable,
} from '@/lib/doc/endpoint-table';
import { endpointFormsIn, type EndpointFormRef } from '@/lib/doc/endpoint-usage';
import { migrateDoc, migratePresetTree } from '@/lib/doc/migrate';
import { ENDPOINT_KEY, findSiteBindings, type SiteBindingUsage } from '@/lib/doc/site-bindings';
import type { Actor } from '@/lib/doc/validate';

/** Tên khoá hợp lệ. Hẹp vì nó đi vào đường dẫn binding (`site.<khoá>`). */
export const GLOBAL_KEY_RE = /^[a-z][a-z0-9_-]{0,48}$/i;

export interface KeyUsage {
  key: string;
  /** Trang đang dùng khoá này, kèm node. */
  pages: { slug: string; title: string; nodeIds: string[] }[];
  /** Component (preset) đang dùng khoá này. */
  components: string[];
}

/**
 * Khoá `globals` nào đang được dùng ở đâu.
 *
 * Quét **cả `PageVersion` của bản nháp lẫn `Preset.tree`**. Bỏ preset là lặp lại
 * đúng lỗi của Audit panel Webflow: nó không kiểm bên trong component, nên càng
 * componentize — tức càng làm đúng hướng bảo trì — càng nhiều thứ nằm ngoài tầm
 * kiểm tra.
 */
export async function siteGlobalUsage(): Promise<Map<string, KeyUsage>> {
  const [pages, presets] = await Promise.all([
    prisma.page.findMany({
      where: { archivedAt: null },
      select: { slug: true, title: true, draftVersion: { select: { doc: true } } },
    }),
    prisma.preset.findMany({ select: { name: true, tree: true } }),
  ]);

  const out = new Map<string, KeyUsage>();
  const touch = (key: string): KeyUsage => {
    const found = out.get(key);
    if (found) return found;
    const fresh: KeyUsage = { key, pages: [], components: [] };
    out.set(key, fresh);
    return fresh;
  };

  for (const p of pages) {
    if (!p.draftVersion) continue;
    const usage: SiteBindingUsage = findSiteBindings(p.draftVersion.doc);
    for (const [key, nodeIds] of usage) {
      touch(key).pages.push({ slug: p.slug, title: p.title, nodeIds });
    }
  }

  for (const c of presets) {
    for (const key of findSiteBindings(c.tree).keys()) {
      touch(key).components.push(c.name);
    }
  }

  return out;
}

export interface UpdateResult {
  ok: boolean;
  status: number;
  error?: string;
  /** Có khi bị chặn vì xoá khoá đang dùng. */
  inUse?: KeyUsage[];
}

export async function updateSiteSettings(args: {
  session: SessionPayload;
  name?: string;
  primaryDomain?: string;
  /** Thay TOÀN BỘ globals. Khoá vắng mặt = xoá. */
  globals?: Record<string, unknown>;
  /** Id asset dùng làm favicon. `null` = bỏ favicon. Vắng mặt = giữ nguyên. */
  faviconAssetId?: string | null;
  /**
   * Id asset dùng làm ảnh chia sẻ MẶC ĐỊNH. `null` = bỏ. Vắng mặt = giữ nguyên.
   *
   * Xem `Site.ogImageId`: đây là hàng rào cuối để một trang chưa ai đặt ảnh riêng
   * vẫn chia sẻ ra thẻ có ảnh.
   */
  ogImageId?: string | null;
  /** Logo của builder. `null` = về logo mặc định. Vắng mặt = giữ nguyên. Xem `lib/builder/branding.ts`. */
  builderLogoAssetId?: string | null;
  /** Favicon RIÊNG của tab builder — chỉ có tác dụng khi `builderFaviconUseSite` tắt. */
  builderFaviconAssetId?: string | null;
  /** Tab builder dùng chung favicon của web. */
  builderFaviconUseSite?: boolean;
  /** Cho phép xoá khoá đang được dùng. Chỉ đặt khi người dùng đã thấy danh sách. */
  force?: boolean;
}): Promise<UpdateResult> {
  const { session, name, primaryDomain, globals, force } = args;
  const faviconGiven = 'faviconAssetId' in args;
  const ogGiven = 'ogImageId' in args;
  const logoGiven = 'builderLogoAssetId' in args;
  const builderIconGiven = 'builderFaviconAssetId' in args;
  const useSiteGiven = typeof args.builderFaviconUseSite === 'boolean';

  const site = await prisma.site.findFirst({
    select: {
      id: true, name: true, primaryDomain: true, globals: true,
      faviconAssetId: true, ogImageId: true,
      builderLogoAssetId: true, builderFaviconAssetId: true, builderFaviconUseSite: true,
    },
  });
  if (!site) return { ok: false, status: 404, error: 'Chưa có site nào' };

  if (name !== undefined && !name.trim()) {
    return { ok: false, status: 400, error: 'Tên site không được rỗng' };
  }
  if (primaryDomain !== undefined && !primaryDomain.trim()) {
    return { ok: false, status: 400, error: 'Domain không được rỗng' };
  }
  if (primaryDomain?.includes('://')) {
    return {
      ok: false,
      status: 400,
      error: 'Domain chỉ là tên miền, không có scheme. URL đầy đủ là biến môi trường SITE_URL.',
    };
  }

  /*
   * `endpoint` có ô riêng ("Endpoint form", `updateSiteEndpoints`) và bảng khoá–giá trị
   * KHÔNG gửi nó nữa. Vắng mặt ở đây nghĩa là "không đụng", không phải "xoá": không giữ
   * lại thì bấm Lưu ở bảng biến là gỡ đích gửi của mọi form trên site.
   */
  if (globals && !(ENDPOINT_KEY in globals)) {
    const kept = ((site.globals ?? {}) as Record<string, unknown>)[ENDPOINT_KEY];
    if (kept !== undefined) globals[ENDPOINT_KEY] = kept;
  }

  if (globals) {
    const bad = Object.keys(globals).filter((k) => !GLOBAL_KEY_RE.test(k));
    if (bad.length) {
      return {
        ok: false,
        status: 400,
        error: `Tên khoá không hợp lệ: ${bad.join(', ')}. Chỉ chữ, số, gạch ngang, gạch dưới.`,
      };
    }

    /*
     * Khoá bị XOÁ mà đang được dùng thì dừng lại và trả về danh sách.
     *
     * Không âm thầm cho qua, và cũng không chặn vĩnh viễn: người dùng có thể thật
     * sự muốn xoá, nhưng họ phải THẤY nó đang ở đâu trước. Đây là chỗ duy nhất
     * trong màn này mà một cái bấm sai để lại hậu quả không tự lộ ra.
     */
    const before = (site.globals ?? {}) as Record<string, unknown>;
    const removed = Object.keys(before).filter((k) => !(k in globals));

    if (removed.length && !force) {
      const usage = await siteGlobalUsage();
      const blocking = removed.map((k) => usage.get(k)).filter((u): u is KeyUsage => !!u);
      if (blocking.length) {
        return {
          ok: false,
          status: 409,
          error:
            `Đang xoá ${blocking.length} khoá vẫn được dùng. Binding trỏ vào khoá đã mất sẽ ` +
            'rơi về chữ dự phòng — trang vẫn hiện, nhưng có thể hiện giá trị cũ.',
          inUse: blocking,
        };
      }
    }
  }

  /*
   * Kiểm favicon TRƯỚC khi ghi: một id không tồn tại hay một JPEG lọt vào chỉ biểu
   * hiện thành "tab không có icon" — không lỗi, không dấu vết, và người dùng sẽ đi
   * xoá cache trình duyệt thay vì nhìn lại thứ họ vừa chọn.
   */
  if (faviconGiven && args.faviconAssetId) {
    const asset = await prisma.asset.findUnique({
      where: { id: args.faviconAssetId },
      select: { mime: true },
    });
    if (!asset) return { ok: false, status: 404, error: 'Không có ảnh nào với id đó' };
    if (!FAVICON_MIMES.has(asset.mime)) {
      return {
        ok: false,
        status: 400,
        error:
          `Favicon phải là PNG hoặc SVG, ảnh này là ${asset.mime}. ` +
          'JPEG không có nền trong suốt nên logo sẽ có một ô vuông quanh nó trên tab.',
      };
    }
  }

  /*
   * Nhận diện builder: kiểm cùng kiểu với favicon của web, cùng lý do — chọn sai chỉ
   * hiện ra thành "logo không hiện" mà không có dấu vết nào.
   */
  if (builderIconGiven && args.builderFaviconAssetId) {
    const asset = await prisma.asset.findUnique({
      where: { id: args.builderFaviconAssetId },
      select: { mime: true },
    });
    if (!asset) return { ok: false, status: 404, error: 'Không có ảnh nào với id đó' };
    if (!FAVICON_MIMES.has(asset.mime)) {
      return { ok: false, status: 400, error: `Favicon builder phải là PNG hoặc SVG, ảnh này là ${asset.mime}.` };
    }
  }
  if (logoGiven && args.builderLogoAssetId) {
    const asset = await prisma.asset.findUnique({
      where: { id: args.builderLogoAssetId },
      select: { mime: true },
    });
    if (!asset) return { ok: false, status: 404, error: 'Không có ảnh nào với id đó' };
    if (!asset.mime.startsWith('image/')) {
      return { ok: false, status: 400, error: `Logo phải là ảnh, tệp này là ${asset.mime}.` };
    }
  }

  const data: Record<string, unknown> = {};
  if (logoGiven) data.builderLogoAssetId = args.builderLogoAssetId ?? null;
  if (builderIconGiven) data.builderFaviconAssetId = args.builderFaviconAssetId ?? null;
  if (useSiteGiven) data.builderFaviconUseSite = args.builderFaviconUseSite;
  if (faviconGiven) data.faviconAssetId = args.faviconAssetId ?? null;
  if (ogGiven) data.ogImageId = args.ogImageId ?? null;
  if (name !== undefined) data.name = name.trim();
  if (primaryDomain !== undefined) data.primaryDomain = primaryDomain.trim();
  if (globals !== undefined) data.globals = globals;

  if (!Object.keys(data).length) {
    return { ok: false, status: 400, error: 'Không có gì để đổi' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.site.update({ where: { id: site.id }, data });
    await tx.auditLog.create({
      data: {
        userId: session.sub,
        action: 'site.settings.update',
        targetType: 'Site',
        targetId: site.id,
        meta: {
          // Trước VÀ sau. Một bản ghi chỉ có "sau" không trả lời được câu hỏi
          // người ta thật sự hỏi khi soát lại: giá trị cũ là gì.
          before: {
            ...(faviconGiven ? { faviconAssetId: site.faviconAssetId } : {}),
            ...(logoGiven ? { builderLogoAssetId: site.builderLogoAssetId } : {}),
            ...(builderIconGiven ? { builderFaviconAssetId: site.builderFaviconAssetId } : {}),
            ...(useSiteGiven ? { builderFaviconUseSite: site.builderFaviconUseSite } : {}),
            ...(name !== undefined ? { name: site.name } : {}),
            ...(primaryDomain !== undefined ? { primaryDomain: site.primaryDomain } : {}),
            ...(globals !== undefined ? { globals: site.globals } : {}),
          },
          after: data,
          forced: force ?? false,
          via: session.kind === 'service' ? 'mcp' : 'builder',
          // `data` là `Record<string, unknown>` vì nó được dựng từng nhánh một;
          // Prisma đòi `InputJsonObject`. Ép ở đúng một chỗ, giống publish route.
        } as unknown as Prisma.InputJsonObject,
      },
    });
  });

  /*
   * Favicon được bọc `unstable_cache` với tag riêng. Không xoá tag thì người dùng
   * đổi logo, F5, và vẫn thấy logo cũ cho tới khi cache tự hết — rồi họ đi xoá
   * cache trình duyệt cho một thứ không nằm ở trình duyệt.
   */
  if (faviconGiven && (args.faviconAssetId ?? null) !== site.faviconAssetId) {
    revalidateTag(SITE_ICONS_TAG);
  }

  /*
   * Ảnh chia sẻ đi qua `getSiteShare`, vốn gắn tag `release`.
   *
   * Không xoá tag thì người dùng đổi ảnh, dán link vào Zalo, và vẫn thấy ảnh cũ —
   * rồi họ sẽ đi tìm nút "xoá cache" của Zalo cho một thứ nằm ở cache của mình.
   */
  if (ogGiven && (args.ogImageId ?? null) !== site.ogImageId) {
    revalidateTag('release');
  }

  // Nhận diện builder — kể cả khi chỉ favicon của WEB đổi: tab builder đang dùng chung
  // nó thì cũng phải đổi theo.
  if (logoGiven || builderIconGiven || useSiteGiven || faviconGiven) {
    revalidateTag(BUILDER_BRANDING_TAG);
  }

  return { ok: true, status: 200 };
}

/* ── Endpoint form ────────────────────────────────────────────────────── */

type FormHome =
  | { kind: 'page'; id: string; slug: string; title: string }
  | { kind: 'component'; id: string; name: string };

/** Một form trên site đang đọc một khoá endpoint — đủ để bày tên và mở đúng chỗ. */
export interface EndpointFormUse {
  nodeId: string;
  label: string;
  composite: 'Form' | 'NavChart';
  where: FormHome;
  /**
   * Link mở editor NGAY TẠI form — cùng dạng với "Copy link cho AI" (`EditorShell` đọc).
   * Form trong component mở qua một trang đang cắm component đó; không trang nào cắm thì
   * về trang quản lý component.
   */
  href: string;
}

export interface EndpointUsage {
  key: string;
  forms: EndpointFormUse[];
}

type ScannedForm = EndpointFormRef & { where: FormHome; href: string };

/**
 * Mọi Form / NavChart trên site: bản nháp của mọi trang chưa lưu trữ + cây component —
 * cùng phạm vi với `siteGlobalUsage`, cùng lý do: bỏ component là bỏ đúng form ở footer
 * dùng chung cho cả site.
 */
async function scanEndpointForms(): Promise<ScannedForm[]> {
  const [pages, presets] = await Promise.all([
    prisma.page.findMany({
      where: { archivedAt: null },
      orderBy: { slug: 'asc' },
      select: { id: true, slug: true, title: true, draftVersion: { select: { doc: true } } },
    }),
    prisma.preset.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, tree: true } }),
  ]);

  const out: ScannedForm[] = [];
  /** Component → trang ĐẦU TIÊN (theo slug) đang cắm nó, để mở form trong ngữ cảnh. */
  const host = new Map<string, string>();

  for (const p of pages) {
    if (!p.draftVersion) continue;
    const doc = migrateDoc(p.draftVersion.doc);
    for (const node of Object.values(doc.nodes)) {
      if (node.type === 'Instance' && !host.has(node.componentId)) host.set(node.componentId, p.id);
    }
    const where: FormHome = { kind: 'page', id: p.id, slug: p.slug, title: p.title };
    for (const f of endpointFormsIn(doc)) {
      out.push({ ...f, where, href: `/builder/${p.id}?node=${encodeURIComponent(f.nodeId)}` });
    }
  }

  for (const c of presets) {
    const tree = migratePresetTree(c.tree);
    const where: FormHome = { kind: 'component', id: c.id, name: c.name };
    const page = host.get(c.id);
    for (const f of endpointFormsIn(tree)) {
      const href = page
        ? `/builder/${page}?component=${encodeURIComponent(c.id)}&node=${encodeURIComponent(f.nodeId)}`
        : `/builder/components/${c.id}`;
      out.push({ ...f, where, href });
    }
  }
  return out;
}

function groupUsage(forms: ScannedForm[]): EndpointUsage[] {
  const out = new Map<string, EndpointUsage>();
  for (const { key, nodeId, label, composite, where, href } of forms) {
    const entry = out.get(key) ?? { key, forms: [] };
    entry.forms.push({ nodeId, label, composite, where, href });
    out.set(key, entry);
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Khoá endpoint nào đang được form nào đọc, ở đâu — cho ô "Endpoint form" ở màn Cài đặt. */
export async function endpointUsage(): Promise<EndpointUsage[]> {
  return groupUsage(await scanEndpointForms());
}

/**
 * Ghi bảng `globals.endpoint` — và CHỈ bảng đó — kèm ĐỔI TÊN khoá nếu có.
 *
 * ## Vì sao đường ghi riêng
 *
 * Ô "Endpoint form" và bảng "Biến của site" là hai form độc lập trên cùng màn. Nếu cả
 * hai gửi TOÀN BỘ `globals`, form lưu sau ghi đè phần form kia vừa lưu bằng bản cũ.
 *
 * ## Đổi tên khoá = đổi khoá của mọi form đang dùng nó
 *
 * Khoá nằm ở HAI nơi: bảng này và `params.endpointKey` của từng form. Chỉ đổi ở bảng thì
 * mọi form còn trỏ tên cũ và mất đích gửi ở lần Publish sau. Nên `renames` (cũ → mới) ghi
 * cả hai, theo thứ tự để KHÔNG lúc nào có form mất đích, kể cả khi hỏng giữa chừng:
 *  1. bảng giữ CẢ khoá cũ lẫn khoá mới;
 *  2. đổi `endpointKey` của từng form — qua `applyOpsToPage` / `applyOpsToPreset`, tức
 *     cùng validator, cùng lịch sử, cùng nhãn như một lần sửa tay; ghi vào BẢN NHÁP;
 *  3. bỏ khoá cũ khỏi bảng.
 * Hỏng ở bước 2 thì dừng: bảng còn cả hai khoá, form nào đã đổi hay chưa đều còn đích.
 *
 * Cùng các lớp bảo vệ với `updateSiteSettings`: chỉ admin (ở route), `AuditLog` trước và
 * sau, và từ chối xoá khoá đang có form dùng trừ khi `force`.
 */
export async function updateSiteEndpoints(args: {
  session: SessionPayload;
  endpoints: EndpointTable;
  /** Khoá cũ → khoá mới. Khoá mới phải có trong `endpoints`, khoá cũ thì không. */
  renames?: Record<string, string>;
  force?: boolean;
}): Promise<UpdateResult & { inUseEndpoints?: EndpointUsage[]; moved?: number }> {
  const { session, force } = args;

  if (!args.endpoints || typeof args.endpoints !== 'object' || Array.isArray(args.endpoints)) {
    return { ok: false, status: 400, error: 'endpoints phải là object khoá → URL' };
  }
  const table: EndpointTable = Object.fromEntries(
    Object.entries(args.endpoints).map(([k, v]) => [k.trim(), typeof v === 'string' ? v.trim() : v]),
  );
  const invalid = checkEndpointTable(table);
  if (invalid) return { ok: false, status: 400, error: invalid };

  const renames = Object.entries(args.renames ?? {});
  for (const [from, to] of renames) {
    if (!ENDPOINT_KEY_RE.test(from) || typeof to !== 'string' || from === to) {
      return { ok: false, status: 400, error: `Đổi tên khoá "${from}" không hợp lệ.` };
    }
    if (!(to in table)) {
      return { ok: false, status: 400, error: `Khoá mới "${to}" phải có URL trong bảng.` };
    }
    if (from in table) {
      return { ok: false, status: 400, error: `Khoá cũ "${from}" vẫn còn trong bảng — đổi tên thì bỏ nó đi.` };
    }
  }
  const renameTo = new Map(renames);

  const site = await prisma.site.findFirst({ select: { id: true, globals: true } });
  if (!site) return { ok: false, status: 404, error: 'Chưa có site nào' };

  const globals = (site.globals ?? {}) as Record<string, unknown>;
  const before = readEndpointTable(globals);
  const forms = await scanEndpointForms();

  // Khoá biến khỏi bảng mà KHÔNG phải được đổi tên thì là xoá.
  const removed = Object.keys(before).filter((k) => !(k in table) && !renameTo.has(k));
  if (removed.length && !force) {
    const blocking = groupUsage(forms.filter((f) => removed.includes(f.key)));
    if (blocking.length) {
      return {
        ok: false,
        status: 409,
        error:
          `Đang xoá ${blocking.length} khoá vẫn có form dùng. Sau lần Publish tới, những form đó ` +
          'hiện "chưa có đích gửi" và không nhận đăng ký nào.',
        inUseEndpoints: blocking,
      };
    }
  }

  const writeTable = async (t: EndpointTable) => {
    const next: Record<string, unknown> = { ...globals };
    if (Object.keys(t).length) next[ENDPOINT_KEY] = t;
    else delete next[ENDPOINT_KEY];
    await prisma.site.update({ where: { id: site.id }, data: { globals: next as Prisma.InputJsonObject } });
  };

  const moving = forms.filter((f) => renameTo.has(f.key));
  if (moving.length) {
    // Bước 1: cả khoá cũ lẫn mới — form chưa đổi vẫn còn đích trong lúc đổi.
    const both: EndpointTable = { ...table };
    for (const [from] of renames) if (before[from]) both[from] = before[from];
    await writeTable(both);

    // Bước 2: đổi `endpointKey` trên từng trang / component, mỗi nơi MỘT batch.
    const actor: Actor = session.kind === 'service' ? 'ai' : 'human';
    const label = `Đổi khoá endpoint ${renames.map(([a, b]) => `${a} → ${b}`).join(', ')}`;
    const byHome = new Map<string, ScannedForm[]>();
    for (const f of moving) {
      const k = `${f.where.kind}:${f.where.id}`;
      byHome.set(k, [...(byHome.get(k) ?? []), f]);
    }
    for (const group of byHome.values()) {
      const where = group[0]!.where;
      const ops = group.map((f) => ({
        op: 'setProps',
        nodeId: f.nodeId,
        props: { params: { ...f.params, endpointKey: renameTo.get(f.key) } },
      }));
      const result =
        where.kind === 'page'
          ? await applyOpsToPage({ pageId: where.id, ops, actor, session, label })
          : await applyOpsToPreset({ presetId: where.id, ops, actor, session, label });
      if (!result.ok) {
        const place = where.kind === 'page' ? `trang /${where.slug}` : `component ${where.name}`;
        return {
          ok: false,
          status: result.status >= 400 ? result.status : 500,
          error:
            `Không đổi được khoá của form trên ${place}: ${result.error ?? 'lỗi không rõ'}. ` +
            'Bảng endpoint đang giữ cả khoá cũ lẫn khoá mới nên không form nào mất đích gửi — sửa lỗi rồi lưu lại.',
        };
      }
    }
  }

  // Bước 3 (hoặc bước duy nhất khi không có form nào phải đổi).
  await writeTable(table);
  await prisma.auditLog.create({
    data: {
      userId: session.sub,
      action: 'site.endpoints.update',
      targetType: 'Site',
      targetId: site.id,
      meta: {
        before,
        after: table,
        ...(renames.length ? { renames: Object.fromEntries(renames), movedForms: moving.length } : {}),
        forced: force ?? false,
        via: session.kind === 'service' ? 'mcp' : 'builder',
      } as unknown as Prisma.InputJsonObject,
    },
  });

  return { ok: true, status: 200, moved: moving.length };
}

/**
 * Hành động trên MỘT form, từ box của nó ở màn Cài đặt (ô "Form").
 *
 * Màn Cài đặt nghĩ theo FORM, không theo khoá: người dùng thấy "Form danh sách chờ gửi
 * tới URL này", không thấy bảng khoá → URL. Khoá vẫn là cơ chế bên dưới (xem
 * `formParams.endpointKey`), nên mỗi hành động ở đây dịch về đúng một thay đổi của bảng
 * và/hoặc của form:
 *  - `setUrl`: đổi URL của khoá form đang dùng — mọi form dùng chung khoá đổi theo;
 *  - `split`: cho form một khoá RIÊNG (đặt từ tên form) mang URL đã cho;
 *  - `rename`: đặt tên node của form — ghi vào bản nháp, như đổi tên trong Inspector;
 *  - `removeKey`: bỏ một URL không form nào dùng.
 */
export type FormEndpointAction =
  | { action: 'setUrl'; key: string; url: string }
  | { action: 'split'; place: FormHome['kind']; placeId: string; nodeId: string; url: string }
  | { action: 'rename'; place: FormHome['kind']; placeId: string; nodeId: string; name: string }
  | { action: 'removeKey'; key: string; force?: boolean };

export async function formEndpointAction(
  session: SessionPayload,
  a: FormEndpointAction,
): Promise<UpdateResult & { key?: string; inUseEndpoints?: EndpointUsage[] }> {
  const site = await prisma.site.findFirst({ select: { id: true, globals: true } });
  if (!site) return { ok: false, status: 404, error: 'Chưa có site nào' };
  const globals = (site.globals ?? {}) as Record<string, unknown>;
  const before = readEndpointTable(globals);

  const writeTable = (t: EndpointTable) => {
    const next: Record<string, unknown> = { ...globals };
    if (Object.keys(t).length) next[ENDPOINT_KEY] = t;
    else delete next[ENDPOINT_KEY];
    return prisma.site.update({ where: { id: site.id }, data: { globals: next as Prisma.InputJsonObject } });
  };
  const audit = (meta: Record<string, unknown>) =>
    prisma.auditLog.create({
      data: {
        userId: session.sub,
        action: `site.endpoints.${a.action}`,
        targetType: 'Site',
        targetId: site.id,
        meta: { ...meta, via: session.kind === 'service' ? 'mcp' : 'builder' } as unknown as Prisma.InputJsonObject,
      },
    });
  const actor: Actor = session.kind === 'service' ? 'ai' : 'human';

  if (a.action === 'setUrl') {
    const key = String(a.key ?? '').trim();
    const url = String(a.url ?? '').trim();
    const invalid = checkEndpointTable({ [key]: url });
    if (invalid) return { ok: false, status: 400, error: invalid };
    await writeTable({ ...before, [key]: url });
    await audit({ key, before: before[key] ?? null, after: url });
    return { ok: true, status: 200, key };
  }

  if (a.action === 'removeKey') {
    const key = String(a.key ?? '');
    if (!(key in before)) return { ok: false, status: 404, error: `Không có khoá "${key}"` };
    const using = groupUsage((await scanEndpointForms()).filter((f) => f.key === key));
    if (using.length && !a.force) {
      return {
        ok: false,
        status: 409,
        error: 'Vẫn có form dùng URL này. Xoá thì form đó tắt ở lần Publish sau.',
        inUseEndpoints: using,
      };
    }
    const next = { ...before };
    delete next[key];
    await writeTable(next);
    await audit({ key, before: before[key], forced: a.force ?? false });
    return { ok: true, status: 200 };
  }

  // `split` / `rename`: cần đúng form, ở đúng nơi.
  const forms = await scanEndpointForms();
  const form = forms.find(
    (f) => f.where.kind === a.place && f.where.id === a.placeId && f.nodeId === a.nodeId,
  );
  if (!form) return { ok: false, status: 404, error: 'Không thấy form này trong bản nháp — tải lại trang Cài đặt.' };
  const apply = (ops: unknown[], label: string) =>
    form.where.kind === 'page'
      ? applyOpsToPage({ pageId: form.where.id, ops, actor, session, label })
      : applyOpsToPreset({ presetId: form.where.id, ops, actor, session, label });

  if (a.action === 'rename') {
    const name = String(a.name ?? '').trim().slice(0, 120) || null;
    const result = await apply([{ op: 'setName', nodeId: form.nodeId, name }], name ? `đổi tên: ${name}` : 'xoá tên');
    if (!result.ok) return { ok: false, status: result.status, error: result.error ?? 'Không đổi được tên' };
    return { ok: true, status: 200 };
  }

  // split
  const url = String(a.url ?? '').trim();
  const taken = new Set([...Object.keys(before), ...forms.map((f) => f.key)]);
  const key = suggestEndpointKey(form.label, taken);
  const invalid = checkEndpointTable({ [key]: url });
  if (invalid) return { ok: false, status: 400, error: invalid.replace(`"${key}"`, 'của form') };

  // Bảng TRƯỚC, form SAU: lúc giữa hai bước, form vẫn trỏ khoá cũ còn nguyên URL.
  await writeTable({ ...before, [key]: url });
  const result = await apply(
    [{ op: 'setProps', nodeId: form.nodeId, props: { params: { ...form.params, endpointKey: key } } }],
    `tách URL riêng: ${key}`,
  );
  if (!result.ok) {
    await writeTable(before);
    return { ok: false, status: result.status, error: result.error ?? 'Không gán được khoá mới cho form' };
  }
  await audit({ key, from: form.key, url, form: { where: form.where, nodeId: form.nodeId } });
  return { ok: true, status: 200, key };
}

