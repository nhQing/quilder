/**
 * Ba phép đo bố cục.
 *
 * ## Vì sao thứ này tồn tại
 *
 * Ngày 17/08/2026 trang chủ có một dải đen 240px ở khổ hẹp. Nó không lộ ra ở bất
 * cứ cổng kiểm nào: HTML hợp lệ, CSS hợp lệ, mọi unit test xanh, `pnpm verify`
 * xanh. Tôi tìm ra bằng cách mở trang ở từng khổ rồi đo tay.
 *
 * Ba hàm dưới đây là đúng ba phép đo đó. Mẫu là Wix Responsive Checker — công cụ
 * tốt nhất trong sáu công cụ đã đối chiếu (docs/BENCHMARK.md §1.6).
 *
 * ## Vì sao nhận DỮ LIỆU chứ không nhận `Document`
 *
 * Bản đầu nhận `Document` và chạy trong `page.evaluate`. Hai vấn đề, và cả hai đều
 * là thật:
 *
 *  - Đưa hàm vào trình duyệt phải serialize nó bằng `Function.toString()`, mà hàm
 *    ở đây gọi lẫn nhau và gọi một helper riêng của module — nên chuỗi ghép tay sẽ
 *    trôi khỏi mã thật ngay lần sửa đầu tiên.
 *  - Test phải dựng một DOM giả, vì jsdom trả `getBoundingClientRect()` toàn số 0
 *    và sẽ xanh mà không kiểm được gì.
 *
 * Tách làm hai: trình duyệt chỉ ĐO (một hàm bốn dòng, không có logic để sai), Node
 * PHÂN TÍCH. Hàm ở đây thành thuần dữ liệu — test thẳng bằng object, không cần DOM
 * giả lẫn jsdom.
 *
 * ## Vì sao KHÔNG tự sửa
 *
 * Wix có auto-fix từng lỗi. Đó đúng chỗ nên dừng: sửa tự động một lỗi bố cục là
 * đoán ý người thiết kế. Một node tràn ngang có thể là lỗi, cũng có thể là một dải
 * cố ý chạy hết màn hình.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface MeasuredNode {
  nodeId: string;
  /** Node mang `data-n` gần nhất phía trên. `null` nếu đây là gốc. */
  parentId: string | null;
  rect: Rect;
  /** `getComputedStyle().position` — quyết định node có bị bỏ qua không. */
  position: string;
  /**
   * Node này nằm BÊN TRONG một `Composite` (`data-composite` ở đâu đó phía trên).
   *
   * Composite tự quản bố cục bên trong nó — ChapterParallax ghim và xếp chồng các
   * panel khi cuộn, PanelStack thì trượt chúng qua nhau. Bộ soát chung không có
   * cách nào biết đâu là chồng có chủ đích, nên nó KHÔNG đoán thay: nó bỏ qua ruột
   * composite và soát chính composite như một khối.
   *
   * Đo trên trang thật ngày 19/08/2026, qua ba lần chỉnh: **93 → 34 → 12** báo cáo.
   * Hai bước đầu là sửa lỗi CỦA BỘ SOÁT (quên bỏ qua `fixed`, và coi mọi con của
   * gốc là dải tràn ngang). Bước cuối là thôi đoán thay tác giả composite.
   *
   * 12 còn lại KHÔNG phải nhiễu đã được dọn sạch — chúng là những thứ cần người
   * nhìn. Xem ghi chú cuối `scripts/check-layout.ts`.
   */
  insideComposite: boolean;
}

export interface LayoutSnapshot {
  viewport: number;
  nodes: MeasuredNode[];
}

export interface LayoutIssue {
  kind: 'tran-ngang' | 'chong-lap' | 'khe-ho-mep';
  /** `data-n` của node gây lỗi — mở thẳng được trong builder. */
  nodeId: string;
  detail: string;
  /** Số đo, để xếp theo mức nghiêm trọng. */
  px: number;
}

const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;

/** Node nằm ngoài luồng, chồng lên nhau là mục đích của chúng. */
const OUT_OF_FLOW = new Set(['absolute', 'fixed', 'sticky']);

/**
 * Tràn ngang: node nào rộng quá khung nhìn.
 *
 * Đo từng node thay vì chỉ `documentElement.scrollWidth`: biết TỔNG trang tràn mới
 * là một nửa câu trả lời; nửa còn lại là *cái gì* tràn, và chính nửa đó tốn nhiều
 * thời gian nhất khi tìm tay.
 *
 * Ngưỡng 1px: trình duyệt làm tròn tạo chênh lệch dưới một pixel ở hầu hết trang,
 * và báo chúng biến báo cáo thành tiếng ồn.
 */
export function findOverflow(snap: LayoutSnapshot): LayoutIssue[] {
  const out: LayoutIssue[] = [];
  for (const n of snap.nodes) {
    // Ruột composite: tác giả composite tự quản bố cục ở đó.
    if (n.insideComposite) continue;
    // `fixed` không tạo thanh cuộn ngang, nên một thanh cố định rộng hơn khung nhìn
    // không phải lỗi.
    if (n.position === 'fixed') continue;

    const over = Math.round(right(n.rect) - snap.viewport);
    if (over <= 1) continue;

    out.push({
      kind: 'tran-ngang',
      nodeId: n.nodeId,
      detail: `vượt mép phải ${over}px (khung ${snap.viewport}px)`,
      px: over,
    });
  }
  return out;
}

