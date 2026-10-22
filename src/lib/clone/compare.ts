/**
 * So hai bản đo (trang tham chiếu và bản nháp của builder) thành bảng lệch theo từng section.
 *
 * ## Vì sao là một hàm tự đủ
 *
 * Như `extractor.ts`: `kit.ts` đổi hàm này thành chuỗi và `mcp/server.mjs` chạy nó trên máy người
 * dùng (`compare_with_url`), nên luật so sánh sửa được bằng một lần deploy builder. Mọi helper
 * nằm TRONG thân hàm. Test gọi thẳng hàm này (không cần trình duyệt).
 *
 * ## Cách ghép hai bên
 *
 * Hai trang không cùng DOM (bản nháp đã gỡ phần tử ẩn, thay SVG bằng ảnh, tách nút…), nên ghép
 * theo NỘI DUNG chứ không theo vị trí: section ghép bằng độ giống của chữ bên trong, phần tử ghép
 * bằng chữ (với ảnh/video: theo loại + kích thước). Phần không ghép được được liệt kê riêng —
 * "thiếu ở bản nháp" thường là lỗi nặng hơn mọi con số lệch.
 *
 * Chỉ trả những dòng VƯỢT ngưỡng, sắp theo độ lệch tương đối giảm dần, để người đọc sửa đúng chỗ
 * rồi đo lại thay vì lội qua hàng trăm dòng khớp.
 */

export interface MeasuredItem {
  kind: string;
  tag: string;
  text: string;
  nodeId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number | null;
  fontWeight: number | null;
  lineHeight: number | null;
  letterSpacing: number | null;
  fontFamily: string | null;
  color: string | null;
  background: string | null;
}

export interface MeasuredSection {
  index: number;
  label: string;
  text: string;
  nodeId: string | null;
  top: number;
  height: number;
  width: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  background: string | null;
  items: MeasuredItem[];
}

export interface Measurement {
  viewport: number;
  docHeight: number;
  docWidth: number;
  sections: MeasuredSection[];
}

export interface CompareTolerance {
  /** Lệch vị trí/kích thước (px) tối thiểu để báo. */
  px: number;
  /** Lệch cỡ chữ (px). */
  font: number;
  /** Lệch line-height (px). */
  line: number;
  /** Lệch letter-spacing (px). */
  tracking: number;
  /** Lệch màu: tổng chênh |R|+|G|+|B|. */
  color: number;
}

export interface CompareRow {
  section: string;
  item: string;
  prop: string;
  reference: string;
  draft: string;
  delta: string;
  nodeId: string | null;
  /** Độ lệch tương đối, chỉ để sắp xếp. */
  weight: number;
}

export interface CompareResult {
  viewport: number;
  summary: {
    referenceSections: number;
    draftSections: number;
    matchedSections: number;
    rowsOverTolerance: number;
    rowsShown: number;
    /** Phần tử nằm ngoài khung ngang (băng chuyền, marquee) bị bỏ qua, cả hai bên cộng lại. */
    skippedOffscreen: number;
    pageHeight: { reference: number; draft: number; delta: number };
    pageWidth: { reference: number; draft: number; delta: number };
  };
  unmatched: { missingInDraft: string[]; extraInDraft: string[] };
  rows: CompareRow[];
  table: string;
}

