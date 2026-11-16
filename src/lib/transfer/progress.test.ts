import { describe, expect, it } from 'vitest';

import { etaMs, FILE_OVERHEAD, formatEta, fractionDone, percentLabel, splitNdjson } from './progress';

describe('fractionDone', () => {
  it('không có việc → xong', () => {
    expect(fractionDone({ files: 0, bytes: 0 }, { files: 0, bytes: 0 })).toBe(1);
  });
  it('tính cả phí mỗi file: 400 icon nhỏ vẫn chạy đều theo số file', () => {
    const total = { files: 400, bytes: 400 * 2048 };
    expect(fractionDone({ files: 200, bytes: 200 * 2048 }, total)).toBeCloseTo(0.5, 5);
  });
  it('một video lớn chiếm phần lớn thanh', () => {
    const total = { files: 2, bytes: 9_000_000 + 2048 };
    const afterIcon = fractionDone({ files: 1, bytes: 2048 }, total);
    expect(afterIcon).toBeLessThan(0.05);
    expect(afterIcon).toBeCloseTo((2048 + FILE_OVERHEAD) / (total.bytes + 2 * FILE_OVERHEAD), 5);
  });
  it('kẹp trong 0..1 khi số đếm vượt tổng', () => {
    expect(fractionDone({ files: 9, bytes: 9e9 }, { files: 1, bytes: 10 })).toBe(1);
  });
});

describe('percentLabel', () => {
  it('chưa xong thật thì tối đa 99%', () => {
    expect(percentLabel(1)).toBe(99);
    expect(percentLabel(1, true)).toBe(100);
    expect(percentLabel(0.456)).toBe(45);
  });
});

describe('etaMs', () => {
  it('chưa đủ thời gian hoặc chưa đủ tiến độ → null', () => {
    expect(etaMs(0.5, 500)).toBeNull();
    expect(etaMs(0.01, 10_000)).toBeNull();
  });
  it('ngoại suy tuyến tính', () => {
    expect(etaMs(0.25, 2000)).toBe(6000);
    expect(etaMs(1, 2000)).toBe(0);
  });
});

describe('formatEta', () => {
  it('đọc được bằng tiếng Việt', () => {
    expect(formatEta(null)).toBe('đang ước tính thời gian…');
    expect(formatEta(2000)).toBe('sắp xong');
    expect(formatEta(12_000)).toBe('còn khoảng 15 giây');
    expect(formatEta(150_000)).toBe('còn khoảng 3 phút');
    expect(formatEta(3_900_000)).toBe('còn khoảng 1 giờ 5 phút');
  });
});

describe('splitNdjson', () => {
  it('giữ phần dở dang cho chunk sau', () => {
    expect(splitNdjson('{"a":1}\n{"b":')).toEqual({ lines: ['{"a":1}'], rest: '{"b":' });
    expect(splitNdjson('{"a":1}\n\n')).toEqual({ lines: ['{"a":1}'], rest: '' });
  });
});
