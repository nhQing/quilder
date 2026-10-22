'use client';

/**
 * Thanh thao tác cấu trúc, nằm dưới cây node.
 *
 * Mọi nút ở đây phát ra op đi qua đúng `/api/ops` — nên chúng undo được bằng
 * Ctrl+Z như mọi thay đổi khác, và không tồn tại đường ghi tắt nào song song.
 *
 * Node gốc cố tình không xoá/nhân bản/đổi thứ tự được: nó là container của cả
 * trang, và `apply` cũng sẽ ném lỗi. Chặn ở đây để nút mờ đi thay vì bấm rồi
 * nhận một thông điệp lỗi.
 */

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { selectSaving, useEditor } from '@/lib/builder/store';
import { isTypingTarget } from '@/lib/builder/dom';
import { labelOf } from '@/lib/builder/node-label';
import {
  afterRemove,
  duplicateDeep,
  INSERTABLE,
  insertNear,
  reorder,
} from '@/lib/builder/node-actions';
import { focusRing, ui } from '@/lib/builder/ui';
import { isLeafType, type Doc, type NodeType } from '@/lib/doc/types';

import { useAiLink } from './AiLinkProvider';
import { NodeTypeIcon } from './LayerTree';
import { Button, IconButton } from './ui/Button';

export function NodeActions({ doc }: { doc: Doc }) {
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectSaving);
  const aiLink = useAiLink();

  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const node = selectedId ? doc.nodes[selectedId] : null;
  const isRoot = node ? node.id === doc.rootId : false;
  const locked = Boolean(node?.locked);

  // Bấm ra ngoài thì đóng; Esc đóng và trả focus về nút "Thêm" — luật chung của menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuRef.current?.querySelector<HTMLButtonElement>('[data-node-action="add"]')?.focus();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const run = async (
    result: { ops: Parameters<typeof dispatch>[0] } | { error: string },
    label: string,
    thenSelect?: string | null,
  ) => {
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    const ok = await dispatch(result.ops, { label });
    if (ok && thenSelect !== undefined) select(thenSelect);
  };

  const add = (type: NodeType) => {
    setMenuOpen(false);
    const result = insertNear(doc, selectedId, type);
    void run(
      result,
      `thêm ${type}`,
      'newId' in result ? result.newId : undefined,
    );
  };

  const remove = () => {
    if (!node || isRoot) return;
    if (locked) {
      setError('Node bị khoá. Mở khoá trước khi xoá.');
      return;
    }
    const count = countSubtree(doc, node.id);
    const what = count > 1 ? `${count} node (gồm cả node con)` : 'node này';
    if (!confirm(`Xoá ${what}?\n\nHoàn tác được bằng Ctrl+Z.`)) return;

    const next = afterRemove(doc, node.id);
    void run({ ops: [{ op: 'removeNode', nodeId: node.id }] }, 'xoá node', next);
  };

  const duplicate = () => {
    if (!node || isRoot) return;
    const result = duplicateDeep(doc, node.id);
    void run(result, 'nhân bản', 'newId' in result ? result.newId : undefined);
  };

  const move = (delta: -1 | 1) => {
    if (!node || isRoot) return;
    void run(reorder(doc, node.id, delta), delta < 0 ? 'đưa lên' : 'đưa xuống');
  };

  // Phím tắt chỉ chạy khi KHÔNG đang gõ vào ô nhập — nếu không, gõ chữ "d" vào
  // panel CSS sẽ nhân bản node.
  //
  // `onKeyRef` giữ handler mới nhất, để effect chỉ gắn listener MỘT lần. Bản
  // trước bỏ hẳn mảng dependency nhằm luôn thấy state mới, cái giá là gỡ và gắn
  // lại listener sau mỗi lần render.
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;
    if (!selectedId || saving) return;

    if (event.key === 'Delete') {
      event.preventDefault();
      remove();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicate();
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onKeyRef.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const disabled = !node || saving;
  const structural = disabled || isRoot;
  const inside = node ? !isLeafType(node.type) : false;

  return (
    <div className="shrink-0 border-t border-shell-line p-2">
      {error && <p className="mb-1.5 px-1 text-mini leading-snug text-shell-danger">{error}</p>}

      <div className="flex items-center gap-0.5">
        {/* Menu đứng trong CÙNG khung với nút mở nó: e2e tìm mục menu trong cha của
            nút "Thêm", để "Văn bản" không khớp nhầm một hàng cây cùng tên. */}
        <div className="relative" ref={menuRef}>
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            data-node-action="add"
            disabled={disabled}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            title={inside ? 'Thêm vào trong node đang chọn' : 'Thêm ngay sau node đang chọn'}
          >
            Thêm
          </Button>

          {menuOpen && node && (
            // 224px: vừa trong pane trái hẹp nhất (240px) — pane cắt phần tràn ở góc bo.
            <div className={cn(ui.pop, 'absolute bottom-full left-0 z-30 mb-2 flex w-56 flex-col p-1.5')}>
              <p aria-hidden className="truncate px-2.5 pt-1.5 pb-1 text-mini font-semibold text-shell-muted">
                {inside ? 'Thêm vào ' : 'Thêm sau '}
                <span className="font-shell-mono text-shell-ink">{labelOf(node)}</span>
              </p>
              {INSERTABLE.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => add(item.type)}
                  className={cn(ui.menuItem, focusRing, 'items-start py-1.5 text-small')}
                >
                  <NodeTypeIcon type={item.type} size={16} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col">
                    <span>{item.label}</span>
                    <span className="truncate text-mini font-normal text-shell-muted">{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="ml-auto flex items-center gap-0.5">
          {/* Không bị `saving` khoá: chép link không ghi gì lên server. */}
          {aiLink && (
            <IconButton
              icon="link"
              size="sm"
              label={`Copy link cho AI (${aiLink.shortcut}) — dán vào chat với Claude để nó sửa đúng element này`}
              disabled={!aiLink.canCopy}
              onClick={aiLink.copy}
              data-node-action="copy-ai-link"
            />
          )}
          <IconButton
            icon="copy"
            size="sm"
            label="Nhân bản (Ctrl+D)"
            disabled={structural}
            onClick={duplicate}
            data-node-action="duplicate"
          />
          <IconButton
            icon="arrow-up"
            size="sm"
            label="Đưa lên"
            disabled={structural}
            onClick={() => move(-1)}
            data-node-action="up"
          />
          <IconButton
            icon="arrow-down"
            size="sm"
            label="Đưa xuống"
            disabled={structural}
            onClick={() => move(1)}
            data-node-action="down"
          />
          {/*
            `data-node-action` là hook ổn định cho e2e. Cần nó vì tên hiển thị KHÔNG ổn
            định: nút xoá đổi nhãn thành "Node bị khoá" khi node bị khoá, nên test phải
            bắt bằng `/^Xoá/` — và từ khi mỗi hàng cây có nút xoá riêng ("Xoá <tên
            node>"), regex đó khớp ba phần tử và test đỏ vì locator, không vì hành vi.
          */}
          <IconButton
            icon="trash"
            size="sm"
            variant="danger"
            label={locked ? 'Node bị khoá' : 'Xoá (phím Delete)'}
            disabled={structural || locked}
            onClick={remove}
            data-node-action="remove"
          />
        </span>
      </div>
    </div>
  );
}

function countSubtree(doc: Doc, id: string): number {
  let n = 0;
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    const node = doc.nodes[current];
    if (!node) continue;
    n += 1;
    stack.push(...node.children);
  }
  return n;
}
