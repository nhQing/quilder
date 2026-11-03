/**
 * Registry composite — schema tham số, và mặc định của chúng.
 *
 * ## Vì sao tách khỏi component
 *
 * Schema được ba nơi đọc: renderer (validate params từ JSONB), validator của op
 * (chặn params sai trước khi ghi), và catalog cho AI. Nếu nó sống trong file
 * component thì mọi nơi đó phải import một client component — kéo React vào
 * validator ở server và vào MCP server, cả hai đều không cần.
 *
 * ## Vì sao `.catch()` trên toàn bộ object
 *
 * Params đến từ JSONB. Một hàng hỏng KHÔNG được làm section biến mất khỏi trang:
 * `parse` mà ném thì renderer đứt giữa cây node và cả trang trắng. Rơi về mặc
 * định thì section vẫn hiện, số vẫn đúng công thức, chỉ là không đúng ý người
 * biên tập — và điều đó thấy được, sửa được.
 */

import { z } from 'zod';

import { NAV_RANGES } from './nav-series';
import type { CoreCompositeKey } from '@/lib/doc/types';
import { activeProject, checkProject, projectComposite, projectComposites } from '@/lib/project/active';

/** Key composite → schema params. Khớp với union `CompositeNode.composite`. */
/* ── Form ─────────────────────────────────────────────────────────────── */

/**
 * Một ô nhập trong `Form`.
 *
 * ## Vì sao ô nhập là PARAMS, không phải node con
 *
 * README:40–44 đóng băng bộ node type 12 tháng và ghi đường ra là `Composite`.
 * Nhưng đó không phải lý do duy nhất, và cũng không phải lý do tốt nhất.
 *
 * `<label for>` ↔ `<input id>` ↔ `aria-describedby` của thông báo lỗi là MỘT hợp
 * đồng ba chiều. Tách ô nhập thành node độc lập nghĩa là người dùng xoá được cái
 * nhãn và để lại một ô nhập không tên — một lỗi a11y mà không có gì trên giao diện
 * cảnh báo. Đúng lập luận `savingsParams.title` đã dùng: thứ sinh ra `id` và thứ
 * tham chiếu `id` phải nằm cùng một chỗ.
 *
 * Tiền lệ trực tiếp: `SavingsSimulator` đã chứa nhập liệu thật (`input[type=range]`
 * và một menu kỳ hạn) trong params, và không có node type nào tên `Slider`.
 *
 * **Cái giá:** một ô nhập lẻ không có `data-n` riêng, nên không `setStyle` được
 * từng ô bằng Inspector. Style đi qua `data-part` (xem `form.css`). Nếu nhu cầu
 * style từng ô hoá ra là thật và lặp lại, ĐÓ mới là bằng chứng để mở lại quyết
 * định đóng băng — không phải bây giờ.
 */
const formField = z.object({
  /**
   * Tên trường gửi lên BE. Cùng bộ ký tự với khoá field của collection
   * (`field-def.ts`: `^[a-z][a-z0-9_]*$`) để hai chỗ không lệch quy ước.
   */
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'tên trường: a-z, 0-9, _').max(40),
  kind: z.enum(['text', 'email', 'tel', 'number', 'textarea', 'select', 'checkbox']),
  label: z.string().min(1).max(120),
  placeholder: z.string().max(120).optional(),
  required: z.boolean().default(false),
  /** Chỉ `select`. Nhãn hiện đúng bằng giá trị người dựng gõ — không dịch ở đây. */
  options: z
    .array(z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(120) }))
    .max(30)
    .optional(),
  /** Dòng gợi ý dưới ô. Vào `aria-describedby`, nên screen reader đọc được. */
  help: z.string().max(200).optional(),
  /** Giá trị `autocomplete` của HTML, ví dụ "email", "tel", "name". */
  autocomplete: z.string().max(40).optional(),
});

const FORM_DEFAULTS = {
  endpointKey: 'newsletter',
  fields: [
    {
      name: 'email',
      kind: 'email' as const,
      label: 'Email của bạn',
      required: true,
      autocomplete: 'email',
    },
  ],
  submitLabel: 'Đăng ký',
  successMessage: 'Đã nhận. Cảm ơn bạn.',
  errorMessage: 'Có lỗi xảy ra. Bạn thử lại giúp.',
};

