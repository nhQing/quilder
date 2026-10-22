'use client';

/**
 * Bảng Văn bản — sửa bản gốc và bản dịch tại chỗ.
 *
 * ## Hai đường ghi, và vì sao chúng phải khác nhau
 *
 * Bản gốc là NỘI DUNG: nó nằm trong doc, nên ghi bằng op qua `/api/ops` — đi qua
 * 4 lớp validator, undo được, để lại một `PageVersion` bất biến.
 *
 * Bản dịch là LỚP PHỦ: nó không nằm trong doc (xem model `Translation`), nên ghi
 * qua `/api/translations`. Không undo được, đổi lại một chuỗi dịch là thao tác
 * một ô — gõ lại chuỗi cũ là hoàn nguyên.
 *
 * Gộp hai đường thành một sẽ buộc bản dịch vào doc, tức là quay về phương án fork
 * mà cả thiết kế này tránh.
 *
 * ## Vì sao ô có cấu trúc bị khoá
 *
 * `RichText` là cây inline node. Ghi một chuỗi phẳng ngược vào sẽ san phẳng cây:
 * link mất `href`, đoạn `split` mất mục tiêu và hiệu ứng tách chữ chết im lặng.
 * Bảng hiện chữ đã ghép để đọc được, nhưng dẫn sang trang sửa để sửa.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { fold } from '@/lib/builder/tree-filter';
import {
  fieldValueKind, flatRichText, parseInstanceAddress, sourceHash, unitKey,
  type TranslatableField, type TextUnit,
} from '@/lib/builder/text-units';
import { textWriteOps } from '@/lib/builder/text-write';
import { isParamField } from '@/lib/render/param-paths';
import { AssetField } from './AssetField';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { SearchField, SelectField } from './ui/Field';
import { Icon } from './ui/Icon';
import { Toast, ToastRegion } from './ui/Overlay';
import { EmptyState } from './ui/Page';
import { Tabs, type TabItem } from './ui/Tabs';
import type { Node } from '@/lib/doc/types';
import type { DraftTranslation } from '@/lib/i18n/queries';

/** Chữ dài hơn ngưỡng này là chỗ dễ vỡ hình nhất ở khổ 390px. */
const LONG = 200;

type Filter = 'all' | 'empty' | 'holder' | 'dup' | 'long' | 'structured' | 'untranslated' | 'stale';

interface LocaleRow {
  code: string;
  label: string;
  enabled: boolean;
}

/** Bản dịch đã lập chỉ mục theo `locale` rồi `nodeId:field`. */
type TransIndex = Map<string, Map<string, DraftTranslation>>;

function indexTranslations(
  raw: Record<string, DraftTranslation[]>,
): TransIndex {
  const out: TransIndex = new Map();
  for (const [locale, rows] of Object.entries(raw)) {
    const inner = new Map<string, DraftTranslation>();
    for (const r of rows) inner.set(unitKey(r.nodeId, r.field as TranslatableField), r);
    out.set(locale, inner);
  }
  return out;
}

/** Chữ hiện trong ô dịch: bản dịch nếu có, không thì chuỗi rỗng. */
function transText(row: DraftTranslation | undefined): string {
  if (!row) return '';
  if (typeof row.value === 'string') return row.value;
  if (Array.isArray(row.value)) {
    const first = row.value[0] as { t?: string; v?: string } | undefined;
    return first?.t === 'text' ? (first.v ?? '') : '';
  }
  return '';
}

/**
 * Node của những đơn vị ghi vào OBJECT LỒNG, theo `TextUnit.nodeId`.
 *
 * CHỈ chúng, không phải `doc.nodes`. Docblock của `builder/text/page.tsx` nói rõ vì
 * sao bảng này không nhận cả doc: "hàng trăm KB cho một bảng 10KB", và client sẽ
 * phải lặp lại logic rút đơn vị. Hai trường `href` và `a11yLabel` là toàn bộ nhu
 * cầu, nên thứ gửi xuống là một map vài phần tử — thường là mấy cái nút.
 */
export type NestedWriteNodes = Readonly<Record<string, Node>>;

