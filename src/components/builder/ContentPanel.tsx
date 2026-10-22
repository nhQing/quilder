'use client';

/**
 * Sửa CHỮ ngay trong bảng thuộc tính.
 *
 * ## Vì sao ở đây, và ở trên cùng
 *
 * Với một node `Text`, chữ là thứ người ta muốn sửa TRƯỚC NHẤT. Trước đây muốn đổi
 * một dòng tiêu đề phải rời trang sửa, sang `/builder/text`, tìm hàng của nó trong
 * bảng 60 đơn vị, sửa, rồi quay lại — trong khi node đang được chọn ngay trước mắt.
 *
 * ## Mốc liên kết: KHÔNG có khoá mới nào được sinh ra
 *
 * Ô này ghi vào đúng đơn vị chữ mà bảng Văn bản đang dùng: khoá `nodeId:field`
 * (`unitKey`), và với chữ trong instance thì `instanceId/localId:field`. Sửa ở đây là
 * sửa BẢN GỐC trong doc, nên bảng Văn bản đọc lại y nguyên — không phải sửa hai lần,
 * và không có nguồn sự thật thứ hai.
 *
 * Một hệ quả đúng-theo-thiết-kế: bản dịch của khoá đó có `sourceHash` chụp bản gốc
 * lúc dịch, nên sửa gốc làm vân tay lệch và bảng Văn bản đánh dấu "cần dịch lại".
 * Đó là tính năng — hai bản nói khác nhau mà im lặng thì tệ hơn nhiều.
 *
 * ## Vì sao có đơn vị chỉ ĐỌC
 *
 * `RichText` là cây inline node. Ghi một chuỗi vào cây có link/`split`/nhiều đoạn sẽ
 * san phẳng nó: link mất `href`, hiệu ứng tách chữ mất mục tiêu và chết im lặng. Nên
 * chỉ đơn vị `flat` mới cho sửa; số còn lại hiện chữ đã ghép, kèm lý do.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { selectSaving, useEditor } from '@/lib/builder/store';
import { textWriteOps } from '@/lib/builder/text-write';
import {
  INSTANCE_SEP,
  extractUnits,
  fieldValueKind,
  flatRichText,
  unitKey,
  type ComponentTrees,
  type TextUnit,
} from '@/lib/builder/text-units';
import type { Doc } from '@/lib/doc/types';
import type { DraftTranslation } from '@/lib/i18n/queries';
import { AssetField } from './AssetField';
import { Icon } from './ui/Icon';

/** Chú thích dưới ô chữ: một dòng nhạt, nói ô này ghi vào đâu. */
const HINT = 'text-shell-muted text-micro leading-snug';

/**
 * Đơn vị chữ THUỘC node đang chọn.
 *
 * Gồm cả chữ nằm bên trong node, khi node là một `Instance`: địa chỉ của chúng là
 * `${node.id}/localId`, và với người dùng thì chúng vẫn là chữ của khối đang chọn.
 */
function unitsForNode(doc: Doc, components: ComponentTrees, nodeId: string): TextUnit[] {
  const prefix = `${nodeId}${INSTANCE_SEP}`;
  return extractUnits(doc, components).filter(
    (u) => u.nodeId === nodeId || u.nodeId.startsWith(prefix),
  );
}

/**
 * Op ghi BẢN GỐC của một đơn vị chữ.
 *
 * Tách khỏi `UnitEditor` và export để test được: phần đáng sai ở đây không phải cái
 * `<textarea>` mà là ĐỦ HAY THIẾU đối số đưa xuống `textWriteOps` — và một đối số
 * thiếu trông giống hệt một đối số đủ khi đọc mã. Cùng khuôn với `attachInert` ở
 * `Canvas.tsx`.
 */
export function sourceWriteFor(doc: Doc, unit: TextUnit, text: string) {
  return textWriteOps({
    address: unit.nodeId,
    field: unit.field,
    text,
    /*
     * `href` và `a11yLabel` sống trong object LỒNG, và `setProps` THAY cả object
     * chứ không merge (`applyOne` làm `target[key] = value`). Thiếu `node` thì op
     * vẫn hợp lệ — nó chỉ im lặng xoá `action.target`, `action.rel`, `a11y.role`,
     * `a11y.labelledBy`. Xem `nestedProps` trong `text-write.ts`.
     *
     * Đơn vị nằm trong instance có địa chỉ `instanceId/localId`, không phải khoá
     * của `doc.nodes`, nên tra ra `undefined` — và đó là ĐÚNG: `textWriteOps` rẽ
     * sang `setOverride` trước khi chạm tới `node`. Tra theo `localId` để "chữa"
     * chỗ này sẽ ghi thẳng vào cây component.
     */
    node: doc.nodes[unit.nodeId],
  });
}

