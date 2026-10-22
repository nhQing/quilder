'use client';

/**
 * Kho dữ liệu — thẻ loại nội dung và nhóm field.
 *
 * Hai khu tách nhau bằng tiêu đề, và khu thứ hai có một câu nói thẳng rằng nhóm
 * field KHÔNG phải Component. Bỏ câu đó đi là để hai khái niệm cùng tên nằm cạnh
 * nhau trong cùng một màn — và người dùng sẽ mở sai chỗ, rồi kết luận công cụ hỏng.
 *
 * Component này dựng cả đầu trang: nút "Sắp xếp" ở đó bật chế độ cho CẢ HAI khu,
 * nên nó cần cùng state với lưới.
 *
 * ## Vì sao sắp xếp là một CHẾ ĐỘ, không phải hai mũi tên thường trực
 *
 * Kho dự kiến lên khoảng 10 loại. Hiện mũi tên trên mọi thẻ nghĩa là ~20 điều khiển
 * đứng suốt trên màn để phục vụ một việc làm vài tháng một lần — đúng thứ mật độ
 * mà màn này vừa được dọn đi. Bấm "Sắp xếp" thì mũi tên hiện ra, bấm "Xong" thì
 * biến mất; thứ tự đã ghi ngay lúc bấm mũi tên nên "Xong" không phải nút Lưu.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Badge, Tile } from './ui/Badge';
import { Button, ButtonLink, IconButton } from './ui/Button';
import { Checkbox, TextField } from './ui/Field';
import { Icon, type IconName } from './ui/Icon';
import { ConfirmDialog, Dialog } from './ui/Overlay';
import { PageHeader, Section } from './ui/Page';

export interface TypeCard {
  key: string; name: string; namePlural: string; icon: string | null;
  singleton: boolean; entryCount: number; draftCount: number; scheduledCount: number;
  fieldCount: number;
}
export interface GroupCard {
  key: string; name: string; icon: string | null; fieldCount: number; usedBy: number;
}

export function CollectionTypeGrid({ types, groups }: { types: TypeCard[]; groups: GroupCard[] }) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState('');
  const [namePlural, setNamePlural] = useState('');
  const [singleton, setSingleton] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Loại đang chờ xác nhận xoá, và lỗi server trả cho lần xoá đó. */
  const [deleting, setDeleting] = useState<TypeCard | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);

  /*
   * Thứ tự đang hiện, khi người dùng vừa đổi nó trong lượt này.
   *
   * `null` = chưa đụng, dùng nguyên thứ tự server trả. Giữ hai mảng KHOÁ chứ không
   * hai mảng thẻ: props có thể mang số đếm mới (`entryCount` đổi vì ai đó vừa đăng
   * bài) và một bản sao thẻ cũ sẽ đóng băng con số đó lại.
   */
  const [sorting, setSorting] = useState(false);
  const [typeOrder, setTypeOrder] = useState<string[] | null>(null);
  const [groupOrder, setGroupOrder] = useState<string[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);

  const shownTypes = applyOrder(types, typeOrder);
  const shownGroups = applyOrder(groups, groupOrder);

  /**
   * Xoá một loại nội dung, cùng mọi danh mục của nó.
   *
   * Bắt gõ lại `key` (`ConfirmDialog` với `typeToConfirm`) chứ không chỉ một nút xác
   * nhận: thao tác này không lùi được, và cú bấm thứ hai đi qua bằng đúng phản xạ của
   * cú bấm thứ nhất. Gõ lại buộc mắt phải đọc, và nó chặn đúng lỗi thật — bấm nhầm
   * thẻ bên cạnh.
   *
   * Hậu quả được nói ra TRƯỚC khi hỏi: danh mục không hiện trên thẻ này, nên người
   * bấm không có cách nào khác để biết mình đang mất gì.
   */
  async function removeType(t: TypeCard) {
    setBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/collections/types/${t.key}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setDeleteError(json.error ?? `Lỗi ${res.status}`);
        return;
      }
      setDeleting(null);
      router.refresh();
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Đổi chỗ một thẻ với hàng xóm, ghi ngay, và trả về chỗ cũ nếu server từ chối.
   *
   * Cập nhật lạc quan: 10 thẻ và một lần bấm thì chờ round-trip rồi mới nhúc nhích
   * là thấy giật. Đổi lại, thất bại PHẢI lùi được — không thì màn hiện một thứ tự
   * mà DB không có, và người dùng chỉ biết khi mở lại trang ở máy khác.
   */
  async function move(kind: 'type' | 'group', index: number, dir: -1 | 1) {
    const cur = (kind === 'type' ? shownTypes : shownGroups).map((i) => i.key);
    const j = index + dir;
    if (j < 0 || j >= cur.length) return;
    const next = [...cur];
    [next[index], next[j]] = [next[j]!, next[index]!];

    const set = kind === 'type' ? setTypeOrder : setGroupOrder;
    set(next);
    setTypesError(null);

    const res = await fetch('/api/collections/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, keys: next }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      set(cur);
      setTypesError(json.error ?? 'Không lưu được thứ tự');
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/collections/types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `key` suy từ tên ở server bằng `toSlug` — client không tự đặt khoá, vì
      // khoá là BẤT BIẾN và hai chỗ sinh nó sẽ lệch nhau.
      body: JSON.stringify({ key: name, name, namePlural, singleton }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; type?: { key: string } };
    setBusy(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? 'Không tạo được');
      return;
    }
    setNewOpen(false);
    // Đi thẳng sang màn cấu trúc: loại mới chỉ có Tiêu đề và Đường dẫn, nên việc
    // tiếp theo LUÔN là thêm field. Đưa họ về màn danh sách là bắt bấm thêm một
    // lần cho một quyết định không có.
    router.push(`/builder/content/types/${json.type!.key}`);
  }

  async function createGroup() {
    setGroupBusy(true);
    setGroupError(null);
    // Nhóm field không có "tên số nhiều" hay "đơn lẻ" — hai thứ đó chỉ có nghĩa
    // với một loại nội dung (bảng entry, route). Một nhóm chỉ có tên và schema,
    // và schema rỗng là hợp lệ (`validateCollectionSchema([], groups, 'group')`
    // nhận) — field đầu tiên là việc của màn cấu trúc nhóm (Task 4).
    const res = await fetch('/api/collections/groups', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: groupName, name: groupName, schema: [] }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; group?: { key: string } };
    setGroupBusy(false);
    if (!res.ok || !json.ok) {
      setGroupError(json.error ?? 'Không tạo được');
      return;
    }
    setGroupOpen(false);
    router.push(`/builder/content/groups/${json.group!.key}`);
  }

  const canSort = types.length > 1 || groups.length > 1;

  return (
    <>
      <PageHeader
        title="Kho dữ liệu"
        description="Bản ghi có cấu trúc như tin tức, FAQ, sống độc lập với trang. Đăng bài không cần publish release."
        actions={
          canSort && (
            <Button
              variant={sorting ? 'primary' : 'secondary'}
              icon={sorting ? 'check' : 'sliders'}
              onClick={() => setSorting((v) => !v)}
            >
              {sorting ? 'Xong' : 'Sắp xếp'}
            </Button>
          )
        }
      />

      {sorting && (
        <p className={cn(ui.hint, '-mt-3')}>
          Bấm mũi tên trên thẻ để đổi chỗ. Thứ tự lưu ngay lúc bấm — “Xong” chỉ ẩn mũi tên đi.
        </p>
      )}

      <Section id="kho-loai" title="Loại nội dung" count={types.length}>
        {typesError && (
          <p role="alert" className={ui.error}>
            {typesError}
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18.75rem,1fr))] gap-5">
          {shownTypes.map((t, i) => (
            <article key={t.key} aria-label={t.name} className={cn(ui.card, 'flex min-w-0 flex-col gap-3.5 p-5')}>
              <div className="flex items-start justify-between gap-3">
                <Tile index={i} icon={typeIcon(t.icon)} />
                {sorting && (
                  <Move name={t.name} i={i} total={shownTypes.length} onMove={(d) => void move('type', i, d)} />
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="flex flex-wrap items-center gap-2 text-card font-semibold">
                  {t.name}
                  {t.singleton && <Badge size="sm">đơn lẻ</Badge>}
                </h3>
                <p className="font-shell-mono text-small break-all text-shell-muted">{t.key}</p>
              </div>

              <ul className="flex flex-col gap-1.5 text-small text-shell-muted">
                {t.singleton ? (
                  <Bullet>một entry duy nhất</Bullet>
                ) : (
                  /* Proto dùng danh từ riêng theo loại ("bài", "câu", "sự kiện"). Không
                     có field nào trong schema đỡ cho một danh từ riêng như vậy, nên
                     dùng "mục" chung — đơn giản hoá có chủ đích, không phải sơ suất. */
                  <Bullet>
                    {t.entryCount} mục · {t.draftCount} nháp
                    {t.scheduledCount > 0 && <> · {t.scheduledCount} hẹn giờ</>}
                  </Bullet>
                )}
                <Bullet>{t.fieldCount} field</Bullet>
              </ul>

              {/*
                Mở bảng là việc người ta tới đây để làm (xem/sửa nội dung), nên nó là nút
                chính của thẻ; Cấu trúc là việc của người dựng loại, hiếm hơn nhiều bậc.
              */}
              <div className="mt-auto flex flex-wrap items-center gap-2.5 border-t border-shell-line pt-3">
                {/*
                  Nút xoá chỉ BẬT khi loại KHÔNG còn mục nào.

                  Server từ chối xoá loại còn entry (kể cả bài trong lưu trữ), và câu từ
                  chối ấy đúng nhưng tới muộn. Khoá nút thì người dùng đọc được luật từ
                  chính giao diện: dọn bài trước, rồi mới xoá được loại. `title` nói ra
                  điều kiện, để một nút mờ không thành một câu đố. `aria-disabled` chứ
                  không `disabled`: nút bị `disabled` không nhận chuột, nên không hiện
                  `title` ở mọi trình duyệt.
                */}
                {t.entryCount === 0 ? (
                  <Button
                    variant="danger"
                    size="md"
                    icon="trash"
                    disabled={busy}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(t);
                    }}
                    title={`Xoá loại "${t.name}" cùng mọi danh mục của nó`}
                  >
                    Xoá
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="md"
                    icon="trash"
                    aria-disabled
                    title={`Còn ${t.entryCount} mục. Xoá hẳn từng mục trước, rồi mới xoá được loại.`}
                  >
                    Xoá
                  </Button>
                )}
                <span className="ml-auto flex flex-wrap gap-2">
                  <ButtonLink href={`/builder/content/types/${t.key}`} size="md">
                    Cấu trúc
                  </ButtonLink>
                  <ButtonLink href={`/builder/content/${t.key}`} variant="primary" size="md">
                    {t.singleton ? 'Mở entry' : 'Mở bảng'}
                  </ButtonLink>
                </span>
              </div>
            </article>
          ))}

          <AddTile onClick={() => setNewOpen(true)} className="min-h-56 flex-col">
            Tạo loại nội dung
          </AddTile>
        </div>
      </Section>

      <Section
        id="kho-nhom"
        title="Nhóm field dùng lại"
        count={groups.length}
        description={
          <>
            Nhóm field <strong className="font-semibold text-shell-ink">không phải</strong> component:
            nó là một bộ ô nhập dùng chung giữa các loại nội dung, không có hình dáng, không có
            style. Khối giao diện dùng lại ở{' '}
            <Link
              href="/builder/components"
              className={cn('rounded-sm text-shell-accent underline-offset-4 hover:underline', focusRing)}
            >
              Quản lý component
            </Link>
            .
          </>
        }
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] gap-4">
          {shownGroups.map((g, i) => (
            <article
              key={g.key}
              aria-label={g.name}
              className={cn(ui.card, ui.cardHover, 'relative flex min-w-0 items-center gap-3.5 p-4')}
            >
              <Tile size="sm" index={shownTypes.length + i} icon="layers" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* Cả thẻ bấm được: lớp `after` của link phủ kín thẻ. Mũi tên sắp xếp
                    nằm trên lớp đó (`relative z-10`) nên vẫn bấm riêng được. */}
                <Link
                  href={`/builder/content/groups/${g.key}`}
                  className="truncate rounded-sm text-ui font-semibold after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-shell-accent"
                >
                  {g.name}
                </Link>
                <span className="truncate text-small text-shell-muted">
                  <span className="font-shell-mono">{g.key}</span> · {g.fieldCount} field · dùng ở {g.usedBy} loại
                </span>
              </div>
              {sorting && (
                <Move
                  name={g.name}
                  i={i}
                  total={shownGroups.length}
                  onMove={(d) => void move('group', i, d)}
                  size="sm"
                  className="relative z-10"
                />
              )}
            </article>
          ))}

          <AddTile onClick={() => setGroupOpen(true)} className="min-h-19">
            Tạo nhóm field
          </AddTile>
        </div>
      </Section>

      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Loại nội dung mới"
        description="Mỗi loại có bảng mục và cấu trúc field riêng. Field thêm sau ở màn Cấu trúc."
        actions={
          <>
            <Button variant="secondary" onClick={() => setNewOpen(false)}>
              Huỷ
            </Button>
            <Button variant="primary" disabled={busy || !name.trim()} loading={busy} onClick={create}>
              {busy ? 'Đang tạo…' : 'Tạo'}
            </Button>
          </>
        }
      >
        <TextField
          label="Tên"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sản phẩm"
          hint={
            <>
              Khoá sinh từ tên và <strong className="font-semibold text-shell-ink">không đổi được</strong> sau
              khi tạo — nó nằm trong đường dẫn API mà mobile gọi.
            </>
          }
        />
        <TextField
          label="Tên số nhiều"
          value={namePlural}
          onChange={(e) => setNamePlural(e.target.value)}
          placeholder="Các sản phẩm"
          hint="Hiện ở tiêu đề bảng mục."
        />
        <Checkbox
          label="Loại này chỉ có một entry"
          checked={singleton}
          onChange={(e) => setSingleton(e.target.checked)}
        />
        {error && (
          <p role="alert" className={ui.error}>
            {error}
          </p>
        )}
      </Dialog>

      <Dialog
        open={groupOpen}
        onClose={() => setGroupOpen(false)}
        title="Nhóm field mới"
        description="Nhóm mới chưa có field nào — thêm field ở màn cấu trúc nhóm ngay sau đây."
        actions={
          <>
            <Button variant="secondary" onClick={() => setGroupOpen(false)}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              disabled={groupBusy || !groupName.trim()}
              loading={groupBusy}
              onClick={createGroup}
            >
              {groupBusy ? 'Đang tạo…' : 'Tạo'}
            </Button>
          </>
        }
      >
        <TextField
          label="Tên"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Khối CTA"
          hint={
            <>
              Khoá sinh từ tên và <strong className="font-semibold text-shell-ink">không đổi được</strong> sau
              khi tạo.
            </>
          }
        />
        {groupError && (
          <p role="alert" className={ui.error}>
            {groupError}
          </p>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void removeType(deleting);
        }}
        title={`Xoá loại "${deleting?.name ?? ''}"?`}
        consequence="Mọi danh mục của loại này mất theo. Cấu trúc field mất hẳn. Không có đường lùi."
        confirmLabel="Xoá vĩnh viễn"
        typeToConfirm={deleting?.key}
        busy={busy}
      >
        {deleteError && (
          <p role="alert" className={ui.error}>
            {deleteError}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

/**
 * Icon của thẻ loại nội dung.
 *
 * `CollectionType.icon` là một ký tự do người dựng loại (hoặc seed) đặt — "▤", "?".
 * Vỏ builder vẽ ký hiệu bằng icon SVG, nên ký tự quen được dịch sang icon cùng ý;
 * ký tự lạ (kể cả emoji) rơi về icon chung của kho chứ không in thẳng ra.
 */
const GLYPH_ICON: Readonly<Record<string, IconName>> = {
  '▤': 'text',
  '?': 'info',
  '▣': 'image',
  '▭': 'layers',
  '❝': 'text',
};

function typeIcon(glyph: string | null): IconName {
  return (glyph && GLYPH_ICON[glyph.trim()]) || 'database';
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-3.5 before:absolute before:top-[0.6em] before:left-0.5 before:size-[5px] before:rounded-full before:bg-current before:opacity-55 before:content-['']">
      {children}
    </li>
  );
}

/** Ô viền đứt để tạo mới, đứng cuối lưới thẻ. */
function AddTile({
  onClick, className, children,
}: { onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-2.5 rounded-lg border-2 border-dashed border-shell-line-strong px-4 text-ui font-semibold text-shell-muted transition-colors hover:border-shell-accent hover:bg-shell-panel hover:text-shell-accent',
        focusRing,
        className,
      )}
    >
      <Icon name="plus" size={22} />
      {children}
    </button>
  );
}

