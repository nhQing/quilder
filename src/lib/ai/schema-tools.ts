import { z } from 'zod';

/**
 * Hình dạng node, phát ra cho Agent đọc.
 *
 * ## Vì sao tool này phải tồn tại
 *
 * Trước nó, mô tả của `apply_ops` bảo Agent "đọc `get_node` một node tương tự"
 * để suy ra hình dạng `insertNode`. Cách đó chỉ chạy được khi ĐÃ CÓ một node
 * tương tự — trên một trang trắng thì không có gì để đọc, và Agent phải đoán rồi
 * dò bằng `dryRun`. Đo trong phiên 25/08/2026: dựng một thẻ tin cần 8 sự thật mà
 * không tool nào nói ra, và cả 8 đều phải lấy từ mã nguồn.
 *
 * Đây KHÔNG phải chuyện tiện lợi. Một Agent nối qua MCP từ máy khác không có
 * repo để đọc: mọi thứ tầng tool không nói là thứ nó sẽ đoán, và đoán sai ở đây
 * hỏng im lặng (xem `traps` bên dưới).
 *
 * ## Vì sao không sinh từ Zod
 *
 * `zodToJsonSchema(zNode)` là 7,26 MB — xem `json-schema.ts`. Union đệ quy diễn
 * đạt chính xác luật cho VALIDATOR, nhưng với model nó là hàng trăm nghìn dòng
 * nhiễu. Ở đây cần bản đọc được: field bắt buộc, một dòng giải thích, và những
 * cái bẫy. Đó là hai loại tài liệu khác nhau cho hai người đọc khác nhau.
 *
 * ## Cái gì được suy ra, cái gì viết tay
 *
 * Danh sách node type, cờ lá, danh sách composite và allowlist CSS đều IMPORT từ
 * nguồn thật, nên thêm một node type hay sửa allowlist là tool này đổi theo mà
 * không ai phải nhớ. Chỉ phần `required` và `note` là viết tay — và
 * `schema-tools.test.ts` canh cho mỗi node type trong `NODE_TYPES` có đúng một
 * mục ở đây, để một type mới không lặng lẽ thiếu tài liệu.
 */

import { compositeCatalog } from '@/lib/composites/registry';
import { BREAKPOINT_PX, type Breakpoint } from '@/lib/design/breakpoints';
import { AI_CSS_ALLOWLIST } from '@/lib/doc/ai-css-allowlist';
import { NODE_TYPES, isLeafType, type NodeType } from '@/lib/doc/types';
import { styleShape } from '@/lib/doc/style-shape';

import type { ToolDef } from './tools';

