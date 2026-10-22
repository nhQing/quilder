'use client';

/**
 * Màn 2 — định nghĩa field. Dùng chung cho HAI đích: cấu trúc của một LOẠI NỘI
 * DUNG (`/builder/content/types/[key]`) và cấu trúc của một NHÓM FIELD dùng lại
 * (`/builder/content/groups/[key]`). Schema của cả hai đều là `FieldDef[]`, và
 * bảng field 15 kiểu 6 nhóm là một cái — chỉ khác ở NƠI lưu và ở việc có/không
 * có khái niệm `titleField`.
 *
 * `target.kind` phân biệt hai chế độ, thay cho một cờ boolean rời — một cờ
 * `isGroup: boolean` không nói được "loại thì có entryCount + titleField, nhóm
 * thì có usedByCount", còn discriminated union thì TypeScript tự chặn việc đọc
 * `entryCount` ở nhánh nhóm.
 *
 * ## Vì sao KHÔNG dùng `TextControl`/`NumberControl`/… của `controls.tsx`
 *
 * Brief gốc trỏ tới các control đó để tái dùng. Đọc kỹ thì chúng KHÔNG phải
 * control form chung — mỗi control nhận `node`/`breakpoint`/`group`/`field` của
 * MỘT NODE TRONG DOC, tự đọc `fieldState` từ style hiệu dụng, và tự `dispatch`
 * một op `setStyle` qua store `useEditor` của canvas. Không có `node` (ở đây
 * không có) thì các hook đó không gọi được — chúng thuộc về bảng thuộc tính của
 * trang sửa, không phải form nhập liệu chung. Nên màn này dùng ô nhập chung của
 * design system (`ui/Field`), như hộp thoại tạo loại/nhóm của `CollectionTypeGrid.tsx`
 * — không phải một lựa chọn tuỳ ý.
 *
 * ## Vì sao `key` bị khoá sau lần lưu đầu
 *
 * Khoá field nằm trong `path` của binding trong doc, và trong tên thuộc tính
 * JSON mà mobile đọc. Đổi nó là làm chết cả hai — im lặng, vì binding sai chỉ
 * rơi về `fallback`. Nên ô `key` chỉ gõ được với field CHƯA lưu, và ổ khoá phải
 * nhìn thấy.
 *
 * Phân biệt "đã lưu" hay "chưa lưu" bằng một TẬP KHOÁ cục bộ (`fresh`), không
 * bằng chỉ số trong mảng: Lên/Xuống đổi CHỈ SỐ của field mà không đổi field nào là
 * field nào, nên khoá theo chỉ số sẽ khoá nhầm field sau khi sắp xếp lại. Khi
 * người dùng đổi khoá của một field còn `fresh`, tập này phải đổi theo (xem
 * `renameKey`), vì lúc đó khoá cũ không còn tồn tại để tra.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { MAX_FIELD_DEPTH, schemaDepth, type FieldDef, type FieldType, type GroupTable } from '@/lib/collections/field-def';
import { moveItem, removeItem } from '@/lib/collections/form-state';
import { Badge } from './ui/Badge';
import { Button, ButtonLink, IconButton } from './ui/Button';
import { Checkbox, SelectField, TextField } from './ui/Field';
import { Icon } from './ui/Icon';
import { Note } from './ui/Note';
import { EmptyState, PageHeader } from './ui/Page';

export type GroupOption = { key: string; name: string; fieldCount: number };
export type TypeOption = { key: string; name: string };
export type TaxonomyOption = { id: string; key: string; name: string; parentId: string | null };

export type SchemaTarget =
  | {
      kind: 'type'; key: string; name: string; titleField: string; entryCount: number;
      /**
       * Site có trang nào ĐỌC SEO của loại này không: mẫu chi tiết, hoặc trang danh mục
       * lấy loại này làm tham số. Không có thì field SEO chỉ dùng qua API — form nói ra.
       */
      seoOnSite: boolean;
    }
  | {
      kind: 'group';
      key: string;
      name: string;
      /** Tổng số loại đổi theo — TRỰC TIẾP cộng GIÁN TIẾP qua một nhóm khác. */
      usedByCount: number;
      /** Trong số đó, số loại dùng TRỰC TIẾP (có field group/blocks trỏ thẳng tới nhóm này). */
      directUsedByCount: number;
    };

/** Sáu nhóm, đúng thứ tự và đúng nhãn của bản dựng UI (`docs/CONTENT-UI-PROTO.html#s2`). */
const TYPE_GROUPS: { label: string; types: FieldType[]; tone?: 'struct' | 'esc' }[] = [
  { label: 'Chữ', types: ['text', 'richtext', 'html', 'slug'] },
  { label: 'Số, ngày, chọn', types: ['number', 'boolean', 'date', 'enum'] },
  { label: 'Tệp', types: ['image', 'file'] },
  { label: 'Liên kết', types: ['relation', 'taxonomy', 'link'] },
  { label: 'Tìm kiếm & chia sẻ', types: ['seo'] },
  { label: 'Có cấu trúc — lồng sâu tối đa 3', types: ['group', 'blocks'], tone: 'struct' },
  { label: 'Lối thoát', types: ['json'], tone: 'esc' },
];

/** Nhãn hiện trên nút kiểu trong bộ chọn và trên thẻ ở danh sách field. */
function typeBadge(f: FieldDef): string {
  if (f.t === 'group') return f.repeatable ? 'group ×n' : 'group';
  return f.t;
}

/**
 * `group`/`blocks` là hai kiểu LỒNG CẤU TRÚC — cùng `tone: 'struct'` với bộ
 * chọn kiểu (`TYPE_GROUPS`). Badge của chúng ở danh sách field và ở đầu ô sửa
 * phải mang tông accent giống `.field__t--struct` của proto, nếu không tín
 * hiệu "field này lồng thêm một tầng cấu trúc" chỉ còn thấy được lúc bấm vào.
 */
function isStructType(f: FieldDef): boolean {
  return f.t === 'group' || f.t === 'blocks';
}

/** Field có yêu cầu bắt buộc không — mọi biến thể mang `required` đều dùng chung một tên. */
function isRequired(f: FieldDef): boolean {
  return 'required' in f && f.required === true;
}

/** Khoá gợi ý cho field mới: `text`, `text_2`, … — không bao giờ trùng. */
function nextKey(t: FieldType, fields: FieldDef[]): string {
  const taken = new Set(fields.map((f) => f.key));
  if (!taken.has(t)) return t;
  let n = 2;
  while (taken.has(`${t}_${n}`)) n += 1;
  return `${t}_${n}`;
}

