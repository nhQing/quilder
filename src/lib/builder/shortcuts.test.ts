import { describe, expect, it } from 'vitest';

import {
  collisions,
  comboKey,
  inTextField,
  matchesShortcut,
  shortcutById,
  shortcutText,
  SHORTCUTS,
  type Shortcut,
} from './shortcuts';

const ev = (o: Partial<KeyboardEvent> & { key: string }) => ({
  key: o.key,
  ctrlKey: o.ctrlKey ?? false,
  metaKey: o.metaKey ?? false,
  shiftKey: o.shiftKey ?? false,
});

describe('bảng phím tắt', () => {
  /**
   * Test CHỊU LỰC của cả file.
   *
   * Lý do bảng này tồn tại: hai chỗ giành một tổ hợp là lỗi không ai thấy khi review một
   * file, và thứ thắng phụ thuộc thứ tự mount. Dòng dưới làm nó thành một test đỏ.
   */
  it('không tổ hợp nào bị hai phím tắt cùng khai', () => {
    expect(collisions()).toEqual([]);
  });

  it('phát hiện trùng khi có thật', () => {
    const bad: Shortcut[] = [
      { id: 'a', ctrl: true, key: 'k', label: 'A', owner: 'x' },
      { id: 'b', ctrl: true, key: 'k', label: 'B', owner: 'y' },
    ];
    expect(collisions(bad)).toHaveLength(1);
    expect(collisions(bad)[0]).toContain('a');
    expect(collisions(bad)[0]).toContain('b');
  });

  it('shift làm nên một tổ hợp KHÁC', () => {
    // `Ctrl+Z` và `Ctrl+Shift+Z` là hoàn tác và làm lại. Coi chúng là một thì hoàn tác
    // sẽ ăn cả làm lại.
    expect(comboKey({ ctrl: true, key: 'z' })).not.toBe(comboKey({ ctrl: true, shift: true, key: 'z' }));
    expect(collisions()).toEqual([]);
  });

  it('mọi id là duy nhất', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mọi phím tắt khai owner — bảng không có chủ là bảng không sửa được', () => {
    for (const s of SHORTCUTS) expect(s.owner.trim().length).toBeGreaterThan(0);
  });
});

describe('shortcutText', () => {
  it('đọc được', () => {
    expect(shortcutText({ id: 'x', ctrl: true, key: 'k', label: '', owner: '' })).toBe('Ctrl+K');
    expect(shortcutText({ id: 'x', ctrl: true, shift: true, key: 'z', label: '', owner: '' })).toBe(
      'Ctrl+Shift+Z',
    );
  });
});

describe('matchesShortcut', () => {
  const search = shortcutById('search')!;
  const redo = shortcutById('redo')!;

  it('khớp Ctrl và cả Cmd — macOS gõ Cmd', () => {
    expect(matchesShortcut(ev({ key: 'k', ctrlKey: true }), search)).toBe(true);
    expect(matchesShortcut(ev({ key: 'k', metaKey: true }), search)).toBe(true);
  });

  it('không khớp khi thiếu Ctrl', () => {
    expect(matchesShortcut(ev({ key: 'k' }), search)).toBe(false);
  });

  it('KHÔNG khớp khi có shift mà phím tắt không khai shift', () => {
    // Đây là chỗ dễ sai nhất: bỏ qua `shift` thì `Ctrl+Shift+Z` cũng chạy hoàn tác.
    expect(matchesShortcut(ev({ key: 'k', ctrlKey: true, shiftKey: true }), search)).toBe(false);
  });

  it('khớp phím tắt CÓ shift', () => {
    expect(matchesShortcut(ev({ key: 'Z', ctrlKey: true, shiftKey: true }), redo)).toBe(true);
    expect(matchesShortcut(ev({ key: 'z', ctrlKey: true }), redo)).toBe(false);
  });

  it('không phân biệt chữ hoa — bàn phím trả "K" khi có Shift', () => {
    expect(matchesShortcut(ev({ key: 'K', ctrlKey: true }), search)).toBe(true);
  });
});

describe('inTextField', () => {
  it('nhận ba loại ô nhập', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(inTextField({ tagName: tag, isContentEditable: false }), tag).toBe(true);
    }
  });

  it('nhận contentEditable — ô soạn rich text là một trong số đó', () => {
    expect(inTextField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('div thường thì không', () => {
    expect(inTextField({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('target không phải element thì không, và không ném', () => {
    expect(inTextField(null)).toBe(false);
  });
});
