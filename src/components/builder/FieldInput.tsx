'use client';

/**
 * Một field → một control. ĐỆ QUY cho `group` và `blocks`.
 *
 * ## Vì sao component này không giữ state
 *
 * Mọi thay đổi đi lên `EntryForm` qua `onChange(path, value)`. Nếu mỗi tầng giữ
 * state riêng thì có N bản của một sự thật, và thao tác "đổi thứ tự khối" ở tầng
 * trên phải đồng bộ lại state của mọi tầng dưới — thứ sẽ sai ở đúng lần đầu có ai
 * đổi thứ tự sau khi gõ.
 *
 * ## `depth` để làm gì
 *
 * Chỉ để bố cục: tầng 1 là một khối nền `shell-raised`, từ tầng 2 trở đi chỉ còn một
 * vạch trái — nếu không ba tầng lồng nhau tạo ra ba khung trong khung và ô nhập cùng
 * thì chỉ còn nửa chiều rộng. Chặn độ sâu là việc của `validateCollectionSchema`,
 * không phải của render.
 *
 * ## Vì sao KHÔNG dùng `controls.tsx` và KHÔNG dùng `NodeAssetPicker`
 *
 * Cả hai gắn cứng vào một Node của doc và vào store của editor (`useEditor`,
 * `dispatch` một op). Ở đây không có node và không có doc — chỉ có một đường dẫn
 * trong JSON của entry. Dùng lại chúng là kéo cả editor store vào màn nhập nội
 * dung. Ô nhập ở đây dựng bằng công thức `ui.field` của design system.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import type { FieldDef, GroupTable } from '@/lib/collections/field-def';
import { emptyBlock, emptyEntry, type FormPath } from '@/lib/collections/form-state';
import { ArticleField } from './ArticleField';
import { AssetField } from './AssetField';
import { SeoFieldInput, type SeoContext } from './SeoFieldInput';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Checkbox } from './ui/Field';
import { Icon } from './ui/Icon';
import { Note } from './ui/Note';

export interface FieldInputProps {
  field: FieldDef;
  path: FormPath;
  value: unknown;
  groups: GroupTable;
  taxonomies: { id: string; key: string; name: string; parentId: string | null }[];
  depth: number;
  onChange: (path: FormPath, value: unknown) => void;
  onAppend: (path: FormPath, item: unknown) => void;
  onRemove: (path: FormPath, index: number) => void;
  onMove: (path: FormPath, index: number, dir: -1 | 1) => void;
  /** Ô cao 36px thay vì 44px — cho field nằm trong thẻ hẹp ở cột phải. */
  compact?: boolean;
  /** Ngữ cảnh xem trước cho field `seo` — chỉ form bài truyền, xem `SeoFieldInput`. */
  seo?: SeoContext;
}

/* ── Phần trình bày dùng chung với các file khác của màn nhập ─────────── */

/**
 * Chip bật/tắt (danh mục, bài liên quan). Là CÔNG TẮC, không phải nút — xem ranh giới
 * ở `lib/builder/btn.ts` — nên trạng thái bật là viền + nền accent, không phải một bậc nút.
 */
export function toggleChip(on: boolean): string {
  return cn(
    'rounded px-2.5 py-1 text-left text-mini font-medium ring-1 ring-inset transition-colors',
    focusRing,
    on
      ? 'bg-shell-accent-soft text-shell-accent ring-shell-accent'
      : 'bg-shell-panel text-shell-muted ring-shell-line hover:bg-shell-raised hover:text-shell-ink',
  );
}

/* ── Khung trình bày ──────────────────────────────────────────────────── */

/**
 * Nhãn THẬT (`<label for>`), không phải một `<span>` trông giống nhãn.
 *
 * Hai thứ phụ thuộc vào nó: trình đọc màn hình, và mọi selector `getByLabel` của
 * e2e. Một span thì cả hai đều không thấy gì, và test phải nhắm vào class hoặc
 * thứ tự DOM — loại selector vỡ ở lần đổi bố cục đầu tiên. Nhánh không có control
 * đơn (`html`, `richdoc`, ảnh) không có gì để `for` trỏ vào, nên ở đó là chữ trơn.
 *
 * Khoá field đứng NGOÀI nhãn: nó là chữ cho người dựng loại nội dung, không thuộc
 * tên của ô — trình đọc màn hình đọc "Tiêu đề title" là đọc thừa.
 *
 * ## Dấu sao là TRANG TRÍ, và phải nằm ngoài cây trợ năng
 *
 * `*` nằm trong `<label>` nên nó thuộc TÊN của ô: trình đọc màn hình đọc "Tiêu đề
 * sao" — một câu không có nghĩa với người nghe, và thông tin thật ("bắt buộc") thì
 * không được nói ra ở đâu cả.
 *
 * Nên `aria-hidden` cho dấu sao, và một chữ chỉ-đọc-được-bằng-máy đi kèm. Chọn cách
 * này thay vì `aria-required` trên control: nhiều nhánh field ở đây là editor phức
 * hợp (`richdoc`, `html`, `image`, `link`) không có một control đơn nào để gắn state
 * ARIA vào, nên `aria-required` sẽ phủ được một nửa số field và im lặng bỏ nửa còn
 * lại. Chữ trong nhãn thì đúng cho mọi nhánh, và chỉ có một chỗ để sai.
 *
 * Chú thích (`help`) đứng DƯỚI ô, như mọi ô nhập của design system.
 */
