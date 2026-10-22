import { notFound } from 'next/navigation';

/**
 * Xem trước một entry — MỘT TRANG RIÊNG, mở tab mới.
 *
 * ## Vì sao route này nạp `site.css`
 *
 * `(builder)/layout.tsx` cố ý KHÔNG nạp `tokens.css` của website: vỏ công cụ và
 * nội dung phải phân biệt được bằng mắt. Nhưng ở đây thứ đang xem CHÍNH LÀ nội
 * dung, nên nó phải mang font và token của site — bằng không "xem trước" chỉ nói
 * được về chữ, không nói được về hình.
 *
 * Trộn hai stylesheet vào một trang an toàn nhờ thứ tự layer, không nhờ may:
 * `builder.css` (ở layout) khai `@layer theme, base, components, utilities` trước,
 * rồi `site.css` thêm `doc, doc-custom` vào SAU. Mọi CSS tĩnh của site nằm trong
 * `base` (xem ghi chú đầu `site.css`), tức TRƯỚC `utilities` — nên utility Tailwind
 * của dải trạng thái vẫn thắng reset của site, và reset của site vẫn áp cho phần
 * bài viết vốn không có class nào.
 *
 * ## Vì sao còn một khối `<style>` nữa
 *
 * `reset.css` của site LÀM PHẲNG mọi khối: `h1…h6 { font-size: inherit; font-weight:
 * inherit }`, `ul, ol { list-style: none }`, `a { text-decoration: none }`. Điều đó
 * đúng cho site — mọi bậc chữ ở đó do CSS compiler phát ra theo từng node
 * (`[data-n]`). Nhưng một bài `RichDoc` không có node doc nào, nên nếu chỉ nạp
 * `site.css` thì bản xem trước là một khối chữ cùng cỡ, không bullet, không link
 * nhìn ra được — tệ hơn là không có gì.
 *
 * Nên kiểu dáng bài viết đến từ `ARTICLE_CSS` (`src/lib/render/article-css.ts`),
 * phạm vi `[data-mm-article]`, bằng TOKEN của site — MỘT hằng dùng chung với trang
 * chi tiết công khai của mốc 3, để bản xem trước và trang thật không trôi khỏi nhau.
 * Lý do đầy đủ (kể cả vì sao không phải class Tailwind) nằm ở docblock của file đó.
 */
import '@/styles/site.css';
// CSS của gói dự án (QUILDER_PROJECT), nối SAU CSS lõi — cùng thứ tự với bó của site công khai.
import '@project/styles.css';

import { getAdminEntry, getTypeShape } from '@/lib/collections/admin-queries';
import { zRichDoc, zRichText } from '@/lib/doc/schema';
import type { RichDoc, RichText } from '@/lib/doc/types';
import { loadAssets } from '@/lib/render/page';
import { RichDocView, collectDocAssetIds } from '@/lib/render/richdoc';
import { RichTextView } from '@/lib/render/richtext';
import { ARTICLE_CSS } from '@/lib/render/article-css';
import { ArticleHtml } from '@/lib/render/ArticleHtml';
import { isBlankHtml, sanitizeArticleHtml } from '@/lib/collections/html-sanitize';
import { allowedEmbedHostnames } from '@/lib/render/embed-origins';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { Badge } from '@/components/builder/ui/Badge';
import { ButtonLink } from '@/components/builder/ui/Button';

export const dynamic = 'force-dynamic';

export const metadata = {
  // Bản nháp không bao giờ được index — lớp thứ nhất, cùng khuôn `/preview/[pageId]`.
  robots: { index: false, follow: false },
};

/** Không có nguồn binding cho nội dung entry ở v1 — xem `EMPTY_SCOPE` ở richdoc.tsx. */
const SCOPE = { site: {}, page: {} };


/**
 * `data` đi qua NGUYÊN TRẠNG từ JSONB, nên mỗi giá trị phải được kiểm trước khi
 * render: một field vừa đổi kiểu, hoặc một hàng lưu trước khi luật hiện tại tồn
 * tại, sẽ mang hình dạng khác. Bỏ qua field đó còn hơn làm cả trang xem trước
 * trắng — đây là màn để người biên tập soát bài, không phải đường ghi.
 */
function asRichDoc(v: unknown): RichDoc | null {
  const r = zRichDoc.safeParse(v);
  return r.success ? (r.data as RichDoc) : null;
}

function asRichText(v: unknown): RichText | null {
  const r = zRichText.safeParse(v);
  return r.success ? (r.data as RichText) : null;
}