/**
 * Field mới phải HỢP LỆ ngay, không phải một bộ xương chờ điền.
 *
 * `enum` không có lựa chọn nào và `blocks` không có khối nào đều bị zod từ chối,
 * nên tạo chúng ở trạng thái rỗng nghĩa là nút Lưu báo lỗi trước khi người dùng
 * làm gì.
 */
function defaultFieldDef(
  t: FieldType,
  key: string,
  fields: FieldDef[],
  firstGroup?: string,
  firstType?: string,
): FieldDef {
  const label = 'Field mới';
  switch (t) {
    case 'enum':
      return { t, key, label, options: [{ value: 'a', label: 'Lựa chọn A' }] };
    case 'slug':
      return { t, key, label, from: fields[0]?.key ?? 'title' };
    case 'relation':
      return { t, key, label, typeKey: firstType ?? '', cardinality: 'many' };
    case 'group':
      return { t, key, label, groupKey: firstGroup ?? '', repeatable: true };
    case 'blocks':
      return { t, key, label, allowed: firstGroup ? [firstGroup] : [] };
    case 'seo':
      return { t, key, label: 'SEO' };
    default:
      return { t, key, label } as FieldDef;
  }
}


/* ── Control nhỏ, dùng chung ─────────────────────────────────────────────── */

/** Đoạn giải thích dưới một nhóm control: chữ nhỏ, mã trong `<code>` là đơn cách. */
const EXPLAIN =
  'max-w-[62ch] text-small leading-relaxed text-shell-muted [&_b]:font-semibold [&_b]:text-shell-ink [&_code]:font-shell-mono [&_strong]:font-semibold [&_strong]:text-shell-ink';

/**
 * Nhãn + nội dung + chú thích cho một NHÓM control (danh sách lựa chọn, khối cho
 * phép, chip danh mục) — thứ không có một ô đơn để `<label for>` trỏ vào. Ô đơn thì
 * dùng thẳng `TextField`/`SelectField` của `ui/`.
 */
function Group({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <span id={id} className={ui.label}>
        {label}
      </span>
      {children}
      {hint && <p className={cn(ui.hint, 'max-w-[62ch] leading-relaxed')}>{hint}</p>}
    </div>
  );
}

function NumField({
  label, hint, value, onChange, placeholder,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  return (
    <TextField
      label={label}
      hint={hint}
      mono
      value={draft}
      inputMode="decimal"
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft.trim();
        if (!t) { onChange(undefined); return; }
        const n = Number(t);
        onChange(Number.isFinite(n) ? n : value);
      }}
    />
  );
}

