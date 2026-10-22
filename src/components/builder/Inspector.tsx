'use client';

/**
 * Inspector — pane phải.
 *
 * Control ở đây phát ra `setStyle` — CÙNG loại op mà AI phát. Đó là payoff quan
 * trọng nhất của thiết kế op có kiểu: một đường mutation, một validator, một
 * history stack, một audit trail. Kéo một ô số cũng undo được như mọi thao tác
 * khác, và không có đường ghi tắt nào tồn tại song song.
 *
 * Mọi thay đổi ghi vào LỚP ĐANG XEM (chọn bằng cách bấm khung trên canvas).
 * Control hiện giá trị CÓ HIỆU LỰC và đánh dấu riêng thứ được đặt ở lớp này —
 * xem `style-resolve.ts` để biết vì sao phân biệt đó là bắt buộc.
 */

import { useEffect, useMemo, useState } from 'react';

import { breakpointInfo, type Breakpoint } from '@/lib/design/breakpoints';
import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { effectiveStyle, ownLayer } from '@/lib/builder/style-resolve';
import { declaredProperties, sanitizeCustomCss } from '@/lib/render/sanitize-css';
import { scopeForTarget } from '@/lib/builder/css-scope';
import { STYLE_CSS_PROPERTY, propertiesFor, searchKeysFor } from '@/lib/builder/style-css-map';
import { selectSaving, selectStyleLocked, useEditor } from '@/lib/builder/store';
import { formatColor, formatLen } from '@/lib/builder/value-io';
import { labelOf } from '@/lib/builder/node-label';
import type { EndpointTable } from '@/lib/doc/endpoint-table';
import { ContentPanel } from './ContentPanel';
import { EndpointPicker } from './EndpointPicker';
import { ExtraFields } from './ExtraFields';
import { LayerMap } from './LayerMap';
import { TailwindPanel } from './TailwindPanel';
import { NodeAssetPicker, VIDEO_KINDS } from './NodeAssetPicker';
import { InspectorHead, type LocaleOption } from './InspectorHead';
import { PageSeoPanel, type PageSeo } from './PageSeoPanel';
import type { DraftTranslation } from '@/lib/i18n/queries';
import { InstancePanel } from './InstancePanel';
import type { ComponentTrees } from '@/lib/builder/text-units';
import type { FieldDef } from '@/lib/collections/field-def';
import { VIRTUAL_KEYS } from '@/lib/collections/repeat';
import { plainText } from '@/lib/render/richtext';
import { SORTABLE_COLUMNS } from '@/lib/doc/types';
import type { ContentOverride, Doc, Node, RepeatSpec, StyleProps } from '@/lib/doc/types';
import {
  BoxModel,
  ColorControl,
  LenControl,
  NumberControl,
  ROW,
  SEG,
  Section,
  SegmentedControl,
  UnitPicker,
  SelectControl,
  type TokenOption,
} from './controls';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Checkbox, SearchField, SelectField, TextField } from './ui/Field';
import { Icon } from './ui/Icon';
import { EmptyState } from './ui/Page';

/*
 * Lựa chọn của các dải nút.
 *
 * Từ 21/10/2026 nhãn là GIÁ TRỊ CSS (`wrap`, `solid`), không phải chữ tiếng Việt
 * ("xuống dòng", "liền"): nhãn của hàng đã là tên CSS (`flex-wrap`), và một hàng nói
 * hai thứ tiếng là một hàng phải dịch trong đầu. Chỗ giá trị CÓ hình dạng (căn chỉnh,
 * hướng trục) thì dùng icon — đúng cách Framer làm, và năm nút chữ không vừa cột control.
 *
 * Mọi nút đều có `hint` đi vào tooltip + `aria-label`, nên icon không phải là thông tin
 * duy nhất — WCAG 1.1.1.
 */
/** `display`: bốn giá trị hay dùng nằm trên dải, hai giá trị còn lại sau nút "…". */
const DISPLAY = [
  { value: 'block', label: 'block', hint: 'block — khối thường' },
  { value: 'flex', label: 'flex', hint: 'flex — xếp con theo một trục' },
  { value: 'grid', label: 'grid', hint: 'grid — xếp con theo lưới' },
  { value: 'none', label: 'none', hint: 'none — gỡ khỏi layout hoàn toàn' },
] as const;

const DISPLAY_MORE = [
  { value: 'inline-flex', label: 'inline-flex', hint: 'inline-flex' },
  { value: 'contents', label: 'contents', hint: 'contents — bỏ hộp, con lên cấp trên' },
] as const;

const FLEX_DIRECTION = [
  { value: 'row', label: 'row', icon: 'arrow-right', hint: 'row' },
  { value: 'column', label: 'column', icon: 'arrow-down', hint: 'column' },
  { value: 'row-reverse', label: 'row-reverse', icon: 'arrow-left', hint: 'row-reverse' },
  { value: 'column-reverse', label: 'column-reverse', icon: 'arrow-up', hint: 'column-reverse' },
] as const;

const ALIGN = [
  { value: 'start', label: 'start', icon: 'align-start', hint: 'flex-start' },
  { value: 'center', label: 'center', icon: 'align-center', hint: 'center' },
  { value: 'end', label: 'end', icon: 'align-end', hint: 'flex-end' },
  { value: 'stretch', label: 'stretch', icon: 'align-stretch', hint: 'stretch' },
  { value: 'baseline', label: 'baseline', icon: 'align-baseline', hint: 'baseline' },
] as const;

const JUSTIFY = [
  { value: 'start', label: 'start', icon: 'justify-start', hint: 'flex-start' },
  { value: 'center', label: 'center', icon: 'justify-center', hint: 'center' },
  { value: 'end', label: 'end', icon: 'justify-end', hint: 'flex-end' },
  { value: 'between', label: 'between', icon: 'justify-between', hint: 'space-between' },
  { value: 'around', label: 'around', icon: 'justify-around', hint: 'space-around' },
] as const;

const WRAP = [
  { value: 'true', label: 'wrap', hint: 'flex-wrap: wrap' },
  { value: 'false', label: 'nowrap', hint: 'flex-wrap: nowrap' },
] as const;

const TEXT_ALIGN = [
  { value: 'left', label: '⇤', hint: 'left' },
  { value: 'center', label: '↔', hint: 'center' },
  { value: 'right', label: '⇥', hint: 'right' },
] as const;

const WEIGHT = [
  { value: '400', label: '400', hint: '400 — regular' },
  { value: '500', label: '500', hint: '500 — medium' },
  { value: '700', label: '700', hint: '700 — bold' },
] as const;

const TEXT_TRANSFORM = [
  { value: 'none', label: 'Aa', hint: 'none' },
  { value: 'uppercase', label: 'AA', hint: 'uppercase' },
] as const;

const DECORATION = [
  { value: 'none', label: 'none', hint: 'text-decoration: none' },
  { value: 'underline', label: 'underline', hint: 'text-decoration: underline' },
] as const;

const POSITION = [
  { value: 'static', label: 'static' },
  { value: 'relative', label: 'relative' },
  { value: 'absolute', label: 'absolute' },
  { value: 'sticky', label: 'sticky' },
  { value: 'fixed', label: 'fixed' },
] as const;

const OVERFLOW = [
  { value: 'visible', label: 'visible' },
  { value: 'hidden', label: 'hidden' },
  { value: 'clip', label: 'clip' },
  { value: 'auto', label: 'auto' },
] as const;

const BORDER_STYLE = [
  { value: 'solid', label: 'solid', hint: 'border-style: solid' },
  { value: 'dashed', label: 'dashed', hint: 'border-style: dashed' },
] as const;

const CURSOR = [
  { value: 'auto', label: 'auto' },
  { value: 'pointer', label: 'pointer' },
  { value: 'none', label: 'none' },
  { value: 'not-allowed', label: 'not-allowed' },
] as const;

/** Bốn cạnh offset, theo thứ tự của `inset` trong CSS: trên, phải, dưới, trái. */
const OFFSETS = [
  ['top', 'trên'],
  ['right', 'phải'],
  ['bottom', 'dưới'],
  ['left', 'trái'],
] as const;

/** Chú thích nhỏ trong nhóm: chữ nhạt, mã CSS trong câu đậm lên bằng mono. */
const NOTE = cn(ui.hint, 'leading-snug [&_code]:font-shell-mono [&_code]:text-shell-ink');

/** Lời nhắc "vẫn chạy, nhưng có thứ bạn nên biết": nền `warn-soft`, chữ `warn`. */
const WARN_NOTE = 'bg-shell-warn-soft text-shell-warn rounded-sm px-2.5 py-1.5 text-mini leading-snug';

/** Ô đánh dấu trong panel editor: chữ `small`, không phải `ui` của dashboard. */
const CHECK = 'text-small';

/** `display` nào thì các ô flex/grid có tác dụng. */
const FLEX_LIKE = new Set(['flex', 'inline-flex']);
const GRID_LIKE = new Set(['grid']);

/**
 * Mọi tên property có thể che một ô inspector — gồm cả bí danh người ta hay gõ.
 *
 * Dựng một lần ở module: nó chỉ phụ thuộc bảng ánh xạ tĩnh, không phụ thuộc node.
 */
const SHADOWABLE: ReadonlySet<string> = new Set(
  Object.keys(STYLE_CSS_PROPERTY).flatMap((key) => {
    // Khoá có thể KHÔNG có dấu chấm — xem docblock của `STYLE_CSS_PROPERTY`.
    const [group, field] = key.split('.');
    return propertiesFor(group!, field);
  }),
);

/**
 * Từ khoá tìm được của mỗi nhóm, sinh từ bảng ánh xạ CSS.
 *
 * Không viết tay: một danh sách từ khoá viết tay sẽ thiếu đúng cái field vừa được
 * thêm, và không có gì báo. `searchKeysFor` gộp tên field, tên property phát ra và
 * tên vật lý tương đương — nên gõ `width`, `inline-size` hay `size.width` đều ra nhóm
 * Kích thước.
 *
 * Dựng một lần ở module: nó chỉ phụ thuộc bảng tĩnh.
 */
const KEYS = {
  // `container` đi cùng Bố cục: hai ô của nó xếp vào nhóm đó (xem `EXTRA_FIELDS`),
  // nên gõ `container-type` phải ra nhóm đó chứ không ra con số không.
  layout: searchKeysFor(['layout', 'container']),
  size: searchKeysFor(['size']),
  spacing: searchKeysFor(['spacing']),
  position: searchKeysFor(['position']),
  typography: searchKeysFor(['typography']),
  fill: searchKeysFor(['fill', 'border']),
  effects: searchKeysFor(['effects']),
} as const;

