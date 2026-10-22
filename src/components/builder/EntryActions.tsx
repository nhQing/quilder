'use client';

/**
 * Hai khối trong cột phải của màn nhập entry: hành động ở TRÊN, xem trước ở DƯỚI.
 *
 * ## Vì sao nút rời khỏi thanh tiêu đề
 *
 * Thanh trên từng chứa bốn thứ cạnh nhau: Xem cạnh, Xem cả trang, Lưu nháp, Đăng.
 * Bốn nút một hàng, và hai trong số đó không phải hành động lên nội dung mà là cách
 * NHÌN nội dung — nên hàng đó trộn hai loại việc và không có cái nào nổi lên.
 *
 * Cột phải đã là chỗ của mọi thứ nói về bài này (trạng thái, danh mục, SEO, nhật
 * ký), nên nút thuộc về đó. Trên cùng: việc chính. Dưới cùng: hai lối xem.
 *
 * ## Ba nút, và luật SÁNG của từng cái
 *
 * `Lưu nháp` — chỉ sáng khi bài **chưa đăng** và **có gì chưa ghi**. Bài đang hiện
 * trên site thì nút này tối, và đó không phải hạn chế mà là sự thật của kiến trúc:
 * `Entry` là nguồn LIVE, không có tầng nháp riêng cho từng bản — mọi lần ghi vào một
 * bài đang hiện là ghi thẳng lên site. Cho nó sáng nghĩa là hứa một thứ không tồn
 * tại. Muốn sửa mà không lên site thì `Gỡ` trước.
 *
 * `Đăng` — sáng khi có gì chưa ghi, HOẶC khi bài còn nháp. Nhánh thứ hai là chỗ tôi
 * đi khác yêu cầu ban đầu ("chỉ sáng nếu vừa tạo hoặc vừa sửa"): thiếu nó thì một
 * bài lưu nháp hôm nay, mở lại ngày mai, không sửa gì — sẽ không đăng được, vì không
 * có gì "vừa sửa". Người dùng phải gõ một chữ vào đâu đó rồi xoá đi để nút sáng lên.
 * Khi bài đang dở dang thì Đăng làm HAI việc, đúng như yêu cầu: ghi rồi đưa lên.
 *
 * `Gỡ` không ở đây — nó ở `EntryDangerBox`, dưới cùng cột. Xem docblock ở đó.
 *
 * ## Vì sao nút tác động lên NGÔN NGỮ đang mở
 *
 * Một bài có bản gốc và các bản dịch, và mỗi bản lên sóng độc lập — bản tiếng Anh
 * đăng được kể cả khi bản gốc còn nháp. Nên `EntryForm` truyền vào trạng thái của
 * ngôn ngữ đang mở, và `localeLabel` nói ra điều đó trên chính nút để không ai bấm
 * Đăng ở tab English mà tưởng mình đang đăng cả bài.
 */

import { useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { Dialog } from './ui/Overlay';

/**
 * Một thẻ nhỏ của cột phải: tiêu đề nhóm viết hoa, nội dung xếp dọc. Dùng chung cho
 * mọi khối của cột (`EntrySidebar`, `EntryLocalePanel`) để cả cột ra cùng một nhịp.
 */
export function SideCard({
  title,
  children,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(ui.card, 'flex min-w-0 flex-col gap-3 p-5', className)}>
      <h2 className={ui.eyebrow}>{title}</h2>
      {children}
    </section>
  );
}

