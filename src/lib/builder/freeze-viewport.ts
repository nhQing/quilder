/**
 * "Toàn trang" trên canvas: khung cao bằng NỘI DUNG, nhưng chiều cao màn vẫn là của thiết bị.
 *
 * Trong iframe, `100vh` = chiều cao iframe. Cho iframe cao bằng cả trang (~13.000px) thì
 * hero `min-height: 100dvh` cũng cao 13.000px, trang dài thêm, và đo lại thì dài nữa. Nên
 * trước khi đo, mọi `vh/svh/dvh/lvh` trong khung được ĐỔI SANG PX theo chiều cao thiết bị:
 * hero cao đúng như trên máy thật, và chiều cao trang không còn phụ thuộc chiều cao khung.
 *
 * Chỉ đụng tới bản trong iframe của canvas — CSS của site không đổi gì.
 *
 * Giới hạn đã biết: media query theo chiều cao (`@media (min-height: …)`) vẫn đọc chiều
 * cao khung; hiệu ứng theo cuộn (parallax, khối dính) đứng yên vì khung không còn cuộn.
 */

const VH = /(-?(?:\d+\.?\d*|\.\d+))(?:s|d|l)?vh\b/g;

/** Đổi mọi `N(s|d|l)vh` trong một giá trị CSS sang px. Thuần — để test. */
export function rewriteViewportUnits(value: string, viewportHeight: number): string {
  return value.replace(VH, (_, n: string) => `${+((Number(n) * viewportHeight) / 100).toFixed(3)}px`);
}

const hasVh = (v: string) => {
  VH.lastIndex = 0;
  return VH.test(v);
};

function rewriteStyle(style: CSSStyleDeclaration, vh: number) {
  for (let i = 0; i < style.length; i += 1) {
    const prop = style[i]!;
    const value = style.getPropertyValue(prop);
    if (hasVh(value)) style.setProperty(prop, rewriteViewportUnits(value, vh), style.getPropertyPriority(prop));
  }
}

function walk(rules: CSSRuleList, vh: number) {
  for (const rule of Array.from(rules)) {
    const r = rule as CSSRule & { style?: CSSStyleDeclaration; cssRules?: CSSRuleList };
    if (r.style) rewriteStyle(r.style, vh);
    if (r.cssRules) walk(r.cssRules, vh);
  }
}

/**
 * Đóng băng đơn vị chiều cao màn trong một document (stylesheet + `style=""`).
 * Gọi lại nhiều lần cũng được: lần sau không còn `vh` nào để đổi.
 */
export function freezeViewportUnits(doc: Document, viewportHeight: number): void {
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // Stylesheet khác nguồn (font) — không đọc được, và không chứa layout.
    }
    walk(rules, viewportHeight);
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[style*="vh"]'))) {
    rewriteStyle(el.style, viewportHeight);
  }
}
