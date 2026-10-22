'use client';

/**
 * Ô soạn thân bài `html`, dựng trên CKEditor 5 (bản tự host, npm).
 *
 * ## Giấy phép
 *
 * CKEditor 5 là giấy phép kép: **GPL 2+** hoặc thương mại. Bản tự host qua npm dùng
 * nhánh GPL, khai bằng `licenseKey: 'GPL'`. Không khai thì ô soạn hiện dòng chữ
 * "Powered by CKEditor" ở góc. Repo này không nhập `ckeditor5-premium-features` —
 * mọi thứ dưới đây là plugin mã nguồn mở.
 *
 * ## Vì sao file này KHÔNG được import trực tiếp
 *
 * CKEditor chạm `window` và `document` ở tầng module, nên nó vỡ ở lượt render server.
 * `ArticleField.tsx` nạp file này qua `next/dynamic` với `ssr: false`. Import thẳng
 * từ một component khác là một lỗi build chỉ lộ ra ở `pnpm build`, không ở `dev`.
 *
 * ## Điều quan trọng nhất trong file: bộ lọc của ô soạn KHÁC bộ lọc lúc lưu
 *
 * CKEditor tự bỏ mọi thẻ mà không plugin nào đang nạp hiểu được — im lặng, ngay lúc
 * `setData`. Nên nếu ô soạn không nạp `Table`, một bài đã có bảng trong database sẽ
 * MẤT bảng ngay lần mở ra sửa đầu tiên, dù `html-sanitize.ts` cho phép `<table>`.
 * Hai danh sách trắng phải khớp nhau, và `GeneralHtmlSupport` là chỗ khai phần mà
 * plugin không phủ (`<u>`, `<s>`, `<mark>` gõ tay, `<iframe>` của bài cũ).
 *
 * Hướng sai an toàn ở đây là ô soạn RỘNG hơn phép làm sạch, không hẹp hơn: rộng hơn
 * thì tác giả thấy thẻ bị gỡ trong danh sách `dropped` lúc lưu; hẹp hơn thì nội dung
 * biến mất trước khi ai kịp thấy gì.
 */

import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  Alignment,
  AutoLink,
  Autoformat,
  BlockQuote,
  Bold,
  ClassicEditor,
  Essentials,
  FontBackgroundColor,
  FontColor,
  GeneralHtmlSupport,
  Heading,
  Highlight,
  HorizontalLine,
  Image,
  ImageCaption,
  ImageInsertViaUrl,
  ImageResize,
  ImageStyle,
  ImageToolbar,
  ImageUpload,
  Indent,
  Italic,
  Link,
  List,
  ListProperties,
  MediaEmbed,
  Paragraph,
  PasteFromOffice,
  RemoveFormat,
  SourceEditing,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableCaption,
  TableCellProperties,
  TableColumnResize,
  TableProperties,
  TableToolbar,
  Underline,
  type EditorConfig,
  type Editor,
  type FileLoader,
  type UploadResponse,
} from 'ckeditor5';
import { useMemo } from 'react';

import 'ckeditor5/ckeditor5.css';

import { articlePalette } from './article-palette';

/* ── Tải ảnh lên: đi qua kho dữ liệu, không nhúng base64 ─────────────── */

/**
 * Adapter tải ảnh của CKEditor → `POST /api/assets`.
 *
 * ## Vì sao BẮT BUỘC có adapter, không phải một tiện ích thêm
 *
 * Không có adapter, CKEditor vẫn nhận ảnh dán vào — nó nhúng thành
 * `data:image/png;base64,…` ngay trong HTML. Ba thứ vỡ theo: `html-sanitize.ts` loại
 * scheme `data:` nên ảnh biến mất lúc lưu; một ảnh 2MB thành ~2.7MB chữ trong JSONB,
 * và `MAX_HTML_BYTES` cắt bài ở ảnh thứ nhất; và ảnh không vào kho nên không có
 * `blurhash`, không có srcset, không xoá được.
 *
 * Đi qua `/api/assets` thì ảnh dán vào bài nằm cùng một kho với ảnh chọn bằng tay,
 * cùng `sniff()` đọc kiểu thật từ byte đầu, cùng khoá nội dung sha256.
 */
class AssetUploadAdapter {
  private ctrl: AbortController | null = null;

  constructor(private readonly loader: FileLoader) {}

