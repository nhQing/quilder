'use client';

/**
 * Khối "SEO" trong form bài — ô nhập của field kiểu `seo`.
 *
 * ## Người dùng thật là biên tập viên, không phải dev
 *
 * Nhãn tiếng Việt, không lộ JSON ở phần chính (JSON-LD nằm trong "Nâng cao"). Khối mặc
 * định ĐÓNG: phần lớn bài để trống mọi ô, và dòng tóm tắt trên tiêu đề khối nói trạng
 * thái mà không phải mở ra.
 *
 * ## Placeholder là đúng cái Google sẽ thấy
 *
 * Mọi ô là GIÁ TRỊ GHI ĐÈ. Ô trống rơi về luật suy ra — và placeholder hiện CHÍNH giá
 * trị rơi về đó, tính bằng `resolveEntrySeo`, cùng hàm mà site dùng lúc render. Khung
 * xem trước Google cũng vậy. Một bản tính thứ hai ở đây sẽ nói một đằng còn `<title>`
 * thật nói một nẻo.
 *
 * ## Tab ngôn ngữ phụ
 *
 * Giá trị là LỚP PHỦ của ngôn ngữ đó. Placeholder và khung xem trước tính trên dữ liệu
 * ĐÃ phủ (`ctx.effective`, qua `applyEntryLocale` với `seoKey`), nên chúng nói đúng luật
 * `localizeSeo`: chữ, canonical, noindex không kế thừa bản gốc; ảnh OG thì có.
 */

import { useId } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import type { FieldDef } from '@/lib/collections/field-def';
import { SEO_LIMITS, asSeo, charCount, normalizeCanonical, resolveEntrySeo, type SeoValue } from '@/lib/collections/seo';
import { AssetField } from './AssetField';
import { Checkbox } from './ui/Field';
import { Icon } from './ui/Icon';

export interface SeoContext {
  /** Dữ liệu ĐÃ phủ ngôn ngữ của tab đang mở — luật rơi về tính trên đây. */
  effective: Record<string, unknown>;
  shape: { titleField: string | null; fields: FieldDef[] };
  /** Gốc site để hiện URL trong khung xem trước, ví dụ `https://ten-mien.vn`. */
  origin: string;
  /**
   * Host ĐÃ CẤU HÌNH của site (`configuredSiteOrigin`), `null` khi chưa đặt domain — đúng
   * giá trị đường ghi dùng để nhận canonical tuyệt đối, để form không báo sai một URL
   * mà server sẽ nhận.
   */
  siteHost: string | null;
  /** `title.template` của site (`%s | MaiMoney`), hoặc `null` khi không bật. */
  titleTemplate: string | null;
  /** Đường dẫn của chính bài ở tab này (`/en/blogs/post/x`), `null` khi loại không có trang chi tiết. */
  selfPath: string | null;
  /** Mã ngôn ngữ của tab phụ (`en`), `null` ở bản gốc. */
  locale: string | null;
}

type Shape = SeoValue & { ogImage?: { assetId?: string; alt?: string } };

function asValue(v: unknown): Shape {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Shape) : {};
}

/** Bộ đếm `48/60` — vàng khi quá mức nên có, đỏ khi quá trần lưu được. */
function Counter({ n, warn, max }: { n: number; warn: number; max: number }) {
  const tone = n > max ? 'text-shell-danger' : n > warn ? 'text-shell-warn' : 'text-shell-muted';
  return (
    <span className={cn('font-shell-mono text-micro tabular-nums', tone)}>
      {n}/{warn}
    </span>
  );
}

function lengthHint(n: number, warn: number, max: number, what: string): string | null {
  if (n > max) return `Dài quá ${max} ký tự — sẽ không lưu được.`;
  if (n > warn) return `Google thường cắt ${what} sau khoảng ${warn} ký tự.`;
  return null;
}