/**
 * Chồng lấp giữa hai node ANH EM.
 *
 * Chỉ xét anh em ruột: cha–con chồng nhau là bình thường (con nằm trong cha), và
 * hai node ở hai nhánh khác nhau chồng nhau thường là bố cục chồng có chủ đích.
 *
 * Ngưỡng 4px: viền, đổ bóng và bo góc tạo giao nhau vài pixel ở rất nhiều bố cục
 * lành mạnh.
 */
export function findOverlaps(snap: LayoutSnapshot): LayoutIssue[] {
  const byParent = new Map<string, MeasuredNode[]>();
  for (const n of snap.nodes) {
    if (!n.parentId || n.insideComposite) continue;
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }

  const out: LayoutIssue[] = [];
  for (const kids of byParent.values()) {
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i]!;
        const b = kids[j]!;
        if (OUT_OF_FLOW.has(a.position) || OUT_OF_FLOW.has(b.position)) continue;

        const x = Math.min(right(a.rect), right(b.rect)) - Math.max(a.rect.left, b.rect.left);
        const y = Math.min(bottom(a.rect), bottom(b.rect)) - Math.max(a.rect.top, b.rect.top);
        if (x <= 4 || y <= 4) continue;

        /*
         * Bỏ qua chồng TOÀN PHẦN — đó là xếp lớp, không phải va chạm.
         *
         * Đo trên trang thật ngày 19/08/2026: ChapterParallax xếp nhiều panel cùng
         * kích thước khung lên nhau để chuyển cảnh, và mỗi cặp panel sinh một báo
         * cáo. Riêng nó đã chiếm phần lớn 93 vấn đề của lần chạy đầu.
         *
         * Hình học không phân biệt được "xếp lớp có chủ đích" với "va chạm" một
         * cách chắc chắn. Nhưng có một khác biệt dùng được: xếp lớp thì một node
         * phủ gần trọn node kia; va chạm thì chỉ chèn lên một góc. Ngưỡng 90% giữ
         * lại đúng loại thứ hai.
         *
         * Đánh đổi được nói thẳng: hai panel xếp chồng NHẦM sẽ lọt. Đổi lại, báo
         * cáo còn đọc được — và một báo cáo không ai đọc thì bắt được gì cũng vô
         * nghĩa.
         */
        const areaA = a.rect.width * a.rect.height;
        const areaB = b.rect.width * b.rect.height;
        const smaller = Math.min(areaA, areaB);
        if (smaller > 0 && (x * y) / smaller >= 0.9) continue;

        out.push({
          kind: 'chong-lap',
          nodeId: a.nodeId,
          detail: `chồng lên ${b.nodeId} — ${Math.round(x)}×${Math.round(y)}px`,
          px: Math.round(Math.min(x, y)),
        });
      }
    }
  }
  return out;
}

/**
 * Khe hở LỆCH giữa mép trang và nội dung.
 *
 * Đây là phép đo đã tìm ra dải đen 240px: nội dung dừng sớm hơn mép phải, để lại
 * một dải nền trống mà không ai đặt.
 *
 * Chỉ xét con TRỰC TIẾP của gốc: một section thụt vào là bình thường, cả trang thụt
 * vào thì không.
 *
 * Chỉ báo khi LỆCH hai bên. Khe bằng nhau là căn giữa có chủ đích — báo nó là báo
 * sai, và một công cụ báo sai vài lần thì lần thứ tư không ai đọc nữa.
 */
export function findEdgeGaps(snap: LayoutSnapshot, thresholdPx = 8): LayoutIssue[] {
  const root = snap.nodes.find((n) => n.parentId === null);
  if (!root) return [];

  const out: LayoutIssue[] = [];
  for (const n of snap.nodes) {
    if (n.parentId !== root.nodeId) continue;
    if (n.insideComposite) continue;
    if (n.rect.width === 0 || n.rect.height === 0) continue;

    // Node ngoài luồng không tạo dải trống trong luồng — một header `fixed` hẹp
    // hơn khung nhìn là bình thường. `findOverflow` đã bỏ qua chúng từ đầu; ở đây
    // thì QUÊN, và nó là nguồn báo động giả đầu tiên phát hiện được khi chạy trên
    // trang thật.
    if (OUT_OF_FLOW.has(n.position)) continue;

    /*
     * Chỉ xét node CHIẾM PHẦN LỚN bề ngang.
     *
     * Phép đo này giả định con trực tiếp của gốc là các dải tràn ngang, nên "lệch
     * mép" nghĩa là một dải bị hụt. Nhưng cây thật có cả node nhỏ nằm ngay dưới
     * gốc — một link nav rộng 60px cạnh mép trái sẽ luôn "lệch" và luôn bị báo.
     *
     * Ngưỡng một nửa khung nhìn: đủ để nhận ra một dải, đủ hẹp để bỏ qua phần tử
     * lẻ.
     */
    if (n.rect.width < snap.viewport * 0.5) continue;

    const gapRight = Math.round(snap.viewport - right(n.rect));
    const gapLeft = Math.round(n.rect.left);

    if (Math.abs(gapRight - gapLeft) <= thresholdPx) continue;
    if (Math.max(gapRight, gapLeft) <= thresholdPx) continue;

    out.push({
      kind: 'khe-ho-mep',
      nodeId: n.nodeId,
      detail: `lệch mép: trái ${gapLeft}px, phải ${gapRight}px`,
      px: Math.abs(gapRight - gapLeft),
    });
  }
  return out;
}

/** Cả ba phép đo, nghiêm trọng nhất trước. */
export function checkLayout(snap: LayoutSnapshot): LayoutIssue[] {
  return [...findOverflow(snap), ...findOverlaps(snap), ...findEdgeGaps(snap)].sort(
    (a, b) => b.px - a.px,
  );
}