/**
 * Op ghi BẢN GỐC của một đơn vị chữ.
 *
 * Tách khỏi `saveSource` và export để test được. Phần đáng sai không phải cái
 * `fetch` mà là ĐỦ HAY THIẾU đối số đưa xuống `textWriteOps` — và một đối số thiếu
 * trông y hệt một đối số đủ khi đọc mã. Cùng khuôn với `attachInert` ở `Canvas.tsx`.
 */
export function sourceWriteFor(nodes: NestedWriteNodes, unit: TextUnit, text: string) {
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
     * Đơn vị trong instance có địa chỉ `instanceId/localId` và KHÔNG nằm trong map
     * này. Tra ra `undefined` là đúng: `textWriteOps` rẽ sang `setOverride` trước
     * khi chạm tới `node`.
     */
    node: nodes[unit.nodeId],
  });
}

export function TextTable({
  pageId,
  units,
  nodes,
  targets,
  sourceLabel,
  translations,
}: {
  pageId: string;
  units: TextUnit[];
  /** Xem `NestedWriteNodes` — chỉ node của đơn vị `href`/`a11yLabel`. */
  nodes: NestedWriteNodes;
  targets: LocaleRow[];
  sourceLabel: string;
  translations: Record<string, DraftTranslation[]>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [locale, setLocale] = useState<string | null>(targets[0]?.code ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const trans = useMemo(() => indexTranslations(translations), [translations]);
  const current = locale ? trans.get(locale) : undefined;

  /**
   * Chuỗi gốc nào xuất hiện nhiều hơn một lần trong trang này.
   *
   * CHỈ đơn vị chữ. Giá trị của đơn vị ảnh/video là một `cuid`, và dùng lại một
   * tấm ảnh ở hai chỗ là chuyện bình thường — đếm nó vào đây thì huy hiệu trùng
   * báo động cho đúng thứ nên làm.
   */
  const dups = useMemo(() => {
    const seen = new Map<string, number>();
    for (const u of units) {
      if (fieldValueKind(u.field) !== 'text') continue;
      const t = u.text.trim();
      if (t) seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    return seen;
  }, [units]);

  const isEmpty = (u: TextUnit) => !u.text.trim();
  const isHolder = (u: TextUnit) => /\[chờ nội dung\]/i.test(u.text);
  const isLong = (u: TextUnit) => u.text.trim().length > LONG;
  const isDup = (u: TextUnit) =>
    fieldValueKind(u.field) === 'text' && (dups.get(u.text.trim()) ?? 0) > 1;
  const rowFor = (u: TextUnit) => current?.get(unitKey(u.nodeId, u.field));
  const isUntranslated = (u: TextUnit) => !transText(rowFor(u)).trim();
  /**
   * Bản gốc đã đổi SAU khi dịch.
   *
   * Không có phép kiểm này thì bản tiếng Anh nói một đằng, tiếng Việt nói một
   * nẻo, và không có gì trên giao diện cho biết cái nào mới.
   */
  const isStale = (u: TextUnit) => {
    const row = rowFor(u);
    return Boolean(row) && row!.sourceHash !== sourceHash(u.text);
  };

  const counts = {
    all: units.length,
    empty: units.filter(isEmpty).length,
    holder: units.filter(isHolder).length,
    dup: units.filter(isDup).length,
    long: units.filter(isLong).length,
    structured: units.filter((u) => !u.flat).length,
    untranslated: locale ? units.filter(isUntranslated).length : 0,
    stale: locale ? units.filter(isStale).length : 0,
  };

  const shown = units.filter((u) => {
    if (query) {
      const hay = fold(`${u.text} ${u.path} ${u.kind} ${transText(rowFor(u))}`);
      if (!hay.includes(fold(query))) return false;
    }
    switch (filter) {
      case 'empty': return isEmpty(u);
      case 'holder': return isHolder(u);
      case 'dup': return isDup(u);
      case 'long': return isLong(u);
      case 'structured': return !u.flat;
      case 'untranslated': return isUntranslated(u);
      case 'stale': return isStale(u);
      default: return true;
    }
  });

  /*
   * Toast thành công tự tắt sau 5 giây; toast lỗi ở lại tới khi người dùng đóng —
   * lỗi tắt tự động là lỗi người ta có thể không kịp đọc. Một hẹn giờ duy nhất:
   * hẹn giờ của toast cũ không được tắt mất toast mới.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flash = (ok: boolean, text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNote({ ok, text });
    if (ok) timer.current = setTimeout(() => setNote(null), 5000);
  };

  /** Ghi bản GỐC — đi qua hệ op, nên undo được như mọi thao tác khác. */
  const saveSource = async (u: TextUnit, text: string) => {
    const key = `vi:${unitKey(u.nodeId, u.field)}`;
    setBusy(key);
    try {
      /*
       * Dựng op bằng `textWriteOps`, KHÔNG tự viết.
       *
       * Bản trước dựng tại chỗ, và docblock của `text-write.ts` nói thẳng nó tồn
       * tại để "hai giao diện không thể ghi khác nhau" — nhưng bảng này chưa bao
       * giờ gọi nó. Hai bản đã trôi ngay lần đầu có trường mới: thêm
       * `assetId`/`posterAssetId`/`href` vào tập dịch được thì bản ở đây rơi
       * xuống nhánh cuối và ghi chúng vào `a11y.label`. Không lỗi, không cảnh
       * báo — một tấm ảnh biến thành nhãn trợ năng.
       *
       * Nó cũng là chỗ giữ luật nguy hiểm nhất: đơn vị trong INSTANCE phải ghi
       * bằng `setOverride`. Dùng `setText` với `localId` sẽ sửa CÂY COMPONENT,
       * tức đổi mọi trang đang dùng nó thay vì đổi một chỗ.
       */
      const addr = parseInstanceAddress(u.nodeId);
      const write = sourceWriteFor(nodes, u, text);

      const res = await fetch('/api/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId, label: `${write.label}: ${u.path}`, ops: write.ops }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        flash(false, data.error ?? `Không lưu được (${res.status})`);
        return;
      }
      flash(
        true,
        addr
          ? 'Đã lưu nội dung riêng của instance — component không đổi'
          : 'Đã lưu bản gốc — undo được bằng Ctrl+Z trong trang sửa',
      );
      router.refresh();
    } catch {
      flash(false, 'Mất kết nối');
    } finally {
      setBusy(null);
    }
  };

  /** Ghi bản DỊCH — lớp phủ, không nằm trong doc. */
  const saveTranslation = async (u: TextUnit, text: string) => {
    if (!locale) return;
    const key = `${locale}:${unitKey(u.nodeId, u.field)}`;
    setBusy(key);
    try {
      const isRich = u.field === 'content' || u.field === 'label';
      const value = !text.trim() ? null : isRich ? flatRichText(text) : text;

      const res = await fetch('/api/translations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId, locale, nodeId: u.nodeId, field: u.field, value }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        flash(false, data.error ?? `Không lưu được (${res.status})`);
        return;
      }
      flash(true, text.trim() ? 'Đã lưu bản dịch — Publish để đưa lên site' : 'Đã xoá bản dịch');
      router.refresh();
    } catch {
      flash(false, 'Mất kết nối');
    } finally {
      setBusy(null);
    }
  };

  const localeLabel = locale ? (targets.find((t) => t.code === locale)?.label ?? locale) : null;

  const filters: TabItem<Filter>[] = [
    { id: 'all', label: 'tất cả', count: counts.all },
    { id: 'empty', label: 'rỗng', count: counts.empty },
    { id: 'holder', label: 'chờ nội dung', count: counts.holder },
    { id: 'dup', label: 'trùng', count: counts.dup },
    { id: 'long', label: 'quá dài', count: counts.long },
    { id: 'structured', label: 'có cấu trúc', count: counts.structured },
    ...(locale
      ? ([
          { id: 'untranslated', label: 'chưa dịch', count: counts.untranslated },
          { id: 'stale', label: 'cần dịch lại', count: counts.stale },
        ] as const)
      : []),
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchField
          size="md"
          label="Tìm trong bảng chữ"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="tìm chữ, tên node, gõ không dấu vẫn ra…"
          wrapperClassName="min-w-48 max-w-[26rem] flex-[1_1_18rem]"
        />

        {/* Bấm lại chính bộ lọc đang bật thì tắt nó. Không có đường tắt về "tất cả"
            thì người ta sẽ tải lại trang. */}
        <Tabs
          label="Lọc đơn vị"
          size="sm"
          items={filters}
          value={filter}
          onChange={(id) => setFilter(id === filter ? 'all' : id)}
        />

        {targets.length > 0 && <LocalePicker targets={targets} value={locale} onChange={setLocale} />}
      </div>

      {shown.length ? (
        <div className={ui.tableWrap}>
          <table className={cn(ui.table, 'min-w-[56rem]')}>
            <caption className="sr-only">Đơn vị văn bản của trang đang chọn</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(ui.th, 'w-52')}>Vị trí</th>
                <th scope="col" className={cn(ui.th, 'w-24')}>Loại</th>
                <th scope="col" className={ui.th}>{sourceLabel}</th>
                {localeLabel && <th scope="col" className={cn(ui.th, 'w-[28%]')}>{localeLabel}</th>}
                <th scope="col" className={cn(ui.th, 'w-14')}>
                  <span className="sr-only">Mở trong trang sửa</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const key = unitKey(u.nodeId, u.field);
                const row = rowFor(u);
                return (
                  <tr key={key} className={ui.tr}>
                    {/* Chỉ đường dẫn, KHÔNG lặp tên trang.
                        Bảng chỉ hiện một trang mỗi lần và tên trang đã ở tab phía
                        trên; in nó lại 71 lần chiếm hết cột và đẩy đường dẫn — thứ
                        duy nhất khác nhau giữa các hàng — xuống dòng. */}
                    <td className={cn(ui.td, 'max-w-56 align-top')}>
                      <span className="font-shell-mono block text-mini break-words text-shell-muted">{u.path}</span>
                    </td>

                    <td className={cn(ui.td, 'align-top')}>
                      <Badge size="sm" title={u.kind}>{u.kind}</Badge>
                    </td>

                    <td className={cn(ui.td, 'min-w-64 align-top')}>
                      {fieldValueKind(u.field) === 'asset' ? (
                        <AssetCell
                          value={u.text || null}
                          readOnly={u.locked}
                          onPick={(id) => void saveSource(u, id ?? '')}
                        />
                      ) : (
                        <Cell
                          value={u.text}
                          // `param:*` chỉ dịch ở bảng này; sửa chữ gốc của params làm ở
                          // Inspector — ghi một chuỗi vào giữa params cần params hiện tại,
                          // thứ mà bảng này (cố ý) không tải xuống.
                          readOnly={!u.flat || u.locked || isParamField(u.field)}
                          busy={busy === `vi:${key}`}
                          label={`Sửa bản gốc ${u.path}`}
                          onSave={(text) => void saveSource(u, text)}
                          empty={isEmpty(u)}
                          danger={isHolder(u)}
                          emptyHint="(rỗng)"
                        />
                      )}
                      <Flags>
                        {!u.flat && <Badge size="sm" tone="accent">có cấu trúc</Badge>}
                        {u.locked && <Badge size="sm" tone="danger">đã khoá</Badge>}
                        {isDup(u) && <Badge size="sm" tone="warn">{dups.get(u.text.trim())} chỗ</Badge>}
                        {isLong(u) && <Badge size="sm" tone="warn">{u.text.trim().length} ký tự</Badge>}
                      </Flags>
                    </td>

                    {locale && (
                      <td className={cn(ui.td, 'min-w-64 align-top')}>
                        {fieldValueKind(u.field) === 'asset' ? (
                          <AssetCell
                            value={transText(row) || null}
                            readOnly={u.locked}
                            // Gỡ ảnh = xoá bản dịch = dùng lại ảnh bản gốc. Không có
                            // trạng thái thứ ba "bản dịch cố ý không có ảnh": một node
                            // ảnh không có ảnh thì bản gốc cũng đã không có.
                            onPick={(id) => void saveTranslation(u, id ?? '')}
                            fallback={u.text || null}
                          />
                        ) : (
                          <Cell
                            value={transText(row)}
                            // Đơn vị có cấu trúc cũng không dịch phẳng được: bản dịch
                            // sẽ là một đoạn phẳng thay cho một cây có link.
                            readOnly={!u.flat || u.locked}
                            busy={busy === `${locale}:${key}`}
                            label={`Sửa bản dịch ${u.path}`}
                            onSave={(text) => void saveTranslation(u, text)}
                            placeholder={u.text || '—'}
                            empty={false}
                            emptyHint={u.flat ? 'chưa dịch' : 'sửa trong trang'}
                          />
                        )}
                        <Flags>
                          {isStale(u) && <Badge size="sm" tone="warn">bản gốc đã đổi</Badge>}
                          {row && (
                            <span className="text-mini text-shell-muted" title={row.updatedBy}>
                              {row.updatedBy.split('@')[0]}
                            </span>
                          )}
                        </Flags>
                      </td>
                    )}

                    <td className={cn(ui.td, 'align-top whitespace-nowrap')}>
                      <Link
                        href={`/builder/${pageId}?node=${u.nodeId}`}
                        aria-label={`Mở node ${u.nodeId} trong trang sửa`}
                        title={`Mở node ${u.nodeId} trong trang sửa`}
                        className={cn(
                          '-my-1 inline-grid size-control-sm place-items-center rounded-sm text-shell-muted transition-colors hover:bg-shell-panel hover:text-shell-accent',
                          focusRing,
                        )}
                      >
                        <Icon name="external" size={16} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : units.length ? (
        <EmptyState
          compact
          icon="search"
          title="Không có đơn vị nào khớp."
          description="Đổi từ khoá, hoặc bấm lại bộ lọc đang bật để tắt nó."
        />
      ) : (
        <EmptyState compact icon="text" title="Trang này chưa có chữ nào." />
      )}

      <p className="text-small text-shell-muted">
        {shown.length}/{units.length} đơn vị đang hiện. Bản gốc đi qua hệ op nên undo được;
        bản dịch là lớp phủ, cần Publish để lên site.
      </p>

      <ToastRegion>
        {note && (
          <Toast
            tone={note.ok ? 'ok' : 'danger'}
            title={note.text}
            onClose={() => setNote(null)}
          />
        )}
      </ToastRegion>
    </>
  );
}

/* ── Mảnh nhỏ ─────────────────────────────────────────────────────────── */

/**
 * "Cột dịch": nhãn đứng CẠNH ô, không trên ô — trên thanh công cụ một dòng, nhãn
 * trên ô làm cả hàng cao gấp đôi chỉ vì một ô.
 */
function LocalePicker({
  targets, value, onChange,
}: {
  targets: LocaleRow[];
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="ml-auto flex items-center gap-2">
      <label htmlFor={id} className="text-small font-medium text-shell-muted">
        Cột dịch
      </label>
      <SelectField
        id={id}
        size="md"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-auto"
      >
        <option value="">— ẩn —</option>
        {targets.map((t) => (
          <option key={t.code} value={t.code}>
            {t.label}
            {t.enabled ? '' : ' (chưa bật)'}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function Flags({ children }: { children: React.ReactNode }) {
  return <span className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">{children}</span>;
}

/**
 * Ô chọn ASSET — cho `assetId` và `posterAssetId`.
 *
 * ## Vì sao không dùng `Cell`
 *
 * `Cell` là một `<textarea>` và giá trị của nó là chữ người đọc thấy. Giá trị ở
 * đây là một `cuid` — không ai gõ được nó, không ai đọc được nó, và một ô chữ
 * chứa cuid là một ô chỉ có thể dán vào sai.
 *
 * ## Vì sao không có `busy`
 *
 * `AssetPickerBox` mở một hộp thoại; lúc quay ra thì thao tác đã xong và bảng đã
 * `router.refresh()`. Trạng thái "đang lưu" của `Cell` tồn tại vì ô chữ lưu khi
 * rời ô (blur), tức người dùng có thể gõ tiếp ngay — không phải tình huống ở đây.
 *
 * ## `fallback` — thứ mà cột bản dịch phải nói ra
 *
 * Chưa dịch nghĩa là dùng lại ảnh bản gốc, và ô sẽ hiện TRỐNG. Trống trông y hệt
 * "bản dịch cố ý không có ảnh" — hai chuyện khác hẳn nhau. Nên khi chưa dịch, ô
 * bày đúng tấm ảnh sẽ hiện ra, mờ đi, kèm chữ "theo bản gốc".
 */
function AssetCell({
  value,
  readOnly,
  onPick,
  fallback,
}: {
  value: string | null;
  readOnly: boolean;
  onPick: (id: string | null) => void;
  /** Ảnh của bản gốc — chỉ truyền ở cột bản dịch. */
  fallback?: string | null;
}) {
  const showing = value ?? fallback ?? null;

  if (readOnly) {
    return <span className="text-small text-shell-muted italic">đã khoá</span>;
  }

  return (
    <div className={cn('max-w-[9rem]', !value && fallback && 'opacity-60')}>
      <AssetField imageOnly={false} value={showing} onPick={onPick} />
      {!value && fallback && <span className="mt-1 block text-mini text-shell-muted">theo bản gốc</span>}
    </div>
  );
}

/**
 * Ô chữ: bấm để sửa, Enter lưu, Escape huỷ.
 *
 * Dùng `<textarea>` chứ không `<input>`: đoạn dài nhất trong trang là 334 ký tự,
 * và một ô một dòng buộc phải cuộn ngang để đọc chính thứ mình đang sửa.
 */
function Cell({
  value, readOnly, busy, label, onSave, placeholder, empty, danger, emptyHint,
}: {
  value: string;
  readOnly?: boolean;
  busy?: boolean;
  label: string;
  onSave: (text: string) => void;
  placeholder?: string;
  empty?: boolean;
  danger?: boolean;
  /** Chữ hiện khi ô CHỈ-ĐỌC và trống. Trống ở đây không phải lỗi. */
  emptyHint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const hintId = useId();

  if (readOnly) {
    return (
      <p
        className="leading-snug break-words text-shell-muted"
        title="Có link hoặc hiệu ứng tách chữ bên trong — sửa trong trang để không mất cấu trúc"
      >
        {value || (
          // Ô chỉ-đọc trống KHÔNG phải lỗi: đơn vị có cấu trúc thì cột dịch chưa
          // có gì là chuyện bình thường. Tô đỏ "(rỗng)" ở đây làm cả cột trông
          // như đang hỏng, và người dùng học cách phớt lờ màu đỏ thật.
          <span className="italic">{emptyHint ?? '—'}</span>
        )}
      </p>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Bấm để sửa"
        // aria-label tường minh, không để accessible name rơi về nội dung ô.
        //
        // Không có nó thì screen reader đọc "Về chúng tôi, nút" — nghe được chữ
        // nhưng không biết bấm vào sẽ ra gì. Vẫn CHỨA chữ đang hiện, nên vẫn thoả
        // WCAG 2.5.3 (label in name) cho người dùng điều khiển bằng giọng nói.
        aria-label={`${label}: ${value || '(trống)'}`}
        className={cn(
          '-mx-2 -my-1.5 block w-[calc(100%+1rem)] cursor-text rounded-sm border border-transparent px-2 py-1.5 text-left leading-snug break-words transition-colors hover:border-shell-line-strong hover:bg-shell-panel',
          focusRing,
          busy && 'cursor-wait opacity-50',
          empty && 'text-shell-danger italic',
          danger && 'text-shell-danger',
        )}
      >
        {value || (empty ? '(rỗng)' : (
          <span className="text-shell-muted italic">{placeholder ?? '—'}</span>
        ))}
      </button>
    );
  }

  const finish = (save: boolean) => {
    setEditing(false);
    if (save && draft !== value) onSave(draft);
  };

  /*
   * Hai nút Huỷ/Lưu là lối cho chuột, không phải đường thứ hai: rời ô (blur) đã là
   * lưu. `onMouseDown` chặn mất focus nên bấm Huỷ không kịp kích blur-lưu trước;
   * `tabIndex={-1}` vì Tab ra khỏi ô cũng là blur — bàn phím đã có Enter và Esc.
   */
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        autoFocus
        value={draft}
        aria-label={label}
        aria-describedby={hintId}
        rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 48)))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          // Enter lưu; Shift+Enter xuống dòng. Ngược lại thì không gõ được đoạn
          // nhiều dòng, mà đoạn pháp lý ở chân trang chính là loại đó.
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
          if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        }}
        // `h-auto!` chứ không `h-auto`: tailwind-merge không nhận `h-control-md` là
        // cùng nhóm nên giữ cả hai, và trong CSS `h-control-md` đứng sau — ô bị ghim
        // 36px, `rows` mất tác dụng.
        className={cn(ui.fieldMd, 'h-auto! resize-y py-2 leading-snug')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span id={hintId} className={cn(ui.hint, 'mr-auto')}>
          Enter lưu · Shift+Enter xuống dòng · Esc huỷ
        </span>
        <Button size="sm" variant="ghost" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => finish(false)}>
          Huỷ
        </Button>
        <Button size="sm" variant="primary" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => finish(true)}>
          Lưu
        </Button>
      </div>
    </div>
  );
}