function Field({
  label,
  keyName,
  required,
  help,
  htmlFor,
  children,
}: {
  label: string;
  keyName: string;
  required?: boolean;
  help?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const text = (
    <>
      {label}
      {required && (
        <>
          <span aria-hidden="true" className="text-shell-danger"> *</span>
          <span className="sr-only"> (bắt buộc)</span>
        </>
      )}
    </>
  );
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={ui.label}>
            {text}
          </label>
        ) : (
          <span className={ui.label}>{text}</span>
        )}
        <span className="font-shell-mono text-micro text-shell-muted">{keyName}</span>
      </div>
      {children}
      {help && (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className={ui.hint}>
          {help}
        </p>
      )}
    </div>
  );
}

/** `aria-describedby` trỏ vào chú thích của `Field`, khi field có chú thích. */
function hintOf(id: string, help: string | undefined): string | undefined {
  return help ? `${id}-hint` : undefined;
}

/** `<select>` gốc trong khung ô nhập, mũi tên vẽ bằng icon. */
function SelectBox({
  compact,
  className,
  children,
  ...rest
}: { compact?: boolean } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative flex min-w-0 items-center">
      <select
        {...rest}
        className={cn(compact ? ui.fieldMd : ui.field, 'cursor-pointer appearance-none pr-10', className)}
      >
        {children}
      </select>
      <Icon name="chevron-down" size={16} className="pointer-events-none absolute right-3 text-shell-muted" />
    </div>
  );
}

