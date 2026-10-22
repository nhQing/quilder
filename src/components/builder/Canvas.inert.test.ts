import { describe, expect, it, vi } from 'vitest';

import { attachInert, attachInertWhenReady, type InertHandlers } from './Canvas';

/**
 * Lớp vô hiệu hoá tương tác phải chịu được KHUNG CHƯA SẴN SÀNG.
 *
 * ## Lỗi thật
 *
 * `Application error: a client-side exception has occurred` /
 * `Uncaught TypeError: Cannot read properties of null (reading 'appendChild')`
 * — trang soạn thảo trắng hoàn toàn, và chỉ khi vào bằng cách NHẤN LINK từ danh
 * sách `/builder`, không phải khi mở thẳng URL.
 *
 * Guard cũ là `if (!win || !fdoc) return;`. Nó kiểm `contentDocument` có tồn tại,
 * và dừng ở đó. Nhưng lúc tài liệu trong iframe đang bị THAY (điều hướng phía
 * client), `contentDocument` có mà `documentElement` là `null`: tài liệu tồn tại,
 * cây tài liệu chưa có gốc. `fdoc.documentElement.appendChild(style)` ném ngay
 * trong lúc render một effect, tức React gỡ cả cây — trắng trang, không phải một
 * khối hỏng.
 *
 * ## Vì sao test dựng thẳng tình huống thay vì tái hiện bằng thao tác
 *
 * Đây là CẠNH TRANH THỜI ĐIỂM. Mở thẳng URL và mở qua danh sách, trên bốn trang
 * khác nhau, đều không ra lỗi. Một test "bấm link rồi xem có lỗi không" sẽ xanh
 * gần như mọi lần và không chứng minh gì cả. Đối tượng test đúng là chính phép
 * gắn, với một tài liệu ở đúng trạng thái đó.
 *
 * Hai tính chất phải giữ, và tính chất thứ hai mới là chỗ dễ hỏng khi vá vội:
 *
 *  1. Khung chưa sẵn sàng thì KHÔNG ném, và không để lại thứ gì phải dọn.
 *  2. Bỏ qua lượt này thì phải có đường CHẠY LẠI. Guard suông làm hết trắng trang
 *     nhưng khung soạn thảo mất hẳn lớp CSS vô hiệu hoá — link trong khung xem
 *     trước lại điều hướng được, và một cú bấm nhầm là mất cả phiên làm việc.
 */

interface FakeStyle {
  dataset: Record<string, string>;
  textContent: string;
  remove: ReturnType<typeof vi.fn>;
}

function fakeFrame(opts: { root?: boolean } = {}) {
  const style: FakeStyle = { dataset: {}, textContent: '', remove: vi.fn() };
  const appendChild = vi.fn();

  const docAdd = vi.fn();
  const docRemove = vi.fn();
  const winAdd = vi.fn();
  const winRemove = vi.fn();

  const fdoc = {
    // `null` là đúng hình dạng thật: tài liệu CÓ, cây tài liệu chưa có gốc.
    documentElement: opts.root ? { appendChild } : null,
    createElement: vi.fn(() => style),
    addEventListener: docAdd,
    removeEventListener: docRemove,
  };

  const frame = {
    contentWindow: { addEventListener: winAdd, removeEventListener: winRemove },
    contentDocument: fdoc,
  };

  /** Cho khung "nạp xong" giữa chừng — dùng để kiểm đường chạy lại. */
  const becomeReady = () => {
    (fdoc as { documentElement: unknown }).documentElement = { appendChild };
  };

  return { frame: frame as unknown as HTMLIFrameElement, style, appendChild, docAdd, docRemove, winAdd, winRemove, becomeReady };
}

const handlers = (): InertHandlers => ({ select: vi.fn(), hover: vi.fn(), onScroll: vi.fn() });