/**
 * Schema THÔ của params Form — không `.catch`.
 *
 * Tách khỏi `formParams` để hai đường dùng hai luật khác nhau: renderer cần lành
 * (hàng JSONB hỏng không làm trắng trang), còn sidebar cần NGHIÊM — nó phải biết
 * ô nào sai để báo cạnh ô đó, thay vì để `.catch` lặng lẽ thay cả form bằng mặc định.
 */
const formObject = z
  .object({
    /**
     * KHOÁ trong `Site.globals.endpoint`, KHÔNG phải URL.
     *
     * ## Vì sao không nhận URL ở đây
     *
     * `params` là thứ content editor sửa trong Inspector và AI ghi qua `setProps`.
     * Một URL tự do ở đó nghĩa là builder vừa thành công cụ gửi dữ liệu khách tới
     * bất kỳ đâu — và nó sẽ trông y như một thay đổi nội dung bình thường trong
     * diff. Thêm nữa: URL staging khác production, và nó đổi mà không ai muốn đổi
     * nội dung trang; chôn nó vào cây node thì mười form là mười chỗ phải sửa.
     *
     * `Site.globals` được SEAL vào `Release` (xem `builder/settings.ts`), nên đổi
     * URL vẫn phải Publish — và đó là tính chất ĐÚNG cho trường này, cùng lý do
     * như số giấy phép: nơi dữ liệu khách được gửi tới không nên đổi trên site
     * đang chạy vì một cú bấm nhầm. Rollback một release cũng trả lại URL cũ.
     */
    endpointKey: z
      .string()
      // Rỗng = "chưa chọn nơi nhận" (bản sao mới của mẫu hệ thống): form hiện tắt kèm
      // lời nhắc. Phải là giá trị TƯỜNG MINH vì vắng khoá vẫn nghĩa là `newsletter`
      // — form cũ không có khoá phải chạy y như trước.
      .regex(/^([a-z][a-z0-9-]*)?$/, 'khoá endpoint là slug')
      .max(40)
      .default(FORM_DEFAULTS.endpointKey),
    fields: z
      .array(formField)
      .min(1)
      .max(12)
      .refine(
        (fs) => new Set(fs.map((f) => f.name)).size === fs.length,
        'tên trường bị lặp — BE sẽ chỉ nhận được một giá trị',
      )
      // `superRefine` chứ không `refine`: lỗi phải mang đường dẫn TỚI ĐÚNG Ô
      // (`fields.N.options`) để sidebar báo cạnh ô đó, không phải chung chung "fields".
      .superRefine((fs, ctx) => {
        fs.forEach((f, i) => {
          if (f.kind === 'select' && (f.options?.length ?? 0) === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [i, 'options'],
              message: 'field select phải có options, nếu không nó là một menu rỗng',
            });
          }
        });
      })
      .default(FORM_DEFAULTS.fields),
    submitLabel: z.string().min(1).max(80).default(FORM_DEFAULTS.submitLabel),
    successMessage: z.string().min(1).max(300).default(FORM_DEFAULTS.successMessage),
    errorMessage: z.string().min(1).max(300).default(FORM_DEFAULTS.errorMessage),
    /** `<form aria-label>` — cần khi form không có tiêu đề nhìn thấy được. */
    a11yLabel: z.string().max(120).optional(),
    /**
     * htmlId của một panel modal để chuyển sang khi gửi THÀNH CÔNG (vd form danh sách
     * chờ trong modal s8 của trang chủ → panel "đã đăng ký"). Form phát sự kiện
     * `modal:show` nổi bọt lên; effect `modal` bao ngoài bắt và đổi panel. Không đặt
     * thì chỉ hiện `successMessage` như cũ.
     */
    successPanel: z.string().regex(/^[A-Za-z][\w-]*$/).max(60).optional(),
    /**
     * Báo kết quả gửi bằng cách nào: `inline` (dòng chữ dưới nút), `dialog` (hộp thoại
     * của chính form, nội dung ở slot `success`/`error`), `panel` (chuyển panel của modal
     * bao ngoài qua `successPanel`). KHÔNG có default: vắng thì suy từ `successPanel`
     * (xem `resolveAfterSubmit`) để form cũ chạy y như cũ mà không cần migrate dữ liệu.
     */
    afterSubmit: z.enum(['inline', 'dialog', 'panel']).optional(),
  });

