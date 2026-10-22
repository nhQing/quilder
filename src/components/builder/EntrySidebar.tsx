'use client';

/**
 * Cột phải của màn nhập entry — sáu khối, đúng thứ tự của bản dựng.
 *
 * ## Khối Trạng thái ĐỌC-THÔI, và vì sao nó từng không phải vậy
 *
 * Ranh giới đúng: "Đăng" là một NÚT (hành động, khối Bài viết ở đầu cột), còn "đang
 * ở trạng thái gì, hẹn giờ lúc nào" là THÔNG TIN của bài (khối này). Nhưng khối này từng có một
 * toggle `Nháp | Đã đăng` — và toggle đó KHÔNG phải thông tin, nó ĐỔI trạng thái.
 * Một hành động mặc áo dữ liệu, đặt cạnh hai nút thật ở thanh trên, thành bốn điều
 * khiển cho cùng một việc; người dùng báo là dễ nhầm, và họ đúng.
 *
 * Nay khối này chỉ TRÌNH BÀY trạng thái. Mọi thứ đổi được trạng thái đều là nút:
 * Lưu nháp/Đăng ở khối Bài viết, "Gỡ khỏi site" ở khối Gỡ cuối cột. Ô "Đăng lúc" ở lại vì nó đúng là dữ
 * liệu: một mốc thời gian người soạn đặt ra, không phải một lệnh.
 *
 * ## Vì sao Danh mục không nằm trong cột trái
 *
 * Danh mục không lưu trong `data` mà trong bảng `EntryTaxonomy`. Một field
 * `taxonomy` trong schema chỉ khai rằng loại này CÓ danh mục; giá trị đi đường
 * khác. Render nó như một field bình thường là mời người sau đi tìm nó trong
 * `data` và không thấy.
 *
 * Chính vì chỉ có MỘT tập danh mục cho mỗi loại, "danh mục" và "thẻ" phải sống
 * chung một danh sách — trục duy nhất tách được chúng là cây `parentId`. Việc xếp
 * nhóm và lọc nằm ở `TaxonomyPicker` và `lib/collections/taxonomy-picker.ts`.
 *
 * ## Vì sao "Liên quan" và "Liên kết" là HAI khối, không một
 *
 * Cả hai đều là field kiểu `relation`, nhưng khác nhau ở đích: "Liên quan" trỏ về
 * CHÍNH loại đang sửa (self-relation, kiểu "bài viết liên quan"), còn "Liên kết"
 * trỏ tới một loại KHÁC — ví dụ một loại nội dung tự tạo tên "Danh mục", tách biệt
 * với cơ chế `taxonomy` có sẵn. Chỉ self-relation có hành vi bỏ trống thì tự xếp
 * theo số danh mục trùng (`relatedEntries`, phía render site) — nói câu đó ở khối
 * "Liên kết" là bịa một hành vi mà field trỏ loại khác không có.
 */


import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import type { FieldDef, GroupTable } from '@/lib/collections/field-def';
import type { FormPath } from '@/lib/collections/form-state';
import { SideCard } from './EntryActions';
import { FieldInput } from './FieldInput';
import { TaxonomyPicker } from './TaxonomyPicker';
import { Avatar, Badge } from './ui/Badge';
import { EntryWriter, PersonLine } from './EntryWriter';
import { personLabel, type EntryActivity, type WriterOption } from '@/lib/collections/entry-activity';
import { TextField } from './ui/Field';

const DATE = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** Trần độ dài mô tả mà Google còn hiện trọn trong kết quả tìm kiếm. */
const EXCERPT_LIMIT = 160;

