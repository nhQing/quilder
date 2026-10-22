import { describe, expect, it } from 'vitest';

import type { FieldDef, GroupTable } from './field-def';
import {
  appendItem, emptyBlock, emptyEntry, emptyValue, moveItem, readAt, removeItem, writeAt,
} from './form-state';

const GROUPS: GroupTable = {
  cta: [
    { t: 'text', key: 'heading', label: 'Tiêu đề' },
    { t: 'boolean', key: 'wide', label: 'Rộng', default: true },
  ],
  quote: [{ t: 'text', key: 'text', label: 'Câu trích' }],
};

describe('emptyValue', () => {
  it('text rỗng là chuỗi rỗng, không phải undefined', () => {
    // `undefined` làm input React nhảy giữa controlled và uncontrolled, và React
    // sẽ cảnh báo ở console rồi mất con trỏ giữa lúc gõ.
    expect(emptyValue({ t: 'text', key: 'a', label: 'A' }, GROUPS)).toBe('');
  });

  it('richtext rỗng là một đoạn rỗng, không phải mảng rỗng', () => {
    // Mảy rỗng thì trình soạn thảo không có chỗ để đặt con trỏ.
    expect(emptyValue({ t: 'richtext', key: 'b', label: 'B' }, GROUPS)).toEqual([{ t: 'text', v: '' }]);
  });

  it('richdoc rỗng là MỘT khối p có một đoạn rỗng', () => {
    // `zRichDoc` có `.min(1)` nên `[]` bị từ chối ngay lúc lưu; và không có khối
    // nào thì ô soạn không có chỗ đặt con trỏ.
    expect(emptyValue({ t: 'richdoc', key: 'b', label: 'B' }, GROUPS)).toEqual([
      { b: 'p', children: [{ t: 'text', v: '' }] },
    ]);
  });

  it('boolean lấy default của field, không phải false', () => {
    expect(emptyValue({ t: 'boolean', key: 'c', label: 'C', default: true }, GROUPS)).toBe(true);
    expect(emptyValue({ t: 'boolean', key: 'c', label: 'C' }, GROUPS)).toBe(false);
  });

  it('enum lấy lựa chọn ĐẦU TIÊN, không để trống', () => {
    const f: FieldDef = { t: 'enum', key: 'e', label: 'E', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] };
    expect(emptyValue(f, GROUPS)).toBe('x');
  });

  it('nhóm lặp rỗng là mảng rỗng; nhóm không lặp là một object đã có field', () => {
    const rep: FieldDef = { t: 'group', key: 'g', label: 'G', groupKey: 'cta', repeatable: true };
    expect(emptyValue(rep, GROUPS)).toEqual([]);
    const one: FieldDef = { t: 'group', key: 'g', label: 'G', groupKey: 'cta' };
    expect(emptyValue(one, GROUPS)).toEqual({ heading: '', wide: true });
  });

  it('blocks rỗng là mảy rỗng', () => {
    expect(emptyValue({ t: 'blocks', key: 'z', label: 'Z', allowed: ['cta'] }, GROUPS)).toEqual([]);
  });

  it('nhóm mồ côi trả object rỗng, không ném', () => {
    const f: FieldDef = { t: 'group', key: 'g', label: 'G', groupKey: 'khong-co' };
    expect(emptyValue(f, GROUPS)).toEqual({});
  });
});

describe('emptyEntry', () => {
  it('có đúng một khoá cho mỗi field', () => {
    const fields: FieldDef[] = [
      { t: 'text', key: 'title', label: 'Tiêu đề' },
      { t: 'group', key: 'ctas', label: 'CTA', groupKey: 'cta', repeatable: true },
    ];
    expect(emptyEntry(fields, GROUPS)).toEqual({ title: '', ctas: [] });
  });

  it('field taxonomy KHÔNG tạo khoá trong data — giá trị sống ở bảng nối', () => {
    // Tạo khoá ở đây nghĩa là form gửi `data.cats`, server strip đi, và form giữ một
    // khoá không bao giờ quay về. Người đọc sau sẽ tưởng `data` là nguồn.
    const fields: FieldDef[] = [
      { t: 'text', key: 'title', label: 'Tiêu đề' },
      { t: 'taxonomy', key: 'cats', label: 'Danh mục', required: true, multiple: true },
    ];
    const out = emptyEntry(fields, GROUPS);
    expect(out).toEqual({ title: '' });
    expect('cats' in out).toBe(false);
  });

  it('field slug KHÔNG tạo khoá — `slug: ""` làm mọi lần tạo bài trả 400', () => {
    /*
     * Đây là lỗi đã sống sót lâu, và test này là hàng rào cho nó.
     *
     * `validateEntryData` từ chối slug rỗng, nên một khoá `slug: ''` trong `data` làm
     * `POST /api/collections/:type/entries` trả `slug: Không được để trống` — tức
     * không ai tạo được bài nào qua giao diện, với mọi loại không phải singleton.
     *
     * Lỗi không lộ ra vì mọi bài hiện có đều được tạo qua MCP hoặc API, và hai đường
     * đó không gửi khoá `slug`. `collection-admin.spec.ts` — bài kiểm chứng metric
     * thành công duy nhất của dự án — đỏ vì đúng lý do này.
     */
    const fields: FieldDef[] = [
      { t: 'text', key: 'title', label: 'Tiêu đề', required: true },
      { t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'title' },
    ];
    const out = emptyEntry(fields, GROUPS);
    expect(out).toEqual({ title: '' });
    expect('slug' in out).toBe(false);
  });
});