/** Bảng rỗng dùng chung — mặc định của `endpoints`, một object cho mọi lần render. */
const NO_ENDPOINTS: EndpointTable = {};

/** Cùng giới hạn với `setName` trong `schema.ts`. */
const NAME_MAX = 120;

/** Số thuộc tính đang có giá trị trong một nhóm — để biết nhóm nào đáng mở sẵn. */
function countIn(style: Partial<StyleProps>, group: keyof StyleProps): number {
  const values = style[group];
  if (!values) return 0;
  if (Array.isArray(values)) return 1;
  if (typeof values !== 'object') return 1;
  return Object.keys(values).length;
}

export function Inspector({
  doc,
  tokens,
  components,
  pageId,
  locales,
  translations,
  seo,
  endpoints = NO_ENDPOINTS,
  onEditComponent,
}: {
  doc: Doc;
  tokens: TokenOption[];
  components: ComponentTrees;
  /**
   * Trang đang mở. `null` khi đang sửa COMPONENT — lúc đó không có bảng Văn bản để
   * link tới, vì bảng đó theo từng trang.
   */
  pageId: string | null;
  /**
   * Ngôn ngữ đã bật của site. Rỗng ở chế độ sửa COMPONENT: component là cây dùng
   * chung, bản dịch thì theo TỪNG TRANG (`Translation.pageId`) — nên không có bản
   * dịch nào để phủ lên một component, và bày dải chọn ở đó là hứa một thứ không có.
   */
  locales: LocaleOption[];
  /**
   * Bản dịch NHÁP của trang, theo mã ngôn ngữ. Rỗng ở chế độ sửa component.
   *
   * Ở đây chứ không gọi API trong `ContentPanel`: cùng dữ liệu mà bảng Văn bản
   * đọc, và hai lượt đọc là hai bản có thể lệch nhau trong vài giây sau mỗi lần
   * lưu — đúng khoảng thời gian người ta nhìn vào nó.
   */
  translations: Record<string, DraftTranslation[]>;
  /** Metadata SEO của trang. `null` ở chế độ sửa component — không có trang nào. */
  seo: PageSeo | null;
  /**
   * Bảng `Site.globals.endpoint` (khoá → URL) — các lựa chọn của ô "Gửi tới" của Form
   * và "Nguồn số liệu" của NavChart. Truyền từ server như `components`: chọn một form
   * mà phải chờ một round-trip mới có danh sách là bảng thuộc tính nhấp nháy.
   */
  endpoints?: EndpointTable;
  /** Vắng mặt khi đang Ở TRONG chế độ sửa component — không lồng thêm một lớp nữa. */
  onEditComponent?: (componentId: string) => void;
}) {
  const selectedId = useEditor((s) => s.selectedId);

  const node = selectedId ? doc.nodes[selectedId] : null;

  return (
    // Không tự vẽ khung thẻ: khung (bo góc, bóng) là của `<aside>` chứa nó trong
    // `EditorShell` / `ComponentEditorShell`. Ở đây chỉ là nội dung lấp đầy khung đó.
    <div className="text-shell-ink flex h-full min-h-0 flex-col">
      {/* Đầu panel ở `InspectorHead.tsx`: node đang chọn, đường dẫn tổ tiên bấm được,
          và lớp đang ghi. Xem docblock ở đó cho lý do canvas ĐẶT khổ còn panel KHAI BÁO
          lớp — hai việc khác nhau, không phải hai nguồn sự thật. */}
      <InspectorHead doc={doc} node={node} locales={locales} />

      <LocaleNotice locales={locales} />

      {!node ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {seo ? (
            /*
              Không chọn node = đang nhìn CẢ TRANG, nên pane nói về trang: SEO và thẻ
              chia sẻ mở sẵn. Trước đây chỗ này chỉ có một dòng "Chưa chọn phần tử nào"
              và khối trang là một dòng gập ở đáy — chủ dự án không tìm ra nó.
            */
            <>
              <p className="flex items-start gap-2 border-b border-shell-line px-3.5 py-2.5 text-mini leading-snug text-shell-muted">
                <Icon name="info" size={15} className="mt-px shrink-0" />
                Chọn một phần tử ở cây bên trái, hoặc bấm vào bản xem trước, để sửa thuộc tính của nó.
              </p>
              <PageSeoPanel pageId={pageId} seo={seo} translations={translations} expanded />
            </>
          ) : (
            <div className="p-3.5">
              <EmptyState
                compact
                icon="layers"
                title="Chưa chọn phần tử nào"
                description="Chọn một phần tử ở cây bên trái, hoặc bấm thẳng vào bản xem trước."
                className="bg-shell-raised shadow-none"
              />
            </div>
          )}
        </div>
      ) : (
        // Instance có bảng riêng: cấu trúc và style thuộc về component, nên bày
        // các ô style ở đây rồi để chúng không có tác dụng là cách nhanh nhất
        // làm người dùng mất lòng tin vào cả bảng thuộc tính.
        node.type === 'Instance' ? (
          // Khối bọc là BLOCK, không phải flex: `InstancePanel` khai
          // `flex-1 overflow-y-auto` cho thân nó, và trong một block có chiều cao tự
          // động thì hai class đó vô hại — nếu bọc bằng flex thì pane có HAI vùng cuộn
          // lồng nhau, và người dùng phải đoán con lăn đang cuộn cái nào.
          <div key={node.id} className="relative min-h-0 flex-1 overflow-y-auto">
            {/* Tên đặt được cho cả Instance: "Thẻ tin · trang chủ" dễ tìm trong cây hơn
                ba dòng `Instance` giống hệt nhau. Tên là của chính node Instance, không
                phải của component nó trỏ tới, nên nó đứng ở đây chứ không trong
                `InstancePanel` (khối đó nói về nội dung lấy từ component). */}
            <div className="px-3.5 pt-3">
              <NameField node={node} />
            </div>
            {/* "Thẻ này lấy dữ liệu từ đâu" đứng TRƯỚC "ghi đè chữ của thẻ này": khi
                khối đang lặp, ghi đè là ngoại lệ còn ánh xạ mới là luật, và bắt người
                dùng cuộn qua 40 đơn vị chữ mới tới ô quyết định cả khu là đặt sai thứ
                tự ưu tiên. */}
            <RepeatPanel node={node} components={components} />
            <InstancePanel
              node={node}
              doc={doc}
              components={components}
              onEditComponent={onEditComponent}
            />
          </div>
        ) : (
          <NodeInspector
            key={node.id}
            node={node}
            tokens={tokens}
            doc={doc}
            components={components}
            pageId={pageId}
            translations={translations}
            endpoints={endpoints}
          />
        )
      )}

      {/*
        Khối "Trang" nằm ở ĐÁY và NGOÀI nhánh node: nó nói về TRANG, không về node
        đang chọn. Đặt trong nhánh node thì nó biến mất lúc bỏ chọn — và người dùng
        sẽ đọc nó như một thuộc tính của node rồi ngạc nhiên khi chọn node khác mà
        giá trị không đổi. Xem docblock của `PageSeoPanel`.
      */}
      {node && <PageSeoPanel pageId={pageId} seo={seo} translations={translations} />}
    </div>
  );
}

