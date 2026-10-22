/**
 * Doc → React, hoàn toàn ở server. Không có 'use client' ở bất kỳ đâu trong file này.
 *
 * Mọi primitive phát ra `data-n="<id>"` — đó là móc mà CSS compiler nhắm vào, và cũng
 * là móc mà builder dùng để click-to-select trong iframe same-origin. Một attribute
 * phục vụ cả hai việc, nên chúng không thể lệch nhau.
 *
 * Effect KHÔNG được mount ở đây. Chúng đi qua một manifest phẳng cho EffectRuntime
 * (một client boundary duy nhất, mount một lần ở layout) để bất biến "một vòng lặp
 * animation" không bị phá bởi việc React mount rải rác nhiều island.
 */

import type { CSSProperties, ReactElement } from 'react';

import Image from 'next/image';
import Link from 'next/link';

import type {
  Doc,
  EffectAttachment,
  Node,
  NodeId,
  Responsive,
  RichDoc,
  RichText,
} from '@/lib/doc/types';
import { assetUrlValue, assetVarName } from './css';
import type { BindingScope } from './bindings';
import { RichTextView, plainText } from './richtext';
import { ArticleHtml } from './ArticleHtml';
import { RichDocView } from './richdoc';
import { itemOverrides, type RepeatItem } from '@/lib/collections/repeat';
import { EFFECT_ASSET_PARAMS } from '@/lib/builder/asset-refs';
import { Form } from '@/lib/composites/Form';
import { Accordion } from '@/lib/composites/Accordion';
import { NavChart } from '@/lib/composites/NavChart';
import type { AccordionParams, FormParams, NavChartParams } from '@/lib/composites/registry';
import type { NavPayload } from '@/lib/composites/nav-series';
import { siteEndpoint } from '@/lib/doc/site-bindings';
import { applyOverride, isLayoutTransparent, styleAssetIds } from './instance';
import type { ContentOverride } from '@/lib/doc/types';
import { entryFieldOf } from '@/lib/doc/types';
import { parseCompositeParams } from '@/lib/composites/registry';
import { projectComposite } from '@/lib/project/active';
import { CustomCodeBlock } from '@/components/site/CustomCodeBlock';

/* ── Effect manifest ──────────────────────────────────────────────────── */

export interface EffectManifestEntry {
  instanceId: string;
  /** Node trang: id node. Node trong component: id LOCAL — đi kèm `scopeId`. */
  nodeId: NodeId;
  /**
   * Id node `Instance` của DOC chứa node này, khi effect gắn trên node trong component.
   *
   * Id local chỉ duy nhất TRONG component (mười instance dùng chung), nên runtime tìm
   * phần tử bằng `[data-n=scopeId] [data-cn=nodeId]`: wrapper của instance mang
   * `data-n` duy nhất, và đó là cách để mỗi instance có effect của riêng nó.
   */
  scopeId?: NodeId;
  effect: string;
  params: Record<string, unknown>;
  gates: EffectAttachment['gates'];
}

/**
 * Tham số của `image-sequence` chứa assetId, và effect chạy phía client chỉ có
 * DOM — nó cần URL.
 *
 * ## Vì sao đổi ở ĐÂY chứ không để effect tự đi hỏi
 *
 * Effect chạy trong trình duyệt, nơi không có Prisma và không có `ctx.assets`.
 * Cho nó tự fetch nghĩa là thêm một endpoint công khai trả bảng asset, và một
 * lượt round-trip trước khi khung đầu tiên được vẽ. Manifest thì đã là thứ
 * server serialize xuống client sẵn rồi — nhét URL vào đó không tốn thêm gì
 * ngoài vài KB text.
 *
 * ## URL GỐC, không qua `/_next/image`
 *
 * Một lô 120 khung đi qua optimizer là 120 lượt transform ở lần tải đầu. Xem
 * docblock `image-sequence.ts` cho đánh đổi đầy đủ.
 *
 * ## assetId không tra được thì BỎ, không giữ nguyên
 *
 * Giữ nguyên id nghĩa là `img.src` trỏ vào một chuỗi không phải URL, và trình
 * duyệt nạp `/<id>` — một 404 giữa clip. Bỏ đi thì lô ngắn lại, và nếu ngắn quá
 * `min(2)` của schema sẽ từ chối cả effect; EffectRuntime log cảnh báo rồi đi
 * tiếp. Thua theo hướng "không chạy" tốt hơn thua theo hướng "chạy với ảnh vỡ".
 */
function resolveFrameParams(
  effect: string,
  params: Record<string, unknown>,
  assets: Record<string, AssetInfo> | undefined,
): Record<string, unknown> {
  if (!assets) return params;
  let out = params;
  // Cùng bảng với phép đếm "asset nào đang được dùng" — xem `EFFECT_ASSET_PARAMS`.
  for (const key of EFFECT_ASSET_PARAMS[effect] ?? []) {
    const value = params[key];
    if (!Array.isArray(value)) continue;
    const urls = value
      .map((id) => (typeof id === 'string' ? assets[id]?.url : undefined))
      .filter((url): url is string => Boolean(url));
    // Chỉ sao chép khi thật sự có gì để đổi — manifest của trang không có
    // sequence nào thì đi qua đây mà không sinh thêm object nào.
    if (out === params) out = { ...params };
    out[key] = urls;
  }
  return out;
}

/**
 * Gom phẳng mọi effect của trang, theo thứ tự id ổn định.
 *
 * `assets` tuỳ chọn, cùng khuôn với `components` ở `collectAssetIds`: chỗ gọi
 * nào có bảng asset thì truyền vào, và chỉ khi có nó thì lô khung của
 * `image-sequence` mới được đổi thành URL. Thiếu nó, mọi effect khác vẫn đúng —
 * không phải một nửa im lặng sai.
 */