export function EntrySidebar(props: {
  typeKey: string;
  status: string;
  publishedAt: string;
  onPublishedAt: (v: string) => void;
  taxonomies: { id: string; key: string; name: string; parentId: string | null }[];
  taxonomyIds: string[];
  onTaxonomyIds: (ids: string[]) => void;
  hasTaxonomyField: boolean;
  relationFields: FieldDef[];
  /** Field `relation` trỏ tới một loại KHÁC loại đang sửa — xem docblock đầu file. */
  crossRelationFields: FieldDef[];
  groups: GroupTable;
  data: Record<string, unknown>;
  onChange: (path: FormPath, value: unknown) => void;
  onAppend: (path: FormPath, item: unknown) => void;
  onRemove: (path: FormPath, index: number) => void;
  onMove: (path: FormPath, index: number, dir: -1 | 1) => void;
  seo: { title: string; slug: string; excerpt: string };
  log: {
    createdAt: Date; createdBy: string; updatedAt: Date; updatedBy: string;
    publishedAt: Date | null;
    /** Người kèm avatar + lịch sử — `getEntryActivity`. */
    activity: EntryActivity | null;
  } | null;
  /** Bài đang sửa; `null` với bài mới. */
  entryId: string | null;
  /** Danh sách đổi tác giả; rỗng khi không phải admin. */
  writerOptions: WriterOption[];
}) {
  const scheduled =
    props.status === 'published' && props.publishedAt !== '' && new Date(props.publishedAt).getTime() > Date.now();
  const longExcerpt = props.seo.excerpt.length > EXCERPT_LIMIT;

  const relationInputs = (fields: FieldDef[]) =>
    fields.map((f) => (
      <FieldInput
        key={f.key}
        field={f}
        path={[f.key]}
        value={props.data[f.key]}
        groups={props.groups}
        taxonomies={props.taxonomies}
        depth={2}
        compact
        onChange={props.onChange}
        onAppend={props.onAppend}
        onRemove={props.onRemove}
        onMove={props.onMove}
      />
    ));

  return (
    <div className="flex flex-col gap-4">
      {/* 1 ── Trạng thái (đọc-thôi; đổi trạng thái là việc của các nút) */}
      <SideCard title="Trạng thái">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-shell-muted">
          {props.status === 'published' ? (
            <>
              <Badge tone={scheduled ? 'warn' : 'ok'} dot>
                {scheduled ? 'hẹn giờ' : 'đã đăng'}
              </Badge>
              {props.log?.publishedAt && <span className="tabular-nums">{DATE.format(props.log.publishedAt)}</span>}
            </>
          ) : (
            <Badge dot>nháp — chưa lên site</Badge>
          )}
        </p>

        <TextField
          label="Đăng lúc"
          size="md"
          type="datetime-local"
          value={props.publishedAt}
          onChange={(e) => props.onPublishedAt(e.target.value)}
          className="tabular-nums"
          /*
            KHÔNG còn câu "để ở tương lai nghĩa là hẹn giờ". Nút ở khối Bài viết tự
            đổi chữ thành "Hẹn đăng <ngày>" khi ô này là mốc tương lai — cùng thông
            tin, nói đúng lúc người sắp bấm, và không tốn một dòng chữ ở trạng thái
            thường.
          */
          hint={
            scheduled ? (
              <span className="text-shell-warn">
                Đang hẹn giờ — bài sẽ tự hiện khi tới mốc, không cần bấm gì thêm.
              </span>
            ) : undefined
          }
        />
      </SideCard>

      {/* 2 ── Danh mục */}
      {props.hasTaxonomyField && (
        <SideCard title="Danh mục">
          <TaxonomyPicker
            typeKey={props.typeKey}
            taxonomies={props.taxonomies}
            value={props.taxonomyIds}
            onChange={props.onTaxonomyIds}
          />
        </SideCard>
      )}

      {/* 3 ── Tin liên quan */}
      {props.relationFields.length > 0 && (
        <SideCard title="Liên quan">
          <div className="flex flex-col gap-4">{relationInputs(props.relationFields)}</div>
          <p className={cn(ui.hint, 'leading-relaxed')}>
            Bỏ trống thì danh sách liên quan tự xếp theo số danh mục trùng nhau. Chọn tay ở
            đây là ghi đè thứ tự đó.
          </p>
        </SideCard>
      )}

      {/* 3b ── Liên kết tới loại khác (ví dụ field trỏ tới loại "Danh mục") */}
      {props.crossRelationFields.length > 0 && (
        <SideCard title="Liên kết">
          <div className="flex flex-col gap-4">{relationInputs(props.crossRelationFields)}</div>
        </SideCard>
      )}

      {/* 4 ── SEO: bản xem trước của một dòng kết quả tìm kiếm */}
      <SideCard title="SEO">
        <div className={cn(ui.inset, 'flex min-w-0 flex-col gap-1 p-3')}>
          <span className="font-shell-mono truncate text-micro text-shell-ok">/{props.seo.slug || '…'}</span>
          <span className="truncate text-ui font-medium text-shell-accent">
            {props.seo.title || '[chưa có tiêu đề]'}
          </span>
          <p className="line-clamp-2 text-small text-shell-muted">
            {props.seo.excerpt || 'Chưa có mô tả ngắn — Google sẽ tự cắt một đoạn trong bài.'}
          </p>
        </div>
        <p className={cn(ui.hint, 'tabular-nums', longExcerpt && 'text-shell-warn')}>
          Mô tả ngắn: {props.seo.excerpt.length} ký tự (nên dưới {EXCERPT_LIMIT})
        </p>
      </SideCard>

      {/* 5 ── Tác giả: tên + avatar hiện ra site (byline) */}
      <SideCard title="Tác giả">
        <EntryWriter
          entryId={props.entryId}
          writer={
            props.log?.activity?.writer ??
            (props.log ? { name: null, email: props.log.createdBy, avatarUrl: null } : null)
          }
          options={props.writerOptions}
        />
      </SideCard>

      {/* 6 ── Nhật ký: ai tạo, ai sửa, lịch sử cập nhật */}
      <SideCard title="Nhật ký">
        {props.log ? (
          <div className="flex min-w-0 flex-col gap-3">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-small">
              <dt className="text-shell-muted">Tạo</dt>
              <dd className="min-w-0">
                <PersonLine
                  person={props.log.activity?.createdBy ?? { name: null, email: props.log.createdBy, avatarUrl: null }}
                  sub={<span className="tabular-nums">{DATE.format(props.log.createdAt)}</span>}
                />
              </dd>
              <dt className="text-shell-muted">Sửa</dt>
              <dd className="min-w-0">
                <PersonLine
                  person={props.log.activity?.updatedBy ?? { name: null, email: props.log.updatedBy, avatarUrl: null }}
                  sub={<span className="tabular-nums">{DATE.format(props.log.updatedAt)}</span>}
                />
              </dd>
              <dt className="text-shell-muted">Đăng</dt>
              <dd className="tabular-nums">
                {props.log.publishedAt ? DATE.format(props.log.publishedAt) : '—'}
              </dd>
            </dl>

            {props.log.activity && props.log.activity.history.length > 0 && (
              <div className="flex min-w-0 flex-col gap-2 border-t border-shell-line pt-3">
                <span className={ui.eyebrow}>Lịch sử cập nhật</span>
                <ol className="flex min-w-0 flex-col gap-2.5">
                  {props.log.activity.history.map((h) => (
                    <li key={h.id} className="flex min-w-0 items-start gap-2.5">
                      <Avatar name={personLabel(h.person)} src={h.person?.avatarUrl} size="sm" />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-small">
                          <span className="font-medium">{personLabel(h.person)}</span> · {h.label}
                        </span>
                        <span className="text-mini tabular-nums text-shell-muted">{DATE.format(h.at)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <p className="text-small text-shell-muted">Bài mới, chưa lưu lần nào.</p>
        )}
        <p className={cn(ui.hint, 'leading-relaxed')}>
          Lịch sử ghi ai làm gì, lúc nào — không có bản cũ để lùi về như trang: lưu là ghi đè.
        </p>
      </SideCard>
    </div>
  );
}