/** Field riêng của từng type, ngoài `nodeBase`. Khoá phải phủ hết `NODE_TYPES`. */
const TYPE_FIELDS: Record<NodeType, { required: Record<string, string>; note?: string }> = {
  Section: {
    required: {},
    note: 'Hộp chứa. `tag` thường là "section"; node gốc của trang dùng "main".',
  },
  Stack: {
    required: {},
    note: 'Hộp chứa một chiều. Hướng đặt ở `style.layout.flexDirection`; field `direction` chỉ là bản ghi phụ.',
  },
  Grid: {
    required: {},
    note: 'CHIA CỘT BẰNG `style.layout.gridTemplateColumns`, dạng [{kind:"fr",v:1}, ...]. Field `columns` KHÔNG được renderer đọc.',
  },
  Text: {
    required: {
      tag: '"h1".."h6" | "p" | "span" | "blockquote" — quyết định cả ngữ nghĩa lẫn cỡ chữ mặc định',
      content: 'RichText: mảng InlineNode. Chữ thường là [{ t:"text", v:"..." }]',
    },
  },
  Image: {
    required: {
      assetId: 'id trong bảng Asset, hoặc null khi chưa gán. Lấy từ list_assets',
      alt: 'Bắt buộc. Chuỗi rỗng CHỈ hợp lệ khi decorative = true',
      fit: 'Responsive: { base: "cover" | "contain" | "fill" }',
    },
    note: 'Có width/height từ bảng Asset thì renderer đi nhánh giữ chỗ, CLS = 0. `ratio` dạng { base: "16/9" }.',
  },
  Button: {
    required: {
      label: 'RichText, giống Text.content',
      action: '{ kind:"link", href } | { kind:"anchor", toNodeId } | { kind:"submit", formId } | { kind:"none" }',
      variant: '"primary" | "ghost" | "link"',
    },
  },
  Video: {
    required: {
      assetId: 'id Asset hoặc null',
      posterAssetId: 'id Asset hoặc null — ảnh hiện trước khi phát',
    },
    note: 'autoplay/loop/muted/controls là boolean tuỳ chọn. preload: "none" | "metadata" | "auto" — bỏ trống thì suy từ autoplay (auto khi tự phát, none khi không). Khai tường minh khi muốn tự phát mà không tải sẵn.',
  },
  Canvas: {
    required: {
      program: '"gradient" | "displacement"',
      uniforms: 'Record<string, TokenRef | number>',
      fallbackChildId: 'NodeId hoặc null — nội dung hiện khi không có WebGL',
    },
    note: 'CHƯA CÓ RUNTIME. Renderer hiện chỉ render nhánh fallbackChildId. Đừng dùng cho nội dung mới.',
  },
  CustomCode: {
    required: {
      mode: '"iframe". "inline" lưu được nhưng KHÔNG render, và mang js thì validator từ chối (customcode_inline_js)',
    },
    note:
      'Render thật trong iframe sandbox (origin mờ): KHÔNG chạm được DOM trang, cookie, localStorage, ' +
      'và không nhận sự kiện cuộn của trang; không form, popup, iframe con. html/css/js đều tuỳ chọn, ' +
      'mỗi field tối đa 20000 ký tự; cả ba rỗng thì không dựng iframe. js chạy dạng <script type="module"> ' +
      'nên `import` từ CDN được, nhưng CSP chỉ mở script/ảnh/font/fetch cho origin nằm trong bảng ' +
      'EmbedOrigin — origin khác bị chặn. Không có tool đọc bảng đó: hỏi người dùng origin nào đã mở. ' +
      '`height` (Len) đặt cao cố định; bỏ trống thì khối tự đo, trong khoảng 40–4000px.',
  },
  Composite: {
    required: {
      composite: 'Một trong các key ở mục `composites` bên dưới',
      params: 'Validate bằng Zod riêng của từng composite',
      slots: 'Record<string, NodeId[]>',
    },
    note: 'Cơ chế bên trong KHÔNG sửa được — chỉ sửa nội dung slot, params và style.',
  },
  Instance: {
    required: {
      componentId: 'id từ list_components',
      overrides: 'Record<localNodeId, { content?, label?, alt?, assetId?, href?, a11yLabel? }> — CHỈ nội dung, không style',
    },
    note: 'Lá trong doc: con đến từ cây component. Gắn `repeat` để lặp theo collection — khi có repeat thì `effects` PHẢI rỗng.',
  },
};

