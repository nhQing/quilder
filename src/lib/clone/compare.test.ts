import { describe, expect, it } from 'vitest';

import { compareMeasurements, type MeasuredItem, type MeasuredSection, type Measurement } from './compare';
import { compareSource } from './kit';

const item = (over: Partial<MeasuredItem> = {}): MeasuredItem => ({
  kind: 'text',
  tag: 'h1',
  text: 'Tiết kiệm thông minh',
  nodeId: 'n1',
  x: 24,
  y: 80,
  w: 400,
  h: 58,
  fontSize: 48,
  fontWeight: 700,
  lineHeight: 58,
  letterSpacing: 0,
  fontFamily: 'Inter',
  color: 'rgb(255, 255, 255)',
  background: null,
  ...over,
});

const section = (over: Partial<MeasuredSection> = {}): MeasuredSection => ({
  index: 0,
  label: 'section.hero',
  text: 'Tiết kiệm thông minh Mô tả ngắn',
  nodeId: 'n0',
  top: 0,
  height: 500,
  width: 1440,
  paddingTop: 80,
  paddingBottom: 80,
  paddingLeft: 24,
  background: 'rgb(17, 34, 51)',
  items: [item()],
  ...over,
});

const m = (sections: MeasuredSection[], over: Partial<Measurement> = {}): Measurement => ({
  viewport: 1440,
  docHeight: 1000,
  docWidth: 1440,
  sections,
  ...over,
});

describe('compareMeasurements', () => {
  it('hai bên giống nhau thì không có dòng nào', () => {
    const r = compareMeasurements(m([section()]), m([section()]));
    expect(r.rows).toEqual([]);
    expect(r.summary.matchedSections).toBe(1);
  });

  it('chỉ báo dòng VƯỢT ngưỡng, và chỉ rõ nodeId của bản nháp', () => {
    const ref = m([section()]);
    const draft = m([
      section({
        height: 540, // lệch 40px
        paddingTop: 82, // trong ngưỡng 4px
        items: [item({ nodeId: 'n99', fontSize: 40, fontWeight: 400, lineHeight: 48, color: 'rgb(0, 0, 0)' })],
      }),
    ]);
    const r = compareMeasurements(ref, draft);
    const props = r.rows.map((x) => x.prop);
    expect(props).toEqual(expect.arrayContaining(['height', 'font-size', 'font-weight', 'line-height', 'color']));
    expect(props).not.toContain('padding-top');
    const fs = r.rows.find((x) => x.prop === 'font-size');
    expect(fs).toMatchObject({ reference: '48px', draft: '40px', delta: '-8px', nodeId: 'n99' });
    expect(r.table).toContain('| font-size |');
  });

  it('phần tử có ở tham chiếu mà bản nháp không có thì báo THIẾU', () => {
    const ref = m([section({ items: [item(), item({ tag: 'p', text: 'Mô tả ngắn', y: 150, nodeId: 'n2' })] })]);
    const draft = m([section({ items: [item()] })]);
    const r = compareMeasurements(ref, draft);
    expect(r.rows.some((x) => x.draft === 'THIẾU' && x.item.includes('Mô tả ngắn'))).toBe(true);
  });

  it('section không ghép được được liệt kê riêng, không bị nuốt', () => {
    const ref = m([section(), section({ index: 1, label: 'footer', text: 'Bản quyền thuộc về công ty', items: [] })]);
    const draft = m([section()]);
    const r = compareMeasurements(ref, draft);
    expect(r.unmatched.missingInDraft).toHaveLength(1);
    expect(r.unmatched.missingInDraft[0]).toContain('footer');
  });

  it('báo trang tràn ngang qua docWidth', () => {
    const r = compareMeasurements(m([section()]), m([section()], { docWidth: 1700 }));
    expect(r.summary.pageWidth.delta).toBe(260);
  });

  it('sắp theo độ lệch tương đối giảm dần và cắt ở maxRows', () => {
    const ref = m([section({ items: [item()] })]);
    const draft = m([section({ height: 900, items: [item({ fontSize: 47, x: 60 })] })]);
    const r = compareMeasurements(ref, draft, { maxRows: 1 });
    expect(r.rows).toHaveLength(1);
    expect(r.summary.rowsOverTolerance).toBeGreaterThan(1);
    expect(r.rows[0]?.prop).toBe('height');
  });

  it('ngưỡng chỉnh được', () => {
    const ref = m([section()]);
    const draft = m([section({ items: [item({ fontSize: 47 })] })]);
    expect(compareMeasurements(ref, draft).rows.some((x) => x.prop === 'font-size')).toBe(true);
    expect(compareMeasurements(ref, draft, { tolerance: { font: 2 } }).rows.some((x) => x.prop === 'font-size')).toBe(false);
  });
});

describe('mã so sánh gửi qua kit', () => {
  it('chuỗi được nạp bằng eval gián tiếp (cách server.mjs làm) vẫn chạy đúng', () => {
    const fn = (0, eval)(compareSource()) as typeof compareMeasurements;
    const r = fn(m([section()]), m([section({ height: 600 })]));
    expect(r.rows.some((x) => x.prop === 'height')).toBe(true);
  });
});
