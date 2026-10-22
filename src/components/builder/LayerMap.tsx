'use client';

/**
 * Bản đồ lớp override của node đang chọn.
 *
 * ## Câu hỏi nó trả lời
 *
 * *"Node này còn đặt riêng thứ gì ở những khổ màn tôi không đang xem?"*
 *
 * Trước đây không có cách nào biết, ngoài việc bấm qua từng khổ và đọc lại cả bảy
 * nhóm. Hệ quả thật: người ta sửa `font-size` ở Desktop, không hiểu vì sao Mobile
 * không đổi, rồi kết luận builder hỏng — trong khi Mobile có một override đặt từ ba
 * tuần trước. Một dải năm con số ở đầu panel biến việc đó thành một cái nhìn.
 *
 * ## Vì sao chip KHÔNG đổi lớp đang xem
 *
 * Chọn khổ màn nằm ở CANVAS, và chỉ ở đó — bấm vào khung nào thì làm việc ở khổ đó.
 * Hai chỗ chọn cùng một thứ là hai nguồn sự thật, và người dùng sẽ không biết cái nào
 * đang thắng. Nên chip ở đây là ĐỒNG HỒ, không phải công tắc: bấm để xem lớp đó đang
 * đặt gì, và gỡ được từng thứ — chứ không nhảy sang lớp đó.
 *
 * Gỡ tại chỗ là nửa quan trọng của tính năng: thấy một override sai ở lớp mình không
 * đang xem mà phải sang lớp đó mới gỡ được thì cái nhìn không giúp gì.
 */

import { useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { selectSaving, useEditor } from '@/lib/builder/store';
import { ownLayer } from '@/lib/builder/style-resolve';
import { cssLabel } from '@/lib/builder/style-css-map';
import { formatLen } from '@/lib/builder/value-io';
import { BREAKPOINTS, breakpointInfo, type Breakpoint } from '@/lib/design/breakpoints';
import type { Node, StyleProps } from '@/lib/doc/types';

import { IconButton } from './ui/Button';

interface Entry {
  group: string;
  field: string;
  label: string;
  shown: string;
}

/**
 * Lớp `bp` của node đang đặt riêng những gì.
 *
 * Bỏ qua khoá có giá trị `undefined`: một nhóm rỗng (`{ layout: {} }`) vẫn tồn tại
 * trong doc sau khi gỡ hết field của nó, và đếm nó là một override sẽ báo một con số
 * mà bấm vào thì không thấy gì.
 */
function entriesAt(node: Node, bp: Breakpoint): Entry[] {
  const own = ownLayer(node, bp);
  if (!own) return [];

  const out: Entry[] = [];
  for (const [group, values] of Object.entries(own as Record<string, unknown>)) {
    if (!values) continue;
    // `shadow` là một giá trị đơn (token hoặc mảng lớp bóng), không phải bản đồ field.
    if (typeof values !== 'object' || Array.isArray(values)) {
      out.push({ group, field: '', label: group, shown: Array.isArray(values) ? `${values.length} lớp` : String(values) });
      continue;
    }
    for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
      if (value === undefined) continue;
      out.push({
        group,
        field,
        label: cssLabel(group, field),
        shown: formatLen(value) || JSON.stringify(value),
      });
    }
  }
  return out;
}

export function LayerMap({ node, breakpoint }: { node: Node; breakpoint: Breakpoint }) {
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectSaving);
  const [openLayer, setOpenLayer] = useState<Breakpoint | null>(null);

  const byLayer = BREAKPOINTS.map((bp) => ({ bp, entries: entriesAt(node, bp) }));
  const total = byLayer.reduce((n, l) => n + l.entries.length, 0);
  if (!total) return null;

  const shown = openLayer ? byLayer.find((l) => l.bp === openLayer) : null;

  const remove = (entry: Entry, bp: Breakpoint) => {
    void dispatch(
      [
        {
          op: 'setStyle',
          nodeId: node.id,
          target: bp,
          patch: (entry.field
            ? { [entry.group]: { [entry.field]: null } }
            : { [entry.group]: null }) as Partial<StyleProps>,
        },
      ],
      { label: `gỡ ${entry.label} khỏi ${bp}` },
    );
  };

  return (
    <section className="border-b border-shell-line px-3 py-2.5" data-layer-map="">
      <p className={ui.eyebrow}>Lớp override</p>

      <div className="mt-1.5 flex gap-1">
        {byLayer.map(({ bp, entries }) => (
          <button
            key={bp}
            type="button"
            data-layer-chip={bp}
            aria-expanded={openLayer === bp}
            onClick={() => setOpenLayer(openLayer === bp ? null : bp)}
            title={
              entries.length
                ? `${breakpointInfo(bp).label}: ${entries.length} thuộc tính đặt riêng. Bấm để xem và gỡ.`
                : `${breakpointInfo(bp).label}: không đặt riêng gì. Nó kế thừa lớp dưới.`
            }
            className={cn(
              'font-shell-mono flex h-control-sm min-w-0 flex-1 items-center justify-center gap-1 rounded-sm border px-1 text-mini transition-colors',
              focusRing,
              // Lớp ĐANG XEM có viền accent — nối bản đồ này với thứ các ô bên dưới
              // đang ghi vào, nếu không thì hai khối nói về hai chuyện.
              bp === breakpoint ? 'border-shell-accent' : 'border-shell-line',
              openLayer === bp ? 'bg-shell-accent-soft text-shell-accent' : 'hover:bg-shell-raised',
              openLayer !== bp && (entries.length ? 'text-shell-ink' : 'text-shell-muted'),
            )}
          >
            {bp}
            <span className={cn('text-micro font-semibold tabular-nums', !entries.length && 'opacity-40')}>
              {entries.length}
            </span>
          </button>
        ))}
      </div>

      {shown && (
        <div className="mt-2 flex flex-col gap-0.5">
          {shown.entries.length === 0 ? (
            <p className="text-mini leading-snug text-shell-muted">
              Lớp <code className="font-shell-mono">{shown.bp}</code> không đặt riêng gì — node kế thừa từ
              lớp dưới.
            </p>
          ) : (
            shown.entries.map((entry) => (
              <div
                key={`${entry.group}.${entry.field}`}
                className="font-shell-mono flex min-h-control-sm items-center gap-2 rounded-sm bg-shell-raised pl-2 text-mini"
              >
                <span className="truncate text-shell-muted">{entry.label}</span>
                <span className="ml-auto truncate text-shell-ink">{entry.shown}</span>
                <IconButton
                  icon="x"
                  size="sm"
                  className="hover:bg-shell-danger-soft hover:text-shell-danger"
                  disabled={saving}
                  onClick={() => remove(entry, shown.bp)}
                  data-layer-map-remove={`${shown.bp}:${entry.group}.${entry.field}`}
                  label={`Gỡ ${entry.label} khỏi lớp ${shown.bp}`}
                  title={`Gỡ khỏi lớp ${shown.bp}, quay về kế thừa. Undo được.`}
                />
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