export function ContentPanel({
  doc,
  components,
  nodeId,
  pageId,
  translations,
}: {
  doc: Doc;
  components: ComponentTrees;
  nodeId: string;
  /** Để link sang bảng Văn bản mở đúng trang. */
  pageId: string | null;
  /**
   * Bản dịch NHÁP của trang, theo mã ngôn ngữ.
   *
   * Truyền xuống từ server thay vì gọi API ở đây: cùng dữ liệu mà bảng Văn bản
   * đọc, và một lượt đọc thứ hai từ client nghĩa là hai bản có thể lệch nhau
   * trong vài giây sau mỗi lần lưu — đúng khoảng thời gian người ta nhìn vào nó.
   */
  translations: Record<string, DraftTranslation[]>;
}) {
  // `extractUnits` đi cả cây, nên nhớ theo doc — không tính lại mỗi lần gõ một ký tự.
  const units = useMemo(() => unitsForNode(doc, components, nodeId), [doc, components, nodeId]);

  if (!units.length) return null;

  return (
    <section className="flex flex-col gap-1.5 px-3.5" data-content-panel="">
      <div className="flex items-center justify-between gap-2">
        <span className={ui.label}>Nội dung</span>
        {/* Chế độ sửa component thì không có link: bảng Văn bản là theo TRANG. */}
        {pageId && (
          <Link
            href={`/builder/text?page=${pageId}`}
            className={cn(
              'text-shell-accent inline-flex items-center gap-1 rounded-xs text-mini font-medium underline-offset-2 hover:underline',
              focusRing,
            )}
            title="Mở bảng Văn bản — cùng những đơn vị chữ này, kèm các cột bản dịch"
          >
            Bảng chữ
            <Icon name="external" size={12} />
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {units.map((unit) => (
          <UnitEditor
            key={unitKey(unit.nodeId, unit.field)}
            doc={doc}
            unit={unit}
            pageId={pageId}
            rows={translations}
          />
        ))}
      </div>
    </section>
  );
}

/** Bản dịch của đúng một đơn vị, hoặc `undefined`. */
function rowFor(
  rows: Record<string, DraftTranslation[]>,
  locale: string,
  unit: TextUnit,
): DraftTranslation | undefined {
  return rows[locale]?.find((r) => r.nodeId === unit.nodeId && r.field === unit.field);
}

/** Giá trị bản dịch → chuỗi cho ô nhập. Cùng phép đọc với bảng Văn bản. */
function transText(row: DraftTranslation | undefined): string {
  if (!row) return '';
  if (typeof row.value === 'string') return row.value;
  if (Array.isArray(row.value)) {
    const first = row.value[0] as { t?: string; v?: string } | undefined;
    return first?.t === 'text' ? (first.v ?? '') : '';
  }
  return '';
}

function UnitEditor({
  doc,
  unit,
  pageId,
  rows,
}: {
  /** Cần cho `sourceWriteFor`: `href`/`a11yLabel` ghi đè cả object lồng. */
  doc: Doc;
  unit: TextUnit;
  pageId: string | null;
  rows: Record<string, DraftTranslation[]>;
}) {
  const dispatch = useEditor((s) => s.dispatch);
  const router = useRouter();
  const saving = useEditor(selectSaving);
  const locale = useEditor((s) => s.locale);

  const key = unitKey(unit.nodeId, unit.field);
  const row = locale ? rowFor(rows, locale, unit) : undefined;

  /*
   * Giá trị của ô: bản dịch ở chế độ ngôn ngữ, bản gốc ở chế độ bản gốc.
   *
   * Chưa dịch thì để TRỐNG chứ không đổ sẵn bản gốc vào: một ô đã có chữ trông
   * như đã dịch, và người dịch sẽ lướt qua nó. Bản gốc hiện ở `placeholder`.
   */
  const current = locale ? transText(row) : unit.text;

  const [draft, setDraft] = useState(current);

  // Doc hoặc bản dịch đổi từ bên ngoài (undo, AI qua MCP, đổi ngôn ngữ, chọn node
  // khác) thì ô phải theo.
  useEffect(() => setDraft(current), [current, key, locale]);

  const isAsset = fieldValueKind(unit.field) === 'asset';
  // Ở chế độ bản dịch, đơn vị CÓ CẤU TRÚC vẫn không sửa phẳng được — cùng lý do
  // với bản gốc: ghi một chuỗi vào cây inline sẽ san phẳng nó.
  const editable = (unit.flat || isAsset) && !unit.locked;
  const dirty = draft !== current;

  /** Ghi bản GỐC — qua hệ op, undo được. */
  const commitSource = (text: string) => {
    const { ops, label } = sourceWriteFor(doc, unit, text);
    void dispatch(ops, { label });
  };

  /**
   * Ghi bản DỊCH — qua `/api/translations`, KHÔNG qua hệ op.
   *
   * Bản dịch không nằm trong doc (xem model `Translation`), nên nó không có
   * `PageVersion` và không undo được. Đổi lại, gõ lại chuỗi cũ là hoàn nguyên —
   * và rỗng nghĩa là xoá hàng, tức quay về bản gốc.
   */
  const commitTranslation = async (text: string) => {
    if (!pageId || !locale) return;
    const isRich = unit.field === 'content' || unit.field === 'label';
    const value = !text.trim() ? null : isRich ? flatRichText(text) : text;
    await fetch('/api/translations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId, locale, nodeId: unit.nodeId, field: unit.field, value }),
    }).catch(() => {});
    // Bản dịch là dữ liệu SERVER, không nằm trong store — nên canvas và panel chỉ
    // thấy giá trị mới sau một lượt refresh.
    router.refresh();
  };

  const commit = (text?: string) => {
    const next = text ?? draft;
    if (!editable) return;
    if (text === undefined && !dirty) return;
    if (locale) void commitTranslation(next);
    else commitSource(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5 text-micro">
        <span className="font-shell-mono text-shell-muted">{unit.field}</span>
        <span className="text-shell-muted truncate" title={unit.path}>
          · {unit.kind}
        </span>
        {/*
          Mốc liên kết, hiện nguyên văn và CHỌN ĐƯỢC bằng một cú bấm.

          Đây là thứ người ta copy đi dán: vào ô tìm của bảng Văn bản, vào một issue,
          hoặc cho Agent qua MCP (`apply_ops` nhận đúng `nodeId` này). Ẩn nó đi thì
          không có cách nào nói "chữ nào" mà không mô tả bằng lời.
        */}
        <code
          className="bg-shell-raised text-shell-ink font-shell-mono ml-auto shrink-0 rounded-xs px-1.5 text-micro select-all"
          title="Khoá của đơn vị chữ này — bảng Văn bản và MCP đều dùng đúng khoá này"
        >
          {key}
        </code>
      </div>

      {editable && isAsset ? (
        <>
          {/* Ô CHỌN, không phải ô gõ: giá trị là một `cuid`. */}
          <div className="max-w-[9rem]">
            <AssetField
              imageOnly={false}
              value={draft || (locale ? unit.text : null) || null}
              onPick={(id) => {
                setDraft(id ?? '');
                commit(id ?? '');
              }}
            />
          </div>
          <p className={HINT}>
            {locale
              ? draft
                ? 'Bản dịch dùng ảnh riêng. Gỡ ảnh để quay về ảnh bản gốc.'
                : 'Đang theo bản gốc. Chọn ảnh khác để bản này dùng riêng.'
              : 'Sửa ở đây là sửa bản gốc — mọi ngôn ngữ chưa chọn ảnh riêng sẽ theo nó.'}
          </p>
        </>
      ) : editable ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={(e) => {
              // Enter GHI, Shift+Enter xuống dòng: chữ ở đây gần như luôn một dòng
              // (tiêu đề, nhãn nút), nên hành vi hay dùng phải là hành vi mặc định.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') setDraft(current);
            }}
            disabled={saving}
            spellCheck={false}
            rows={2}
            aria-label={locale ? `Bản dịch ${key}` : `Chữ ${key}`}
            // Bản gốc làm gợi ý, KHÔNG đổ sẵn vào ô: một ô đã có chữ trông như đã
            // dịch, và người dịch sẽ lướt qua nó.
            placeholder={locale ? unit.text : undefined}
            className={cn(
              ui.fieldSm,
              'h-auto resize-y py-1.5 leading-snug',
              dirty && 'border-shell-accent',
            )}
          />
          <p className={HINT}>
            {dirty ? (
              <span className="text-shell-accent font-medium">Enter để ghi, Esc để bỏ.</span>
            ) : locale ? (
              'Để trống là dùng lại bản gốc. Bản dịch không undo được bằng Ctrl+Z.'
            ) : (
              'Sửa ở đây là sửa bản gốc. Bản dịch của khoá này sẽ được đánh dấu cần dịch lại.'
            )}
          </p>
        </>
      ) : (
        <>
          <p className="bg-shell-raised text-shell-muted rounded-sm px-2 py-1.5 text-small leading-snug">
            {current || unit.text || <span className="italic">— trống —</span>}
          </p>
          <p className={HINT}>
            {unit.locked
              ? 'Node đang bị khoá. Mở khoá ở khối trên rồi sửa.'
              : 'Chữ có cấu trúc (link, ngắt dòng, tách chữ) — sửa bằng ô một dòng sẽ làm mất cấu trúc đó. Sửa nó bằng op, hoặc gỡ cấu trúc trước.'}
          </p>
        </>
      )}
    </div>
  );
}
