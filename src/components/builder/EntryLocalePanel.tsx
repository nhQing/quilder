'use client';

/**
 * Cột phải khi form entry đang ở tab một NGÔN NGỮ.
 *
 * ## Vì sao không dùng lại `EntrySidebar`
 *
 * Sidebar kia mang danh mục và quan hệ, và cả hai là dữ liệu của BẢN GỐC — một bài
 * chỉ có một bộ danh mục, không có bộ tiếng Anh riêng. Hiện chúng ở tab tiếng Anh
 * là mời người dùng sửa rồi tưởng đã lưu theo ngôn ngữ đó, còn ẩn chúng đi bằng cờ
 * lại làm hợp đồng của sidebar phình ra vì một màn khác.
 *
 * Nên cột này chỉ có đúng những thứ THUỘC một ngôn ngữ: slug riêng, trạng thái
 * đăng, mốc hẹn giờ, và tiến độ dịch.
 */

import { cn } from '@/lib/builder/cn';
import { autoSlugState } from '@/lib/builder/auto-slug';
import { ui, type Tone } from '@/lib/builder/ui';
import type { LocalePublishState } from '@/lib/collections/entry-locale';
import { SideCard } from './EntryActions';
import { Badge, Progress } from './ui/Badge';
import { Button } from './ui/Button';
import { TextField } from './ui/Field';

const STATE_LOOK: Record<LocalePublishState, { label: string; tone: Tone }> = {
  missing: { label: 'chưa có bản này', tone: 'neutral' },
  draft: { label: 'nháp', tone: 'neutral' },
  scheduled: { label: 'đã hẹn giờ', tone: 'warn' },
  live: { label: 'đang trên site', tone: 'ok' },
};

export function EntryLocalePanel(props: {
  label: string;
  code: string;
  /** Slug của bản gốc — dùng làm placeholder, vì để trống nghĩa là dùng nó. */
  baseSlug: string;
  slug: string;
  onSlug: (v: string) => void;
  /** Tiêu đề ĐÃ DỊCH của ngôn ngữ này — nguồn của nút "Tạo lại". Rỗng = chưa dịch. */
  titleSource: string;
  publishedAt: string;
  onPublishedAt: (v: string) => void;
  state: LocalePublishState;
  coverage: { translated: number; total: number };
}) {
  const look = STATE_LOOK[props.state];

  /*
   * `manual: true` LUÔN LUÔN.
   *
   * Ô này để trống là một giá trị CÓ NGHĨA: dùng đường dẫn của bản gốc. Tự điền nó
   * theo tiêu đề dịch sẽ biến mặc định "một URL cho mọi ngôn ngữ" thành "mỗi ngôn
   * ngữ một URL" mà không ai chọn điều đó — và với SEO thì hai cái đó khác nhau
   * hẳn. Nên: chỉ đề nghị bằng một cái nút.
   */
  const auto = autoSlugState({
    title: props.titleSource,
    slug: props.slug,
    manual: true,
    // Panel không giữ tiêu đề "lúc mở", và không cần: ca đáng phục vụ ở đây là ô
    // còn TRỐNG — chưa có đường dẫn riêng nào để phá.
    titleChanged: false,
    offerWhenEmpty: true,
  });
  const pct =
    props.coverage.total === 0
      ? 0
      : Math.round((props.coverage.translated / props.coverage.total) * 100);

  return (
    <SideCard
      title={
        <>
          {props.label} · <span className="font-shell-mono normal-case">{props.code}</span>
        </>
      }
      className="gap-4"
    >
      <Badge tone={look.tone} dot className="self-start">
        {look.label}
      </Badge>

      {/* ── Tiến độ dịch ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Progress
          label="Đã dịch"
          value={pct}
          valueLabel={
            <span className="tabular-nums">
              {props.coverage.translated}/{props.coverage.total} field
            </span>
          }
          tone={pct === 100 ? 'ok' : undefined}
        />
        <p className={ui.hint}>Field bỏ trống sẽ hiện bản gốc trên site, không hiện trống.</p>
      </div>

      {/* ── Slug riêng ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <TextField
          id={`loc-slug-${props.code}`}
          label="Đường dẫn riêng"
          size="md"
          mono
          value={props.slug}
          placeholder={props.baseSlug}
          onChange={(e) => props.onSlug(e.target.value)}
          hint="Để trống = dùng đường dẫn của bản gốc. Đặt rồi thì URL cũ của ngôn ngữ này không còn trả về bài nữa — đổi đường dẫn một bài đã đăng làm mất thứ hạng đã có."
        />
        {auto.canRegenerate && (
          <Button
            variant="ghost"
            size="sm"
            icon="redo"
            onClick={() => props.onSlug(auto.suggestion)}
            title={`Đặt thành ${auto.suggestion}`}
            className="max-w-full self-start"
          >
            Tạo từ tiêu đề →<span className="font-shell-mono min-w-0 truncate">{auto.suggestion}</span>
          </Button>
        )}
      </div>

      {/*
        KHÔNG còn công tắc Nháp / Lên sóng ở đây.

        Nó là bản thứ hai của một quyết định đã có nút riêng: khối hành động ở đầu cột
        phải có "Đăng", khối Gỡ cuối cột có "Gỡ khỏi site", và chúng tác động lên đúng
        ngôn ngữ đang mở. Hai đường đặt cùng một trạng thái nghĩa là người dùng chọn
        "Lên sóng" ở đây rồi bấm "Lưu nháp" ở trên — và không có gì nói cho họ biết vừa
        xảy ra chuyện gì. Xem docblock của `EntryActions`.

        Câu "độc lập với bản gốc" thì GIỮ, vì đó là thông tin không nút nào nói được.
      */}
      <p className={cn('text-small leading-relaxed text-shell-muted')}>
        Trạng thái của bản này <strong className="font-semibold text-shell-ink">độc lập với bản gốc</strong>:
        nó lên sóng được kể cả khi bản gốc còn nháp, và ngược lại. Đăng và gỡ bằng nút ở
        khối trên và khối Gỡ của cột này.
      </p>

      <TextField
        id={`loc-at-${props.code}`}
        label="Mốc lên sóng"
        size="md"
        type="datetime-local"
        value={props.publishedAt}
        onChange={(e) => props.onPublishedAt(e.target.value)}
        className="tabular-nums"
        hint="Bỏ trống rồi bấm Đăng = lên ngay. Mốc ở tương lai = đã duyệt, chưa hiện."
      />
    </SideCard>
  );
}