export function collectEffects(
  doc: Doc,
  assets?: Record<string, AssetInfo>,
  /**
   * Cây component của trang. Thiếu thì effect gắn trong component KHÔNG vào manifest
   * (header/footer là component nên nó là thứ gần như luôn cần truyền).
   */
  components?: ReadonlyMap<string, { nodes: Record<string, Node> }>,
): EffectManifestEntry[] {
  return Object.keys(doc.nodes)
    .sort()
    .flatMap((id) => {
      const node = doc.nodes[id];
      if (!node) return [];
      const own = node.effects.map((a) => ({
        instanceId: a.id,
        nodeId: id,
        effect: a.effect,
        params: resolveFrameParams(a.effect, a.params, assets),
        gates: a.gates,
      }));

      /*
       * Effect gắn trên node BÊN TRONG component — chạy một lần cho mỗi instance.
       *
       * Instance LẶP thì bỏ qua: N bản của cùng một node không có phần tử nào đơn nhất
       * để gắn vào (và `repeat_effect` của validator đã cùng tinh thần). Instance không
       * lặp thì `data-n` của wrapper là duy nhất, nên `scopeId` đủ để runtime tìm đúng
       * bản của instance này khi một component được cắm hai lần trên trang.
       */
      if (node.type !== 'Instance' || node.repeat || node.render === false) return own;
      const tree = components?.get(node.componentId);
      if (!tree) return own;

      const inner = Object.keys(tree.nodes)
        .sort()
        .flatMap((localId) =>
          (tree.nodes[localId]?.effects ?? []).map((a) => ({
            // `a.id` chỉ duy nhất trong component; ghép id instance để duy nhất toàn trang.
            instanceId: `${id}:${a.id}`,
            nodeId: localId,
            scopeId: id,
            effect: a.effect,
            params: resolveFrameParams(a.effect, a.params, assets),
            gates: a.gates,
          })),
        );
      return [...own, ...inner];
    });
}

/* ── Asset ────────────────────────────────────────────────────────────── */

export interface AssetInfo {
  url: string;
  width?: number | null;
  height?: number | null;
  blurhash?: string | null;
  mime?: string | null;
}

/**
 * SVG phải đi vòng qua trình tối ưu ảnh.
 *
 * `next.config.mjs` cố ý KHÔNG bật `dangerouslyAllowSVG`, nên optimizer trả 400
 * cho mọi src `.svg` — logo và huy hiệu sẽ hỏng ảnh chứ không phải hiển thị xấu.
 * Và tối ưu một SVG vốn vô nghĩa: nó đã là vector, không có srcset nào để sinh
 * và không có gì để chuyển sang AVIF/WebP.
 *
 * Dùng `unoptimized` theo từng ảnh thay vì nới `dangerouslyAllowSVG` toàn cục:
 * cờ đó cho phép mọi SVG, kể cả file người dùng upload sau này, và một SVG có
 * `<script>` phục vụ từ chính origin của site là XSS.
 */
const isVector = (asset: AssetInfo) => asset.mime === 'image/svg+xml';

export interface RenderContext {
  doc: Doc;
  scope: BindingScope;
  assets: Record<string, AssetInfo>;
  /**
   * Cây component mà doc đang tham chiếu, theo `Preset.id`.
   *
   * Nạp MỘT lần cho cả trang rồi truyền xuống: một trang có mười thẻ sản phẩm
   * cùng component chỉ đọc cây đó một lần, và mọi instance dùng chung object đó
   * — nên `applyOverride` tuyệt đối không được sửa tại chỗ.
   */
  components?: ReadonlyMap<string, { rootId: string; nodes: Record<string, Node> }>;
  /** Node đầu tiên trong luồng đọc được ưu tiên tải — bảo vệ LCP. */
  lcpNodeId?: NodeId;

  /* ── Collection ──────────────────────────────────────────────────────
     Mọi thứ dưới đây được GIẢI QUYẾT TRƯỚC ở tầng trang rồi truyền xuống.

     `NodeRenderer` là hàm ĐỒNG BỘ gọi đệ quy. Biến nó thành async nghĩa là mọi
     node trên trang thành một Promise — mười nghìn Promise cho một trang, và mất
     luôn khả năng suy luận về số truy vấn, vốn là tiêu chí nghiệm thu của mốc 3.
     Nên trang gom mọi `repeat` trong doc, resolve chúng song song một lượt
     (`resolveAllRepeats` ở `collection-page.ts`), rồi mới render. */