const formParams = formObject.catch(FORM_DEFAULTS);

export type FormParams = z.infer<typeof formParams>;
export type FormFieldDef = z.infer<typeof formField>;

export type AfterSubmit = 'inline' | 'dialog' | 'panel';

/** Cách báo kết quả thật của một form — `afterSubmit` nếu có, không thì suy từ `successPanel`. */
export function resolveAfterSubmit(p: { afterSubmit?: string; successPanel?: string }): AfterSubmit {
  if (p.afterSubmit === 'inline' || p.afterSubmit === 'dialog' || p.afterSubmit === 'panel') {
    return p.afterSubmit;
  }
  return p.successPanel ? 'panel' : 'inline';
}

export type FormParamsIssue = { path: string; message: string };

/**
 * Parse NGHIÊM params Form: không rơi về mặc định, trả từng lỗi kèm đường dẫn.
 *
 * Dùng cho sidebar — nó không bao giờ ghi params không qua được hàm này, và hiện lỗi
 * cạnh ô sai. Renderer vẫn dùng `parseCompositeParams` (lành).
 */
export function parseFormParamsStrict(
  raw: unknown,
): { ok: true; params: FormParams } | { ok: false; issues: FormParamsIssue[] } {
  const r = formObject.safeParse(raw ?? {});
  if (r.success) return { ok: true, params: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: issueMessage(i) })),
  };
}

/**
 * Câu lỗi người dựng trang đọc được. Lời mặc định của zod là tiếng Anh kỹ thuật
 * ("String must contain at least 1 character(s)") và hiện ngay cạnh ô nhập của sidebar.
 */
function issueMessage(i: z.ZodIssue): string {
  if (i.code === z.ZodIssueCode.too_small && i.type === 'string') {
    return Number(i.minimum) <= 1 ? 'Không được để trống.' : `Cần ít nhất ${i.minimum} ký tự.`;
  }
  if (i.code === z.ZodIssueCode.too_big && i.type === 'string') return `Tối đa ${i.maximum} ký tự.`;
  if (i.code === z.ZodIssueCode.too_small && i.type === 'array') return `Cần ít nhất ${i.minimum} mục.`;
  if (i.code === z.ZodIssueCode.too_big && i.type === 'array') return `Tối đa ${i.maximum} mục.`;
  return i.message;
}

/* ── Accordion ────────────────────────────────────────────────────────── */

const ACCORDION_DEFAULTS = { single: true, openFirst: false };

/**
 * Params của `Accordion`. Hai cờ, và cả hai là hành vi TRÌNH DUYỆT lo.
 *
 * `single` phát ra `<details name>` — luật "một mục mở" ở tầng HTML, không JS.
 * `openFirst` phát `open` trên mục đầu, cũng là HTML thuần.
 */
const accordionParams = z
  .object({
    /**
     * Một mục mở tại một thời điểm.
     *
     * Mặc định `true`: FAQ tám mục mở hết cùng lúc là một bức tường chữ, và đó
     * chính là trạng thái mà bản builder đang mắc phải trước 07/09/2026.
     */
    single: z.boolean().default(ACCORDION_DEFAULTS.single),
    /**
     * Mở sẵn mục đầu.
     *
     * Mặc định `false`. Mở sẵn một mục làm chiều cao khối nhảy khi trang tải, và
     * với FAQ thì danh sách câu hỏi đọc được hết mới là thứ có ích.
     */
    openFirst: z.boolean().default(ACCORDION_DEFAULTS.openFirst),
  })
  .catch(ACCORDION_DEFAULTS);

export type AccordionParams = z.infer<typeof accordionParams>;

/* ── NavChart ─────────────────────────────────────────────────────────── */

const NAV_DEFAULTS = { endpointKey: 'nav', defaultRange: '1y' as const };