/**
 * Hai mũi tên đổi chỗ. Cùng một việc với cặp lên/xuống của `FieldInput` — chỉ đổi
 * trục vì thẻ xếp theo lưới ngang. Tên thẻ nằm trong nhãn: trên màn có hai chục
 * mũi tên, và "Chuyển lên trước" trơ không nói chuyển cái gì.
 */
function Move({
  name, i, total, onMove, size = 'md', className,
}: {
  name: string;
  i: number;
  total: number;
  onMove: (d: -1 | 1) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span className={cn('flex shrink-0 gap-0.5', className)}>
      <IconButton
        icon="chevron-left"
        size={size}
        label={`Chuyển "${name}" lên trước`}
        onClick={() => onMove(-1)}
        disabled={i === 0}
      />
      <IconButton
        icon="chevron-right"
        size={size}
        label={`Chuyển "${name}" ra sau`}
        onClick={() => onMove(1)}
        disabled={i === total - 1}
      />
    </span>
  );
}

/**
 * Áp thứ tự người dùng vừa đặt lên danh sách server trả.
 *
 * Tự chữa lành khi props đổi: nếu tập khoá không còn khớp (tab khác vừa thêm hoặc
 * xoá một loại), bỏ thứ tự cục bộ và dùng của server. Không cần `useEffect` đồng
 * bộ — mà một effect như thế lại đúng là chỗ dễ đẻ vòng lặp render, vì `types` là
 * mảng mới ở mỗi lượt.
 */
function applyOrder<T extends { key: string }>(items: T[], order: string[] | null): T[] {
  if (!order || order.length !== items.length) return items;
  const by = new Map(items.map((i) => [i.key, i]));
  if (order.some((k) => !by.has(k))) return items;
  return order.map((k) => by.get(k)!);
}