  /** Item đã giải quyết cho mỗi `Instance` có `repeat`, theo `node.id`. */
  repeatItems?: ReadonlyMap<NodeId, RepeatItem[]>;
  /** Cấp NGOÀI của "FAQ theo danh mục": item kèm id danh mục để cấp trong tra ngược. */
  repeatGroups?: ReadonlyMap<NodeId, { item: RepeatItem; taxonomyId: string }[]>;
  /**
   * Cấp TRONG: `node.id` → (id danh mục → entry của danh mục đó).
   *
   * Đã nạp sẵn cho MỌI danh mục trong cùng lượt với cấp ngoài, nên renderer chỉ tra
   * bảng. Đây là chỗ mà "không N+1" thực sự được giữ: nếu cấp trong tự đi hỏi DB
   * cho từng danh mục thì 7 danh mục là 7 lượt đọc, và renderer đồng bộ không
   * `await` được nên nó sẽ phải trở thành async — xem ghi chú ngay trên.
   */
  repeatGroupEntries?: ReadonlyMap<NodeId, ReadonlyMap<string, RepeatItem[]>>;
  /** Item của khối đang lặp — cho binding `collection` và cho cấp lồng. */
  item?: RepeatItem;
  /** Danh mục của khối cha đang lặp, do cấp ngoài truyền xuống. */
  groupTaxonomyId?: string;
  /** Gốc trang chi tiết, ví dụ '/blogs/post'. Dùng dựng href từ slug. */
  detailBase?: string;
  /** Gốc trang danh mục, ví dụ '/blogs'. Khối lặp nguồn `taxonomy` dùng gốc NÀY. */
  taxonomyBase?: string;
  /**
   * Thân bài của entry đang mở, theo khoá field — cho các ô `part="entry:<field>"`.
   *
   * Vì sao không đi qua `overrides` như mọi thứ khác: `ContentOverride.content` là
   * `RichText`, tức CHỈ inline. Một field `richdoc` là cây KHỐI (h2, ul, figure,
   * quote) và không nhét được vào đó mà không mất hết cấu trúc. Xem `EntryBody`.
   */
  entryBody?: ReadonlyMap<string, EntryBody>;
  /**
   * Chuỗi NAV cho mỗi node `NavChart`, theo `node.id`. `null` = chưa nạp được.
   *
   * Cùng lý do như `repeatItems`: `NodeRenderer` là đồng bộ nên composite không
   * fetch được, và biến nó thành async là mười nghìn Promise cho một trang. Tầng
   * trang gom mọi `NavChart` rồi nạp song song một lượt — xem `nav-data.ts`.
   */
  navSeries?: ReadonlyMap<NodeId, NavPayload | null>;
  /**
   * Dữ liệu tầng trang cho composite của GÓI DỰ ÁN (`ProjectComposite.loadData`), theo
   * nodeId — cùng lý do với `navSeries` ngay trên. Vắng = chưa nạp (preview), composite
   * nhận `data: null`.
   */
  projectData?: ReadonlyMap<NodeId, unknown>;
}

/**
 * Một field thân bài đã được kiểm hình dạng ở tầng trang.
 *
 * Kiểm ở TẦNG TRANG chứ không ở đây: `Entry.data` đi qua nguyên trạng từ JSONB, nên
 * một field vừa đổi kiểu sẽ mang hình dạng khác — và renderer không phải chỗ chạy zod
 * cho từng node.
 */
export type EntryBody =
  | { kind: 'doc'; value: RichDoc }
  | { kind: 'text'; value: RichText }
  | { kind: 'plain'; value: string }
  /**
   * `html` — chuỗi ĐÃ LÀM SẠCH. Tên biến thể không mang chữ "safe" nhưng luật thì có:
   * `entryBodies()` là chỗ duy nhất dựng ra biến thể này, và nó làm sạch trước khi
   * đặt vào. Xem docblock của `ArticleHtml`.
   */
  | { kind: 'html'; value: string };

/* ── Helpers ──────────────────────────────────────────────────────────── */

function baseOf<T>(r: Responsive<T> | undefined, fallback: T): T {
  return r?.base ?? fallback;
}

/**
 * Attribute chung cho mọi node.
 *
 * `data-fx` liệt kê effect key để CSS tĩnh nhắm được vào node có effect (ví dụ
 * `[data-fx~="reveal"] { opacity: 0 }`) mà không cần đợi JS chạy. Đây là cách giữ
 * nguyên quy ước "CSS sở hữu trạng thái, JS sở hữu trigger" của site cũ.
 */
/**
 * Nội dung của một slot composite.
 *
 * Trả `null` khi slot rỗng chứ không một `<>` trống: composite dùng giá trị đó
 * làm prop (`heading`, `note`), và `null` là thứ nó kiểm được để bỏ hẳn khung
 * bao ngoài.
 */
function Slot({
  ids,
  renderChild,
}: {
  ids: NodeId[] | undefined;
  renderChild: RenderChild;
}) {
  if (!ids?.length) return null;
  return <>{ids.map((id) => renderChild(id))}</>;
}

/**
 * Cách dựng một node con theo id — `NodeRenderer` cho node trang, `InstanceChild` cho
 * node trong component.
 *
 * Composite/Video/CustomCode dùng CHUNG một đường dựng cho cả hai nơi; thứ duy nhất
 * khác là id con trỏ vào cây nào, nên cây được truyền vào dưới dạng hàm này thay vì để
 * composite tự biết `ctx.doc` hay `tree`.
 */
type RenderChild = (id: NodeId) => ReactElement;


/**
 * `--asset-<id>: url("…")` cho MỌI ảnh nền mà node này khai.
 *
 * Nửa còn lại của hợp đồng `fill.image` — xem `assetVarName` trong `css.ts`.
 * Compiler phát `background-image: var(--asset-<id>)` và cố ý không biết gì về S3;
 * chỗ duy nhất biết URL là renderer, vì `ctx.assets` chỉ tồn tại ở đây. Trước đợt
 * này không ai định nghĩa biến đó, nên mọi ảnh nền đặt qua asset đều rơi về `none`
 * mà không có một lỗi nào.
 *
 * Vì sao là inline style chứ không phải một khối CSS: biến phải phủ MỌI lớp — một
 * ảnh nền chỉ đặt ở `md`, ở `hover`, hay ở một state do effect bật đều dùng chung
 * một khai báo trên chính element đó, nên không cần nhân bản theo breakpoint. Và
 * `compileDoc` không nhận `assets`; truyền nó xuống tận đó là bắt mọi route gọi
 * compiler phải nạp ảnh trước, kể cả route không có ảnh nền nào.
 *
 * Asset đã bị xoá thì KHÔNG phát biến. `background-image` rơi về `none` — đúng hành
 * vi của `ImageNode` khi asset biến mất, và builder có chỗ riêng chỉ ra ảnh mồ côi.
 */
export function assetVars(
  node: Node,
  assets: Record<string, AssetInfo>,
): CSSProperties | undefined {
  let out: Record<string, string> | undefined;

  for (const id of styleAssetIds(node)) {
    const url = assets[id]?.url;
    if (!url) continue;
    (out ??= {})[assetVarName(id)] = assetUrlValue(url);
  }

  // `CSSProperties` không khai custom property, nhưng React ghi `--x: y` ra DOM y
  // như mọi key khác. Ép kiểu đúng một chỗ, ngay tại biên.
  return out as CSSProperties | undefined;
}

