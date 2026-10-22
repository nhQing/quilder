'use client';

/**
 * Khối "Trang" — metadata SEO, ở ĐÁY pane phải.
 *
 * ## Vì sao nó phải tồn tại
 *
 * `Page.description`, `ogImageId`, `canonical`, `noindex` được route site đọc đủ
 * cả bốn, nhưng cho tới 11/09/2026 không có chỗ nào trong builder bày chúng ra và
 * không có đường ghi nào — xem docblock của `setPageSeo`. Nên mọi trang đang có
 * đều không mô tả, và người dựng không có cách nào biết điều đó.
 *
 * ## Vì sao ở ĐÁY, và vì sao LUÔN hiện
 *
 * Pane phải là pane của NODE đang chọn. Metadata thuộc về TRANG, nên nó không
 * được chen vào giữa các nhóm style — người dùng sẽ đọc nó như một thuộc tính của
 * node và ngạc nhiên khi chọn node khác mà giá trị không đổi.
 *
 * Đáy là đúng thứ tự ưu tiên (thứ sửa sau cùng, một lần mỗi trang), và LUÔN hiện
 * chứ không chỉ hiện khi bỏ chọn node: một khối chỉ xuất hiện lúc không chọn gì
 * là một khối không ai tìm ra, vì trạng thái mặc định của màn sửa là đang chọn
 * một node.
 *
 * Gập sẵn khi đang chọn node: nó không phải việc của mọi lượt mở trang.
 *
 * ## Khi KHÔNG chọn node: mở sẵn, chiếm cả pane (`expanded`) — từ 09/10/2026
 *
 * Bản v2 đầu để pane phải chỉ có dòng "Chưa chọn phần tử nào" lúc bỏ chọn, còn khối
 * này vẫn là một dòng gập ở đáy, bị nút dev của Next che một nửa. Chủ dự án báo
 * "không thấy SEO và thông tin chia sẻ của trang". Không chọn gì là đang nhìn cả
 * trang, nên pane nói về trang, kèm hai thẻ xem trước (Google, thẻ chia sẻ) vẽ từ
 * đúng dữ liệu site phát ra.
 *
 * ## Vì sao mỗi ô lưu khi RỜI Ô, không có nút Lưu
 *
 * Cùng quy ước với mọi ô trong Inspector. Một nút Lưu riêng ở đây là một nhịp
 * thao tác thứ hai mà không ô nào khác trong pane có, và nó sẽ bị bỏ quên — người
 * dùng gõ mô tả, bấm sang node khác, và mất chữ.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { useEditor } from '@/lib/builder/store';
import { META_ADDRESS, pageMetaFrom, type PageMetaField } from '@/lib/builder/page-meta';
import type { DraftTranslation } from '@/lib/i18n/queries';
import { applyTitleTemplate } from '@/lib/site/seo-template';
import { AssetField } from './AssetField';
import { GroupToggle, ROW } from './controls';
import { ImageThumb } from './asset/AssetThumb';
import { Badge } from './ui/Badge';
import { Checkbox } from './ui/Field';
import { Icon } from './ui/Icon';

export interface PageSeo {
  title: string;
  slug: string;
  description: string | null;
  ogImageId: string | null;
  canonical: string | null;
  noindex: boolean;
  /** Có `Page.jsonLd` hay không. Chỉ ĐỌC — xem `setPageSeo`. */
  hasJsonLd: boolean;
  /**
   * Ảnh chia sẻ có vấn đề gì không — câu đã dựng sẵn, hoặc `null`.
   *
   * Tính ở SERVER vì luật cần `width`/`height` của asset, và client không có
   * chúng nếu không đọc thêm kho ảnh. `shareImageWarning` là một chỗ duy nhất —
   * cùng hàm mà màn Cài đặt dùng cho ảnh mặc định của site.
   */
  ogWarning: string | null;
  /** URL ảnh chia sẻ RIÊNG của trang, `null` khi chưa đặt. */
  ogImageUrl: string | null;
  /** Tên site (`og:site_name`) và ảnh chia sẻ mặc định — thứ thẻ lùi về khi trang không đặt ảnh. */
  siteName: string | null;
  defaultOgImageUrl: string | null;
  /**
   * Template tiêu đề và mô tả mặc định của CẢ SITE (Cài đặt › SEO & thu thập). Thẻ
   * "Trên Google" áp chúng để hiện đúng `<title>` và mô tả khách sẽ thấy.
   */
  titleTemplate: string | null;
  defaultDescription: string | null;
  /** Gốc URL của site — tên miền in trên hai thẻ xem trước. `null` = chưa đặt. */
  siteUrl: string | null;
}

