'use client';

/**
 * Form tạo trang mới — KHÔNG có vỏ.
 *
 * ## Vì sao nó tách ra khỏi `CanvasInsertDock`
 *
 * Form này từng nằm trọn trong `NewPagePopover` của dock, tức chỉ tồn tại KHI ĐANG
 * MỞ MỘT TRANG. Với site chưa có trang nào thì không mở được trang nào, nên không
 * có đường nào tạo trang đầu tiên từ giao diện — người dùng bị chỉ sang
 * `pnpm db:seed`, một lệnh không chạy được trên server.
 *
 * Nên: form ở đây, và hai chỗ dùng lại nó — dock trong trình sửa, và nút trên danh
 * sách trang. Chép form thành hai bản là hai bản của một luật (slug tự sinh, câu
 * cảnh báo về Publish), và bản ít dùng hơn sẽ trôi.
 *
 * Vỏ nằm ở bên gọi: dock bọc bằng `Panel`, danh sách trang bọc bằng `Dialog`.
 * Form chỉ biết MẬT ĐỘ của vỏ (`variant`): popover của editor dùng ô 36px và nút
 * rộng hết khung, dialog của dashboard dùng ô 44px và hàng nút căn phải.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { autoSlugState } from '@/lib/builder/auto-slug';
import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Button } from './ui/Button';
import { TextField } from './ui/Field';

export function NewPageForm({
  onDone,
  variant = 'panel',
  onCancel,
}: {
  onDone: () => void;
  /** `panel` cho popover của editor (mặc định), `dialog` cho dialog ở dashboard. */
  variant?: 'panel' | 'dialog';
  /** Chỉ ở `dialog`: hiện nút Huỷ cạnh nút Tạo trang. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  /*
   * Ô slug bắt đầu ở chế độ AUTO: form này luôn tạo trang mới, nên chưa có địa chỉ
   * nào để giữ. Chỉ khi người dùng gõ thẳng vào ô slug thì nó mới khoá lại.
   */
  const [slugManual, setSlugManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form này mở ra với tiêu đề rỗng, nên "đã gõ gì đó" chính là "tiêu đề đã đổi".
  const auto = autoSlugState({
    title, slug, manual: slugManual, titleChanged: title.trim() !== '',
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Gửi slug đang HIỆN trên màn hình, không gửi state thô: ở chế độ auto ô
        // hiện gợi ý còn `slug` vẫn rỗng, và gửi rỗng là nhờ server sinh lại đúng
        // thứ đó — cùng kết quả, nhưng người dùng mất khả năng sửa trước khi gửi.
        body: JSON.stringify({ title, slug: auto.value || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Không tạo được trang');
      onDone();
      router.push(`/builder/${json.page.id}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const dialog = variant === 'dialog';
  const size = dialog ? 'lg' : 'md';
  const submitLabel = busy ? 'Đang tạo…' : 'Tạo trang';

  return (
    <form onSubmit={submit} className={cn('flex flex-col', dialog ? 'gap-4' : 'gap-3 p-3')}>
      <TextField
        size={size}
        label="Tiêu đề"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Về chúng tôi"
      />

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <label htmlFor={`${uid}-slug`} className={ui.label}>
            Đường dẫn
          </label>
          {slugManual && auto.canRegenerate && (
            <button
              type="button"
              onClick={() => {
                setSlug(auto.suggestion);
                setSlugManual(false);
              }}
              title={`Đặt lại thành /${auto.suggestion}`}
              className={cn(
                'ml-auto rounded-sm text-mini font-medium text-shell-accent underline-offset-4 hover:underline',
                focusRing,
              )}
            >
              Tạo lại từ tiêu đề
            </button>
          )}
        </div>
        <input
          id={`${uid}-slug`}
          value={auto.value}
          onChange={(e) => {
            setSlugManual(true);
            setSlug(e.target.value);
          }}
          placeholder="ve-chung-toi"
          className={cn(dialog ? ui.field : ui.fieldMd, 'font-shell-mono')}
        />
      </div>

      {error && (
        <p role="alert" className="text-small leading-relaxed text-shell-danger">
          {error}
        </p>
      )}

      <p className={ui.hint}>Trang mới là bản nháp trắng. Nó chỉ lên site thật sau lần Publish tiếp theo.</p>

      {dialog ? (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              Huỷ
            </Button>
          )}
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
            {submitLabel}
          </Button>
        </div>
      ) : (
        <Button type="submit" variant="primary" size="md" full loading={busy} disabled={!title.trim()}>
          {submitLabel}
        </Button>
      )}
    </form>
  );
}