export function SeoFieldInput({
  field,
  value,
  onChange,
  ctx,
}: {
  field: Extract<FieldDef, { t: 'seo' }>;
  value: unknown;
  onChange: (v: unknown) => void;
  ctx: SeoContext | undefined;
}) {
  const id = useId();
  const v = asValue(value);
  const set = (patch: Partial<Shape>) => onChange({ ...v, ...patch });

  // Giá trị RƠI VỀ: chính dữ liệu đang có, với field SEO để trống.
  const shape = ctx?.shape ?? { titleField: null, fields: [field] };
  const effective = ctx?.effective ?? {};
  const fallback = resolveEntrySeo(shape, { ...effective, [field.key]: {} });
  // Giá trị HIỆU LỰC: thứ site sẽ phát. Ở tab phụ, `effective[field.key]` đã qua `localizeSeo`.
  const live = resolveEntrySeo(shape, effective);

  const template = ctx?.titleTemplate ?? null;
  const shownTitle = live.titleIsOverride || !template ? (live.title ?? '') : template.replace('%s', live.title ?? '');
  const selfUrl = ctx?.selfPath ? `${ctx.origin.replace(/\/$/, '')}${ctx.selfPath}` : null;

  const title = typeof v.metaTitle === 'string' ? v.metaTitle : '';
  const desc = typeof v.metaDescription === 'string' ? v.metaDescription : '';
  const titleN = charCount(title.trim());
  const descN = charCount(desc.trim());
  const canonical = typeof v.canonicalUrl === 'string' ? v.canonicalUrl : '';
  const ownAsset = v.ogImage?.assetId ?? null;
  const inheritedAsset = !ownAsset ? live.imageAssetId : null;

  const own = asSeo(value);
  const set_ = [
    own.metaTitle && 'tiêu đề',
    own.metaDescription && 'mô tả',
    own.ogImage?.assetId && 'ảnh',
    own.noindex && 'ẩn khỏi Google',
    own.keywords && 'từ khoá',
    own.canonicalUrl && 'đường dẫn chuẩn',
    own.structuredData && 'JSON-LD',
  ].filter(Boolean) as string[];
  const summary = set_.length ? `Đã đặt riêng: ${set_.join(', ')}` : 'Đang dùng giá trị tự động';

  const canonicalCheck = canonical.trim() ? normalizeCanonical(canonical, ctx?.siteHost ?? null) : null;
  // Tab phụ: đường dẫn không mang tiền tố ngôn ngữ là trỏ sang trang của ngôn ngữ khác.
  const crossLocale =
    ctx?.locale && canonicalCheck?.ok && !canonicalCheck.path.startsWith(`/${ctx.locale}/`) && canonicalCheck.path !== `/${ctx.locale}`;

  const structuredText =
    v.structuredData === undefined || v.structuredData === null ? '' : JSON.stringify(v.structuredData, null, 2);

  return (
    <details className={cn(ui.inset, 'group px-4 py-3')}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 rounded-sm select-none [&::-webkit-details-marker]:hidden',
          focusRing,
        )}
      >
        <Icon name="chevron-right" size={16} className="text-shell-muted transition-transform group-open:rotate-90" />
        <span className={ui.label}>{field.label}</span>
        <span className="font-shell-mono text-micro text-shell-muted">{field.key}</span>
        <span className="ml-auto min-w-0 truncate text-mini text-shell-muted">{summary}</span>
      </summary>

      <div className="mt-4 flex min-w-0 flex-col gap-5">
        {field.help && <p className={ui.hint}>{field.help}</p>}

        {/* Xem trước kết quả Google — giá trị hiệu lực, cắt bằng CSS chứ không cắt chuỗi. */}
        <div aria-label="Xem trước trên Google" className="flex min-w-0 flex-col gap-0.5 rounded-md bg-shell-panel px-4 py-3 shadow-shell-card">
          <span className={ui.eyebrow}>Xem trước trên Google</span>
          {selfUrl && <span className="truncate text-mini text-shell-muted">{selfUrl}</span>}
          <span className="line-clamp-1 text-card font-medium text-shell-accent">{shownTitle || 'Chưa có tiêu đề'}</span>
          <span className="line-clamp-2 text-small text-shell-muted">{live.description ?? 'Chưa có mô tả.'}</span>
          {live.noindex && (
            <span className="mt-1 text-mini font-medium text-shell-warn">Bài này đang ẩn khỏi Google.</span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <label htmlFor={`${id}-title`} className={ui.label}>Tiêu đề trên Google</label>
            <span className="ml-auto"><Counter n={titleN} warn={SEO_LIMITS.titleWarn} max={SEO_LIMITS.titleMax} /></span>
          </div>
          <input
            id={`${id}-title`}
            value={title}
            placeholder={fallback.title ?? ''}
            onChange={(e) => set({ metaTitle: e.target.value })}
            className={ui.field}
          />
          <p className={ui.hint}>
            {lengthHint(titleN, SEO_LIMITS.titleWarn, SEO_LIMITS.titleMax, 'tiêu đề') ??
              'Để trống thì dùng tiêu đề bài. Gõ vào đây là đúng dòng Google hiện, không nối thêm tên site.'}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <label htmlFor={`${id}-desc`} className={ui.label}>Mô tả trên Google</label>
            <span className="ml-auto"><Counter n={descN} warn={SEO_LIMITS.descWarn} max={SEO_LIMITS.descMax} /></span>
          </div>
          <textarea
            id={`${id}-desc`}
            rows={3}
            value={desc}
            placeholder={fallback.description ?? ''}
            onChange={(e) => set({ metaDescription: e.target.value })}
            className={cn(ui.field, ui.textarea)}
          />
          <p className={ui.hint}>
            {lengthHint(descN, SEO_LIMITS.descWarn, SEO_LIMITS.descMax, 'mô tả') ?? 'Để trống thì dùng sapo của bài.'}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={ui.label}>Ảnh khi chia sẻ</span>
          <AssetField
            value={ownAsset}
            imageOnly
            // Ghi `{ assetId, alt }` — cùng quy ước với field `image` ở đường ghi.
            onPick={(next) => set({ ogImage: next ? { ...v.ogImage, assetId: next } : { alt: v.ogImage?.alt } })}
          />
          {inheritedAsset && (
            <p className={ui.hint}>
              {ctx?.locale ? 'Đang dùng ảnh của bản gốc.' : 'Đang dùng ảnh bìa của bài.'} Chọn ảnh để thay riêng khi chia sẻ.
            </p>
          )}
          <input
            aria-label="Mô tả ảnh khi chia sẻ"
            value={v.ogImage?.alt ?? ''}
            placeholder="Mô tả ảnh (cho người dùng trình đọc màn hình)"
            onChange={(e) => set({ ogImage: { ...v.ogImage, alt: e.target.value } })}
            className={ui.field}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Checkbox
            label="Ẩn khỏi Google"
            checked={v.noindex === true}
            onChange={(e) => set({ noindex: e.target.checked })}
          />
          <p className={ui.hint}>
            Bài vẫn mở được bằng đường link, nhưng không hiện trên Google và không có trong sitemap.
            {ctx?.locale ? ' Chỉ áp cho bản ngôn ngữ này.' : ''}
          </p>
        </div>

        <details className="group/adv">
          <summary
            className={cn(
              'flex cursor-pointer list-none items-center gap-2 rounded-sm text-small font-semibold select-none [&::-webkit-details-marker]:hidden',
              focusRing,
            )}
          >
            <Icon name="chevron-right" size={16} className="text-shell-muted transition-transform group-open/adv:rotate-90" />
            Nâng cao
          </summary>
          <div className="mt-4 flex min-w-0 flex-col gap-5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${id}-kw`} className={ui.label}>Từ khoá</label>
              <input
                id={`${id}-kw`}
                value={v.keywords ?? ''}
                placeholder="lãi suất, tiết kiệm, ngân hàng"
                onChange={(e) => set({ keywords: e.target.value })}
                className={ui.field}
              />
              <p className={ui.hint}>Phân cách bằng dấu phẩy.</p>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${id}-canon`} className={ui.label}>Đường dẫn chuẩn (canonical)</label>
              <input
                id={`${id}-canon`}
                value={canonical}
                placeholder={ctx?.selfPath ?? '/duong-dan'}
                onChange={(e) => set({ canonicalUrl: e.target.value })}
                className={cn(ui.field, 'font-shell-mono')}
              />
              {canonicalCheck && !canonicalCheck.ok ? (
                // Đúng câu server sẽ trả — cùng `normalizeCanonical`, cùng host.
                <p className={ui.error}>{canonicalCheck.error}</p>
              ) : crossLocale ? (
                <p className={cn(ui.hint, 'text-shell-warn')}>
                  Đường dẫn này trỏ sang trang của ngôn ngữ khác. Google sẽ bỏ trang {ctx?.locale?.toUpperCase()} này.
                </p>
              ) : (
                <p className={ui.hint}>Chỉ điền khi bài này là bản sao của một trang khác trên site.</p>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${id}-ld`} className={ui.label}>Dữ liệu có cấu trúc (JSON-LD)</label>
              <textarea
                // `key` theo ngôn ngữ: ô này KHÔNG được điều khiển (`defaultValue`, parse lúc
                // rời ô), và đổi tab không mount lại `FieldInput` — không có key thì tab EN
                // hiện JSON-LD tiếng Việt, và một lần rời ô ghi nó vào `i18n.en`.
                key={ctx?.locale ?? 'base'}
                id={`${id}-ld`}
                rows={5}
                defaultValue={structuredText}
                onBlur={(e) => {
                  // Parse lúc RỜI ô, như field `json`: gõ dở thì JSON luôn sai.
                  const raw = e.target.value.trim();
                  if (raw === '') return set({ structuredData: undefined });
                  try {
                    set({ structuredData: JSON.parse(raw) as SeoValue['structuredData'] });
                  } catch {
                    // Giữ nguyên chữ trong ô để người dùng sửa; server sẽ từ chối nếu vẫn sai.
                    set({ structuredData: raw as unknown as SeoValue['structuredData'] });
                  }
                }}
                className={cn(ui.field, ui.textarea, 'font-shell-mono text-small')}
              />
              <p className={ui.hint}>Để trống thì hệ thống tự sinh dữ liệu kiểu Article.</p>
            </div>
          </div>
        </details>
      </div>
    </details>
  );
}