/**
 * Params của `NavChart`.
 *
 * Chỉ hai trường, và cả hai là CẤU HÌNH — không có số nào ở đây. Số NAV đến từ
 * backend qua `endpointKey`; hard-code chúng vào params nghĩa là mỗi lần cập nhật
 * NAV là một lần sửa nội dung trang, và một lần Publish.
 */
const navChartParams = z
  .object({
    /** KHOÁ trong `Site.globals.endpoint`, KHÔNG phải URL. Cùng luật như `Form`. */
    endpointKey: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, 'khoá endpoint là slug')
      .max(40)
      .default(NAV_DEFAULTS.endpointKey),
    /**
     * Mốc mở sẵn.
     *
     * Composite tự hạ xuống mốc có thật nếu chuỗi quá ngắn — một chuỗi 6 tháng mà
     * khai `5y` thì nút đó không được bày, và state trỏ vào một nút không tồn tại.
     */
    defaultRange: z.enum(NAV_RANGES).default(NAV_DEFAULTS.defaultRange),
  })
  .catch(NAV_DEFAULTS);

export type NavChartParams = z.infer<typeof navChartParams>;

export const COMPOSITE_PARAMS = {
  // Chưa có runtime. Khai `passthrough` thay vì bỏ trống để validator không từ
  // chối node placeholder đang có trong doc.
  Carousel: z.object({}).passthrough().catch({}),
  Form: formParams,
  Accordion: accordionParams,
  NavChart: navChartParams,
} as const satisfies Record<CompositeKey, z.ZodTypeAny>;

/** Composite của LÕI. Composite của gói dự án là chuỗi bất kỳ, kiểm qua `isKnownComposite`. */
export type CompositeKey = CoreCompositeKey;

/** Composite nào đã có runtime thật. Số còn lại render slot ra một div trơn. */
export const IMPLEMENTED: ReadonlySet<CompositeKey> = new Set<CompositeKey>([
  'Form',
  'Accordion',
  'NavChart',
]);

export const COMPOSITE_DESCRIPTIONS: Record<CompositeKey, string> = {
  Carousel:
    'Dải thẻ cuộn ngang. CHƯA CÓ runtime dạng composite — dựng nó bằng node Composite thì được một khối trống. Dùng effect "slider" trên một cây node có part viewport/track/slide (+ prev/next/pagination nếu cần). Effect "carousel" cũng còn chạy nhưng đã cũ, xem list_effects.',
  Form:
    'Form nhập liệu. Ô nhập nằm trong params.fields (name, kind text|email|tel|number|textarea|select|checkbox, label, required, options cho select, help, autocomplete) — KHÔNG phải node con, nên không setStyle được từng ô; style qua data-part. Nội dung đi qua slots: "heading" cho tiêu đề, "note" cho dòng ghi chú/điều khoản (node Text thật, dịch được). Slot "success" và "error" chỉ hiện khi afterSubmit = "dialog": chúng nằm trong hộp thoại của form (không có trong luồng trang), mở sau khi gửi xong. Tham số: endpointKey (KHOÁ trong Site.globals.endpoint, không phải URL; chuỗi rỗng = chưa chọn nơi nhận, form hiện tắt), submitLabel, successMessage, errorMessage, a11yLabel, afterSubmit ("inline" dòng chữ dưới nút | "dialog" hộp thoại | "panel" chuyển panel modal qua successPanel; vắng thì suy: có successPanel là panel, không là inline). Submit bằng fetch tới URL resolve từ globals; builder KHÔNG lưu gì, BE sở hữu dữ liệu.',
  Accordion:
    'FAQ mở/đóng, KHÔNG cần JavaScript — phát ra <details>/<summary> thật, nên mục đang đóng vẫn được Ctrl+F và crawler tìm thấy. Nội dung đi qua slots: "q-1".."q-N" cho câu hỏi, "a-1".."a-N" cho câu trả lời của mục N. Tham số: single (một mục mở tại một thời điểm, dùng thuộc tính name của HTML), openFirst. KHÔNG có effect nào đi kèm và không có hoạt ảnh chiều cao.',
  NavChart:
    'Biểu đồ NAV theo mốc 1y/3y/5y/all, vẽ bằng SVG polyline + bảng số thật (không canvas, không chart lib). Số liệu đến từ backend: params.endpointKey là KHOÁ trong Site.globals.endpoint, không phải URL, và không có số nào nằm trong params. BE trả toàn bộ chuỗi { points: [{date:"YYYY-MM-DD", nav:number}], currency } một lần; đổi mốc là lọc ở client nên không gọi mạng. Nội dung đi qua slots: "heading", "note". Tham số: endpointKey, defaultRange.',
};