export function EntryActions({
  published,
  dirty,
  busy,
  saved,
  scheduleLabel,
  localeLabel,
  onSave,
  onPublish,
}: {
  published: boolean;
  /** Có thay đổi chưa ghi. Xem `touch()` trong `EntryForm`. */
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  /** Chữ trên nút khi mốc đăng ở tương lai, ví dụ "Hẹn đăng 12/09". */
  scheduleLabel: string | null;
  /** Tên ngôn ngữ đang mở, `null` khi đang ở bản gốc. */
  localeLabel: string | null;
  onSave: () => void;
  onPublish: () => void;
}) {
  const canDraft = !published && dirty;
  const canPublish = dirty || !published;

  return (
    <SideCard title={localeLabel ? `Bản ${localeLabel}` : 'Bài viết'}>
      {/* `flex-[1_0_auto]` để hai nút giãn kín hàng mà vẫn xuống dòng khi chữ "Hẹn
          đăng dd/mm" không còn đủ chỗ đứng cạnh "Lưu nháp". */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || !canDraft}
          onClick={onSave}
          className="flex-[1_0_auto]"
          title={
            published
              ? 'Bài đang hiện trên site, nên không có bản nháp để lưu riêng — mọi lần ghi đều lên site ngay. Dùng Đăng, hoặc Gỡ trước nếu muốn sửa mà chưa cho ai thấy.'
              : dirty
                ? 'Ghi lại nhưng chưa đưa lên site'
                : 'Chưa có gì thay đổi'
          }
        >
          Lưu nháp
        </Button>

        <Button
          variant="primary"
          icon={scheduleLabel ? 'calendar' : 'send'}
          disabled={busy || !canPublish}
          onClick={onPublish}
          className="flex-[1_0_auto]"
          title={
            !canPublish
              ? 'Bài đang hiện trên site và không có gì thay đổi'
              : published
                ? 'Ghi thay đổi và cập nhật bản đang hiện trên site'
                : dirty
                  ? 'Ghi lại và đưa lên site — một lần bấm làm cả hai'
                  : 'Đưa bài lên site'
          }
        >
          {scheduleLabel ?? 'Đăng'}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
          <Badge tone={published ? 'ok' : 'neutral'} dot>
            {published ? 'đang hiện trên site' : 'chưa lên site'}
          </Badge>
          {dirty ? (
            <span className="text-shell-warn">có thay đổi chưa ghi</span>
          ) : (
            saved && <span className="text-shell-ok">đã lưu</span>
          )}
        </p>
        {/* Nút tối phải nói được VÌ SAO bằng chữ đứng cạnh, không chỉ bằng `title`: một
            nút xám không giải thích là chỗ người dùng bấm ba lần rồi đi hỏi người khác. */}
        {published && (
          <p className={ui.hint}>Lưu nháp tắt khi bài đã lên site — mọi lần lưu ghi thẳng lên site.</p>
        )}
        {localeLabel && <p className={ui.hint}>Chỉ bản {localeLabel}, không ảnh hưởng bản gốc.</p>}
      </div>
    </SideCard>
  );
}

/**
 * Khối nguy hiểm, dưới cùng cột phải: `Gỡ` rồi mới `Xoá bài`.
 *
 * ## Vì sao phải gỡ TRƯỚC khi xoá
 *
 * "Xoá bài" và "bài biến mất khỏi site" là hai chuyện, và gộp chúng vào một cú bấm
 * làm cái thứ hai thành tác dụng phụ. Với một bài đang có người đọc và có thứ hạng
 * tìm kiếm, thứ đó phải là một hành động có tên riêng.
 *
 * Nên: bài đang hiện thì nút này là `Gỡ` (rút khỏi site, giữ nguyên mọi thứ khác);
 * chỉ khi bài đã ẩn thì nó thành `Xoá bài`. Hai bước, hai cú bấm, mỗi cú một hậu quả
 * gọi được tên.
 *
 * Đây là luật của GIAO DIỆN. `archiveEntry` phía server không kiểm `status`, nên MCP
 * và HTTP API vẫn lưu trữ được một bài đang đăng — chỗ này không phải hàng rào an
 * toàn, nó là thứ tự đúng cho người đang ngồi trước màn hình.
 *
 * ## Vì sao "Xoá bài" chỉ hỏi MỘT câu
 *
 * `DELETE` không kèm `?purge=1` là LƯU TRỮ: hàng `Entry` còn nguyên và lấy lại được.
 * Một thao tác lùi được thì một câu hỏi là đủ; nhiều hơn là dạy người ta bấm Đồng ý
 * mà không đọc. Câu hỏi là một `<dialog>` của vỏ, không phải `window.confirm` — hộp
 * của trình duyệt không theo theme và không nói được tên bài bằng chữ đơn cách.
 *
 * "Gỡ khỏi site" thì không hỏi gì: nó lùi được bằng đúng một lần bấm Đăng.
 */
