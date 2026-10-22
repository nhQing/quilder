import { describe, expect, it } from 'vitest';

import type { Doc } from '@/lib/doc/types';
import { clipSpan, glideStart, revealCandidates, revealScroll } from './reveal';

/**
 * Phép "cuộn tới đâu" trên một trục.
 *
 * Khung 900px, đang cuộn ở 1000, trang dài tới 10.000 (max = 9.100), lề 24.
 * Toạ độ của node tính theo KHUNG NHÌN, như `getBoundingClientRect`.
 */
const VIEW = { size: 900, scroll: 1000, max: 9100 };

describe('revealScroll — node lọt khung', () => {
  it('đang thấy trọn vẹn thì KHÔNG cuộn — kể cả căn lại vài pixel cũng là giật', () => {
    expect(revealScroll({ start: 100, size: 200 }, VIEW, 24)).toBeNull();
    // Sát lề mà vẫn trong lề: vẫn là "đang thấy".
    expect(revealScroll({ start: 24, size: 852 }, VIEW, 24)).toBeNull();
  });

  it('nằm hẳn bên dưới thì đưa vào GIỮA khung', () => {
    // Node ở y=3000 trong khung → tài liệu y=4000; giữa node (4100) về giữa khung (450).
    expect(revealScroll({ start: 3000, size: 200 }, VIEW, 24)).toBe(4000 + 100 - 450);
  });

  it('nằm hẳn bên trên thì cũng vào giữa — chiều nào cũng cùng một phép', () => {
    expect(revealScroll({ start: -400, size: 100 }, VIEW, 24)).toBe(1000 - 400 + 50 - 450);
  });

  it('bị mép cắt một phần thì cũng cuộn: nửa cái nút không phải là "đang thấy"', () => {
    expect(revealScroll({ start: 850, size: 100 }, VIEW, 24)).not.toBeNull();
    // Lấn vào lề trên cũng vậy — nhãn id của khung chọn nằm đúng chỗ đó.
    expect(revealScroll({ start: 10, size: 100 }, VIEW, 24)).not.toBeNull();
  });
});

describe('revealScroll — node cao hơn khung', () => {
  it('đưa ĐỈNH lên cách mép một lề, không căn giữa', () => {
    // Căn giữa một section 3000px là để khung nằm gọn trong lòng nó: không viền, không nhãn.
    expect(revealScroll({ start: 2000, size: 3000 }, VIEW, 24)).toBe(1000 + 2000 - 24);
  });

  it('đang nhìn GIỮA lòng section (đỉnh đã trôi lên trên) thì vẫn kéo về đỉnh', () => {
    const deep = { ...VIEW, scroll: 5000 };
    expect(revealScroll({ start: -1500, size: 3000 }, deep, 24)).toBe(5000 - 1500 - 24);
  });

  it('đỉnh đã ở nửa trên khung thì để yên — phần còn lại đã lấp phần dưới', () => {
    expect(revealScroll({ start: 200, size: 3000 }, VIEW, 24)).toBeNull();
    expect(revealScroll({ start: 450, size: 3000 }, VIEW, 24)).toBeNull();
  });

  it('đỉnh nằm ở nửa DƯỚI khung thì cuộn — chỉ thấy một mẩu của nó', () => {
    expect(revealScroll({ start: 800, size: 3000 }, VIEW, 24)).toBe(1000 + 800 - 24);
  });
});

