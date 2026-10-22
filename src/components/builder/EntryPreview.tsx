'use client';

/**
 * Cột "xem như trên site", đọc từ STATE CỦA FORM.
 *
 * ## Vì sao không đọc từ database
 *
 * Đó chính là điểm của nó: bản xem trước phải hiện cả những gì chưa lưu. Một bản
 * đọc từ DB thì bằng với route xem cả trang (`…/[id]/preview`) và vô dụng trong lúc
 * soạn — người viết muốn thấy tiêu đề mình vừa gõ, không phải tiêu đề của lần lưu
 * trước.
 *
 * ## Vì sao là một file riêng, mount theo nút bật/tắt
 *
 * Nó nạp bảng asset (`/api/assets`) để hiện được ảnh. Gắn thẳng vào `EntryForm`
 * nghĩa là mọi lần mở form đều bắn request đó, kể cả với người không bao giờ bật cột
 * này. Mount theo nút thì việc nạp xảy ra đúng lúc có người cần.
 *
 * ## Điều cột này KHÔNG hứa
 *
 * Nó không phải trang chi tiết thật — trang thật cần template `repeat` + binding của
 * mốc 3, chưa có. Nên khung nói "xem như trên site", và chỉ bày field CHỮ ở tầng
 * ngoài: nhóm lồng, dynamic zone, quan hệ và danh mục cần một template để biết đặt ở
 * đâu, và tự đặt chúng ở đây là hứa một bố cục mà trang thật sẽ không có.
 */

import { useEffect, useState } from 'react';

import type { FieldDef } from '@/lib/collections/field-def';
import { zRichDoc, zRichText } from '@/lib/doc/schema';
import type { RichDoc, RichText } from '@/lib/doc/types';
import type { AssetInfo } from '@/lib/render/NodeRenderer';
import { isBlankHtml, sanitizeArticleHtml } from '@/lib/collections/html-sanitize';
import { ArticleHtml } from '@/lib/render/ArticleHtml';
import { RichDocView } from '@/lib/render/richdoc';
import { RichTextView } from '@/lib/render/richtext';
import { loadAssets, type AssetOption } from '@/lib/builder/asset-cache';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { RICHDOC_PROSE } from './richdoc-prose';
import { ButtonLink } from './ui/Button';
import { Icon } from './ui/Icon';

/** Không có nguồn binding cho nội dung entry ở v1 — xem `EMPTY_SCOPE` ở richdoc.tsx. */
const SCOPE = { site: {}, page: {} };

/**
 * `data` là JSONB thô từ state của form, nên mỗi giá trị phải qua schema trước khi
 * render: một field vừa đổi kiểu sẽ mang hình dạng khác, và `RichDocView` gặp
 * `{ t:'text' }` ở chỗ đợi một khối thì ném — làm trắng cả form đang soạn dở.
 */
function asRichDoc(v: unknown): RichDoc | null {
  const r = zRichDoc.safeParse(v);
  return r.success ? (r.data as RichDoc) : null;
}

function asRichText(v: unknown): RichText | null {
  const r = zRichText.safeParse(v);
  return r.success ? (r.data as RichText) : null;
}

