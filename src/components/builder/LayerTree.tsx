'use client';

/**
 * Cây node — pane trái.
 *
 * Chọn ở đây và chọn bằng cách click trên preview là CÙNG một state trong store,
 * nên hai bên luôn đồng bộ. Đó là lý do preview phải là iframe same-origin: chỉ
 * khi cùng origin thì parent mới gắn được listener vào document bên trong và
 * đọc `getBoundingClientRect()` để vẽ khung chọn.
 *
 * ## Vì sao có ô tìm
 *
 * Trang chủ có 149 node, sâu 7 cấp, và 27 node trong đó không có tên nên hiện
 * trùng nhau ("Text", "Text"…). Cuộn tay qua từng ấy hàng để tìm một đoạn văn là
 * thao tác tắc nhất của cả builder.
 *
 * Query rỗng đi đúng đường render cũ, không đổi một hành vi nào.
 */

import { memo, useEffect, useMemo, useState } from 'react';

import { selectSaving, useEditor } from '@/lib/builder/store';
import { cn } from '@/lib/builder/cn';
import { labelOf } from '@/lib/builder/node-label';
import { inTextField, matchesShortcut, shortcutById } from '@/lib/builder/shortcuts';
import { filterTree, indentFor } from '@/lib/builder/tree-filter';
import { focusRing } from '@/lib/builder/ui';
import type { Doc, NodeId, NodeType } from '@/lib/doc/types';

import { Badge } from './ui/Badge';
import { IconButton } from './ui/Button';
import { SearchField } from './ui/Field';
import { Icon, type IconName } from './ui/Icon';

/** Dữ liệu tĩnh — ở module để nó không là một object mới mỗi lần render. */
const LAYER_SEARCH = shortcutById('layer-search')!;

/**
 * Icon và màu theo loại node. Khung bố cục (Section/Stack/Grid) nhạt để hàng chữ, ảnh,
 * nút — thứ người ta thật sự đi tìm — nổi lên; `node-*` là màu chỉ dùng trong cây lớp.
 */
const TYPE_ICON: Record<NodeType, { icon: IconName; tone: string }> = {
  Section: { icon: 'layers', tone: 'text-shell-muted' },
  Stack: { icon: 'list', tone: 'text-shell-muted' },
  Grid: { icon: 'grid', tone: 'text-shell-muted' },
  Text: { icon: 'type', tone: 'text-shell-ink' },
  Image: { icon: 'image', tone: 'text-node-image' },
  Video: { icon: 'monitor', tone: 'text-node-image' },
  Button: { icon: 'cube', tone: 'text-node-button' },
  Canvas: { icon: 'palette', tone: 'text-node-code' },
  CustomCode: { icon: 'edit', tone: 'text-node-code' },
  Composite: { icon: 'sparkle', tone: 'text-node-code' },
  Instance: { icon: 'link', tone: 'text-shell-accent' },
};

/** Icon loại node, dùng chung cho cây và menu "Thêm" của `NodeActions`. */
export function NodeTypeIcon({
  type,
  size = 15,
  className,
}: {
  type: NodeType;
  size?: number;
  className?: string;
}) {
  const look = TYPE_ICON[type] ?? { icon: 'layers' as const, tone: 'text-shell-muted' };
  return <Icon name={look.icon} size={size} className={cn(look.tone, className)} />;
}

interface RowProps {
  id: NodeId;
  doc: Doc;
  depth: number;
  /** Khi đang lọc: id được hiển thị. `null` = không lọc, hiện tất cả. */
  visible: ReadonlySet<NodeId> | null;
  /** Node thật sự khớp từ khoá — tô sáng để phân biệt với tổ tiên. */
  matched: ReadonlySet<NodeId> | null;
  /** Node đang gập. Bỏ qua hoàn toàn khi đang lọc — xem ghi chú ở `LayerTree`. */
  collapsed: ReadonlySet<NodeId>;
  onToggle: (id: NodeId) => void;
  /**
   * Một tổ tiên đang bị ẩn.
   *
   * Cần truyền xuống vì `NodeRenderer` trả `null` cho cả nhánh: node con vẫn
   * `render` mặc định nhưng trên trang thật nó KHÔNG hiện. Không đánh dấu thì
   * cây nói dối — hàng trông bình thường mà nội dung thì không lên site.
   */
  hiddenByAncestor: boolean;
}

