/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Bộ trích cây node từ một trang web BẤT KỲ — chạy TRONG TRÌNH DUYỆT của máy chạy MCP.
 *
 * ## Vì sao là một hàm tự đủ, không import gì
 *
 * `installCloneKit` được `kit.ts` đổi thành chuỗi (`Function.prototype.toString`) rồi phục vụ qua
 * `GET /api/ai/clone-kit`; `mcp/server.mjs` bơm chuỗi đó vào trang nguồn bằng Playwright. Nên mọi
 * thứ nó dùng phải NẰM TRONG thân hàm: không import, không hằng module, không helper của bundler
 * (`kit.ts` kiểm lại bằng một trình duyệt thật trong test). Sửa converter chỉ cần deploy builder,
 * không ai phải tải lại `server.mjs`.
 *
 * ## Khác `scripts/migrate/html-to-doc.ts` ở đâu
 *
 * Cùng bộ não (đo computed style, tra ngược token, diff theo khổ ra override breakpoint), nhưng:
 *  - trang nguồn là trang THẬT, JS bật, đã cuộn qua để lazy-load/hiệu ứng vào chạy xong;
 *  - bảng token là của BUILDER, đo trên một trang trắng ở đúng bề rộng khổ đo (`tokenTables`) —
 *    trang nguồn không có token của builder nên không thể "đọc :root của nó";
 *  - id node gắn vào element (WeakMap) nên giữ ổn định giữa các khổ dù JS dựng lại một phần DOM;
 *  - phần tử ẩn ở mọi khổ bị gỡ, phần tử rỗng 0×0 ở mọi khổ bị gỡ (site hay nhân đôi menu mobile/desktop);
 *  - Typed OM cho cả bề rộng/chiều cao/khoảng cách, nên `%`, `auto`, `calc()` không bị nướng thành px;
 *  - grid track đọc từ CSSOM (khai báo `repeat(3, 1fr)`), không từ giá trị đã resolve;
 *  - gradient tuyến tính → `fill.gradient`, ảnh nền → `_bgSrc`, SVG nội dòng → file SVG;
 *  - link: cùng site → đường dẫn tương đối, khác site → URL tuyệt đối.
 *
 * Thứ KHÔNG biết làm được liệt kê qua `notes` (server đổi thành báo cáo) — không bao giờ im lặng.
 *
 * Giá trị trả ra là cây "thô": còn khoá giàn giáo `_src`, `_bgSrc`, `_posterSrc`, `_vis`, `_area`.
 * `assemble.ts` ở server gỡ chúng và ép cây về đúng `zDoc`.
 */

