'use client';

/**
 * Panel cho một node Instance.
 *
 * ## Vì sao inspector của instance khác hẳn inspector của node thường
 *
 * Node thường: mọi thuộc tính đều sửa được ở đây. Instance thì không — cấu trúc
 * và style thuộc về component, và chỉ NỘI DUNG là riêng của trang này.
 *
 * Nên panel này bày đúng thứ sửa được, và nói rõ thứ không sửa được nằm ở đâu.
 * Bày một ô "cỡ chữ" rồi để nó không có tác dụng là cách nhanh nhất khiến người
 * dùng mất lòng tin vào cả bảng thuộc tính.
 *
 * ## Vì sao ghi bằng `setOverride` chứ không `setText`
 *
 * `setText` ghi vào node của DOC. Chữ ở đây nằm trong cây COMPONENT, nên ghi
 * bằng `setText` sẽ sửa component — tức là đổi mọi trang đang dùng nó thay vì
 * đổi một chỗ. Đó là lỗi tệ nhất mà panel này có thể gây ra, và nó im lặng.
 */

import { useMemo, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { selectStyleLocked, useEditor } from '@/lib/builder/store';
import { clearOverrideOps } from '@/lib/builder/orphan-overrides';
import { extractUnits, parseInstanceAddress, type TextUnit } from '@/lib/builder/text-units';
import { textWriteOps } from '@/lib/builder/text-write';
import type { ComponentTrees } from '@/lib/builder/text-units';
import type { Doc, Node } from '@/lib/doc/types';
import { Button, ButtonLink } from './ui/Button';
import { Icon } from './ui/Icon';

export function InstancePanel({
  node,
  doc,
  components,
  onEditComponent,
}: {
  node: Extract<Node, { type: 'Instance' }>;
  doc: Doc;
  components: ComponentTrees;
  /** Mở component ngay trong canvas này. Vắng mặt khi đã ở trong chế độ đó. */
  onEditComponent?: (componentId: string) => void;
}) {
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectStyleLocked);
  const [busy, setBusy] = useState<string | null>(null);

  const tree = components.get(node.componentId);

  /**
   * Đơn vị chữ của RIÊNG instance này.
   *
   * Rút từ cả doc rồi lọc, thay vì viết một hàm duyệt thứ hai: hai bản của cùng
   * một quy tắc sẽ trôi khỏi nhau, và thứ trôi mất sẽ là một loại node bị bỏ sót
   * ở đúng một trong hai chỗ.
   */
  const units = useMemo(
    () =>
      extractUnits(doc, components).filter(
        (u) => u.inInstance?.instanceId === node.id,
      ),
    [doc, components, node.id],
  );

  if (!tree) {
    return (
      <div className="bg-shell-danger-soft mx-3.5 my-3 flex gap-2 rounded-md px-3 py-2">
        <Icon name="alert" size={15} className="text-shell-danger mt-0.5" />
        <p className="text-shell-danger text-small leading-snug">
          Component này đã bị xoá khỏi thư viện. Instance không render gì cả — xoá nó, hoặc
          khôi phục component.
        </p>
      </div>
    );
  }

  const save = async (unit: TextUnit, text: string) => {
    const addr = parseInstanceAddress(unit.nodeId);
    if (!addr) return;

    setBusy(unit.nodeId);
    try {
      const value = text.trim() ? text : null;

      if (value === null) {
        // `null` gỡ override → quay về nội dung của component. Đó là cách DUY NHẤT
        // để hoàn nguyên, nên ô rỗng phải có nghĩa đó chứ không phải "đặt chuỗi rỗng".
        await dispatch(
          [{ op: 'setOverride', nodeId: node.id, localId: addr.localId, patch: null }],
          { label: `gỡ ghi đè: ${unit.kind}` },
        );
        return;
      }

      // Dựng op bằng `textWriteOps` — CÙNG hàm mà ô sửa chữ ở bảng thuộc tính dùng.
      // Chọn giữa `setText`/`setProps`/`setOverride` và giữa `RichText`/chuỗi là chỗ
      // sai mà không báo lỗi; một định nghĩa duy nhất thì hai giao diện không lệch.
      const { ops } = textWriteOps({ address: unit.nodeId, field: unit.field, text: value });
      await dispatch(ops, { label: `ghi đè: ${unit.kind}` });
    } finally {
      setBusy(null);
    }
  };

  const overridden = units.filter((u) => !u.fromComponent).length;

  /**
   * Gỡ mọi ghi đè của instance này trong MỘT batch.
   *
   * Một batch, không phải N lần gọi: cả việc là một ý định, nên nó phải là một
   * version trong lịch sử và một lần undo. Gọi N lần sẽ để lại N version mà người
   * đọc sau phải hiểu, và một lần undo chỉ lấy lại được cái cuối.
   *
   * Dùng `clearOverrideOps` — cùng op `setOverride` với `patch: null` mà ô rỗng ở
   * dưới dùng, và cùng op mà AI dùng. Không có đường ghi thứ hai.
   *
   * Trần 80 op của validator: một component có hơn 80 đơn vị chữ là chuyện chưa
   * xảy ra (nhiều nhất hiện tại là 47 node), nhưng nếu tới thì batch bị từ chối
   * sạch và người dùng thấy lỗi — thà thế còn hơn tự chia lô rồi để lại một nửa.
   */
  const clearAll = async () => {
    const targets = units
      .filter((u) => !u.fromComponent)
      .map((u) => parseInstanceAddress(u.nodeId))
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => ({ nodeId: node.id, localId: a.localId }));

    if (!targets.length) return;

    setBusy(node.id);
    try {
      await dispatch(clearOverrideOps(targets), {
        label: `gỡ ${targets.length} ghi đè`,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="flex flex-col gap-2.5 px-3.5 pt-3 pb-3.5">
        <h3 className="text-small font-semibold">Instance</h3>
        {/* Lời nhắc NỀN accent, không phải chữ trần: đây là luật của cả khối — mọi ô
            dưới đây chỉ ghi nội dung riêng — chứ không phải một chú thích của một ô. */}
        <p className="bg-shell-accent-soft text-shell-ink rounded-md px-3 py-2 text-small leading-snug">
          Cấu trúc và style theo <strong className="font-semibold">component</strong>. Sửa component thì mọi trang
          dùng nó đổi theo.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {onEditComponent && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEditComponent(node.componentId)}
              title="Sửa component ngay trong canvas này. Thay đổi áp cho MỌI trang đang dùng nó."
            >
              Sửa component
            </Button>
          )}
          <ButtonLink
            href={`/builder/components/${node.componentId}`}
            variant="ghost"
            size="sm"
            iconRight="arrow-right"
          >
            Trang component
          </ButtonLink>
        </div>
      </section>

      <section className="border-shell-line mx-3.5 flex flex-col gap-2 border-t pt-3 pb-4">
        <div className="flex min-h-control-sm items-center gap-2">
          <h3 className="text-small font-semibold">Nội dung riêng</h3>
          <span
            className="font-shell-mono text-shell-muted text-mini tabular-nums"
            title={`${overridden} trong ${units.length} đơn vị chữ có nội dung riêng ở trang này`}
          >
            {overridden}/{units.length}
          </span>

          {/*
            Gỡ TẤT CẢ trong một lần.

            Gỡ từng field đã có (ô rỗng = `patch: null`), nhưng "trả instance này về
            nguyên bản" là một ý định riêng — làm nó bằng cách xoá tay từng ô là bắt
            người dùng lặp lại một thao tác mà máy đếm được.

            Chỉ hiện khi CÓ override: một nút không làm gì vẫn chiếm chỗ và vẫn phải
            đọc. Cùng nguyên tắc với nút gập contextual của Figma.
          */}
          {overridden > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon="undo"
              disabled={busy !== null}
              onClick={() => void clearAll()}
              title={`Gỡ ${overridden} ghi đè, trả instance về đúng nội dung của component. Undo được.`}
              className="ml-auto"
            >
              Gỡ tất cả
            </Button>
          )}
        </div>

        {!units.length && (
          <p className="text-shell-muted text-small">Component này không có chữ nào.</p>
        )}

        <div className="grid gap-3">
          {units.map((unit) => (
            <OverrideField
              key={unit.nodeId}
              unit={unit}
              busy={busy === unit.nodeId || saving}
              onSave={(text) => void save(unit, text)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function OverrideField({
  unit,
  busy,
  onSave,
}: {
  unit: TextUnit;
  busy: boolean;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(unit.text);
  const dirty = draft !== unit.text;

  if (unit.locked) {
    return (
      <label className="grid gap-1">
        <Head unit={unit} />
        <p
          className={cn(READONLY, 'truncate')}
          title="Node này bị khoá trong component — mở khoá ở đó nếu cần sửa."
        >
          {unit.text || '(rỗng)'}
        </p>
      </label>
    );
  }

  if (!unit.flat) {
    return (
      <label className="grid gap-1">
        <Head unit={unit} />
        {/* Đơn vị có cấu trúc (link, xuống dòng, split) không ghi đè phẳng được:
            ghi một chuỗi ngược vào sẽ san phẳng cây inline. */}
        <p
          className={cn(READONLY, 'leading-snug')}
          title="Có link hoặc hiệu ứng tách chữ bên trong — sửa trong component."
        >
          {unit.text || '(rỗng)'}
        </p>
      </label>
    );
  }

  return (
    <label className="grid gap-1">
      <Head unit={unit} />
      <textarea
        value={draft}
        rows={Math.min(4, Math.max(1, Math.ceil(draft.length / 34)))}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => dirty && onSave(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(unit.text);
          }
        }}
        // Placeholder là chữ của component: ô trống nghĩa là "dùng chữ đó", nên
        // hiện nó ra mới đọc được ý nghĩa của ô trống.
        placeholder={unit.text || '—'}
        className={cn(
          ui.fieldSm,
          'h-auto resize-y py-1.5 leading-snug',
        )}
      />
      {!unit.fromComponent && (
        // Chữ thường đầu câu có chủ đích: e2e tìm nút này bằng `/về chữ của component/`.
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave('')}
          className={cn(
            'text-shell-muted hover:text-shell-danger inline-flex items-center gap-1 justify-self-start rounded-xs text-mini font-medium disabled:cursor-not-allowed disabled:opacity-40',
            focusRing,
          )}
          title="Xoá nội dung riêng, quay về chữ của component"
        >
          <Icon name="arrow-left" size={13} />
          về chữ của component
        </button>
      )}
    </label>
  );
}

/** Ô chỉ đọc: nền lồng `shell-raised`, chữ nhạt — đọc được mà không trông như ô gõ. */
const READONLY = 'bg-shell-raised text-shell-muted rounded-sm px-2 py-1.5 text-small';

function Head({ unit }: { unit: TextUnit }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="bg-shell-raised text-shell-muted font-shell-mono shrink-0 rounded-xs px-1.5 text-micro">
        {unit.kind}
      </span>
      <span className="font-shell-mono text-shell-muted truncate text-mini" title={unit.path}>
        {unit.path.split(' › ').slice(-1)[0]}
      </span>
      {/* Chấm sáng = có nội dung riêng ở trang này. Cùng quy ước với chấm "đặt
          riêng ở màn này" của các control style, nên không phải học thêm gì. */}
      <span
        className={cn(
          'ml-auto size-1.5 shrink-0 rounded-full',
          unit.fromComponent ? 'bg-transparent' : 'bg-shell-accent',
        )}
        title={unit.fromComponent ? 'Đang dùng chữ của component' : 'Có nội dung riêng ở trang này'}
      />
    </span>
  );
}