function common(node: Node, ctx: RenderContext) {
  const fx = node.effects.map((e) => e.effect).join(' ');
  const vars = assetVars(node, ctx.assets);
  return {
    'data-n': node.id,
    ...(vars ? { style: vars } : {}),
    ...(fx ? { 'data-fx': fx } : {}),
    // Hợp đồng giữa cây node và runtime effect — xem NodeBase.part.
    ...(node.part ? { 'data-part': node.part } : {}),
    // Ô cắm thân bài mang thêm `data-mm-article` để `ARTICLE_CSS` bắt được nó. Phát ở
    // đây chứ không bắt tác giả tự đặt: quên nó nghĩa là bài viết render ra một khối
    // chữ cùng cỡ không bullet (reset.css làm phẳng mọi khối) — trông như dữ liệu
    // hỏng, không như một style thiếu.
    ...(entryFieldOf(node.part) ? { 'data-mm-article': '' } : {}),
    ...(node.htmlId ? { id: node.htmlId } : {}),
    ...(node.a11y?.role ? { role: node.a11y.role } : {}),
    ...(node.a11y?.label ? { 'aria-label': node.a11y.label } : {}),
    ...(node.a11y?.labelledBy ? { 'aria-labelledby': node.a11y.labelledBy } : {}),
  };
}

/**
 * Ô cắm thân bài: `part="entry:<field>"`.
 *
 * ## Vì sao là `part`, không phải một node type mới và không phải một override
 *
 * `part` đã là "hợp đồng với runtime" (xem `NodeBase.part`) — đúng thứ đang cần: một
 * node bố cục bất kỳ trong template chi tiết nói "chỗ này là thân bài", và tác giả vẫn
 * đặt padding, nền, chiều rộng cho nó như mọi node khác.
 *
 * Không dùng `overrides`/`ContentOverride`: `content` ở đó là `RichText`, tức CHỈ
 * inline. Field `richdoc` là cây khối — h2, danh sách, ảnh có chú thích. Nhét nó vào
 * `RichText` là làm cả bài thành một đoạn văn liền, không tiêu đề, không bullet.
 *
 * Không có dữ liệu cho ô này thì trả `null` để `Children` render con thật của node —
 * nên trong builder khu đó vẫn hiện nội dung mẫu người dựng đã đặt, thay vì biến mất.
 */
function entrySlot(node: Node, ctx: RenderContext) {
  const key = entryFieldOf(node.part);
  const body = key ? ctx.entryBody?.get(key) : undefined;
  if (!body) return null;

  switch (body.kind) {
    case 'doc':
      return <RichDocView value={body.value} assets={ctx.assets} scope={ctx.scope} id={node.id} />;
    case 'html':
      return <ArticleHtml safeHtml={body.value} id={node.id} />;
    case 'text':
      return <RichTextView value={body.value} scope={ctx.scope} id={node.id} />;
    case 'plain':
      return <>{body.value}</>;
  }
}

function Children({ node, ctx }: { node: Node; ctx: RenderContext }) {
  const slot = entrySlot(node, ctx);
  if (slot) return slot;

  return (
    <>
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} ctx={ctx} />
      ))}
    </>
  );
}


/* ── Dựng dùng chung cho node trang VÀ node trong component ────────────── */

/**
 * `props` là attribute chung đã dựng sẵn: `common(node, ctx)` (data-n) cho node trang,
 * `attrs` (data-cn) cho node trong component. Tách ra để một nhánh render phục vụ cả
 * hai nơi — hai bản chép riêng là hẹn ngày chúng lệch nhau (đã từng xảy ra với
 * `submit` của Button).
 */
type Attrs = Record<string, unknown>;
type NodeOf<T extends Node['type']> = Extract<Node, { type: T }>;

function renderVideo(node: NodeOf<'Video'>, props: Attrs, ctx: RenderContext) {
  const asset = node.assetId ? ctx.assets[node.assetId] : undefined;
  const poster = node.posterAssetId ? ctx.assets[node.posterAssetId] : undefined;
  if (!asset) {
    // Site cũ ship poster mà không ship video ở một số chỗ — đó là trạng thái
    // degrade hợp lệ, không phải lỗi.
    return poster ? (
      <span {...props}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster.url} alt="" />
      </span>
    ) : null;
  }
  return (
    <video
      {...props}
      src={asset.url}
      poster={poster?.url}
      autoPlay={node.autoplay}
      loop={node.loop}
      muted={node.muted ?? node.autoplay}
      controls={node.controls}
      playsInline
      preload={node.preload ?? (node.autoplay ? 'auto' : 'none')}
    />
  );
}

function renderCustomCode(node: NodeOf<'CustomCode'>, props: Attrs) {
  /*
   * `iframe` render thật từ 26/08/2026. `inline` vẫn KHÔNG render.
   *
   * Khác biệt không phải mức độ hoàn thiện mà là mô hình bảo mật. Trong
   * iframe, JS chạy ở một realm riêng với origin mờ — nó không chạm được DOM
   * trang, không đọc được cookie, không thấy được form nào. `inline` thì
   * ngược lại: HTML và JS của người dùng vào thẳng realm của trang. Repo CÓ
   * `sanitize-html` (từ khi có field `html` của bài viết — xem
   * `collections/html-sanitize.ts`), nhưng nó làm sạch nội dung bài theo một
   * allowlist thẻ hẹp; nó không phải và không được dùng làm chỗ chạy HTML/JS
   * tuỳ ý của người dùng trong realm của trang.
   *
   * Nên `inline` giữ nguyên trạng thái cũ: không render gì. Thà thiếu một
   * khối còn hơn mở một lỗ XSS trên site tài chính. Validator từ chối
   * `inline` có `js` ngay ở đường ghi, nên ca này chỉ còn là hàng rào cuối.
   */
  if (node.mode !== 'iframe') {
    return <div {...props} data-customcode-pending={node.mode} />;
  }

  // Không có gì để chạy thì không dựng iframe — một iframe rỗng vẫn là một
  // tài liệu nữa cho trình duyệt phải dựng.
  if (!node.html && !node.css && !node.js) {
    return <div {...props} data-customcode-empty="" />;
  }

  return (
    <div {...props} data-customcode="iframe">
      <CustomCodeBlock
        nodeId={node.id}
        html={node.html}
        css={node.css}
        js={node.js}
        height={node.height}
      />
    </div>
  );
}

