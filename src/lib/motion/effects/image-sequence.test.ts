/**
 * Phép ánh xạ tiến độ cuộn → khung ảnh.
 *
 * Đây là phần đáng sai nhất của `image-sequence`, và nó là số học thuần nên test
 * được không cần DOM, không cần GSAP, không cần ảnh.
 *
 * "Đáng sai" theo nghĩa cụ thể: cả ba lỗi dưới đây đều làm clip VẪN CHẠY, chỉ là
 * chạy sai, nên không có gì trong runtime báo ra và mắt đọc code không bắt được.
 *
 *   1. Lệch một ở hai biên — khung đầu bị bỏ qua, hoặc khung cuối không bao giờ
 *      hiện. Với `Math.floor` thì khung cuối chỉ hiện đúng tại `p === 1`, một
 *      điểm mà cuộn eased gần như không bao giờ dừng đúng vào.
 *   2. `tail` quên kéo giãn tiến độ: nhịp giữ ở cuối biến thành "clip chạy chậm
 *      đi", tức là tham số vẫn có tác dụng nhưng KHÔNG phải tác dụng đã hứa.
 *   3. `nearestLoaded` trả 0 thay vì -1 khi chưa có khung nào: `src` trỏ vào một
 *      URL chưa nằm trong cache và người dùng thấy đúng cái nháy trắng mà cả
 *      thiết kế này sinh ra để tránh.
 */

import { describe, expect, it } from 'vitest';

import { frameAt, loChon, nearestLoaded, seqProgress } from './image-sequence';

describe('frameAt — tiến độ thành chỉ số khung', () => {
  it('hai biên: p=0 ra khung đầu, p=1 ra khung cuối', () => {
    expect(frameAt(0, 60)).toBe(0);
    expect(frameAt(1, 60)).toBe(59);
  });

  it('giữa chừng chia đều', () => {
    expect(frameAt(0.5, 101)).toBe(50);
    expect(frameAt(0.25, 101)).toBe(25);
  });

  it('khung cuối hiện TRƯỚC khi p chạm đúng 1', () => {
    // Với `Math.floor` thì đây là 58 và khung 59 là khung không ai thấy.
    expect(frameAt(0.999, 60)).toBe(59);
    expect(frameAt(0.995, 60)).toBe(59);
  });

  it('kẹp ngoài khoảng thay vì trả chỉ số không tồn tại', () => {
    expect(frameAt(-0.4, 60)).toBe(0);
    expect(frameAt(1.4, 60)).toBe(59);
  });

  it('lô một khung không chia cho 0', () => {
    expect(frameAt(0, 1)).toBe(0);
    expect(frameAt(1, 1)).toBe(0);
    expect(frameAt(0.5, 0)).toBe(0);
  });
});

describe('seqProgress — tail kéo giãn tiến độ', () => {
  it('tail = 0 thì tiến độ đi thẳng', () => {
    expect(seqProgress(0, 3, 0)).toBe(0);
    expect(seqProgress(0.5, 3, 0)).toBe(0.5);
    expect(seqProgress(1, 3, 0)).toBe(1);
  });

  it('tail > 0: clip chạy HẾT trước nhịp giữ, rồi đứng yên', () => {
    // span 3 + tail 1 = 4 màn. Clip phải hết ở 3/4 đường băng.
    expect(seqProgress(0.75, 3, 1)).toBeCloseTo(1, 10);
    // Và mọi thứ sau đó vẫn là 1 — đó chính là nhịp giữ.
    expect(seqProgress(0.9, 3, 1)).toBe(1);
    expect(seqProgress(1, 3, 1)).toBe(1);
  });

  it('tail không làm clip chạy chậm đi — nửa đường băng hữu ích vẫn là nửa clip', () => {
    // Lỗi kinh điển: quên chia, `tail` biến thành hệ số giảm tốc. Lúc đó
    // seqProgress(0.375, 3, 1) sẽ ra 0.375 chứ không phải 0.5.
    expect(seqProgress(0.375, 3, 1)).toBeCloseTo(0.5, 10);
  });

  it('kẹp đầu vào ngoài khoảng', () => {
    expect(seqProgress(-1, 3, 0.5)).toBe(0);
    expect(seqProgress(2, 3, 0.5)).toBe(1);
  });
});

describe('seqProgress + frameAt — đường đi thật của một cú scrub', () => {
  it('span 3, tail 1, 60 khung: khung cuối đã hiện tại 3/4 đường băng', () => {
    const khung = (p: number) => frameAt(seqProgress(p, 3, 1), 60);
    expect(khung(0)).toBe(0);
    expect(khung(0.375)).toBe(30);
    expect(khung(0.75)).toBe(59);
    // Nhịp giữ: cuộn tiếp mà khung không đổi.
    expect(khung(0.9)).toBe(59);
    expect(khung(1)).toBe(59);
  });
});

describe('nearestLoaded — không bao giờ trỏ vào khung chưa tải', () => {
  it('khung muốn đã tải thì lấy đúng nó', () => {
    expect(nearestLoaded([true, true, true], 1)).toBe(1);
  });

  it('chưa tải thì lấy khung gần nhất, ưu tiên phía trước', () => {
    const daTai = [true, false, false, false, true];
    // Cách đều hai phía (2 → 0 và 4): lấy phía TRƯỚC, tức khung đã đi qua.
    expect(nearestLoaded(daTai, 2)).toBe(0);
    expect(nearestLoaded(daTai, 3)).toBe(4);
  });

  it('chưa có khung nào thì trả -1, KHÔNG trả 0', () => {
    // Trả 0 ở đây là trỏ `src` vào một URL chưa có trong cache — đúng cái nháy
    // trắng mà preload sinh ra để tránh.
    expect(nearestLoaded([false, false, false], 1)).toBe(-1);
  });

  it('lô rỗng không lặp vô hạn', () => {
    expect(nearestLoaded([], 0)).toBe(-1);
  });
});

describe('loChon — ba lô theo cỡ màn', () => {
  const p = { frames: ['w1', 'w2'], framesNarrow: ['n1', 'n2'], framesSuper: ['s1', 's2'], narrowBelow: 'md' as const, superMinPx: 2200 };

  it('màn nhỏ lấy lô hẹp, kể cả khi mật độ điểm ảnh cao', () => {
    // Điện thoại 390 × DPR 3 = 1170 — nhưng dù có vượt ngưỡng, dưới mốc hẹp vẫn
    // là lô hẹp: băng thông di động mới là thứ lô này sinh ra để chăm.
    expect(loChon(p, { rongNhat: false, diemAnh: 4000 })).toEqual(['n1', 'n2']);
  });

  it('màn vừa lấy lô rộng', () => {
    expect(loChon(p, { rongNhat: true, diemAnh: 1440 })).toEqual(['w1', 'w2']);
  });

  it('màn lớn HOẶC màn mật độ cao lấy lô siêu rộng — theo điểm ảnh thật', () => {
    expect(loChon(p, { rongNhat: true, diemAnh: 2560 })).toEqual(['s1', 's2']);
    // Laptop 1440 Retina: 2880 điểm ảnh — mờ y như màn 2560 nếu nhận lô rộng.
    expect(loChon(p, { rongNhat: true, diemAnh: 1440 * 2 })).toEqual(['s1', 's2']);
  });

  it('thiếu lô siêu rộng thì rơi về lô rộng, không về rỗng', () => {
    expect(loChon({ ...p, framesSuper: [] }, { rongNhat: true, diemAnh: 5000 })).toEqual(['w1', 'w2']);
  });
});
