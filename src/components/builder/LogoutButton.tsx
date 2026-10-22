'use client';

/**
 * Đăng xuất.
 *
 * Bản trước gọi `await fetch(...)` rồi chuyển trang ngay, không kiểm `res.ok`,
 * không `try/catch`. Khi request hỏng — mạng đứt, server 500 — người dùng vẫn bị
 * đưa tới trang đăng nhập như thể đã thoát, nhưng cookie phiên còn nguyên nên
 * middleware đá ngược về `/builder`. Trông như builder tự nhiên nhảy lung tung,
 * và người dùng rời máy mà tưởng mình đã đăng xuất.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { focusRing } from '@/lib/builder/ui';

import { Icon } from './ui/Icon';

export function LogoutButton({ compact }: { compact?: boolean } = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error(`Máy chủ trả ${res.status}`);
      router.replace('/builder/login');
      router.refresh();
    } catch (e) {
      // Ở lại trang. Nói thật là chưa thoát còn hơn để người dùng bỏ đi với một
      // phiên vẫn đang mở.
      setError(`Chưa đăng xuất được: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  return (
    <span className={cn('flex gap-2', compact ? 'flex-col items-center' : 'flex-col')}>
      {error && (
        <span role="alert" className="text-shell-danger text-mini">
          {error}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void logout()}
        // Rail chỉ có icon: nhãn nằm ở `aria-label` + `title`, nên tên nút vẫn là
        // "Đăng xuất" với screen reader và với test.
        aria-label={compact ? (busy ? 'Đang thoát…' : 'Đăng xuất') : undefined}
        title={compact ? 'Đăng xuất' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-md font-medium text-shell-muted transition-colors hover:bg-shell-raised hover:text-shell-ink disabled:opacity-40',
          focusRing,
          compact ? 'size-11 justify-center' : 'min-h-11 px-3 text-small',
        )}
      >
        <Icon name="logout" size={19} />
        {!compact && (busy ? 'Đang thoát…' : 'Đăng xuất')}
      </button>
    </span>
  );
}
