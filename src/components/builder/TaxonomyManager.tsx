'use client';

/**
 * Cây danh mục — hai cấp.
 *
 * ## Vì sao hai cấp, không phải N cấp
 *
 * `Taxonomy.parentId` cho phép sâu bao nhiêu cũng được, nhưng giao diện ở đây chỉ
 * dựng hai. Ba cấp danh mục trên một site marketing là thứ chưa ai cần, và mỗi cấp
 * thêm vào là một câu hỏi mới mà chưa có câu trả lời ("lọc theo cha có gồm cháu
 * không?"). Khi nào có nhu cầu thật thì câu hỏi đó sẽ có ngữ cảnh để trả lời.
 *
 * ## Vì sao hộp xác nhận phải nói số bài
 *
 * Một hộp xác nhận không nói hậu quả thì chỉ dạy người ta bấm Đồng ý mà không đọc.
 * Số bài lấy từ `counts` — server đã đếm, nên câu nói ra là con số thật chứ không
 * phải một lời cảnh báo chung chung.
 *
 * ## Tên theo ngôn ngữ
 *
 * Mỗi ngôn ngữ không mặc định có một ô tên ngay dưới hàng. Lưu khi rời ô (hoặc
 * Enter), không có nút Lưu: ô trống = gỡ bản dịch, site hiện tên gốc. Tên dịch lên
 * site NGAY — danh mục không có lớp nháp.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { translatedName } from '@/lib/collections/taxonomy-locale';
import { focusRing, ui } from '@/lib/builder/ui';

import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { TextField } from './ui/Field';
import { Icon } from './ui/Icon';
import { ConfirmDialog } from './ui/Overlay';
import { EmptyState } from './ui/Page';

export interface TaxonomyRow {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  /** draft | published. Xem `Taxonomy.status`. */
  status: string;
  /** `{ en: { name } }` — xem `Taxonomy.i18n`. */
  i18n?: unknown;
}

/** Ngôn ngữ KHÔNG mặc định — mỗi cái một ô tên dưới mỗi hàng. */
export interface TaxonomyLocale {
  code: string;
  label: string;
}

