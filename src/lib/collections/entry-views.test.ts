import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn((args: unknown) => args);
const $transaction = vi.fn(async (ops: unknown[]) => ops);

vi.mock('@/lib/db', () => ({
  prisma: {
    entry: { update: (args: unknown) => update(args) },
    $transaction: (ops: unknown[]) => $transaction(ops),
  },
}));

import { flushViews, recordView } from './entry-views';

beforeEach(() => {
  update.mockClear();
  $transaction.mockClear();
});

describe('recordView', () => {
  it('mười lượt xem một bài là MỘT lượt ghi, cộng mười', async () => {
    // Không gom thì mười lượt xem là mười `UPDATE` đụng cùng một hàng, xếp hàng sau
    // một row lock — bài càng được đọc càng chậm.
    for (let i = 0; i < 10; i += 1) recordView('e1');
    await flushViews();

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { viewCount: { increment: 10 } },
    });
  });

  it('hai bài khác nhau vẫn là một transaction, hai update', async () => {
    recordView('e1');
    recordView('e2');
    recordView('e1');
    await flushViews();

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('không có gì đang chờ thì KHÔNG chạm DB', async () => {
    await flushViews();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('lượt xem tới giữa lúc đang ghi rơi vào cửa sổ SAU, không mất', async () => {
    // `flush` lấy bộ đệm ra rồi mới `await`. Nếu nó `clear()` sau khi chờ xong thì
    // mọi lượt xem đến trong lúc chờ bị xoá — im lặng, và chỉ lệch khi có traffic.
    recordView('e1');
    const inFlight = flushViews();
    recordView('e1');
    await inFlight;

    expect(update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { viewCount: { increment: 1 } },
    });

    await flushViews();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('DB ném thì bỏ cửa sổ đó, không trả lại hàng đợi', async () => {
    // Ca hay gặp: một bài vừa bị xoá giữa cửa sổ, `update` ném và transaction rơi cả
    // lô. Trả lô về hàng đợi là để nó hỏng mãi mãi và kéo theo mọi lượt xem sau.
    $transaction.mockRejectedValueOnce(new Error('RecordNotFound'));
    recordView('da-xoa');
    await flushViews();

    update.mockClear();
    await flushViews();
    expect(update).not.toHaveBeenCalled();
  });
});