/**
 * `groupSeed` làm `name` cho nhóm Accordion: phải khác nhau giữa các accordion trên
 * cùng trang — với node trang đó là `node.id`, với node trong component là
 * "id instance + id local" (hai instance cùng component không được chung nhóm).
 */
function renderComposite(
  node: NodeOf<'Composite'>,
  props: Attrs,
  ctx: RenderContext,
  renderChild: RenderChild,
  groupSeed: string,
) {
  /**
   * Composite đã có runtime thì nó TỰ dựng DOM.
   *
   * Khác effect ở điểm bản chất: DOM của effect là cây node do người dùng
   * dựng, còn DOM ở đây được TÍNH RA — đường NAV phụ thuộc mốc thời gian
   * đang chọn. Không ai dựng nổi thứ đó trong cây node, và nếu dựng được thì
   * mỗi lần đổi mốc là một loạt op ghi vào database.
   *
   * Vẫn render trên server: HTML ban đầu mang trọn trạng thái nghỉ, nên tắt
   * JavaScript thì section vẫn đọc được và crawler thấy số thật.
   */
  if (node.composite === 'Form') {
    const params = parseCompositeParams(node.composite, node.params) as FormParams;
    return (
      <div {...props} data-composite={node.composite}>
        <Form
          {...params}
          action={siteEndpoint(ctx.scope.site, params.endpointKey)}
          heading={<Slot ids={node.slots.heading} renderChild={renderChild} />}
          note={<Slot ids={node.slots.note} renderChild={renderChild} />}
        />
      </div>
    );
  }

  if (node.composite === 'Accordion') {
    const params = parseCompositeParams(node.composite, node.params) as AccordionParams;
    return (
      <div {...props} data-composite={node.composite}>
        <Accordion
          {...params}
          slots={node.slots}
          // `name` của nhóm lấy theo id node: hai accordion trên cùng trang
          // chung `name` thì mở mục ở khối này sẽ đóng mục ở khối kia.
          groupName={groupSeed}
          renderChild={renderChild}
        />
      </div>
    );
  }

  if (node.composite === 'NavChart') {
    const params = parseCompositeParams(node.composite, node.params) as NavChartParams;
    return (
      <div {...props} data-composite={node.composite}>
        <NavChart
          {...params}
          // `?? null` chứ không `undefined`: bản đồ vắng node này nghĩa là
          // tầng trang chưa chạy `resolveAllNavCharts` (ví dụ preview trong
          // builder), và composite phải nói ra thay vì hiện khung rỗng.
          data={ctx.navSeries?.get(node.id) ?? null}
          heading={<Slot ids={node.slots.heading} renderChild={renderChild} />}
          note={<Slot ids={node.slots.note} renderChild={renderChild} />}
        />
      </div>
    );
  }

  /*
   * Composite của GÓI DỰ ÁN (QUILDER_PROJECT). Params parse bằng schema của chính nó —
   * `.parse` chứ không `safeParse`: schema của gói nên `.catch()` như composite lõi, để một
   * hàng JSONB hỏng không làm trắng trang.
   */
  const fromProject = projectComposite(node.composite);
  if (fromProject) {
    const Component = fromProject.Component;
    return (
      <div {...props} data-composite={node.composite}>
        <Component
          nodeId={node.id}
          params={fromProject.params.parse(node.params ?? {})}
          slots={node.slots}
          renderChild={renderChild}
          site={ctx.scope.site ?? {}}
          data={ctx.projectData?.get(node.id) ?? null}
        />
      </div>
    );
  }

  // Composite còn lại chưa có runtime: render slot ra một div trơn để nội
  // dung bên trong không biến mất khỏi trang trong lúc chờ.
  // Gồm cả composite của một gói KHÔNG bật (doc chép từ site khác): nội dung slot vẫn
  // hiện, chỉ phần tự dựng DOM của composite là vắng.
  return (
    <div {...props} data-composite={node.composite}>
      {Object.keys(node.slots)
        .sort()
        .flatMap((slot) => node.slots[slot] ?? [])
        .map((id) => (
          renderChild(id)
        ))}
    </div>
  );
}

/** Href chỉ có phần hash (`#contact`): neo trong CHÍNH trang, không phải điều hướng. */
const isHashHref = (href: string) => href.startsWith('#');

const isExternalHref = (href: string, target?: string) =>
  target === '_blank' || /^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href);

/**
 * Button ở cả node trang lẫn node trong component.
 *
 * `anchorHref` do chỗ gọi tính (nó phụ thuộc cây nào chứa node đích). Href của action
 * `link` nhận mọi dạng schema cho phép: tuyệt đối, `mailto:`/`tel:`, route nội bộ
 * (`/blogs`), route + hash (`/#chapters`) và hash thuần (`#section-3`).
 */
