/**
 * Mục gập "Cách nhập một trang (từng bước)" trong hộp thoại nhập — spec §9.
 *
 * Mỗi bước có tiêu đề ngắn đọc lướt được, một dòng giải thích, và tên nút/menu thật
 * dưới dạng chip: người dùng tìm đúng chữ đó trên màn hình. Bước 1 diễn ra ở môi trường
 * KHÁC nên có nhãn riêng — đó là bước người ta hay quên khi mở hộp thoại này mà chưa có gói.
 */

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Icon } from '../ui/Icon';

function Ui({ children }: { children: React.ReactNode }) {
  return <span className={cn(ui.chip, ui.tone.neutral, 'mx-0.5 align-baseline')}>{children}</span>;
}

const STEPS: { where: string; title: string; body: React.ReactNode }[] = [
  {
    where: 'Ở môi trường nguồn',
    title: 'Xuất gói của trang',
    body: (
      <>
        Mở menu <Ui>⋯</Ui> trên thẻ trang → <Ui>Xuất trang (.zip)</Ui> → <Ui>Tải về</Ui>.
      </>
    ),
  },
  {
    where: 'Ở đây',
    title: 'Chọn gói vừa tải',
    body: (
      <>
        Kéo file .zip vào ô bên dưới, hoặc bấm <Ui>Chọn file .zip</Ui>.
      </>
    ),
  },
  {
    where: 'Ở đây',
    title: 'Chọn trang đích và thư mục ảnh',
    body: 'Nhập vào một trang có sẵn bất kỳ, hoặc tạo trang mới. Thư mục cho ảnh mới phải tự chọn.',
  },
  {
    where: 'Ở đây',
    title: 'Xem lại rồi nhập',
    body: (
      <>
        Xử lý các mục chặn (nếu có), đọc phần “Cần làm sau khi nhập”, rồi bấm <Ui>Nhập</Ui>.
      </>
    ),
  },
  {
    where: 'Ở đây',
    title: 'Hoàn tất trên bản nháp',
    body: (
      <>
        Làm nốt việc còn lại (URL form, ngôn ngữ…), kiểm bản nháp rồi <Ui>Publish</Ui>. Nhập nhầm
        thì bấm <Ui>Hoàn tác lần nhập</Ui>.
      </>
    ),
  },
];

export function ImportStepsHelp() {
  return (
    <details className={cn(ui.inset, 'group px-4 py-3')}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 rounded-sm text-small font-semibold select-none [&::-webkit-details-marker]:hidden',
          focusRing,
        )}
      >
        <Icon name="chevron-right" size={16} className="text-shell-muted transition-transform group-open:rotate-90" />
        Cách nhập một trang (từng bước)
      </summary>

      <ol className="mt-3 flex flex-col">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Đường nối giữa các bước — dừng ở bước cuối. */}
            {i < STEPS.length - 1 && (
              <span aria-hidden className="absolute top-7 bottom-0 left-3 w-px bg-shell-line" />
            )}
            <span
              aria-hidden
              className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-shell-accent-soft text-mini font-bold text-shell-accent"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              {(i === 0 || STEPS[i - 1]!.where !== s.where) && <span className={ui.eyebrow}>{s.where}</span>}
              <span className="text-small font-semibold text-shell-ink">{s.title}</span>
              <p className="text-small leading-relaxed text-shell-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