export function EntryPreview({
  fields,
  data,
  titleKey,
  typeName,
  slug,
  fullHref,
  iframeHosts,
}: {
  fields: FieldDef[];
  data: Record<string, unknown>;
  titleKey: string | undefined;
  typeName: string;
  slug: string;
  /** Xem docblock cùng tên ở `EntryForm`. */
  iframeHosts: readonly string[];
  /**
   * Đường mở bản ĐÃ LƯU ở một tab riêng. `null` khi mục chưa lưu lần nào.
   *
   * Nút này nằm ở ĐÂY, trên đầu cột xem trước, chứ không phải một nút thứ hai trong
   * cột phải. Hai lối xem từng là hai nút cạnh nhau, và người dùng phải đọc nhãn để
   * đoán chúng khác nhau ở đâu. Đặt cái thứ hai lên đầu cái thứ nhất thì quan hệ
   * giữa chúng tự hiện ra: "đang xem thứ này — mở nó ra rộng hơn".
   */
  fullHref: string | null;
}) {
  const [assets, setAssets] = useState<Record<string, AssetInfo>>({});

  useEffect(() => {
    let alive = true;
    /*
     * `loadAssets()` chứ không `fetch` tại chỗ — xem `lib/builder/asset-cache.ts`.
     *
     * Màn nhập entry có thể mở cùng lúc: cột xem trước này, vài ô `AssetField`, và
     * một ô soạn thân bài. Trước đó mỗi bên tự gọi `/api/assets`, nên cùng một danh
     * sách bị kéo về ba, bốn lần cho một lần mở màn.
     */
    loadAssets()
      .then((list: AssetOption[]) => {
        if (!alive) return;
        // `as const` để `Object.fromEntries` thấy một TUPLE. Không có nó, `.map`
        // suy ra `(string | AssetOption)[]` và kết quả là `Record<string, string |
        // AssetOption>` — không gán được vào bảng asset.
        setAssets(Object.fromEntries(list.map((a) => [a.id, a] as const)));
      })
      .catch(() => {
        // Không có URL ảnh thì `BlockView` tự hiện chỗ trống CÓ CHỮ. Một cột xem
        // trước không phải chỗ để bày lỗi mạng. `loadAssets` đã xoá cache của chính
        // nó khi reject, nên việc nuốt lỗi ở đây không làm hỏng ô nào khác.
      });
    return () => {
      alive = false;
    };
  }, []);

  const title = titleKey ? data[titleKey] : undefined;
  const bodyFields = fields.filter(
    (f) =>
      (f.t === 'richdoc' || f.t === 'html' || f.t === 'richtext' || f.t === 'text') &&
      f.key !== titleKey,
  );

  return (
    <section
      aria-label="Xem như trên site"
      className={cn(ui.card, 'flex min-w-0 flex-col overflow-hidden lg:sticky lg:top-4')}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-shell-line px-4 py-2.5">
        <span className="flex shrink-0 items-center gap-2 text-small font-semibold">
          <Icon name="eye" size={17} className="text-shell-muted" />
          Xem như trên site
        </span>
        {/* `min-w-24`: đường dẫn ngắn hơn thế thì không đọc được gì, nên nút mở tab nhường
            chỗ và xuống dòng thay vì ép đường dẫn thành một dấu "…". */}
        <span className="font-shell-mono min-w-24 flex-1 truncate text-micro text-shell-muted">/{slug || '…'}</span>
        {fullHref ? (
          /*
            "bản đã lưu" KHÔNG phải chú thích trang trí.

            Cột này dựng từ thứ đang gõ trong form; tab mới đọc từ database. Hai thứ
            đó lệch nhau đúng bằng những gì chưa lưu — và nếu không nói ra, người dùng
            mở tab mới, không thấy đoạn vừa gõ, rồi tưởng bản xem trước bị lỗi.
          */
          <ButtonLink
            href={fullHref}
            target="_blank"
            rel="noopener"
            variant="ghost"
            size="sm"
            icon="external"
            title="Mở bản ĐÃ LƯU ở tab riêng, đúng token và font của site"
          >
            Mở trong thẻ mới
            <span className="font-normal text-shell-muted">· bản đã lưu</span>
          </ButtonLink>
        ) : (
          <span className="shrink-0 text-mini text-shell-muted" title="Lưu một lần trước đã — tab riêng đọc từ database">
            chưa lưu lần nào
          </span>
        )}
      </div>

      <div className="max-h-[70vh] overflow-auto bg-shell-paper px-5 py-5 text-shell-paper-ink">
        <h1 className="text-xl leading-tight font-semibold text-shell-paper-ink">
          {typeof title === 'string' && title.trim() ? title : '(chưa có tiêu đề)'}
        </h1>
        {/* Giấy KHÔNG đổi theo theme, nên chữ phụ ở đây mờ từ màu chữ của giấy chứ không
            dùng `shell-muted` — ở theme tối `shell-muted` là xám sáng, gần như mất trên giấy trắng. */}
        <p className="mt-1 text-micro text-shell-paper-ink/65">{typeName}</p>

        <div className={`${RICHDOC_PROSE} mt-3 text-shell-paper-ink`}>
          {bodyFields.map((f) => {
            if (f.t === 'richdoc') {
              const doc = asRichDoc(data[f.key]);
              if (!doc) return null;
              return <RichDocView key={f.key} value={doc} assets={assets} scope={SCOPE} id={f.key} />;
            }
            /*
             * Làm sạch NGAY TRONG cột xem trước, mỗi lần render.
             *
             * Không nhớ kết quả (`useMemo`) vì `data` đổi ở mỗi ký tự gõ, nên cache
             * sẽ trượt ở mọi lần dùng. Đo `sanitize-html` trên một bài ~2000 chữ:
             * ~1ms — rẻ hơn hẳn một cột xem trước có thể chạy `<script>` của chính
             * chuỗi vừa dán vào.
             */
            if (f.t === 'html') {
              const raw = data[f.key];
              if (typeof raw !== 'string' || isBlankHtml(raw)) return null;
              const { html } = sanitizeArticleHtml(raw, { iframeHosts });
              return <ArticleHtml key={f.key} safeHtml={html} id={f.key} />;
            }
            if (f.t === 'richtext') {
              const rt = asRichText(data[f.key]);
              if (!rt) return null;
              return (
                <p key={f.key}>
                  <RichTextView value={rt} scope={SCOPE} id={f.key} />
                </p>
              );
            }
            const v = data[f.key];
            if (typeof v !== 'string' || !v.trim()) return null;
            return <p key={f.key}>{v}</p>;
          })}
        </div>
      </div>

      <p className="flex items-start gap-2 border-t border-shell-line px-4 py-3 text-mini leading-relaxed text-shell-muted">
        <Icon name="info" size={15} className="mt-px text-shell-warn" />
        <span>
          Bản nháp chưa lưu, và <b className="font-semibold text-shell-ink">không phải</b> trang chi tiết thật — trang
          thật cần template lặp của mốc 3. Chỉ hiện field chữ ở tầng ngoài.
        </span>
      </p>
    </section>
  );
}
