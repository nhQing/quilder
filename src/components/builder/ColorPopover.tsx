'use client';

/**
 * Phần "màu tự chọn" của bộ chọn màu — bánh xe màu + lưu thành biến.
 *
 * Từ 21/10/2026 đây là PHẦN ĐÁY của `TokenPicker kind="color"`, không còn là một popover
 * riêng: danh sách token (mỗi dòng có ô màu, tên, mã) đứng trên, phần này đứng dưới.
 *
 * ## Vì sao token đứng TRƯỚC bánh xe
 *
 * Thứ nằm trên cùng là thứ được chọn. Đặt bánh xe lên đầu thì mỗi lần cần "màu
 * nhấn" người ta sẽ tự dò lấy một sắc đỏ gần đúng, và sau vài chục lần site có
 * mười hai sắc đỏ khác nhau — hỏng đúng thứ mà design system tồn tại để giữ.
 * Bánh xe vẫn có, nhưng là lối thoát chứ không phải lối chính.
 *
 * ## Vì sao có nút "lưu thành biến"
 *
 * Không có nó thì mọi màu tự chọn là hex chết, dùng lại bằng cách chép tay, và
 * đổi thì phải đi sửa từng chỗ. Có nó thì màu tự chọn quay lại thành token, tức
 * là quay lại con đường chính.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { normalizeHex } from '@/lib/builder/hex';
import { ColorPickerPanel } from './ColorField';
import type { ColorValue } from '@/lib/doc/types';
import { Button } from './ui/Button';

/**
 * Hạt giống cho bánh xe màu khi giá trị hiện tại không phải hex.
 *
 * `react-colorful` chỉ hiểu hex, không hiểu `oklch()` lẫn `var()`, nên đây là
 * một trong hai chỗ trong vỏ builder buộc phải có một hex thật. Nó xấp xỉ
 * `--color-shell-accent`; hai giá trị này lệch nhau thì không ai chết, nhưng
 * hạt giống nên trông giống màu nhấn của công cụ.
 */
const DEFAULT_SEED = '#7c5cff';

/**
 * Hex đầy đủ để nạp vào bánh xe. Bánh xe không hiểu tên token.
 *
 * Chuẩn hoá bằng `normalizeHex` chứ không bằng một regex tại chỗ: regex cũ chỉ nhận
 * 6 chữ số, nên một node đang đặt `#abc` — giá trị mà cả hai validator của dự án
 * đều chấp nhận — mở popover ra là thấy hạt giống tím mặc định thay vì màu của
 * chính nó.
 */
function hexSeed(value: unknown): string {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.hex === 'string') return normalizeHex(v.hex) ?? DEFAULT_SEED;
  }
  return DEFAULT_SEED;
}

export function ColorCustomPanel({
  value,
  onPick,
}: {
  value: unknown;
  /** Gọi khi chọn xong — chỗ gọi tự đóng popover. */
  onPick: (next: ColorValue) => void;
}) {
  // Nạp theo giá trị hiện tại MỖI LẦN mở (component này chỉ sống khi popover mở) — không
  // giữ màu của node lần trước, vì như thế bánh xe sẽ nói dối về thứ đang được đặt.
  const [hex, setHex] = useState(() => hexSeed(value));
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const nameId = useId();

  const saveAsToken = async () => {
    // Chuẩn hoá trước khi gửi: `TOKEN_COLOR_RE` ở server nhận hex 3/4/6/8, nhưng
    // một token lưu dạng `#abc` rồi lần sau lưu `#aabbcc` là hai chuỗi khác nhau
    // cho cùng một màu — và bảng token là chỗ ít được phép mơ hồ nhất.
    const clean = normalizeHex(hex);
    if (!clean) {
      setError('Mã màu không hợp lệ.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/design-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName, value: clean }),
      });
      const data = (await res.json()) as { error?: string; token?: { name: string } };
      if (!res.ok || !data.token) {
        setError(data.error ?? 'Không lưu được');
        return;
      }
      // Gán luôn token vừa tạo, không phải hex: nếu chỉ tạo mà không gán thì
      // thao tác vừa rồi trông như không có tác dụng gì.
      onPick({ $token: data.token.name });
      setNewName('');
      // Nạp lại danh sách token do server truyền xuống, nếu không thì biến mới
      // không xuất hiện trong danh sách cho tới khi tải lại trang.
      router.refresh();
    } catch {
      setError('Mất kết nối');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-2.5" data-color-custom="">
      <p className={cn(ui.label, 'mb-1.5')}>Màu tự chọn</p>
      <ColorPickerPanel hex={hex} onHex={setHex} seed={DEFAULT_SEED} />

      <div className="mt-2 flex items-center justify-end">
        {/* Chuẩn hoá TRƯỚC khi ghi: người dùng gõ `abc` hay `#ABC` thì cái đi vào doc
            phải là `#aabbcc`. Bốn cách viết cùng một màu nằm rải trong doc là thứ làm
            mọi phép so "hai node này cùng màu chưa" nói dối. */}
        <Button
          variant="primary"
          size="sm"
          disabled={normalizeHex(hex) === null}
          onClick={() => onPick({ hex: normalizeHex(hex)! })}
        >
          Dùng màu này
        </Button>
      </div>

      <div className="border-shell-line mt-2.5 border-t pt-2.5">
        <label htmlFor={nameId} className={cn(ui.label, 'mb-1.5 block')}>
          Lưu thành biến để dùng lại
        </label>
        <div className="flex gap-1.5">
          <input
            id={nameId}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="brand-500"
            spellCheck={false}
            className={cn(ui.fieldSm, 'font-shell-mono flex-1')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                e.preventDefault();
                void saveAsToken();
              }
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={saving}
            disabled={!newName.trim()}
            onClick={() => void saveAsToken()}
          >
            Lưu
          </Button>
        </div>
        {error && <p className={cn(ui.error, 'mt-1')}>{error}</p>}
      </div>
    </div>
  );
}
