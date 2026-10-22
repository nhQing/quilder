'use client';

/**
 * Màn sửa component có URL riêng.
 *
 * ## Vì sao có nó, khi đã có chế độ sửa trong editor trang
 *
 * Hai đường phục vụ hai việc khác nhau, và cả hai đều nên còn:
 *
 *   trong trang  `/builder/<pageId>?component=<id>` — sửa MỘT chi tiết rồi quay ra
 *                ngay, giữ nguyên mức phóng và node đang chọn của trang. Đó là lý
 *                do nó là một state chứ không phải một route.
 *   riêng        `/builder/components/<id>/edit` — mở đúng một component, chia sẻ
 *                được bằng link, F5 không mất chỗ, và KHÔNG cần một trang nào đang
 *                dùng nó. Trước đây component chưa được chèn ở đâu thì không có
 *                cách nào mở ra sửa.
 *
 * ## Vì sao KHÔNG dựng canvas thứ hai
 *
 * `docs/HANDOFF.md` và docblock của trang chi tiết đều cảnh báo đúng: hai bản của
 * Canvas / Inspector / undo / click-to-select thì bản thứ hai sẽ là bản luôn thiếu
 * tính năng mới. Nên file này KHÔNG cài lại thứ gì — nó chỉ ghép `Canvas`,
 * `LayerTree`, `NodeActions`, `Inspector` và cùng một `useEditor` store. Phần riêng
 * của nó là thanh trên và lượt `init` store.
 *
 * Hệ quả bắt buộc: `dispatch` tự trỏ vào `/api/presets/<id>/ops` nhờ
 * `target.kind === 'component'`. Không có nhánh nào ở đây quyết định việc đó —
 * quyết định ở store, một chỗ, cho cả hai đường.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { useEditor } from '@/lib/builder/store';
import { isTypingTarget } from '@/lib/builder/dom';
import { readFlag, safeStorage, STORAGE_KEYS, write } from '@/lib/builder/persisted';
import type { ComponentTrees } from '@/lib/builder/text-units';
import type { Doc } from '@/lib/doc/types';
import type { EndpointTable } from '@/lib/doc/endpoint-table';
import type { PresetSummary, TokenOption } from '@/lib/builder/queries';
import { Canvas } from './Canvas';
import { ComponentNotice, EditorTopbar } from './EditorTopbar';
import { Inspector } from './Inspector';
import { PaneResizer, useRightPaneWidth } from './PaneResizer';
import { LayerTree } from './LayerTree';
import { NodeActions } from './NodeActions';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/Button';
import { Icon } from './ui/Icon';

export function ComponentEditorShell({
  component,
  doc,
  tokens,
  components,
  presets,
  endpoints,
}: {
  component: { id: string; name: string; key: string; builtin: boolean };
  doc: Doc;
  tokens: TokenOption[];
  components: ComponentTrees;
  presets: PresetSummary[];
  /**
   * Bảng `Site.globals.endpoint`. Bảng của SITE, không theo trang, nên component cũng
   * có: thiếu nó thì một Form trong component báo "site chưa có endpoint nào" dù có.
   */
  endpoints: EndpointTable;
}) {
  const init = useEditor((s) => s.init);
  const candidateDoc = useEditor((s) => s.candidateDoc);
  // `saving` / `lastError` / hai stack undo giờ đọc trong `EditorTopbar` — chỗ duy
  // nhất hiện chúng. Ở đây chỉ còn hai hàm mà phím tắt Ctrl+Z cần gọi.
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  // Trỏ store sang cây component. `kind: 'component'` là thứ khiến `dispatch` ghi
  // vào `/api/presets/<id>/ops` thay vì `/api/ops` — nếu sai, mọi thao tác ở màn
  // này sẽ ghi vào một TRANG.
  useEffect(() => {
    init({ kind: 'component', id: component.id, name: component.name }, doc, null);
    return () => useEditor.getState().reset();
  }, [init, component.id, component.name, doc]);

  const [frameKey, setFrameKey] = useState(0);
  // Iframe render từ server nên phải nạp lại sau mỗi lần lưu. Token đi vào `key`
  // của riêng iframe, KHÔNG phải của `Canvas` — xem mục 3.18 của HANDOFF.
  useEffect(() => { setFrameKey((k) => k + 1); }, [candidateDoc]);

  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // Bề rộng Inspector kéo được (21/10/2026) — xem `PaneResizer`.
  const gridRef = useRef<HTMLDivElement>(null);
  const rightPane = useRightPaneWidth();
  useEffect(() => {
    const stored = readFlag(safeStorage(), STORAGE_KEYS.leftCollapsed);
    if (stored !== null) setLeftCollapsed(stored);
  }, []);
  const toggleLeft = () =>
    setLeftCollapsed((v) => {
      write(safeStorage(), STORAGE_KEYS.leftCollapsed, v ? '0' : '1');
      return !v;
    });

  // Ctrl+Z / Ctrl+Shift+Z. Cùng rào chắn `isTypingTarget` như editor trang: đang
  // gõ trong một ô thì Ctrl+Z thuộc về ô đó, không phải về server.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      void (event.shiftKey ? redo() : undo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const active = candidateDoc ?? doc;

  return (
    /*
     * Cao đúng phần màn còn lại trong khung vỏ — cùng phép tính với `EditorShell`,
     * xem docblock ở đó cho `--shell-nav` và lý do `100svh`.
     */
    <div className="flex h-[calc(100svh_-_var(--shell-nav,3rem))] flex-col gap-3">
      <EditorTopbar
        backHref={`/builder/components/${component.id}`}
        backLabel="Component"
        title={component.name}
        mono={component.key}
      >
        {/*
          KHÔNG có nút Publish ở đây, và đó là chủ ý.

          `publish()` là site-wide, nên một nút Publish trên màn component sẽ đẩy
          cả bản nháp của mọi trang lên site — một hệ quả rộng hơn nhiều so với
          việc người dùng vừa làm ở đây. Nói ra thay vì giấu, vì thay đổi component
          KHÔNG tự lên site: `Release.components` là ảnh chụp (mục 3.10).
        */}
        <span className="max-w-sm text-mini leading-snug text-shell-muted">
          Đã lưu vào bản nháp. Lên site khi bạn publish ở{' '}
          <Link href="/builder" className="font-semibold text-shell-accent hover:underline">
            bảng điều khiển
          </Link>
          .
        </span>
      </EditorTopbar>

      <ComponentNotice>
        {component.builtin && (
          <Badge tone="warn" className="ml-auto" title="Chạy lại scripts/extract-presets.ts sẽ ghi đè mọi thay đổi ở đây.">
            <Icon name="alert" size={14} />
            trích tự động — chạy lại extract-presets là GHI ĐÈ
          </Badge>
        )}
      </ComponentNotice>

      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 gap-3"
        style={{
          ...rightPane.gridVar,
          gridTemplateColumns: `${
            leftCollapsed ? 'var(--shell-left-rail)' : 'var(--shell-left)'
          } 1fr var(--shell-right)`,
        }}
      >
        <aside className={PANE}>
          {/* Không dùng `LeftPanel`: ở đây không có trang nào để liệt kê và không
              được bày đường chèn component vào component. Còn lại là đúng hai thứ
              của pane trái — cây node và thanh thao tác — nên dùng thẳng chúng. */}
          {leftCollapsed ? (
            <div className="flex h-full flex-col items-center gap-1 px-1 py-1.5">
              <IconButton icon="chevron-right" size="sm" label="Mở lại pane trái" onClick={toggleLeft} />
              <span aria-hidden className="my-0.5 h-px w-6 bg-shell-line" />
              <span className="flex w-full flex-col items-center gap-1 py-1.5 text-shell-accent">
                <Icon name="layers" size={17} />
                <span className="text-micro leading-none font-medium">Lớp</span>
              </span>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center gap-2 py-1.5 pr-1.5 pl-3.5">
                <Icon name="layers" size={16} className="text-shell-accent" />
                <h2 className="text-small font-semibold">Lớp</h2>
                <span className="ml-auto text-mini font-medium text-shell-muted tabular-nums">
                  {Object.keys(active.nodes).length}
                </span>
                <IconButton
                  icon="chevron-left"
                  size="sm"
                  label="Thu gọn pane trái"
                  title="Thu gọn pane để canvas rộng thêm"
                  onClick={toggleLeft}
                />
              </div>
              <div className="min-h-0 flex-1">
                <LayerTree doc={active} />
              </div>
              <NodeActions doc={active} />
            </div>
          )}
        </aside>

        <Canvas
          reloadToken={frameKey}
          renderSrc={`/render/component/${component.id}`}
          fitContent
          showDock={false}
          doc={active}
          presets={presets}
        />

        {/* `isolate`: `z-30` của tay kéo chỉ có nghĩa BÊN TRONG Inspector. Thiếu nó thì tay
            kéo đè lên popover của canvas tràn sang vùng này (menu quản lý khổ màn) và nuốt click. */}
        <aside className={cn(PANE, 'relative isolate')}>
          <PaneResizer gridRef={gridRef} width={rightPane.width} onCommit={rightPane.commit} />
          {/* `onEditComponent` vắng mặt: component lồng component bị chặn ở đường
              ghi, nên cũng không bày lối vào nó. */}
          {/* `pageId` null: đang sửa CÂY COMPONENT, không có trang nào để link sang
              bảng Văn bản — bảng đó theo từng trang. Ô sửa chữ vẫn hoạt động, và nó
              ghi vào cây component, tức đổi mọi trang đang dùng — đúng như mong đợi
              khi người dùng chủ động vào chế độ này. */}
          {/* `locales` rỗng: bản dịch theo TỪNG TRANG (`Translation.pageId`), còn
              component là cây dùng chung — không có bản dịch nào để phủ lên nó. */}
          <Inspector
            doc={active}
            tokens={tokens}
            components={components}
            pageId={null}
            locales={[]}
            translations={{}}
            seo={null}
            endpoints={endpoints}
          />
        </aside>
      </div>
    </div>
  );
}

/** Khung pane: panel nổi trên `shell-bg` — cùng hình với pane của `EditorShell`. */
const PANE = cn(ui.panel, 'min-h-0 min-w-0 overflow-hidden');
