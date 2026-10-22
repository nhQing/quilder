/**
 * Bảng đăng ký phím tắt TOÀN CỤC của builder.
 *
 * ## Vì sao cần một bảng, không phải mỗi component tự bắt phím
 *
 * Luật 5 của `3e` ("phím tắt tối thiểu") không sai được theo kiểu logic — nó sai theo
 * kiểu **hai chỗ giành một tổ hợp**. Và đó là loại lỗi không ai phát hiện khi review một
 * file: `EditorShell` bắt `Ctrl+Z`, một component mới bắt `Ctrl+Z` cho việc khác, cả hai
 * đều `window.addEventListener`, và thứ thắng phụ thuộc thứ tự mount.
 *
 * Bảng này làm điều đó thành một test đỏ. `noCollisions()` chạy trong `pnpm test`, nên
 * người thêm phím thứ chín biết ngay nếu nó đụng phím đã có.
 *
 * ## Vì sao KHÔNG phải một hook điều phối
 *
 * Đã cân nhắc: một `useShortcut(id, handler)` gom mọi listener về một chỗ. Bỏ vì nó bắt
 * mọi chỗ đang chạy tốt phải viết lại, và nó thêm một tầng giữa sự kiện và handler —
 * trong khi vấn đề thật chỉ là "hai chỗ dùng cùng tổ hợp mà không ai biết". Bảng + test
 * giải đúng vấn đề đó và không đụng vào code đang chạy.
 *
 * Bảng này là DANH SÁCH SỰ THẬT, nên nó phải liệt kê cả phím đã có từ trước — không chỉ
 * phím mới. Một bảng chỉ có phím mới thì phép kiểm trùng vô nghĩa.
 */

export interface Shortcut {
  id: string;
  /** Có cần Ctrl (hoặc Cmd trên macOS). */
  ctrl?: boolean;
  shift?: boolean;
  /** Tên phím, viết thường. So bằng `key.toLowerCase()`. */
  key: string;
  /** Câu hiện cho người dùng. */
  label: string;
  /** File giữ listener. Để người đọc bảng biết đi đâu sửa. */
  owner: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'search', ctrl: true, key: 'k', label: 'Tìm chung', owner: 'CommandPalette.tsx' },
  { id: 'undo', ctrl: true, key: 'z', label: 'Hoàn tác', owner: 'EditorShell.tsx · ComponentEditorShell.tsx' },
  { id: 'redo', ctrl: true, shift: true, key: 'z', label: 'Làm lại', owner: 'EditorShell.tsx' },
  { id: 'duplicate', ctrl: true, key: 'd', label: 'Nhân bản node', owner: 'LayerTree.tsx' },
  {
    id: 'copy-ai-link',
    ctrl: true,
    shift: true,
    key: 'l',
    label: 'Copy link cho AI (element đang chọn)',
    owner: 'AiLinkProvider.tsx',
  },
  {
    id: 'layer-search',
    ctrl: true,
    key: 'p',
    label: 'Tìm lớp trong cây',
    owner: 'LayerTree.tsx',
  },
] as const;

export function shortcutById(id: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

/** `Ctrl+Shift+Z`. Không phân biệt macOS ở đây — xem `matchesShortcut`. */
export function shortcutText(s: Shortcut): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push('Ctrl');
  if (s.shift) parts.push('Shift');
  parts.push(s.key.toUpperCase());
  return parts.join('+');
}

/** Chữ ký để so trùng: cùng chữ ký = cùng tổ hợp. */
export function comboKey(s: Pick<Shortcut, 'ctrl' | 'shift' | 'key'>): string {
  return `${s.ctrl ? 'c' : ''}${s.shift ? 's' : ''}:${s.key.toLowerCase()}`;
}

/**
 * Các tổ hợp bị hai `id` khác nhau cùng khai. Rỗng là bảng lành.
 *
 * Trả về chữ ký chứ không ném: chỗ gọi là một test, và một danh sách đọc được thì nói
 * rõ cái nào đụng cái nào.
 */
export function collisions(list: readonly Shortcut[] = SHORTCUTS): string[] {
  const seen = new Map<string, string>();
  const bad: string[] = [];
  for (const s of list) {
    const k = comboKey(s);
    const owner = seen.get(k);
    if (owner) bad.push(`${k} — ${owner} và ${s.id}`);
    else seen.set(k, s.id);
  }
  return bad;
}

/**
 * Sự kiện bàn phím có khớp một phím tắt không.
 *
 * `metaKey || ctrlKey` cho `ctrl`: trên macOS người ta gõ Cmd, và hai chỗ đang có
 * (`EditorShell`, `ComponentEditorShell`) đã nhận cả hai. Một hàm chỉ nhận `ctrlKey`
 * sẽ làm phím tắt mới im lặng không chạy trên máy Mac.
 *
 * `shift` so CHẶT: `Ctrl+Z` và `Ctrl+Shift+Z` là hai việc khác nhau (hoàn tác / làm
 * lại), nên bỏ qua `shift` khi phím tắt không khai nó sẽ làm hoàn tác ăn cả làm lại.
 */
export function matchesShortcut(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  s: Shortcut,
): boolean {
  if (e.key.toLowerCase() !== s.key) return false;
  if (Boolean(s.ctrl) !== (e.metaKey || e.ctrlKey)) return false;
  if (Boolean(s.shift) !== e.shiftKey) return false;
  return true;
}

/**
 * Sự kiện đang xảy ra TRONG một ô nhập chữ.
 *
 * Phím tắt một chữ (nếu sau này có) và cả `Ctrl+K` đều không được cướp phím khi con trỏ
 * đang ở trong một textarea — `Ctrl+K` là "xoá tới cuối dòng" trong nhiều editor, và
 * người đang gõ một bài dài sẽ mất dòng đó.
 *
 * `contentEditable` cũng tính: ô soạn rich text của form nội dung là một trong số đó.
 *
 * ## Vì sao kiểm THUỘC TÍNH, không `instanceof HTMLElement`
 *
 * Hai lý do, và cái thứ hai mới là lý do thật:
 *
 *  1. `pnpm test` chạy `environment: 'node'`, nơi không có `HTMLElement` — nên
 *     `instanceof` làm chính hàm này không test được.
 *  2. `instanceof` so theo REALM. Canvas của builder là một `<iframe>`, và một element
 *     từ trong đó không phải `instanceof` `HTMLElement` của document ngoài — nên phím
 *     tắt sẽ cướp phím của người đang gõ trong iframe, im lặng và chỉ ở đúng chỗ đó.
 */
/*
 * Nhận `unknown`, không `EventTarget`: hàm này kiểm THUỘC TÍNH, nên kiểu hẹp hơn chỉ
 * là một lời hứa nó không giữ. `e.target` gán vào đây được, và test truyền được một
 * object trần mà không phải bịa một cast.
 */
export function inTextField(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}