  async upload(): Promise<UploadResponse> {
    const file = await this.loader.file;
    if (!file) throw new Error('Không đọc được tệp');

    const form = new FormData();
    form.append('file', file);

    this.ctrl = new AbortController();
    const res = await fetch('/api/assets', {
      method: 'POST',
      body: form,
      signal: this.ctrl.signal,
    });

    const body: unknown = await res.json().catch(() => null);
    const asset = (body as { asset?: { url?: string } } | null)?.asset;
    if (!res.ok || typeof asset?.url !== 'string') {
      // Câu lỗi của API đi thẳng ra ô soạn: nó nói đúng lý do ("Tối đa 10 MB",
      // "Định dạng không nhận"), còn một câu chung chung buộc người dùng đoán.
      const msg = (body as { error?: string } | null)?.error;
      throw new Error(msg ?? 'Tải ảnh lên thất bại');
    }

    // `default` là khoá mà CKEditor đọc để đặt vào `src`. Không có srcset ở đây:
    // ảnh trong thân bài dùng URL gốc, và `<img srcset>` do kho phát ra thì cần
    // biết các bậc kích thước — một việc của renderer, không của ô soạn.
    return { default: asset.url };
  }

  abort(): void {
    this.ctrl?.abort();
  }
}

/**
 * Cắm adapter vào editor. Một hàm là một plugin hợp lệ của CKEditor.
 *
 * `FileRepository` không có kiểu công khai trong bundle `ckeditor5`, nên chỗ này ép
 * kiểu. Ép ở ĐÚNG một dòng, không mở `any` cho cả file.
 */
function AssetUpload(editor: Editor): void {
  const repo = editor.plugins.get('FileRepository') as unknown as {
    createUploadAdapter: (loader: FileLoader) => AssetUploadAdapter;
  };
  repo.createUploadAdapter = (loader) => new AssetUploadAdapter(loader);
}

/* ── Cấu hình ─────────────────────────────────────────────────────────── */

/**
 * Bậc tiêu đề. `h1` CÓ trong danh sách.
 *
 * Trang chi tiết đã render `h1` là tiêu đề bài, nên một `h1` thứ hai trong thân bài
 * là lỗi SEO không có triệu chứng nhìn thấy được. Nhưng người dùng đã yêu cầu đủ
 * `h1`–`h6`, và `html-sanitize.ts` nhận chúng — nên chặn ở ô soạn là bày một nút
 * không làm gì. `ArticleField` cảnh báo khi bài có `h1`; nó không ngăn.
 */
const HEADINGS = [
  { model: 'paragraph' as const, title: 'Đoạn văn', class: 'ck-heading_paragraph' },
  { model: 'heading1' as const, view: 'h1', title: 'Tiêu đề 1', class: 'ck-heading_heading1' },
  { model: 'heading2' as const, view: 'h2', title: 'Tiêu đề 2', class: 'ck-heading_heading2' },
  { model: 'heading3' as const, view: 'h3', title: 'Tiêu đề 3', class: 'ck-heading_heading3' },
  { model: 'heading4' as const, view: 'h4', title: 'Tiêu đề 4', class: 'ck-heading_heading4' },
  { model: 'heading5' as const, view: 'h5', title: 'Tiêu đề 5', class: 'ck-heading_heading5' },
  { model: 'heading6' as const, view: 'h6', title: 'Tiêu đề 6', class: 'ck-heading_heading6' },
];

const PLUGINS = [
  Essentials, Paragraph, Heading, Autoformat, PasteFromOffice,
  Bold, Italic, Underline, Strikethrough, Subscript, Superscript, RemoveFormat,
  Highlight, FontColor, FontBackgroundColor, Alignment,
  Link, AutoLink, List, ListProperties, Indent, BlockQuote, HorizontalLine,
  Table, TableToolbar, TableProperties, TableCellProperties, TableColumnResize, TableCaption,
  Image, ImageToolbar, ImageCaption, ImageStyle, ImageResize, ImageUpload, ImageInsertViaUrl,
  MediaEmbed, SourceEditing, GeneralHtmlSupport,
  AssetUpload,
];

const TOOLBAR = [
  'undo', 'redo',
  '|', 'heading',
  '|', 'bold', 'italic', 'underline', 'strikethrough',
  '|', 'fontColor', 'fontBackgroundColor', 'highlight',
  '|', 'alignment', 'bulletedList', 'numberedList', 'outdent', 'indent',
  '|', 'link', 'blockQuote', 'insertTable', 'mediaEmbed', 'horizontalLine',
  '|', 'uploadImage', 'insertImageViaUrl',
  '|', 'subscript', 'superscript', 'removeFormat',
  '|', 'sourceEditing',
];

export interface ArticleEditorProps {
  value: string;
  onChange: (html: string) => void;
  /** Đọc-chỉ: dùng cho bài đã đăng, nơi sửa phải đi qua nút "Gỡ" trước. */
  disabled?: boolean;
}

