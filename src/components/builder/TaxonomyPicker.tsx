'use client';

/**
 * Bộ chọn danh mục trong cột phải của màn nhập entry.
 *
 * ## Vì sao tách khỏi `EntrySidebar`
 *
 * Nó là thứ DUY NHẤT trong cột đó có state riêng (chữ trong ô lọc). Để nguyên tại
 * chỗ thì mỗi ký tự gõ vào ô lọc render lại cả cột — kể cả khối SEO và khối Nhật ký
 * vốn không liên quan gì.
 *
 * ## Vì sao KHÔNG đẩy mục đã chọn lên đầu danh sách
 *
 * Đó là yêu cầu ban đầu, và nó sai theo một kiểu chỉ lộ ra khi dùng thật: chip nhảy
 * chỗ ngay dưới ngón tay vừa bấm, nên bấm nhầm hai mục liên tiếp là chuyện thường.
 * Thứ người ta thật sự cần không phải "đã chọn nằm trên" mà là "nhìn một cái biết
 * đang chọn gì" — và một DÒNG TÓM TẮT trả lời đúng câu đó mà không làm gì nhảy.
 *
 * Trật tự chip vì thế cố định theo thứ tự trong cây; viền và nền accent là thứ đánh
 * dấu trạng thái, không phải vị trí.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import {
  SEARCH_THRESHOLD,
  pickerGroups,
  selectedNames,
  type PickerTaxonomy,
} from '@/lib/collections/taxonomy-picker';
import { toggleChip } from './FieldInput';
import { SearchField } from './ui/Field';

export function TaxonomyPicker(props: {
  typeKey: string;
  taxonomies: PickerTaxonomy[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');

  const groups = useMemo(
    () => pickerGroups(props.taxonomies, props.value, q),
    [props.taxonomies, props.value, q],
  );
  const chosen = useMemo(
    () => selectedNames(props.taxonomies, props.value),
    [props.taxonomies, props.value],
  );

  const toggle = (id: string) =>
    props.onChange(
      props.value.includes(id) ? props.value.filter((x) => x !== id) : [...props.value, id],
    );

  const searchable = props.taxonomies.length >= SEARCH_THRESHOLD;

  return (
    <>
      {chosen.length > 0 && (
        <p className="text-small text-shell-muted">
          Đang chọn: <span className="font-medium text-shell-ink">{chosen.join(', ')}</span>
        </p>
      )}

      {searchable && (
        <SearchField
          size="md"
          label="Lọc danh mục"
          placeholder="Lọc danh mục…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}

      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g.label ?? '__flat'} className="flex flex-col gap-1.5">
            {g.label && <p className={ui.eyebrow}>{g.label}</p>}
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={t.selected}
                  onClick={() => toggle(t.id)}
                  className={toggleChip(t.selected)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {props.taxonomies.length === 0 && <p className={ui.hint}>Loại này chưa có danh mục nào.</p>}
      {props.taxonomies.length > 0 && groups.length === 0 && (
        <p className={ui.hint}>Không có mục nào khớp “{q}”.</p>
      )}

      <Link
        href={`/builder/content/${props.typeKey}/taxonomies`}
        className={cn('self-start rounded-sm text-small font-medium text-shell-accent underline-offset-4 hover:underline', focusRing)}
      >
        Quản lý danh mục →
      </Link>
    </>
  );
}
