'use client';

/**
 * Dock CHÈN, nổi giữa đáy khung xem trước — hai hành động hay dùng nhất.
 *
 * ## Vì sao đổi tên khỏi `CanvasDock`
 *
 * Wireframe v2 gọi "dock đáy" là một thứ KHÁC HOÀN TOÀN: một dải cố định dưới cùng
 * cửa sổ chứa bảng Văn bản, cảnh báo chất lượng và lớp AI (spec §1 hàng 7). Hai thứ
 * khác nhau cùng tên là cách nhanh nhất để người dựng dock mới sửa sai file — nên
 * file này nhận tên nói đúng việc nó làm (CHÈN component và trang), và tên
 * `BottomDock` để trống cho thứ kia.
 *
 * Đặt ở giữa và cách đáy 5% chứ không nhét vào thanh công cụ trên cùng: đây là
 * những việc bạn làm KHI ĐANG NHÌN canvas, nên tay không phải rời khỏi vùng
 * đang làm việc. Cùng lý do Figma đặt thanh công cụ ở đáy.
 *
 * Dock không chặn thao tác canvas: nền dock nhận sự kiện, phần còn lại của dải
 * để `pointer-events: none` nên kéo và cuộn xuyên qua được.
 */

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { selectSaving, useEditor } from '@/lib/builder/store';
import { focusRing, ui } from '@/lib/builder/ui';
import { presetToOps, type PresetTree } from '@/lib/doc/preset';
import type { Doc } from '@/lib/doc/types';
import type { PresetSummary } from '@/lib/builder/queries';
import { NewPageForm } from './NewPageForm';
import { Button, IconButton } from './ui/Button';
import { SearchField } from './ui/Field';
import { Icon } from './ui/Icon';

type Popover = 'component' | 'page' | null;

export function CanvasInsertDock({ doc, presets }: { doc: Doc; presets: PresetSummary[] }) {
  const [open, setOpen] = useState<Popover>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài hoặc Esc thì đóng.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
      style={{ bottom: '5%' }}
    >
      <div ref={wrapRef} className="pointer-events-auto relative">
        {open === 'component' && (
          <ComponentPopover doc={doc} presets={presets} onDone={() => setOpen(null)} />
        )}
        {open === 'page' && <NewPagePopover onDone={() => setOpen(null)} />}

        <div className="flex items-center gap-1.5 rounded-lg bg-shell-panel p-1.5 shadow-shell-dock">
          <Button
            variant="primary"
            size="md"
            icon="plus"
            aria-expanded={open === 'component'}
            onClick={() => setOpen(open === 'component' ? null : 'component')}
          >
            Thêm component
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon="text"
            aria-expanded={open === 'page'}
            onClick={() => setOpen(open === 'page' ? null : 'page')}
            className={cn(open === 'page' && 'bg-shell-raised')}
          >
            Thêm trang
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Khung popover chung — mở LÊN trên dock, mũi nhọn chỉ xuống dock. Tiêu đề và nút
 * đóng theo `Popover` của design system.
 */
function Panel({
  title,
  onClose,
  children,
  width = 340,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      className={cn(ui.pop, 'absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 flex-col')}
      style={{ width }}
    >
      <div className="flex items-center justify-between gap-2 pt-2.5 pr-2 pl-3">
        <span className="text-ui font-semibold">{title}</span>
        <IconButton icon="x" label="Đóng" size="sm" onClick={onClose} />
      </div>
      {children}
      <span
        aria-hidden
        className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-r border-b border-shell-line bg-shell-panel"
      />
    </div>
  );
}

/* ── Thêm component ───────────────────────────────────────────────────── */

function ComponentPopover({
  doc, presets, onDone,
}: {
  doc: Doc; presets: PresetSummary[]; onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const selectedId = useEditor((s) => s.selectedId);
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectSaving);
  const select = useEditor((s) => s.select);

  // Chèn vào TRONG node đang chọn nếu nó nhận con; nếu không thì chèn vào cha,
  // ngay sau nó. Không chọn gì thì thêm vào cuối trang.
  const target = (() => {
    const node = selectedId ? doc.nodes[selectedId] : null;
    const root = doc.nodes[doc.rootId]!;
    if (!node) return { parentId: doc.rootId, index: root.children.length };
    if (['Section', 'Stack', 'Grid'].includes(node.type)) {
      return { parentId: node.id, index: node.children.length };
    }
    const parent = node.parentId ? doc.nodes[node.parentId] : null;
    if (!parent) return { parentId: doc.rootId, index: root.children.length };
    return { parentId: parent.id, index: (parent.children as string[]).indexOf(node.id) + 1 };
  })();

  const filtered = presets.filter((p) =>
    (p.name + p.aiDescription).toLowerCase().includes(query.toLowerCase()),
  );

  const insert = async (preset: PresetSummary) => {
    const ops = presetToOps(
      preset.tree as PresetTree, target.parentId, target.index,
      new Set(Object.keys(doc.nodes)),
    );
    const ok = await dispatch(ops, { label: `chèn ${preset.name}` });
    if (ok && ops[0]?.op === 'insertNode') select(ops[0].node.id);
    onDone();
  };

  return (
    <Panel title="Thêm component" onClose={onDone}>
      <div className="flex flex-col gap-1.5 px-3 pt-2 pb-2.5">
        <SearchField
          size="md"
          label="Tìm component"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm component…"
        />
        <p className="text-mini text-shell-muted">
          Chèn vào{' '}
          <span className="font-shell-mono text-shell-ink">
            {doc.nodes[target.parentId]?.name ?? doc.nodes[target.parentId]?.type ?? '—'}
          </span>
        </p>
      </div>

      <div className="flex max-h-64 flex-col overflow-y-auto border-t border-shell-line p-1.5">
        {filtered.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={saving}
            onClick={() => void insert(preset)}
            className={cn(
              'flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left hover:bg-shell-raised disabled:cursor-not-allowed disabled:opacity-40',
              focusRing,
            )}
          >
            <Icon name="cube" size={17} className="mt-px text-shell-muted" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-small font-semibold">{preset.name}</span>
                <span className="ml-auto shrink-0 text-mini text-shell-muted tabular-nums">
                  {preset.nodeCount} node
                </span>
              </span>
              <span className="line-clamp-1 text-mini text-shell-muted">{preset.aiDescription}</span>
            </span>
          </button>
        ))}
        {!filtered.length && (
          <p className="px-2.5 py-3 text-small text-shell-muted">Không có component nào khớp.</p>
        )}
      </div>
    </Panel>
  );
}