type A = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function installCloneKit(w: A): void {
  const doc: A = w.document;
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const isTransparent = (v: string) =>
    /^rgba\(.*,\s*0\)$/.test(norm(v)) || /^color\(.*\/\s*0\)$/.test(norm(v)) || norm(v) === 'transparent';

  /** Trạng thái sống qua các lần `extract` (cùng một trang, nhiều khổ). */
  const state: A = { ids: new WeakMap(), counter: 0, pathIds: new Map() };

  /* ── Tiện ích chuỗi CSS ───────────────────────────────────────────── */

  /** Tách theo `sep` ở độ sâu ngoặc 0. `sep = ' '` tách theo mọi khoảng trắng. */
  function splitTop(s: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      const isSep = sep === ' ' ? /\s/.test(ch) : ch === sep;
      if (depth === 0 && isSep) {
        if (cur.trim() || sep !== ' ') out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim() || sep !== ' ') out.push(cur.trim());
    return out;
  }

  /** Biểu thức độ dài CSS → `Len` của doc (`calc/min/max/clamp` lồng nhau), hoặc null. */
  function parseLenExpr(raw: string): A {
    const s = raw.trim();
    const fn = /^(calc|min|max|clamp)\((.*)\)$/s.exec(s);
    if (fn) {
      const inner = fn[2] as string;
      if (fn[1] === 'calc') return parseCalc(inner);
      const parts = splitTop(inner, ',').map(parseLenExpr);
      if (!parts.length || parts.some((p) => p === null)) return null;
      if (fn[1] === 'min') return { min: parts };
      if (fn[1] === 'max') return { max: parts };
      return parts.length === 3 ? { clamp: parts } : null;
    }
    if (/^\(.*\)$/s.test(s)) return parseCalc(s.slice(1, -1));
    const u = /^(-?[\d.]+(?:e-?\d+)?)(px|rem|%|vw|svh|ch)?$/.exec(s);
    if (!u) return null;
    if (!u[2]) return Number(u[1]) === 0 ? { v: 0, u: 'px' } : null;
    return { v: r3(Number(u[1])), u: u[2] };
  }

  function parseCalc(inner: string): A {
    const toks = splitTop(inner, ' ');
    if (toks.length < 3 || toks.length % 2 === 0) return null;
    const operand = (t: string): A => parseLenExpr(t) ?? (/^-?[\d.]+$/.test(t) ? Number(t) : null);
    let acc: A = operand(toks[0] as string);
    for (let i = 1; i < toks.length; i += 2) {
      const op = ({ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' } as A)[toks[i] as string];
      const b = operand(toks[i + 1] as string);
      if (!op || acc === null || b === null) return null;
      // `a` luôn là độ dài; `b` là số chỉ cho mul/div. Phép nhân có số ở bên trái thì đảo lại.
      if (typeof acc === 'number') {
        if (op !== 'mul' || typeof b === 'number') return null;
        acc = { calc: { op: 'mul', a: b, b: acc } };
        continue;
      }
      if (typeof b === 'number' && op !== 'mul' && op !== 'div') return null;
      acc = { calc: { op, a: acc, b } };
    }
    return typeof acc === 'number' ? null : acc;
  }

  /* ── Ghi chú cho báo cáo ──────────────────────────────────────────── */

  function makeNotes() {
    const notes: A = {};
    const note = (code: string, sample?: string, add = 1) => {
      const n = (notes[code] ??= { count: 0, samples: [] });
      n.count += add;
      if (sample && n.samples.length < 8 && !n.samples.includes(sample)) n.samples.push(sample);
    };
    return { notes, note };
  }

  /* ═══ 1. Bảng token của builder, đo trên một trang TRẮNG ═══════════════ */

  /**
   * Gọi trên `about:blank` ở ĐÚNG bề rộng khổ đo: token fluid (`clamp()` theo vw) resolve ra số px
   * khác nhau ở mỗi bề rộng, nên bảng chỉ có nghĩa ở khổ nó được đo.
   *
   * Một giá trị chỉ khớp ngược khi bằng CHÍNH XÁC giá trị token — không bao giờ khớp "gần nhất".
   */
  function tokenTables(opts: { tokensCss: string; tokenNames: string[]; categories?: Record<string, string> }): A {
    const style = doc.createElement('style');
    style.textContent = opts.tokensCss;
    doc.head.appendChild(style);
    const probe = doc.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden';
    doc.body.appendChild(probe);
    const root = w.getComputedStyle(doc.documentElement);

    const colors: A = {};
    const families: A = {};
    const lengths: A = {};
    const zs: A = {};
    const firstFamily = (v: string) =>
      (v.split(',')[0] as string).trim().replace(/^["']|["']$/g, '').toLowerCase();
    const categories = opts.categories ?? {};
    // Vai của token theo TÊN và LOẠI trong bảng Token. Một giá trị chỉ khớp token cùng vai với
    // property nó đang ghi: cỡ chữ 14px không được trỏ vào `--radius-s` hay một token khoảng cách.
    const roleOf = (name: string) => {
      const cat = categories[name];
      if (/radius|pill/.test(name)) return 'radius';
      if (/tracking|letter-spacing/.test(name)) return 'tracking';
      if (cat === 'typeScale' || /^step|font-size|(^|-)t-[a-z0-9]|(^|-)fs-/.test(name)) return 'font';
      if (cat === 'space' || /gutter|section-y|space|gap|pad|inset/.test(name)) return 'space';
      return 'generic';
    };
    // Token hệ thống thắng token `--mm-*` đặt riêng cho từng section khi cùng giá trị.
    const prefer = (map: A, key: string, name: string) => {
      if (!key) return;
      const prev = map[key];
      if (!prev || (prev.startsWith('mm-') && !name.startsWith('mm-'))) map[key] = name;
    };

    for (const name of opts.tokenNames) {
      // Token `mm-*` là token đặt riêng cho từng section của site Figma gốc (`--mm-nav-icon`,
      // `--mm-s6-card-inner-gap`…): trùng giá trị với một phép đo là ngẫu nhiên, và trỏ cỡ chữ của
      // một trang khác vào đó nghĩa là đổi một token nav thì chữ chân trang đổi theo.
      if (name.startsWith('mm-') || categories[name] === 'figma') continue;
      const raw = norm(root.getPropertyValue(`--${name}`));
      if (!raw) continue;

      probe.style.color = '';
      probe.style.color = `var(--${name})`;
      if (/^(#|rgb|hsl|color-mix)/.test(raw)) prefer(colors, norm(w.getComputedStyle(probe).color), name);

      if (/font/.test(name) && raw.includes(',')) prefer(families, firstFamily(raw), name);

      probe.style.width = '';
      probe.style.width = `var(--${name})`;
      const asLen = norm(w.getComputedStyle(probe).width);
      // `CSS.supports` biết token nào dùng được làm bề rộng — `--weight-regular: 400` thì không.
      const usable = w.CSS.supports('width', raw);
      const vertical = /[\d.](vh|[sld]vh)\b/.test(raw);
      const isZ = /^z-/.test(name);
      if (usable && !vertical && !isZ && /^-?[\d.]+px$/.test(asLen)) {
        prefer(lengths, `${roleOf(name)}|${asLen}`, name);
      }
      if (isZ && /^-?\d+$/.test(raw)) prefer(zs, raw, name);
    }

    style.remove();
    probe.remove();
    return { colors, families, lengths, zs };
  }

  /* ═══ 2. Trích một khổ ═══════════════════════════════════════════════ */

  function extract(opts: { tables: A; layer: string; maxNodes?: number }): A {
    const t = opts.tables;
    const MAX_NODES = opts.maxNodes ?? 2500;
    const { notes, note } = makeNotes();
    const stats: A = { elements: 0, nodes: 0, tokenValues: 0, literalValues: 0 };
    const nodes: A = {};
    const svgs: A = {};
    const origin = w.location.origin;
    const vw = w.innerWidth;
    const vh = w.innerHeight;
    const gcs = (el: A, pseudo?: string) => w.getComputedStyle(el, pseudo);

    /* ── id ổn định, htmlId, URL ─────────────────────────────────── */

    /** id đã được phần tử nào đó nhận TRONG lần `extract` này — hai phần tử không được chung id. */
    const claimed = new Set<string>();

    /**
     * id ổn định giữa các khổ. Một phần tử giữ id của nó (WeakMap). Phần tử MỚI mà vị trí cấu trúc
     * (id cha + thẻ + chỉ số trong cha) trùng với một id cũ chưa ai nhận thì NHẬN LẠI id đó: nhiều
     * widget (carousel vô hạn, SplitText) dựng lại DOM mỗi lần đổi khổ — nếu tính là phần tử mới
     * thì cả nhánh biến mất khỏi lớp `base` ("pass-mismatch") dù cấu trúc y hệt.
     */
    const idOf = (el: A, parentId: string | null, index: number): string => {
      let id = state.ids.get(el);
      if (!id) {
        const key = `${parentId}|${el.tagName}|${index}`;
        const prior = state.pathIds.get(key);
        if (prior && !claimed.has(prior)) id = prior;
        else {
          id = `n${String(++state.counter).padStart(7, '0')}`;
          state.pathIds.set(key, id);
        }
        state.ids.set(el, id);
      }
      claimed.add(id);
      return id;
    };

    const slugId = (raw: string) =>
      raw
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    function hrefOf(raw: string | null): string {
      if (!raw || !raw.trim()) return '#';
      const v = raw.trim();
      if (/^\s*(javascript|data|vbscript):/i.test(v)) {
        note('js-link', v.slice(0, 60));
        return '#';
      }
      if (v.startsWith('#')) {
        const s = slugId(v.slice(1));
        return s ? `#${s}` : '#';
      }
      if (/^(mailto|tel):/i.test(v)) return v.slice(0, 2000);
      let u: A;
      try {
        u = new URL(v, doc.baseURI);
      } catch {
        return '#';
      }
      if (u.origin === origin) {
        const hash = u.hash ? `#${slugId(u.hash.slice(1))}` : '';
        const path = `${u.pathname}${u.search}${hash === '#' ? '' : hash}`;
        if (u.pathname !== w.location.pathname) note('internal-link', u.pathname);
        return path.slice(0, 2000);
      }
      return u.href.slice(0, 2000);
    }

    function absUrl(raw: string | null | undefined): string | null {
      if (!raw || !raw.trim()) return null;
      const v = raw.trim();
      if (/^(data:|blob:)/i.test(v)) return v;
      try {
        const u = new URL(v, doc.baseURI);
        return /^https?:$/.test(u.protocol) ? u.href : null;
      } catch {
        return null;
      }
    }

    /* ── màu, độ dài, token ──────────────────────────────────────── */

    type LenProp = 'radius' | 'space' | 'font' | 'tracking' | 'other';
    const lenTokenOf = (v: string, prop: LenProp): string | null => {
      const at = (role: string) => t.lengths[`${role}|${norm(v)}`] ?? null;
      if (prop === 'radius') return at('radius');
      if (prop === 'space') return at('space');
      if (prop === 'font') return at('font');
      if (prop === 'tracking') return at('tracking');
      return at('generic');
    };

    function len(v: string, prop: LenProp = 'other'): A {
      const s = v.trim();
      if (/^-?0(\.0+)?(px|rem|%|vw|ch)?$/.test(s)) return { v: 0, u: 'px' };
      const tk = lenTokenOf(s, prop);
      if (tk) {
        stats.tokenValues += 1;
        return { $token: tk };
      }
      const m = /^(-?[\d.]+(?:e-?\d+)?)(px|rem|%|vw|ch)$/.exec(s);
      if (m) {
        stats.literalValues += 1;
        return { v: r3(Number(m[1])), u: m[2] };
      }
      return null;
    }

    function col(v: string): A {
      const s = norm(v);
      const tk = t.colors[s];
      if (tk) {
        stats.tokenValues += 1;
        return { $token: tk };
      }
      let r: A;
      let g: A;
      let b: A;
      let a: A = 1;
      let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
      if (m) {
        [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (m[4] !== undefined) a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
      } else if ((m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s))) {
        [r, g, b] = [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
        if (m[4] !== undefined) a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
      } else {
        note('color-unparsed', s.slice(0, 50));
        return null;
      }
      stats.literalValues += 1;
      const hex = `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
      return a >= 1 ? { hex } : { hex, alpha: r3(Math.max(0, a)) };
    }

    /* ── Typed OM: giá trị COMPUTED (còn `%`, `auto`, `calc`) ────── */

    const typedMap = (el: A) => el.computedStyleMap();

    function typedLen(typed: A, el: A, prop: string, role: LenProp = 'other'): A {
      let v: A;
      try {
        v = typed.get(prop);
      } catch {
        v = null;
      }
      const used = () => len(gcs(el).getPropertyValue(prop), role);
      if (!v) return used();
      const name = v.constructor.name;
      if (name === 'CSSKeywordValue') return null;
      if (name === 'CSSUnitValue') {
        if (v.unit === 'percent') return { v: r3(v.value), u: '%' };
        if (v.unit === 'px') return len(`${r3(v.value)}px`, role);
        if (v.unit === 'number' && v.value === 0) return null;
        return used();
      }
      return parseLenExpr(String(v)) ?? used();
    }

    const isAuto = (typed: A, prop: string): boolean => {
      try {
        const v = typed.get(prop);
        return Boolean(v) && v.constructor.name === 'CSSKeywordValue' && String(v) === 'auto';
      } catch {
        return false;
      }
    };

    /* ── CSSOM: chỉ cho thứ computed KHÔNG giữ được ─────────────── */

    // Grid track (computed trả danh sách px đã resolve), transform (computed trả ma trận), và
    // chiều cao theo viewport (computed trả px của lần đo). Cố ý KHÔNG theo dõi width/height thường:
    // Typed OM đã trả `auto`/`%` đúng.
    const TRACKED = [
      'grid-template-columns', 'grid-template-rows', 'transform',
      'height', 'min-height', 'block-size', 'min-block-size',
    ];
    const declRules: A[] = [];
    let unreadableSheets = 0;
    const collect = (list: A, mediaOk: boolean) => {
      for (const rule of Array.from(list) as A[]) {
        if (rule.type === CSSRule.IMPORT_RULE) {
          let sub: A = null;
          try {
            sub = rule.styleSheet ? rule.styleSheet.cssRules : null;
          } catch {
            sub = null;
          }
          const mq = rule.media ? rule.media.mediaText : '';
          if (sub) collect(sub, mediaOk && (!mq || w.matchMedia(mq).matches));
          continue;
        }
        if (rule.type === CSSRule.MEDIA_RULE) {
          collect(rule.cssRules, mediaOk && w.matchMedia(rule.conditionText).matches);
        } else if (rule.cssRules) {
          collect(rule.cssRules, mediaOk);
        }
        if (rule.type !== CSSRule.STYLE_RULE || !mediaOk) continue;
        for (const prop of TRACKED) {
          const v = rule.style.getPropertyValue(prop);
          if (v) declRules.push({ sel: rule.selectorText, prop, value: v.trim() });
        }
      }
    };
    for (const sheet of Array.from(doc.styleSheets) as A[]) {
      try {
        collect(sheet.cssRules, !sheet.media?.mediaText || w.matchMedia(sheet.media.mediaText).matches);
      } catch {
        unreadableSheets += 1;
      }
    }
    if (unreadableSheets) note('css-unreadable', undefined, unreadableSheets);

    /** Giá trị khai cuối cùng khớp element — theo thứ tự nguồn (bỏ qua độ đặc hiệu: đủ cho mục đích này). */
    function declaredOf(el: A, prop: string): string | null {
      let last: string | null = null;
      for (const r of declRules) {
        if (r.prop !== prop) continue;
        try {
          if (el.matches(r.sel)) last = r.value;
        } catch {
          /* selector lạ */
        }
      }
      const inline = el.style?.getPropertyValue(prop);
      return inline ? inline.trim() : last;
    }

    /* ── Grid track ──────────────────────────────────────────────── */

    function trackOf(tok: string): A {
      const s = tok.trim();
      if (s === 'auto') return { kind: 'auto' };
      let m = /^(-?[\d.]+)(fr|px|rem)$/.exec(s);
      if (m) return { kind: m[2], v: Number(m[1]) };
      m = /^minmax\((.*)\)$/s.exec(s);
      if (m) {
        const [a, b] = splitTop(m[1] as string, ',');
        const min = a ? parseLenExpr(a) : null;
        const max = b ? parseLenExpr(b) : null;
        const mf = b ? /^(-?[\d.]+)fr$/.exec(b) : null;
        const maxLen = mf ? { v: Number(mf[1]), u: 'fr' } : max;
        if (min && maxLen) return { kind: 'minmax', min, max: maxLen };
      }
      return null;
    }

    /** `repeat(3, 1fr) 200px` → danh sách track. null khi có `auto-fit`, `subgrid`, `[tên]`… */
    function parseTracks(decl: string): A[] | null {
      const out: A[] = [];
      for (const tok of splitTop(decl, ' ')) {
        const rep = /^repeat\(\s*(\d+)\s*,\s*(.*)\)$/s.exec(tok);
        if (rep) {
          const inner = splitTop(rep[2] as string, ' ').map(trackOf);
          if (inner.some((x) => x === null)) return null;
          for (let i = 0; i < Number(rep[1]); i += 1) out.push(...inner);
          continue;
        }
        const one = trackOf(tok);
        if (!one) return null;
        out.push(one);
      }
      return out.length ? out : null;
    }

    /** Dự phòng khi không đọc được khai báo: track đã resolve → `fr` đều nhau hoặc px. */
    function resolvedTracks(cssValue: string): A[] | null {
      const parts = cssValue.trim().split(/\s+/).filter((p) => /^-?[\d.]+px$/.test(p));
      if (!parts.length || cssValue.includes('[')) return null;
      const px = parts.map((p) => Number(p.replace('px', '')));
      const equal = px.every((n) => Math.abs(n - (px[0] as number)) < 1);
      return equal ? px.map(() => ({ kind: 'fr', v: 1 })) : px.map((n) => ({ kind: 'px', v: r3(n) }));
    }

    /* ── gradient ────────────────────────────────────────────────── */

    function parseLinearGradient(value: string): A {
      const m = /^linear-gradient\((.*)\)$/s.exec(value.trim());
      if (!m) return null;
      const parts = splitTop(m[1] as string, ',');
      let angle = 180;
      const first = parts[0] as string;
      if (/^to\s/.test(first)) {
        const dir = first.replace(/^to\s+/, '').split(/\s+/).sort().join(' ');
        const map: A = {
          top: 0, right: 90, bottom: 180, left: 270,
          'right top': 45, 'bottom right': 135, 'bottom left': 225, 'left top': 315,
        };
        if (!(dir in map)) return null;
        angle = map[dir];
        parts.shift();
      } else if (/^-?[\d.]+(deg|turn|rad|grad)$/.test(first)) {
        const n = parseFloat(first);
        angle = first.endsWith('turn') ? n * 360 : first.endsWith('rad') ? (n * 180) / Math.PI : first.endsWith('grad') ? n * 0.9 : n;
        parts.shift();
      }
      const stops: A[] = [];
      for (const p of parts) {
        const c = /^(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]+|[a-z]+)\s*(.*)$/i.exec(p);
        if (!c) return null;
        const color = col(c[1] as string);
        if (!color) return null;
        const pos = (c[2] as string).trim() ? (c[2] as string).trim().split(/\s+/) : [];
        if (pos.some((x) => !/^-?[\d.]+%$/.test(x))) return null;
        if (!pos.length) stops.push({ at: null, color });
        for (const x of pos) stops.push({ at: Number(x.slice(0, -1)), color });
      }
      if (stops.length < 2) return null;
      if (stops[0].at === null) stops[0].at = 0;
      if (stops[stops.length - 1].at === null) stops[stops.length - 1].at = 100;
      for (let i = 1; i < stops.length - 1; i += 1) {
        if (stops[i].at !== null) continue;
        let j = i;
        while (stops[j].at === null) j += 1;
        const lo = stops[i - 1].at;
        const hi = stops[j].at;
        for (let k = i; k < j; k += 1) stops[k].at = r3(lo + ((hi - lo) * (k - i + 1)) / (j - i + 1));
      }
      return { kind: 'linear', angle: r3(((angle % 360) + 360) % 360), stops };
    }

    /* ── style của một element ───────────────────────────────────── */

    const NON_INHERITED: A = {
      display: 'inline',
      'flex-direction': 'row',
      'align-items': 'normal',
      'justify-content': 'normal',
      'flex-wrap': 'nowrap',
      'grid-auto-flow': 'row',
      position: 'static',
      'z-index': 'auto',
      'background-color': 'rgba(0, 0, 0, 0)',
      'border-radius': '0px',
      opacity: '1',
      overflow: 'visible',
      'mix-blend-mode': 'normal',
      'pointer-events': 'auto',
      'container-type': 'normal',
      'object-fit': 'fill',
      'background-image': 'none',
      'box-shadow': 'none',
      filter: 'none',
      'backdrop-filter': 'none',
      'clip-path': 'none',
      visibility: 'visible',
    };
    const INHERITED = [
      'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
      'text-align', 'text-transform', 'white-space', 'list-style-type', 'font-variant-numeric',
      'font-style',
    ];

    const DISPLAY_MAP: A = {
      flex: 'flex', grid: 'grid', block: 'block', 'inline-flex': 'inline-flex', contents: 'contents', none: 'none',
      inline: 'inline-flex', 'inline-block': 'inline-flex', 'inline-grid': 'inline-flex',
      'flow-root': 'block', 'list-item': 'block', table: 'block', 'table-row': 'flex',
      'table-cell': 'block', 'table-row-group': 'block', 'table-header-group': 'block',
      'table-footer-group': 'block', 'table-caption': 'block', '-webkit-box': 'block',
    };

    function styleOf(el: A, parent: A, kind: string): A {
      const cs = gcs(el);
      const ps = parent ? gcs(parent) : null;
      const raw: A = {};
      for (const [prop, initial] of Object.entries(NON_INHERITED)) {
        const v = cs.getPropertyValue(prop);
        if (v && norm(v) !== norm(initial as string)) raw[prop] = v;
      }
      for (const prop of INHERITED) {
        const v = cs.getPropertyValue(prop);
        if (!v) continue;
        if (ps && norm(v) === norm(ps.getPropertyValue(prop))) continue;
        raw[prop] = v;
      }

      const base: A = {};
      const put = (group: string, key: string, value: unknown) => {
        if (value === null || value === undefined) return;
        (base[group] ??= {})[key] = value;
      };
      const leftovers: string[] = [];
      let bgSrc: string[] | undefined;
      const isText = kind === 'Text';

      /* layout */
      if (raw.display) {
        const mapped = DISPLAY_MAP[raw.display.trim()];
        // Text giữ `inline` mặc định của thẻ nội dòng — ép flex lên một <span> là đổi cách nó chảy.
        if (mapped && !(isText && raw.display.trim() === 'inline')) put('layout', 'display', mapped);
        else if (!mapped) note('display-unknown', raw.display);
      }
      if (raw['flex-direction']) put('layout', 'flexDirection', raw['flex-direction']);
      if (raw['flex-wrap']) put('layout', 'wrap', raw['flex-wrap'] !== 'nowrap');
      if (raw['grid-auto-flow']) put('layout', 'autoFlow', raw['grid-auto-flow']);
      {
        const rg = cs.getPropertyValue('row-gap');
        const cg = cs.getPropertyValue('column-gap');
        const gapOf = (v: string) => (v === 'normal' ? null : len(v, 'space'));
        if (rg !== 'normal' || cg !== 'normal') {
          if (rg === cg) put('layout', 'gap', gapOf(rg));
          else {
            put('layout', 'rowGap', gapOf(rg));
            put('layout', 'columnGap', gapOf(cg));
          }
        }
      }
      if (raw['align-items']) {
        const v = raw['align-items'] as string;
        put('layout', 'align', ({ 'flex-start': 'start', 'flex-end': 'end', 'self-start': 'start', 'self-end': 'end' } as A)[v] ?? v);
      }
      if (raw['justify-content']) {
        const v = raw['justify-content'] as string;
        put('layout', 'justify', ({
          'flex-start': 'start', 'flex-end': 'end', 'space-between': 'between',
          'space-around': 'around', 'space-evenly': 'around',
        } as A)[v] ?? v);
      }
      {
        const as = cs.getPropertyValue('align-self');
        if (as && as !== 'auto' && as !== 'normal') {
          put('layout', 'alignSelf', ({ 'flex-start': 'start', 'flex-end': 'end' } as A)[as] ?? as);
        }
        const grow = Number(cs.getPropertyValue('flex-grow'));
        const shrink = Number(cs.getPropertyValue('flex-shrink'));
        if (grow !== 0 || shrink !== 1) {
          const flex: A = { grow: r3(grow), shrink: r3(shrink) };
          const typed0 = typedMap(el);
          const bas = typedLen(typed0, el, 'flex-basis');
          if (bas) flex.basis = bas;
          put('layout', 'flex', flex);
        } else if (cs.getPropertyValue('flex-basis') !== 'auto') {
          const bas = typedLen(typedMap(el), el, 'flex-basis');
          if (bas) put('layout', 'flex', { basis: bas });
        }
      }
      if (cs.display === 'grid' || cs.display === 'inline-grid') {
        for (const [prop, key] of [['grid-template-columns', 'gridTemplateColumns'], ['grid-template-rows', 'gridTemplateRows']] as const) {
          const computed = cs.getPropertyValue(prop);
          if (!computed || computed === 'none') continue;
          const decl = declaredOf(el, prop);
          let tracks = decl && decl !== 'none' ? parseTracks(decl) : null;
          if (!tracks) {
            // Hàng không khai báo là hàng ẩn (implicit): computed trả px của lần đo, nướng vào
            // sẽ đóng băng chiều cao. Cột thì phải có — nên mới dùng giá trị đã resolve.
            if (key === 'gridTemplateRows' && !decl) continue;
            tracks = resolvedTracks(computed);
            if (decl && tracks) note('grid-approx', `${prop}: ${decl}`.slice(0, 80));
            else if (!tracks) note('grid-unparsed', `${prop}: ${computed}`.slice(0, 80));
          }
          if (tracks) put('layout', key, tracks);
        }
      }

      /* spacing — Typed OM giữ `%` (hack padding-top 56.25%) và `auto` */
      const typed = typedMap(el);
      for (const [css, key] of [
        ['padding-top', 'pt'], ['padding-right', 'pr'], ['padding-bottom', 'pb'], ['padding-left', 'pl'],
        ['margin-top', 'mt'], ['margin-right', 'mr'], ['margin-bottom', 'mb'], ['margin-left', 'ml'],
      ] as const) {
        if (css.startsWith('margin') && isAuto(typed, css)) {
          leftovers.push(`${css}: auto;`);
          continue;
        }
        const v = typedLen(typed, el, css, 'space');
        if (v && v.v !== 0) put('spacing', key, v);
      }

      /* size */
      const positioned = cs.position !== 'static';
      {
        const wv = typed.get('width');
        const wName = wv?.constructor?.name;
        if (wName === 'CSSUnitValue' && wv.unit === 'percent' && wv.value === 100) put('size', 'width', 'full');
        else if (wName !== 'CSSKeywordValue') put('size', 'width', typedLen(typed, el, 'width'));

        // Chiều cao: đơn vị theo viewport phải đọc từ KHAI BÁO — computed đã đổi vh ra px của lần đo.
        const rect = el.getBoundingClientRect();
        const big = rect.height >= vh * 0.4;
        const vhDecl = (prop: string) => {
          if (!big) return null;
          const d = declaredOf(el, prop);
          const m = d ? /^([\d.]+)(?:d|s|l)?vh$/.exec(d) : null;
          return m ? Number(m[1]) : null;
        };
        const hv = vhDecl('height') ?? vhDecl('block-size');
        if (hv !== null) put('size', 'height', hv === 100 ? 'svh' : { v: hv, u: 'svh' });
        else {
          const h = typed.get('height');
          if (h?.constructor?.name === 'CSSUnitValue' && h.unit === 'percent' && h.value === 100) put('size', 'height', 'full');
          else if (h?.constructor?.name !== 'CSSKeywordValue') put('size', 'height', typedLen(typed, el, 'height'));
        }
        const mh = vhDecl('min-height') ?? vhDecl('min-block-size');
        if (mh !== null) put('size', 'minHeight', { v: mh, u: 'svh' });
        else {
          const v = typedLen(typed, el, 'min-height');
          if (v && v.v !== 0) put('size', 'minHeight', v);
        }
        const mw = typedLen(typed, el, 'min-width');
        if (mw && mw.v !== 0) put('size', 'minWidth', mw);
        const xw = typedLen(typed, el, 'max-width');
        if (xw) put('size', 'maxWidth', xw);
        const xh = typedLen(typed, el, 'max-height');
        if (xh) put('size', 'maxHeight', xh);
        const ar = cs.getPropertyValue('aspect-ratio');
        if (ar && ar !== 'auto') {
          put('size', 'aspectRatio', ar.trim().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' '));
        }
      }

      /* position */
      if (raw.position) put('position', 'kind', raw.position);
      if (positioned) {
        for (const side of ['top', 'right', 'bottom', 'left']) put('position', side, typedLen(typed, el, side));
      }
      if (raw['z-index']) {
        const z = raw['z-index'].trim();
        const tk = t.zs[z];
        put('position', 'z', tk ? { $token: tk } : /^-?\d+$/.test(z) ? Number(z) : null);
      }
      {
        const tr = cs.getPropertyValue('translate').trim();
        if (tr && tr !== 'none') {
          const parts: string[] = tr.split(/\s+/);
          if (parts.length <= 2 && parts.every((part) => /^-?[\d.]+(px|%)$/.test(part))) {
            const x = len(parts[0] as string);
            const y = parts[1] ? len(parts[1]) : { v: 0, u: 'px' };
            if (!(x?.v === 0 && y?.v === 0)) put('transform', 'translate', { x, y });
          } else leftovers.push(`translate: ${tr};`);
        }
      }
      // `transform`: KHAI BÁO (CSSOM/inline), không computed — computed là ma trận của một khoảnh
      // khắc, có thể đang giữa một animation. Transform do JS gắn không đọc được → báo.
      if (cs.transform !== 'none') {
        const d = declaredOf(el, 'transform');
        if (d && d !== 'none') leftovers.push(`transform: ${d};`);
        else note('transform-js', undefined);
      }

      /* typography */
      if (raw.color) put('typography', 'color', col(raw.color));
      if (raw['font-size']) put('typography', 'size', len(raw['font-size'], 'font'));
      {
        // Hệ số theo cỡ chữ CỦA CHÍNH phần tử, và luôn ghi cho node chữ — xem html-to-doc.ts.
        const lh = raw['line-height'] ?? (isText ? cs.lineHeight : undefined);
        const fs = parseFloat(cs.fontSize);
        if (lh && lh !== 'normal' && /px$/.test(lh) && fs > 0) {
          put('typography', 'leading', Math.round((parseFloat(lh) / fs) * 10000) / 10000);
        }
      }
      if (raw['font-family']) {
        const first = (raw['font-family'] as string).split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();
        const tk = t.families[first];
        if (tk) put('typography', 'family', { $token: tk });
        else if (isText || el === doc.body) note('font-family', first);
      }
      if (raw['font-weight']) put('typography', 'weight', Number(raw['font-weight']));
      if (raw['letter-spacing'] && raw['letter-spacing'] !== 'normal') put('typography', 'tracking', len(raw['letter-spacing'], 'tracking'));
      if (isText) {
        // Node chữ luôn khai ĐỦ cỡ/đậm/giãn chữ: CSS nền của builder (`h1 { … }`, `p { … }` trong
        // typography.css) có thể đè giá trị kế thừa, và "bằng cha" không còn đúng khi nền khác nguồn.
        put('typography', 'size', len(cs.fontSize, 'font'));
        put('typography', 'weight', Number(cs.fontWeight));
        put('typography', 'tracking', cs.letterSpacing === 'normal' ? { v: 0, u: 'px' } : len(cs.letterSpacing, 'tracking'));
      }
      if (raw['text-align']) {
        put('typography', 'align', ({ end: 'right', left: 'left', center: 'center', right: 'right' } as A)[raw['text-align']] ?? null);
      }
      if (raw['text-transform'] && (raw['text-transform'] !== 'none' || ps)) put('typography', 'transform', raw['text-transform']);
      if (raw['white-space'] && (raw['white-space'] !== 'normal' || ps)) {
        const ws = raw['white-space'] as string;
        put('typography', 'whiteSpace', ({ nowrap: 'nowrap', 'pre-line': 'pre-line', 'pre-wrap': 'pre-line', pre: 'pre-line', normal: 'normal' } as A)[ws] ?? null);
      }
      if (raw['list-style-type']) {
        const ls = raw['list-style-type'] as string;
        const listy = ['ul', 'ol', 'li'].includes(el.tagName.toLowerCase());
        if (ls === 'none' || (listy && ['disc', 'decimal'].includes(ls))) put('typography', 'listStyle', ls);
      }
      if (raw['font-variant-numeric'] && raw['font-variant-numeric'].includes('tabular')) put('typography', 'variantNumeric', 'tabular-nums');
      if (raw['font-style'] === 'italic') leftovers.push('font-style: italic;');
      {
        const deco = cs.getPropertyValue('text-decoration-line');
        const pdeco = ps ? ps.getPropertyValue('text-decoration-line') : 'none';
        if (deco.includes('underline') && !pdeco.includes('underline')) put('typography', 'decoration', 'underline');
        else if (deco === 'none' && pdeco.includes('underline') && ps) put('typography', 'decoration', 'none');
      }
      {
        const ts = cs.getPropertyValue('text-shadow');
        if (ts && ts !== 'none') leftovers.push(`text-shadow: ${ts};`);
      }

      /* fill */
      if (raw['background-color']) put('fill', 'color', col(raw['background-color']));
      if (raw['background-image']) {
        const v = raw['background-image'] as string;
        if (v.includes('url(')) {
          bgSrc = [...v.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => absUrl(m[1])).filter(Boolean) as string[];
          const size = cs.getPropertyValue('background-size');
          const pos = cs.getPropertyValue('background-position');
          const fit = size === 'contain' ? 'contain' : 'cover';
          if (size !== 'cover' && size !== 'contain') note('bg-size', size.slice(0, 40));
          put('fill', 'image', { assetId: '__bg__', fit, ...(/^[a-zA-Z0-9 _.\-%/]+$/.test(pos) ? { position: pos } : {}) });
          if (/gradient\(/.test(v)) note('bg-layers', undefined);
        } else {
          const g = parseLinearGradient(v);
          if (g) put('fill', 'gradient', g);
          else leftovers.push(`background-image: ${v};`);
        }
      }

      /* border: đồng nhất bốn cạnh → typed; lệch → customCss */
      {
        const sides = ['top', 'right', 'bottom', 'left'];
        const widths = sides.map((s) => cs.getPropertyValue(`border-${s}-width`));
        const styles = sides.map((s) => cs.getPropertyValue(`border-${s}-style`));
        const colors = sides.map((s) => cs.getPropertyValue(`border-${s}-color`));
        const any = widths.some((x, i) => x !== '0px' && styles[i] !== 'none');
        if (any) {
          const uniform = widths.every((x) => x === widths[0]) && styles.every((x) => x === styles[0]) && colors.every((x) => x === colors[0]);
          if (uniform && (styles[0] === 'solid' || styles[0] === 'dashed')) {
            put('border', 'width', len(widths[0] as string));
            put('border', 'style', styles[0]);
            put('border', 'color', col(colors[0] as string));
          } else {
            sides.forEach((s, i) => {
              if (widths[i] !== '0px' && styles[i] !== 'none') {
                leftovers.push(`border-${s}: ${widths[i]} ${styles[i]} ${colors[i]};`);
              }
            });
          }
        } else if (kind === 'Button') put('border', 'hidden', true);
      }
      if (raw['border-radius'] && raw['border-radius'] !== '0px') {
        const r = len(raw['border-radius'], 'radius');
        if (r) put('border', 'radius', r);
        else leftovers.push(`border-radius: ${raw['border-radius']};`);
      }

      /* effects */
      if (raw.opacity) put('effects', 'opacity', r3(Number(raw.opacity)));
      if (raw.overflow) {
        const parts = (raw.overflow as string).trim().split(/\s+/);
        const ok = (x: string) => ['visible', 'hidden', 'clip', 'auto', 'scroll'].includes(x);
        if (parts.length === 1 && ok(parts[0] as string)) put('effects', 'overflow', parts[0] === 'scroll' ? 'auto' : parts[0]);
        else if (parts.length === 2 && parts.every(ok)) leftovers.push(`overflow-x: ${parts[0]}; overflow-y: ${parts[1]};`);
      }
      if (raw['mix-blend-mode']) put('effects', 'blend', raw['mix-blend-mode']);
      if (raw['pointer-events']) put('effects', 'pointerEvents', raw['pointer-events'] === 'none' ? 'none' : 'auto');
      if (raw.visibility) put('effects', 'visibility', raw.visibility === 'hidden' ? 'hidden' : 'visible');
      if (raw['container-type']) put('container', 'type', raw['container-type']);
      if (raw['object-fit']) put('effects', 'objectFit', raw['object-fit']);
      {
        const op = cs.getPropertyValue('object-position');
        if (op && op !== '50% 50%' && /^[a-zA-Z0-9 _.\-%/]+$/.test(op)) put('effects', 'objectPosition', op);
      }
      for (const prop of ['box-shadow', 'filter', 'backdrop-filter', 'clip-path']) {
        if (raw[prop]) leftovers.push(`${prop}: ${raw[prop]};`);
      }
      if (cs.cursor === 'pointer' && (el.matches?.('a,button,[role=button],[onclick]') ?? false)) {
        put('effects', 'cursor', 'pointer');
      }

      return {
        base,
        customCss: leftovers.length ? leftovers.join('\n') : undefined,
        bgSrc,
        raw,
      };
    }

    /* ── nội dung ────────────────────────────────────────────────── */

    const SKIP_TAGS = new Set([
      'script', 'style', 'link', 'meta', 'title', 'noscript', 'template', 'br', 'use', 'path', 'defs',
      'symbol', 'source', 'track', 'head', 'base',
    ]);
    const SECTION_TAGS = new Set(['section', 'header', 'footer', 'main', 'nav', 'aside']);
    const TEXT_TAGS: A = {
      h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h4', h6: 'h4', p: 'p', span: 'span', blockquote: 'blockquote',
      li: 'li', label: 'span', figcaption: 'p', small: 'span', dt: 'p', dd: 'p', address: 'p', cite: 'span',
      time: 'span', legend: 'span', summary: 'span', pre: 'p', code: 'span',
      // Thẻ nội dòng đứng riêng (khi cha bị tách thành nhiều node chữ — xem `styledInline`).
      b: 'span', strong: 'span', em: 'span', i: 'span', u: 'span', s: 'span', mark: 'span', sup: 'span',
      sub: 'span', q: 'span', abbr: 'span', del: 'span', ins: 'span', kbd: 'span',
    };
    const INLINE_TAGS = new Set([
      'a', 'em', 'i', 'strong', 'b', 'br', 'span', 'sup', 'sub', 'small', 'u', 's', 'mark', 'code', 'abbr',
      'time', 'cite', 'q', 'wbr', 'del', 'ins', 'kbd', 'label', 'font',
    ]);
    const FORM_TAGS = new Set(['input', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'progress', 'meter']);
    const ZERO_PX = { v: 0, u: 'px' };
    const LINK_COVER_CSS = [
      'padding: 0;', 'border: 0;', 'border-radius: 0;', 'background: none;',
      '&::after { display: none; }',
      '&:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }',
    ].join('\n');
    const BUTTON_RESET_CSS = '&::after { display: none; }';

    function richText(el: A, preserve: boolean): A[] {
      const parts: A[] = [];
      const own = gcs(el);
      for (const child of Array.from(el.childNodes) as A[]) {
        if (child.nodeType === Node.TEXT_NODE) {
          const v = child.textContent ?? '';
          if (preserve ? v : v.trim()) parts.push({ t: 'text', v: preserve ? v : v.replace(/\s+/g, ' ') });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const e = child;
          const tag = e.tagName.toLowerCase();
          if (SKIP_TAGS.has(tag) && tag !== 'br') continue;
          if (tag === 'br') parts.push({ t: 'br' });
          else if (tag === 'a') parts.push({ t: 'link', href: hrefOf(e.getAttribute('href')), children: richText(e, preserve) });
          else if (tag === 'em' || tag === 'i') parts.push({ t: 'em', children: richText(e, preserve) });
          else if (tag === 'strong' || tag === 'b') parts.push({ t: 'strong', children: richText(e, preserve) });
          else if (tag === 'svg') continue;
          else {
            const cs = gcs(e);
            // Đậm/nghiêng ĐÚNG là thứ RichText biểu diễn được — đổi chúng thành strong/em thay vì bỏ.
            const bolder = Number(cs.fontWeight) >= 600 && Number(own.fontWeight) < 600;
            const slanted = cs.fontStyle === 'italic' && own.fontStyle !== 'italic';
            if (
              (cs.color !== own.color && !bolder && !slanted) ||
              (cs.fontSize !== own.fontSize && !bolder && !slanted) ||
              (cs.fontWeight !== own.fontWeight && !bolder)
            ) {
              note('inline-style-lost', (e.textContent ?? '').trim().slice(0, 40));
            }
            let inner = richText(e, preserve);
            if (slanted) inner = [{ t: 'em', children: inner }];
            if (bolder) inner = [{ t: 'strong', children: inner }];
            parts.push(...inner);
          }
        }
      }
      return parts.length ? parts : [{ t: 'text', v: '' }];
    }

    function hasTextOrMedia(el: A): boolean {
      return Boolean((el.textContent ?? '').trim()) || Boolean(el.querySelector('img,video,svg,canvas,iframe'));
    }

    /** SVG nội dòng → mã nguồn tự đủ (màu cố định, `<use>` mở ra, có width/height). */
    function svgSource(svg: A): string | null {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const clone = svg.cloneNode(true);
      // Mở <use href="#id"> trỏ tới symbol/phần tử cùng tài liệu.
      for (const use of Array.from(clone.querySelectorAll('use')) as A[]) {
        const ref = (use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '').trim();
        if (!ref.startsWith('#')) {
          note('svg-external-use', ref.slice(0, 60));
          continue;
        }
        const target = doc.getElementById(ref.slice(1));
        if (!target) continue;
        const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        const src = target.tagName.toLowerCase() === 'symbol' ? Array.from(target.childNodes) : [target];
        for (const n of src as A[]) g.appendChild(n.cloneNode(true));
        use.replaceWith(g);
      }
      // Chép style computed lên từng hình — CSS ngoài (`.icon path { fill: … }`) không đi theo file.
      const origShapes = Array.from(svg.querySelectorAll('*')) as A[];
      const cloneShapes = Array.from(clone.querySelectorAll('*')) as A[];
      const color = gcs(svg).color;
      const same = origShapes.length === cloneShapes.length;
      cloneShapes.forEach((c, i) => {
        const o = same ? origShapes[i] : null;
        if (!o) return;
        const s = gcs(o);
        const tag = c.tagName.toLowerCase();
        if (['g', 'defs', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop', 'symbol'].includes(tag)) return;
        for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity', 'fill-rule']) {
          const v = s.getPropertyValue(p);
          if (v && !c.hasAttribute(p) === true) c.setAttribute(p, v);
        }
      });
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(r3(rect.width)));
      clone.setAttribute('height', String(r3(rect.height)));
      if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${r3(rect.width)} ${r3(rect.height)}`);
      let out: string = new w.XMLSerializer().serializeToString(clone);
      out = out.replace(/currentColor/gi, color);
      return out;
    }

    const hashOf = (s: string) => {
      let h = 5381;
      for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return (h >>> 0).toString(36);
    };

    /* ── duyệt ───────────────────────────────────────────────────── */

    const takenHtmlIds = new Set<string>();
    const AREA = (el: A) => {
      const r = el.getBoundingClientRect();
      return Math.round(r.width * r.height);
    };

    function walk(el: A, parentId: string | null, parentEl: A, parentRendered: boolean, index = 0): string | null {
      stats.elements += 1;
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return null;
      if (stats.nodes >= MAX_NODES) {
        note('max-nodes', undefined);
        return null;
      }
      const cs = gcs(el);
      const rendered = parentRendered && (cs.display === 'contents' || el.getClientRects().length > 0);
      const nodeId = el === doc.body ? 'root' : idOf(el, parentId, index);
      const kindGuess = TEXT_TAGS[tag] ? 'Text' : 'Stack';

      // Lá không dùng được: input/form field, canvas, iframe, object, audio, picture phụ…
      const placeholder = (type: string, code: string, sample: string): string => {
        const ex = styleOf(el, parentEl, 'Stack');
        nodes[nodeId] = {
          id: nodeId, parentId, children: [], effects: [], type: 'Stack',
          direction: { base: 'row' }, style: { base: ex.base }, name: type,
          _vis: rendered ? 1 : 0, _area: AREA(el), _keep: 1,
        };
        stats.nodes += 1;
        if (rendered) note(code, sample);
        return nodeId;
      };

      if (FORM_TAGS.has(tag)) {
        return placeholder(tag, 'form-field', `${tag}${el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : ''}`);
      }
      if (tag === 'canvas') return placeholder('canvas', 'canvas', (el.getAttribute('class') ?? 'canvas').slice(0, 40));
      if (tag === 'iframe') return placeholder('iframe', 'iframe', (el.getAttribute('src') ?? '').slice(0, 80));
      if (tag === 'object' || tag === 'embed' || tag === 'audio') {
        return placeholder(tag, 'embed', (el.getAttribute('src') ?? el.getAttribute('data') ?? tag).slice(0, 80));
      }

      const type0 = tag === 'img' ? 'Image' : tag === 'video' ? 'Video' : tag === 'svg' ? 'Image' : kindGuess;
      const extracted = styleOf(el, parentEl, type0);
      const common: A = {
        id: nodeId,
        parentId,
        children: [] as string[],
        effects: [],
        style: { base: extracted.base },
        ...(extracted.customCss ? { customCss: extracted.customCss } : {}),
        ...(extracted.bgSrc?.length ? { _bgSrc: extracted.bgSrc } : {}),
        _vis: rendered ? 1 : 0,
        _area: AREA(el),
      };
      const htmlId = el.id ? slugId(el.id) : '';
      if (htmlId && /^[a-z]/.test(htmlId) && !takenHtmlIds.has(htmlId)) {
        takenHtmlIds.add(htmlId);
        common.htmlId = htmlId;
      }
      const aria = el.getAttribute('aria-label');
      if (aria) common.a11y = { label: aria.slice(0, 200) };
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).find((c: string) => c);
      if (cls) common.name = cls.slice(0, 120);
      else if (el === doc.body) common.name = 'Trang';

      /* hành vi JS đã biết mà builder chưa có — chỉ đếm khi thấy được */
      if (rendered) {
        const clsAll = (el.getAttribute('class') ?? '') + ' ' + (typeof el.id === 'string' ? el.id : '');
        if (/\b(swiper|slick|splide|glide|flickity|owl-carousel|carousel)\b/i.test(clsAll)) note('behaviour-carousel', cls ?? tag);
        if (/\b(aos|reveal|parallax|gsap|lenis|wow|scrollmagic)\b/i.test(clsAll) || el.hasAttribute('data-aos') || el.hasAttribute('data-scroll') || el.hasAttribute('data-animate')) {
          note('behaviour-scroll-effect', cls ?? tag);
        }
        if (el.hasAttribute('aria-expanded') || tag === 'details') note('behaviour-toggle', cls ?? tag);
        if (tag === 'dialog' || el.getAttribute('aria-modal') === 'true' || el.getAttribute('role') === 'dialog') note('behaviour-modal', cls ?? tag);
        if (el.getAttribute('role') === 'tab') note('behaviour-tabs', cls ?? tag);
        if (/lottie|model-viewer|spline-viewer/.test(tag) || el.hasAttribute('data-lottie')) note('behaviour-lottie', tag);
        if (cs.position === 'sticky' || cs.position === 'fixed') note('behaviour-fixed', `${cls ?? tag} (${cs.position})`);
        if (tag === 'form') note('form', cls ?? 'form');
        if (tag === 'table') note('table', cls ?? 'table');
        if (cs.backgroundImage.includes('gradient(') && /repeating|radial|conic/.test(cs.backgroundImage)) {
          note('gradient-unsupported', cls ?? tag);
        }
      }

      /* ── SVG nội dòng → file SVG ── */
      if (tag === 'svg') {
        const src = svgSource(el);
        if (!src) {
          nodes[nodeId] = { ...common, type: 'Stack', direction: { base: 'row' }, name: 'svg' };
          stats.nodes += 1;
          return nodeId;
        }
        const key = hashOf(src);
        svgs[key] = src;
        const label = el.getAttribute('aria-label') ?? el.querySelector('title')?.textContent ?? '';
        nodes[nodeId] = {
          ...common, type: 'Image', assetId: null, alt: label.slice(0, 200), decorative: !label,
          fit: { base: 'contain' }, _src: `svg:${key}`, children: [],
        };
        stats.nodes += 1;
        return nodeId;
      }

      if (tag === 'img') {
        const img = el as HTMLImageElement;
        const src = absUrl(img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src'));
        const alt = el.getAttribute('alt') ?? '';
        const of = (extracted.raw['object-fit'] as string | undefined) ?? 'fill';
        nodes[nodeId] = {
          ...common, type: 'Image', assetId: null, alt: alt.slice(0, 500), decorative: alt === '',
          fit: { base: of === 'cover' || of === 'contain' ? of : 'fill' },
          _src: src, children: [],
        };
        stats.nodes += 1;
        if (!src && rendered) note('image-no-src', cls ?? 'img');
        return nodeId;
      }

      if (tag === 'video') {
        const v = el as HTMLVideoElement;
        const src = absUrl(v.currentSrc || v.getAttribute('src') || v.getAttribute('data-src') || v.querySelector('source')?.getAttribute('src'));
        const preload = v.getAttribute('preload');
        nodes[nodeId] = {
          ...common, type: 'Video', assetId: null, posterAssetId: null,
          autoplay: v.autoplay || v.hasAttribute('autoplay'),
          loop: v.loop, muted: v.muted || v.hasAttribute('muted'), controls: v.controls,
          ...(preload === 'none' || preload === 'metadata' || preload === 'auto' ? { preload } : {}),
          _src: src,
          ...(v.getAttribute('poster') ? { _posterSrc: absUrl(v.getAttribute('poster')) } : {}),
          children: [],
        };
        stats.nodes += 1;
        if (rendered) {
          if (!src) note('video-no-src', cls ?? 'video');
          else if (/^blob:/.test(src) || /\.m3u8(\?|$)/i.test(src) || /\.mpd(\?|$)/i.test(src)) note('video-stream', src.slice(0, 80));
        }
        return nodeId;
      }

      /* ── Nút ── */
      const noKids = el.querySelector('*') === null;
      if (tag === 'button' || (tag === 'a' && noKids && el.closest('nav') === null && (el.textContent ?? '').trim())) {
        const href = el.getAttribute('href');
        const blank = el.getAttribute('target') === '_blank';
        const typeAttr = (el.getAttribute('type') ?? '').toLowerCase();
        const style = common.style.base;
        // `.btn` của builder đặt padding/viền/chữ hoa ở layer base — nút clone phải khai ĐỦ để thắng nó.
        style.border ??= { hidden: true };
        style.typography ??= {};
        style.typography.transform ??= 'none';
        // `.btn` của builder cũng đặt cỡ/giãn chữ, màu, nền, gap, overflow: khai đủ để thắng nó.
        style.typography.size ??= len(cs.fontSize, 'font');
        style.typography.tracking ??= cs.letterSpacing === 'normal' ? { v: 0, u: 'px' } : len(cs.letterSpacing, 'tracking');
        style.typography.color ??= col(cs.color);
        style.typography.whiteSpace ??= cs.whiteSpace === 'nowrap' ? 'nowrap' : 'normal';
        (style.fill ??= {}).color ??= isTransparent(cs.backgroundColor) ? { hex: '#000000', alpha: 0 } : col(cs.backgroundColor);
        (style.effects ??= {}).overflow ??= 'visible';
        (style.layout ??= {}).gap ??= { v: 0, u: 'px' };
        style.layout.display ??= 'inline-flex';
        style.spacing ??= {};
        for (const k of ['pt', 'pr', 'pb', 'pl']) style.spacing[k] ??= { ...ZERO_PX };
        style.border.radius ??= { ...ZERO_PX };
        nodes[nodeId] = {
          ...common, type: 'Button',
          label: richText(el, false),
          variant: 'link',
          action: href && tag === 'a' ? { kind: 'link', href: hrefOf(href), ...(blank ? { target: '_blank' } : {}) } : { kind: 'none' },
          customCss: [common.customCss, BUTTON_RESET_CSS].filter(Boolean).join('\n'),
          children: [],
        };
        if (tag === 'button' && typeAttr === 'submit') note('form-submit', (el.textContent ?? '').trim().slice(0, 40));
        stats.nodes += 1;
        return nodeId;
      }

      /* ── Chữ ── */
      const hasBlockChild = (Array.from(el.querySelectorAll('*')) as A[]).some((c) => {
        const ct = c.tagName.toLowerCase();
        if (ct !== 'svg' && c.closest('svg')) return false;
        return !INLINE_TAGS.has(ct) && ct !== 'svg';
      });
      const ownText = (Array.from(el.childNodes) as A[]).some(
        (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim(),
      );
      const decorative = tag === 'span' && !ownText && !(el.textContent ?? '').trim();
      /**
       * Khối chữ mà một phần tử nội dòng bên trong có style RIÊNG (màu nhấn, cỡ chữ khác, chữ hoa…) hay
       * không còn chảy nội dòng. RichText chỉ có đậm/nghiêng/link nên gộp vào một Text là mất style đó
       * (`<h1>Tiết kiệm <span class="accent">thông minh</span></h1>` mất màu nhấn). Khi ấy khối được
       * dựng bằng Stack, mỗi đoạn là một Text nội dòng — vẫn chảy như cũ vì cha giữ `display` gốc.
       */
      const styledInline = (): boolean => {
        for (const c of Array.from(el.querySelectorAll('*')) as A[]) {
          const ct = c.tagName.toLowerCase();
          if (ct === 'br' || ct === 'svg' || ct === 'a' || c.closest('svg')) continue;
          const sc = gcs(c);
          const bolder = Number(sc.fontWeight) >= 600 && Number(cs.fontWeight) < 600;
          if (
            sc.color !== cs.color ||
            sc.fontSize !== cs.fontSize ||
            sc.letterSpacing !== cs.letterSpacing ||
            sc.fontFamily !== cs.fontFamily ||
            sc.textTransform !== cs.textTransform ||
            sc.display !== 'inline' ||
            (sc.fontWeight !== cs.fontWeight && !bolder)
          ) {
            return true;
          }
        }
        return false;
      };
      const isTextCandidate = Boolean(TEXT_TAGS[tag]) && !hasBlockChild && !decorative && (el.textContent ?? '').trim();
      const split = isTextCandidate && el.children.length > 0 && styledInline();
      if (split) note('text-split', `${tag} "${(el.textContent ?? '').trim().slice(0, 28)}"`);
      if (isTextCandidate && !split) {
        const preserve = String(cs.whiteSpace).startsWith('pre');
        nodes[nodeId] = {
          ...common, type: 'Text', tag: TEXT_TAGS[tag], content: richText(el, preserve), children: [],
        };
        stats.nodes += 1;
        return nodeId;
      }

      /* ── Khối ── */
      const isSection = SECTION_TAGS.has(tag);
      const node: A = { ...common, type: isSection ? 'Section' : 'Stack' };
      // Tiêu đề bị tách thành khối: giữ vai heading cho trình đọc màn hình và máy tìm kiếm.
      if (split && /^h[1-6]$/.test(tag)) node.a11y = { ...(common.a11y ?? {}), role: 'heading' };
      if (isSection) node.tag = tag;
      else node.direction = { base: cs.flexDirection.startsWith('column') ? 'column' : 'row' };
      if (el === doc.body) {
        node.type = 'Stack';
        delete node.tag;
        node.direction = { base: 'column' };
        // Nền trang có thể nằm ở <html> chứ không ở <body>.
        const fill = node.style.base.fill?.color;
        if (!fill) {
          const hc = gcs(doc.documentElement).backgroundColor;
          if (!isTransparent(hc)) put2(node.style.base, 'fill', 'color', col(hc));
        }
      }
      nodes[nodeId] = node;
      stats.nodes += 1;

      const kids: string[] = [];
      let runs = 0;
      for (const child of Array.from(el.childNodes) as A[]) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const cid = walk(child, nodeId, el, rendered, Array.prototype.indexOf.call(el.children, child));
          if (cid) kids.push(cid);
        } else if (child.nodeType === Node.TEXT_NODE && el.children.length && (child.textContent ?? '').trim()) {
          runs += 1;
          const tid = `${nodeId}t${runs === 1 ? '' : runs}`;
          nodes[tid] = {
            id: tid, parentId: nodeId, children: [], effects: [], style: { base: {} },
            type: 'Text', tag: 'span',
            content: [{ t: 'text', v: (child.textContent ?? '').replace(/\s+/g, ' ').trim() }],
            _vis: rendered ? 1 : 0, _area: 1,
          };
          stats.nodes += 1;
          kids.push(tid);
        }
      }

      /* Link bọc khối: giữ cây con, thêm lớp phủ Button `link` mang href — xem html-to-doc.ts. */
      if (tag === 'a') {
        if (cs.position === 'static') {
          ((node.style.base.position ??= {})).kind = 'relative';
        }
        const href = hrefOf(el.getAttribute('href'));
        const blank = el.getAttribute('target') === '_blank';
        const label = (
          el.getAttribute('aria-label') ||
          (el.textContent ?? '').replace(/\s+/g, ' ').trim() ||
          el.querySelector('img[alt]:not([alt=""])')?.getAttribute('alt') ||
          href
        ).slice(0, 200);
        const lid = `${nodeId}a`;
        nodes[lid] = {
          id: lid, parentId: nodeId, children: [], effects: [],
          style: { base: { position: { kind: 'absolute', top: ZERO_PX, right: ZERO_PX, bottom: ZERO_PX, left: ZERO_PX, z: 1 } } },
          customCss: LINK_COVER_CSS, name: 'link-cover', a11y: { label },
          type: 'Button', label: [{ t: 'text', v: '' }], variant: 'link',
          action: { kind: 'link', href, ...(blank ? { target: '_blank' } : {}) },
          _vis: rendered ? 1 : 0, _area: 1, _keep: 1,
        };
        stats.nodes += 1;
        kids.push(lid);
      }

      // Chữ nằm thẳng trong phần tử không phải thẻ chữ (`<td>4.8%</td>`, `<div>Chữ</div>`).
      if (!el.children.length && (el.textContent ?? '').trim() && !TEXT_TAGS[tag]) {
        const tid = `${nodeId}t`;
        nodes[tid] = {
          id: tid, parentId: nodeId, children: [], effects: [], style: { base: {} },
          type: 'Text', tag: 'span', content: richText(el, String(cs.whiteSpace).startsWith('pre')),
          _vis: rendered ? 1 : 0, _area: 1,
        };
        stats.nodes += 1;
        kids.push(tid);
      }
      node.children = kids;
      return nodeId;
    }

    function put2(base: A, group: string, key: string, value: unknown) {
      if (value === null || value === undefined) return;
      (base[group] ??= {})[key] = value;
    }

    const rootId = walk(doc.body, null, null, true);

    return { rootId, nodes, svgs, notes, stats: { ...stats, unreadableSheets }, vw, vh };
  }

  /* ═══ 3. Gộp các khổ thành một doc có override breakpoint ═════════════ */

  const ZERO = { v: 0, u: 'px' };

  /** Giá trị doc tương đương giá trị MẶC ĐỊNH của CSS, theo `nhóm.khoá`. Xem html-to-doc.ts. */
  const RESET: A = {
    layout: {
      display: 'block', flexDirection: 'row', wrap: false, justify: 'start', align: 'stretch',
      gap: ZERO, rowGap: ZERO, columnGap: ZERO, autoFlow: 'row', alignSelf: 'auto',
      flex: { grow: 0, shrink: 1, basis: 'auto' },
    },
    spacing: { pt: ZERO, pr: ZERO, pb: ZERO, pl: ZERO, mt: ZERO, mr: ZERO, mb: ZERO, ml: ZERO },
    position: {
      kind: 'static',
      top: { unset: true }, right: { unset: true }, bottom: { unset: true }, left: { unset: true },
    },
    size: {
      minHeight: ZERO, minWidth: ZERO, width: 'auto', height: 'auto', aspectRatio: 'auto',
      maxWidth: { unset: true }, maxHeight: { unset: true },
    },
    transform: { translate: { x: ZERO, y: ZERO } },
    // Khoá kế thừa trở về giá trị gốc ở khổ lớn: những giá trị này CÓ dạng trong doc nên reset được.
    typography: { whiteSpace: 'normal', transform: 'none', decoration: 'none' },
    fill: { color: { hex: '#000000', alpha: 0 } },
    border: { radius: ZERO, hidden: true },
    effects: { opacity: 1, overflow: 'visible', visibility: 'visible', pointerEvents: 'auto', objectFit: 'fill' },
  };

  /** So sâu hai style, trả về phần của `next` khác `prev`; khoá trở về mặc định thì ghi giá trị reset. */
  function diffStyle(prev: A, next: A, inherited: (g: string, k: string) => unknown, unresettable: string[], who: string): A {
    const out: A = {};
    for (const [group, nextGroup] of Object.entries(next)) {
      const prevGroup = prev[group];
      if (typeof nextGroup !== 'object' || nextGroup === null || Array.isArray(nextGroup)) {
        if (JSON.stringify(prevGroup) !== JSON.stringify(nextGroup)) out[group] = nextGroup;
        continue;
      }
      const changed: A = {};
      for (const [key, value] of Object.entries(nextGroup as A)) {
        const before = prevGroup?.[key];
        if (JSON.stringify(before) !== JSON.stringify(value)) changed[key] = value;
      }
      if (Object.keys(changed).length) out[group] = changed;
    }
    for (const [group, prevGroup] of Object.entries(prev)) {
      if (typeof prevGroup !== 'object' || prevGroup === null || Array.isArray(prevGroup)) continue;
      const nextGroup = (next[group] ?? {}) as A;
      for (const [key, before] of Object.entries(prevGroup as A)) {
        if (key in nextGroup) continue;
        // Track lưới chỉ có nghĩa khi display là grid; khổ lớn không còn grid thì để nguyên là vô hại.
        if (group === 'layout' && /^grid/.test(key)) continue;
        const reset = RESET[group]?.[key] ?? inherited(group, key);
        if (reset === undefined) {
          unresettable.push(`${who} ${group}.${key}`);
          continue;
        }
        if (JSON.stringify(before) === JSON.stringify(reset)) continue;
        (out[group] ??= {})[key] = reset;
      }
    }
    return Object.keys(out).length ? out : null;
  }

  /**
   * `passes` đi từ khổ nhỏ nhất (lớp `base`) lên khổ lớn nhất. Lớp trên chỉ giữ phần KHÁC lớp ngay
   * dưới nó — đúng ngữ nghĩa cascade của min-width.
   */
  function merge(passes: Array<{ layer: string; result: A }>): A {
    const base = passes[0]!.result;
    const merged: A = JSON.parse(JSON.stringify(base.nodes));
    const { notes, note } = makeNotes();
    for (const p of passes) {
      for (const [code, v] of Object.entries(p.result.notes as A)) {
        const n = (notes[code] ??= { count: 0, samples: [] });
        n.count = Math.max(n.count, (v as A).count);
        for (const s of (v as A).samples) if (n.samples.length < 8 && !n.samples.includes(s)) n.samples.push(s);
      }
    }
    const svgs: A = {};
    for (const p of passes) Object.assign(svgs, p.result.svgs);
    const unresettable: string[] = [];

    for (let i = 1; i < passes.length; i += 1) {
      const pass = passes[i]!;
      const below = passes[i - 1]!.result.nodes;
      const here = pass.result.nodes;
      for (const [id, node] of Object.entries(here) as Array<[string, A]>) {
        const target = merged[id];
        if (!target) {
          note('pass-mismatch', id);
          continue;
        }
        // Trạng thái hiện/ẩn và diện tích gộp theo MỌI khổ — để gỡ phần tử không bao giờ hiện.
        target._vis = Math.max(target._vis ?? 0, node._vis ?? 0);
        target._area = Math.max(target._area ?? 0, node._area ?? 0);
        const delta = diffStyle(
          below[id]?.style?.base ?? {},
          node.style?.base ?? {},
          (g, k) => {
            for (let p: string | null = node.parentId; p; p = here[p]?.parentId ?? null) {
              const v = here[p]?.style?.base?.[g]?.[k];
              if (v !== undefined) return v;
            }
            return undefined;
          },
          unresettable,
          `${id}@${pass.layer}`,
        );
        if (delta) target.style[pass.layer] = delta;
      }
    }
    if (unresettable.length) {
      note('unresettable', undefined, unresettable.length);
      for (const u of unresettable.slice(0, 6)) note('unresettable', u, 0);
    }

    /* Gỡ phần tử không bao giờ hiện, rồi lá rỗng 0×0 ở mọi khổ. */
    let pruned = 0;
    const children = (n: A): string[] => n.children as string[];
    const removeFromParent = (id: string) => {
      const n = merged[id];
      const parent = n?.parentId ? merged[n.parentId] : null;
      if (parent) parent.children = children(parent).filter((c) => c !== id);
    };
    const dropSubtree = (id: string) => {
      const n = merged[id];
      if (!n) return;
      for (const c of children(n)) dropSubtree(c);
      delete merged[id];
      pruned += 1;
    };
    for (const id of Object.keys(merged)) {
      const n = merged[id];
      if (!n || id === base.rootId) continue;
      if (!n._vis) {
        removeFromParent(id);
        dropSubtree(id);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of Object.keys(merged)) {
        const n = merged[id];
        if (!n || id === base.rootId) continue;
        const leaf = !children(n).length;
        if (leaf && n.type === 'Stack' && !n._keep && !n._area && !n.fill) {
          removeFromParent(id);
          delete merged[id];
          pruned += 1;
          changed = true;
        }
      }
    }
    if (pruned) note('pruned-hidden', undefined, pruned);

    /* children của node cha có thể còn trỏ tới id đã gỡ qua dropSubtree — lọc lần cuối. */
    for (const n of Object.values(merged) as A[]) {
      if (Array.isArray(n.children)) n.children = n.children.filter((c: string) => merged[c]);
    }

    const md = (name: string) => (doc.querySelector(name)?.getAttribute('content') ?? '') as string;
    return {
      rootId: base.rootId,
      nodes: merged,
      svgs,
      notes,
      page: {
        title: doc.title ?? '',
        description: md('meta[name="description"]') || md('meta[property="og:description"]'),
        lang: doc.documentElement.lang ?? '',
        ogImage: md('meta[property="og:image"]'),
        url: w.location.href,
      },
      stats: {
        elements: base.stats.elements,
        nodes: Object.keys(merged).length,
        pruned,
        tokenValues: base.stats.tokenValues,
        literalValues: base.stats.literalValues,
      },
    };
  }

  /* ═══ 4. Đo để so sánh (compare_with_url) ═════════════════════════════ */

  const MEASURE: A = { sections: [] as A[] };

  const visibleKids = (el: A): A[] =>
    (Array.from(el.children) as A[]).filter((c) => {
      const tag = c.tagName.toLowerCase();
      if (['script', 'style', 'link', 'meta', 'noscript', 'template'].includes(tag)) return false;
      const r = c.getBoundingClientRect();
      const cs = w.getComputedStyle(c);
      return cs.display !== 'none' && r.width > 0 && r.height > 0;
    });

  /**
   * Danh sách "section" = con trực tiếp (nhìn thấy được) của gốc nội dung, sau khi bóc các lớp bọc
   * chỉ có MỘT con (`#__next`, `#root`, `.page`). Cả trang tham chiếu lẫn bản nháp đi qua cùng
   * thủ tục, nên hai bên bóc cùng số lớp.
   */
  function listSections(rootSelector: string): A {
    let root: A = doc.querySelector(rootSelector);
    if (!root) return { ok: false, error: `Không thấy gốc ${rootSelector}` };
    for (let i = 0; i < 6; i += 1) {
      const kids = visibleKids(root);
      if (kids.length !== 1) break;
      root = kids[0];
    }
    // Khối cao hơn 2 màn mà có từ 2 con nhìn thấy (điển hình: một <main> chứa cả trang) thì bung ra
    // thành các con — nếu không, một "section" dài 9000px gom hàng trăm phần tử và bảng lệch vô dụng.
    const expand = (list: A[], depth: number): A[] => {
      const out: A[] = [];
      for (const el of list) {
        const kids = visibleKids(el);
        if (depth < 3 && el.getBoundingClientRect().height > w.innerHeight * 2 && kids.length >= 2) {
          out.push(...expand(kids, depth + 1));
        } else out.push(el);
      }
      return out;
    };
    MEASURE.sections = expand(visibleKids(root), 0);
    return {
      ok: true,
      docHeight: Math.round(doc.documentElement.scrollHeight),
      docWidth: Math.round(doc.documentElement.scrollWidth),
      count: MEASURE.sections.length,
    };
  }

  function scrollToSection(index: number): void {
    const el = MEASURE.sections[index];
    if (!el) return;
    // Phần tử cố định/dính (header) đi theo khung nhìn: đo nó ở đầu trang, trạng thái chưa thu gọn —
    // cũng là trạng thái mà lúc trích đã đo.
    const pos = w.getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      w.scrollTo(0, 0);
      return;
    }
    const r = el.getBoundingClientRect();
    w.scrollTo(0, Math.max(0, r.top + w.scrollY - 80));
  }

  const rgbOf = (v: string): string => norm(v);
  const fontFirst = (v: string) => (v.split(',')[0] as string).trim().replace(/^["']|["']$/g, '');

  /** Đo một section: hộp của nó + các phần tử MANG CHỮ TRỰC TIẾP / ảnh / nút bên trong. */
  function measureSection(index: number): A {
    const el = MEASURE.sections[index];
    if (!el) return null;
    const sr = el.getBoundingClientRect();
    const top = sr.top + w.scrollY;
    const left = sr.left + w.scrollX;
    const scs = w.getComputedStyle(el);
    const label =
      (el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : '') +
        ((el.getAttribute('class') ?? '').trim() ? `.${(el.getAttribute('class') ?? '').trim().split(/\s+/)[0]}` : ''));
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();

    const items: A[] = [];
    const seen = new Set<A>();
    const walkItems = (node: A) => {
      for (const child of Array.from(node.children) as A[]) {
        const tag = child.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'template', 'link', 'meta'].includes(tag)) continue;
        const cs = w.getComputedStyle(child);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = child.getBoundingClientRect();
        const directText = (Array.from(child.childNodes) as A[])
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        // Phần tử chứa chữ TRỰC TIẾP — không phải khối bao ngoài. Bỏ bản nhân đôi 0×0.
        const isText = directText.length > 0 && r.width > 0 && r.height > 0;
        const isMedia = (tag === 'img' || tag === 'video' || tag === 'svg') && r.width > 0 && r.height > 0;
        if ((isText || isMedia) && !seen.has(child)) {
          seen.add(child);
          const nodeEl = child.closest('[data-n]');
          items.push({
            kind: isMedia ? tag : 'text',
            tag,
            text: isText ? directText.slice(0, 80) : (child.getAttribute('alt') ?? child.getAttribute('aria-label') ?? ''),
            nodeId: nodeEl ? nodeEl.getAttribute('data-n') : null,
            x: r3(r.left + w.scrollX - left),
            y: r3(r.top + w.scrollY - top),
            w: r3(r.width),
            h: r3(r.height),
            fontSize: isText ? parseFloat(cs.fontSize) : null,
            fontWeight: isText ? Number(cs.fontWeight) : null,
            lineHeight: isText ? (cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight)) : null,
            letterSpacing: isText ? (cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing)) : null,
            fontFamily: isText ? fontFirst(cs.fontFamily) : null,
            color: isText ? rgbOf(cs.color) : null,
            background: !isMedia && !isTransparent(cs.backgroundColor) ? rgbOf(cs.backgroundColor) : null,
          });
        }
        if (tag !== 'svg') walkItems(child);
      }
    };
    walkItems(el);
    // Thứ tự DOM, không sắp theo toạ độ: hai bên cùng thứ tự nguồn, còn y lệch nửa pixel giữa hai bản
    // sẽ đảo thứ tự những phần tử cùng hàng và làm phép ghép tuần tự báo "THIẾU" oan.

    return {
      index,
      label,
      text: text.slice(0, 240),
      nodeId: (el.closest('[data-n]')?.getAttribute('data-n') ?? null) as string | null,
      top: r3(top),
      height: r3(sr.height),
      width: r3(sr.width),
      paddingTop: parseFloat(scs.paddingTop),
      paddingBottom: parseFloat(scs.paddingBottom),
      paddingLeft: parseFloat(scs.paddingLeft),
      background: isTransparent(scs.backgroundColor) ? null : rgbOf(scs.backgroundColor),
      items: items.slice(0, 250),
    };
  }

  /** Cho CSS animation/transition về trạng thái cuối trước khi đo. */
  function finishAnimations(): number {
    let n = 0;
    try {
      for (const a of doc.getAnimations() as A[]) {
        try {
          a.finish();
          n += 1;
        } catch {
          /* animation vô hạn không finish được */
        }
      }
    } catch {
      /* trình duyệt cũ */
    }
    return n;
  }

  w.__mmClone = {
    version: 1,
    tokenTables,
    extract,
    merge,
    listSections,
    scrollToSection,
    measureSection,
    finishAnimations,
  };
}