function Nest({
  label, keyName, depth, children,
}: {
  label: string; keyName: string; depth: number; children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-4',
        depth >= 2 ? 'border-l-2 border-shell-line pl-4' : 'rounded-lg bg-shell-raised p-4',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-ui font-semibold">{label}</h3>
        <span className="font-shell-mono text-micro text-shell-muted">{keyName}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * Danh sách mục lặp — dùng cho CẢ nhóm lặp và Dynamic Zone.
 *
 * Một khung cho hai thứ, khác nhau đúng ở `badgeOf`: nhóm lặp trả null (mọi mục
 * cùng bộ field), Dynamic Zone trả khoá loại khối. Đó là thứ duy nhất phân biệt
 * hai danh sách trông y như nhau, nên nó là tham số chứ không phải một biến thể
 * chép ra thành component thứ hai.
 *
 * Tay cầm ở đầu hàng là dấu hiệu "hàng này đổi chỗ được"; việc đổi chỗ đi qua hai
 * nút Lên/Xuống, vì chúng bấm được bằng bàn phím và không cần thư viện kéo-thả.
 */
function RepeatList(props: {
  label: string;
  keyName: string;
  depth: number;
  counter: string;
  items: unknown[];
  badgeOf: (item: unknown) => string | null;
  titleOf: (item: unknown) => string;
  addLabel: string;
  onAdd?: (() => void) | null;
  addChoices?: { key: string; label: string; onPick: () => void }[];
  onRemove: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  renderItem: (item: unknown, i: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set([0]));
  const [menu, setMenu] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);

  // Bộ chọn khối đóng khi bấm ra ngoài hoặc Esc — cùng luật với `MenuButton` của `ui/`.
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!menuRoot.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  function toggle(i: number) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  /*
   * `open` giữ CHỈ SỐ, nên mọi thao tác đổi thứ tự phải mang trạng thái mở đi theo.
   *
   * Không mang thì trạng thái mở dính vào Ô chứ không dính vào MỤC: người dùng mở
   * mục A, bấm Xuống, và mục B bỗng mở ra trong khi A gập lại — nội dung đang gõ biến
   * khỏi màn hình mà không có gì giải thích.
   *
   * Cách khác là khoá theo danh tính thay vì chỉ số, nhưng item của Dynamic Zone là
   * object thuần từ JSONB và không có id ổn định nào để khoá vào. Remap ở đây là
   * đúng chỗ: chỉ hai hàm này đổi thứ tự.
   */
  function moveAt(i: number, dir: -1 | 1) {
    const j = i + dir;
    setOpen((s) => {
      const next = new Set(s);
      const hadI = s.has(i);
      const hadJ = s.has(j);
      if (hadJ) next.add(i);
      else next.delete(i);
      if (hadI) next.add(j);
      else next.delete(j);
      return next;
    });
    props.onMove(i, dir);
  }

  /**
   * Thêm một mục, và MỞ nó ra.
   *
   * Người ta bấm "Thêm" vì muốn gõ vào mục mới. Thêm ra một mục gập lại là bắt họ
   * bấm lần thứ hai cho cùng một ý định — và mục mới thì tiêu đề trống, nên hàng
   * gập ấy không nói được nó là cái gì.
   *
   * `props.items.length` LÀ chỉ số mục mới sẽ nhận: nó được đọc trước khi
   * `props.onAdd()` làm mảng dài thêm, nên đây là chỉ số đúng chứ không phải trùng
   * hợp. Không đóng các mục khác: người dùng có thể đang mở hai mục để đối chiếu.
   */
  function addAndOpen(add: () => void) {
    setOpen((s) => new Set(s).add(props.items.length));
    add();
  }

  /** Xoá mục `i`: mọi chỉ số sau nó tụt một bậc, nên tập `open` phải tụt theo. */
  function removeAt(i: number) {
    setOpen((s) => {
      const next = new Set<number>();
      for (const k of s) {
        if (k === i) continue;
        next.add(k > i ? k - 1 : k);
      }
      return next;
    });
    props.onRemove(i);
  }

  return (
    <section
      className={cn('flex min-w-0 flex-col gap-2.5', props.depth >= 2 && 'border-l-2 border-shell-line pl-4')}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className={ui.label}>{props.label}</h3>
        <span className="font-shell-mono text-micro text-shell-muted">{props.keyName}</span>
        <span className="ml-auto text-mini text-shell-muted tabular-nums">{props.counter}</span>
      </div>

      <div className="flex flex-col gap-2">
        {props.items.map((item, i) => {
          const badge = props.badgeOf(item);
          const isOpen = open.has(i);
          return (
            <div
              key={i}
              className={cn('min-w-0 rounded-lg', props.depth >= 2 ? 'bg-shell-panel ring-1 ring-shell-line' : 'bg-shell-raised')}
            >
              <div className="flex min-w-0 items-center gap-1.5 py-1.5 pr-1.5 pl-3">
                <Icon name="drag" size={16} className="text-shell-muted" />
                <IconButton
                  size="sm"
                  icon={isOpen ? 'chevron-down' : 'chevron-right'}
                  label={isOpen ? 'Đóng mục' : 'Mở mục'}
                  aria-expanded={isOpen}
                  onClick={() => toggle(i)}
                />
                {badge && (
                  <Badge tone="accent" size="sm" className="font-shell-mono">
                    {badge}
                  </Badge>
                )}
                <span className="min-w-0 flex-1 truncate text-small">{props.titleOf(item)}</span>
                <IconButton size="sm" icon="arrow-up" label="Lên" onClick={() => moveAt(i, -1)} disabled={i === 0} />
                <IconButton
                  size="sm"
                  icon="arrow-down"
                  label="Xuống"
                  onClick={() => moveAt(i, 1)}
                  disabled={i === props.items.length - 1}
                />
                <IconButton
                  size="sm"
                  icon="trash"
                  label="Xoá"
                  onClick={() => removeAt(i)}
                  className="hover:bg-shell-danger-soft hover:text-shell-danger"
                />
              </div>
              {isOpen && <div className="flex min-w-0 flex-col gap-4 px-4 pt-1 pb-4">{props.renderItem(item, i)}</div>}
            </div>
          );
        })}

        {props.items.length === 0 && (
          <p className="rounded-lg border border-dashed border-shell-line px-4 py-3 text-small text-shell-muted">
            Chưa có mục nào.
          </p>
        )}
      </div>

      {/* Bộ chọn khối chỉ liệt kê `allowed`: người nhập tự do xếp thứ tự và số
          lượng, nhưng không tạo ra loại khối mà không có ai dựng hình cho nó. */}
      {props.addChoices ? (
        props.addChoices.length > 0 && (
          <div ref={menuRoot} className="relative self-start">
            <Button
              variant="secondary"
              size="md"
              icon="plus"
              iconRight="chevron-down"
              aria-haspopup="true"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              {props.addLabel}
            </Button>
            {menu && (
              <div className={cn(ui.pop, 'absolute top-full left-0 z-30 mt-1 flex min-w-56 flex-col p-1.5')}>
                <p className={cn(ui.eyebrow, 'px-2.5 pt-1.5 pb-1')}>Loại khối</p>
                {props.addChoices.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      addAndOpen(c.onPick);
                      setMenu(false);
                    }}
                    className={cn(ui.menuItem, 'font-shell-mono text-small', focusRing)}
                  >
                    <Icon name="layers" size={16} className="text-shell-muted" />
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      ) : props.onAdd ? (
        <Button
          variant="secondary"
          size="md"
          icon="plus"
          className="self-start"
          onClick={() => addAndOpen(props.onAdd!)}
        >
          {props.addLabel}
        </Button>
      ) : (
        <p className={ui.hint}>Đã đạt số mục tối đa.</p>
      )}
    </section>
  );
}

/* ── Bộ chọn entry cho field `relation` ───────────────────────────────── */

interface RelationOption {
  id: string;
  title: string;
  slug: string;
}

/** Số gợi ý hiện một lần. Nhiều hơn thì người ta gõ để tìm, không cuộn. */
const RELATION_SUGGESTIONS = 8;

/**
 * Bộ chọn entry: danh sách ĐÃ CHỌN + ô tìm có vài gợi ý.
 *
 * ## Vì sao không bày hết entry thành nút bật/tắt nữa (21/10/2026)
 *
 * Bản trước nạp tới 100 entry rồi vẽ mỗi entry một nút. Với loại có hàng nghìn bài, ô
 * "Tin liên quan" thành một bức tường kéo dài vô tận, còn bài đã chọn mà nằm ngoài 100 bài
 * sửa gần nhất thì không hiện tên — trông như chưa chọn gì, và bấm lưu là giữ một id không
 * ai thấy. Giờ: tên của bài đã chọn tra riêng theo id (`?ids=`), gợi ý chỉ
 * `RELATION_SUGGESTIONS` bài, gõ thì tìm trên server (`?q=`).
 */
function RelationField({
  id, typeKey, cardinality, value, onChange, compact,
}: {
  id: string;
  typeKey: string;
  cardinality: 'one' | 'many';
  value: unknown;
  onChange: (v: unknown) => void;
  compact?: boolean;
}) {
  const picked =
    cardinality === 'one'
      ? typeof value === 'string' && value
        ? [value]
        : []
      : Array.isArray(value)
        ? (value as string[])
        : [];
  const [known, setKnown] = useState<Record<string, RelationOption | null>>({});
  const [q, setQ] = useState('');
  const [results, setResults] = useState<RelationOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (params: string): Promise<RelationOption[]> => {
      const res = await fetch(`/api/collections/${typeKey}/entries?${params}`);
      const json = (await res.json()) as { ok?: boolean; entries?: RelationOption[]; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Lỗi ${res.status}`);
      return json.entries ?? [];
    },
    [typeKey],
  );

  // Tên của bài đã chọn mà chưa biết — tra theo id, không phụ thuộc trang gợi ý.
  const missing = picked.filter((x) => !(x in known));
  const missingKey = missing.join(',');
  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    load(`ids=${encodeURIComponent(missingKey)}`)
      .then((rows) => {
        if (!alive) return;
        const found = new Map(rows.map((r) => [r.id, r]));
        setKnown((k) => ({
          ...k,
          // `null` = id không còn (bài đã xoá hẳn) — vẫn hiện để gỡ được.
          ...Object.fromEntries(missingKey.split(',').map((x) => [x, found.get(x) ?? null])),
        }));
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [missingKey, load]);

  // Gợi ý: bài sửa gần nhất, hoặc kết quả tìm. Gõ thì chờ một nhịp rồi mới hỏi server.
  useEffect(() => {
    let alive = true;
    const term = q.trim();
    const timer = setTimeout(() => {
      load(`limit=${RELATION_SUGGESTIONS + picked.length}${term ? `&q=${encodeURIComponent(term)}` : ''}`)
        .then((rows) => {
          if (!alive) return;
          setResults(rows);
          setKnown((k) => ({ ...k, ...Object.fromEntries(rows.map((r) => [r.id, r])) }));
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    }, term ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `picked.length` chỉ để nới trần đủ chỗ cho bài đã chọn bị lọc khỏi gợi ý.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, load]);

  const add = (r: RelationOption) => onChange(cardinality === 'one' ? r.id : [...picked, r.id]);
  const remove = (x: string) => onChange(cardinality === 'one' ? null : picked.filter((p) => p !== x));
  const suggestions = (results ?? []).filter((r) => !picked.includes(r.id)).slice(0, RELATION_SUGGESTIONS);
  const box = compact ? ui.fieldMd : ui.field;

  return (
    <div className="flex flex-col gap-2" data-relation-field={typeKey}>
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Đã chọn">
          {picked.map((x) => {
            const r = known[x];
            const title = r === undefined ? '…' : r === null ? '[không còn bài này]' : r.title;
            return (
              <li key={x} className={cn(toggleChip(true), 'inline-flex items-center gap-1 pr-1')}>
                <span className="max-w-[16rem] truncate" title={title}>
                  {title}
                </span>
                <button
                  type="button"
                  aria-label={`Bỏ ${title}`}
                  title="Bỏ"
                  onClick={() => remove(x)}
                  className="grid size-5 place-items-center rounded-xs hover:bg-shell-raised"
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(cardinality === 'many' || picked.length === 0) && (
        <>
          <input
            id={id}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo tiêu đề…"
            autoComplete="off"
            className={box}
          />
          {error ? (
            <p className={ui.error}>{error}</p>
          ) : results === null ? (
            <p className={ui.hint}>Đang nạp…</p>
          ) : suggestions.length === 0 ? (
            <p className={ui.hint}>{q.trim() ? 'Không có bài nào khớp.' : 'Chưa có mục nào để liên kết.'}</p>
          ) : (
            <>
              <ul className="flex flex-col" aria-label="Gợi ý">
                {suggestions.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => add(r)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-small hover:bg-shell-raised"
                    >
                      <Icon name="plus" size={14} className="shrink-0 text-shell-muted" />
                      <span className="min-w-0 truncate">{r.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!q.trim() && <p className={ui.hint}>Bài sửa gần nhất — gõ để tìm bài khác.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── RichText ─────────────────────────────────────────────────────────── */

interface InlineText {
  t: 'text';
  v: string;
}

/**
 * Chỉ sửa được RichText PHẲNG — cùng luật với bảng Văn bản.
 *
 * Một `RichText` là cây inline node: có `link`, `split`, `counter`, `strong`. Ghi
 * một chuỗi vào cây đó sẽ SAN PHẲNG nó và làm mất link cùng mọi cấu trúc, im
 * lặng. Nên ở đây: phẳng thì sửa được, có cấu trúc thì chỉ đọc kèm một câu nói rõ
 * sửa ở đâu. Thà không sửa được còn hơn sửa xong mất dữ liệu.
 */
function isFlatRich(v: unknown): v is InlineText[] {
  return (
    Array.isArray(v) &&
    v.every((n) => typeof n === 'object' && n !== null && (n as { t?: unknown }).t === 'text')
  );
}

function RichTextField({
  id, describedBy, value, onChange,
}: { id?: string; describedBy?: string; value: unknown; onChange: (v: unknown) => void }) {
  if (!isFlatRich(value)) {
    return (
      <Note tone="warn">
        Đoạn này có cấu trúc (link, chữ đậm, số đếm…). Sửa ở đây sẽ san phẳng và làm mất
        cấu trúc, nên ô để chỉ đọc. Sửa trong bảng Văn bản hoặc bằng op.
      </Note>
    );
  }

  const text = value.map((n) => n.v).join('\n');
  return (
    <textarea
      id={id}
      rows={8}
      aria-describedby={describedBy}
      value={text}
      onChange={(e) =>
        // Mỗi dòng một node text: giữ được đoạn khi đọc lại, và không sinh ra
        // node rỗng cho một ô chưa gõ gì.
        onChange(
          e.target.value === ''
            ? [{ t: 'text', v: '' }]
            : e.target.value.split('\n').map((v) => ({ t: 'text', v })),
        )
      }
      className={cn(ui.field, ui.textarea)}
    />
  );
}

/* ── FieldInput ───────────────────────────────────────────────────────── */

export function FieldInput(p: FieldInputProps) {
  const { field: f, path, value } = p;
  const set = (v: unknown) => p.onChange(path, v);
  // Id dựng từ `path`, nên hai ô "Tiêu đề" của mục 1 và mục 2 trong một nhóm lặp
  // có hai id khác nhau — nếu dùng `f.key` thì mọi mục dùng chung một id và nhãn
  // nào cũng trỏ về ô đầu tiên.
  const id = `f-${path.join('-')}`;
  const box = p.compact ? ui.fieldMd : ui.field;

  switch (f.t) {
    case 'text':
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help} htmlFor={id}>
          {f.multiline ? (
            <textarea
              id={id}
              rows={3}
              maxLength={f.maxLength}
              aria-describedby={hintOf(id, f.help)}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => set(e.target.value)}
              className={cn(box, ui.textarea)}
            />
          ) : (
            <input
              id={id}
              maxLength={f.maxLength}
              aria-describedby={hintOf(id, f.help)}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => set(e.target.value)}
              className={box}
            />
          )}
        </Field>
      );

    case 'slug':
      // Ô slug là chỉ đọc theo mặc định. Nút "Sửa tay" nằm ở `EntryForm` vì nó
      // phải tắt cả cơ chế tự sinh từ tiêu đề — một nút ở đây chỉ mở được ô này.
      return (
        <Field label={f.label} keyName={f.key} help={f.help} htmlFor={id}>
          <input
            id={id}
            readOnly
            value={typeof value === 'string' ? value : ''}
            className={cn(box, 'font-shell-mono bg-shell-raised text-shell-muted')}
          />
          <p className={ui.hint}>
            Suy từ “{f.from}”. Đổi đường dẫn của bài đã đăng làm mất thứ hạng tìm kiếm của
            đường dẫn cũ.
          </p>
        </Field>
      );

    case 'richtext':
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help} htmlFor={id}>
          <RichTextField id={id} describedBy={hintOf(id, f.help)} value={value} onChange={set} />
        </Field>
      );

    /*
     * `html` — cùng lý do KHÔNG có `htmlFor` như `richdoc` ngay dưới: ô soạn là một
     * `div[contenteditable]` do CKEditor dựng, không phải một form control.
     */
    case 'html':
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help}>
          <ArticleField
            value={value}
            onChange={set}
            maxChars={f.maxChars}
          />
        </Field>
      );

    /*
     * `richdoc` giờ là kiểu CHỈ ĐỌC. Không có ô soạn nào cho nó nữa.
     *
     * ## Vì sao chỉ đọc thay vì gỡ hẳn
     *
     * Ô soạn của `richdoc` dựng trên Tiptap, và Tiptap đã được gỡ khỏi repo ngày
     * 04/09/2026 — một dự án không nên gánh hai bộ soạn thảo. Nhưng ĐỊNH DẠNG
     * `richdoc` thì không gỡ theo được cùng lúc: `zRichDoc`, `RichDocView`,
     * `richDocToHtml` (đường `?format=html` của API công khai) và
     * `scripts/richdoc-to-html.ts` đều đứng trên nó, và `scripts/richdoc-to-html.ts`
     * là ĐƯỜNG RA duy nhất cho dữ liệu cũ. Gỡ định dạng trước khi mọi hàng đã chuyển
     * là khoá dữ liệu lại trong một tệp không ai đọc được.
     *
     * Đo ngày 04/09/2026: KHÔNG loại nội dung nào còn field `richdoc` (news, faq và
     * api-hop-dong đều dùng `richtext`), nên nhánh này hiện không có người dùng thật.
     * Nó tồn tại cho trường hợp một database khác — staging, production — còn hàng cũ.
     *
     * `richdoc` cũng đã bị gỡ khỏi bộ chọn kiểu ở `SchemaEditor`, nên không tạo mới
     * được. Nhánh này chỉ gặp field đã có từ trước.
     */
    case 'richdoc': {
      const doc = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help}>
          <Note tone="warn">
            <p className="font-semibold">
              Kiểu <code className="font-shell-mono">richdoc</code> không còn ô soạn — nội dung dưới đây là CHỈ ĐỌC.
            </p>
            <p>
              Chuyển field này sang kiểu <code className="font-shell-mono">html</code> (ô soạn CKEditor) bằng{' '}
              <code className="font-shell-mono">
                tsx scripts/richdoc-to-html.ts &lt;typeKey&gt; {f.key} --ghi
              </code>
              . Script chuyển dữ liệu TRƯỚC rồi mới đổi kiểu field, trong một transaction.
            </p>
            {doc.length > 0 && (
              <pre className="font-shell-mono max-h-64 overflow-auto rounded-md bg-shell-panel p-3 text-micro text-shell-ink">
                {JSON.stringify(doc, null, 2)}
              </pre>
            )}
          </Note>
        </Field>
      );
    }

    case 'number':
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help} htmlFor={id}>
          <input
            id={id}
            type="number"
            min={f.min}
            max={f.max}
            aria-describedby={hintOf(id, f.help)}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}
            className={cn(box, 'tabular-nums')}
          />
        </Field>
      );

    case 'boolean':
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <Checkbox
              id={id}
              checked={value === true}
              onChange={(e) => set(e.target.checked)}
              label={f.label}
              aria-describedby={hintOf(id, f.help)}
              wrapperClassName="text-small"
            />
            <span className="font-shell-mono text-micro text-shell-muted">{f.key}</span>
          </div>
          {f.help && (
            <p id={`${id}-hint`} className={ui.hint}>
              {f.help}
            </p>
          )}
        </div>
      );

    case 'date':
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help} htmlFor={id}>
          <input
            id={id}
            type={f.withTime ? 'datetime-local' : 'date'}
            aria-describedby={hintOf(id, f.help)}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => set(e.target.value || null)}
            className={box}
          />
        </Field>
      );

    case 'enum':
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help} htmlFor={id}>
          <SelectBox
            id={id}
            compact={p.compact}
            aria-describedby={hintOf(id, f.help)}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => set(e.target.value)}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectBox>
        </Field>
      );

    case 'image':
    case 'file': {
      const imageOnly = f.t === 'image';
      const multiple = f.t === 'image' && f.multiple === true;
      const ids = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help}>
          {multiple ? (
            // Lưới, không phải cột dọc: từ 07/09 mỗi ô là một khung VUÔNG, nên
            // xếp dọc N ô rộng bằng cột cho ra một cột cao vài nghìn pixel.
            // `auto-fill` để số ô mỗi hàng theo bề rộng thật của form.
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              {ids.map((id, i) => (
                <AssetField
                  key={`${id}-${i}`}
                  value={id}
                  imageOnly={imageOnly}
                  onPick={(next) => set(next === null ? ids.filter((_, j) => j !== i) : ids.map((x, j) => (j === i ? next : x)))}
                />
              ))}
              <AssetField value={null} imageOnly={imageOnly} onPick={(next) => next && set([...ids, next])} />
            </div>
          ) : (
            <AssetField
              value={typeof value === 'string' ? value : null}
              imageOnly={imageOnly}
              onPick={set}
            />
          )}
          {f.t === 'image' && f.requireAlt && (
            <p className={ui.hint}>
              Loại này đòi chữ thay thế (alt). Đặt alt ở node ảnh trên trang, không ở đây —
              cùng một ảnh dùng ở hai chỗ có thể cần hai câu alt khác nhau.
            </p>
          )}
        </Field>
      );
    }

    case 'relation':
      return (
        <Field
          label={f.label}
          keyName={f.key}
          help={f.help}
          // Chỉ quan hệ MỘT có một ô chọn để nhãn trỏ vào; quan hệ NHIỀU là một hàng chip.
          htmlFor={f.cardinality === 'one' ? id : undefined}
        >
          <RelationField
            id={id}
            typeKey={f.typeKey}
            cardinality={f.cardinality}
            value={value}
            onChange={set}
            compact={p.compact}
          />
        </Field>
      );

    case 'link': {
      const link = (typeof value === 'object' && value !== null ? value : {}) as {
        href?: string;
        label?: string;
      };
      return (
        <Field label={f.label} keyName={f.key} required={f.required} help={f.help}>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={link.href ?? ''}
              aria-label={`${f.label} — đường dẫn`}
              placeholder="/duong-dan hoặc https://…"
              onChange={(e) => set({ ...link, href: e.target.value })}
              className={cn(box, 'font-shell-mono')}
            />
            <input
              value={link.label ?? ''}
              aria-label={`${f.label} — nhãn`}
              placeholder="Nhãn hiện ra"
              onChange={(e) => set({ ...link, label: e.target.value })}
              className={box}
            />
          </div>
        </Field>
      );
    }

    case 'json':
      return (
        <Field label={f.label} keyName={f.key} help={f.help} htmlFor={id}>
          <textarea
            id={id}
            rows={5}
            aria-describedby={hintOf(id, f.help)}
            defaultValue={value === null || value === undefined ? '' : JSON.stringify(value, null, 2)}
            onBlur={(e) => {
              // Parse lúc RỜI ô, không lúc gõ: gõ dở một object thì JSON luôn sai,
              // và báo lỗi ở mỗi ký tự là báo lỗi vào mặt người đang gõ đúng.
              const raw = e.target.value.trim();
              if (raw === '') return set(null);
              try {
                set(JSON.parse(raw));
              } catch {
                set(raw);
              }
            }}
            className={cn(box, ui.textarea, 'font-shell-mono text-small')}
          />
          <p className={ui.hint}>
            JSON không hợp lệ sẽ được giữ nguyên dạng chuỗi để bạn sửa tiếp, không bị xoá.
          </p>
        </Field>
      );

    case 'taxonomy':
      // Danh mục sống ở SIDEBAR (`EntrySidebar`), không ở cột trái. Nó không lưu
      // trong `data` mà trong bảng `EntryTaxonomy`, nên render nó ở đây là tạo
      // nguồn sự thật thứ hai cho cùng một liên kết.
      return null;

    case 'seo':
      return <SeoFieldInput field={f} value={value} onChange={set} ctx={p.seo} />;

    // ── Nhóm field, KHÔNG lặp: render thẳng field con, không có thanh tiêu đề.
    //    Một khung có đúng một mục thì thanh mở/đóng chỉ thêm một cú bấm.
    case 'group': {
      const inner = p.groups[f.groupKey] ?? [];

      if (!f.repeatable) {
        return (
          <Nest label={f.label} keyName={f.key} depth={p.depth}>
            {inner.map((cf) => (
              <FieldInput
                key={cf.key}
                {...p}
                field={cf}
                path={[...path, cf.key]}
                value={(value as Record<string, unknown> | null)?.[cf.key]}
                depth={p.depth + 1}
              />
            ))}
          </Nest>
        );
      }

      const items = Array.isArray(value) ? value : [];
      const atMax = f.max !== undefined && items.length >= f.max;
      return (
        <RepeatList
          label={f.label}
          keyName={f.key}
          depth={p.depth}
          // Nhóm lặp KHÔNG có nhãn loại: mọi mục cùng bộ field. Đó là thứ phân biệt
          // nó với Dynamic Zone bên dưới, và bỏ đi là làm hai danh sách trông y hệt.
          badgeOf={() => null}
          counter={f.max ? `${items.length} / ${f.max} mục` : `${items.length} mục`}
          items={items}
          titleOf={(item) => firstText(item, inner) || 'Mục chưa có nội dung'}
          onAdd={atMax ? null : () => p.onAppend(path, emptyEntry(inner, p.groups))}
          addLabel={`Thêm ${f.label.toLowerCase()}`}
          onRemove={(i) => p.onRemove(path, i)}
          onMove={(i, d) => p.onMove(path, i, d)}
          renderItem={(item, i) =>
            inner.map((cf) => (
              <FieldInput
                key={cf.key}
                {...p}
                field={cf}
                path={[...path, i, cf.key]}
                value={(item as Record<string, unknown>)?.[cf.key]}
                depth={p.depth + 1}
              />
            ))
          }
        />
      );
    }

    // ── Dynamic Zone: mỗi mục một loại khác nhau, nên CÓ nhãn loại.
    case 'blocks': {
      const items = Array.isArray(value) ? value : [];
      const atMax = f.max !== undefined && items.length >= f.max;
      return (
        <RepeatList
          label={f.label}
          keyName={f.key}
          depth={p.depth}
          badgeOf={(item) => String((item as Record<string, unknown>)?.__type ?? '?')}
          counter={`${items.length} khối · mỗi khối một loại`}
          items={items}
          titleOf={(item) => {
            const bk = String((item as Record<string, unknown>)?.__type ?? '');
            return firstText(item, p.groups[bk] ?? []) || 'Khối chưa có nội dung';
          }}
          addChoices={
            atMax
              ? []
              : f.allowed.map((k) => ({
                  key: k,
                  label: k,
                  onPick: () => p.onAppend(path, emptyBlock(k, p.groups)),
                }))
          }
          addLabel="Thêm khối"
          onRemove={(i) => p.onRemove(path, i)}
          onMove={(i, d) => p.onMove(path, i, d)}
          renderItem={(item, i) => {
            const bk = String((item as Record<string, unknown>)?.__type ?? '');
            const inner = p.groups[bk];
            // Khối mồ côi: hiện một dòng giải thích chứ không render rỗng. Render
            // rỗng thì người dùng thấy một thanh không mở ra được và không biết vì sao.
            if (!inner) {
              return (
                <Note tone="warn">
                  Khối “{bk}” không còn trong danh sách nhóm field. Dữ liệu vẫn được giữ; xoá
                  khối này hoặc tạo lại nhóm field cùng khoá.
                </Note>
              );
            }
            return inner.map((cf) => (
              <FieldInput
                key={cf.key}
                {...p}
                field={cf}
                path={[...path, i, cf.key]}
                value={(item as Record<string, unknown>)?.[cf.key]}
                depth={p.depth + 1}
              />
            ));
          }}
        />
      );
    }
  }
}

/**
 * Chữ đầu tiên tìm được trong một mục, để làm tiêu đề thanh khi đóng.
 *
 * Không có nó thì mọi thanh đọc là "Mục 1", "Mục 2" — và người dùng phải mở từng
 * cái để tìm đoạn mình cần sửa.
 */
function firstText(item: unknown, fields: FieldDef[]): string {
  if (typeof item !== 'object' || item === null) return '';
  const rec = item as Record<string, unknown>;
  for (const f of fields) {
    const v = rec[f.key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && typeof v[0] === 'object' && v[0] && 'v' in (v[0] as object)) {
      const s = String((v[0] as { v?: unknown }).v ?? '').trim();
      if (s) return s;
    }
  }
  return '';
}
