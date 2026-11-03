'use client';

/**
 * Khối "Form" trong Inspector: ô nhập (thêm, bớt, kéo sắp, loại, nhãn, gợi ý, bắt buộc,
 * trợ giúp, lựa chọn), chữ nút gửi, và "Sau khi gửi" (dòng chữ / hộp thoại / panel).
 *
 * ## Vì sao có nó
 *
 * Ô nhập là PARAMS của Composite, không phải node con (xem `formField` trong registry) —
 * nên cây Lớp và bảng style không chạm được chúng. Trước khối này, thêm một ô "Số điện
 * thoại" chỉ làm được qua AI/MCP. Nhãn và chữ nút vẫn sửa được (và DỊCH được) ở
 * `ContentPanel`; khối này lo phần cấu trúc mà ContentPanel không có.
 *
 * ## Luật ghi
 *
 * Mọi thay đổi đi qua hàm thuần ở `form-edit.ts` rồi MỘT `setProps` — undo, lịch sử và
 * validator (`composite_params`) đi theo không cần dòng code nào. Hàm thuần trả lỗi có
 * đường dẫn khi kết quả không qua `parseFormParamsStrict`: khối này KHÔNG ghi, và hiện
 * lỗi ngay cạnh ô gây ra nó. Ghi params hỏng thì `.catch` của renderer đưa cả form về
 * mặc định im lặng — đúng chống-mục-tiêu của spec.
 *
 * Ô chữ ghi khi rời ô (blur / Enter), không theo từng phím: mỗi phím một op là mỗi phím
 * một lần lưu, một mục undo và một lần nạp lại canvas.
 *
 * ## Ẩn ở chế độ bản dịch
 *
 * Cấu trúc form dùng chung mọi ngôn ngữ; nhãn của bản dịch sửa ở `ContentPanel`.
 */

import { useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import {
  DEFAULT_OPTIONS,
  FIELD_KINDS,
  addField,
  defaultAutocomplete,
  fieldsOf,
  moveField,
  optionsFromText,
  optionsToText,
  removeField,
  setAfterSubmitOps,
  setFormParam,
  updateField,
  type FieldKind,
  type FormEdit,
  type FormPreview,
  type FormTextParam,
} from '@/lib/builder/form-edit';
import { freshId } from '@/lib/builder/node-actions';
import { selectStyleLocked, useEditor } from '@/lib/builder/store';
import { focusRing, ui } from '@/lib/builder/ui';
import { resolveAfterSubmit, type AfterSubmit, type FormFieldDef, type FormParamsIssue } from '@/lib/composites/registry';
import type { CompositeNode, Doc } from '@/lib/doc/types';
import { SEG } from './controls';
import { IconButton } from './ui/Button';
import { Checkbox, SelectField, TextArea, TextField } from './ui/Field';
import { Icon } from './ui/Icon';

/** Cùng khuôn lời nhắc của `EndpointPicker`. */
const WARN = 'bg-shell-warn-soft text-shell-warn rounded-sm px-2.5 py-1.5 text-mini leading-snug';
const INFO = 'bg-shell-raised text-shell-muted rounded-sm px-2.5 py-1.5 text-mini leading-snug';

const AFTER_SUBMIT: { value: AfterSubmit; label: string }[] = [
  { value: 'inline', label: 'Dòng chữ dưới nút' },
  { value: 'dialog', label: 'Hộp thoại' },
  { value: 'panel', label: 'Chuyển panel của popup' },
];

const PREVIEW: { value: FormPreview; label: string }[] = [
  { value: 'form', label: 'Form' },
  { value: 'success', label: 'Thành công' },
  { value: 'error', label: 'Thất bại' },
];

/** Đường dẫn lỗi đã có chỗ hiện riêng cạnh một ô; phần còn lại hiện chung ở cuối khối. */
const PLACED = /^(fields(\.\d+\.(label|placeholder|help|options))?|submitLabel|successMessage|errorMessage|successPanel)(\.|$)/;

type RawField = FormFieldDef & Record<string, unknown>;

export function FormPanel({ node, doc }: { node: CompositeNode; doc: Doc }) {
  const dispatch = useEditor((s) => s.dispatch);
  const locked = useEditor(selectStyleLocked);
  const inComponent = useEditor((s) => s.target?.kind === 'component');
  const preview = useEditor((s) => s.formPreview[node.id] ?? 'form');
  const setPreview = useEditor((s) => s.setFormPreview);

  /** Lỗi theo NGUỒN (ô đã gây ra nó): ô đó ghi được thì chỉ lỗi của nó được xoá. */
  const [errors, setErrors] = useState<Record<string, FormParamsIssue[]>>({});
  /** Ô đang mở phần sửa chi tiết. */
  const [open, setOpen] = useState<string | null>(null);
  /**
   * Chỉ số ô đang kéo. Ref chứ không `dataTransfer` (kéo-thả chỉ trong khối này): `dragover`
   * và `drop` đọc nó ngay, không chờ render. State `dragging` chỉ để làm mờ hàng, đặt SAU
   * một nhịp — đổi DOM của nguồn kéo ngay trong `dragstart` là thứ trình duyệt được phép
   * coi là huỷ cú kéo.
   */
  const dragFrom = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const endDrag = () => {
    dragFrom.current = null;
    setDragging(null);
  };

  if (node.composite !== 'Form') return null;

  const fields = fieldsOf(node.params) as RawField[];
  const mode = resolveAfterSubmit((node.params ?? {}) as { afterSubmit?: string; successPanel?: string });
  const raw = (node.params ?? {}) as Record<string, unknown>;
  const text = (key: FormTextParam): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');

  const issues = Object.values(errors).flat();
  const errorAt = (path: string): string | undefined => {
    const hit = issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
    return hit.length ? hit.map((i) => i.message).join(' ') : undefined;
  };
  const general = issues.filter((i) => !PLACED.test(i.path));
  const listError = issues.filter((i) => i.path === 'fields').map((i) => i.message).join(' ');

  /** Ghi một kết quả của `form-edit`, hoặc giữ lỗi của nó. `structural`: chỉ số ô đổi → mọi lỗi cũ hết nghĩa. */
  const commit = (source: string, result: FormEdit, label: string, structural = false): boolean => {
    if (!result.ok) {
      setErrors((e) => ({ ...e, [source]: result.issues }));
      return false;
    }
    setErrors((e) => {
      if (structural) return {};
      const { [source]: _drop, ...rest } = e;
      return rest;
    });
    void dispatch([{ op: 'setProps', nodeId: node.id, props: { params: result.params } }], { label });
    return true;
  };

  const add = (kind: FieldKind) => {
    const r = addField(node.params, kind);
    if (commit('add', r, `thêm ô: ${kind}`, true) && r.ok) {
      setOpen((r.params.fields as { name: string }[]).at(-1)!.name);
    }
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    commit('move', moveField(node.params, from, to), 'sắp lại ô nhập', true);
  };

  const changeMode = (next: AfterSubmit) => {
    if (next === mode) return;
    const used = new Set<string>();
    const newId = () => {
      let id = freshId(doc);
      while (used.has(id)) id = freshId(doc);
      used.add(id);
      return id;
    };
    const r = setAfterSubmitOps(node, next, newId);
    if (!r.ok) {
      setErrors((e) => ({ ...e, afterSubmit: r.issues }));
      return;
    }
    setErrors(({ afterSubmit: _drop, ...rest }) => rest);
    if (next !== 'dialog') setPreview(node.id, 'form');
    void dispatch(r.ops, { label: `sau khi gửi: ${next}` });
  };

  return (
    <section data-form-panel="" className="flex flex-col gap-3 px-3.5" aria-label="Form">
      <h3 className={ui.eyebrow}>Form</h3>

      {inComponent && (
        // Form trong component: sửa là sửa COMPONENT — không có ghi đè params theo từng instance.
        <p className={WARN} data-form-component-note="">
          Sửa ở đây đổi mọi trang dùng component này.
        </p>
      )}

      {/* ── Ô nhập ── */}
      <div className="flex flex-col gap-1.5">
        <span className={ui.label}>Ô nhập</span>
        <ol className="flex flex-col gap-1" aria-label="Ô nhập">
          {fields.map((f, i) => (
            <li
              key={f.name}
              data-form-field={f.name}
              onDragOver={(e) => {
                if (dragFrom.current !== null) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom.current !== null) move(dragFrom.current, i);
                endDrag();
              }}
              className={cn(
                'bg-shell-raised rounded-sm',
                dragging === i && 'opacity-50',
              )}
            >
              <div className="flex items-center gap-1 py-1 pr-1 pl-1.5">
                {/* Tay kéo là NGUỒN kéo, cả hàng là ĐÍCH thả. Kéo từ cả hàng thì cú bấm vào nhãn
                    (mở phần sửa) dễ thành cú kéo, và trình duyệt không bắt đầu kéo từ một <button>.
                    Bàn phím dùng hai nút mũi tên bên phải. */}
                <span
                  className={cn('text-shell-muted flex self-stretch items-center px-0.5', locked ? 'cursor-not-allowed' : 'cursor-grab')}
                  aria-hidden
                  title="Kéo để sắp lại"
                  data-form-drag={f.name}
                  draggable={!locked}
                  onDragStart={(e) => {
                    dragFrom.current = i;
                    setTimeout(() => setDragging(i), 0);
                    // Firefox không bắt đầu kéo nếu không có dữ liệu.
                    e.dataTransfer.setData('text/plain', f.name);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={endDrag}
                >
                  <Icon name="drag" size={14} />
                </span>
                <button
                  type="button"
                  className={cn('text-shell-ink min-w-0 flex-1 truncate rounded-xs px-1 text-left text-mini', focusRing)}
                  aria-expanded={open === f.name}
                  onClick={() => setOpen((o) => (o === f.name ? null : f.name))}
                  title={`Sửa ô "${f.label}"`}
                >
                  <span className="font-medium">{f.label}</span>
                  {f.required && <span className="text-shell-danger" aria-label="bắt buộc"> *</span>}
                  <span className="text-shell-muted"> · {FIELD_KINDS.find((k) => k.kind === f.kind)?.label ?? f.kind}</span>
                </button>
                <IconButton
                  size="sm"
                  icon="arrow-up"
                  label={`Đưa ô "${f.label}" lên`}
                  disabled={locked || i === 0}
                  onClick={() => move(i, i - 1)}
                />
                <IconButton
                  size="sm"
                  icon="arrow-down"
                  label={`Đưa ô "${f.label}" xuống`}
                  disabled={locked || i === fields.length - 1}
                  onClick={() => move(i, i + 1)}
                />
                <IconButton
                  size="sm"
                  icon="trash"
                  variant="danger"
                  label={`Bỏ ô "${f.label}"`}
                  // Tối thiểu một ô: form không ô nào là một nút gửi trơ trọi.
                  disabled={locked || fields.length <= 1}
                  onClick={() => commit('remove', removeField(node.params, f.name), `bỏ ô: ${f.name}`, true)}
                />
              </div>

              {open === f.name && (
                <FieldEditor
                  field={f}
                  index={i}
                  locked={locked}
                  errorAt={errorAt}
                  onPatch={(patch, source) =>
                    commit(`${f.name}:${source}`, updateField(node.params, f.name, patch), `sửa ô: ${f.name}`)
                  }
                />
              )}
            </li>
          ))}
        </ol>
        {listError && <p className={ui.error}>{listError}</p>}

        <SelectField
          size="sm"
          label="Thêm ô"
          value=""
          disabled={locked || fields.length >= 12}
          onChange={(e) => {
            if (e.target.value) add(e.target.value as FieldKind);
          }}
        >
          <option value="">— Chọn loại ô để thêm —</option>
          {FIELD_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </SelectField>
      </div>

      {/* ── Nút gửi ── */}
      <CommitText
        label="Chữ nút gửi"
        value={text('submitLabel')}
        disabled={locked}
        error={errorAt('submitLabel')}
        onCommit={(v) => commit('submitLabel', setFormParam(node.params, 'submitLabel', v), 'đổi chữ nút gửi')}
      />

      {/* ── Sau khi gửi ── */}
      <SelectField
        size="sm"
        label="Sau khi gửi"
        value={mode}
        disabled={locked}
        onChange={(e) => changeMode(e.target.value as AfterSubmit)}
        options={AFTER_SUBMIT}
      />
      {errors.afterSubmit && (
        <p className={ui.error}>{errors.afterSubmit.map((i) => `${i.path}: ${i.message}`).join(' ')}</p>
      )}

      {mode === 'inline' && (
        <>
          <CommitText
            label="Lời báo thành công"
            value={text('successMessage')}
            disabled={locked}
            error={errorAt('successMessage')}
            onCommit={(v) => commit('successMessage', setFormParam(node.params, 'successMessage', v), 'đổi lời báo thành công')}
          />
          <CommitText
            label="Lời báo thất bại"
            value={text('errorMessage')}
            disabled={locked}
            error={errorAt('errorMessage')}
            onCommit={(v) => commit('errorMessage', setFormParam(node.params, 'errorMessage', v), 'đổi lời báo thất bại')}
          />
        </>
      )}

      {mode === 'dialog' && (
        <div className="flex flex-col gap-1.5">
          <span className={ui.label} id={`${node.id}-preview`}>Xem trước</span>
          {/* Chỉ đổi thứ CANVAS hiện — không ghi gì vào doc. Bật "Thành công" để thấy và
              bấm chọn node trong slot hộp thoại ngay trên canvas. */}
          <div className={SEG.group} role="group" aria-labelledby={`${node.id}-preview`} data-form-preview="">
            {PREVIEW.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={preview === p.value}
                className={cn(SEG.item, preview === p.value && SEG.on)}
                onClick={() => setPreview(node.id, p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className={INFO}>
            Nội dung hộp thoại là hai khối thật trong cây Lớp (slot <code>success</code> và{' '}
            <code>error</code>) — thêm chữ, ảnh, nút tuỳ ý.
          </p>
        </div>
      )}

      {mode === 'panel' && (
        <>
          <CommitText
            label="Panel khi thành công"
            mono
            value={text('successPanel')}
            disabled={locked}
            error={errorAt('successPanel')}
            hint="htmlId của panel trong popup bao ngoài (effect modal)."
            onCommit={(v) => commit('successPanel', setFormParam(node.params, 'successPanel', v.trim()), 'đổi panel thành công')}
          />
          {!text('successPanel') && (
            <p className={WARN}>Chưa có panel — gửi xong sẽ không có gì đổi trên màn hình.</p>
          )}
        </>
      )}

      {general.length > 0 && (
        <p className={WARN} data-form-errors="">
          Tham số của form đang sai, nên chưa ghi được:{' '}
          {general.map((i) => `${i.path || 'params'}: ${i.message}`).join('; ')}
        </p>
      )}
    </section>
  );
}

/** Phần sửa chi tiết của một ô. */
function FieldEditor({
  field,
  index,
  locked,
  errorAt,
  onPatch,
}: {
  field: RawField;
  index: number;
  locked: boolean;
  errorAt: (path: string) => string | undefined;
  onPatch: (patch: Partial<Omit<FormFieldDef, 'name'>>, source: string) => void;
}) {
  const at = (key: string) => errorAt(`fields.${index}.${key}`);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  return (
    <div className="border-shell-line flex flex-col gap-2 border-t px-2 pt-2 pb-2.5" data-form-field-editor={field.name}>
      <SelectField
        size="sm"
        label="Loại ô"
        value={field.kind}
        disabled={locked}
        onChange={(e) => {
          const kind = e.target.value as FieldKind;
          onPatch(
            {
              kind,
              // Đổi sang select: mang sẵn lựa chọn (select rỗng không qua schema). Đổi khỏi
              // select: gỡ lựa chọn — để lại thì nó nằm chết trong params.
              options: kind === 'select' ? (field.options?.length ? field.options : DEFAULT_OPTIONS) : undefined,
              autocomplete: defaultAutocomplete(kind),
            },
            'kind',
          );
        }}
        options={FIELD_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
      />
      <CommitText
        label="Nhãn"
        value={field.label}
        disabled={locked}
        error={at('label')}
        onCommit={(v) => onPatch({ label: v }, 'label')}
      />
      {field.kind !== 'checkbox' && (
        <CommitText
          label="Chữ gợi ý"
          value={str(field.placeholder)}
          disabled={locked}
          error={at('placeholder')}
          onCommit={(v) => onPatch({ placeholder: v || undefined }, 'placeholder')}
        />
      )}
      <Checkbox
        label="Bắt buộc"
        checked={field.required === true}
        disabled={locked}
        onChange={(e) => onPatch({ required: e.target.checked }, 'required')}
      />
      <CommitText
        label="Trợ giúp"
        value={str(field.help)}
        disabled={locked}
        error={at('help')}
        hint="Dòng nhỏ dưới ô; trình đọc màn hình cũng đọc."
        onCommit={(v) => onPatch({ help: v || undefined }, 'help')}
      />
      {field.kind === 'select' && (
        <CommitText
          label="Lựa chọn"
          multiline
          value={optionsToText(field.options)}
          disabled={locked}
          error={at('options')}
          hint="Mỗi dòng một mục. Cần giá trị gửi lên riêng thì viết giá_trị | Nhãn."
          onCommit={(v) => onPatch({ options: optionsFromText(v) }, 'options')}
        />
      )}
      <p className="text-shell-muted text-micro">
        Tên gửi lên: <code className="font-shell-mono text-shell-ink">{field.name}</code>
      </p>
    </div>
  );
}

/**
 * Ô chữ ghi khi RỜI ô (blur, hoặc Enter với ô một dòng).
 *
 * Không kiểm soát (`defaultValue`) và `key` theo giá trị đã lưu: ghi được thì giá trị mới
 * về từ doc và ô dựng lại với nó; ghi KHÔNG được thì giá trị lưu không đổi, ô giữ nguyên
 * chữ người dùng vừa gõ cạnh dòng lỗi — để họ sửa, không phải gõ lại từ đầu.
 */
function CommitText({
  label,
  value,
  onCommit,
  error,
  hint,
  disabled,
  mono,
  multiline,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  mono?: boolean;
  multiline?: boolean;
}) {
  const blur = (next: string) => {
    if (next !== value) onCommit(next);
  };
  if (multiline) {
    return (
      <TextArea
        key={value}
        size="sm"
        rows={4}
        label={label}
        defaultValue={value}
        disabled={disabled}
        error={error}
        hint={hint}
        mono={mono}
        onBlur={(e) => blur(e.currentTarget.value)}
      />
    );
  }
  return (
    <TextField
      key={value}
      size="sm"
      label={label}
      defaultValue={value}
      disabled={disabled}
      error={error}
      hint={hint}
      mono={mono}
      onBlur={(e) => blur(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