describe('emptyBlock', () => {
  it('gắn __type và các field của khối', () => {
    expect(emptyBlock('cta', GROUPS)).toEqual({ __type: 'cta', heading: '', wide: true });
  });

  it('khối mồ côi vẫn có __type — nếu không thì render không biết nó là gì', () => {
    expect(emptyBlock('khong-co', GROUPS)).toEqual({ __type: 'khong-co' });
  });
});

describe('readAt / writeAt', () => {
  const data = { title: 'A', ctas: [{ heading: 'x' }, { heading: 'y' }] };

  it('đọc được đường dẫn lồng qua chỉ số mảy', () => {
    expect(readAt(data, ['ctas', 1, 'heading'])).toBe('y');
  });

  it('đọc đường dẫn không tồn tại trả undefined, không ném', () => {
    expect(readAt(data, ['ctas', 9, 'heading'])).toBeUndefined();
  });

  it('ghi vào đường dẫn lồng, KHÔNG sửa object gốc', () => {
    const out = writeAt(data, ['ctas', 0, 'heading'], 'đã sửa');
    expect(readAt(out, ['ctas', 0, 'heading'])).toBe('đã sửa');
    expect(readAt(data, ['ctas', 0, 'heading'])).toBe('x');
  });

  it('ghi cạn cũng không sửa gốc', () => {
    const out = writeAt(data, ['title'], 'B');
    expect(out.title).toBe('B');
    expect(data.title).toBe('A');
  });

  it('mục cạnh nhau không bị copy chung tham chiếu — sửa mục 0 không đổi mục 1', () => {
    // Đây là lỗi kinh điển của clone cạn trong form lồng: gõ vào một đoạn CTA thì
    // đoạn dưới đổi theo, và nó chỉ lộ ra khi có mục thứ hai.
    const out = writeAt(data, ['ctas', 0, 'heading'], 'z');
    expect(readAt(out, ['ctas', 1, 'heading'])).toBe('y');
  });
});

describe('appendItem / removeItem / moveItem', () => {
  const data = { zone: [{ __type: 'quote', text: 'a' }, { __type: 'cta', heading: 'b' }] };

  it('thêm vào cuối', () => {
    const out = appendItem(data, ['zone'], { __type: 'quote', text: 'c' });
    expect((out.zone as unknown[]).length).toBe(3);
    expect(readAt(out, ['zone', 2, 'text'])).toBe('c');
  });

  it('thêm vào đường dẫn chưa có mảy thì tạo mảy', () => {
    const out = appendItem({} as Record<string, unknown>, ['zone'], { __type: 'quote' });
    expect((out.zone as unknown[]).length).toBe(1);
  });

  it('xoá theo chỉ số', () => {
    const out = removeItem(data, ['zone'], 0);
    expect((out.zone as unknown[]).length).toBe(1);
    expect(readAt(out, ['zone', 0, '__type'])).toBe('cta');
  });

  it('xoá chỉ số không tồn tại thì không đổi gì, không ném', () => {
    expect(removeItem(data, ['zone'], 9)).toEqual(data);
  });

  it('di chuyển lên', () => {
    const out = moveItem(data, ['zone'], 1, -1);
    expect(readAt(out, ['zone', 0, '__type'])).toBe('cta');
  });

  it('di chuyển quá biên thì không đổi gì — nút ▲ ở mục đầu là vô hại', () => {
    expect(moveItem(data, ['zone'], 0, -1)).toEqual(data);
    expect(moveItem(data, ['zone'], 1, 1)).toEqual(data);
  });

  it('mọi thao tác đều không sửa gốc', () => {
    const before = JSON.stringify(data);
    appendItem(data, ['zone'], {});
    removeItem(data, ['zone'], 0);
    moveItem(data, ['zone'], 0, 1);
    expect(JSON.stringify(data)).toBe(before);
  });
});