/** Trần của `description`, khớp với `setPageSeo`. */
const MAX_DESCRIPTION = 300;

export function PageSeoPanel({
  pageId,
  seo,
  translations,
  expanded = false,
}: {
  pageId: string | null;
  seo: PageSeo | null;
  /** Bản dịch nháp của trang — ô metadata theo ngôn ngữ đọc hàng `$meta` trong đây. */
  translations: Record<string, DraftTranslation[]>;
  /**
   * Mở sẵn, chiếm cả pane, không có nút gập — khi KHÔNG chọn node nào.
   *
   * Trước đây lúc bỏ chọn, pane phải chỉ có một dòng "Chưa chọn phần tử nào", còn khối
   * này là một dòng gập nhỏ ở đáy — chủ dự án báo "không thấy SEO và thông tin chia sẻ
   * của trang ở đâu". Không chọn gì nghĩa là đang nhìn CẢ TRANG, nên pane nói về trang.
   */
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const locale = useEditor((s) => s.locale);

  // Chế độ sửa component: không có trang nào để nói về.
  if (!pageId || !seo) return null;

  const meta = locale ? pageMetaFrom(translations[locale] ?? []) : {};
  const shown = expanded || open;

  /*
   * Nói ra thứ ĐANG THIẾU ngay trên nhãn, lúc khối còn gập.
   *
   * Không có nó thì "chưa có mô tả" và "có mô tả rồi" trông giống hệt nhau từ bên
   * ngoài, và cả khối này thành một thứ không ai nghĩ tới việc mở.
   */
  const badges = (
    <span className="ml-auto flex min-w-0 items-center gap-1">
      {!seo.description && (
        <Badge tone="warn" size="sm">
          chưa có mô tả
        </Badge>
      )}
      {seo.noindex && (
        <Badge tone="danger" size="sm">
          noindex
        </Badge>
      )}
    </span>
  );

  return (
    <section
      className={
        expanded
          ? 'flex flex-col px-2.5 pt-2 pb-1.5'
          : 'border-shell-line mt-auto max-h-[60%] shrink-0 overflow-y-auto border-t px-2.5 pt-1 pb-1.5'
      }
      data-page-seo=""
    >
      {expanded ? (
        <h2 className="flex items-center gap-2 px-1 py-1.5 text-small font-semibold text-shell-ink">
          SEO & chia sẻ
          {badges}
        </h2>
      ) : (
        <GroupToggle open={open} onToggle={() => setOpen((v) => !v)}>
          Trang · SEO & chia sẻ
          {badges}
        </GroupToggle>
      )}

      {shown && (
        <div className="flex flex-col gap-3 px-1 pt-1 pb-2.5">
          <SharePreviews
            seo={seo}
            title={(locale && meta.title) || seo.title}
            description={(locale && meta.description) || seo.description || ''}
          />
          {/*
            Tiêu đề và đường dẫn chỉ ĐỌC ở đây.

            Cả hai đã có ô sửa riêng (`PageRename` trên dải đỉnh), và đổi slug kéo
            theo luật redirect 301 cùng phép ghép với `collection`. Bày một ô thứ hai
            ở đây là hai đường ghi cho một giá trị, và đường ở đây sẽ là đường không
            có những luật đó.
          */}
          <Read label="Tiêu đề" value={seo.title} />
          <Read label="Đường dẫn" value={seo.slug || '(trang chủ)'} />

          {locale ? (
            /*
              Ở chế độ ngôn ngữ, hai ô này ghi vào bảng `Translation` với địa chỉ
              `$meta` — KHÔNG vào cột `Page`. Xem `page-meta.ts`.

              Chỉ `title` và `description`: `canonical`, `noindex` và ảnh OG là
              quyết định của TRANG, không phải của bản dịch. Một trang noindex ở
              tiếng Việt mà index ở tiếng Anh là thứ chưa ai đặt ra, và bày ô cho
              nó là mời người dùng tạo ra một trạng thái không ai muốn.
            */
            <>
              <MetaField
                pageId={pageId}
                locale={locale}
                field="title"
                label="Tiêu đề"
                value={meta.title ?? ''}
                base={seo.title}
              />
              <MetaField
                pageId={pageId}
                locale={locale}
                field="description"
                label="Mô tả"
                value={meta.description ?? ''}
                base={seo.description ?? ''}
              />
              <p className={cn(ui.hint, 'leading-snug')}>
                Canonical, ảnh OG và noindex dùng chung mọi ngôn ngữ — về bản gốc để sửa.
              </p>
            </>
          ) : (
            <>
              <Field
                pageId={pageId}
                name="description"
                label="Mô tả"
                value={seo.description ?? ''}
                rows={3}
                max={MAX_DESCRIPTION}
                hint="Chữ Google hiện dưới tiêu đề. Trống thì nó tự lấy một đoạn trong trang — và đoạn đó thường không phải đoạn bạn muốn."
              />

              <Field
                pageId={pageId}
                name="canonical"
                label="Canonical"
                value={seo.canonical ?? ''}
                rows={2}
                hint='Trống là đúng cho gần như mọi trang — route site tự dùng URL của chính nó. Chỉ đặt khi trang này là bản trùng của một URL khác. Phải bắt đầu bằng "/" hoặc "https://".'
              />

              <div className="flex flex-col gap-1.5">
                <span className={ui.label}>Ảnh chia sẻ</span>
                <div className="max-w-[9rem]">
                  <AssetField
                    imageOnly
                    value={seo.ogImageId}
                    onPick={(id) => void save(pageId, { ogImageId: id })}
                  />
                </div>
                <p className={cn(ui.hint, 'leading-snug')}>
                  Ảnh hiện khi ai đó dán link trang này vào Zalo, Facebook hay Slack.
                  Cỡ chuẩn <span className="font-shell-mono">1200×630</span>.
                  {!seo.ogImageId && ' Trống thì trang dùng ảnh mặc định của site.'}
                </p>
                {/*
                  Cảnh báo tính từ chính luật của nền tảng, không phải một câu chung.

                  Chỗ này quan trọng hơn ô chọn: người dựng đặt một tấm ảnh vuông
                  800×800 thì thẻ chia sẻ bị CẮT mất gần nửa chiều cao, và họ chỉ
                  biết sau khi chạy quảng cáo. `shareImageWarning` nói ngay lúc chọn.
                */}
                {seo.ogWarning && (
                  <p className="bg-shell-warn-soft text-shell-warn rounded-sm px-2.5 py-1.5 text-mini leading-snug">
                    {seo.ogWarning}
                  </p>
                )}
              </div>

              <Toggle
                pageId={pageId}
                label="Chặn Google index trang này"
                value={seo.noindex}
              />

              {seo.hasJsonLd && (
                <p className={cn(ui.hint, 'leading-snug')}>
                  Trang có <span className="font-shell-mono">jsonLd</span> tự khai — sửa
                  qua MCP. Trang chi tiết bài viết không cần nó: hệ thống tự sinh.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Một lượt ghi metadata.
 *
 * Ngoài component để cả ba loại ô dùng chung, và để `router.refresh()` nằm đúng
 * một chỗ — thiếu nó thì ô vẫn hiện giá trị cũ sau khi lưu và người dùng bấm lại.
 */
async function save(pageId: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return data.error ?? `Không lưu được (${res.status})`;
    }
    return null;
  } catch {
    return 'Mất kết nối';
  }
}

/**
 * Một ô metadata THEO NGÔN NGỮ.
 *
 * Tách khỏi `Field` vì đường ghi khác hẳn: `Field` gọi `PATCH /api/pages/[id]`
 * (ghi cột `Page`, dùng chung mọi ngôn ngữ), còn ô này gọi `/api/translations`
 * (ghi một hàng `Translation` ở địa chỉ `$meta`). Gộp hai đường vào một component
 * với một cờ là để lần sau có người sửa nhánh này rồi đổi luôn nhánh kia.
 *
 * Trống = xoá hàng = dùng lại bản gốc. Bản gốc nằm ở `placeholder` chứ không đổ
 * sẵn vào ô: một ô đã có chữ trông như đã dịch.
 */
function MetaField({
  pageId,
  locale,
  field,
  label,
  value,
  base,
}: {
  pageId: string;
  locale: string;
  field: PageMetaField;
  label: string;
  value: string;
  base: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(value), [value, locale]);

  const dirty = draft !== value;

  const commit = async () => {
    if (!dirty) return;
    setBusy(true);
    let err: string | null = null;
    try {
      const res = await fetch('/api/translations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pageId,
          locale,
          nodeId: META_ADDRESS,
          field,
          // Trống → `null`: đường ghi coi `null` là XOÁ bản dịch.
          value: draft.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        err = data.error ?? `Không lưu được (${res.status})`;
      }
    } catch {
      err = 'Mất kết nối';
    }
    setBusy(false);
    setError(err);
    if (!err) router.refresh();
  };

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ui.label}>{label}</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(value);
        }}
        disabled={busy}
        rows={field === 'title' ? 2 : 3}
        spellCheck={false}
        placeholder={base}
        className={cn(AREA, dirty && 'border-shell-accent')}
      />
      <p className={cn('leading-snug', error ? ui.error : ui.hint)}>
        {error ?? (draft ? 'Để trống là dùng lại bản gốc.' : 'Chưa dịch — site đang dùng bản gốc.')}
      </p>
    </label>
  );
}

/** Ô nhiều dòng của khối: cỡ 28px của panel editor, nhưng cao theo `rows`. */
const AREA = cn(ui.fieldSm, 'h-auto resize-y py-1.5 leading-snug');

/** Hàng chỉ đọc: nhãn | giá trị, cùng cột nhãn với các ô thuộc tính phía trên. */
function Read({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn(ROW, 'items-center')}>
      <span className="text-shell-muted text-mini">{label}</span>
      <span className="font-shell-mono text-shell-ink truncate text-mini" title={value}>
        {value}
      </span>
    </div>
  );
}

function Field({
  pageId,
  name,
  label,
  value,
  rows,
  max,
  hint,
}: {
  pageId: string;
  name: string;
  label: string;
  value: string;
  rows: number;
  max?: number;
  hint: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Giá trị đổi từ bên ngoài (MCP, một tab khác, refresh sau khi lưu) thì ô phải theo.
  useEffect(() => setDraft(value), [value]);

  const dirty = draft !== value;
  const over = max !== undefined && draft.trim().length > max;

  const commit = async () => {
    if (!dirty || over) return;
    setBusy(true);
    const err = await save(pageId, { [name]: draft.trim() || null });
    setBusy(false);
    setError(err);
    if (!err) router.refresh();
  };

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ui.label}>{label}</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(value);
        }}
        disabled={busy}
        rows={rows}
        spellCheck={false}
        aria-invalid={over || undefined}
        className={cn(
          AREA,
          dirty && !over && 'border-shell-accent',
          over && 'border-shell-danger',
        )}
      />
      <p className={cn('leading-snug', error || over ? ui.error : ui.hint)}>
        {error ??
          (over
            ? `Quá ${max} ký tự (đang ${draft.trim().length}) — mọi công cụ đều cắt ở đó.`
            : hint)}
      </p>
    </label>
  );
}