export function TaxonomyManager(props: {
  typeKey: string;
  typeName: string;
  taxonomies: TaxonomyRow[];
  counts: Record<string, number>;
  locales: TaxonomyLocale[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `null` = ô nhập gốc đang mở; một id = ô nhập con của danh mục đó. */
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState<TaxonomyRow | null>(null);

  const roots = props.taxonomies.filter((t) => t.parentId === null);
  const childrenOf = (id: string) => props.taxonomies.filter((t) => t.parentId === id);

  async function create(parentId: string | null) {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/collections/taxonomies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `key` do server suy từ tên — client không tự đặt khoá, vì khoá là BẤT BIẾN
      // và hai chỗ sinh nó sẽ lệch nhau.
      body: JSON.stringify({ typeKey: props.typeKey, name: name.trim(), parentId: parentId ?? undefined }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? 'Không tạo được');
      return;
    }
    setName('');
    setAdding(undefined);
    router.refresh();
  }

  /**
   * Bật/tắt hiển thị.
   *
   * Không có hộp xác nhận, khác hẳn Xoá: tắt một danh mục không mất gì và bật lại
   * là một cú bấm. Hộp xác nhận cho một thao tác lùi được chỉ dạy người ta bấm
   * Đồng ý mà không đọc — và làm hộp của thao tác KHÔNG lùi được mất trọng lượng.
   */
  async function toggle(t: TaxonomyRow) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/collections/taxonomies/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: t.status !== 'published' }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? 'Không đổi được trạng thái');
      return;
    }
    router.refresh();
  }

  /** Ghi tên của một ngôn ngữ. Ô trống gửi `null` = gỡ bản dịch. */
  async function saveLocaleName(t: TaxonomyRow, locale: string, value: string) {
    const next = value.trim();
    if (next === (translatedName(t.i18n, locale) ?? '')) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/collections/taxonomies/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale, name: next || null }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? 'Không lưu được tên dịch');
      return;
    }
    router.refresh();
  }

  async function remove(t: TaxonomyRow) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/collections/taxonomies/${t.id}`, { method: 'DELETE' });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    setConfirming(null);
    if (!res.ok || !json.ok) {
      setError(json.error ?? 'Không xoá được');
      return;
    }
    router.refresh();
  }

  /*
   * Một hàm dựng hàng, không phải một component lồng: component khai báo TRONG thân
   * component cha là một kiểu mới ở mỗi lượt render, nên mọi hàng bị dựng lại từ đầu
   * và nút vừa bấm mất focus.
   */
  function row(t: TaxonomyRow, child: boolean) {
    const n = props.counts[t.id] ?? 0;
    const live = t.status === 'published';
    return (
      <div
        key={t.id}
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md py-2 pr-2 pl-3 hover:bg-shell-raised',
          child && 'ml-2',
        )}
      >
        <span className={cn('text-ui font-medium', !live && 'text-shell-muted')}>{t.name}</span>
        <span className="font-shell-mono text-mini text-shell-muted">{t.key}</span>
        <span className="text-small text-shell-muted tabular-nums">{n} bài</span>
        {/* Chỉ dán nhãn khi ĐANG ẨN. Một nhãn "đang hiện" trên mọi hàng là nhiễu:
            hiện là trạng thái thường, và mắt phải tìm được cái bất thường. */}
        {!live && <Badge size="sm">đang ẩn</Badge>}

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={live ? 'eye-off' : 'eye'}
            onClick={() => void toggle(t)}
            disabled={busy}
          >
            {live ? 'Ẩn' : 'Hiện'}
          </Button>
          {!child && (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              onClick={() => {
                setAdding(t.id);
                setName('');
              }}
            >
              Thêm con
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            onClick={() => setConfirming(t)}
            className="text-shell-danger hover:bg-shell-danger-soft"
          >
            Xoá
          </Button>
        </div>

        {props.locales.map((l) => (
          <LocaleNameField
            // Khoá theo giá trị đã lưu: lưu xong `router.refresh()` trả tên mới, và ô
            // phải nhận nó thay vì giữ chữ người vừa gõ (đã chuẩn hoá ở server).
            key={`${l.code}:${translatedName(t.i18n, l.code) ?? ''}`}
            label={`Tên ${l.label} của “${t.name}”`}
            code={l.code}
            initial={translatedName(t.i18n, l.code) ?? ''}
            placeholder={t.name}
            busy={busy}
            onSave={(v) => void saveLocaleName(t, l.code, v)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-shell-danger-soft px-4 py-3 text-small font-medium text-shell-danger">
          {error}
        </p>
      )}

      {roots.length === 0 ? (
        <EmptyState
          compact
          icon="tag"
          title="Chưa có danh mục nào"
          description="Bài viết vẫn nhập được — danh mục là cách xếp chúng, không phải điều kiện để đăng."
        />
      ) : (
        <div className={cn(ui.card, 'flex flex-col p-2')}>
          {roots.map((t) => (
            <div key={t.id} className="border-b border-shell-line py-1 last:border-b-0">
              {row(t, false)}
              {childrenOf(t.id).length > 0 && (
                <div className="ml-4 border-l-2 border-shell-line">
                  {childrenOf(t.id).map((c) => row(c, true))}
                </div>
              )}
              {adding === t.id && (
                <AddForm
                  label={`Tên danh mục con của “${t.name}”`}
                  placeholder={`Danh mục con của “${t.name}”`}
                  name={name}
                  setName={setName}
                  busy={busy}
                  onSubmit={() => void create(t.id)}
                  onCancel={() => setAdding(undefined)}
                  className="ml-10 py-2 pr-2"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {adding === null ? (
        <AddForm
          label="Tên danh mục gốc"
          placeholder="Tên danh mục gốc"
          name={name}
          setName={setName}
          busy={busy}
          onSubmit={() => void create(null)}
          onCancel={() => setAdding(undefined)}
          className={cn(ui.card, 'p-3')}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(null);
            setName('');
          }}
          className={cn(
            'flex h-control-lg w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-shell-line-strong text-ui font-semibold text-shell-muted transition-colors hover:border-shell-accent hover:bg-shell-panel hover:text-shell-accent',
            focusRing,
          )}
        >
          <Icon name="plus" size={18} />
          Thêm danh mục
        </button>
      )}

      {/* Xác nhận NÓI RÕ HẬU QUẢ. Ba câu, không rút ngắn được câu nào: bao nhiêu
          bài bị gỡ, bài có bị xoá không, và danh mục con đi đâu. */}
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) void remove(confirming);
        }}
        title={`Xoá danh mục "${confirming?.name ?? ''}"?`}
        consequence={
          <>
            Danh mục sẽ bị gỡ khỏi <b className="font-semibold">{confirming ? (props.counts[confirming.id] ?? 0) : 0} bài</b>.
            Bài viết <b className="font-semibold">không</b> bị xoá. Danh mục con sẽ thành danh mục gốc.
          </>
        }
        confirmLabel="Xoá danh mục"
        cancelLabel="Giữ lại"
        busy={busy}
      />
    </div>
  );
}

/**
 * Ô tên của một ngôn ngữ. Giữ chữ đang gõ ở state riêng của ô; lưu khi rời ô hoặc
 * Enter. Placeholder là tên gốc — đúng thứ site hiện khi ô trống.
 */
function LocaleNameField({
  label, code, initial, placeholder, busy, onSave,
}: {
  label: string;
  code: string;
  initial: string;
  placeholder: string;
  busy: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex basis-full items-center gap-2">
      <span className="w-8 font-shell-mono text-mini text-shell-muted uppercase">{code}</span>
      <TextField
        size="sm"
        label={label}
        hideLabel
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onSave(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSave(value);
          }
        }}
        placeholder={placeholder}
        disabled={busy}
        maxLength={120}
        wrapperClassName="w-64 max-w-full"
      />
    </div>
  );
}

/** Ô nhập tên + Thêm + bỏ — dùng cho cả danh mục gốc lẫn danh mục con. */
function AddForm({
  label, placeholder, name, setName, busy, onSubmit, onCancel, className,
}: {
  label: string;
  placeholder: string;
  name: string;
  setName: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      <TextField
        autoFocus
        size="md"
        label={label}
        hideLabel
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        wrapperClassName="w-64 max-w-full"
      />
      <Button type="submit" variant="primary" size="md" disabled={busy}>
        Thêm
      </Button>
      <Button variant="ghost" size="md" onClick={onCancel}>
        bỏ
      </Button>
    </form>
  );
}
