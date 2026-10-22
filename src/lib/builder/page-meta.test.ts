import { describe, expect, it } from 'vitest';

/**
 * Metadata trang dịch theo ngôn ngữ.
 *
 * Tính chất chịu lực ở đây KHÔNG phải phép đọc — nó ba dòng. Mà là **địa chỉ
 * `$meta` không đụng ba hệ tách chuỗi đang có**:
 *
 *  1. `zNodeId` (`^[A-Za-z0-9_-]+$`) — nếu `$meta` là một node id hợp lệ thì một
 *     node thật cùng tên sẽ tranh chỗ với hàng metadata.
 *  2. `snapshotKey` = `locale:nodeId:field`, và `entriesFromSnapshot` tách đúng
 *     hai lần. Một dấu `:` trong địa chỉ là nó đọc sai cả hàng.
 *  3. `INSTANCE_SEP` = `/`. Một dấu `/` là `parseInstanceAddress` hiểu địa chỉ này
 *     thành "node local trong một instance".
 *
 * Cả ba đều hỏng IM LẶNG, và cả ba chỉ hỏng khi có dữ liệu thật — nên chúng phải
 * được canh bằng test chứ không bằng một comment.
 */

import { parseInstanceAddress } from './text-units';
import { entriesFromSnapshot, snapshotKey } from '@/lib/render/translations';
import { META_ADDRESS, PAGE_META_FIELDS, pageMetaFrom } from './page-meta';

describe('địa chỉ $meta không đụng hệ nào', () => {
  it('KHÔNG phải một nodeId hợp lệ', () => {
    // Cùng biểu thức với `zNodeId` trong `doc/schema.ts`.
    expect(/^[A-Za-z0-9_-]+$/.test(META_ADDRESS)).toBe(false);
  });

  it('đi qua khoá ảnh chụp release mà không bị tách sai', () => {
    const snapshot = {
      [snapshotKey('en', META_ADDRESS, 'title')]: 'About us',
      [snapshotKey('en', 'hero-title', 'content')]: [{ t: 'text', v: 'X' }],
      [snapshotKey('vi', META_ADDRESS, 'title')]: 'Về chúng tôi',
    };
    const rows = entriesFromSnapshot(snapshot, 'en');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.nodeId === META_ADDRESS)?.field).toBe('title');
  });

  it('KHÔNG bị hiểu thành địa chỉ trong instance', () => {
    expect(parseInstanceAddress(META_ADDRESS)).toBeNull();
  });
});

describe('pageMetaFrom', () => {
  const rows = (
    xs: { nodeId: string; field: string; value: unknown }[],
  ) => pageMetaFrom(xs);

  it('lấy title và description', () => {
    expect(
      rows([
        { nodeId: META_ADDRESS, field: 'title', value: 'About us' },
        { nodeId: META_ADDRESS, field: 'description', value: 'Who we are' },
      ]),
    ).toEqual({ title: 'About us', description: 'Who we are' });
  });

  it('BỎ QUA hàng của node — chúng đi đường khác', () => {
    // `applyTranslations` lo phần node. Nhặt chúng vào đây là hai chỗ đọc cùng một
    // hàng, và metadata sẽ nhận chữ của một node tình cờ có field `title`.
    expect(rows([{ nodeId: 'hero', field: 'title', value: 'X' }])).toEqual({});
  });

  it('bỏ qua giá trị không phải chuỗi — cột value là JSON tự do', () => {
    // Một hàng ghi bằng bản schema cũ hơn không đáng làm `<title>` thành
    // "[object Object]".
    expect(rows([{ nodeId: META_ADDRESS, field: 'title', value: [{ t: 'text', v: 'X' }] }])).toEqual(
      {},
    );
    expect(rows([{ nodeId: META_ADDRESS, field: 'title', value: null }])).toEqual({});
  });

  it('bỏ qua chuỗi trắng — nó KHÔNG được đè lên bản gốc', () => {
    // Một `<title>` rỗng là thứ Google hiển thị, và nó tệ hơn một tiêu đề sai
    // ngôn ngữ.
    expect(rows([{ nodeId: META_ADDRESS, field: 'title', value: '   ' }])).toEqual({});
  });

  it('cắt trắng hai đầu', () => {
    expect(rows([{ nodeId: META_ADDRESS, field: 'title', value: ' A ' }])).toEqual({ title: 'A' });
  });

  it('bỏ qua field lạ', () => {
    expect(rows([{ nodeId: META_ADDRESS, field: 'canonical', value: '/x' }])).toEqual({});
  });

  it('PAGE_META_FIELDS khớp với những field hàm này thật sự đọc', () => {
    // Thêm một field vào hằng mà quên nhánh đọc là một ô nhập lưu được rồi không
    // bao giờ ra site.
    for (const f of PAGE_META_FIELDS) {
      expect(rows([{ nodeId: META_ADDRESS, field: f, value: 'V' }])).toEqual({ [f]: 'V' });
    }
  });
});