describe('attachInert', () => {
  it('tài liệu CÓ mà documentElement là null → trả null, KHÔNG ném', () => {
    const f = fakeFrame({ root: false });
    expect(() => attachInert(f.frame, handlers())).not.toThrow();
    expect(attachInert(f.frame, handlers())).toBeNull();
  });

  it('bỏ qua lượt đó thì không để lại gì phải dọn — chưa gắn listener nào', () => {
    // Thứ tự là phần quan trọng: bản cũ gắn listener TRƯỚC rồi mới đụng
    // `documentElement`, nên cú ném để lại 15 listener trên một tài liệu mà
    // không còn cleanup nào chạy tới.
    const f = fakeFrame({ root: false });
    attachInert(f.frame, handlers());
    expect(f.docAdd).not.toHaveBeenCalled();
    expect(f.winAdd).not.toHaveBeenCalled();
  });

  it('bỏ qua lượt đó thì KHÔNG tạo style — cleanup không gọi remove() trên thứ chưa gắn', () => {
    const f = fakeFrame({ root: false });
    attachInert(f.frame, handlers());
    expect(f.style.remove).not.toHaveBeenCalled();
  });

  it('khung không có cửa sổ cũng trả null', () => {
    expect(attachInert({ contentWindow: null, contentDocument: null } as unknown as HTMLIFrameElement, handlers()))
      .toBeNull();
    expect(attachInert(null, handlers())).toBeNull();
  });

  it('khung sẵn sàng → gắn style vào GỐC tài liệu và trả hàm dọn', () => {
    const f = fakeFrame({ root: true });
    const detach = attachInert(f.frame, handlers());
    expect(detach).toBeTypeOf('function');
    expect(f.appendChild).toHaveBeenCalledWith(f.style);
    expect(f.style.dataset.mmInert).toBe('');
    expect(f.style.textContent).toContain('user-select');
  });

  it('dọn gỡ ĐÚNG số listener đã gắn, và gỡ cả style', () => {
    const f = fakeFrame({ root: true });
    const detach = attachInert(f.frame, handlers())!;
    const added = f.docAdd.mock.calls.length;
    detach();
    expect(f.docRemove.mock.calls.length).toBe(added);
    expect(f.winRemove.mock.calls.length).toBe(f.winAdd.mock.calls.length);
    expect(f.style.remove).toHaveBeenCalledTimes(1);
  });
});

describe('attachInertWhenReady — đường chạy lại', () => {
  /** Hàng đợi thay `requestAnimationFrame`, để test không phụ thuộc thời gian. */
  function queue() {
    const jobs: Array<() => void> = [];
    const schedule = (fn: () => void) => {
      jobs.push(fn);
      return () => {
        const at = jobs.indexOf(fn);
        if (at >= 0) jobs.splice(at, 1);
      };
    };
    const runOne = () => jobs.shift()?.();
    return { schedule, runOne, size: () => jobs.length };
  }

  it('khung chưa sẵn sàng thì thử lại, và gắn được ngay khi có gốc', () => {
    const f = fakeFrame({ root: false });
    const q = queue();
    attachInertWhenReady(f.frame, handlers(), q.schedule);

    expect(f.appendChild).not.toHaveBeenCalled();
    expect(q.size()).toBe(1);

    q.runOne();
    expect(f.appendChild).not.toHaveBeenCalled();

    f.becomeReady();
    q.runOne();
    expect(f.appendChild).toHaveBeenCalledTimes(1);
  });

  it('gắn xong thì thôi hẹn — không có vòng lặp chạy mãi', () => {
    const f = fakeFrame({ root: true });
    const q = queue();
    attachInertWhenReady(f.frame, handlers(), q.schedule);
    expect(f.appendChild).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });

  it('huỷ trước khi khung sẵn sàng thì không gắn nữa', () => {
    const f = fakeFrame({ root: false });
    const q = queue();
    const cancel = attachInertWhenReady(f.frame, handlers(), q.schedule);
    cancel();
    expect(q.size()).toBe(0);

    f.becomeReady();
    q.runOne();
    expect(f.appendChild).not.toHaveBeenCalled();
  });

  it('huỷ sau khi gắn thì dọn đúng như attachInert', () => {
    const f = fakeFrame({ root: true });
    const q = queue();
    attachInertWhenReady(f.frame, handlers(), q.schedule)();
    expect(f.style.remove).toHaveBeenCalledTimes(1);
  });

  it('khung không bao giờ sẵn sàng thì BỎ CUỘC — không hẹn vô hạn', () => {
    // Một iframe khác nguồn, hay một khung bị gỡ giữa chừng, sẽ không bao giờ có
    // gốc. Hẹn lại mỗi khung hình mãi mãi là một vòng lặp ăn CPU suốt phiên làm
    // việc, và nó im lặng.
    const f = fakeFrame({ root: false });
    const q = queue();
    attachInertWhenReady(f.frame, handlers(), q.schedule);
    for (let i = 0; i < 1000 && q.size(); i++) q.runOne();
    expect(q.size()).toBe(0);
    expect(f.appendChild).not.toHaveBeenCalled();
  });
});
