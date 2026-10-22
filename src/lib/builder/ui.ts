/**
 * Công thức class của design system "Quilder UI" cho phần tử KHÔNG phải nút.
 *
 * Nút ở `btn.ts`; component dựng sẵn ở `components/builder/ui/`. File này cho chỗ cần
 * viết markup tay nhưng phải ra cùng một hình: ô nhập, thẻ, lớp nổi, chip trạng thái.
 * Sửa một công thức ở đây là sửa mọi nơi dùng nó — đừng chép chuỗi class ra chỗ khác.
 */

/** Vòng focus bàn phím: viền 2px liền màu accent, cách control 2px. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent';

export const ui = {
  /** Ô nhập ở dashboard và dialog (44px). */
  field:
    'h-control-lg w-full min-w-0 rounded-md border border-shell-line-strong bg-shell-panel px-3.5 text-ui text-shell-ink placeholder:text-shell-muted hover:border-shell-muted focus:border-shell-accent focus:outline-none focus:ring-3 focus:ring-shell-accent-soft disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-shell-danger',
  /** Ô nhập trong thanh công cụ (36px). */
  fieldMd:
    'h-control-md w-full min-w-0 rounded border border-shell-line-strong bg-shell-panel px-3 text-small text-shell-ink placeholder:text-shell-muted hover:border-shell-muted focus:border-shell-accent focus:outline-none focus:ring-3 focus:ring-shell-accent-soft disabled:cursor-not-allowed disabled:opacity-40',
  /** Ô nhập trong panel dày đặc của editor (28px). */
  fieldSm:
    'h-control-sm w-full min-w-0 rounded-sm border border-shell-line-strong bg-shell-panel px-2 text-small text-shell-ink placeholder:text-shell-muted hover:border-shell-muted focus:border-shell-accent focus:outline-none focus:ring-2 focus:ring-shell-accent-soft disabled:cursor-not-allowed disabled:opacity-40',
  /** Ô nhiều dòng; ghép với `field`/`fieldMd` rồi bỏ chiều cao cố định. */
  textarea: 'h-auto min-h-22 py-2.5 leading-relaxed',
  label: 'text-mini font-semibold text-shell-ink',
  hint: 'text-mini text-shell-muted',
  error: 'text-mini font-medium text-shell-danger',

  /** Thẻ và panel nổi trên `shell-bg`. */
  card: 'rounded-lg bg-shell-panel text-shell-ink shadow-shell-card',
  /** Thẻ cả khối bấm được: hover nhấc 2px và đậm bóng. */
  cardHover:
    'transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-shell-card-hover motion-reduce:hover:translate-y-0',
  /** Panel lớn của vỏ: thanh menu, cây thư mục, Inspector. */
  panel: 'rounded-xl bg-shell-panel text-shell-ink shadow-shell-card',
  /** Ô lồng bên trong một panel — gom nhóm bằng nền, không chồng bóng. */
  inset: 'rounded-md bg-shell-raised',

  /** Menu và popover bật lên. */
  pop: 'rounded-lg border border-shell-line bg-shell-panel text-shell-ink shadow-shell-pop',
  /** Mục trong menu bật lên. */
  menuItem:
    'flex min-h-control-md w-full items-center gap-2.5 rounded px-2.5 text-left text-ui font-medium text-shell-ink hover:bg-shell-raised disabled:cursor-not-allowed disabled:opacity-40',
  /** `<dialog>` mở bằng `showModal()`: khung, bóng, lớp phủ. Padding đặt ở nội dung. */
  dialog:
    'rounded-lg border-0 bg-shell-panel p-0 text-shell-ink shadow-shell-pop backdrop:bg-shell-backdrop',

  /**
   * Bảng: khung thẻ có cuộn ngang RIÊNG. `relative` là bắt buộc — nhãn `sr-only` trong
   * ô là `position: absolute`, thiếu nó thì chúng thoát khỏi vùng cắt và kéo cả trang
   * tràn ngang ở bề rộng điện thoại.
   */
  tableWrap: 'relative overflow-x-auto rounded-lg bg-shell-panel shadow-shell-card',
  table: 'w-full border-collapse text-small tabular-nums',
  th: 'whitespace-nowrap border-b border-shell-line px-4 py-3.5 text-left text-micro font-semibold uppercase tracking-[0.08em] text-shell-muted first:pl-5.5 last:pr-5.5',
  td: 'border-b border-shell-line px-4 py-3 align-middle text-shell-ink first:pl-5.5 last:pr-5.5',
  /** Hàng bảng: hover lên `shell-raised`; hàng cuối bỏ vạch dưới bằng `[&:last-child>td]:border-b-0`. */
  tr: 'hover:bg-shell-raised [&:last-child>td]:border-b-0',

  /** Chip trạng thái: luôn có chữ, màu chỉ đi kèm. */
  chip: 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-mini font-semibold',
  tone: {
    neutral: 'bg-shell-raised text-shell-muted ring-1 ring-inset ring-shell-line',
    accent: 'bg-shell-accent-soft text-shell-accent',
    ok: 'bg-shell-ok-soft text-shell-ok',
    warn: 'bg-shell-warn-soft text-shell-warn',
    danger: 'bg-shell-danger-soft text-shell-danger',
  },

  /** Nhãn nhóm viết hoa (NỘI DUNG, THƯ MỤC). */
  eyebrow: 'text-micro font-semibold uppercase tracking-[0.08em] text-shell-muted',
} as const;

export type Tone = keyof typeof ui.tone;

/** Ô chữ cái đầu của thẻ, xoay vòng theo thứ tự trong danh sách. */
export const TINTS = [
  'bg-tint-blue text-tint-blue-ink',
  'bg-tint-teal text-tint-teal-ink',
  'bg-tint-amber text-tint-amber-ink',
  'bg-tint-violet text-tint-violet-ink',
  'bg-tint-rose text-tint-rose-ink',
] as const;

export function tintAt(index: number): string {
  return TINTS[((index % TINTS.length) + TINTS.length) % TINTS.length] ?? TINTS[0];
}
