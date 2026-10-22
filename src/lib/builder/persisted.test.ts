/**
 * Trọng tâm: giá trị đã lưu KHÔNG được tin.
 *
 * Nó sống lâu hơn code đọc nó, nên nó là dữ liệu ngoài tầm kiểm soát y như một
 * request. Bỏ bước kiểm thì accordion mở ra một mục không tồn tại — pane trống,
 * không lỗi, không dấu vết.
 */

import { describe, expect, it, vi } from 'vitest';

import { readEnum, readFlag, readInt, write } from './persisted';

const store = (data: Record<string, string>) => ({
  getItem: (k: string) => data[k] ?? null,
});

const SECTIONS = ['layers', 'components', 'pages'] as const;

describe('readEnum', () => {
  it('trả giá trị khi nó nằm trong tập hợp lệ', () => {
    expect(readEnum(store({ s: 'components' }), 's', SECTIONS)).toBe('components');
  });

  it('trả null khi giá trị không còn hợp lệ — mục đã bị đổi tên hoặc bị ẩn', () => {
    // Chế độ sửa component chỉ có mục Lớp, nhưng người dùng đã lưu 'pages'.
    expect(readEnum(store({ s: 'pages' }), 's', ['layers'] as const)).toBeNull();
    expect(readEnum(store({ s: 'routes' }), 's', SECTIONS)).toBeNull();
  });

  it('trả null khi chưa có gì được lưu', () => {
    expect(readEnum(store({}), 's', SECTIONS)).toBeNull();
  });

  it('trả null khi không có storage — server, hoặc chế độ riêng tư', () => {
    expect(readEnum(null, 's', SECTIONS)).toBeNull();
  });

  it('không ném khi getItem ném', () => {
    const hostile = {
      getItem: () => {
        throw new Error('storage bị chặn bởi policy');
      },
    };
    expect(() => readEnum(hostile, 's', SECTIONS)).not.toThrow();
    expect(readEnum(hostile, 's', SECTIONS)).toBeNull();
  });

  it('không nhận chuỗi rỗng như một lựa chọn', () => {
    expect(readEnum(store({ s: '' }), 's', SECTIONS)).toBeNull();
  });
});

describe('readFlag', () => {
  it('chỉ nhận 1 và 0', () => {
    expect(readFlag(store({ c: '1' }), 'c')).toBe(true);
    expect(readFlag(store({ c: '0' }), 'c')).toBe(false);
  });

  it('coi mọi thứ khác là chưa có lựa chọn, KHÔNG coi là false', () => {
    // Phân biệt được "chưa chọn" với "chọn false" là điều kiện để bên gọi rơi về
    // mặc định của chính nó thay vì bị ép về false.
    for (const junk of ['true', 'false', 'yes', '2', '']) {
      expect(readFlag(store({ c: junk }), 'c')).toBeNull();
    }
    expect(readFlag(store({}), 'c')).toBeNull();
  });
});

describe('write', () => {
  it('ghi qua setItem', () => {
    const setItem = vi.fn();
    write({ setItem }, 'k', 'v');
    expect(setItem).toHaveBeenCalledWith('k', 'v');
  });

  it('không ném khi storage đầy hoặc bị chặn', () => {
    expect(() =>
      write(
        {
          setItem: () => {
            throw new Error('QuotaExceededError');
          },
        },
        'k',
        'v',
      ),
    ).not.toThrow();
  });

  it('không làm gì khi không có storage', () => {
    expect(() => write(null, 'k', 'v')).not.toThrow();
  });
});

describe('readInt', () => {
  it('nhận số nguyên trong khoảng', () => {
    expect(readInt(store({ w: '360' }), 'w', 280, 560)).toBe(360);
  });

  it('rác, số âm, số lẻ, ngoài khoảng → null (về mặc định), không kẹp', () => {
    for (const v of ['abc', '-300', '360.5', '9999', '100', '']) {
      expect(readInt(store({ w: v }), 'w', 280, 560)).toBeNull();
    }
    expect(readInt(store({}), 'w', 280, 560)).toBeNull();
    expect(readInt(null, 'w', 280, 560)).toBeNull();
  });
});