/**
 * Một hàng trong cây.
 *
 * ## Vì sao `memo`, và vì sao `isSelected` là PROP chứ không phải đăng ký store
 *
 * Bản trước mỗi hàng tự gọi `useEditor((s) => s.selectedId)` và
 * `useEditor(selectSaving)`. Cả hai đổi rất thường xuyên, nên **cả 159 hàng
 * render lại mỗi lần chọn một node** và thêm hai lần nữa cho mỗi lần ghi (bắt đầu
 * và kết thúc lưu).
 *
 * Đo trước khi sửa: chọn một node mất **639ms**. Đó chính là cái giật mà người dùng
 * cảm thấy — không phải iframe, không phải mạng.
 *
 * Giờ selector trả về BOOLEAN (`s.selectedId === id`). Zustand chỉ render lại khi
 * lát cắt đổi, nên chọn một node chỉ chạm đúng HAI hàng: hàng vừa bỏ chọn và hàng
 * vừa chọn. Cây đệ quy nên truyền prop xuống là bất tiện; selector thì không cần.
 *
 * Đây đúng kỹ thuật Builder.io dùng trong `applyPatchWithMinimalMutationChain` —
 * giữ referential equality để React.memo có tác dụng. Xem docs/BENCHMARK.md §1.4.
 *
 * `select`, `hover`, `dispatch` vẫn lấy từ store: chúng là tham chiếu hàm ổn định
 * nên không gây render lại.
 *
 * `save` đọc bằng `getState()` LÚC BẤM thay vì đăng ký. Nó chỉ dùng để chặn bấm
 * hai lần; một trạng thái `disabled` chậm một khung hình không ai thấy, còn 159 lần
 * render thì thấy.
 */