function Toggle({
  pageId,
  label,
  value,
}: {
  pageId: string;
  label: string;
  value: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Checkbox
        label={label}
        wrapperClassName="text-small"
        checked={value}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          const err = await save(pageId, { noindex: e.target.checked });
          setBusy(false);
          setError(err);
          if (!err) router.refresh();
        }}
      />
      {error && <p className={cn(ui.error, 'mt-0.5')}>{error}</p>}
    </div>
  );
}

/**
 * Hai thẻ xem trước: kết quả Google, và thẻ hiện khi dán link vào Zalo/Facebook.
 *
 * Vẽ từ ĐÚNG dữ liệu mà route site phát ra (tiêu đề, mô tả, ảnh riêng → ảnh mặc định
 * của site), để người dựng thấy kết quả trước khi chia sẻ — không phải đoán từ bốn ô
 * nhập rời. Ô nào trống thì thẻ nói thẳng hậu quả của việc trống.
 */
function SharePreviews({ seo, title, description }: { seo: PageSeo; title: string; description: string }) {
  // `SITE_URL` chưa đặt thì lấy tên miền của chính builder — cùng cách nút Chia sẻ làm.
  // Đọc trong effect: server không có `window`, đọc lúc render là HTML hai bên lệch nhau.
  const [here, setHere] = useState('');
  useEffect(() => setHere(window.location.host), []);
  const host = hostOf(seo.siteUrl) ?? here;
  const path = seo.slug ? `/${seo.slug}` : '';
  const image = seo.ogImageUrl ?? seo.defaultOgImageUrl;
  const imageNote = seo.ogImageUrl
    ? null
    : seo.defaultOgImageUrl
      ? 'Đang dùng ảnh mặc định của site.'
      : 'Chưa có ảnh — thẻ chia sẻ sẽ không có hình.';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className={ui.label}>Trên Google</span>
        <div className="flex flex-col gap-0.5 rounded-md border border-shell-line bg-shell-panel px-3 py-2.5">
          <span className="font-shell-mono truncate text-micro text-shell-muted">
            {host}
            {path}
          </span>
          <span className="line-clamp-2 text-small font-semibold text-shell-accent">
            {applyTitleTemplate(seo.titleTemplate, title)}
          </span>
          <span
            className={cn(
              'line-clamp-3 text-mini leading-snug',
              description || seo.defaultDescription ? 'text-shell-muted' : 'text-shell-warn',
            )}
          >
            {description || seo.defaultDescription || 'Chưa có mô tả — Google sẽ tự cắt một đoạn trong trang.'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={ui.label}>Khi chia sẻ link</span>
        <div className="overflow-hidden rounded-md border border-shell-line bg-shell-panel">
          {/* Khung đúng tỉ lệ 1200×630 mà Facebook/Zalo cắt ảnh về. */}
          <div className="aspect-[1200/630] bg-shell-raised">
            {image ? (
              /* `cover` cố ý: khung này mô phỏng đúng cú CẮT của Facebook/Zalo, nên
                 phải cắt y như họ — `contain` sẽ hứa một thứ link thật không hiện. */
              <ImageThumb url={image} fit="cover" className="size-full" />
            ) : (
              <span className="grid size-full place-items-center text-shell-muted">
                <Icon name="image" size={22} />
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5 border-t border-shell-line px-3 py-2.5">
            <span className="truncate text-micro tracking-wide text-shell-muted uppercase">{host}</span>
            <span className="line-clamp-2 text-small font-semibold text-shell-ink">{title}</span>
            {description && <span className="line-clamp-2 text-mini leading-snug text-shell-muted">{description}</span>}
          </div>
        </div>
        {imageNote && <p className={cn(ui.hint, 'leading-snug')}>{imageNote}</p>}
      </div>
    </div>
  );
}

/** Tên miền từ `SITE_URL`; `null` khi chưa đặt. */
function hostOf(siteUrl: string | null): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).host;
  } catch {
    return siteUrl;
  }
}
