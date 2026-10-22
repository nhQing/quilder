import { describe, expect, it } from 'vitest';

import {
  checkLayout,
  findEdgeGaps,
  findOverflow,
  findOverlaps,
  type LayoutSnapshot,
  type MeasuredNode,
} from './layout-checks';

/**
 * Ba phép đo bố cục.
 *
 * Bản đầu của những hàm này nhận `Document` và phải test bằng một DOM giả — jsdom
 * trả `getBoundingClientRect()` toàn số 0 nên nó sẽ xanh mà không kiểm được gì.
 *
 * Giờ chúng nhận dữ liệu thuần, nên test chỉ là object. Trình duyệt chỉ còn việc
 * ĐO (một hàm bốn dòng, không có logic để sai), và phần có thể sai thì test được
 * thẳng.
 */

const node = (
  nodeId: string,
  parentId: string | null,
  rect: { top: number; left: number; width: number; height: number },
  position = 'static',
  insideComposite = false,
): MeasuredNode => ({ nodeId, parentId, rect, position, insideComposite });

const snap = (nodes: MeasuredNode[], viewport = 1000): LayoutSnapshot => ({ viewport, nodes });

const ROOT = node('root', null, { top: 0, left: 0, width: 1000, height: 800 });

describe('findOverflow', () => {
  it('bắt node vượt mép phải, kèm số px', () => {
    const found = findOverflow(
      snap([ROOT, node('n1', 'root', { top: 0, left: 0, width: 1240, height: 100 })]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'tran-ngang', nodeId: 'n1', px: 240 });
  });

  it('bỏ qua chênh 1px — trình duyệt làm tròn ở hầu hết trang', () => {
    // Không bỏ qua thì MỌI trang đều có báo cáo, và báo cáo có ở mọi trang là báo
    // cáo không ai đọc.
    expect(
      findOverflow(snap([ROOT, node('n1', 'root', { top: 0, left: 0, width: 1001, height: 50 })])),
    ).toHaveLength(0);
  });

  it('bỏ qua position: fixed — nó không tạo thanh cuộn ngang', () => {
    expect(
      findOverflow(
        snap([ROOT, node('n1', 'root', { top: 0, left: 0, width: 1400, height: 60 }, 'fixed')]),
      ),
    ).toHaveLength(0);
  });
});

