'use client';

/**
 * "Copy link cho AI" — một chỗ giữ logic, nhiều chỗ đặt nút.
 *
 * ## Vì sao là provider, không phải một hook mỗi nút gọi riêng
 *
 * Nút nằm ở hai nơi (đầu Inspector và thanh `NodeActions`) cộng một phím tắt, và cả ba phải
 * cho CÙNG một kết quả + cùng một thông báo. Mỗi nơi tự dựng thì sẽ có ba bản của một luật,
 * và ba toast chồng nhau khi bấm phím tắt. Provider dựng link MỘT lần, giữ toast MỘT chỗ.
 *
 * Provider ở `EditorShell` vì chỉ đó biết trang/tên trang và component đang sửa; chỗ nào không
 * có provider (ví dụ trình sửa component độc lập, không có trang chủ) thì `useAiLink()` trả
 * `null` và nút tự ẩn — không đặt link trỏ vào một chỗ không có địa chỉ.
 *
 * Phần dựng chuỗi là hàm thuần ở `lib/builder/ai-link.ts` (có test); file này chỉ nối nó với
 * store, clipboard và toast.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildAiLink,
  buildClipboardLine,
  describeTarget,
} from '@/lib/builder/ai-link';
import { copyText } from '@/lib/builder/clipboard';
import type { PresetSummary } from '@/lib/builder/queries';
import { inTextField, matchesShortcut, shortcutById, shortcutText } from '@/lib/builder/shortcuts';
import { useEditor } from '@/lib/builder/store';
import type { ComponentTrees } from '@/lib/builder/text-units';
import type { Doc } from '@/lib/doc/types';

import { Toast, ToastRegion } from './ui/Overlay';

const SHORTCUT = shortcutById('copy-ai-link')!;

export interface AiLinkApi {
  /** Có node đang chọn để trỏ vào. */
  canCopy: boolean;
  copy: () => void;
  /** `Ctrl+Shift+L` — chữ hiện trong tooltip. */
  shortcut: string;
  /** Câu mô tả đích: có mặt khi người dùng bấm vào PHẦN TỬ BÊN TRONG một instance. */
  inner: { label: string; componentName: string } | null;
}

const Ctx = createContext<AiLinkApi | null>(null);

export function useAiLink(): AiLinkApi | null {
  return useContext(Ctx);
}

/** Toast tự tắt sau ngần này ms — đủ đọc một câu, không nằm lì che góc dưới. */
const TOAST_MS = 4000;

type ToastState = { tone: 'ok' | 'danger'; title: string; description?: string };

export function AiLinkProvider({
  doc,
  pageId,
  pageTitle,
  components,
  presets,
  editing,
  children,
}: {
  /** Doc đang hiển thị: doc trang, hoặc cây component khi `editing`. */
  doc: Doc;
  pageId: string;
  pageTitle: string;
  components: ComponentTrees;
  presets: PresetSummary[];
  /** Đang sửa component nào (nếu có). `doc` khi đó là cây của nó. */
  editing: { id: string; name: string } | null;
  children: React.ReactNode;
}) {
  const selectedId = useEditor((s) => s.selectedId);
  const selectedInner = useEditor((s) => s.selectedInner);
  const locale = useEditor((s) => s.locale);

  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = useCallback((t: ToastState) => {
    setToast(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const node = selectedId ? doc.nodes[selectedId] : undefined;
  // Chỉ tin phần tử bên trong khi nó thuộc ĐÚNG instance đang chọn — store xoá nó ở mọi lần
  // chọn khác, nhưng guard này rẻ và chặn link trỏ sai nếu có đường chọn nào quên xoá.
  const innerLocalId =
    !editing && node?.type === 'Instance' && selectedInner?.instanceId === node.id
      ? selectedInner.localId
      : null;

  const description = useMemo(
    () => (node ? describeTarget(doc, node.id, { innerLocalId, components }) : null),
    [doc, node, innerLocalId, components],
  );

  const inner = useMemo(() => {
    if (!innerLocalId || !description?.innerLabel || node?.type !== 'Instance') return null;
    const name = presets.find((p) => p.id === node.componentId)?.name ?? 'component';
    return { label: description.innerLabel, componentName: name };
  }, [innerLocalId, description, node, presets]);

  const copy = useCallback(() => {
    if (!node || !description) return;

    const url = buildAiLink({
      origin: window.location.origin,
      pageId,
      nodeId: node.id,
      innerLocalId,
      componentId: editing?.id ?? null,
      locale,
    });
    const line = buildClipboardLine({
      rootName: editing ? editing.name : pageTitle,
      description,
      url,
    });

    void (async () => {
      try {
        await copyText(line);
        show({
          tone: 'ok',
          title: 'Đã copy — dán vào chat với Claude kèm yêu cầu sửa',
          description: description.label,
        });
      } catch {
        // `copyText` đã thử cả Clipboard API lẫn đường cũ (chạy được ở http). Vẫn hỏng thì đưa chính
        // dòng đó ra để chép tay, thay vì một nút bấm xong chẳng thấy gì.
        show({ tone: 'danger', title: 'Không copy tự động được — chép dòng này:', description: line });
      }
    })();
  }, [node, description, pageId, pageTitle, innerLocalId, editing, locale, show]);

  // `copyRef` để listener chỉ gắn MỘT lần mà vẫn gọi bản `copy` mới nhất.
  const copyRef = useRef(copy);
  copyRef.current = copy;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, SHORTCUT) || inTextField(event.target)) return;
      event.preventDefault();
      copyRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const api = useMemo<AiLinkApi>(
    () => ({ canCopy: Boolean(node), copy, shortcut: shortcutText(SHORTCUT), inner }),
    [node, copy, inner],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {toast && (
        <ToastRegion>
          <Toast
            tone={toast.tone}
            title={toast.title}
            description={
              toast.description ? (
                // `break-words`: dòng chép chứa URL dài không có dấu cách — không ngắt thì
                // tràn ra khỏi toast 22rem.
                <span className="block max-h-24 overflow-y-auto break-words">{toast.description}</span>
              ) : undefined
            }
            onClose={() => setToast(null)}
          />
        </ToastRegion>
      )}
    </Ctx.Provider>
  );
}