export default function ArticleEditor({ value, onChange, disabled }: ArticleEditorProps) {
  const palette = useMemo(articlePalette, []);

  const config = useMemo<EditorConfig>(() => {
    const colors = palette.map((p) => ({ color: p.color, label: p.label }));

    return {
      // Bản tự host qua npm chạy dưới nhánh GPL của giấy phép kép. Xem đầu file.
      licenseKey: 'GPL',
      plugins: PLUGINS,
      toolbar: { items: TOOLBAR, shouldNotGroupWhenFull: false },
      heading: { options: HEADINGS },

      /*
       * Bảng màu: CHỈ token của site, và không có bánh xe màu.
       *
       * `colorPicker: false` là phần quan trọng — để `true` (mặc định) thì nút bảng
       * màu vẫn mở ra một bánh xe 16 triệu giá trị, và cả phép giới hạn này thành
       * trang trí. Xem `article-palette.ts` cho lý do đầy đủ.
       */
      fontColor: { colors, columns: 4, colorPicker: false },
      fontBackgroundColor: { colors, columns: 4, colorPicker: false },

      /*
       * `previewsInData: true` là điều kiện để khối nhúng ra `<iframe>` trong HTML.
       *
       * Mặc định CKEditor lưu `<oembed url="…">` — một thẻ không có nghĩa với trình
       * duyệt, và `html-sanitize.ts` gỡ nó (không có trong `TAGS`). Tức video biến
       * mất lúc lưu. Bật cờ này thì dữ liệu mang chính `<iframe>`, và host của nó
       * phải có trong bảng `EmbedOrigin` để đi qua `allowedIframeHostnames`.
       */
      mediaEmbed: { previewsInData: true },

      table: {
        contentToolbar: [
          'tableColumn', 'tableRow', 'mergeTableCells',
          'tableProperties', 'tableCellProperties', 'toggleTableCaption',
        ],
      },
      image: {
        toolbar: [
          'imageStyle:inline', 'imageStyle:alignLeft', 'imageStyle:alignCenter',
          'imageStyle:alignRight', '|', 'toggleImageCaption', 'imageTextAlternative',
        ],
      },
      list: { properties: { styles: false, startIndex: true, reversed: false } },
      link: {
        /*
         * Mọi link ra ngoài mở tab mới VÀ mang `rel`.
         *
         * `html-sanitize.ts` cũng ép `rel` cho mọi `target="_blank"` — hai lớp, có
         * chủ đích: lớp này để tác giả THẤY đúng thứ sẽ được lưu, lớp kia để một
         * đường ghi khác (MCP, import) không lọt.
         */
        addTargetToExternalLinks: true,
        defaultProtocol: 'https://',
      },

      /*
       * `GeneralHtmlSupport`: khai phần mà plugin không phủ.
       *
       * Không có khối này, mở một bài đã có `<mark>` hay `<iframe>` trần (bài import,
       * bài gõ ở chế độ HTML) là MẤT chúng ngay lúc `setData` — CKEditor bỏ mọi thẻ
       * không plugin nào hiểu, im lặng, trước khi người dùng thấy gì.
       *
       * Danh sách này phải là TẬP CON của `TAGS` trong `html-sanitize.ts`. Rộng hơn
       * chỉ nghĩa là tác giả gõ được một thẻ rồi thấy nó trong danh sách "đã gỡ" lúc
       * lưu; hẹp hơn thì nội dung mất trước khi tới phép làm sạch.
       */
      htmlSupport: {
        allow: [
          { name: /^(?:u|s|mark|sub|sup|code|span|div)$/, attributes: ['class'], styles: true },
          { name: 'iframe', attributes: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'title', 'loading'] },
          { name: /^(?:h[1-6]|p|ul|ol|li|blockquote|figure|figcaption)$/, attributes: ['class'], styles: true },
          { name: /^(?:table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col)$/, attributes: ['class', 'colspan', 'rowspan', 'scope', 'span'], styles: true },
        ],
        /*
         * Chặn ở ô soạn thứ mà `html-sanitize.ts` chặn lúc lưu.
         *
         * Không phải một tầng bảo mật — người dùng vẫn có thể POST thẳng vào API, và
         * đó là việc của phép làm sạch. Nó là một tầng TRUNG THỰC: không có nó, chế
         * độ sửa HTML nhận `<script>` vào ô soạn, hiện ra như thật, rồi biến mất lúc
         * lưu — và người dùng kết luận "builder ăn mất code của tôi".
         */
        disallow: [
          { name: /^(?:script|style|link|meta|base|object|embed|form|input|button|textarea|select)$/ },
          { attributes: /^on/i },
        ],
      },
    };
  }, [palette]);

  return (
    <CKEditor
      editor={ClassicEditor}
      config={config}
      disabled={disabled}
      data={value}
      /*
       * `onChange` bắn ở MỖI ký tự, và `editor.getData()` chạy cả bộ chuyển đổi
       * model→view mỗi lần. Đo trên một bài ~2000 chữ: khoảng 1–2ms, nên không cần
       * debounce ở đây — nhưng chỗ nhận (`EntryForm`) đặt state React, và state đó
       * chảy xuống cả cột xem trước. Debounce nếu có thì thuộc về `ArticleField`.
       */
      onChange={(_evt, editor) => onChange(editor.getData())}
    />
  );
}