describe('findOverlaps', () => {
  it('bắt hai ANH EM chồng nhau', () => {
    const found = findOverlaps(
      snap([
        ROOT,
        node('a', 'root', { top: 0, left: 0, width: 200, height: 100 }),
        node('b', 'root', { top: 50, left: 50, width: 200, height: 100 }),
      ]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('chong-lap');
    expect(found[0]!.detail).toContain('b');
  });

  it('KHÔNG báo cha–con: con nằm trong cha là chuyện bình thường', () => {
    expect(
      findOverlaps(
        snap([
          ROOT,
          node('a', 'root', { top: 0, left: 0, width: 400, height: 300 }),
          node('b', 'a', { top: 10, left: 10, width: 100, height: 100 }),
        ]),
      ),
    ).toHaveLength(0);
  });

  it('bỏ qua absolute — chồng lên nhau là mục đích của nó', () => {
    expect(
      findOverlaps(
        snap([
          ROOT,
          node('a', 'root', { top: 0, left: 0, width: 200, height: 200 }),
          node('b', 'root', { top: 10, left: 10, width: 100, height: 100 }, 'absolute'),
        ]),
      ),
    ).toHaveLength(0);
  });

  it('bỏ qua giao ≤ 4px — viền và bo góc tạo ra nó ở bố cục lành mạnh', () => {
    expect(
      findOverlaps(
        snap([
          ROOT,
          node('a', 'root', { top: 0, left: 0, width: 200, height: 100 }),
          node('b', 'root', { top: 98, left: 0, width: 200, height: 100 }),
        ]),
      ),
    ).toHaveLength(0);
  });

  it('bỏ qua chồng TOÀN PHẦN — đó là xếp lớp, không phải va chạm', () => {
    // ChapterParallax xếp nhiều panel cùng kích thước khung lên nhau để chuyển
    // cảnh. Lần chạy đầu trên trang thật, riêng nó chiếm phần lớn 93 báo cáo.
    expect(
      findOverlaps(
        snap([
          ROOT,
          node('p1', 'root', { top: 0, left: 0, width: 1000, height: 800 }),
          node('p2', 'root', { top: 0, left: 0, width: 1000, height: 800 }),
        ]),
      ),
    ).toHaveLength(0);
  });

  it('VẪN bắt chồng một phần — đó mới là va chạm', () => {
    // Ranh giới của ngưỡng 90%: phủ một góc thì báo, phủ gần trọn thì không.
    const found = findOverlaps(
      snap([
        ROOT,
        node('a', 'root', { top: 0, left: 0, width: 400, height: 400 }),
        node('b', 'root', { top: 300, left: 300, width: 400, height: 400 }),
      ]),
    );
    expect(found).toHaveLength(1);
  });

  it('node ở hai cha khác nhau không so với nhau', () => {
    expect(
      findOverlaps(
        snap([
          ROOT,
          node('p1', 'root', { top: 0, left: 0, width: 500, height: 400 }),
          node('p2', 'root', { top: 500, left: 0, width: 500, height: 400 }),
          node('a', 'p1', { top: 0, left: 0, width: 100, height: 100 }),
          node('b', 'p2', { top: 0, left: 0, width: 100, height: 100 }),
        ]),
      ),
    ).toHaveLength(0);
  });
});

describe('findEdgeGaps', () => {
  it('bắt khe LỆCH — đúng hình dạng của dải đen 240px', () => {
    // Nội dung dừng ở 760, để lại 240px trống bên phải trong khi trái sát mép.
    const found = findEdgeGaps(
      snap([ROOT, node('n1', 'root', { top: 0, left: 0, width: 760, height: 200 })]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'khe-ho-mep', nodeId: 'n1', px: 240 });
  });

  it('KHÔNG báo khe hai bên bằng nhau — đó là căn giữa có chủ đích', () => {
    // Báo sai vài lần thì lần thứ tư không ai đọc công cụ này nữa.
    expect(
      findEdgeGaps(
        snap([ROOT, node('n1', 'root', { top: 0, left: 100, width: 800, height: 200 })]),
      ),
    ).toHaveLength(0);
  });

  it('bỏ qua node kích thước 0 — không chiếm chỗ thì không có khe', () => {
    expect(
      findEdgeGaps(snap([ROOT, node('n1', 'root', { top: 0, left: 0, width: 0, height: 0 })])),
    ).toHaveLength(0);
  });

  it('chỉ xét con TRỰC TIẾP của gốc — section thụt vào là bình thường', () => {
    expect(
      findEdgeGaps(
        snap([
          ROOT,
          node('sec', 'root', { top: 0, left: 0, width: 1000, height: 400 }),
          node('inner', 'sec', { top: 0, left: 0, width: 600, height: 200 }),
        ]),
      ),
    ).toHaveLength(0);
  });

  it('bỏ qua node ngoài luồng — header fixed hẹp hơn khung là bình thường', () => {
    // Nguồn báo động giả đầu tiên phát hiện được khi chạy trên trang thật:
    // `findOverflow` bỏ qua `fixed` từ đầu, `findEdgeGaps` thì quên.
    expect(
      findEdgeGaps(
        snap([ROOT, node('hdr', 'root', { top: 0, left: 0, width: 700, height: 60 }, 'fixed')]),
      ),
    ).toHaveLength(0);
  });

  it('bỏ qua node hẹp — một link nav cạnh mép trái không phải dải hụt', () => {
    // Phép đo giả định con trực tiếp của gốc là dải tràn ngang. Cây thật có cả
    // node nhỏ ngay dưới gốc, và chúng sẽ luôn "lệch mép".
    expect(
      findEdgeGaps(snap([ROOT, node('nav1', 'root', { top: 0, left: 0, width: 60, height: 20 })])),
    ).toHaveLength(0);
  });

  it('không có gốc thì trả rỗng thay vì ném', () => {
    expect(findEdgeGaps(snap([node('a', 'b', { top: 0, left: 0, width: 10, height: 10 })]))).toEqual(
      [],
    );
  });
});

describe('checkLayout', () => {
  it('gộp ba phép đo, nghiêm trọng nhất lên đầu', () => {
    const found = checkLayout(
      snap([
        ROOT,
        node('nho', 'root', { top: 0, left: 0, width: 1010, height: 50 }),
        node('to', 'root', { top: 100, left: 0, width: 1300, height: 50 }),
      ]),
    );
    expect(found[0]!.nodeId).toBe('to');
    expect(found[0]!.px).toBeGreaterThan(found[1]!.px);
  });

  it('trang sạch thì không báo gì', () => {
    expect(
      checkLayout(
        snap([
          ROOT,
          node('n1', 'root', { top: 0, left: 0, width: 1000, height: 200 }),
          node('n2', 'root', { top: 200, left: 0, width: 1000, height: 200 }),
        ]),
      ),
    ).toEqual([]);
  });
});