describe('revealScroll — biên', () => {
  it('kẹp vào [0, max]: node ở đầu trang không cuộn ra số âm', () => {
    expect(revealScroll({ start: -990, size: 50 }, VIEW, 24)).toBe(0);
  });

  it('kẹp vào max: node ở cuối trang dừng ở đáy, không vượt', () => {
    expect(revealScroll({ start: 8950, size: 50 }, VIEW, 24)).toBe(9100);
  });

  it('đã ở max mà node vẫn chưa vào giữa được thì KHÔNG cuộn (không có chỗ nào để đi)', () => {
    // Node ở đáy trang, nằm trong khung nhưng lấn lề dưới — đích bị kẹp đúng bằng vị trí hiện tại.
    expect(revealScroll({ start: 870, size: 20 }, { size: 900, scroll: 9100, max: 9100 }, 24)).toBeNull();
  });

  it('vùng không cuộn được (max ≤ 0) thì không bao giờ cuộn', () => {
    expect(revealScroll({ start: 3000, size: 100 }, { size: 900, scroll: 0, max: 0 }, 24)).toBeNull();
    expect(revealScroll({ start: 3000, size: 100 }, { size: 900, scroll: 0, max: -5 }, 24)).toBeNull();
  });

  it('khung thấp: lề bị kẹp về một phần tư khung, nên vẫn có chỗ "lọt"', () => {
    // Khung 60px, lề xin 24 → còn 15. Node 25px ở y=20 nằm trong [15, 45]: đang thấy.
    expect(revealScroll({ start: 20, size: 25 }, { size: 60, scroll: 0, max: 500 }, 24)).toBeNull();
  });

  it('số hỏng (khung chưa có kích thước, rect NaN) thì không cuộn thay vì cuộn tới NaN', () => {
    expect(revealScroll({ start: 100, size: 10 }, { size: 0, scroll: 0, max: 100 }, 24)).toBeNull();
    expect(revealScroll({ start: Number.NaN, size: 10 }, VIEW, 24)).toBeNull();
  });
});

describe('glideStart', () => {
  it('quãng ngắn hơn một màn thì lướt từ chỗ đang đứng', () => {
    expect(glideStart(1000, 1500, 900)).toBe(1000);
    expect(glideStart(1000, 1900, 900)).toBe(1000);
  });

  it('quãng dài đi XUỐNG thì nhảy tới một màn TRÊN đích — lướt nốt vẫn đi xuống', () => {
    expect(glideStart(0, 9746, 900)).toBe(9746 - 900);
  });

  it('quãng dài đi LÊN thì nhảy tới một màn DƯỚI đích — hướng không bị đảo', () => {
    expect(glideStart(9746, 500, 900)).toBe(500 + 900);
  });

  it('khung chưa có kích thước thì không nhảy gì cả', () => {
    expect(glideStart(0, 9746, 0)).toBe(0);
  });
});

describe('clipSpan', () => {
  it('cắt phần nằm ngoài khung ở cả hai đầu', () => {
    expect(clipSpan({ start: -100, size: 300 }, 900)).toEqual({ start: 0, size: 200 });
    expect(clipSpan({ start: 800, size: 300 }, 900)).toEqual({ start: 800, size: 100 });
  });

  it('nằm hẳn ngoài khung thì còn lại độ dài 0 — bên gọi biết là không có gì để cuộn tới', () => {
    expect(clipSpan({ start: 1200, size: 300 }, 900).size).toBe(0);
  });
});

describe('revealCandidates', () => {
  const doc = {
    rootId: 'root',
    nodes: {
      root: { id: 'root', parentId: null, children: ['sec'] },
      sec: { id: 'sec', parentId: 'root', children: ['btn'] },
      btn: { id: 'btn', parentId: 'sec', children: [] },
    },
  } as unknown as Doc;

  it('chính node trước, rồi tổ tiên gần nhất, lên tới gốc', () => {
    expect(revealCandidates(doc, 'btn')).toEqual(['btn', 'sec', 'root']);
  });

  it('node không có trong doc thì chỉ còn chính nó — không ném', () => {
    expect(revealCandidates(doc, 'ghost')).toEqual(['ghost']);
  });

  it('doc hỏng có vòng parentId thì vẫn dừng', () => {
    const loop = {
      rootId: 'a',
      nodes: {
        a: { id: 'a', parentId: 'b', children: [] },
        b: { id: 'b', parentId: 'a', children: [] },
      },
    } as unknown as Doc;
    expect(revealCandidates(loop, 'a')).toEqual(['a', 'b']);
  });
});