/** Các ô đánh dấu đứng liền nhau — một nhịp, không cách nhau như các ô nhập. */
function Checks({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

function Check({
  checked, onChange, label, disabled, title,
}: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean; title?: string }) {
  return (
    // `title` ở khung bọc chứ không ở ô: ô bị tắt không nhận chuột, nên lý do gắn lên
    // nó thì không bao giờ hiện ra.
    <span title={title} className="inline-flex">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        label={label}
        wrapperClassName={cn('text-small', disabled && 'cursor-not-allowed opacity-60')}
      />
    </span>
  );
}

function Pick({
  label, hint, value, onChange, options, placeholder, allowEmpty = true,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  /**
   * Có hiện lựa chọn rỗng "—" đầu danh sách không.
   *
   * Mặc định CÓ — property đang sửa có thể hợp lệ khi để trống (`format` số,
   * hoặc chờ người dùng chọn lần đầu qua `placeholder`). Đặt `false` cho
   * property mà zod đòi một trong các `options` — ví dụ `cardinality`
   * (`'one' | 'many'`, không có giá trị rỗng hợp lệ): còn option "—" thì bấm
   * được vào nó và gửi `cardinality: ''`, bị server từ chối 400 mà UI không
   * hề báo trước.
   */
  allowEmpty?: boolean;
}) {
  return (
    <SelectField label={label} hint={hint} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="" disabled={!!placeholder}>{placeholder ?? '—'}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </SelectField>
  );
}

/** Ô khoá field — readonly kèm ổ khoá khi field đã lưu, gõ được khi còn `fresh`. */
function KeyField({
  value, locked, onChange,
}: { value: string; locked: boolean; onChange: (v: string) => void }) {
  return (
    <TextField
      label={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          Khoá <span className="font-shell-mono font-normal text-shell-muted">key</span>
          {locked && (
            <Badge tone="warn" size="sm">
              <Icon name="lock" size={12} />
              khoá sau lần lưu đầu
            </Badge>
          )}
        </span>
      }
      hint={
        locked
          ? 'Đổi khoá là làm chết mọi binding trong doc và mọi client mobile đang gọi. Cần đổi thì tạo field mới rồi chuyển dữ liệu.'
          : undefined
      }
      mono
      value={value}
      readOnly={locked}
      onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
      spellCheck={false}
      className={cn(locked && 'cursor-not-allowed bg-shell-raised text-shell-muted hover:border-shell-line-strong')}
    />
  );
}

/**
 * Bộ chọn kiểu của "Thêm field": một popover xếp theo sáu nhóm của `TYPE_GROUPS`.
 *
 * Đóng khi bấm ra ngoài hoặc Esc (focus trả về nút mở), cùng luật với `MenuButton`
 * của `ui/`. Không dùng thẳng `MenuList`: mỗi nhóm cần một nhãn, mỗi kiểu cần tông
 * riêng (cấu trúc / lối thoát), và kiểu bị khoá phải nói được lý do bằng chữ.
 */
function TypePicker({
  open, onToggle, onClose, kind, hasTaxonomy, hasSeo, onPick,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  kind: SchemaTarget['kind'];
  hasTaxonomy: boolean;
  /** Loại đã có field SEO — mỗi loại tối đa một (`validateCollectionSchema`). */
  hasSeo: boolean;
  onPick: (t: FieldType) => void;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        // Nút mở là nút ĐẦU TIÊN trong khung; `Button` không nhận `ref`.
        root.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);

  return (
    <div ref={root} className="relative ml-auto">
      <Button
        variant="secondary"
        size="md"
        icon="plus"
        iconRight="chevron-down"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
      >
        Thêm field
      </Button>
      {open && (
        <div
          role="group"
          aria-label="Chọn kiểu field"
          className={cn(ui.pop, 'absolute top-full right-0 z-30 mt-1.5 flex w-[min(32rem,calc(100vw-3rem))] flex-col gap-3 p-3')}
        >
          <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2">
            {TYPE_GROUPS.map((g) => {
              // Ẩn `taxonomy` ở chế độ nhóm — KHÔNG ẩn cả nhóm "Liên kết" theo
              // đó. Bản trước lọc nguyên nhóm nếu nó CHỨA taxonomy
              // (`g.types.includes('taxonomy')`), nên "Liên kết" (chứa cả
              // `relation`/`link`, hai kiểu HOÀN TOÀN hợp lệ trong nhóm field)
              // biến mất theo luôn — không tạo được field relation/link trong
              // một FieldGroupDef, dù `validateCollectionSchema(..., 'group')`
              // chỉ cấm đúng `taxonomy` (field-def.ts:159). Lọc TỪNG KIỂU rồi
              // chỉ bỏ nhóm khi không còn kiểu nào sau lọc.
              // `seo` cũng chỉ ở tầng ngoài của loại: renderer không đọc SEO trong nhóm.
              const visible = g.types.filter((t) => (t !== 'taxonomy' && t !== 'seo') || kind === 'type');
              if (visible.length === 0) return null;
              return (
                <div key={g.label} className="flex min-w-0 flex-col gap-0.5">
                  <p className={cn(ui.eyebrow, 'px-2.5 pt-1 pb-1')}>{g.label}</p>
                  {visible.map((t) => {
                    const disabled = (t === 'taxonomy' && hasTaxonomy) || (t === 'seo' && hasSeo);
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={disabled}
                        title={
                          !disabled
                            ? undefined
                            : t === 'seo'
                              ? 'Đã có một field SEO — mỗi loại chỉ một bộ SEO cho mỗi bài.'
                              : 'Đã có một field danh mục — một loại chỉ được một field taxonomy, vì taxonomyIds là danh sách phẳng không mang khoá field.'
                        }
                        onClick={() => onPick(t)}
                        className={cn(
                          ui.menuItem,
                          focusRing,
                          'font-shell-mono text-small',
                          g.tone === 'struct' && 'text-shell-accent',
                          g.tone === 'esc' && 'text-shell-warn',
                        )}
                      >
                        <Icon
                          name={g.tone === 'struct' ? 'layers' : g.tone === 'esc' ? 'alert' : 'plus'}
                          size={15}
                          className={g.tone ? undefined : 'text-shell-muted'}
                        />
                        {t}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {hasTaxonomy && kind === 'type' && (
            <p className={cn(ui.hint, 'px-2.5')}>
              <code className="font-shell-mono">taxonomy</code> đã có trong loại này — mỗi loại chỉ một field
              danh mục.
            </p>
          )}
          <p className={cn(ui.hint, 'border-t border-shell-line px-2.5 pt-2.5 leading-relaxed')}>
            16 kiểu, và danh sách này đóng — cùng lý do 9 primitive node bị đóng băng. Năng lực mới đến qua
            nhóm field, không qua kiểu mới.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Component chính ─────────────────────────────────────────────────────── */

export function SchemaEditor({
  target,
  fields: initialFields,
  groupOptions,
  typeOptions,
  taxonomies,
  groups,
  parseWarning,
  rawSchema,
}: {
  target: SchemaTarget;
  fields: FieldDef[];
  groupOptions: GroupOption[];
  typeOptions: TypeOption[];
  /** Danh mục của LOẠI đang sửa — chỉ có nghĩa ở chế độ `type`. */
  taxonomies?: TaxonomyOption[];
  /**
   * Bảng field của MỌI nhóm khác — chỉ dùng để HIỆN "đang ở độ sâu x/3" cho
   * field `group` (một gợi ý cho người sửa, KHÔNG dùng để chặn Lưu — server
   * vẫn là nơi kiểm thật qua `validateCollectionSchema`/`schemaDepth`).
   */
  groups?: GroupTable;
  /**
   * Nếu schema đã lưu trong DB không parse được, hiện cảnh báo NÀY và KHOÁ
   * nút Lưu — bấm Lưu lúc này sẽ ghi `fields` (rỗng hoặc bán chừng) đè lên
   * schema thật, một khi nút không bị khoá thì "cảnh báo" chỉ là chữ suông.
   * Dùng ở CẢ HAI chế độ (xem `types/[key]/page.tsx` và
   * `groups/[key]/page.tsx`).
   */
  parseWarning?: string | null;
  /**
   * Dữ liệu THÔ đọc từ DB, hiện kèm `parseWarning` để người dùng tự cứu nội
   * dung bằng tay (chép ra, sửa lại, dán vào nơi khác) — "hiện cảnh báo" mà
   * không hiện luôn dữ liệu thô thì người dùng biết có sự cố nhưng không có
   * gì để làm với thông tin đó.
   */
  rawSchema?: unknown;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<FieldDef[]>(initialFields);
  const [titleField, setTitleField] = useState(target.kind === 'type' ? target.titleField : '');
  const [selected, setSelected] = useState<number | null>(fields.length ? 0 : null);
  const [picking, setPicking] = useState(fields.length === 0);
  // Field CHƯA lưu thì `key` còn gõ được. Tập này là thứ duy nhất phân biệt —
  // xem docblock đầu file vì sao khoá theo KEY, không theo chỉ số.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; lines: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const groupOptionsForPicker =
    // Nhóm đang sửa không tự chọn chính nó ở bộ chọn — lồng một nhóm vào chính
    // nó là một vòng tầm thường mà không cần đợi server báo lỗi.
    target.kind === 'group' ? groupOptions.filter((g) => g.key !== target.key) : groupOptions;

  const hasTaxonomy = target.kind === 'type' && fields.some((f) => f.t === 'taxonomy');
  const hasSeo = target.kind === 'type' && fields.some((f) => f.t === 'seo');

  function selectedField(): FieldDef | null {
    return selected !== null ? fields[selected] ?? null : null;
  }

  function updateField(index: number, patch: Record<string, unknown>) {
    setFields((fs) => fs.map((f, i) => (i === index ? ({ ...f, ...patch } as FieldDef) : f)));
  }

  function renameKey(index: number, oldKey: string, newKey: string) {
    setFields((fs) => fs.map((f, i) => (i === index ? ({ ...f, key: newKey } as FieldDef) : f)));
    setFresh((s) => {
      if (!s.has(oldKey)) return s;
      const next = new Set(s);
      next.delete(oldKey);
      next.add(newKey);
      return next;
    });
    // Field làm tiêu đề phải DỜI THEO khoá mới. Không dời thì ô chọn vẫn giữ
    // khoá CŨ (không còn field nào mang nó) — nút Lưu không bị chặn vì
    // `titleField` khác rỗng, request đi, và server trả 400 "field làm tiêu
    // đề không có trong cấu trúc" mà người dùng không hiểu vì sao.
    setTitleField((t) => (t === oldKey ? newKey : t));
  }

  function addField(t: FieldType) {
    const key = nextKey(t, fields);
    const def = defaultFieldDef(t, key, fields, groupOptionsForPicker[0]?.key, typeOptions[0]?.key);
    setFields((fs) => [...fs, def]);
    setFresh((s) => new Set(s).add(key));
    setSelected(fields.length);
    setPicking(false);
  }

  function removeField(index: number) {
    const key = fields[index]?.key;
    setFields((fs) => removeItem({ list: fs }, ['list'], index).list);
    setFresh((s) => {
      if (!key || !s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
    // Cùng lý do với `renameKey`: xoá đúng field đang làm tiêu đề thì ô chọn
    // phải rơi về rỗng, để nút Lưu bị chặn (điều kiện `!titleField` ở nút)
    // thay vì để request đi và ăn 400.
    setTitleField((t) => (key && t === key ? '' : t));
    setSelected((cur) => {
      if (cur === null) return cur;
      if (cur === index) return fields.length > 1 ? Math.max(0, index - 1) : null;
      return cur > index ? cur - 1 : cur;
    });
  }

  function move(index: number, dir: -1 | 1) {
    setFields((fs) => moveItem({ list: fs }, ['list'], index, dir).list);
    setSelected((cur) => {
      if (cur === index) return index + dir;
      if (cur === index + dir) return index;
      return cur;
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);

    // try/catch/finally BẮT BUỘC: lỗi mạng hoặc `res.json()` gặp phản hồi
    // không-JSON (502 của proxy, trang lỗi HTML của Next) ném ngay trong một
    // handler async. Không bắt thì `setBusy(false)` không chạy — nút đứng
    // vĩnh viễn ở "Đang lưu…", disabled, không thông báo gì, và người dùng
    // chỉ còn cách tải lại trang — MẤT mọi thay đổi chưa lưu.
    try {
      const res =
        target.kind === 'type'
          ? await fetch(`/api/collections/types/${target.key}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ schema: fields, titleField }),
            })
          : await fetch('/api/collections/groups', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ key: target.key, name: target.name, schema: fields }),
            });

      const json = (await res.json()) as { ok?: boolean; error?: string; warnings?: string[] };
      if (!res.ok || !json.ok) {
        setMsg({ kind: 'err', lines: [json.error ?? 'Không lưu được'] });
        return;
      }
      // Cảnh báo KHÔNG được im: "field chỉ bị ẩn, dữ liệu còn nằm đó" là thứ
      // người dùng phải đọc, không phải thứ ghi vào log.
      setMsg(
        json.warnings?.length
          ? { kind: 'warn', lines: json.warnings }
          : { kind: 'ok', lines: ['Đã lưu cấu trúc.'] },
      );
      setFresh(new Set());
      router.refresh();
    } catch (e) {
      setMsg({
        kind: 'err',
        lines: [
          `Không gọi được server: ${e instanceof Error ? e.message : String(e)}. Thay đổi CHƯA mất — thử Lưu lại.`,
        ],
      });
    } finally {
      setBusy(false);
    }
  }

  const field = selectedField();
  const liveCount = target.kind === 'type' ? target.entryCount : target.usedByCount;
  const liveText =
    target.kind === 'type'
      ? `${target.entryCount} entry đang dùng cấu trúc này.`
      : (() => {
          // Tách CHỮ, không tách số: một con số duy nhất không nói được nhóm
          // đổi theo qua đường TRỰC TIẾP hay qua một nhóm khác — và "qua nhóm
          // khác" là đúng lý do `FieldGroupDef` tồn tại (dùng lại nhiều tầng).
          const indirect = target.usedByCount - target.directUsedByCount;
          return indirect > 0
            ? `${target.usedByCount} loại nội dung đổi theo (${target.directUsedByCount} dùng trực tiếp, ${indirect} qua nhóm khác).`
            : `${target.usedByCount} loại nội dung đang dùng nhóm này.`;
        })();
  const liveHint =
    target.kind === 'type'
      ? 'Thêm field thì entry cũ để trống; đổi kiểu chỉ cho các cặp không mất dữ liệu; đổi key thì không cho.'
      : 'Sửa nhóm là mọi loại đang dùng nó đổi theo ngay — thêm field thì entry cũ để trống, đổi key thì không cho.';


  const saveBlocked = busy || !!parseWarning || (target.kind === 'type' && !titleField);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Kho dữ liệu', href: '/builder/content' }]}
        title={target.name}
        count={`${fields.length} field`}
        description={
          target.kind === 'type' ? (
            <>
              Cấu trúc field của loại nội dung <code className="font-shell-mono">{target.key}</code>.
            </>
          ) : (
            <>
              Nhóm field dùng lại <code className="font-shell-mono">{target.key}</code> — loại nội dung gắn nó qua
              một field <code className="font-shell-mono">group</code> hoặc{' '}
              <code className="font-shell-mono">blocks</code>.
            </>
          )
        }
        actions={
          <>
            {target.kind === 'type' && (
              <ButtonLink href={`/builder/content/${target.key}`} variant="secondary" icon="list">
                Xem bảng entry
              </ButtonLink>
            )}
            <Button
              variant="primary"
              icon="check"
              loading={busy}
              disabled={saveBlocked}
              title={
                parseWarning
                  ? 'Không parse được cấu trúc đã lưu — Lưu lúc này sẽ ghi đè bằng danh sách rỗng/bán chừng bên dưới. Xem dữ liệu thô, sửa lại schema trước.'
                  : undefined
              }
              onClick={() => void save()}
            >
              {busy ? 'Đang lưu…' : 'Lưu cấu trúc'}
            </Button>
          </>
        }
      />

      {parseWarning && (
        <Note tone="danger" role="alert">
          <p>
            <b className="font-semibold">Không đọc được cấu trúc đã lưu:</b> {parseWarning} Dữ liệu THÔ vẫn còn
            trong DB, chưa mất. Nút Lưu đã bị KHOÁ — bấm Lưu lúc này sẽ ghi đè bằng danh sách rỗng/bán chừng
            đang hiện ở hai cột dưới. Chép dữ liệu thô bên dưới ra, sửa lại đúng hình{' '}
            <code className="font-shell-mono">FieldDef[]</code>, rồi dán trở lại qua route/API trước khi màn
            này dùng được.
          </p>
          {rawSchema !== undefined && (
            <pre className="font-shell-mono max-h-40 overflow-auto rounded-md bg-shell-panel p-3 text-micro text-shell-ink">
              {JSON.stringify(rawSchema, null, 2)}
            </pre>
          )}
        </Note>
      )}

      {liveCount > 0 && (
        <Note tone="warn">
          <p>
            <b className="font-semibold">{liveText}</b> {liveHint}
          </p>
        </Note>
      )}

      {msg && (
        <Note
          tone={msg.kind === 'ok' ? 'ok' : msg.kind === 'warn' ? 'warn' : 'danger'}
          role={msg.kind === 'err' ? 'alert' : 'status'}
        >
          {msg.lines.map((l, i) => <p key={i}>{l}</p>)}
        </Note>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ── Cột trái: danh sách field ─────────────────────────────── */}
        <section aria-label="Danh sách field" className={cn(ui.card, 'flex min-w-0 flex-col gap-4 p-5')}>
          <div className="flex items-center gap-2">
            <h2 className={ui.eyebrow}>
              Field <span className="tabular-nums">· {fields.length}</span>
            </h2>
            <TypePicker
              open={picking}
              onToggle={() => setPicking((v) => !v)}
              onClose={() => setPicking(false)}
              kind={target.kind}
              hasTaxonomy={hasTaxonomy}
              hasSeo={hasSeo}
              onPick={addField}
            />
          </div>

          {target.kind === 'type' && (
            <Pick
              label="Field làm tiêu đề trong bảng entry"
              value={titleField}
              onChange={setTitleField}
              options={fields.map((f) => ({ value: f.key, label: `${f.key} — ${f.label}` }))}
              placeholder="— chọn field —"
              // Nút Lưu bị khoá khi ô này trống: nói lý do NGAY dưới ô, không chỉ làm mờ nút.
              hint={
                !titleField ? (
                  <span className="font-medium text-shell-danger">Chọn một field làm tiêu đề — chưa chọn thì chưa lưu được.</span>
                ) : undefined
              }
            />
          )}

          {fields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-shell-line px-4 py-3 text-small text-shell-muted">
              Chưa có field nào — bấm “Thêm field” để chọn kiểu đầu tiên.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {fields.map((f, i) => (
                /*
                  `data-field-row` là móc để test tìm đúng hàng field.

                  Trước đó test nhắm bằng `getByRole('button').filter({ hasText:
                  /^Tiêu đề\s*title/ })` — có neo `^` để không khớp vào
                  `<option value="title">title — Tiêu đề</option>` của mấy ô select bên
                  phải. Neo đó vỡ ngay khi tay cầm kéo được thêm vào đầu nút, vì
                  `hasText` đọc `textContent` và giờ chuỗi bắt đầu bằng một icon.

                  Cùng bài học với `data-node-action` ở bảng thuộc tính: định vị bằng
                  MÓC, khẳng định bằng chữ. Một locator
                  bám vào hình dạng DOM sẽ vỡ ở lần ai đó thêm một icon.
                */
                <li
                  key={f.key}
                  data-field-row={f.key}
                  className={cn(
                    'flex min-w-0 items-center gap-0.5 rounded-md pr-1.5 transition-colors',
                    selected === i ? 'bg-shell-accent-soft' : 'hover:bg-shell-raised',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(i)}
                    aria-current={selected === i}
                    className={cn(
                      'flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 pl-2.5 text-left',
                      focusRing,
                    )}
                  >
                    <Icon name="drag" size={16} className="text-shell-muted" />
                    <span
                      className={cn(
                        'min-w-0 truncate text-small font-semibold',
                        selected === i ? 'text-shell-accent' : 'text-shell-ink',
                      )}
                    >
                      {f.label}
                    </span>
                    <span className="font-shell-mono min-w-0 truncate text-micro text-shell-muted">{f.key}</span>
                    {isRequired(f) && (
                      <>
                        <span aria-hidden className="text-shell-danger">*</span>
                        <span className="sr-only">(bắt buộc)</span>
                      </>
                    )}
                    <Badge
                      tone={isStructType(f) ? 'accent' : 'neutral'}
                      size="sm"
                      className="font-shell-mono ml-auto shrink-0"
                    >
                      {typeBadge(f)}
                    </Badge>
                  </button>
                  <IconButton size="sm" icon="arrow-up" label="Lên" disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton
                    size="sm"
                    icon="arrow-down"
                    label="Xuống"
                    disabled={i === fields.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <IconButton
                    size="sm"
                    icon="trash"
                    label="Xoá field"
                    onClick={() => removeField(i)}
                    className="hover:bg-shell-danger-soft hover:text-shell-danger"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Cột phải: ô sửa field đang chọn ──────────────────────────── */}
        {!field ? (
          <EmptyState
            compact
            icon="list"
            title="Chưa chọn field nào"
            description="Bấm “Thêm field” ở cột bên trái để thêm field đầu tiên, rồi sửa nó ở đây."
          />
        ) : (
          <FieldEditor
            key={selected}
            field={field}
            index={selected!}
            locked={!fresh.has(field.key)}
            onUpdate={updateField}
            onRename={renameKey}
            onRemove={removeField}
            groupOptions={groupOptionsForPicker}
            typeOptions={typeOptions}
            taxonomies={target.kind === 'type' ? taxonomies ?? [] : []}
            otherFields={fields.filter((_, i) => i !== selected)}
            groups={groups ?? {}}
            seoOnSite={target.kind === 'type' ? target.seoOnSite : true}
          />
        )}
      </div>
    </>
  );
}

/* ── Ô sửa field đang chọn — render theo `field.t` ───────────────────────── */

function FieldEditor({
  field, index, locked, onUpdate, onRename, onRemove, groupOptions, typeOptions, taxonomies, otherFields, groups, seoOnSite,
}: {
  field: FieldDef;
  index: number;
  locked: boolean;
  onUpdate: (index: number, patch: Record<string, unknown>) => void;
  onRename: (index: number, oldKey: string, newKey: string) => void;
  onRemove: (index: number) => void;
  groupOptions: GroupOption[];
  typeOptions: TypeOption[];
  taxonomies: TaxonomyOption[];
  otherFields: FieldDef[];
  /** Chỉ dùng để hiện "đang ở độ sâu x/3" cho field `group` — xem docblock ở `SchemaEditor`. */
  groups: GroupTable;
  /** Xem `SchemaTarget.seoOnSite`. */
  seoOnSite: boolean;
}) {
  const set = (patch: Record<string, unknown>) => onUpdate(index, patch);

  return (
    <section aria-label="Field đang sửa" className={cn(ui.card, 'flex min-w-0 flex-col gap-5 p-5 sm:p-6')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className={ui.eyebrow}>Field đang sửa</p>
          <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-section font-semibold text-balance">
            <span className="min-w-0 break-words">{field.label || 'Chưa có nhãn'}</span>
            <Badge tone={isStructType(field) ? 'accent' : 'neutral'} size="sm" className="font-shell-mono">
              {typeBadge(field)}
            </Badge>
          </h2>
        </div>
        <Button variant="danger" size="md" icon="trash" className="ml-auto" onClick={() => onRemove(index)}>
          Xoá field
        </Button>
      </div>

      <TextField label="Nhãn hiện trong form" value={field.label} onChange={(e) => set({ label: e.target.value })} />

      <KeyField value={field.key} locked={locked} onChange={(v) => onRename(index, field.key, v)} />

      {/* ── Theo từng kiểu — nhãn và câu chú thích chép nguyên từ FIELDS trong proto ── */}

      {field.t === 'text' && (
        <>
          <NumField label="Độ dài tối đa" value={field.maxLength} onChange={(v) => set({ maxLength: v })} />
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
            <Check checked={!!field.unique} onChange={(v) => set({ unique: v })} label="Không cho trùng" />
            <Check checked={!!field.multiline} onChange={(v) => set({ multiline: v })} label="Nhiều dòng" />
          </Checks>
        </>
      )}

      {field.t === 'richtext' && (
        <>
          <NumField label="Độ dài tối đa" value={field.maxLength} onChange={(v) => set({ maxLength: v })} />
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
          </Checks>
          <p className={EXPLAIN}>
            Lưu <code>RichText</code> — cùng kiểu với chữ trên trang. Không phải HTML, không phải Markdown: nhờ
            vậy bản dịch và hiệu ứng chạy sẵn, và cùng một bộ làm sạch.
          </p>
        </>
      )}

      {field.t === 'richdoc' && (
        <>
          {/*
            Khối này chỉ gặp field ĐÃ CÓ: `richdoc` không còn trong `TYPE_GROUPS`.
            Nó ở lại để người dùng đọc được cấu hình cũ và thấy đường chuyển đi.
          */}
          <Note tone="warn">
            <p>
              Kiểu này <b className="font-semibold">không còn ô soạn</b> (Tiptap đã gỡ). Chuyển sang{' '}
              <code className="font-shell-mono">html</code> bằng{' '}
              <code className="font-shell-mono">tsx scripts/richdoc-to-html.ts &lt;typeKey&gt; {field.key} --ghi</code>.
            </p>
          </Note>
          <NumField
            label="Số khối tối đa"
            hint="Đoạn, tiêu đề, danh sách, trích dẫn, ảnh, đường kẻ — mỗi thứ là một khối. Trần này chặn một cú dán từ Word sinh ra vài nghìn đoạn."
            value={field.maxBlocks}
            onChange={(v) => set({ maxBlocks: v })}
          />
          <NumField
            label="Số ký tự tối đa"
            hint="Đếm trên chữ đã làm phẳng, không trên kích thước JSON."
            value={field.maxChars}
            onChange={(v) => set({ maxChars: v })}
          />
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
          </Checks>
          {/*
            Đây là chỗ DUY NHẤT người dùng gặp lựa chọn giữa hai kiểu chữ giàu, và
            không có gì khác giải thích giúp. Nói bằng việc người ta làm ("một ô kiểu
            Word" vs "một đoạn"), không bằng tên kiểu dữ liệu.
          */}
          <p className={EXPLAIN}>
            Ô soạn kiểu Word: <b>có cấp khối</b> — đoạn, tiêu đề H2/H3/H4, danh sách, trích dẫn,
            ảnh có chú thích, đường kẻ. Chọn kiểu này cho <b>thân bài</b>.
          </p>
          <p className={EXPLAIN}>
            Khác <code>richtext</code> ở chỗ đó: <code>richtext</code> là <b>một đoạn chữ</b> có đậm,
            nghiêng và liên kết nhưng không có tiêu đề hay danh sách — đúng cho mô tả ngắn, câu dẫn,
            nhãn. Hai kiểu lưu hai hình dạng khác nhau và <b>không đổi qua lại được</b> khi loại đã
            có bài: đổi kiểu là mất dữ liệu, nên hãy chọn đúng ngay từ đầu.
          </p>
        </>
      )}

      {field.t === 'html' && (
        <>
          <NumField
            label="Số ký tự tối đa"
            hint="Đếm trên chữ sau khi bỏ thẻ, không trên kích thước chuỗi HTML — một câu 20 chữ có màu và liên kết vẫn đếm là 20."
            value={field.maxChars}
            onChange={(v) => set({ maxChars: v })}
          />
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
          </Checks>
          {/*
            Đây là chỗ người dùng phải chọn giữa `richdoc` và `html`, và không có gì
            khác giải thích giúp. Nói bằng NĂNG LỰC và bằng CÁI GIÁ, không bằng tên
            thư viện — người chọn không cần biết CKEditor là gì, họ cần biết chọn cái
            này thì làm được bảng và mất cái gì.
          */}
          <p className={EXPLAIN}>
            Ô soạn <b>đầy đủ nhất</b> (CKEditor): bảng, video nhúng, H1–H6, gạch chân, gạch ngang chữ,
            bút dạ, chỉ số trên/dưới, màu chữ và màu nền, canh lề, và một chế độ <b>sửa HTML</b> trực
            tiếp. Chọn kiểu này cho <b>thân bài cần trình bày tự do</b>.
          </p>
          <p className={EXPLAIN}>
            Cái giá: nội dung lưu dưới dạng <b>chuỗi HTML</b>, nên nó không đi qua bộ hiệu ứng chữ của
            site (tách chữ, đếm số) như <code>richdoc</code>. Mọi thẻ đều đi qua một{' '}
            <b>danh sách trắng</b> — <code>&lt;script&gt;</code>, thuộc tính <code>on*</code> và
            <code> javascript:</code> bị gỡ, và <code>&lt;iframe&gt;</code> chỉ nhận host đã khai ở
            Cài đặt. Ô soạn báo trước thẻ nào sẽ bị gỡ.
          </p>
          <p className={EXPLAIN}>
            Ba kiểu chữ giàu <b>không đổi qua lại được</b> khi loại đã có bài — đổi kiểu là mất dữ
            liệu. Hãy chọn đúng ngay từ đầu.
          </p>
        </>
      )}

      {field.t === 'slug' && (
        <Pick
          label="Sinh từ field"
          hint={
            <>
              Bỏ dấu tiếng Việt bằng đúng hàm <code className="font-shell-mono">fold</code> mà bộ lọc cây node
              dùng, nên “Lãi suất” ra <code className="font-shell-mono">lai-suat</code>. Trùng thì thêm hậu tố{' '}
              <code className="font-shell-mono">-2</code>.
            </>
          }
          value={field.from}
          onChange={(v) => set({ from: v })}
          options={otherFields.map((f) => ({ value: f.key, label: `${f.key} — ${f.label}` }))}
          placeholder="— chọn field —"
        />
      )}

      {field.t === 'number' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField label="Tối thiểu" value={field.min} onChange={(v) => set({ min: v })} />
            <NumField label="Tối đa" value={field.max} onChange={(v) => set({ max: v })} />
          </div>
          <Pick
            label="Định dạng"
            value={field.format ?? ''}
            onChange={(v) => set({ format: v || undefined })}
            options={[{ value: 'number', label: 'Số thường' }, { value: 'currencyVND', label: 'Tiền VNĐ' }]}
          />
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
          </Checks>
        </>
      )}

      {field.t === 'boolean' && (
        <Checks>
          <Check checked={!!field.default} onChange={(v) => set({ default: v })} label="Mặc định là bật" />
        </Checks>
      )}

      {field.t === 'date' && (
        <Checks>
          <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
          <Check checked={!!field.withTime} onChange={(v) => set({ withTime: v })} label="Có giờ, không chỉ ngày" />
        </Checks>
      )}

      {field.t === 'enum' && (
        <>
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
          </Checks>
          <EnumOptions field={field} onUpdate={(options) => set({ options })} />
        </>
      )}

      {field.t === 'image' && (
        <>
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
            <Check checked={!!field.multiple} onChange={(v) => set({ multiple: v })} label="Cho chọn nhiều ảnh" />
            <Check checked={!!field.requireAlt} onChange={(v) => set({ requireAlt: v })} label="Bắt buộc có chữ thay ảnh (alt) mới đăng được" />
          </Checks>
          <p className={EXPLAIN}>
            Lưu <code>assetId</code>, dùng chung kho asset với trang và component. Không có đường upload thứ hai.
          </p>
        </>
      )}

      {field.t === 'file' && (
        <>
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
          </Checks>
          <TextField
            label="Đuôi file cho phép"
            hint='Cách nhau bằng dấu phẩy, ví dụ "pdf, docx". Để trống thì nhận mọi loại.'
            mono
            spellCheck={false}
            value={(field.accept ?? []).join(', ')}
            onChange={(e) => set({ accept: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </>
      )}

      {field.t === 'relation' && (
        <>
          <Pick
            label="Trỏ tới loại"
            value={field.typeKey}
            onChange={(v) => set({ typeKey: v })}
            options={typeOptions.map((t) => ({ value: t.key, label: `${t.key} — ${t.name}` }))}
            placeholder="— chọn loại —"
          />
          <Pick
            label="Số lượng"
            value={field.cardinality}
            onChange={(v) => set({ cardinality: v })}
            options={[{ value: 'one', label: 'một' }, { value: 'many', label: 'nhiều' }]}
            // Không có giá trị rỗng hợp lệ cho cardinality — `zFieldDef` chỉ
            // nhận đúng 'one' | 'many'. Còn option "—" thì bấm được vào nó
            // và gửi `cardinality: ''`, bị server từ chối 400 mà UI không hề
            // báo trước (đây KHÔNG phải `allowEmpty` của lib nhóm field ở
            // `type-write.ts` — hai thứ trùng tên, không liên quan).
            allowEmpty={false}
          />
          <p className={EXPLAIN}>
            Để trống ở một bài thì khối liên quan trên trang tự xếp theo <strong>số danh mục trùng</strong>, rồi
            tới bài mới nhất. Nên field này là <em>ghi đè thủ công</em>, không phải điều kiện để khối hoạt động.
          </p>
        </>
      )}

      {field.t === 'taxonomy' && (
        <>
          <Checks>
            <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
            <Check checked={!!field.multiple} onChange={(v) => set({ multiple: v })} label="Cho chọn nhiều danh mục" />
          </Checks>
          <Group
            label={`Danh mục của loại này (${taxonomies.length})`}
            hint={
              <>
                Danh mục là <strong className="font-semibold text-shell-ink">bảng riêng</strong>, không phải một ô chữ
                trong bài: “FAQ theo danh mục” và “tin liên quan nhất” đều là truy vấn theo danh mục, và đổi tên
                danh mục phải là sửa <em>một</em> chỗ.
              </>
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {taxonomies.length === 0 && <span className={ui.hint}>Chưa có danh mục nào.</span>}
              {taxonomies.map((tx) => (
                <Badge key={tx.id}>{tx.name}</Badge>
              ))}
            </div>
          </Group>
        </>
      )}

      {field.t === 'link' && (
        <Checks>
          <Check checked={!!field.required} onChange={(v) => set({ required: v })} label="Bắt buộc" />
        </Checks>
      )}

      {field.t === 'group' && (() => {
        // Độ sâu của NỘI DUNG nhóm đang được chọn — KHÔNG tính field `group`
        // đang bọc nó (đó là tầng do CHÍNH field này tạo ra, không phải tầng
        // của cái nó chứa). `own === 1` nghĩa là nhóm không lồng nhóm nào
        // khác. Chỉ để HIỂN THỊ — server vẫn kiểm thật qua `schemaDepth` khi
        // Lưu, nên một bảng `groups` không đầy đủ ở đây chỉ làm gợi ý sai,
        // không làm Lưu sai.
        const own = field.groupKey ? schemaDepth(groups[field.groupKey] ?? [], groups) : 1;
        const remain = MAX_FIELD_DEPTH - own;
        return (
        <>
          <Pick
            label="Dùng nhóm field"
            hint="Sửa nhóm field là mọi loại nội dung đang dùng nó đổi theo. Đó là điểm khác quan trọng nhất so với việc gõ lại field ở mỗi loại."
            value={field.groupKey}
            onChange={(v) => set({ groupKey: v })}
            options={groupOptions.map((g) => ({ value: g.key, label: `${g.key} — ${g.name} (${g.fieldCount} field)` }))}
            placeholder="— chọn nhóm —"
          />
          <Checks>
            <Check checked={!!field.repeatable} onChange={(v) => set({ repeatable: v })} label="Cho lặp nhiều lần" />
          </Checks>
          {field.repeatable && (
            <NumField label="Số mục tối đa" value={field.max} onChange={(v) => set({ max: v })} />
          )}
          <p className={EXPLAIN}>
            Đang ở độ sâu <strong className="tabular-nums">{own} / {MAX_FIELD_DEPTH}</strong>.{' '}
            {own === 1
              ? 'Nhóm field này không chứa nhóm nào khác nên còn dư hai cấp.'
              : `Còn dư ${remain} cấp trước khi chạm giới hạn lồng.`}
          </p>
        </>
        );
      })()}

      {field.t === 'blocks' && (
        <BlocksAllowed field={field} groupOptions={groupOptions} onUpdate={(allowed) => set({ allowed })} onMax={(max) => set({ max })} />
      )}

      {field.t === 'json' && (
        <p className={EXPLAIN}>
          Lối thoát — nhận mọi JSON hợp lệ, không kiểm hình dạng bên trong. Dùng khi không kiểu nào trong 14 kiểu
          còn lại khớp, và chấp nhận đổi lại việc kiểm dữ liệu ở tầng render.
        </p>
      )}

      {field.t === 'seo' && (
        <>
          <p className={EXPLAIN}>
            Mỗi bài có một khối <b>SEO</b>: tiêu đề và mô tả trên Google, ảnh khi chia sẻ, ẩn khỏi Google. Mọi ô đều
            tuỳ chọn — ô để trống thì site tự lấy tiêu đề, sapo và ảnh đầu tiên của bài.
          </p>
          {!seoOnSite && (
            <Note tone="warn">
              Loại này chưa có trang chi tiết hay trang danh mục trên site, nên SEO chỉ dùng qua API.
            </Note>
          )}
        </>
      )}

      {/*
        `help` là property CHUNG cho cả 15 kiểu (`zHelp` ở MỌI nhánh của
        `zFieldDef`) — khác các checkbox trang trí của proto mà một số kiểu
        không có chỗ lưu (xem docblock Task 4). Đặt Ở CUỐI, dùng chung cho mọi
        `field.t`, thay vì lặp lại y hệt ô này trong 15 nhánh switch — 15 bản
        sao là 15 chỗ có thể trôi lệch khi có người sửa một bản mà quên 14
        bản còn lại.
      */}
      <TextField
        label="Chú thích cho người nhập"
        hint="Hiện chữ nhỏ dưới ô nhập trong form."
        value={field.help ?? ''}
        onChange={(e) => set({ help: e.target.value || undefined })}
      />
    </section>
  );
}

/** Danh sách lựa chọn của field `enum` — thêm/xoá/sửa từng dòng `{ value, label }`. */
function EnumOptions({
  field, onUpdate,
}: { field: Extract<FieldDef, { t: 'enum' }>; onUpdate: (options: { value: string; label: string }[]) => void }) {
  return (
    <Group label={`Lựa chọn (${field.options.length})`}>
      <div className="flex flex-col gap-2">
        {field.options.map((o, i) => (
          <div key={i} className="flex min-w-0 gap-2">
            <input
              value={o.value}
              aria-label={`Lựa chọn ${i + 1} — giá trị`}
              onChange={(e) => {
                const next = field.options.slice();
                next[i] = { ...o, value: e.target.value };
                onUpdate(next);
              }}
              placeholder="value"
              spellCheck={false}
              className={cn(ui.fieldMd, 'font-shell-mono w-28 shrink-0')}
            />
            <input
              value={o.label}
              aria-label={`Lựa chọn ${i + 1} — nhãn`}
              onChange={(e) => {
                const next = field.options.slice();
                next[i] = { ...o, label: e.target.value };
                onUpdate(next);
              }}
              placeholder="Nhãn hiện cho người dùng"
              className={ui.fieldMd}
            />
            <IconButton
              icon="x"
              label={field.options.length <= 1 ? 'Phải còn ít nhất một lựa chọn' : 'Xoá lựa chọn'}
              disabled={field.options.length <= 1}
              onClick={() => onUpdate(field.options.filter((_, j) => j !== i))}
              className="hover:bg-shell-danger-soft hover:text-shell-danger"
            />
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          icon="plus"
          className="self-start"
          onClick={() => onUpdate([...field.options, { value: `option_${field.options.length + 1}`, label: 'Lựa chọn mới' }])}
        >
          Thêm lựa chọn
        </Button>
      </div>
    </Group>
  );
}

/**
 * Khối cho phép của field `blocks` — bật/tắt từng nhóm field bằng checkbox.
 *
 * Proto (`FIELDS.zone`) còn hiện Component đã ánh xạ mỗi khối và cảnh báo khối
 * CHƯA có Component. Milestone này KHÔNG có model dữ liệu nào nối `FieldGroupDef`
 * với một Component (`prisma/schema.prisma` không có bảng như vậy) — nên phần đó
 * không có nguồn thật để đọc. Bỏ qua nó ở đây thay vì giả một trạng thái, và ghi
 * rõ trong báo cáo Task 4 để không lặng lẽ khai thiếu.
 */
function BlocksAllowed({
  field, groupOptions, onUpdate, onMax,
}: {
  field: Extract<FieldDef, { t: 'blocks' }>;
  groupOptions: GroupOption[];
  onUpdate: (allowed: string[]) => void;
  onMax: (max: number | undefined) => void;
}) {
  return (
    <>
      <Group label="Khối cho phép">
        <Checks>
          {groupOptions.length === 0 && <p className={ui.hint}>Chưa có nhóm field nào để chọn — tạo nhóm field trước.</p>}
          {groupOptions.map((g) => {
            const checked = field.allowed.includes(g.key);
            // `allowed` là `.min(1)` ở `field-def.ts` — bỏ tick khối cuối
            // cùng sẽ gửi `allowed: []` và bị server từ chối 400 SAU khi bấm
            // Lưu. Chặn ngay ở đây, cùng cách `EnumOptions` disable nút xoá khi
            // chỉ còn một lựa chọn.
            const isLastChecked = checked && field.allowed.length <= 1;
            return (
              <Check
                key={g.key}
                checked={checked}
                disabled={isLastChecked}
                title={isLastChecked ? 'Phải còn ít nhất một khối cho phép' : undefined}
                onChange={(v) => onUpdate(v ? [...field.allowed, g.key] : field.allowed.filter((k) => k !== g.key))}
                label={
                  <>
                    <span className="font-shell-mono">{g.key}</span> — {g.name}{' '}
                    <span className="text-shell-muted">({g.fieldCount} field)</span>
                  </>
                }
              />
            );
          })}
        </Checks>
      </Group>
      <NumField label="Số khối tối đa" value={field.max} onChange={onMax} />
      <p className={EXPLAIN}>
        Đây là đánh đổi có chủ đích so với Strapi: người nhập tự do xếp thứ tự và số lượng khối, nhưng loại khối
        mới cần một người dựng hình cho nó.
      </p>
    </>
  );
}