function renderButton(
  node: NodeOf<'Button'>,
  props: Attrs,
  ctx: RenderContext,
  anchorHref: string,
) {
  const label = <RichTextView value={node.label} scope={ctx.scope} id={node.id} />;
  const cls = `btn btn--${node.variant}`;

  switch (node.action.kind) {
    case 'link': {
      const { href, target, rel } = node.action;

      // Hash thuần dùng <a> thường chứ không next/link: `scroll.bindAnchors` bắt mọi
      // `a[href^="#"]` để cuộn mượt qua Lenis, và Link sẽ tự xử lý hash trước nó.
      if (isExternalHref(href, target) || isHashHref(href)) {
        return (
          <a
            {...props}
            className={cls}
            href={href}
            {...(target === '_blank' ? { target: '_blank', rel: rel ?? 'noopener noreferrer' } : {})}
          >
            {label}
          </a>
        );
      }

      // Link nội bộ phải đi qua next/link. Thẻ <a> thuần reload cả trang,
      // tức mất prefetch, mất giữ trạng thái, và EffectRuntime bị dựng lại
      // từ đầu mỗi lần bấm — đúng thứ kiến trúc một-vòng-lặp muốn tránh.
      return (
        <Link {...props} className={cls} href={href}>
          {label}
        </Link>
      );
    }
    case 'anchor':
      return (
        <a {...props} className={cls} href={anchorHref} data-anchor="">
          {label}
        </a>
      );
    case 'submit':
      return (
        <button {...props} className={cls} type="submit" form={node.action.formId}>
          {label}
        </button>
      );
    default:
      return (
        <button {...props} className={cls} type="button">
          {label}
        </button>
      );
  }
}

/* ── Renderer ─────────────────────────────────────────────────────────── */