/**
 * Params đã validate cho một composite.
 *
 * Key lạ trả `null`: doc có thể mang một composite từ schema tương lai, và
 * renderer phải bỏ qua nó chứ không ném.
 */
export function parseCompositeParams(key: string, raw: unknown): unknown | null {
  const schema = compositeParamsSchema(key);
  if (!schema) return null;
  return schema.parse(raw ?? {});
}

/* ── Composite lõi + composite của gói dự án ─────────────────────────── */

// Kiểm hợp đồng gói ngay khi registry nạp: composite của gói trùng tên composite lõi là
// NÉM lúc khởi động, không lặng lẽ đè. Ở đây chứ không ở `active.ts` để tránh import vòng.
checkProject(activeProject, Object.keys(COMPOSITE_PARAMS));

/** Schema params của composite — lõi trước, rồi gói dự án. `undefined` = khoá lạ. */
export function compositeParamsSchema(key: string): z.ZodTypeAny | undefined {
  // `Object.hasOwn`, không tra thẳng: `COMPOSITE_PARAMS['toString']` là hàm của Object.prototype.
  if (Object.hasOwn(COMPOSITE_PARAMS, key)) return (COMPOSITE_PARAMS as Record<string, z.ZodTypeAny>)[key];
  return projectComposite(key)?.params;
}

/** Khoá composite có trong lõi hoặc trong gói dự án đang chạy. */
export function isKnownComposite(key: string): boolean {
  return compositeParamsSchema(key) !== undefined;
}

/** Danh mục cho AI (`get_node_schema`): mọi composite, kèm mô tả và đã có runtime chưa. */
export function compositeCatalog(): { key: string; about: string; implemented: boolean }[] {
  return [
    ...Object.entries(COMPOSITE_DESCRIPTIONS).map(([key, about]) => ({
      key,
      about,
      implemented: IMPLEMENTED.has(key as CompositeKey),
    })),
    ...projectComposites().map((c) => ({ key: c.key, about: c.description, implemented: true })),
  ];
}

/* ── Phần con có thể style (style.parts) ─────────────────────────────── */

/**
 * Phần con của composite mà `style.parts` / `setStyle { part }` nhắm tới.
 *
 * Phần con là phần tử composite tự render (ô nhập, nút gửi…), không có `data-n` riêng nên
 * không `setStyle` trực tiếp được; compiler dịch khoá → selector, scope dưới node.
 * `selector` có thể là danh sách phân cách dấu phẩy — compiler tách và scope từng cái.
 * Composite của gói dự án chưa khai phần con nào (rỗng).
 */
export const STYLE_PARTS: Record<string, Record<string, { label: string; selector: string }>> = {
  Form: {
    field: { label: 'Ô', selector: '.mm-form__row' },
    label: { label: 'Nhãn', selector: '.mm-form__label' },
    input: { label: 'Ô nhập', selector: '.mm-form__input, .mm-form__checkbox' },
    help: { label: 'Trợ giúp', selector: '.mm-form__help' },
    submit: { label: 'Nút gửi', selector: '.mm-form__submit' },
    status: { label: 'Thông báo', selector: '.mm-form__status' },
    dialog: { label: 'Hộp thoại', selector: '.mm-form__dialog' },
  },
};

/** Phần con style được của một node; node không phải Composite (hay composite không có phần) → []. */
export function stylePartsOf(node: { type: string; composite?: string }): { key: string; label: string }[] {
  if (node.type !== 'Composite' || !node.composite) return [];
  if (!Object.hasOwn(STYLE_PARTS, node.composite)) return [];
  return Object.entries(STYLE_PARTS[node.composite]!).map(([key, p]) => ({ key, label: p.label }));
}
