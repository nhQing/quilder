'use client';

/**
 * Pane trái — bốn mục xếp DỌC: Lớp · Comp · Ảnh · Trang.
 *
 * Rail (khi thu gọn) có thêm một ô thứ năm `AI` — đã chừa chỗ, chưa dựng. Xem
 * docblock của `Rail`.
 *
 * ## Vì sao accordion, và vì sao mở một lúc một
 *
 * Bản đầu dùng tab ngang, với lập luận: pane rộng 240px, chia đôi theo chiều dọc
 * thì mỗi nửa còn chừng 8 hàng — không đủ duyệt một cây 158 node. Lập luận đó
 * đúng với accordion mở-nhiều-cùng-lúc, nhưng **collapse vô hiệu hoá nó**: mục
 * đóng chỉ tốn một hàng tiêu đề, nên mục đang mở vẫn được trọn chiều cao y như
 * hồi còn tab.
 *
 * Được thêm so với tab: bốn tiêu đề nằm cùng lúc trước mắt kèm số đếm, nên biết
 * trang này có bao nhiêu node / bao nhiêu component sẵn dùng mà không phải bấm
 * thử. Và đóng hết lại là một trạng thái hợp lệ — pane thành một mục lục bốn dòng.
 * (Bản vẽ v2 đặt bốn mục thành một hàng nút ngang trên đầu pane; ở bề rộng 240px
 * hàng đó không chứa nổi cả bốn số đếm lẫn nút thu gọn, nên giữ hình dọc.)
 *
 * Đổi lại: mở mục khác thì mục đang mở đóng, tức là mất vị trí cuộn trong cây.
 * Đó là cái giá của việc cho mục đang mở trọn chiều cao, và nó rẻ hơn một cây
 * node cao 8 hàng.
 *
 * ## Vì sao giữ mục Lớp
 *
 * Nó là đường duy nhất tới node lồng sâu. Click trên preview chỉ chạm được thứ
 * nhìn thấy; một Stack rỗng làm khung layout thì không bao giờ bấm trúng.
 *
 * ## Vì sao KHÔNG còn `role="tab"`
 *
 * Đây là accordion, không phải tabs: nhiều mục có thể đóng cùng lúc và không có
 * mục nào "đang được chọn" khi đóng hết. Dùng `role="tab"` cho hình dạng này là
 * nói dối trình đọc màn hình — nó sẽ hứa một tablist có đúng một tab active.
 * Hợp đồng ở đây là `aria-expanded` + `aria-controls`.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/builder/cn';
import { instancesOf } from '@/lib/builder/component-uses';
import { selectSaving, useEditor } from '@/lib/builder/store';
import { readEnum, safeStorage, STORAGE_KEYS, write } from '@/lib/builder/persisted';
import { focusRing, ui } from '@/lib/builder/ui';
import { instanceToOps, presetToOps, type PresetTree } from '@/lib/doc/preset';
import type { Doc } from '@/lib/doc/types';
import type { PageSummary, PresetSummary } from '@/lib/builder/queries';
import { AssetPane } from './AssetPane';
import { LayerTree } from './LayerTree';
import { NodeActions } from './NodeActions';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Icon, type IconName } from './ui/Icon';

type Tab = 'layers' | 'components' | 'assets' | 'pages';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'layers', label: 'Lớp', icon: 'layers' },
  { id: 'components', label: 'Comp', icon: 'cube' },
  { id: 'assets', label: 'Ảnh', icon: 'image' },
  { id: 'pages', label: 'Trang', icon: 'text' },
];

const SECTION_IDS = TABS.map((t) => t.id);

export function LeftPanel({
  doc,
  pages,
  presets,
  currentPageId,
  componentMode = false,
  collapsed = false,
  onToggleCollapse,
  onEditComponent,
}: {
  doc: Doc;
  pages: PageSummary[];
  presets: PresetSummary[];
  currentPageId: string;
  /**
   * Đang sửa một component, không phải một trang.
   *
   * Chỉ còn tab Lớp: chèn preset vào một component sẽ tạo instance lồng nhau —
   * thứ bị chặn ở đường ghi — và danh sách trang thì không dẫn đi đâu có nghĩa
   * khi thứ đang sửa không phải trang.
   */
  componentMode?: boolean;
  /** Pane đang thu về dải mỏng. Bề rộng do `EditorShell` sở hữu. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /**
   * Mở một component ra sửa.
   *
   * Trước đây pane này chỉ có "Chèn" và "Bản sao", nên đường DUY NHẤT để sửa một
   * component là chọn một `Instance` trên trang rồi bấm "Sửa component" ở pane
   * phải — tức là phải có một trang đang dùng nó. Component chưa được chèn ở đâu
   * thì không mở ra được bằng giao diện.
   */
  onEditComponent?: (componentId: string) => void;
}) {
  const tabs = componentMode ? TABS.filter((t) => t.id === 'layers') : TABS;

  // `null` = đóng hết. Mặc định mở Lớp vì đó là thứ dùng nhiều nhất.
  const [openState, setOpen] = useState<Tab | null>('layers');

  /**
   * Mục đang mở, đã lọc theo những mục CÒN TỒN TẠI.
   *
   * Tập mục đổi lúc chạy: vào chế độ sửa component thì chỉ còn Lớp. Nếu lúc đó
   * người dùng đang mở Component — đúng đường họ vừa đi qua để bấm "Sửa" — thì
   * `open` trỏ vào một mục không còn được render, và pane không mở gì cả: người
   * dùng vào màn sửa component mà không thấy cây node, cũng không thấy vì sao.
   *
   * Suy ra trong render chứ không chữa bằng effect: effect chạy SAU một lượt vẽ,
   * nên sẽ có một khung hình pane trống rồi mới bung ra.
   */
  // `null` phải đi qua NGUYÊN VẸN: đóng hết là lựa chọn có chủ ý của người dùng,
  // không phải một giá trị lỗi cần chữa. Chỉ mục không còn tồn tại mới rơi về đầu.
  const open =
    openState === null
      ? null
      : tabs.some((t) => t.id === openState)
        ? openState
        : (tabs[0]?.id ?? null);

  // Hydrate SAU khi mount, không phải trong render đầu: server không có
  // localStorage, đọc nó lúc render sẽ làm HTML hai bên lệch nhau.
  useEffect(() => {
    const stored = readEnum(safeStorage(), STORAGE_KEYS.leftSection, [...SECTION_IDS, 'none']);
    if (!stored) return;
    if (stored === 'none') return setOpen(null);
    // Mục đã lưu có thể không còn hợp lệ — ví dụ 'pages' khi đang sửa component.
    if (tabs.some((t) => t.id === stored)) setOpen(stored as Tab);
  }, [tabs]);

  // Mọi đường đổi mục đi qua đây, nên không có đường nào quên ghi lại lựa chọn.
  const setSection = (next: Tab | null) => {
    setOpen(next);
    write(safeStorage(), STORAGE_KEYS.leftSection, next ?? 'none');
  };

  const toggle = (id: Tab) => setSection(open === id ? null : id);

  if (collapsed) {
    return (
      <Rail
        tabs={tabs}
        open={open}
        // Bấm nhãn ở dải luôn MỞ mục đó, không toggle: người ta bấm nó để xem
        // nội dung, và đóng ngay lại thì cú bấm không có kết quả nào.
        onPick={(id) => {
          setSection(id);
          onToggleCollapse?.();
        }}
        onExpand={onToggleCollapse}
      />
    );
  }

  const counts: Record<Tab, number> = {
    layers: Object.keys(doc.nodes).length,
    components: presets.length,
    // Kho ảnh nạp trong pane, nên số ở đây không biết trước. 0 = không hiện số.
    assets: 0,
    pages: pages.length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabs.map((t, i) => {
        const isOpen = open === t.id;
        return (
          <section
            key={t.id}
            // Chỉ mục ĐANG MỞ được co giãn; mục đóng chỉ cao bằng tiêu đề. Đó là
            // toàn bộ lý do accordion không lặp lại lỗi "mỗi nửa 8 hàng".
            className={cn(
              'flex min-h-0 flex-col',
              isOpen ? 'flex-1' : 'shrink-0',
              i > 0 && 'border-t border-shell-line',
            )}
          >
            <div className="flex shrink-0 items-center gap-1 p-1.5">
              <h2 className="min-w-0 flex-1">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`left-section-${t.id}`}
                  onClick={() => toggle(t.id)}
                  className={cn(
                    'flex h-control-sm w-full items-center gap-2 rounded px-2 text-small font-semibold transition-colors hover:bg-shell-raised',
                    focusRing,
                    isOpen ? 'text-shell-ink' : 'text-shell-muted hover:text-shell-ink',
                  )}
                >
                  <Icon name={t.icon} size={16} className={isOpen ? 'text-shell-accent' : undefined} />
                  <span className="truncate">{t.label}</span>
                  {counts[t.id] > 0 && (
                    <span className="ml-auto text-mini font-medium text-shell-muted tabular-nums">
                      {counts[t.id]}
                    </span>
                  )}
                </button>
              </h2>
              {/* Nút thu gọn đứng trên hàng tiêu đề ĐẦU, không chiếm một hàng riêng: pane
                  hẹp, và một hàng chỉ chứa một nút là một hàng cây node bị mất. */}
              {i === 0 && onToggleCollapse && (
                <IconButton
                  icon="chevron-left"
                  size="sm"
                  label="Thu gọn pane trái"
                  title="Thu gọn pane để canvas rộng thêm"
                  onClick={onToggleCollapse}
                />
              )}
            </div>

            {isOpen && (
              <div id={`left-section-${t.id}`} className="min-h-0 flex-1">
                {t.id === 'layers' && (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="min-h-0 flex-1">
                      <LayerTree doc={doc} />
                    </div>
                    {/* Thanh thao tác đặt DƯỚI cây, không phải trên: nó tác động
                        lên node đang chọn, nên nằm gần chỗ tay đang ở sau khi
                        chọn. */}
                    <NodeActions doc={doc} />
                  </div>
                )}
                {t.id === 'components' && (
                  <ComponentList presets={presets} doc={doc} onEdit={onEditComponent} />
                )}
                {t.id === 'assets' && <AssetPane doc={doc} />}
                {t.id === 'pages' && (
                  <PageList pages={pages} currentPageId={currentPageId} />
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ── Dải mỏng khi thu gọn ─────────────────────────────────────────────── */

/**
 * Icon + chữ, trên dải 44px.
 *
 * ## Quyết định cũ, và vì sao nó đã bị LẬT
 *
 * Bản đầu dùng **chữ viết dọc, không icon**, với lý do: dải chỉ rộng 32px nên chữ
 * ngang không lọt, và *"dự án chưa có bộ icon nào — thêm một bộ chỉ để phục vụ ba
 * nhãn là đổi 2MB lấy ba chữ"*. Lý do ấy không còn áp: vỏ giờ có bộ icon SVG vẽ tay
 * của design system (`ui/Icon`) — nét inline, không một byte font nào được tải. Cái
 * đổi là dải rộng 44px thay vì 32px, vừa đủ cho một icon cộng một dòng chữ nhỏ.
 *
 * Chữ KHÔNG bị thay bằng icon, nó nằm cạnh: icon một mình là thông tin truyền tải
 * riêng bằng hình (WCAG 1.1.1). Giữ cả hai cũng giữ được hai tính chất mà bản chữ
 * dọc có: trình đọc màn hình đọc ra tên thật, và Ctrl+F của trình duyệt tìm được.
 *
 * Bấm một nhãn thì MỞ pane luôn, không chỉ đổi mục: ở dải mỏng không có chỗ để
 * hiện nội dung, nên "chọn mục" mà không mở ra là một cú bấm không có kết quả.
 */
function Rail({
  tabs,
  open,
  onPick,
  onExpand,
}: {
  tabs: Array<{ id: Tab; label: string; icon: IconName }>;
  open: Tab | null;
  onPick: (id: Tab) => void;
  onExpand?: () => void;
}) {
  const item = 'flex w-full flex-col items-center gap-1 rounded py-1.5';
  return (
    <div className="flex h-full flex-col items-center gap-1 px-1 py-1.5">
      <IconButton icon="chevron-right" size="sm" label="Mở lại pane trái" onClick={onExpand} />
      <span aria-hidden className="my-0.5 h-px w-6 bg-shell-line" />
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          data-rail-item={t.id}
          onClick={() => onPick(t.id)}
          title={t.label}
          className={cn(
            item,
            'transition-colors hover:bg-shell-raised',
            focusRing,
            open === t.id ? 'text-shell-accent' : 'text-shell-muted hover:text-shell-ink',
          )}
        >
          {/* Icon `aria-hidden` (sẵn trong `Icon`): tên thật nằm ở dòng chữ ngay dưới,
              nên đọc cả hai là đọc hai lần một thứ. */}
          <Icon name={t.icon} size={17} />
          <span className="text-micro leading-none font-medium">{t.label}</span>
        </button>
      ))}

      {/*
        `AI` — chỗ đã chừa, chưa dựng.

        Spec §0 đặt lớp AI NGOÀI phạm vi: nó không nằm trong danh sách màn của `t3`,
        và §6 nói lát 4 "chừa chỗ cho nó chứ không dựng nó". Một `<span>` tối kèm
        `title` nói ra điều đó — không phải một `<button>` bấm được rồi không làm gì,
        vì cái sau dạy người dùng rằng nút của công cụ này không đáng tin.
      */}
      <span
        data-rail-item="ai"
        title="Lớp AI chưa dựng — nằm ngoài phạm vi bản thiết kế này."
        className={cn(item, 'cursor-not-allowed text-shell-muted opacity-40')}
      >
        <Icon name="sparkle" size={17} />
        <span className="text-micro leading-none font-medium">AI</span>
      </span>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────────────── */

function ComponentList({
  presets,
  doc,
  onEdit,
}: {
  presets: PresetSummary[];
  doc: Doc;
  onEdit?: (componentId: string) => void;
}) {
  const selectedId = useEditor((s) => s.selectedId);
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectSaving);
  const select = useEditor((s) => s.select);

  // Chèn vào TRONG node đang chọn nếu nó nhận được con; nếu không thì chèn vào
  // cha của nó, ngay sau nó. Không chọn gì thì thêm vào cuối trang.
  const targetFor = (): { parentId: string; index: number } => {
    const node = selectedId ? doc.nodes[selectedId] : null;
    if (!node) {
      const root = doc.nodes[doc.rootId]!;
      return { parentId: doc.rootId, index: root.children.length };
    }
    const isContainer = ['Section', 'Stack', 'Grid'].includes(node.type);
    if (isContainer) return { parentId: node.id, index: node.children.length };

    const parent = node.parentId ? doc.nodes[node.parentId] : null;
    if (!parent) {
      const root = doc.nodes[doc.rootId]!;
      return { parentId: doc.rootId, index: root.children.length };
    }
    return {
      parentId: parent.id,
      index: (parent.children as string[]).indexOf(node.id) + 1,
    };
  };

  /**
   * Chèn LIÊN KẾT (mặc định) hay chèn BẢN SAO.
   *
   * Đây là lựa chọn có hệ quả thật, nên nó là hai nút chứ không phải một tuỳ chọn
   * giấu trong menu:
   *
   *   liên kết  component đổi → trang đổi theo. Phần riêng của trang là override
   *             nội dung (chữ, ảnh, link). Cấu trúc và style luôn theo component.
   *   bản sao   cây node rời hẳn ra. Sửa được mọi thứ, nhưng component đổi thì
   *             trang KHÔNG đổi theo.
   *
   * Mặc định là liên kết vì đó là thứ người ta mong đợi ở chữ "component", và vì
   * bản sao thì không quay ngược lại thành liên kết được.
   */
  const insert = async (preset: PresetSummary, linked: boolean) => {
    const { parentId, index } = targetFor();
    const ids = new Set(Object.keys(doc.nodes));

    const ops = linked
      ? instanceToOps(preset.id, parentId, index, ids, preset.name)
      : presetToOps(preset.tree as PresetTree, parentId, index, ids);

    const ok = await dispatch(ops, {
      label: `chèn ${preset.name}${linked ? '' : ' (bản sao)'}`,
    });
    // Chọn luôn node vừa chèn để sửa được ngay — và CUỘN khung tới nó. Không chọn gì thì
    // node vào cuối trang, tức ngoài khung nhìn; trước 16/10/2026 thiếu `reveal` nên bấm
    // Chèn trông như không có gì xảy ra. Canvas tự thử lại sau khi khung nạp bản mới.
    if (ok && ops[0]?.op === 'insertNode') select(ops[0].node.id, { reveal: 'exact' });
  };

  /**
   * Component chưa dùng trên trang mà người dùng vừa bấm vào — để báo ngay tại mục đó.
   * `tick` tăng mỗi lần bấm, để bấm lại cùng mục vẫn cuộn tới lời báo (xem `UnusedNote`).
   */
  const [unused, setUnused] = useState<{ id: string; tick: number } | null>(null);

  /**
   * Bấm vào một mục: tới chỗ component đó ĐANG DÙNG trên trang. Dùng nhiều chỗ thì mỗi lần
   * bấm sang chỗ kế tiếp (theo thứ tự trên trang), hết thì vòng lại đầu.
   */
  const locate = (preset: PresetSummary) => {
    const ids = instancesOf(doc, preset.id);
    if (!ids.length) return setUnused((u) => ({ id: preset.id, tick: (u?.tick ?? 0) + 1 }));
    setUnused(null);
    const at = selectedId ? ids.indexOf(selectedId) : -1;
    select(ids[(at + 1) % ids.length]!, { reveal: true });
  };

  const target = targetFor();
  const targetNode = doc.nodes[target.parentId];

  const byCategory = new Map<string, PresetSummary[]>();
  for (const p of presets) {
    byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p]);
  }

  return (
    <div className="flex h-full flex-col">
      <p className="shrink-0 px-3.5 pb-1.5 text-mini text-shell-muted">
        Chèn vào{' '}
        <span className="font-shell-mono text-shell-ink">
          {targetNode?.name ?? targetNode?.type ?? '—'}
        </span>
      </p>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {[...byCategory.entries()].map(([category, items]) => (
          <div key={category}>
            <p className={cn(ui.eyebrow, 'px-2 pt-3 pb-1')}>{category}</p>
            {items.map((preset) => {
              const used = instancesOf(doc, preset.id);
              const current = selectedId !== null && used.includes(selectedId);
              return (
              <div
                key={preset.id}
                data-component-item={preset.id}
                // Id các chỗ dùng, theo thứ tự trên trang — cho e2e, khỏi đoán lại phép duyệt.
                data-uses={used.join(' ')}
                className={cn(
                  'relative flex flex-col gap-1 rounded px-2 py-2 transition-colors hover:bg-shell-raised',
                  current && 'bg-shell-accent-soft hover:bg-shell-accent-soft',
                )}
              >
                <span className="flex items-baseline gap-2">
                  {/*
                    Tên là nút "tới chỗ đang dùng". Lớp `after:inset-0` phủ cả thẻ để bấm
                    đâu trên thẻ cũng được — nhưng các nút Chèn/Bản sao/Sửa nằm TRÊN lớp
                    đó (`relative z-1`), nên chúng vẫn là nút riêng.
                  */}
                  <button
                    type="button"
                    onClick={() => locate(preset)}
                    title={
                      used.length
                        ? `Tới chỗ dùng trên trang này${used.length > 1 ? ' — bấm tiếp để sang chỗ kế' : ''}`
                        : preset.aiDescription
                    }
                    className={cn(
                      'min-w-0 truncate rounded-sm text-left text-small font-semibold after:absolute after:inset-0 after:content-[""]',
                      focusRing,
                    )}
                  >
                    {preset.name}
                  </button>
                  {used.length > 0 && (
                    <Badge tone="accent" size="sm" className="shrink-0 self-center" title="Số chỗ dùng trên trang này">
                      {used.length} trên trang
                    </Badge>
                  )}
                  {/*
                    Cây này ghi ở bản builder CŨ hơn.

                    Dưới mô hình "mỗi domain một bản builder, nâng cấp được", đây
                    là trường hợp thường: nâng cấp làm `schemaVersion` tăng, và cây
                    trong database vẫn ở bản cũ tới khi có ai sửa nó.

                    Site đang chạy an toàn — `Release.components` đã chụp cây tại
                    thời điểm publish. Chỗ hở là BẢN NHÁP, nên chỉ BÁO ở đây chứ
                    không tự sửa: người dùng phải biết cái gì sắp đổi trước khi nó
                    đổi trang của họ.
                  */}
                  {preset.staleSchema && (
                    <span
                      role="img"
                      title="Cây component này được ghi ở bản builder cũ hơn. Trang đang chạy không bị ảnh hưởng — nó dùng bản đã chụp lúc publish. Mở component ra sửa sẽ nâng cấp cây lên bản mới."
                      aria-label="Cây component ghi ở bản builder cũ hơn"
                      className="relative z-1 shrink-0 self-center text-shell-warn"
                    >
                      <Icon name="refresh" size={14} />
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-mini text-shell-muted tabular-nums">
                    {preset.nodeCount} node
                  </span>
                </span>
                <span className="line-clamp-2 text-mini leading-snug text-shell-muted">
                  {preset.aiDescription}
                </span>
                <span className="relative z-1 mt-0.5 flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    icon="plus"
                    disabled={saving}
                    onClick={() => void insert(preset, true)}
                    title="Giữ liên kết: sửa component thì trang này đổi theo. Chữ và ảnh vẫn sửa riêng được."
                  >
                    Chèn
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => void insert(preset, false)}
                    title="Tách rời hẳn: sửa được mọi thứ, nhưng component đổi thì trang này KHÔNG đổi theo."
                  >
                    Bản sao
                  </Button>
                  {/* Mở component ra sửa. Nằm CẠNH hai nút chèn vì nó là lựa chọn
                      thứ ba của cùng một câu hỏi — dùng, tách ra, hay sửa nó. */}
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={preset.builtin ? 'alert' : undefined}
                      onClick={() => onEdit(preset.id)}
                      title={
                        preset.builtin
                          ? 'Component trích tự động: chạy lại scripts/extract-presets.ts sẽ GHI ĐÈ mọi thay đổi ở đây. '
                            + 'Muốn giữ thì nhân bản rồi sửa bản sao.'
                          : 'Sửa cây node của component. Thay đổi áp cho MỌI trang đang dùng nó.'
                      }
                      className={cn('ml-auto', preset.builtin && 'text-shell-warn')}
                    >
                      Sửa
                      {/* Icon cảnh báo là hình; tên trợ năng phải nói được điều đó bằng chữ. */}
                      {preset.builtin && <span className="sr-only"> (trích tự động)</span>}
                    </Button>
                  )}
                </span>
                {unused?.id === preset.id && (
                  <UnusedNote
                    key={unused.tick}
                    target={targetNode?.name ?? targetNode?.type ?? 'trang'}
                    disabled={saving}
                    onInsert={() => void insert(preset, true)}
                  />
                )}
              </div>
              );
            })}
          </div>
        ))}

        {/* Không nhắc lệnh pnpm ở đây: server chạy bản standalone, không có
            `scripts/`. Xem docblock trạng thái rỗng ở `builder/components/page.tsx`. */}
        {!presets.length && (
          <p className="px-2 py-4 text-small text-shell-muted">
            Chưa có component nào.{' '}
            <Link href="/builder/components" className="font-semibold text-shell-accent hover:underline">
              Tạo cái đầu tiên
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Lời báo "chưa dùng trên trang này", sau khi bấm tên một component.
 *
 * 22/10/2026 (ảnh user gửi, "nhấn vào comp mà chẳng có gì xảy ra"): bản trước là một dòng
 * chữ `text-muted` cỡ micro nằm DƯỚI hàng nút, canvas không đổi gì — và với mục ở cuối
 * danh sách nó còn rơi khỏi vùng cuộn. Giờ là một khối có nền, tự cuộn vào tầm nhìn, và
 * mang luôn nút Chèn: câu trả lời cho "không có ở đây" là "đặt vào đây".
 *
 * `key={tick}` ở chỗ gọi: bấm lại cùng mục thì khối mount lại, nên effect cuộn chạy lại.
 */
function UnusedNote({
  target,
  disabled,
  onInsert,
}: {
  target: string;
  disabled: boolean;
  onInsert: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div
      ref={ref}
      role="status"
      // Xếp dọc: pane trái hẹp, nút "Chèn vào <tên>" đứng cạnh chữ thì ép chữ thành một cột.
      className="relative z-1 mt-1 flex flex-col items-start gap-1.5 rounded-sm bg-shell-warn-soft px-2 py-1.5 text-mini text-shell-ink"
    >
      <span className="flex items-center gap-1.5 leading-snug">
        <Icon name="alert" size={14} className="shrink-0 text-shell-warn" />
        Chưa dùng trên trang này.
      </span>
      <Button size="sm" icon="plus" disabled={disabled} onClick={onInsert} className="max-w-full">
        <span className="truncate">
          Chèn vào <span className="font-shell-mono">{target}</span>
        </span>
      </Button>
    </div>
  );
}

/* ── Trang ────────────────────────────────────────────────────────────── */

function PageList({
  pages,
  currentPageId,
}: {
  pages: PageSummary[];
  currentPageId: string;
}) {
  return (
    <div className="flex h-full flex-col gap-px overflow-y-auto px-1.5 pb-2">
      {pages.map((page) => {
        const isCurrent = page.id === currentPageId;
        return (
          <Link
            key={page.id}
            href={`/builder/${page.id}`}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'flex items-start gap-2 rounded px-2 py-1.5 transition-colors',
              focusRing,
              isCurrent ? 'bg-shell-accent-soft text-shell-accent' : 'hover:bg-shell-raised',
            )}
          >
            <Icon name="text" size={15} className={cn('mt-0.5', !isCurrent && 'text-shell-muted')} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn('truncate text-small', isCurrent && 'font-semibold')}>{page.title}</span>
              <span className="font-shell-mono truncate text-mini text-shell-muted">/{page.slug}</span>
            </span>
            {page.hasUnpublishedChanges && (
              <Badge tone="warn" size="sm" className="mt-0.5 shrink-0">
                nháp
              </Badge>
            )}
          </Link>
        );
      })}

      {!pages.length && <p className="px-2 py-4 text-small text-shell-muted">Chưa có trang nào.</p>}
    </div>
  );
}