export function NodeRenderer({ nodeId, ctx }: { nodeId: NodeId; ctx: RenderContext }) {
  const node = ctx.doc.nodes[nodeId];
  if (!node) return null;

  // Ẩn ở base nghĩa là không render gì cả. Ẩn theo breakpoint là việc của CSS
  // (display:none), không phải của renderer — nếu không thì HTML sẽ khác nhau
  // giữa các viewport và hydration mismatch.
  if (node.render === false) return null;

  switch (node.type) {
    case 'Section': {
      const Tag = node.tag;
      return (
        <Tag {...common(node, ctx)}>
          <Children node={node} ctx={ctx} />
        </Tag>
      );
    }

    case 'Stack':
    case 'Grid':
      return (
        <div {...common(node, ctx)}>
          <Children node={node} ctx={ctx} />
        </div>
      );

    case 'Text': {
      const Tag = node.tag;
      return (
        <Tag {...common(node, ctx)}>
          <RichTextView value={node.content} scope={ctx.scope} id={node.id} />
        </Tag>
      );
    }

    case 'Image': {
      const asset = node.assetId ? ctx.assets[node.assetId] : undefined;
      if (!asset) return null;

      const ratio = baseOf(node.ratio, null);
      const priority = ctx.lcpNodeId === node.id;

      // width/height lấy từ bảng Asset để trình duyệt giữ chỗ đúng ngay từ đầu —
      // CLS = 0 mà không cần đoán. Thiếu số đo thì rơi về aspect-ratio, đúng cách
      // .card-work__media ở site cũ đang làm.
      if (asset.width && asset.height) {
        return (
          <Image
            {...common(node, ctx)}
            src={asset.url}
            alt={node.decorative ? '' : node.alt}
            width={asset.width}
            height={asset.height}
            priority={priority}
            unoptimized={isVector(asset)}
            {...(node.decorative ? { 'aria-hidden': true } : {})}
          />
        );
      }

      return (
        <span
          {...common(node, ctx)}
          // Gộp, không đè: `common` đã đặt `--asset-…` vào cùng thuộc tính này, và
          // một `style=` thứ hai trên cùng element sẽ nuốt mất nó.
          style={{ ...assetVars(node, ctx.assets), ...(ratio ? { aspectRatio: ratio } : {}) }}
        >
          <Image
            src={asset.url}
            alt={node.decorative ? '' : node.alt}
            fill
            priority={priority}
            unoptimized={isVector(asset)}
          />
        </span>
      );
    }

    case 'Button': {
      const action = node.action;
      // Ưu tiên htmlId do tác giả đặt; nếu không có thì dùng data-n làm neo.
      const target = action.kind === 'anchor' ? ctx.doc.nodes[action.toNodeId] : undefined;
      const anchorHref =
        action.kind === 'anchor'
          ? target?.htmlId ? `#${target.htmlId}` : `#${action.toNodeId}`
          : '';
      return renderButton(node, common(node, ctx), ctx, anchorHref);
    }

    case 'Video':
      return renderVideo(node, common(node, ctx), ctx);

    case 'Canvas': {
      // CHƯA có runtime nào dựng canvas từ `program` (08/10/2026: không file nào
      // trong src/lib/motion đọc `data-canvas`). Node này hiện chỉ render nhánh
      // fallback — đó cũng là thứ không-WebGL và không-JS sẽ thấy khi runtime có,
      // nên thang degradation đã đúng sẵn bằng cấu trúc. Ghi rõ để không ai gắn
      // một `program` rồi chờ nó chạy.
      return (
        <div {...common(node, ctx)} data-canvas={node.program}>
          {node.fallbackChildId ? (
            <NodeRenderer nodeId={node.fallbackChildId} ctx={ctx} />
          ) : null}
        </div>
      );
    }

    case 'CustomCode':
      return renderCustomCode(node, common(node, ctx));

    case 'Composite':
      return renderComposite(
        node,
        common(node, ctx),
        ctx,
        (id) => <NodeRenderer key={id} nodeId={id} ctx={ctx} />,
        node.id,
      );


    case 'Instance': {
      const tree = ctx.components?.get(node.componentId);
      // Component đã bị xoá khỏi thư viện. Không render gì và KHÔNG ném: một
      // instance mồ côi không đáng làm cả trang trắng, và builder có chỗ riêng
      // để chỉ ra nó.
      if (!tree) return <div {...common(node, ctx)} data-instance-missing={node.componentId} />;

      // Không lặp: y hệt như trước, một lần. Nhánh này đứng trước mọi thứ khác để
      // hành vi của mọi trang đang chạy không phụ thuộc vào một dòng nào bên dưới.
      if (!node.repeat) {
        // Wrapper trong suốt khi root component sticky/fixed — xem `isLayoutTransparent`.
        // Gộp vào `style` chứ không thêm một `style=` thứ hai (nó sẽ nuốt `--asset-…`).
        const base = common(node, ctx);
        const props = isLayoutTransparent(node, tree)
          ? { ...base, style: { ...base.style, display: 'contents' } }
          : base;
        return (
          <div {...props} data-c={node.componentId}>
            <InstanceChild
              localId={tree.rootId}
              tree={tree}
              overrides={node.overrides}
              ctx={ctx}
              // Instance KHÔNG lặp → id trong component là duy nhất trên trang, nên
              // phát `htmlId` được (header/footer cần #contact, #footer-email...).
              instanceKey={node.id}
              emitIds
            />
          </div>
        );
      }

      const spec = node.repeat;
      const groups = ctx.repeatGroups?.get(node.id);
      const items =
        groups?.map((g) => g.item) ??
        // Cấp TRONG của "FAQ theo danh mục": tra bảng đã nạp sẵn theo danh mục mà cấp
        // ngoài đang lặp. Không có `groupTaxonomyId` nghĩa là node này không nằm dưới
        // một khối lặp theo danh mục — validator đã chặn ca đó (`repeat_group_parent`),
        // nên ở đây nó chỉ còn là một doc cũ, và câu trả lời đúng là danh sách rỗng.
        (spec.source.kind === 'group-entries'
          ? (ctx.groupTaxonomyId
              ? ctx.repeatGroupEntries?.get(node.id)?.get(ctx.groupTaxonomyId)
              : undefined) ?? []
          : ctx.repeatItems?.get(node.id) ?? []);

      if (items.length === 0) {
        if (spec.empty && 'hide' in spec.empty) return null;
        if (spec.empty && 'text' in spec.empty) {
          return (
            <div {...common(node, ctx)} data-repeat-empty="">
              <RichTextView value={spec.empty.text} scope={ctx.scope} id={node.id} />
            </div>
          );
        }
        // Không khai `empty` thì render MỘT lần với nội dung của component. Đó là hành
        // vi ít gây bất ngờ nhất khi dựng: khu không biến mất khỏi canvas chỉ vì chưa
        // có dữ liệu, và người dựng vẫn chọn được nó để sửa ánh xạ.
        return (
          <div {...common(node, ctx)} data-c={node.componentId} data-repeat-empty="">
            <InstanceChild
              localId={tree.rootId}
              tree={tree}
              overrides={node.overrides}
              ctx={ctx}
              instanceKey={node.id}
            />
          </div>
        );
      }

      /**
       * Fragment, KHÔNG một div bọc.
       *
       * Mười thẻ phải là con TRỰC TIẾP của `Grid`/`Stack` cha, nếu không lưới nhận
       * đúng một con và mười thẻ xếp dọc bên trong nó. Đó chính là lý do `repeat` là
       * một field trên `Instance` chứ không phải một node bọc.
       *
       * Hệ quả: `data-n` không còn duy nhất trong document. Chấp nhận CÓ Ý THỨC —
       * CSS compiler nhắm `[data-n="…"]` và khớp cả mười là ĐÚNG (chúng là cùng một
       * node của doc), `Canvas` dùng `querySelector` nên click-to-select chọn thẻ đầu
       * (cũng đúng), và effect trên node lặp đã bị validator chặn từ đường ghi
       * (`repeat_effect`) vì `EffectRuntime` chỉ gắn được vào một phần tử.
       */
      return (
        <>
          {items.map((item, i) => {
            // `blockComponents`: mỗi loại khối một component. Chỉ có nghĩa với nguồn
            // `field` trên một field `blocks`, và validator chặn nó ở nguồn khác.
            const blockType = item.data.__type;
            const componentId =
              (typeof blockType === 'string' ? spec.blockComponents?.[blockType] : undefined) ??
              node.componentId;
            const itemTree = ctx.components?.get(componentId);
            // Khối trỏ tới một component đã bị xoá: BỎ QUA item đó, không ném. Y như
            // bản dịch mồ côi và override mồ côi — một khối lỗi không được làm trắng
            // cả trang.
            if (!itemTree) return null;

            const merged = {
              ...node.overrides,
              ...itemOverrides(item, spec, {
                detailBase: ctx.detailBase,
                taxonomyBase: ctx.taxonomyBase,
              }),
            };
            const childCtx: RenderContext = {
              ...ctx,
              item,
              scope: { ...ctx.scope, collection: item.data },
              // Cấp trong của "FAQ theo danh mục" đọc danh mục từ đây.
              groupTaxonomyId: groups?.[i]?.taxonomyId ?? ctx.groupTaxonomyId,
            };
            return (
              <div key={item.key} {...common(node, ctx)} data-c={componentId} data-i={i}>
                <InstanceChild
                  localId={itemTree.rootId}
                  tree={itemTree}
                  overrides={merged}
                  ctx={childCtx}
                  // `htmlId` KHÔNG phát ở đây: mười thẻ cùng id là HTML sai và `#id`
                  // sẽ trỏ vào thẻ đầu.
                  instanceKey={`${node.id}-${i}`}
                />
                {/*
                  Node con của DOC, sau cây component.

                  Gần như luôn rỗng: `Instance` là lá. Ngoại lệ duy nhất là cấp
                  TRONG của "FAQ theo danh mục" — validator chỉ cho một con, và con
                  ấy phải là khối lặp nguồn `group-entries` (xem `nestedRepeatIssue`).

                  Thứ tự quan trọng: cây component dựng phần khung của một danh mục
                  (tiêu đề nhóm, số bài), còn con trong doc là danh sách bài. Đảo lại
                  là danh sách đứng trước tiêu đề của chính nó.

                  `childCtx` chứ không `ctx`: nó mang `groupTaxonomyId` của item này,
                  và đó là toàn bộ thứ cấp trong cần để biết lấy bài của danh mục nào.
                */}
                {node.children.map((childId) => (
                  <NodeRenderer key={childId} nodeId={childId} ctx={childCtx} />
                ))}
              </div>
            );
          })}
        </>
      );
    }

    default:
      return null;
  }
}