/* ── Thêm trang ───────────────────────────────────────────────────────── */

/**
 * Chỉ còn phần VỎ. Form đã chuyển sang `NewPageForm` để danh sách trang dùng lại
 * được — xem docblock ở đó: site chưa có trang nào thì dock này không mở được, nên
 * form nằm trọn ở đây nghĩa là không có đường tạo trang đầu tiên.
 */
function NewPagePopover({ onDone }: { onDone: () => void }) {
  return (
    <Panel title="Thêm trang" onClose={onDone} width={320}>
      <NewPageForm onDone={onDone} />
    </Panel>
  );
}

/*
 * ## KHÔNG có ô "Ra lệnh cho AI" ở đây, và đó là quyết định ngày 20/08/2026
 *
 * Từng có một `AiPopover` bị vô hiệu sẵn, kèm ghi chú "Plan 4 sẽ nối". Người dùng
 * gỡ nó: *"chức năng Ra lệnh cho AI đang gần như vô dụng, không ra lệnh được, và
 * nếu sử dụng MCP thì cũng không còn cần thiết"*. Cả hai nửa đều đúng:
 *
 *  - **Vô dụng thì tệ hơn vắng mặt.** Một nút sáng màu accent, đứng ngang hàng với
 *    hai nút chạy thật, mở ra một ô không gửi được — nó tiêu tốn sự chú ý mỗi lần
 *    người dùng nhìn dock, và trả lại con số không.
 *  - **MCP đã là bề mặt AI.** `mcp/server.mjs` + 21 tool cho Agent làm được mọi việc
 *    người dùng làm được trong builder trừ Publish (§3.26). Một ô chat trong builder
 *    sẽ là bề mặt AI THỨ HAI cho cùng bộ tool — hai chỗ phải giữ đồng bộ, và chỗ ít
 *    dùng hơn sẽ trôi.
 *
 * Nếu sau này thật cần chat trong builder: `/api/ai/tool` đã là registry dùng chung
 * ("một lớp, hai vỏ" — xem `src/lib/ai/tools.ts`), nên việc còn lại chỉ là một vỏ
 * vận chuyển. Đừng dựng lại một ô nhập vô hiệu để giữ chỗ.
 */