const Row = memo(function Row({
  id,
  doc,
  depth,
  visible,
  matched,
  collapsed,
  onToggle,
  hiddenByAncestor,
}: RowProps) {
  const node = doc.nodes[id];
  // Selector trả BOOLEAN, không trả selectedId: zustand chỉ render lại khi lát cắt
  // đổi, nên chọn một node chỉ chạm đúng hai hàng thay vì cả 159.
  const isSelected = useEditor((s) => s.selectedId === id);
  const select = useEditor((s) => s.select);
  const hover = useEditor((s) => s.hover);
  const dispatch = useEditor((s) => s.dispatch);

  if (!node) return null;
  if (visible && !visible.has(id)) return null;

  const isMatch = matched?.has(id) ?? false;
  const hasChildren = node.children.length > 0;

  const isHidden = node.render === false;
  const isRoot = node.parentId === null;
  const dimmed = isHidden || hiddenByAncestor;

  /**
   * Ẩn/hiện đi qua hệ op như mọi thay đổi khác, nên nó undo được và nó vào
   * AuditLog. `null` XOÁ khoá thay vì ghi `true`: mặc định là hiện, và một doc
   * đầy `render: true` chỉ là tiếng ồn.
   *
   * Dùng `setPresence`, KHÔNG dùng `setProps({ render })`. Hai op cho cùng kết
   * quả trong doc, nhưng `setProps` là op chung: AuditLog chỉ ghi
   * `kinds: ['setProps']` nên không phân biệt được với đổi tên, đổi `alt` hay gán
   * `assetId`. Truy một khối bị ẩn oan là đúng lúc cần lịch sử nói rõ nó là gì.
   *
   * Nút này ẩn khỏi CẢ TRANG, không ẩn theo màn hình — xem `NodeBase.render`.
   */
  const toggleHidden = () => {
    // Đọc lúc BẤM thay vì đăng ký: đăng ký `save` làm cả 159 hàng render lại
    // hai lần cho mỗi lần ghi.
    if (selectSaving(useEditor.getState())) return;
    void dispatch(
      [{ op: 'setPresence', nodeId: id, render: isHidden ? null : false }],
      { label: `${isHidden ? 'hiện' : 'ẩn'} ${labelOf(node)}` },
    );
  };

  /**
   * Xoá node ngay từ hàng cây.
   *
   * Xoá vốn đã có ở `NodeActions` (thanh dưới canvas) và ở phím Delete. Nhưng người
   * dùng báo ngày 19/08/2026 rằng nó "không tiện": khi đang làm việc trong cây, phải
   * chọn node rồi đưa mắt xuống một thanh khác để bấm.
   *
   * ## Vì sao KHÔNG hỏi xác nhận ở đây
   *
   * `NodeActions` có `confirm()`. Ở đây thì không, và đó là lựa chọn: nút này chỉ
   * hiện khi hover đúng hàng đó, nằm cạnh tên node, và undo hoạt động. Một hộp thoại
   * cho mỗi lần xoá trong lúc đang dọn cây là ma sát lớn hơn giá trị nó bảo vệ.
   *
   * Nó phụ thuộc undo THẬT hoạt động — và undo từng hỏng với node mang `_src`
   * (xem `stripScaffolding` trong doc/migrate.ts). Sửa lỗi đó là điều kiện để nút
   * này an toàn, không phải một việc riêng.
   *
   * ## Vì sao node gốc không có nút này
   *
   * Cùng lý do như nút mắt: xoá gốc là làm trắng cả trang, và cây node còn lại thành
   * mồ côi. `NodeActions` cũng chặn.
   */
  const removeSelf = () => {
    if (selectSaving(useEditor.getState())) return;
    if (node.locked) return;
    void dispatch([{ op: 'removeNode', nodeId: id }], { label: `xoá ${labelOf(node)}` });
  };
  // Đang lọc thì gập bị vô hiệu: một kết quả nằm dưới nhánh đã gập mà không hiện
  // ra thì ô tìm trở thành nói dối — nó báo "19/159" rồi không cho xem 19 cái đó.
  const isCollapsed = hasChildren && !visible && collapsed.has(id);

  return (
    <>
      <div
        style={{ paddingInlineStart: `${indentFor(depth)}px` }}
        className={cn(
          'group relative flex min-h-7.5 w-full items-center gap-0.5 rounded-xs pr-1 text-small transition-colors',
          isSelected ? 'bg-shell-accent-soft font-semibold text-shell-accent' : 'hover:bg-shell-raised',
          // Tổ tiên của kết quả bị làm mờ: chúng ở đó để chỉ đường, không phải
          // để đọc. Không phân biệt thì mọi hàng trông như kết quả.
          visible && !isMatch && 'text-shell-muted opacity-60',
        )}
      >
        {/* Chevron là button RIÊNG, không phải một phần của hàng: gập một nhánh
            và chọn node là hai ý định khác nhau, và button lồng trong button là
            HTML không hợp lệ. Node không có con nhận một ô trống cùng bề rộng để
            nhãn của mọi hàng thẳng cột. */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(id)}
            aria-expanded={!isCollapsed}
            // Hook ổn định: "hàng này có con" là điều kiện mà e2e cần chọn được mà
            // không hardcode chỉ số hàng (chỉ số trôi theo trạng thái gập).
            data-layer-toggle={id}
            aria-label={`${isCollapsed ? 'Mở' : 'Gập'} ${labelOf(node)}`}
            title={isCollapsed ? 'Mở nhánh' : 'Gập nhánh'}
            className={cn(
              'grid size-5 shrink-0 place-items-center rounded-xs text-shell-muted hover:text-shell-ink',
              focusRing,
            )}
          >
            <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={14} />
          </button>
        ) : (
          <span aria-hidden className="size-5 shrink-0" />
        )}

        {/* `reveal`: node ở giữa một trang dài nằm ngoài khung xem trước, nên chọn mà
            không cuộn là khung chọn vẽ ở chỗ không ai thấy — xem `EditorState.reveal`. */}
        <button
          type="button"
          data-layer-row={id}
          onClick={() => select(id, { reveal: true })}
          onMouseEnter={() => hover(id)}
          onMouseLeave={() => hover(null)}
          className={cn('flex min-w-0 flex-1 items-center gap-1.5 rounded-xs py-1 text-left', focusRing)}
        >
          <NodeTypeIcon type={node.type} />
          {/* title là đường DUY NHẤT xem được tên đầy đủ: ở độ sâu lớn, thụt lề
              ăn hết chỗ trong pane hẹp nên tên dài luôn bị cắt. */}
          <span
            className={cn('truncate', dimmed && 'text-shell-muted line-through opacity-60')}
            title={
              isHidden
                ? `${labelOf(node)} — đang ẩn, không lên site khi publish`
                : hiddenByAncestor
                  ? `${labelOf(node)} — không lên site vì một khối cha đang ẩn`
                  : labelOf(node)
            }
          >
            {labelOf(node)}
          </span>
          {node.effects.length > 0 && (
            <Badge tone="accent" size="sm" className="shrink-0 px-1.5" title={`${node.effects.length} hiệu ứng`}>
              fx{node.effects.length}
            </Badge>
          )}
          {node.locked && (
            <Badge tone="warn" size="sm" className="shrink-0 px-1.5" title={node.locked.reason}>
              khoá
            </Badge>
          )}
          {/* Số hậu duệ: trả lời "khối này chứa bao nhiêu thứ" mà không phải mở nó ra,
              và lúc gập thì nói đúng câu hỏi lúc đó — vừa cất đi 3 thứ hay 90 thứ. */}
          {hasChildren && (
            <span className="ml-auto shrink-0 pl-1 text-mini font-medium text-shell-muted tabular-nums">
              {countDescendants(doc, id)}
            </span>
          )}
        </button>

        {/*
          Nút mắt và nút xoá — nổi ĐÈ lên mép phải của hàng, không chiếm chỗ trong hàng.

          Chỉ hiện khi trỏ vào hàng hoặc khi focus nằm trong hàng: pane hẹp và ở độ sâu
          lớn thụt lề đã ăn gần hết chỗ, nên hai nút thường trú sẽ cắt mất nhãn. Nhánh
          đang ẩn thì luôn hiện — nếu không thì không có cách nào tìm lại thứ mình đã ẩn.
          `opacity-0` vẫn nhận focus, nên bàn phím tới được: Tab vào hàng là `focus-within`
          bật lên và hai nút hiện ra.
        */}
        {!isRoot && (
          <span
            className={cn(
              'absolute inset-y-0 right-0.5 flex items-center gap-px pl-1 transition-opacity',
              isSelected ? 'bg-shell-accent-soft' : 'bg-shell-panel group-hover:bg-shell-raised',
              !isHidden && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
            )}
          >
            {/* Ẩn khối khỏi trang mà KHÔNG xoá nó. */}
            <IconButton
              icon={isHidden ? 'eye-off' : 'eye'}
              size="sm"
              // Hook riêng, cùng lý do như `data-layer-row`: nút mắt KHÔNG có trên
              // hàng gốc, nên `nth(i)` của danh sách mắt lệch một so với `nth(i)`
              // của danh sách hàng. Lỗi đó đã làm một test xanh trong khi nó ẩn một
              // node và hoàn nguyên một node KHÁC — để lại bản nháp bẩn.
              data-layer-eye={id}
              onClick={toggleHidden}
              aria-pressed={isHidden}
              label={isHidden ? `Hiện lại ${labelOf(node)}` : `Ẩn ${labelOf(node)}`}
              title={
                isHidden
                  ? 'Đang ẩn — bấm để hiện lại. Khi publish, khối này không lên site.'
                  : 'Ẩn khối này khỏi trang. Nội dung vẫn còn, và khi publish nó sẽ không lên site.'
              }
              className={cn(isHidden && 'text-shell-warn')}
            />
            {/* Node bị khoá thì `disabled`: khoá là ý định của người dùng và nó phải có
                hiệu lực ở MỌI đường xoá, không riêng `NodeActions`. */}
            <IconButton
              icon="trash"
              size="sm"
              variant="danger"
              data-layer-remove={id}
              disabled={Boolean(node.locked)}
              onClick={removeSelf}
              label={`Xoá ${labelOf(node)}`}
              title={
                node.locked
                  ? `Node bị khoá: ${node.locked.reason}`
                  : `Xoá ${labelOf(node)}. Hoàn tác bằng Ctrl+Z.`
              }
            />
          </span>
        )}
      </div>

      {!isCollapsed &&
        node.children.map((child) => (
          <Row
            key={child}
            id={child}
            doc={doc}
            depth={depth + 1}
            visible={visible}
            matched={matched}
            collapsed={collapsed}
            onToggle={onToggle}
            hiddenByAncestor={dimmed}
          />
        ))}
    </>
  );
});