export default async function EntryPreviewPage({
  params,
}: {
  params: Promise<{ typeKey: string; id: string }>;
}) {
  const { typeKey, id } = await params;

  // Không có gì để xem trước cho một entry chưa từng được lưu: route này đọc DB,
  // còn nội dung chưa lưu chỉ tồn tại trong state của form — đó là việc của cột
  // xem cạnh (E2), không phải của route này.
  if (id === 'moi') notFound();

  const [shape, entry] = await Promise.all([getTypeShape(typeKey), getAdminEntry(id)]);
  if (!shape || !entry) notFound();
  // Cùng phép chặn với form: entry của loại khác mở qua URL của loại này sẽ được
  // chiếu qua cấu trúc SAI.
  if (entry.typeKey !== typeKey) notFound();

  const titleKey = shape.type.titleField;
  const title = titleKey ? entry.data[titleKey] : undefined;

  /*
   * Chỉ field CHỮ ở TẦNG NGOÀI được xem trước.
   *
   * Nhóm lồng, dynamic zone, quan hệ và danh mục cần một template để biết đặt ở đâu
   * trên trang — mà template đó là mốc 3. Render chúng theo một thứ tự tự đặt ở đây
   * là hứa một bố cục mà trang thật sẽ không có. Dải trạng thái nói rõ điều này,
   * thay vì để người dùng tự đoán từ chỗ trống.
   */
  const bodyFields = shape.fields.filter(
    (f) =>
      (f.t === 'richdoc' || f.t === 'html' || f.t === 'richtext' || f.t === 'text') &&
      f.key !== titleKey,
  );

  const assetIds = new Set<string>();
  for (const f of bodyFields) {
    if (f.t !== 'richdoc') continue;
    const doc = asRichDoc(entry.data[f.key]);
    if (doc) for (const aid of collectDocAssetIds(doc)) assetIds.add(aid);
  }
  const assets = await loadAssets([...assetIds]);
  // Cung bang EmbedOrigin voi CSP cua khoi CustomCode va voi duong ghi entry.
  const iframeHosts = await allowedEmbedHostnames();

  const skipped = shape.fields.length - bodyFields.length - (titleKey ? 1 : 0);

  return (
    <>
      <style
        data-mm-article-css=""
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: ARTICLE_CSS }}
      />

      {/* Dải trạng thái nói HAI điều, và điều thứ hai quan trọng hơn:
          (1) đây là bản nháp, chưa publish;
          (2) đây KHÔNG phải trang chi tiết thật — trang thật cần template `repeat`
              + binding của mốc 3, chưa tồn tại. Gọi khung này là "trang thật" là
              hứa một thứ chưa có, và lời hứa đó sẽ bị phát hiện bởi đúng người đem
              nó đi duyệt nội dung.
          Dải là CHROME của vỏ (token `shell-*`), dính ở đầu khi cuộn; phần bài bên
          dưới mang token của site. */}
      <div className="sticky top-0 z-10 bg-shell-bg pb-3">
        <div
          role="note"
          className={cn(ui.card, 'flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-3.5')}
        >
          <Badge tone="warn" dot>
            {entry.status === 'published' ? 'đã publish' : 'bản nháp'} · xem như trên site
          </Badge>
          <div className="flex min-w-0 flex-[1_1_24rem] flex-col gap-0.5 text-small text-shell-muted">
            <p>
              Đây <b className="font-semibold text-shell-ink">không phải</b> trang chi tiết thật.
              Trang thật cần template lặp và binding của mốc 3, chưa có — nên bố cục, ảnh bìa và
              khối quanh bài chưa đúng.
            </p>
            <p>
              Chỉ hiện field chữ ở tầng ngoài{skipped > 0 ? ` — ${skipped} field khác bị bỏ qua` : ''}.
              Nội dung đọc từ bản đã LƯU, không phải từ ô soạn đang mở.
            </p>
          </div>
          <ButtonLink
            href={`/builder/content/${typeKey}/${id}`}
            variant="secondary"
            size="md"
            icon="arrow-left"
            className="ml-auto"
          >
            Về ô soạn
          </ButtonLink>
        </div>
      </div>

      <article data-mm-article="" className="px-4 py-10">
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--step-3)',
            fontWeight: 'var(--weight-bold)',
            lineHeight: 'var(--leading-tight)',
          }}
        >
          {typeof title === 'string' && title.trim() ? title : '(chưa có tiêu đề)'}
        </h1>
        <p style={{ color: 'var(--color-muted)', fontSize: 'var(--step--1)' }}>
          {shape.type.name} · /{entry.slug}
        </p>

        {bodyFields.map((f) => {
          if (f.t === 'richdoc') {
            const doc = asRichDoc(entry.data[f.key]);
            if (!doc) return null;
            return <RichDocView key={f.key} value={doc} assets={assets} scope={SCOPE} id={f.key} />;
          }
          if (f.t === 'html') {
            const raw = entry.data[f.key];
            if (typeof raw !== 'string') return null;
            const { html } = sanitizeArticleHtml(raw, { iframeHosts });
            if (isBlankHtml(html)) return null;
            return <ArticleHtml key={f.key} safeHtml={html} id={f.key} />;
          }
          if (f.t === 'richtext') {
            const rt = asRichText(entry.data[f.key]);
            if (!rt) return null;
            return (
              <p key={f.key}>
                <RichTextView value={rt} scope={SCOPE} id={f.key} />
              </p>
            );
          }
          const v = entry.data[f.key];
          if (typeof v !== 'string' || !v.trim()) return null;
          return <p key={f.key}>{v}</p>;
        })}
      </article>
    </>
  );
}