const nodeSchema: ToolDef = {
  name: 'get_node_schema',
  title: 'Hình dạng node',
  description:
    'Field bắt buộc của từng node type, hình dạng RichText, danh sách composite, ' +
    'allowlist CSS áp cho AI, và những cái bẫy hỏng-im-lặng.\n\n' +
    'Đọc tool này TRƯỚC khi dùng op insertNode lần đầu trong một phiên. Nó thay ' +
    'cho việc "đọc get_node một node tương tự" — thứ không làm được trên trang trắng.',
  input: z.object({
    type: z
      .string()
      .optional()
      .describe('Lấy một type thôi, ví dụ "Image". Bỏ trống để lấy tất cả.'),
  }).strict(),
  readOnly: true,
  async run(input: { type?: string }) {
    const wanted = input.type
      ? NODE_TYPES.filter((t) => t.toLowerCase() === input.type!.toLowerCase())
      : NODE_TYPES;

    if (input.type && !wanted.length) {
      return {
        error: `Không có node type "${input.type}".`,
        nodeTypes: NODE_TYPES,
      };
    }

    return {
      nodeBase: {
        required: {
          id: 'chuỗi duy nhất trong trang, ≤ 40 ký tự. Đặt tên gợi nhớ, ví dụ "tt-grid"',
          parentId: 'id node cha, null với node gốc',
          children: 'mảng NodeId có thứ tự. insertNode BẮT BUỘC truyền [] — con thêm bằng op riêng',
          style: 'ResponsiveStyle: { base, sm, md, lg, xl, hover, focusVisible, inView, states }. Field của từng nhóm: xem `style` bên dưới.',
          effects: 'mảng, [] khi chưa gắn gì',
        },
        optional: {
          name: 'nhãn hiện trong cây node của builder',
          tag: 'thẻ HTML, chỉ với node có ngữ nghĩa',
          part: 'hợp đồng với runtime effect/composite — phát ra data-part. 1–4 vai cách nhau bằng khoảng trắng, hoặc "entry:<khoá field>". KHÔNG dùng thay cho name',
          htmlId: 'đích của #anchor, phải duy nhất trong trang',
          render: 'boolean — false thì KHÔNG render node (và cả cây con) ra HTML, ở mọi bề rộng. Ẩn theo màn hình thì dùng style.<bp>.layout.display.',
          a11y: '{ role?, label?, labelledBy? }',
          customCss: 'lối thoát cuối, tự scope về [data-n="<id>"] (node trong component: [data-c][data-cn]). Xem aiCssAllowlist',
          locked: '{ reason, lockedBy, lockedAt } — vùng AI KHÔNG được sửa',
        },
      },

      /**
       * Hình dạng `style` — mọi nhóm, mọi field, và giá trị mỗi field nhận.
       *
       * SUY RA từ `zStyleProps`, không chép tay: xem `style-shape.ts`. Trước
       * 07/09/2026 tool này chỉ nói "ResponsiveStyle: { base, sm, ... }", nên một
       * agent muốn làm mờ nền phía sau node đã đoán bốn đường dẫn khác nhau cho
       * `effects.backdropBlur` — thứ đã tồn tại từ đầu — rồi kết luận builder
       * thiếu hẳn tính năng đó.
       */
      style: {
        /*
         * Con số SUY RA từ `BREAKPOINT_PX`, không chép tay.
         *
         * Chuỗi trước đây ghi `560/900/1200/1560` — lưới của site CŨ, đã đổi sang
         * 768/1024 ở `breakpoints.ts` và docblock ở đó giải thích vì sao. Chú
         * thích không đổi theo, nên một agent (hoặc một người) tin nó sẽ đặt style
         * vào nhầm lớp và không hiểu vì sao nó không ăn. Đo trên
         * site staging ngày 11/09/2026: CSS thật là md = 1024, lg = 1200.
         */
        layers:
          'base = nền mobile-first, mọi lớp khác kế thừa. sm/md/lg/xl = @media min-width ' +
          `${['sm', 'md', 'lg', 'xl'].map((b) => BREAKPOINT_PX[b as Breakpoint]).join('/')}. ` +
          'hover/focusVisible/inView = state cố định. ' +
          'states = { "<tên>": StyleProps } cho state do effect ghi ra, ra CSS ' +
          '[data-n="<id>"][data-<tên>="true"] — setStyle vào đó bằng target { state: "<tên>" }.',
        groups: styleShape().groups,
        // Thuộc tính cấp cao nhất — giá trị không phải object có field, nên nó KHÔNG
        // nằm trong `groups`. `shadow` là cái duy nhất hiện nay, và nó từng biến mất
        // hẳn khỏi tool này. Xem `StyleShape.props`.
        props: styleShape().props,
        note:
          'Khoá của `setStyle.patch` là `<nhóm>.<field>`, và schema là .strict() — sai ' +
          'nhóm thì bị từ chối là unrecognized key, không phải bỏ qua im lặng. null ở ' +
          'một field = xoá field đó khỏi lớp.',
      },

      richText:
        'Mảng InlineNode. Các dạng: { t:"text", v } · { t:"em"|"strong", children } · ' +
        '{ t:"br" } · { t:"link", href, children } · { t:"split", mode:"lines"|"words"|"chars", children } · ' +
        '{ t:"counter", to, decimals?, suffix? } · { t:"bind", ref:{ source:"site"|"page"|"collection", path, format? }, fallback }',

      bindNote:
        '`bind` là một InlineNode — nó thay được CHỮ, không thay được `style`. ' +
        'Không có cách nào cho một giá trị style phụ thuộc dữ liệu.',

      nodeTypes: wanted.map((t) => ({
        type: t,
        leaf: isLeafType(t),
        required: TYPE_FIELDS[t].required,
        ...(TYPE_FIELDS[t].note ? { note: TYPE_FIELDS[t].note } : {}),
      })),

      // Lõi + composite của gói dự án đang chạy.
      composites: compositeCatalog().map(({ key, implemented, about }) => ({ key, implemented, about })),

      aiCssAllowlist: {
        properties: [...AI_CSS_ALLOWLIST].sort(),
        note:
          'customCss ghi bởi AI (actor:"ai") CHỈ được dùng những property này. ' +
          'Mọi thứ liên quan bố cục — position, display, width, height, margin, ' +
          'background, border-color, content — phải đi qua setStyle để inspector ' +
          'còn sửa được bằng tay. Người gõ trong Inspector KHÔNG bị giới hạn này.',
        atRules:
          'Chỉ @media, @supports, @container, @layer được giữ. @font-face, @keyframes ' +
          'và @import bị GỠ cùng nội dung bên trong, không báo lỗi.',
      },

      traps: [
        'Grid: chia cột bằng style.layout.gridTemplateColumns. Field `columns` có trong get_node nhưng renderer KHÔNG đọc nó.',
        'Canvas có schema đầy đủ nhưng CHƯA có runtime — chỉ nhánh fallbackChildId hiện ra. CustomCode thì chạy, nhưng chỉ ở mode "iframe".',
        'Instance có `repeat` thì `effects` phải rỗng — validator từ chối, mã lỗi repeat_effect.',
        'customCss không giữ @keyframes. Cần keyframes thật thì phải thêm vào src/styles/effects/ — đó là code, cần deploy.',
        '3D, chọn theo thứ tự: (1) nghiêng/lật/xoay khi hover = customCss (transform, perspective, transform-style, backface-visibility, transition; tâm xoay là setStyle transform.origin) hoặc effect tilt — KHÔNG ghi transform bằng customCss trên chính node gắn tilt, nó đè effect; xoay liên tục thì không làm được vì @keyframes bị gỡ. (2) 3D chạy theo cuộn = effect image-sequence với khung ảnh dựng sẵn từ video 3D, không phải 3D vẽ trực tiếp. (3) Mô hình người xem tự kéo xoay = three.js trong CustomCode, chỉ khi thật cần tương tác — nó cô lập, không biết trang cuộn tới đâu.',
        'style.states chỉ nhận tên state mà một effect ĐANG GẮN trên node khai trong statesWritten (đọc list_effects). Node không gắn effect nào thì không có state tuỳ chỉnh nào hợp lệ.',
        'Làm mờ nền phía sau node là `effects.backdropBlur` (+ backdropSaturate, backdropFallbackColor) — KHÔNG phải fill.blur hay backdrop.blur. `effects.blur` là làm mờ CHÍNH node. Đọc `style.groups` thay vì đoán tên nhóm.',
        'setPresence render:false cắt node khỏi DOM ở MỌI bề rộng. Ẩn theo màn hình là style.<bp>.layout.display hoặc style.<bp>.effects.visibility — chỉ hai cái đó ra @media thật.',
        'part giữ được NHIỀU vai, cách nhau bằng khoảng trắng, và selector là [data-part~="<vai>"]. Section nền tối cho nav-invert đánh dấu bằng vai "nav-dark".',
      ],
    };
  },
};

export const SCHEMA_TOOLS: ToolDef[] = [nodeSchema];