export function EntryDangerBox({
  published,
  busy,
  slug,
  localeLabel,
  onUnpublish,
  onArchive,
}: {
  published: boolean;
  busy: boolean;
  /** Đường dẫn của bài — gọi tên bài trong câu hỏi trước khi lưu trữ. */
  slug?: string;
  localeLabel: string | null;
  onUnpublish: () => void;
  /** Chạy SAU khi người dùng đã xác nhận trong hộp thoại. */
  onArchive: () => void;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <SideCard title="Gỡ">
      {published ? (
        <>
          <Button variant="danger" size="md" icon="eye-off" disabled={busy} onClick={onUnpublish} className="self-start">
            Gỡ khỏi site
          </Button>
          <p className={cn(ui.hint, 'leading-relaxed')}>
            Nội dung và mốc đăng giữ nguyên — bấm Đăng là lên lại.
            {localeLabel ? <> Chỉ gỡ bản {localeLabel}.</> : null}
            {' '}Xoá được sau khi đã gỡ.
          </p>
        </>
      ) : (
        <>
          <Button variant="danger" size="md" icon="trash" disabled={busy} onClick={() => setAsking(true)} className="self-start">
            Xoá bài
          </Button>
          <p className={cn(ui.hint, 'leading-relaxed')}>Bài vào lưu trữ, không mất — lấy lại được từ danh sách.</p>
          <Dialog
            open={asking}
            onClose={() => setAsking(false)}
            size="sm"
            title={
              slug ? (
                <>
                  Bỏ <span className="font-shell-mono break-all">{slug}</span> vào lưu trữ?
                </>
              ) : (
                'Bỏ bài này vào lưu trữ?'
              )
            }
            description="Bài rời khỏi danh sách đang mở. Nội dung được giữ lại và lấy lại được từ danh sách."
            actions={
              <>
                <Button variant="secondary" onClick={() => setAsking(false)}>
                  Giữ lại
                </Button>
                <Button
                  variant="danger-solid"
                  icon="trash"
                  onClick={() => {
                    setAsking(false);
                    onArchive();
                  }}
                >
                  Vào lưu trữ
                </Button>
              </>
            }
          />
        </>
      )}
    </SideCard>
  );
}

/**
 * MỘT nút: bật cột xem trước cạnh form.
 *
 * ## Vì sao gộp hai nút thành một
 *
 * Trước đó có "Cạnh bài" và "Cả trang" nằm cạnh nhau, và người dùng phải đọc nhãn
 * rồi đoán hai cái khác nhau ở đâu — trong khi khác biệt thật (một cái đọc bản đang
 * gõ, một cái đọc bản đã lưu) không thể hiện ra ở chỗ đặt chúng cạnh nhau.
 *
 * Giờ chỉ còn một cửa: bật xem trước. Lối thứ hai — mở rộng ra một tab — nằm TRÊN
 * ĐẦU chính cột xem trước đó (xem `EntryPreview`), nên quan hệ giữa hai thứ tự hiện
 * ra: "đang xem cái này — mở nó ra rộng hơn". Không phải hai lựa chọn ngang hàng
 * bắt người dùng chọn trước khi biết mình cần gì.
 *
 * Nút vẫn là TOGGLE chứ không phải "luôn mở": cột xem trước ăn nửa bề rộng màn, và
 * người đang gõ một bài dài cần lấy lại chỗ đó. Lựa chọn được nhớ trong
 * `localStorage`, nên mở một lần là nó mở mãi — đó là phần "luôn mở" của yêu cầu.
 */
export function EntryViewBox({
  previewOpen,
  onTogglePreview,
}: {
  previewOpen: boolean;
  onTogglePreview: () => void;
}) {
  return (
    <SideCard title="Xem">
      <button
        type="button"
        aria-pressed={previewOpen}
        onClick={onTogglePreview}
        /* Toggle, nên nó có trạng thái BẬT riêng và không nằm trong các bậc của
           `Button` — các bậc nói về thứ hạng của một hành động, cái này nói về một
           công tắc đang bật hay tắt. Bật = nền accent nhạt, như mục đang chọn. */
        className={cn(
          'flex h-control-md w-full items-center gap-2.5 rounded px-3 text-small font-medium transition-colors',
          focusRing,
          previewOpen
            ? 'bg-shell-accent-soft text-shell-accent'
            : 'text-shell-ink hover:bg-shell-raised',
        )}
      >
        <Icon name="eye" size={17} />
        Preview
        <span className="ml-auto text-mini font-normal text-shell-muted">
          {previewOpen ? 'đang mở' : 'mở cạnh form'}
        </span>
      </button>
    </SideCard>
  );
}