/** Tổng số hậu duệ, để hàng nói được nó đang chứa — hoặc đang cất — bao nhiêu. */
function countDescendants(doc: Doc, id: NodeId): number {
  let n = 0;
  const stack = [...(doc.nodes[id]?.children ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    n += 1;
    const node = doc.nodes[cur];
    if (node) stack.push(...node.children);
  }
  return n;
}

/** Chuỗi tổ tiên của `id`, gần nhất trước. */
function ancestorsOf(doc: Doc, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  let cur = doc.nodes[id]?.parentId ?? null;
  while (cur) {
    out.push(cur);
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return out;
}

export function LayerTree({ doc }: { doc: Doc }) {
  const [query, setQuery] = useState('');
  const selectedId = useEditor((s) => s.selectedId);

  /*
   * `Ctrl+P` đưa con trỏ vào ô tìm — không mở một hộp thứ hai.
   *
   * Ô tìm ĐÃ CÓ ở đây và nó lọc cả cây; thứ thiếu chỉ là đường tới nó mà không rời
   * bàn phím. Dựng một palette riêng cho "tìm lớp" sẽ là hộp thứ hai làm gần đúng
   * việc mà ô này đang làm, và hai chỗ tìm cùng một thứ là hai chỗ để chúng trôi.
   *
   * `Ctrl+P` mặc định là hộp In của trình duyệt, nên `preventDefault` là bắt buộc —
   * và nó chỉ chạy khi con trỏ KHÔNG ở trong một ô nhập khác, để không cướp phím của
   * người đang gõ. Tổ hợp này đã đăng ký trong `shortcuts.ts` từ lát 3, nên nó không
   * đụng phím nào khác.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesShortcut(e, LAYER_SEARCH)) return;
      if (inTextField(e.target)) return;
      const box = document.getElementById('layer-search');
      if (!(box instanceof HTMLInputElement)) return;
      e.preventDefault();
      box.focus();
      box.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Node đang GẬP, không phải node đang mở.
   *
   * Lưu mặt phủ định để tập rỗng = mở hết, tức đúng hành vi trước khi có gập —
   * không ai mở trang lên và thấy cây mình vừa quen bị cất đi. Nó cũng đúng hơn
   * theo nghĩa: một node vừa được chèn thì mặc định phải thấy được.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(() => new Set());

  const toggle = (id: NodeId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /**
   * Chọn một node thì mở đường tới nó.
   *
   * Chọn đến từ hai phía: cây và click trên preview. Từ preview thì node có thể
   * nằm dưới một nhánh đang gập — không mở ra thì inspector bày thuộc tính của
   * một node mà cây không hiện, và người dùng mất luôn ngữ cảnh nó nằm ở đâu.
   */
  useEffect(() => {
    if (!selectedId) return;
    const path = ancestorsOf(doc, selectedId);
    if (!path.length) return;
    setCollapsed((prev) => {
      if (!path.some((a) => prev.has(a))) return prev;
      const next = new Set(prev);
      for (const a of path) next.delete(a);
      return next;
    });
  }, [selectedId, doc]);

  const result = useMemo(
    () => filterTree(doc, query, (id) => {
      const node = doc.nodes[id];
      return node ? labelOf(node) : '';
    }),
    [doc, query],
  );

  const total = Object.keys(doc.nodes).length;

  const parentIds = useMemo(
    () => Object.values(doc.nodes).filter((n) => n.children.length > 0).map((n) => n.id),
    [doc],
  );
  // Gập gốc lại là cất cả cây; đó là mục đích, và một cú bấm mở lại được.
  const allCollapsed = parentIds.length > 0 && parentIds.every((id) => collapsed.has(id));

  /**
   * Gập tất cả, NHƯNG chừa đường tới node đang chọn.
   *
   * Bản trước gập cả nhánh đó, nên node đang chọn biến khỏi cây trong khi Inspector
   * vẫn bày thuộc tính của nó — người dùng thấy hai khung nói hai chuyện khác nhau
   * và không có gì giải thích.
   *
   * Đây đúng hành vi Figma: "If you've already selected a layer when you collapse
   * layers, all expanded layers **except for your selection** will collapse."
   *
   * `useEffect` mở-đường-tới-selection ở trên KHÔNG cứu được trường hợp này: nó chỉ
   * chạy khi `selectedId` đổi, mà bấm gập thì selection giữ nguyên.
   */
  const collapseAllButSelection = (): Set<NodeId> => {
    const next = new Set(parentIds);
    if (selectedId) for (const id of ancestorsOf(doc, selectedId)) next.delete(id);
    return next;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Không còn hàng tiêu đề "Cấu trúc" riêng: nút của mục Lớp trên đầu pane đã nói
          đúng điều đó và cũng đã hiện tổng số node — hai chỗ cùng ghi một con số là
          một hàng bị mất trắng trong một pane hẹp. Bộ đếm vẫn ở lại, chuyển vào hàng
          tìm kiếm, vì khi đang lọc thì `khớp/tổng` là thông tin KHÁC với tổng số. */}
      <div className="flex shrink-0 items-center gap-1 px-2.5 pb-2">
        <SearchField
          id="layer-search"
          size="sm"
          label="Tìm phần tử"
          value={query}
          spellCheck={false}
          placeholder="Tìm phần tử… (Ctrl+P)"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Escape xoá và nhả focus — thoát khỏi bộ lọc bằng một phím, không
            // phải xoá từng ký tự.
            if (e.key === 'Escape') {
              setQuery('');
              e.currentTarget.blur();
            }
          }}
          wrapperClassName="min-w-0 flex-1"
        />
        {/* Chỉ hiện khi đang lọc: ngoài lúc lọc thì nó lặp lại con số ở tiêu đề. */}
        {result && (
          <span className="font-shell-mono shrink-0 px-1 text-mini text-shell-muted tabular-nums">
            {result.matched.size}/{total}
          </span>
        )}
        {/* Gập/mở tất cả. Với cây 158 node sâu 7 cấp, gập tay từng nhánh để tìm
            đường là chính cái việc mà nút này thay thế. Ẩn khi đang lọc: lúc đó
            gập đã bị vô hiệu nên nút sẽ không có tác dụng nhìn thấy được. */}
        {!result && parentIds.length > 0 && (
          <IconButton
            size="sm"
            icon={allCollapsed ? 'plus' : 'minus'}
            label={allCollapsed ? 'Mở tất cả nhánh' : 'Gập tất cả nhánh'}
            onClick={() => setCollapsed(allCollapsed ? new Set() : collapseAllButSelection())}
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
        {result && result.matched.size === 0 ? (
          <p className="px-2 py-3 text-small leading-relaxed text-shell-muted">
            Không có phần tử nào khớp <strong className="font-semibold text-shell-ink">{query}</strong>.
          </p>
        ) : (
          <Row
            id={doc.rootId}
            doc={doc}
            depth={0}
            visible={result?.visible ?? null}
            matched={result?.matched ?? null}
            collapsed={collapsed}
            onToggle={toggle}
            hiddenByAncestor={false}
          />
        )}
      </div>
    </div>
  );
}