function NodeInspector({
  node,
  tokens,
  doc,
  components,
  pageId,
  translations,
  endpoints,
}: {
  node: Node;
  tokens: TokenOption[];
  /** Cần cho `ContentPanel`: đơn vị chữ tính từ CẢ cây, không chỉ từ node. */
  doc: Doc;
  components: ComponentTrees;
  pageId: string | null;
  translations: Record<string, DraftTranslation[]>;
  endpoints: EndpointTable;
}) {
  const breakpoint = useEditor((s) => s.breakpoint);
  const locale = useEditor((s) => s.locale);

  const effective = effectiveStyle(node, breakpoint);
  const own = ownLayer(node, breakpoint) ?? {};
  const common = { node, breakpoint, tokens };

  /*
   * Ô tìm thuộc tính.
   *
   * Bảy nhóm, 34 ô, và cái cần sửa thường nằm trong một nhóm đang gập. Không có ô tìm
   * thì cách duy nhất là mở lần lượt từng nhóm và đọc — bảy lần, mỗi lần một lượt cuộn.
   *
   * State cục bộ, KHÔNG lưu: từ khoá tìm là thao tác của một khoảnh khắc. Giữ lại nó
   * qua lần chọn node sau nghĩa là panel mở ra đã lọc sẵn mà người dùng không nhớ vì
   * sao — đúng loại "trạng thái ẩn" khó chịu nhất.
   */
  const [filter, setFilter] = useState('');

  /** Đơn vị cho ô offset đang trống — xem `UnitPicker`. */
  const [offsetUnit, setOffsetUnit] = useState('px');

  return (
    /*
     * Một cột, khoảng cách đều giữa các khối; mỗi khối tự lo lề ngang của nó.
     *
     * `relative` là bắt buộc: ô tìm có nhãn `sr-only` (`position: absolute`), và thiếu
     * khung định vị thì nhãn đó thoát khỏi vùng cuộn này. `[&>*]:shrink-0`: trong một
     * cột flex có cuộn, khối nào có `overflow` riêng sẽ bị bóp lại thay vì để cột cuộn.
     */
    <div className="relative flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pt-3 pb-4 [&>*]:shrink-0">
      <section className="grid grid-cols-3 gap-1.5 px-3.5">
        {/* Ô sửa được duy nhất của khối, nên nó đứng đầu và chiếm cả hàng; loại và id
            vẫn là hai ô chỉ đọc ngay dưới, như trước. */}
        <NameField node={node} className="col-span-3" />
        <Meta label="loại" value={node.type} />
        <Meta label="id" value={node.id} mono />
        {node.effects.length > 0 && (
          <Meta
            label="hiệu ứng"
            value={node.effects.map((e) => e.effect).join(', ')}
            mono
            wide
          />
        )}
      </section>

      {node.locked && (
        <section className="bg-shell-warn-soft mx-3.5 flex gap-2 rounded-md px-3 py-2">
          <Icon name="lock" size={15} className="text-shell-warn mt-0.5" />
          <div className="min-w-0">
            <p className="text-shell-warn text-small font-semibold">Node bị khoá — AI không sửa được.</p>
            <p className="text-shell-ink mt-0.5 text-mini">{node.locked.reason}</p>
          </div>
        </section>
      )}

      {/*
        Form / NavChart: "gửi tới đâu" đứng TRƯỚC cả khối Nội dung. Nó quyết định form
        có chạy hay không, còn Nội dung của một form là cả chục ô nhãn và thông báo —
        đặt sau đó là bắt người ta cuộn qua chúng mới thấy vì sao form đang tắt.

        ẨN ở chế độ bản dịch: nguồn dữ liệu dùng chung mọi ngôn ngữ (xem `LocaleNotice`),
        và một ô chọn ghi vào doc GỐC giữa lúc đang sửa bản tiếng Anh là đúng loại lỗi
        im lặng mà `selectStyleLocked` tồn tại để chặn.
      */}
      {node.type === 'Composite' && !locale && <EndpointPicker node={node} endpoints={endpoints} />}

      {/*
        Chữ đứng TRƯỚC mọi ô style — cùng lý lẽ với bộ chọn ảnh ngay dưới đây.

        Với một node Text, "chữ gì" là câu hỏi đầu tiên; `inline-size` và `border-radius`
        đến sau. Bắt nó cuộn xuống dưới bảy nhóm CSS là đặt sai thứ tự ưu tiên.
      */}
      <ContentPanel
        doc={doc}
        components={components}
        nodeId={node.id}
        pageId={pageId}
        translations={translations}
      />

      {/*
        Node ảnh: bộ chọn đứng NGAY dưới khối meta, trước mọi ô style.
        "Ảnh nào" là câu hỏi đầu tiên của một node ảnh; padding và bo góc đến sau.

        ẨN ở chế độ bản dịch, không chỉ khoá: `ContentPanel` ngay trên đã có một ô
        chọn ảnh cho đúng node này, và nó ghi vào BẢN DỊCH. Hai ô chọn ảnh cạnh nhau
        ghi vào hai chỗ khác nhau là thứ không ai đoán đúng được từ giao diện.
      */}
      {node.type === 'Image' && !locale && (
        <section className="px-0.5">
          <NodeAssetPicker
            nodeId={node.id}
            assetId={node.assetId}
            emptyNote="Node ảnh chưa gắn ảnh nào."
          />
        </section>
      )}

      {/*
        Node video: HAI trường, và trước hôm nay không có ô nào cả.

        `assetId` là nguồn phát, `posterAssetId` là ảnh hiện trước khi người dùng bấm
        play. Cả hai chỉ đặt được qua MCP, tức là một node dựng được trong UI mà không
        cấu hình được trong UI — xem docblock của `NodeAssetPicker`.

        Nguồn lọc theo `VIDEO_KINDS`, poster lọc theo ảnh: bày lẫn hai tập là mời người
        dùng đặt một file PDF làm nguồn video, và trình duyệt sẽ im lặng không phát gì.
      */}
      {/* Ẩn ở chế độ bản dịch — cùng lý do với node ảnh ngay trên. */}
      {node.type === 'Video' && !locale && (
        <section className="px-0.5">
          <NodeAssetPicker
            nodeId={node.id}
            assetId={node.assetId}
            label="video"
            kinds={VIDEO_KINDS}
            emptyNote="Node video chưa gắn nguồn nào — trên site nó sẽ là một khung rỗng."
          />
          <NodeAssetPicker
            nodeId={node.id}
            assetId={node.posterAssetId}
            field="posterAssetId"
            label="ảnh chờ"
          />
        </section>
      )}

      {breakpoint !== 'base' && Object.keys(own).length === 0 && (
        <p className="bg-shell-raised text-shell-muted mx-3.5 rounded-md px-3 py-2 text-mini leading-relaxed">
          Chưa có gì riêng ở <strong className="text-shell-ink font-semibold">{breakpointInfo(breakpoint).label}</strong>. Các ô dưới đây
          hiện giá trị đang kế thừa; sửa một ô sẽ tạo override chỉ cho màn này.
        </p>
      )}

      {/*
        Thứ tự nhóm theo Webflow và Framer: Bố cục → Kích thước → Khoảng cách →
        Vị trí → Chữ → Nền & viền → Hiệu ứng.

        Không phải quy ước cho có. Cả hai đặt bố cục trước vì nó quyết định mọi ô
        phía sau nghĩa là gì — `align` trên một node `display: block` không làm gì
        cả — và đặt trang trí (màu, viền, hiệu ứng) sau cùng vì đó là thứ sửa cuối.
        Thứ tự này cũng là thứ tự người ta dựng: đặt khung trước, tô sau.
      */}

      {/* Bản đồ lớp: node này còn đặt riêng gì ở những khổ đang KHÔNG xem. */}
      <LayerMap node={node} breakpoint={breakpoint} />

      <div className="px-3.5">
        <SearchField
          size="sm"
          label="Tìm thuộc tính"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Tìm thuộc tính… (width, gap, padding-top)"
          data-prop-search=""
        />
      </div>

      {/*
        Bảng đơn vị đứng MỘT LẦN ở đây, không nhắc lại ở từng ô.

        Mười đơn vị là quá nhiều để nhớ, mà nhắc ở 34 ô thì thành tiếng ồn — và tiếng
        ồn thì người ta học cách phớt lờ, kể cả khi nó đang nói thứ cần biết. Trường
        hợp riêng (`scale` không đơn vị, `rotate` tính bằng độ) nằm trong `title` của
        chính ô đó.

        `cqw/cqi/cqh` không phải để trang trí danh sách: hero, s2, s4 và footer đều là
        `container-type: inline-size`, và `tokens.css` giải thích vì sao chúng dùng cqw
        chứ không phải vw.
      */}
      <p className="text-shell-muted px-3.5 text-micro leading-relaxed [&_code]:font-shell-mono [&_code]:text-shell-ink">
        Đơn vị:{' '}
        <span className="font-shell-mono text-shell-ink">
          px rem % vw svh ch fr cqw cqi cqh
        </span>{' '}
        — kèm <code>clamp()</code> <code>min()</code> <code>max()</code>{' '}
        <code>calc()</code>. Gõ số trần thì ô giữ đơn vị đang có; ô trống mặc định{' '}
        <code>px</code>. Nhãn là tên property CSS thật sự phát ra — trỏ chuột để thấy
        tên vật lý tương đương.
      </p>

      <Section title="Bố cục" count={countIn(effective, 'layout')} filter={filter} keys={KEYS.layout}>
        <SegmentedControl
          {...common} group="layout" field="display" options={DISPLAY} more={DISPLAY_MORE}
        />

        {/*
          Ô flex/grid chỉ hiện khi chúng CÓ TÁC DỤNG.

          Bản trước luôn hiện `align`/`justify`, kể cả trên `display: block` — nơi
          chúng không sinh ra hiệu ứng nào. Người dùng đặt một giá trị, không thấy gì
          đổi, và kết luận là builder hỏng. Webflow ẩn đúng theo cách này.

          `display` chưa đặt thì coi như flex: node `Stack`/`Section` trong doc này
          mặc định đã là flex ở CSS nền, nên ẩn hết sẽ che mất ô đang có tác dụng.
        */}
        {(() => {
          const display = String(effective.layout?.display ?? 'flex');
          const isFlex = FLEX_LIKE.has(display) || display === 'flex';
          const isGrid = GRID_LIKE.has(display);
          if (!isFlex && !isGrid) {
            return (
              <p className={NOTE}>
                <code>{display}</code> không có trục con, nên gap / align / justify
                không áp dụng. Đổi sang <code>flex</code> hoặc <code>grid</code> để
                dùng chúng.
              </p>
            );
          }
          return (
            <>
              {isFlex && (
                <SegmentedControl
                  {...common} group="layout" field="flexDirection"
                  options={FLEX_DIRECTION}
                />
              )}
              <LenControl {...common} group="layout" field="gap" tokenCategory="space" />
              <SegmentedControl {...common} group="layout" field="align" options={ALIGN} />
              <SegmentedControl {...common} group="layout" field="justify" options={JUSTIFY} />
              {isFlex && (
                <SegmentedControl {...common} group="layout" field="wrap" options={WRAP} />
              )}
            </>
          );
        })()}
        <ExtraFields
          panelGroup="layout"
          node={node}
          breakpoint={breakpoint}
          tokens={tokens}
          effective={effective}
        />
      </Section>

      <Section title="Kích thước" count={countIn(effective, 'size')} filter={filter} keys={KEYS.size}>
        <LenControl
          {...common} group="size" field="width" tokenCategory="space"
          keywords={['auto', 'full']}
        />
        <LenControl
          {...common} group="size" field="height" tokenCategory="space"
          keywords={['auto', 'full', 'svh']}
        />
        <LenControl {...common} group="size" field="minWidth" tokenCategory="space" />
        <LenControl
          {...common} group="size" field="maxWidth" tokenCategory="space"
          keywords={['measure', 'container']}
        />
        <LenControl {...common} group="size" field="minHeight" tokenCategory="space" />
        <LenControl {...common} group="size" field="maxHeight" tokenCategory="space" />
        <ExtraFields
          panelGroup="size"
          node={node}
          breakpoint={breakpoint}
          tokens={tokens}
          effective={effective}
        />
      </Section>

      {/* Hộp box model chiếm cả chiều ngang — xem `BoxModel`. */}
      <Section title="Khoảng cách" count={countIn(effective, 'spacing')} filter={filter} keys={KEYS.spacing}>
        <BoxModel node={node} breakpoint={breakpoint} tokens={tokens} />
      </Section>

      {/*
        Vị trí là nhóm RIÊNG, không nhét vào "Hiệu ứng".

        Bản trước để `position.kind` và `z` chung với opacity/overflow. Cả Webflow lẫn
        Framer đều tách — và có lý do thực dụng: bốn ô offset chỉ có nghĩa khi `kind`
        khác `static`, nên chúng phải đứng cạnh cái quyết định điều đó.
      */}
      <Section title="Vị trí" count={countIn(effective, 'position')} filter={filter} keys={KEYS.position}>
        <SelectControl
          {...common} group="position" field="kind" options={POSITION}
        />
        <NumberControl {...common} group="position" field="z" step={1} />
        {String(effective.position?.kind ?? 'static') === 'static' ? (
          <p className={NOTE}>
            <code>static</code> bỏ qua top / right / bottom / left. Chọn
            <code> relative</code>, <code>absolute</code>, <code>sticky</code> hoặc
            <code> fixed</code> để đặt chúng.
          </p>
        ) : (
          <>
            {/* Bốn ô offset rộng 1/4 hàng, không nhét bộ chọn riêng vào được — một bộ
                chọn cho cả cụm, cùng cách hộp box model làm. */}
            <UnitPicker unit={offsetUnit} onChange={setOffsetUnit} scope="position" />
            {/* Chú thích dưới ô là chữ thường, không phải <label>: tên truy cập của ô vẫn
                là tên property CSS (`aria-label`), chú thích chỉ cho mắt biết ô nào là cạnh nào. */}
            <div className="grid grid-cols-4 gap-1.5">
              {OFFSETS.map(([side, caption]) => (
                <div key={side} className="flex min-w-0 flex-col items-center gap-0.5">
                  <LenControl compact {...common} group="position" field={side} unitHint={offsetUnit} />
                  <span aria-hidden className="text-shell-muted text-micro">{caption}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Chữ" count={countIn(effective, 'typography')} filter={filter} keys={KEYS.typography}>
        <ColorControl {...common} group="typography" field="color" />
        <LenControl
          {...common} group="typography" field="size"
          tokenCategory="typeScale"
        />
        <SegmentedControl {...common} group="typography" field="weight" options={WEIGHT} numeric />
        <NumberControl
          {...common} group="typography" field="leading"
          min={0.8} max={3} step={0.05}
        />
        <LenControl {...common} group="typography" field="tracking" tokenCategory="tracking" />
        <SegmentedControl
          {...common} group="typography" field="align" options={TEXT_ALIGN}
        />
        <SegmentedControl
          {...common} group="typography" field="transform" options={TEXT_TRANSFORM}
        />
        <SegmentedControl
          {...common} group="typography" field="decoration" options={DECORATION}
        />
        <ExtraFields
          panelGroup="typography"
          node={node}
          breakpoint={breakpoint}
          tokens={tokens}
          effective={effective}
        />
      </Section>

      <Section
        title="Nền & viền"
        count={countIn(effective, 'fill') + countIn(effective, 'border')}
        filter={filter}
        keys={KEYS.fill}
      >
        <ColorControl {...common} group="fill" field="color" />
        <LenControl
          {...common} group="border" field="radius" tokenCategory="radius"
        />
        <LenControl {...common} group="border" field="width" />
        <ColorControl {...common} group="border" field="color" />
        <SegmentedControl {...common} group="border" field="style" options={BORDER_STYLE} />
        <LayerVisibility node={node} breakpoint={breakpoint} effective={effective} />
        <ShadowControl node={node} breakpoint={breakpoint} tokens={tokens} effective={effective} />
      </Section>

      <Section title="Hiệu ứng" count={countIn(effective, 'effects')} filter={filter} keys={KEYS.effects}>
        <NumberControl
          {...common} group="effects" field="opacity"
          min={0} max={1} step={0.05}
        />
        <LenControl {...common} group="effects" field="blur" />
        <SelectControl
          {...common} group="effects" field="overflow" options={OVERFLOW}
        />
        <SelectControl {...common} group="effects" field="cursor" options={CURSOR} />
        <ExtraFields
          panelGroup="effects"
          node={node}
          breakpoint={breakpoint}
          tokens={tokens}
          effective={effective}
        />
      </Section>

      {/* Đọc GIÁ TRỊ CÓ HIỆU LỰC, không phải riêng lớp đang xem — khối class
          phải mô tả thứ node thật sự đang có ở khổ màn này. */}
      <TailwindPanel style={effective} />

      <CustomCssPanel nodeId={node.id} value={node.customCss ?? ''} />
    </div>
  );
}

/**
 * Một ô thông tin của node: nhãn nhạt ở trên, giá trị ở dưới — ô `shell-raised` lồng
 * trong panel, ba ô một hàng.
 *
 * `title` mang GIÁ TRỊ: `getByTitle('<id>')` là cách cả bộ e2e khẳng định node nào đang
 * chọn, nên id chỉ được xuất hiện trong `title` ở đúng chỗ này.
 */
function Meta({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** Chiếm cả hàng — cho giá trị dài như danh sách hiệu ứng. */
  wide?: boolean;
}) {
  return (
    <div className={cn('bg-shell-raised min-w-0 rounded-xs px-2 py-1.5', wide && 'col-span-3')}>
      <p className="text-shell-muted text-micro">{label}</p>
      <p
        className={cn('truncate text-mini font-semibold', mono && 'font-shell-mono')}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Tên node — sửa được, cho MỌI loại node.
 *
 * Tên chỉ sống trong builder (cây lớp, đầu panel — xem `labelOf`) và không ra HTML của
 * site. "Form đăng ký ở footer" tìm trong cây nhanh hơn nhiều so với cái `Composite` thứ
 * ba, nhưng trước đây ô này chỉ đọc và đặt tên chỉ làm được qua AI.
 *
 * Ghi khi rời ô hoặc Enter, Esc trả về — cùng nhịp với mọi ô gõ khác của Inspector: mỗi
 * lần ghi là một version, nên ghi theo từng phím là hai mươi version cho một cái tên.
 *
 * Không khoá ở chế độ bản dịch (`selectSaving`, không phải `selectStyleLocked`): tên
 * không có bản theo ngôn ngữ và không hiện trên trang nào, nên đổi nó lúc đang xem bản
 * tiếng Anh không làm lệch gì. `locked` cũng không chặn — nó chỉ chặn AI (`validate.ts`).
 *
 * Placeholder là nhãn TỰ ĐỘNG: xoá trắng ô là quay về đúng nhãn đó, và người dùng thấy
 * trước nó là gì.
 */
function NameField({ node, className }: { node: Node; className?: string }) {
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectSaving);

  const saved = node.name ?? '';
  const [draft, setDraft] = useState(saved);

  // Tên đổi từ chỗ khác (undo, AI) phải hiện ngay trong ô, không đợi chọn lại node.
  useEffect(() => setDraft(saved), [saved]);

  const commit = () => {
    const next = draft.trim().slice(0, NAME_MAX);
    if (next === saved) {
      // Chỉ khác ở khoảng trắng đầu/cuối: dọn ô, không ghi version nào.
      setDraft(saved);
      return;
    }
    void dispatch(
      [{ op: 'setName', nodeId: node.id, name: next || null }],
      { label: next ? `đổi tên: ${next}` : 'xoá tên' },
    );
  };

  return (
    <TextField
      size="sm"
      label="Tên"
      wrapperClassName={className}
      value={draft}
      maxLength={NAME_MAX}
      disabled={saving}
      placeholder={labelOf({ ...node, name: undefined })}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(saved);
      }}
      title="Chỉ hiện trong builder — cây lớp và đầu panel. Để trống thì dùng nhãn tự động."
      data-node-name=""
    />
  );
}

/**
 * Panel CSS. Gõ rồi bấm Áp dụng — không auto-save theo từng ký tự, vì mỗi lần
 * lưu tạo một PageVersion và gõ 40 ký tự sẽ tạo 40 version.
 *
 * Xem trước kết quả sanitize NGAY khi gõ. Không có nó, người dùng gõ
 * `position: fixed` rồi thấy trang ra `absolute` mà không hiểu vì sao — và sẽ
 * kết luận là builder hỏng, chứ không đoán ra là có một luật đang áp.
 */
function CustomCssPanel({ nodeId, value }: { nodeId: string; value: string }) {
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectStyleLocked);
  const target = useEditor((s) => s.target);
  const [draft, setDraft] = useState(value);

  const dirty = draft !== value;
  const scope = scopeForTarget(target, nodeId);
  // Cùng hàm chạy ở server lúc render, nên thứ hiện ở đây đúng bằng thứ sẽ ra.
  const { warnings } = sanitizeCustomCss(draft, nodeId, scope);

  /**
   * Thuộc tính có kiểu mà CSS này đang vô hiệu hoá.
   *
   * Từng ô bị đè đã có dấu ⚠ riêng, nhưng nếu ô đó nằm trong một nhóm đang gập
   * thì cảnh báo vô hình. Liệt kê ở ĐÂY — ngay cạnh nguyên nhân — thì luôn thấy
   * được, và người vừa gõ CSS biết ngay mình đã khoá mất ô nào.
   */
  const shadowing = [
    ...new Set(
      declaredProperties(draft, nodeId, scope)
        .filter((d) => d.always && SHADOWABLE.has(d.prop))
        .map((d) => d.prop),
    ),
  ].sort();

  const id = `css-${nodeId}`;

  return (
    <section className="border-shell-line mx-3.5 flex flex-col gap-2 border-t pt-3">
      <label htmlFor={id} className="text-small font-semibold">
        CSS tuỳ chỉnh
      </label>
      <textarea
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        placeholder={'opacity: .8;\n&:hover { opacity: 1 }'}
        className={cn(ui.fieldSm, 'font-shell-mono h-28 resize-y py-2 text-mini leading-relaxed')}
      />

      {shadowing.length > 0 && (
        <p className="bg-shell-warn-soft text-shell-warn flex gap-1.5 rounded-sm px-2 py-1.5 text-mini leading-snug">
          <Icon name="alert" size={14} className="mt-px" />
          <span>
            Đang vô hiệu hoá ô{' '}
            <span className="font-shell-mono">{shadowing.join(', ')}</span> phía trên — sửa
            những ô đó sẽ không thấy gì đổi.
          </span>
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="bg-shell-warn-soft space-y-0.5 rounded-sm px-2 py-1.5">
          {warnings.map((w) => (
            <li key={w} className="text-shell-warn text-mini leading-snug">{w}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          variant="primary"
          size="sm"
          disabled={!dirty || saving}
          onClick={() =>
            void dispatch(
              [{ op: 'setCustomCss', nodeId, css: draft.trim() ? draft : null }],
              { label: 'sửa CSS' },
            )
          }
        >
          Áp dụng
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(value)}>
            Huỷ
          </Button>
        )}
      </div>
      <p className={NOTE}>
        Tự động giới hạn trong phần tử này. Dùng <code>&amp;</code> để trỏ về chính nó
        (<code>&amp;:hover</code>). Luôn thắng thuộc tính bên trên.
      </p>
    </section>
  );
}

/* ── Lặp theo dữ liệu (màn 5) ─────────────────────────────────────────── */

/**
 * Loại nội dung, đúng phần mà bảng này cần. Đọc từ `/api/collections/types`, tức vỏ
 * mỏng của `getCollectionTypes()` — CÙNG hàm mà renderer đọc, nên danh sách field ở
 * đây không bao giờ lệch với danh sách field mà ánh xạ thực sự đọc được.
 */
interface TypeSummary {
  key: string;
  name: string;
  namePlural: string;
  titleField: string | null;
  schema: FieldDef[];
}

const REPEAT_SOURCES = [
  { value: 'query', label: 'Truy vấn một loại nội dung' },
  { value: 'related', label: 'Liên quan tới bài đang mở' },
  { value: 'taxonomy', label: 'Một khối mỗi danh mục' },
  { value: 'group-entries', label: 'Bài trong danh mục của khối cha' },
  { value: 'relation', label: 'Quan hệ của bài đang mở' },
  { value: 'field', label: 'Một field của bài đang mở (khối / nhóm lặp)' },
] as const;

/**
 * Nhãn cho mỗi cột sắp xếp được.
 *
 * Bảng NHÃN, không phải bảng cột: danh sách cột là `SORTABLE_COLUMNS` ở
 * `doc/types.ts`, và `satisfies` bên dưới bắt TypeScript báo nếu thêm một cột mà
 * quên nhãn. Không có ràng buộc đó thì cột mới im lặng vắng mặt khỏi ô chọn —
 * đúng thứ vừa xảy ra với `viewCount`, vốn đã có ở tầng truy vấn.
 */
/**
 * Dải báo "đang sửa bản dịch", kèm lý do các ô style xám đi.
 *
 * ## Vì sao phải NÓI RA, không chỉ khoá
 *
 * Một ô disabled mà không giải thích là một ô hỏng, dưới mắt người dùng. Họ sẽ
 * thử bấm, thử tải lại trang, rồi báo lỗi — hoặc tệ hơn, kết luận builder không
 * làm được việc đó và đi đường vòng.
 *
 * Câu ở đây trả lời đúng ba thứ họ đang hỏi: cái gì đang khoá (style và bố cục),
 * vì sao (dùng chung mọi ngôn ngữ), và làm sao để sửa (về bản gốc) — kèm một nút
 * làm ngay việc ấy, vì bắt họ đi tìm lại dải ngôn ngữ ở trên là bắt đọc rồi tự
 * dịch ra thao tác.
 */
function LocaleNotice({ locales }: { locales: LocaleOption[] }) {
  const locale = useEditor((s) => s.locale);
  const setLocale = useEditor((s) => s.setLocale);

  if (!locale) return null;
  const label = locales.find((l) => l.code === locale)?.label ?? locale;

  return (
    <div
      data-locale-notice=""
      className="bg-shell-accent-soft mx-3.5 mt-2.5 flex gap-2 rounded-md px-3 py-2"
    >
      <Icon name="globe" size={15} className="text-shell-accent mt-0.5" />
      <div className="min-w-0">
        <p className="text-shell-ink text-mini leading-snug">
          Đang sửa bản <span className="font-semibold">{label}</span>. Sửa được chữ, ảnh,
          video và đường dẫn — bố cục, style và nguồn dữ liệu dùng chung mọi ngôn ngữ.
        </p>
        <button
          type="button"
          onClick={() => setLocale(null)}
          className={cn(
            'text-shell-accent mt-1 inline-flex items-center gap-1 rounded-xs text-mini font-semibold underline-offset-2 hover:underline',
            focusRing,
          )}
        >
          Về bản gốc để sửa bố cục
          <Icon name="arrow-right" size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * Đổ bóng — ô chọn token.
 *
 * ## Vì sao một control RIÊNG thay vì `SelectControl`
 *
 * `shadow` là thuộc tính CẤP CAO NHẤT của `StyleProps`, không phải một field
 * trong một nhóm: giá trị của nó là `TokenRef | Shadow[]`. Mọi control dùng chung
 * đều ghi qua `useSetStyle(node, bp, group, field)`, tức `patch: { [group]: {
 * [field]: v } }` — với `shadow` thì đường ấy sinh ra `{ shadow: { undefined: … } }`.
 *
 * ## Vì sao chỉ chọn TOKEN, không dựng bóng bằng tay
 *
 * Schema nhận cả `Shadow[]` (x/y/blur/spread/color), nhưng một ô dựng bóng bằng
 * tay ở đây là mời mỗi trang có một cái bóng riêng — đúng thứ mà bộ token tồn tại
 * để tránh. Bóng thật trong bộ token còn NHIỀU LỚP (`mm-sim-menu-shadow` có hai),
 * nên một ô năm số cũng chỉ diễn đạt được một phần. Ai cần một bóng lạ thì thêm
 * token; cần nó ở đúng một chỗ thì vẫn còn `customCss`.
 *
 * ## Vì sao nó ở đây chứ không ở `controls.tsx`
 *
 * Đó là file của các control DÙNG CHUNG, và cả bốn thứ chúng chia sẻ (`Common`,
 * `fieldState`, `useSetStyle`, `useShadowedBy`) đều nhận `group` + `field`. Một
 * control không có `field` không dùng lại được gì trong số đó, nên đặt nó vào đấy
 * chỉ làm file kia có một ngoại lệ.
 */
function ShadowControl({
  node,
  breakpoint,
  tokens,
  effective,
}: {
  node: Node;
  breakpoint: Breakpoint;
  tokens: TokenOption[];
  effective: Partial<StyleProps>;
}) {
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectStyleLocked);

  const value = effective.shadow;
  const current = value && '$token' in value ? value.$token : '';
  // Bóng dựng tay (mảng nhiều lớp) không hiện được trong một `<select>`. Nói ra
  // thay vì hiện "—", vốn sẽ làm người dùng tưởng node chưa có bóng rồi chọn một
  // token và im lặng xoá mất thứ ai đó đã dựng.
  const custom = Array.isArray(value);

  const options = tokens.filter((t) => t.category === 'shadow');

  return (
    <div className="flex flex-col gap-1.5">
      <div className={ROW}>
        {/* Cùng khuôn cột nhãn với `Label` của controls: chấm trống giữ chữ thẳng mép. */}
        <label
          className="text-shell-muted flex h-control-sm min-w-0 items-center gap-1.5 text-mini"
          htmlFor={`${node.id}-shadow`}
        >
          <span aria-hidden className="size-1.5 shrink-0" />
          box-shadow
        </label>
        <SelectField
          size="sm"
          id={`${node.id}-shadow`}
          value={current}
          disabled={saving || custom}
          onChange={(e) =>
            void dispatch(
              [
                {
                  op: 'setStyle',
                  nodeId: node.id,
                  target: breakpoint,
                  // `null` = xoá khoá, về kế thừa — cùng quy ước với mọi ô khác.
                  patch: { shadow: e.target.value ? { $token: e.target.value } : null } as Partial<StyleProps>,
                },
              ],
              { label: `đổ bóng: ${e.target.value || '—'}` },
            )
          }
        >
          <option value="">—</option>
          {options.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </SelectField>
      </div>
      {custom && (
        <div className="grid gap-1.5">
          <p className={NOTE}>
            Bóng dựng tay ({value.length} lớp) — sửa giá trị bằng op hoặc customCss; ẩn tạm từng
            lớp ở đây.
          </p>
          <ul className="grid gap-1">
            {value.map((layer, i) => (
              <li
                key={i}
                data-shadow-layer={i}
                className="bg-shell-raised flex min-w-0 items-center gap-2 rounded-sm py-0.5 pr-0.5 pl-2"
              >
                <span
                  className={cn(
                    'font-shell-mono min-w-0 flex-1 truncate text-micro',
                    layer.hidden && 'text-shell-muted line-through',
                  )}
                  title={shadowSummary(layer)}
                >
                  {shadowSummary(layer)}
                </span>
                <HideToggle
                  hidden={!!layer.hidden}
                  label={`lớp bóng ${i + 1}`}
                  disabled={saving}
                  onToggle={() => {
                    const next = value.map((l, j) => (j === i ? withHidden(l, !l.hidden) : l));
                    void dispatch(
                      [{ op: 'setStyle', nodeId: node.id, target: breakpoint, patch: { shadow: next } as Partial<StyleProps> }],
                      { label: `${layer.hidden ? 'hiện' : 'ẩn'} lớp bóng ${i + 1}` },
                    );
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {!custom && options.length === 0 && (
        <p className={NOTE}>
          Bộ token chưa có token nào hạng <code>shadow</code>.
        </p>
      )}
    </div>
  );
}

type ShadowLayer = Exclude<NonNullable<StyleProps['shadow']>, { $token: string }>[number];

function shadowSummary(l: ShadowLayer): string {
  const parts = [l.x, l.y, l.blur, l.spread].map((v) => formatLen(v) || '0');
  return `${l.inset ? 'inset ' : ''}${parts.join(' ')} ${formatColor(l.color)}`;
}

/**
 * Đặt hoặc GỠ cờ `hidden`. Gỡ là xoá khoá, không ghi `false` — schema chỉ nhận `true`,
 * để "đang hiện" chỉ có một cách viết và bật lại ra đúng bytes như trước khi ẩn.
 */
function withHidden<T extends { hidden?: true }>(value: T, hidden: boolean): T {
  const { hidden: _drop, ...rest } = value;
  return (hidden ? { ...rest, hidden: true } : rest) as T;
}

/**
 * Nút ẩn tạm một lớp style (D4). Ẩn KHÔNG xoá giá trị: bộ sinh CSS chỉ bỏ qua nó, nên
 * bật lại là đúng như cũ. Mỗi lần bấm là một op `setStyle`, tức một version trong lịch sử.
 */
function HideToggle({
  hidden,
  label,
  disabled,
  onToggle,
}: {
  hidden: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={hidden}
      aria-label={hidden ? `Hiện lại ${label}` : `Ẩn tạm ${label}`}
      data-style-hidden={hidden ? 'true' : 'false'}
      disabled={disabled}
      onClick={onToggle}
      title={hidden ? `Hiện lại ${label}` : `Ẩn tạm ${label} — giá trị vẫn giữ, bật lại là như cũ`}
      className={cn(
        'inline-flex h-control-sm shrink-0 items-center gap-1 rounded-sm px-2 text-micro font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        hidden
          ? 'bg-shell-warn-soft text-shell-warn'
          : 'text-shell-muted ring-shell-line hover:bg-shell-raised hover:text-shell-ink ring-1 ring-inset',
        focusRing,
      )}
    >
      <Icon name={hidden ? 'eye-off' : 'eye'} size={13} />
      {hidden ? 'đang ẩn' : 'ẩn'}
    </button>
  );
}

/**
 * Ẩn tạm nét viền, gradient, ảnh nền của node (D4). Chỉ hiện hàng cho thứ node đang
 * có ở breakpoint này — không có viền thì không có gì để ẩn.
 *
 * Gradient và ảnh nền chưa có ô sửa trong inspector (đặt bằng op hoặc AI), nên đây là
 * chỗ duy nhất trong giao diện thấy được chúng đang bật.
 */
function LayerVisibility({
  node,
  breakpoint,
  effective,
}: {
  node: Node;
  breakpoint: Breakpoint;
  effective: Partial<StyleProps>;
}) {
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectStyleLocked);

  const border = effective.border;
  const hasStroke = !!(border && (border.width || border.style || border.color));
  const gradient = effective.fill?.gradient;
  const image = effective.fill?.image;
  if (!hasStroke && !gradient && !image) return null;

  const write = (patch: Partial<StyleProps>, label: string) =>
    void dispatch([{ op: 'setStyle', nodeId: node.id, target: breakpoint, patch }], { label });

  return (
    <div className="flex flex-col gap-1.5" data-layer-visibility="">
      {hasStroke && (
        <Row label="nét viền" hidden={!!border?.hidden}>
          <HideToggle
            hidden={!!border?.hidden}
            label="nét viền"
            disabled={saving}
            onToggle={() =>
              write(
                // `null` = gỡ khoá ở breakpoint này, cùng quy ước với mọi ô khác.
                { border: { hidden: border?.hidden ? null : true } } as unknown as Partial<StyleProps>,
                border?.hidden ? 'hiện nét viền' : 'ẩn nét viền',
              )
            }
          />
        </Row>
      )}
      {gradient && (
        <Row label="gradient nền" hidden={!!gradient.hidden}>
          <HideToggle
            hidden={!!gradient.hidden}
            label="gradient nền"
            disabled={saving}
            onToggle={() =>
              write(
                { fill: { gradient: withHidden(gradient, !gradient.hidden) } },
                gradient.hidden ? 'hiện gradient nền' : 'ẩn gradient nền',
              )
            }
          />
        </Row>
      )}
      {image && (
        <Row label="ảnh nền" hidden={!!image.hidden}>
          <HideToggle
            hidden={!!image.hidden}
            label="ảnh nền"
            disabled={saving}
            onToggle={() =>
              write(
                { fill: { image: withHidden(image, !image.hidden) } },
                image.hidden ? 'hiện ảnh nền' : 'ẩn ảnh nền',
              )
            }
          />
        </Row>
      )}
    </div>
  );
}

/** Một hàng của `LayerVisibility`: cùng khuôn `ROW` với mọi ô trong nhóm. */
function Row({ label, hidden, children }: { label: string; hidden: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(ROW, 'items-center')}>
      <span className={cn('text-shell-muted min-w-0 truncate pl-3 text-mini', hidden && 'line-through')}>
        {label}
      </span>
      <div className="flex">{children}</div>
    </div>
  );
}

const SORT_FIELDS = [
  { value: 'publishedAt', label: 'Đăng lúc' },
  { value: 'updatedAt', label: 'Cập nhật' },
  { value: 'createdAt', label: 'Tạo lúc' },
  { value: 'slug', label: 'Đường dẫn (A→Z)' },
  { value: 'viewCount', label: 'Lượt xem' },
] as const satisfies readonly { value: (typeof SORTABLE_COLUMNS)[number]; label: string }[];

/** Vai mà một node trong cây component có thể nhận nội dung. */
const ROLE_OF: Partial<Record<Node['type'], keyof ContentOverride>> = {
  Text: 'content',
  Button: 'label',
  Image: 'assetId',
};

const ROLE_LABEL: Record<string, string> = {
  content: 'Text',
  label: 'Nút · chữ',
  assetId: 'Ảnh',
  href: 'Nút · đường dẫn',
  alt: 'Chữ thay ảnh',
  a11yLabel: 'Nhãn a11y',
};

/** Ô nhận nội dung trong cây component: node + vai. Một node có thể có hai ô (nút). */
interface Slot {
  localId: string;
  as: keyof ContentOverride;
  nodeType: Node['type'];
}

function slotsOf(tree: { rootId: string; nodes: Record<string, Node> } | undefined): Slot[] {
  if (!tree) return [];
  const out: Slot[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = tree.nodes[id];
    if (!n) return;
    const role = ROLE_OF[n.type];
    if (role) {
      out.push({ localId: n.id, as: role, nodeType: n.type });
      // Nút có HAI ô: chữ và đường dẫn. Không bày ô thứ hai thì cách duy nhất để thẻ
      // tin bấm ra được bài là sửa tay JSON — tức tính năng coi như không có.
      if (n.type === 'Button') out.push({ localId: n.id, as: 'href', nodeType: n.type });
    }
    for (const c of n.children) walk(c);
  };
  walk(tree.rootId);
  return out;
}

/** Khoá ổn định cho một ô: `localId` một mình không đủ vì nút có hai ô. */
const slotKey = (s: Slot) => `${s.localId}:${s.as}`;

/**
 * Field ánh xạ được, kèm KHOÁ ẢO — thứ nằm ngoài `data` nhưng vẫn đọc được.
 *
 * Ba kiểu field bị loại, mỗi kiểu một lý do khác nhau:
 *
 *  - `taxonomy` — liên kết sống ở bảng `EntryTaxonomy`, không có gì trong `data`.
 *    Nó không mất đi: hai khoá ảo `taxonomy`/`taxonomies` bên dưới THAY nó, và
 *    chúng đọc đúng thứ người dựng muốn (tên danh mục).
 *  - `json` — không có hình dạng để ánh xạ.
 *
 * `relation` thì CÓ trong danh sách: từ khi `relation-expand.ts` nở bản ghi đích
 * thành `{ title, href, assetId }`, ánh xạ nó cho ra tên chuyên đề chứ không phải
 * một cuid. Ánh xạ vào `content` ra tiêu đề, vào `href` ra đường dẫn trang chi
 * tiết của bản ghi đích, vào `assetId` ra ảnh của nó.
 *
 * Danh sách khoá ảo lấy thẳng từ `VIRTUAL_KEYS` chứ không chép tay: ô chọn này và
 * luật `repeat_map_key` ở đường ghi phải nói cùng một danh sách, và trước đây
 * chúng đã trôi khỏi nhau — `published_at` có ở cả hai, `taxonomy` không có ở đâu
 * cả, và hậu quả là một trang đã publish với huy hiệu danh mục trống.
 */
function mappableFields(type: TypeSummary | undefined): { key: string; label: string }[] {
  if (!type) return [];
  const fromSchema = type.schema
    .filter((f) => f.t !== 'taxonomy' && f.t !== 'json')
    .map((f) => ({ key: f.key, label: `${f.label} · ${f.t}` }));
  return [
    ...fromSchema,
    ...Object.entries(VIRTUAL_KEYS).map(([key, v]) => ({ key, label: `${v.label} · của hệ thống` })),
  ];
}

const SPEC_DEFAULT: RepeatSpec = {
  source: { kind: 'query', query: { typeKey: '', limit: 10 } },
  map: {},
};

/**
 * Khối "Lặp theo" — biến một `Instance` thành N thẻ.
 *
 * ## Vì sao nó nằm trong `Inspector.tsx` chứ không phải một file riêng
 *
 * `InstancePanel` là bảng của node Instance, nhưng nó chỉ nói về GHI ĐÈ nội dung của
 * MỘT thẻ. Lặp là một câu hỏi khác hẳn ("thẻ này lấy dữ liệu từ đâu"), và nó phải
 * đứng cạnh chứ không lồng vào — trộn vào là bắt người dùng cuộn qua 40 đơn vị chữ
 * mới thấy ô quyết định cả khu.
 *
 * ## Ghi bằng `setProps`, không phải một op mới
 *
 * `repeat` không nằm trong danh sách khoá bị `setProps` chặn (xem `applyOne` case
 * `'setProps'`), nên op đã có sẵn làm được việc — và nghịch đảo của nó
 * (`setProps` với giá trị cũ) là thứ `invert` đã sinh ra, nên undo chạy không cần
 * dòng code nào. Thêm một op `setRepeat` là thêm một nhánh vào ops/schema/invert cho
 * đúng khả năng đã có.
 *
 * Hình dạng của `repeat` được kiểm ở tầng 2 của `validateOps` (`repeat_shape` và ba
 * luật cây) — nên một cấu hình sai bị từ chối ở đường ghi, không phải hiện thành khu
 * trống lúc render.
 */
function RepeatPanel({
  node,
  components,
}: {
  node: Extract<Node, { type: 'Instance' }>;
  components: ComponentTrees;
}) {
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectStyleLocked);

  const [types, setTypes] = useState<TypeSummary[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/collections/types')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { types?: TypeSummary[] }) => {
        if (alive) setTypes(d.types ?? []);
      })
      .catch(() => {
        if (alive) setTypesError('Không đọc được danh sách loại nội dung.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const spec = node.repeat;
  const tree = components.get(node.componentId);
  const slots = useMemo(() => slotsOf(tree), [tree]);

  const typeKey =
    spec?.source.kind === 'query' ? spec.source.query.typeKey
    : spec?.source.kind === 'related' || spec?.source.kind === 'taxonomy' ? spec.source.typeKey
    : '';
  const type = types?.find((t) => t.key === typeKey);
  const fields = mappableFields(type);

  const write = async (next: RepeatSpec | null, label: string) => {
    await dispatch([{ op: 'setProps', nodeId: node.id, props: { repeat: next } }], { label });
  };

  const patch = (fn: (s: RepeatSpec) => RepeatSpec, label: string) => {
    if (!spec) return;
    void write(fn(structuredClone(spec)), label);
  };

  /** Node nào đã có ánh xạ trỏ tới — dùng cho cả ô chọn lẫn cảnh báo. */
  const fieldForSlot = (s: Slot): string =>
    Object.entries(spec?.map ?? {}).find(
      ([, t]) => t.nodeId === s.localId && t.as === s.as,
    )?.[0] ?? '';

  const unmapped = slots.filter((s) => !fieldForSlot(s));

  return (
    <section className="border-shell-line mx-3.5 flex flex-col gap-2.5 border-b pt-3 pb-3.5">
      <div className="flex items-center gap-2">
        <h3 className="text-small font-semibold">Lặp theo</h3>
        <div className={cn(SEG.group, 'ml-auto')} role="group" aria-label="Lặp theo dữ liệu">
          <button
            type="button"
            disabled={saving}
            aria-pressed={!spec}
            onClick={() => void write(null, 'tắt lặp theo dữ liệu')}
            className={cn(SEG.item, 'flex-none px-2.5', !spec && SEG.on)}
          >
            Tắt
          </button>
          <button
            type="button"
            disabled={saving}
            aria-pressed={!!spec}
            onClick={() => void write(spec ?? SPEC_DEFAULT, 'bật lặp theo dữ liệu')}
            className={cn(SEG.item, 'flex-none px-2.5', spec && SEG.on)}
          >
            Bật
          </button>
        </div>
      </div>

      {node.effects.length > 0 && spec && (
        // Validator từ chối op này (`repeat_effect`), nên người dùng sẽ thấy một lỗi
        // lúc lưu. Nói TRƯỚC thì họ biết phải gỡ gì, thay vì đọc một câu từ chối.
        <p className={WARN_NOTE}>
          Node này có effect. Instance lặp không được gắn effect — runtime chỉ gắn được
          vào một phần tử, nên chỉ thẻ đầu tiên có hiệu ứng. Đặt effect lên node cha.
        </p>
      )}

      {!spec ? (
        <p className={NOTE}>
          Đang render một lần. Bật để thẻ này render một lần cho mỗi bài — khoảng cách và
          số cột vẫn do node cha lo.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {typesError && <p className={ui.error}>{typesError}</p>}

          <SelectField
            size="sm"
            label="Nguồn"
            value={spec.source.kind}
            disabled={saving}
            onChange={(e) => {
              const kind = e.target.value as RepeatSpec['source']['kind'];
              patch((s) => {
                // Đổi nguồn là đổi HÌNH DẠNG của `source`, không phải đổi một field:
                // giữ lại field của nguồn cũ sẽ tạo một object vừa có `query` vừa có
                // `limit`, và `zRepeatSpec` là `.strict()` nên nó bị từ chối sạch.
                s.source =
                  kind === 'query' ? { kind, query: { typeKey, limit: 10 } }
                  : kind === 'related' ? { kind, typeKey, limit: 3 }
                  : kind === 'taxonomy' ? { kind, typeKey }
                  : kind === 'group-entries' ? { kind, limit: 5 }
                  : kind === 'relation' ? { kind, path: '', limit: 6 }
                  : { kind: 'field', path: '' };
                return s;
              }, 'đổi nguồn lặp');
            }}
          >
            {REPEAT_SOURCES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>

          {(spec.source.kind === 'query' ||
            spec.source.kind === 'related' ||
            spec.source.kind === 'taxonomy') && (
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                size="sm"
                label="Loại"
                value={typeKey}
                disabled={saving || !types}
                onChange={(e) => {
                  const key = e.target.value;
                  patch((s) => {
                    if (s.source.kind === 'query') s.source.query.typeKey = key;
                    else if (s.source.kind === 'related' || s.source.kind === 'taxonomy') {
                      s.source.typeKey = key;
                    }
                    // Ánh xạ trỏ vào field của loại CŨ. Giữ lại là để một bảng ánh xạ
                    // trông đầy đủ mà không field nào tồn tại — thẻ hiện chữ gốc của
                    // component ở cả mười ô, và không có gì chỉ ra vì sao.
                    s.map = {};
                    return s;
                  }, 'đổi loại nội dung của khối lặp');
                }}
              >
                <option value="">— chọn loại —</option>
                {(types ?? []).map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.namePlural || t.name}
                  </option>
                ))}
              </SelectField>

              {spec.source.kind !== 'taxonomy' && (
                <TextField
                  size="sm"
                  label="Số lượng"
                  type="number"
                  min={1}
                  max={100}
                  value={
                    spec.source.kind === 'query' ? spec.source.query.limit : spec.source.limit
                  }
                  disabled={saving}
                  onChange={(e) => {
                    // Kẹp Ở ĐÂY, không chỉ ở zod: ô số cho gõ 4000, và một op bị từ
                    // chối sau ba giây gõ là phản hồi tệ nhất của một ô nhập.
                    const n = Math.min(100, Math.max(1, Number(e.target.value) || 1));
                    patch((s) => {
                      if (s.source.kind === 'query') s.source.query.limit = n;
                      else if (s.source.kind === 'related') s.source.limit = n;
                      return s;
                    }, 'đổi số lượng của khối lặp');
                  }}
                />
              )}
            </div>
          )}

          {/* ── Dải danh mục: lọc và thứ tự ───────────────────────────── */}
          {spec.source.kind === 'taxonomy' && (
            <div className="flex flex-col gap-1.5">
              <Checkbox
                label="Chỉ danh mục đang hiện"
                wrapperClassName={CHECK}
                checked={spec.source.filter?.published === true}
                disabled={saving}
                onChange={(e) => {
                  const on = e.target.checked;
                  patch((s) => {
                    if (s.source.kind !== 'taxonomy') return s;
                    // Xoá HẲN khoá khi tắt, không đặt `false`: `filter: {}` và
                    // `filter: { published: false }` cùng nghĩa "không lọc", và hai
                    // hình dạng cho một nghĩa là hai thứ phải so sánh về sau.
                    const f = { ...s.source.filter };
                    if (on) f.published = true;
                    else delete f.published;
                    s.source.filter = Object.keys(f).length ? f : undefined;
                    return s;
                  }, 'đổi bộ lọc danh mục');
                }}
              />

              <Checkbox
                label="Bỏ danh mục chưa có bài"
                wrapperClassName={CHECK}
                checked={(spec.source.filter?.minEntries ?? 0) > 0}
                disabled={saving}
                onChange={(e) => {
                  const on = e.target.checked;
                  patch((s) => {
                    if (s.source.kind !== 'taxonomy') return s;
                    const f = { ...s.source.filter };
                    if (on) f.minEntries = 1;
                    else delete f.minEntries;
                    s.source.filter = Object.keys(f).length ? f : undefined;
                    return s;
                  }, 'đổi bộ lọc danh mục');
                }}
              />

              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  size="sm"
                  label="Thứ tự"
                  value={spec.source.sort?.field ?? 'order'}
                  disabled={saving}
                  onChange={(e) => {
                    const field = e.target.value as 'order' | 'name' | 'count';
                    patch((s) => {
                      if (s.source.kind !== 'taxonomy') return s;
                      s.source.sort = { field, dir: s.source.sort?.dir ?? 'asc' };
                      return s;
                    }, 'đổi thứ tự dải danh mục');
                  }}
                >
                  <option value="order">Tự sắp (kéo tay)</option>
                  <option value="name">Tên (A→Z)</option>
                  <option value="count">Số bài</option>
                </SelectField>
                <SelectField
                  size="sm"
                  label="Chiều"
                  value={spec.source.sort?.dir ?? 'asc'}
                  disabled={saving}
                  onChange={(e) => {
                    const dir = e.target.value === 'desc' ? 'desc' : 'asc';
                    patch((s) => {
                      if (s.source.kind !== 'taxonomy') return s;
                      s.source.sort = { field: s.source.sort?.field ?? 'order', dir };
                      return s;
                    }, 'đổi chiều dải danh mục');
                  }}
                >
                  <option value="asc">Tăng dần</option>
                  <option value="desc">Giảm dần</option>
                </SelectField>
              </div>
            </div>
          )}

          {spec.source.kind === 'group-entries' && (
            <TextField
              size="sm"
              label="Số bài mỗi danh mục"
              type="number"
              min={1}
              max={100}
              value={spec.source.limit}
              disabled={saving}
              onChange={(e) => {
                const n = Math.min(100, Math.max(1, Number(e.target.value) || 1));
                patch((s) => {
                  if (s.source.kind === 'group-entries') s.source.limit = n;
                  return s;
                }, 'đổi số bài mỗi danh mục');
              }}
            />
          )}

          {spec.source.kind === 'field' && (
            <TextField
              size="sm"
              label="Field khối / nhóm lặp"
              value={spec.source.path}
              disabled={saving}
              onChange={(e) => {
                const path = e.target.value;
                patch((s) => {
                  if (s.source.kind === 'field') s.source.path = path;
                  return s;
                }, 'đổi field của khối lặp');
              }}
            />
          )}

          {spec.source.kind === 'relation' && (
            <div className="grid grid-cols-2 gap-2">
              <TextField
                size="sm"
                label="Field quan hệ"
                value={spec.source.path}
                disabled={saving}
                onChange={(e) => {
                  const path = e.target.value;
                  patch((s) => {
                    if (s.source.kind === 'relation') s.source.path = path;
                    return s;
                  }, 'đổi field quan hệ của khối lặp');
                }}
              />
              <TextField
                size="sm"
                label="Số lượng"
                type="number"
                min={1}
                max={100}
                value={spec.source.limit}
                disabled={saving}
                onChange={(e) => {
                  const n = Math.min(100, Math.max(1, Number(e.target.value) || 1));
                  patch((s) => {
                    if (s.source.kind === 'relation') s.source.limit = n;
                    return s;
                  }, 'đổi số lượng của khối lặp');
                }}
              />
            </div>
          )}

          {spec.source.kind === 'query' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  size="sm"
                  label="Sắp xếp"
                  value={spec.source.query.sort?.[0]?.field ?? 'publishedAt'}
                  disabled={saving}
                  onChange={(e) => {
                    const field = e.target.value as (typeof SORT_FIELDS)[number]['value'];
                    patch((s) => {
                      if (s.source.kind !== 'query') return s;
                      const dir = s.source.query.sort?.[0]?.dir ?? 'desc';
                      s.source.query.sort = [{ field, dir }];
                      return s;
                    }, 'đổi sắp xếp của khối lặp');
                  }}
                >
                  {SORT_FIELDS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  size="sm"
                  label="Chiều"
                  value={spec.source.query.sort?.[0]?.dir ?? 'desc'}
                  disabled={saving}
                  onChange={(e) => {
                    const dir = e.target.value === 'asc' ? 'asc' : 'desc';
                    patch((s) => {
                      if (s.source.kind !== 'query') return s;
                      const field = s.source.query.sort?.[0]?.field ?? 'publishedAt';
                      s.source.query.sort = [{ field, dir }];
                      return s;
                    }, 'đổi chiều sắp xếp');
                  }}
                >
                  <option value="desc">mới nhất trước</option>
                  <option value="asc">cũ nhất trước</option>
                </SelectField>
              </div>

              {/*
                Hai điều kiện lọc không cần dữ liệu ngoài. Chọn từ danh sách ĐÓNG chứ
                không phải ô gõ tự do — cùng lý do `calc()` trong style là cây toán tử
                chứ không phải chuỗi: một chuỗi filter tự do đi từ builder xuống Prisma
                là một đường injection, và AI qua MCP sẽ là thứ đầu tiên đi qua nó.

                Lọc theo danh mục CỐ ĐỊNH chưa có ở đây: nó cần danh sách danh mục của
                loại, và endpoint đọc danh sách đó chưa tồn tại. Ghi ra thay vì bày một
                ô rỗng — một ô không chọn được gì trông y như một ô hỏng.
              */}
              <fieldset className="flex flex-col gap-0.5">
                <legend className={cn(ui.label, 'mb-1')}>Lọc</legend>
                {(
                  [
                    { k: 'excludeCurrent', label: 'Bỏ bài đang mở khỏi danh sách' },
                    { k: 'taxonomy', label: 'Chỉ bài cùng danh mục với bài đang mở' },
                  ] as const
                ).map((opt) => {
                  const on = (spec.source.kind === 'query' ? spec.source.query.filter : [])?.some(
                    (f) =>
                      f.k === opt.k && (f.k !== 'taxonomy' || f.from === 'current-entry'),
                  );
                  return (
                    <Checkbox
                      key={opt.k}
                      label={opt.label}
                      wrapperClassName={CHECK}
                      checked={Boolean(on)}
                      disabled={saving}
                      onChange={() => {
                        patch((s) => {
                          if (s.source.kind !== 'query') return s;
                          const cur = s.source.query.filter ?? [];
                          const without = cur.filter(
                            (f) =>
                              !(
                                f.k === opt.k &&
                                (f.k !== 'taxonomy' || f.from === 'current-entry')
                              ),
                          );
                          s.source.query.filter = on
                            ? without
                            : [
                                ...without,
                                opt.k === 'excludeCurrent'
                                  ? { k: 'excludeCurrent' }
                                  : { k: 'taxonomy', from: 'current-entry' },
                              ];
                          if (s.source.query.filter.length === 0) delete s.source.query.filter;
                          return s;
                        }, 'đổi điều kiện lọc');
                      }}
                    />
                  );
                })}
              </fieldset>
            </>
          )}

          {/* ── Ánh xạ ────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <p className={ui.label}>Ánh xạ field → node trong thẻ</p>
            {slots.length === 0 ? (
              <p className={NOTE}>
                Component này không có node nhận nội dung nào (Text / Nút / Ảnh).
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {slots.map((s) => (
                  <div key={slotKey(s)} className="flex items-center gap-1.5">
                    <SelectField
                      size="sm"
                      wrapperClassName="min-w-0 flex-1"
                      aria-label={`Field cho ${s.localId} · ${ROLE_LABEL[s.as] ?? s.as}`}
                      value={fieldForSlot(s)}
                      disabled={saving || !type}
                      onChange={(e) => {
                        const key = e.target.value;
                        patch((next) => {
                          // Gỡ mọi ánh xạ đang trỏ vào ô này TRƯỚC: `map` khoá theo
                          // FIELD, nên hai field trỏ cùng một ô là hợp lệ về hình dạng
                          // nhưng vô nghĩa — cái sau sẽ thắng lúc render và cái trước
                          // biến mất mà không ai biết.
                          for (const [f, t] of Object.entries(next.map)) {
                            if (t.nodeId === s.localId && t.as === s.as) delete next.map[f];
                          }
                          if (key) next.map[key] = { nodeId: s.localId, as: s.as };
                          return next;
                        }, 'đổi ánh xạ của khối lặp');
                      }}
                    >
                      <option value="">— chưa chọn —</option>
                      {fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </SelectField>
                    <Icon name="arrow-right" size={13} className="text-shell-muted" />
                    <span
                      className="font-shell-mono w-28 shrink-0 truncate text-mini"
                      title={`${s.localId} · ${ROLE_LABEL[s.as] ?? s.as}`}
                    >
                      {s.localId}
                      <span className="text-shell-muted"> · {ROLE_LABEL[s.as] ?? s.as}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!type && (
              <p className={NOTE}>
                {spec.source.kind === 'field'
                  ? 'Nguồn "một field của bài đang mở" chưa có danh sách field ở đây — field của khối đến từ nhóm field của khối đó, không từ một loại nội dung. Ánh xạ cho nguồn này còn phải sửa tay.'
                  : 'Chọn loại nội dung ở trên để có danh sách field.'}
              </p>
            )}

            {unmapped.length > 0 && (
              /*
                Đây là cách hỏng KHÓ TÌM NHẤT của cả tính năng, nên nó được nói ra ngay
                tại chỗ dựng chứ không đợi người dùng nhìn trang thật rồi tự đoán.

                Một node chưa ánh xạ không phải lỗi — nó hiện chữ gốc của component.
                Nhưng chữ gốc lặp y hệt ở cả mười thẻ thì TRÔNG như lỗi, và thứ người ta
                đi tìm sẽ là "vì sao dữ liệu sai" chứ không phải "vì sao thiếu một dòng
                cấu hình".
              */
              <p className={WARN_NOTE}>
                {unmapped.map((s) => s.localId).join(', ')} chưa được ánh xạ nên sẽ hiện
                chữ gốc của component ở mọi thẻ. Không phải lỗi — nhưng nó trông như lỗi.
              </p>
            )}

            <p className={NOTE}>
              Chỉ ánh xạ được sang <b className="text-shell-ink font-semibold">nội dung</b>: chữ, ảnh, chữ thay ảnh, đường dẫn. Style
              và cấu trúc luôn theo component — cho ghi đè style ở đây thì sau sáu tháng mỗi
              thẻ một kiểu.
            </p>
          </div>

          {/* ── Khi rỗng ──────────────────────────────────────────────── */}
          <SelectField
            size="sm"
            label="Khi không có bài nào"
            value={spec.empty ? ('hide' in spec.empty ? 'hide' : 'text') : 'component'}
            disabled={saving}
            onChange={(e) => {
              const v = e.target.value;
              patch((s) => {
                if (v === 'hide') s.empty = { hide: true };
                else if (v === 'text') s.empty = { text: [{ t: 'text', v: 'Chưa có bài nào.' }] };
                else delete s.empty;
                return s;
              }, 'đổi hành vi khi khối lặp rỗng');
            }}
          >
            <option value="component">Hiện một lần với nội dung của component</option>
            <option value="hide">Ẩn cả khối</option>
            <option value="text">Hiện dòng chữ thay thế</option>
          </SelectField>

          {spec.empty && 'text' in spec.empty && (
            <TextField
              size="sm"
              label="Dòng chữ thay thế"
              hideLabel
              defaultValue={plainText(spec.empty.text)}
              disabled={saving}
              onBlur={(e) => {
                const v = e.target.value.trim();
                patch((s) => {
                  s.empty = v ? { text: [{ t: 'text', v }] } : { hide: true };
                  return s;
                }, 'đổi dòng chữ khi rỗng');
              }}
            />
          )}

          {/* Chỉ ba nguồn này đếm được mà không có ngữ cảnh trang: `related` và
              `field` cần một bài đang mở, `group-entries` cần một danh mục cha. Hiện
              "0 bài khớp" cho chúng là một con số SAI, và một con số sai trong khối
              soát còn tệ hơn không có khối soát. */}
          {(spec.source.kind === 'query' ||
            spec.source.kind === 'related' ||
            spec.source.kind === 'taxonomy') && <MatchCount spec={spec} />}
        </div>
      )}
    </section>
  );
}

/**
 * "Đang khớp bao nhiêu bài".
 *
 * Vừa là công cụ soát duy nhất trả lời được *"vì sao danh sách của tôi trống"*, vừa là
 * chỗ duy nhất trong builder mà một con số TỰ ĐỔI khi bạn không làm gì — vì nó đọc
 * bảng LIVE, không phải ảnh chụp release. Nhãn nói ra điều đó: giấu đi thì lần đầu có
 * người thấy số nhảy sẽ tưởng mình vừa bấm sai.
 *
 * Endpoint phải dùng lại `resolveRepeat` — hai truy vấn cho cùng một câu hỏi sẽ lệch
 * nhau, và bản nói "có 10 bài" là bản người dùng tin.
 */
function MatchCount({ spec }: { spec: RepeatSpec }) {
  const [state, setState] = useState<
    { s: 'load' } | { s: 'ok'; matched: number; preview: { key: string; title: string }[] } | { s: 'off' }
  >({ s: 'load' });

  const key = JSON.stringify(spec.source);

  useEffect(() => {
    let alive = true;
    setState({ s: 'load' });
    fetch('/api/collections/resolve-repeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repeat: spec }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { matched?: number; preview?: { key: string; title: string }[] }) => {
        if (alive) setState({ s: 'ok', matched: d.matched ?? 0, preview: d.preview ?? [] });
      })
      .catch(() => {
        if (alive) setState({ s: 'off' });
      });
    return () => {
      alive = false;
    };
    // `key` là hình dạng của NGUỒN đã serialize: đổi ánh xạ không đổi số bài khớp, nên
    // gõ một ô ánh xạ không được kéo theo một lượt gọi API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className={cn(ui.inset, 'flex flex-col gap-1.5 px-3 py-2.5')}>
      <div className="flex items-center gap-2">
        <span className={ui.label}>Đang khớp</span>
        <Badge tone="warn" size="sm">
          bản LIVE
        </Badge>
      </div>

      {state.s === 'load' && <p className="text-shell-muted text-small">Đang đếm…</p>}

      {state.s === 'off' && (
        <p className={NOTE}>
          Chưa đếm được — endpoint <code>/api/collections/resolve-repeat</code> chưa có. Khối
          lặp vẫn chạy bình thường trên site; chỉ con số soát này là chưa hiện.
        </p>
      )}

      {state.s === 'ok' && (
        <>
          <p className="text-small">
            <b className="font-semibold tabular-nums">{state.matched}</b> bài khớp điều kiện
          </p>
          <ol className="text-shell-muted space-y-0.5 text-mini">
            {state.preview.map((p, i) => (
              <li key={p.key} className="truncate">
                {i + 1} · {p.title}
              </li>
            ))}
          </ol>
        </>
      )}

      <p className={NOTE}>
        Đọc bảng <b className="text-shell-ink font-semibold">live</b>, không phải ảnh chụp release — nên con số này đổi khi có người
        đăng bài, kể cả khi bạn không làm gì.
      </p>
    </div>
  );
}