/**
 * Một node BÊN TRONG cây component.
 *
 * Không dùng lại `NodeRenderer`: node của component không nằm trong `ctx.doc`, và
 * nó phát ra `data-cn` chứ không phát `data-n`.
 *
 * Vì sao `data-cn` chứ không `data-n`: một trang có thể mang mười instance của
 * cùng component, và `data-n` phải là duy nhất — nó là móc mà CSS compiler nhắm
 * tới và là móc builder dùng để click-to-select. Style của component scope theo
 * `[data-c="…"] [data-cn="…"]`, nên mười instance dùng chung một khối rule.
 */
function InstanceChild({
  localId,
  tree,
  overrides,
  ctx,
  instanceKey,
  emitIds = false,
}: {
  localId: string;
  tree: { rootId: string; nodes: Record<string, Node> };
  overrides: Record<string, ContentOverride>;
  ctx: RenderContext;
  /** Khoá riêng của instance (id node Instance, kèm chỉ số khi lặp) — tách nhóm Accordion. */
  instanceKey: string;
  /**
   * Có phát `htmlId` của node trong component không.
   *
   * Chỉ instance KHÔNG lặp: instance lặp cho ra N bản cùng một id, và `id` trùng là
   * HTML sai, `#anchor` chỉ trúng bản đầu.
   */
  emitIds?: boolean;
}) {
  const source = tree.nodes[localId];
  if (!source) return null;

  const node = applyOverride(source, overrides[localId]);
  if (node.render === false) return null;

  const vars = assetVars(node, ctx.assets);
  const attrs = {
    'data-cn': node.id,
    ...(vars ? { style: vars } : {}),
    ...(node.effects.length ? { 'data-fx': node.effects.map((e) => e.effect).join(' ') } : {}),
    // Hợp đồng với runtime effect: effect gắn trên một node của component tìm các
    // phần của nó qua `data-part` bên trong phần tử đó — xem `collectEffects`.
    ...(node.part ? { 'data-part': node.part } : {}),
    ...(emitIds && node.htmlId ? { id: node.htmlId } : {}),
    ...(node.a11y?.role ? { role: node.a11y.role } : {}),
    ...(node.a11y?.label ? { 'aria-label': node.a11y.label } : {}),
    ...(node.a11y?.labelledBy ? { 'aria-labelledby': node.a11y.labelledBy } : {}),
  };

  const renderChild: RenderChild = (childId) => (
    <InstanceChild
      key={childId}
      localId={childId}
      tree={tree}
      overrides={overrides}
      ctx={ctx}
      instanceKey={instanceKey}
      emitIds={emitIds}
    />
  );
  const kids = node.children.map(renderChild);

  switch (node.type) {
    case 'Section': {
      const Tag = node.tag;
      return <Tag {...attrs}>{kids}</Tag>;
    }
    case 'Stack':
    case 'Grid':
      return <div {...attrs}>{kids}</div>;
    case 'Text': {
      const Tag = node.tag;
      return (
        <Tag {...attrs}>
          <RichTextView value={node.content} scope={ctx.scope} id={node.id} />
        </Tag>
      );
    }
    case 'Image': {
      const asset = node.assetId ? ctx.assets[node.assetId] : undefined;
      if (!asset) return null;
      return (
        <Image
          {...attrs}
          src={asset.url}
          alt={node.decorative ? '' : node.alt}
          width={asset.width ?? 1200}
          height={asset.height ?? 800}
          {...(node.decorative ? { 'aria-hidden': true } : {})}
        />
      );
    }
    case 'Button': {
      /*
       * Cùng một `renderButton` với node trang — trước đây đường này tự dựng riêng và
       * lệch (anchor/none thành <button>, hash đi qua next/link).
       *
       * Anchor trong component: đích là node LOCAL, và chỉ trỏ được tới nó khi nó có
       * `htmlId` (node local không có `data-n` để làm neo dự phòng). Không có thì
       * rơi về `#<localId>`, tức một neo chết — validator của component chưa chặn ca
       * này, nên nói ra ở đây thay vì im lặng.
       */
      const action = node.action;
      const target = action.kind === 'anchor' ? tree.nodes[action.toNodeId] : undefined;
      const anchorHref =
        action.kind === 'anchor'
          ? target?.htmlId ? `#${target.htmlId}` : `#${action.toNodeId}`
          : '';
      return renderButton(node, attrs, ctx, anchorHref);
    }
    case 'Video':
      return renderVideo(node, attrs, ctx);
    case 'CustomCode':
      return renderCustomCode(node, attrs);
    case 'Composite':
      return renderComposite(node, attrs, ctx, renderChild, `${instanceKey}-${node.id}`);
    default:
      // Canvas và Instance bên trong component: chưa hỗ trợ. Canvas hiện chỉ render
      // nhánh fallback ở node trang và cần `fallbackChildId` trỏ vào cùng cây; Instance
      // lồng bị `applyOpsToPreset` chặn ngay từ đường ghi (selector hậu duệ của CSS).
      // Trả về null im lặng thay vì render sai.
      return null;
  }
}

/** Tiêu đề trang suy ra từ node h1 đầu tiên — dùng khi Page.title bỏ trống. */
export function inferHeading(doc: Doc): string | null {
  for (const id of Object.keys(doc.nodes).sort()) {
    const n = doc.nodes[id];
    if (n?.type === 'Text' && n.tag === 'h1') return plainText(n.content);
  }
  return null;
}