export function compareMeasurements(
  reference: Measurement,
  draft: Measurement,
  options?: { tolerance?: Partial<CompareTolerance>; maxRows?: number },
): CompareResult {
  const tol: CompareTolerance = { px: 4, font: 0.6, line: 1.5, tracking: 0.3, color: 12, ...(options?.tolerance ?? {}) };
  const maxRows = options?.maxRows ?? 80;
  const rows: CompareRow[] = [];

  const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 1));
  const jaccard = (a: string, b: string) => {
    if (!a.trim() && !b.trim()) return 0;
    const wa = words(a);
    const wb = words(b);
    if (!wa.size || !wb.size) return 0;
    let inter = 0;
    for (const x of wa) if (wb.has(x)) inter += 1;
    return inter / (wa.size + wb.size - inter);
  };
  const ratioSim = (a: number, b: number) => {
    const m = Math.max(a, b);
    return m <= 0 ? 1 : 1 - Math.abs(a - b) / m;
  };
  const num = (n: number) => `${Math.round(n * 100) / 100}`;
  const px = (n: number) => `${num(n)}px`;
  const signed = (n: number, unit = 'px') => `${n > 0 ? '+' : ''}${num(n)}${unit}`;
  const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

  const rgbParts = (c: string | null): number[] | null => {
    if (!c) return null;
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    // `color(srgb 1 1 1 / 0.5)`: cùng một màu, trình duyệt serialize khác nhau tuỳ nguồn khai báo.
    const s = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c);
    return s ? [Number(s[1]) * 255, Number(s[2]) * 255, Number(s[3]) * 255] : null;
  };
  const colorDist = (a: string | null, b: string | null): number => {
    if (a === b) return 0;
    const pa = rgbParts(a);
    const pb = rgbParts(b);
    if (!pa || !pb) return pa || pb ? 999 : 0;
    return Math.abs(pa[0]! - pb[0]!) + Math.abs(pa[1]! - pb[1]!) + Math.abs(pa[2]! - pb[2]!);
  };

  /** Ghép tuần tự tối đa tổng độ giống (quy hoạch động kiểu LCS). `sim < thr` thì không ghép. */
  function align<T>(a: T[], b: T[], sim: (x: T, y: T) => number, thr: number): Array<[number, number]> {
    const n = a.length;
    const m = b.length;
    const score: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i += 1) {
      for (let j = 1; j <= m; j += 1) {
        const s = sim(a[i - 1] as T, b[j - 1] as T);
        const diag = s >= thr ? (score[i - 1]![j - 1] as number) + s : -1;
        score[i]![j] = Math.max(score[i - 1]![j] as number, score[i]![j - 1] as number, diag);
      }
    }
    const pairs: Array<[number, number]> = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      const s = sim(a[i - 1] as T, b[j - 1] as T);
      const cur = score[i]![j] as number;
      if (s >= thr && Math.abs(cur - ((score[i - 1]![j - 1] as number) + s)) < 1e-9) {
        pairs.push([i - 1, j - 1]);
        i -= 1;
        j -= 1;
      } else if (cur === (score[i - 1]![j] as number)) i -= 1;
      else j -= 1;
    }
    return pairs.reverse();
  }

  /**
   * Ghép phần tử trong một section: THAM LAM theo độ giống giảm dần, không bắt buộc cùng thứ tự.
   *
   * Section dùng ghép tuần tự (thứ tự khối trên trang là thứ có thật), nhưng phần tử thì không:
   * bản clone gộp `<li><span>nhãn</span><span>chữ</span></li>` thành một khối chữ có `strong` — thứ
   * tự DOM của hai dòng chữ đảo ngược, và ghép tuần tự sẽ báo THIẾU oan cho một trong hai.
   */
  function matchItems(a: MeasuredItem[], b: MeasuredItem[], thr: number): Array<[number, number]> {
    const cand: Array<{ i: number; j: number; s: number; near: number }> = [];
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < b.length; j += 1) {
        const sc = itemSim(a[i] as MeasuredItem, b[j] as MeasuredItem);
        if (sc >= thr) cand.push({ i, j, s: sc, near: Math.abs(i - j) });
      }
    }
    cand.sort((x, y) => y.s - x.s || x.near - y.near);
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    const out: Array<[number, number]> = [];
    for (const c of cand) {
      if (usedA.has(c.i) || usedB.has(c.j)) continue;
      usedA.add(c.i);
      usedB.add(c.j);
      out.push([c.i, c.j]);
    }
    return out.sort((x, y) => x[0] - y[0]);
  }

  const sectionSim = (a: MeasuredSection, b: MeasuredSection) => {
    const t = jaccard(a.text, b.text);
    if (t > 0) return t;
    // Section không chữ (dải ảnh, khoảng trắng): ghép theo hình dạng, nhưng yếu hơn chữ.
    if (!a.text.trim() && !b.text.trim()) return 0.2 + 0.3 * ratioSim(a.height, b.height);
    return 0;
  };

  const itemSim = (a: MeasuredItem, b: MeasuredItem) => {
    const aText = a.kind === 'text';
    const bText = b.kind === 'text';
    if (aText !== bText) return 0;
    if (aText) {
      if (a.text.trim().toLowerCase() === b.text.trim().toLowerCase()) return 1;
      return jaccard(a.text, b.text);
    }
    if (a.kind !== b.kind && !(a.kind !== 'text' && b.kind !== 'text')) return 0;
    return 0.3 + 0.5 * ratioSim(a.w, b.w) + 0.2 * ratioSim(a.h, b.h);
  };

  const refSections = reference.sections;
  const draftSections = draft.sections;
  const pairs = align(refSections, draftSections, sectionSim, 0.25);
  const matchedRef = new Set(pairs.map((p) => p[0]));
  const matchedDraft = new Set(pairs.map((p) => p[1]));

  const push = (
    section: string,
    item: string,
    prop: string,
    r: string,
    d: string,
    delta: string,
    nodeId: string | null,
    weight: number,
  ) => rows.push({ section, item, prop, reference: r, draft: d, delta, nodeId, weight });

  /**
   * Phần tử nằm NGOÀI khung ngang của section (băng chuyền đã cuộn, marquee, menu trượt ra ngoài)
   * không so được: vị trí của chúng do JS quyết định tại thời điểm đo, không phải do layout.
   */
  const inFrame = (it: MeasuredItem, width: number) => it.x + it.w > 0 && it.x < width;
  let skippedOffscreen = 0;

  for (const [ri, di] of pairs) {
    const rs0 = refSections[ri] as MeasuredSection;
    const ds0 = draftSections[di] as MeasuredSection;
    const rs = { ...rs0, items: rs0.items.filter((it) => inFrame(it, rs0.width)) };
    const ds = { ...ds0, items: ds0.items.filter((it) => inFrame(it, ds0.width)) };
    skippedOffscreen += rs0.items.length - rs.items.length + (ds0.items.length - ds.items.length);
    const sec = `#${ri + 1} ${rs.label}`;

    const sizeTol = Math.max(tol.px, rs.height * 0.015);
    if (Math.abs(rs.height - ds.height) > sizeTol) {
      push(sec, '(section)', 'height', px(rs.height), px(ds.height), signed(ds.height - rs.height), ds.nodeId,
        Math.abs(rs.height - ds.height) / Math.max(rs.height, 1));
    }
    if (Math.abs(rs.width - ds.width) > tol.px) {
      push(sec, '(section)', 'width', px(rs.width), px(ds.width), signed(ds.width - rs.width), ds.nodeId,
        Math.abs(rs.width - ds.width) / Math.max(rs.width, 1));
    }
    for (const [prop, a, b] of [
      ['padding-top', rs.paddingTop, ds.paddingTop],
      ['padding-bottom', rs.paddingBottom, ds.paddingBottom],
      ['padding-left', rs.paddingLeft, ds.paddingLeft],
    ] as const) {
      if (Math.abs(a - b) > tol.px) push(sec, '(section)', prop, px(a), px(b), signed(b - a), ds.nodeId, Math.abs(a - b) / Math.max(a, 8));
    }
    if (colorDist(rs.background, ds.background) > tol.color) {
      push(sec, '(section)', 'background', rs.background ?? 'trong suốt', ds.background ?? 'trong suốt', '≠', ds.nodeId, 0.5);
    }

    const ipairs = matchItems(rs.items, ds.items, 0.35);
    const missing = rs.items.filter((_, i) => !ipairs.some((p) => p[0] === i));
    for (const it of missing.slice(0, 6)) {
      push(sec, `${it.kind === 'text' ? it.tag : it.kind} "${trunc(it.text, 28)}"`, 'có ở tham chiếu', 'có', 'THIẾU', '—', null, 1);
    }

    let prev: [MeasuredItem, MeasuredItem] | null = null;
    ipairs.forEach(([a, b], k) => {
      const ri2 = rs.items[a] as MeasuredItem;
      const di2 = ds.items[b] as MeasuredItem;
      const name = `${ri2.kind === 'text' ? ri2.tag : ri2.kind} "${trunc(ri2.text, 28)}"`;
      const id = di2.nodeId;

      if (ri2.kind === 'text') {
        if (ri2.fontSize !== null && di2.fontSize !== null && Math.abs(ri2.fontSize - di2.fontSize) > tol.font) {
          push(sec, name, 'font-size', px(ri2.fontSize), px(di2.fontSize), signed(di2.fontSize - ri2.fontSize), id,
            Math.abs(ri2.fontSize - di2.fontSize) / ri2.fontSize + 0.1);
        }
        if (ri2.fontWeight !== di2.fontWeight && ri2.fontWeight !== null) {
          push(sec, name, 'font-weight', String(ri2.fontWeight), String(di2.fontWeight), '≠', id, 0.4);
        }
        if (ri2.lineHeight !== null && di2.lineHeight !== null && Math.abs(ri2.lineHeight - di2.lineHeight) > tol.line) {
          push(sec, name, 'line-height', px(ri2.lineHeight), px(di2.lineHeight), signed(di2.lineHeight - ri2.lineHeight), id,
            Math.abs(ri2.lineHeight - di2.lineHeight) / ri2.lineHeight);
        }
        if (ri2.letterSpacing !== null && di2.letterSpacing !== null && Math.abs(ri2.letterSpacing - di2.letterSpacing) > tol.tracking) {
          push(sec, name, 'letter-spacing', px(ri2.letterSpacing), px(di2.letterSpacing), signed(di2.letterSpacing - ri2.letterSpacing), id, 0.2);
        }
        if (ri2.fontFamily && di2.fontFamily && ri2.fontFamily.toLowerCase() !== di2.fontFamily.toLowerCase()) {
          push(sec, name, 'font-family', ri2.fontFamily, di2.fontFamily, '≠', id, 0.6);
        }
        if (colorDist(ri2.color, di2.color) > tol.color) {
          push(sec, name, 'color', ri2.color ?? '', di2.color ?? '', '≠', id, 0.5);
        }
        // Chiều cao chữ chỉ đáng nói khi đúng là SỐ DÒNG khác (xuống dòng khác chỗ), không phải do font/line-height.
        const lh = ri2.lineHeight ?? ri2.fontSize ?? 16;
        if (Math.abs(ri2.h - di2.h) > lh * 0.6 && !(ri2.lineHeight !== null && di2.lineHeight !== null && Math.abs(ri2.lineHeight - di2.lineHeight) > tol.line)) {
          push(sec, name, 'số dòng / chiều cao', px(ri2.h), px(di2.h), signed(di2.h - ri2.h), id, Math.abs(ri2.h - di2.h) / Math.max(ri2.h, 1));
        }
      } else {
        if (Math.abs(ri2.w - di2.w) > Math.max(tol.px, ri2.w * 0.02)) {
          push(sec, name, 'width', px(ri2.w), px(di2.w), signed(di2.w - ri2.w), id, Math.abs(ri2.w - di2.w) / Math.max(ri2.w, 1));
        }
        if (Math.abs(ri2.h - di2.h) > Math.max(tol.px, ri2.h * 0.02)) {
          push(sec, name, 'height', px(ri2.h), px(di2.h), signed(di2.h - ri2.h), id, Math.abs(ri2.h - di2.h) / Math.max(ri2.h, 1));
        }
      }

      if (Math.abs(ri2.x - di2.x) > tol.px * 1.5) {
        push(sec, name, 'x (lệch ngang)', px(ri2.x), px(di2.x), signed(di2.x - ri2.x), id, Math.abs(ri2.x - di2.x) / Math.max(rs.width, 1) + 0.05);
      }
      if (k === 0) {
        if (Math.abs(ri2.y - di2.y) > tol.px * 1.5) {
          push(sec, name, 'y (cách mép trên section)', px(ri2.y), px(di2.y), signed(di2.y - ri2.y), id, Math.abs(ri2.y - di2.y) / Math.max(rs.height, 1) + 0.05);
        }
      } else if (prev) {
        const gapRef = ri2.y - (prev[0].y + prev[0].h);
        const gapDraft = di2.y - (prev[1].y + prev[1].h);
        // Chỉ xét khe giữa hai phần tử xếp DỌC (cái sau nằm dưới cái trước).
        if (gapRef > -2 && gapDraft > -2 && Math.abs(gapRef - gapDraft) > tol.px * 1.5) {
          push(sec, name, 'khe với phần tử trước', px(gapRef), px(gapDraft), signed(gapDraft - gapRef), id,
            Math.abs(gapRef - gapDraft) / Math.max(Math.abs(gapRef), 24));
        }
      }
      prev = [ri2, di2];
    });
  }

  rows.sort((a, b) => b.weight - a.weight);
  const shown = rows.slice(0, maxRows);

  const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ');
  const table = [
    '| Section | Phần tử | Thuộc tính | Tham chiếu | Bản nháp | Lệch | nodeId |',
    '|---|---|---|---|---|---|---|',
    ...shown.map(
      (r) =>
        `| ${cell(r.section)} | ${cell(r.item)} | ${cell(r.prop)} | ${cell(r.reference)} | ${cell(r.draft)} | ${cell(r.delta)} | ${r.nodeId ?? ''} |`,
    ),
  ].join('\n');

  return {
    viewport: reference.viewport,
    summary: {
      referenceSections: refSections.length,
      draftSections: draftSections.length,
      matchedSections: pairs.length,
      rowsOverTolerance: rows.length,
      rowsShown: shown.length,
      skippedOffscreen,
      pageHeight: { reference: reference.docHeight, draft: draft.docHeight, delta: draft.docHeight - reference.docHeight },
      pageWidth: { reference: reference.docWidth, draft: draft.docWidth, delta: draft.docWidth - reference.docWidth },
    },
    unmatched: {
      missingInDraft: refSections.filter((_, i) => !matchedRef.has(i)).map((s) => `#${s.index + 1} ${s.label} — "${trunc(s.text, 50)}"`),
      extraInDraft: draftSections.filter((_, i) => !matchedDraft.has(i)).map((s) => `#${s.index + 1} ${s.label} — "${trunc(s.text, 50)}"`),
    },
    rows: shown,
    table,
  };
}
