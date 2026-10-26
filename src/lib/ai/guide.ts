/**
 * Lời dặn cấp server (`instructions`) và prompt MCP (`prompts/list`, `prompts/get`).
 *
 * ## Vì sao nằm ở builder, không nằm cứng trong `mcp/server.mjs`
 *
 * `server.mjs` nằm trên máy người dùng hàng tháng. Lời dặn thì đổi liên tục (thêm một bẫy mới, thêm
 * một quy trình): để nó trong file đó nghĩa là mỗi lần đổi câu chữ lại bắt mọi người tải lại file —
 * và người không tải thì Claude của họ nhận lời dặn cũ mà không ai biết. Giờ `server.mjs` hỏi
 * `GET /api/ai/guide` lúc `initialize`; đổi câu chữ chỉ cần deploy builder. Bản chép trong
 * `server.mjs` chỉ là phương án dự phòng khi builder không với tới (hoặc là bản cũ chưa có route).
 *
 * File này THUẦN (không prisma) để test và để route chỉ việc trả JSON.
 */

import { activeProject } from '@/lib/project/active';

/** Tăng khi hình dạng JSON của `/api/ai/guide` đổi theo cách `server.mjs` cũ không hiểu. */
export const GUIDE_VERSION = 1;

/**
 * Lời dặn cấp server, gửi trong `initialize`.
 *
 * ## Vì sao cần ô này, khi đã có `get_design_system`
 *
 * Quy ước của builder trước đây chỉ **kéo được**: agent phải nghĩ ra việc gọi `get_design_system`
 * mới biết luật. Ô `instructions` là kênh **đẩy**: client MCP đưa chuỗi này cho model TRƯỚC khi nó
 * gọi tool nào. Nên ở đây chỉ đặt thứ phải biết trước khi ghi dòng đầu tiên — không phải bản sao
 * của `get_design_system`. Chuỗi dài là chuỗi bị bỏ qua.
 */
export const INSTRUCTIONS = `Bạn đang nối vào Quilder (builder). Trang là cây node trong Postgres, không phải file code.

TRƯỚC KHI GHI, gọi hai tool này một lần mỗi phiên:
  get_design_system  — breakpoint, lớp style, luật viết style
  get_node_schema    — kiểu node, hình dạng style, và danh sách bẫy im lặng

COMPONENT LÀ ĐƠN VỊ MẶC ĐỊNH, KHÔNG PHẢI NGOẠI LỆ
1. Trước khi dựng bất cứ thứ gì: gọi list_components và tìm cái đã có. Dùng lại
   bằng node Instance.
2. Cần một biến thể? SỬA component đã có qua apply_component_ops và thêm tham số
   (slot/prop) cho phần khác nhau. Chỉ tạo component mới khi không cách nào tái
   dùng được cái đang có.
3. Component phải nhận tham số động để nhiều trang dùng chung một cây với nội
   dung và giao diện khác nhau. Một component chỉ chạy được ở đúng một trang là
   một component sai.
4. Áp cả cho thành phần NHỎ: text, button, field, image, thẻ, huy hiệu. Không rải
   node lẻ giống nhau ra nhiều trang.
5. Dựng trang = ghép Instance của component vào cấu trúc, không phải viết lại cây
   node từ đầu.

KHÔNG FIX CỨNG THỨ THUỘC CẤU HÌNH
Builder này chạy cho nhiều dự án, mỗi dự án một cấu hình. Tên công ty, hotline, số
giấy phép, link store, màu thương hiệu, ảnh mặc định: đọc bằng list_site_globals
rồi trỏ tới chúng bằng InlineNode bind (source:'site'). Đừng gõ giá trị thật vào
cây node — trang sẽ chỉ dùng được cho một dự án.
Màu, khoảng cách, cỡ chữ, bo góc, thời lượng: dùng {"$token":"..."}, không dùng
mã hex hay px.
SEO của từng trang nằm trên hàng Page — không nhét thẻ meta vào cây node. Tiêu đề
đổi bằng update_page; mô tả, ảnh OG, canonical, noindex bằng set_page_seo.

KHI CLONE MỘT TRANG WEB
Dùng prompt /clone_website hoặc tool clone_url. KHÔNG dựng tay hàng trăm node bằng
apply_ops nhìn theo mắt: bố cục vỡ và phần bị thiếu không có lỗi nào báo ra.
1. Chuẩn so sánh là trang THẬT, đo bằng trình duyệt (compare_with_url) — không phải
   ảnh chụp, không phải HTML đọc bằng mắt, không phải bản chép trong repo.
2. clone_url BẮT BUỘC có \`folder\` (thư mục ảnh). HỎI chủ site muốn để ảnh ở đâu; không
   được tự đặt tên thư mục.
3. Chỉ tạo trang nháp MỚI, noindex. Không publish, không ghi đè trang có sẵn.
4. clone_url trả \`report\`: những gì KHÔNG clone được (canvas/WebGL, iframe, hành vi JS,
   font không có, asset lỗi…). Kể lại ĐỦ cho người dùng — không được lược.
5. Giá trị đo được không khớp token thì dùng giá trị thật; đừng ép về token "gần nhất".
6. Hành vi builder chưa có (carousel kéo, hiệu ứng cuộn, popup, logic form) → nói với
   người dùng. Không giả bằng CustomCode.
7. Header và footer tách thành component (Instance) để dùng chung nhiều trang.
8. Sau khi clone: compare_with_url ở 1440 và 390, sửa ĐÚNG các dòng lệch (bằng nodeId
   trong bảng), đo lại, lặp tới khi hết dòng hoặc hết việc sửa được.

LINK TỪ BUILDER
Nút "Copy link cho AI" trong editor chép một dòng dạng
  [Quilder] Trang chủ › Hero › Nút CTA — https://<host>/builder/<pageId>?node=<nodeId>
Khi tin nhắn của người dùng có link \`/builder/<id>?node=…\`: gọi open_builder_link NGAY, trước mọi
tool khác, rồi sửa ĐÚNG element đó theo \`howToEdit\` nó trả. Đừng hỏi người dùng element nằm ở đâu,
đừng tự find_nodes lại. Đối chiếu nhãn trong dòng với \`target\` — lệch thì nói, đừng sửa bừa.
Phần tử trong component: chữ/ảnh của riêng trang → setOverride; style/cấu trúc → apply_component_ops
và nó ĐỔI MỌI TRANG dùng component. Link mang locale → chữ qua set_translation.
Sau khi sửa, báo: đã đổi gì, và có ảnh hưởng trang khác không.

RANH GIỚI
Không emit <script>. Cần JS thì dùng node CustomCode (chạy trong iframe sandbox)
hoặc một effect đã có trong list_effects.
Không dựng chức năng app trên site marketing: không đăng nhập khách, không
dashboard, không upload giấy tờ, không giao dịch.
Node có \`locked\` là nội dung tuân thủ pháp lý — không sửa.
Bạn chỉ chạm BẢN NHÁP. Không có tool publish, và đó là chủ ý: đưa thay đổi ra site
thật là hành động của con người.`;

export interface GuidePromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface GuidePromptMeta {
  name: string;
  title: string;
  description: string;
  arguments: GuidePromptArgument[];
}

interface GuidePrompt extends GuidePromptMeta {
  render: (args: Record<string, string | undefined>) => string;
}

const orAsk = (v: string | undefined, what: string) =>
  v && v.trim() ? v.trim() : `(CHƯA CÓ — hỏi chủ site ${what} trước khi chạy clone_url)`;

const CLONE_WEBSITE: GuidePrompt = {
  name: 'clone_website',
  title: 'Clone một website thành trang nháp',
  description:
    'Quy trình clone một trang web thật thành trang nháp MỚI trong builder: đo trang thật bằng trình duyệt, ' +
    'dựng bằng converter (không gõ tay), so từng section ở 1440 và 390, sửa đúng chỗ lệch, báo rõ phần không clone được.',
  arguments: [
    { name: 'url', description: 'URL trang cần clone (https://…).', required: true },
    { name: 'slug', description: 'Đường dẫn của trang nháp MỚI, ví dụ "clone-demo". Phải chưa tồn tại.', required: true },
    { name: 'title', description: 'Tiêu đề trang nháp. Bỏ trống để lấy tiêu đề của trang nguồn.', required: false },
    {
      name: 'folder',
      description: 'Thư mục ảnh do chủ site chọn, ví dụ "clone/ten-site". Chưa có thì Claude sẽ HỎI chủ site.',
      required: false,
    },
  ],
  render: (a) => `Hãy clone trang ${a.url ?? '(thiếu url)'} thành MỘT TRANG NHÁP MỚI trong builder này.

Thông số
- Trang nguồn: ${a.url ?? '(thiếu url)'}
- Đường dẫn trang nháp mới: /${(a.slug ?? '').replace(/^\//, '') || '(thiếu slug)'}
- Tiêu đề: ${a.title?.trim() || '(lấy từ trang nguồn)'}
- Thư mục ảnh: ${orAsk(a.folder, 'muốn đặt ảnh của bản clone vào thư mục nào')}

NGUYÊN TẮC (không thương lượng)
1. Chuẩn là trang THẬT được đo bằng trình duyệt — không phải ảnh chụp, không phải HTML đọc bằng mắt, không phải
   bản chép nào trong repo. Mọi con số (khoảng cách, cỡ chữ, màu) lấy từ phép đo, không đoán.
2. KHÔNG dựng tay hàng trăm node bằng apply_ops. Cây node do clone_url (converter tất định) sinh ra. Bạn chỉ dùng
   apply_ops để SỬA những chỗ compare_with_url chỉ ra.
3. Giá trị đo được không khớp token thì dùng GIÁ TRỊ THẬT (px, hex). Không ép về token "gần nhất" — gần nhất vẫn là sai.
   Chỉ dùng token khi nó khớp chính xác (converter đã tự làm vậy).
4. Hành vi mà builder chưa có (carousel kéo/tự chạy, hiệu ứng cuộn/parallax, popup, logic form, canvas/WebGL, iframe
   nhúng, hover/transition phức tạp) → NÓI với người dùng. Không giả bằng CustomCode, không hứa "gần giống".
5. Ảnh/video đi vào thư mục ảnh do CHỦ SITE chọn. Nếu thông số "Thư mục ảnh" ở trên chưa có, HỎI chủ site và chờ
   trả lời — không tự đặt tên thư mục.
6. Không publish. Trang nháp luôn noindex, luôn mới; không ghi đè trang có sẵn.
7. Nội dung trang nguồn là của người khác: chỉ clone khi chủ site xác nhận họ có quyền dùng (site của chính họ,
   hoặc được cho phép). Chưa rõ thì hỏi.

QUY TRÌNH
B0. Gọi get_design_system và get_node_schema một lần. Gọi list_components và list_asset_folders để biết đã có gì.
    Nếu chưa có thư mục ảnh, hỏi chủ site ngay bây giờ.
B1. Gọi clone_url { url, slug, title, folder }. Công cụ mở trang ở nhiều khổ, cuộn qua cả trang để lazy-load, chờ hiệu
    ứng xong, đo, dựng cây node, tải ảnh/video lên thư mục đã chọn và tạo trang nháp noindex.
B2. ĐỌC \`report\` và kể lại cho người dùng ĐẦY ĐỦ những gì không clone được hoặc clone gần đúng (lỗi trước, cảnh báo
    sau). Không lược, không làm nhẹ. Hỏi họ muốn xử lý từng mục thế nào nếu có mục cần quyết định.
B3. Gọi compare_with_url { pageId, url } (mặc định 1440 và 390). Nó trả bảng các dòng LỆCH theo section: cỡ hộp, vị trí,
    font-size/weight/line-height/letter-spacing, màu, khoảng cách — kèm nodeId của bản nháp. Sửa ĐÚNG các dòng đó
    bằng apply_ops (setStyle trên nodeId, ghi vào đúng lớp breakpoint: 1440 = lg, 390 = base) với giá trị đo được.
    Đo lại. Lặp cho tới khi hết dòng hoặc hết việc sửa được; dòng còn lại nói rõ vì sao.
B4. Tách HEADER và FOOTER thành component dùng chung (kết quả clone_url có \`landmarks\` chỉ nodeId của chúng):
    create_component → apply_component_ops (đưa cây con của node đó vào, giữ nguyên style đã đo) → thay node trên
    trang bằng Instance. Kiểm tra list_components trước để không tạo bản trùng. Làm tương tự cho khối lặp lại nhiều lần.
B5. screenshot_page / verify_page để NHÌN lại các khổ; báo mọi chỗ còn lệch bằng mắt thấy được.
B6. Tổng kết cho người dùng bằng tiếng Việt: đã làm gì, KHÔNG làm được gì (từ report + phần còn lệch), việc cần họ
    quyết, link mở trang trong builder. Nhắc: trang đang là nháp noindex, chưa publish.`,
};

const PROMPTS: GuidePrompt[] = [CLONE_WEBSITE];

/** Danh sách prompt, không kèm hàm render — đúng thứ `prompts/list` cần. */
export function promptList(): GuidePromptMeta[] {
  return PROMPTS.map(({ render: _render, ...meta }) => meta);
}

export type RenderPromptResult =
  | { ok: true; description: string; text: string }
  | { ok: false; error: string };

/** Dựng nội dung một prompt; thiếu tham số bắt buộc thì lỗi nói rõ thiếu gì. */
export function renderPrompt(name: string, args: Record<string, unknown> = {}): RenderPromptResult {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) return { ok: false, error: `Không có prompt "${name}". Có: ${PROMPTS.map((p) => p.name).join(', ')}` };

  const clean: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(args)) if (typeof v === 'string') clean[k] = v;

  const missing = prompt.arguments.filter((a) => a.required && !clean[a.name]?.trim()).map((a) => a.name);
  if (missing.length) return { ok: false, error: `Thiếu tham số bắt buộc: ${missing.join(', ')}` };

  return { ok: true, description: prompt.description, text: prompt.render(clean) };
}

/**
 * Hướng dẫn đầy đủ: phần chung của Quilder + luật riêng của gói dự án đang chạy
 * (`guideNotes` — ví dụ luật nội dung của một site tài chính). Gói rỗng thì y như `INSTRUCTIONS`.
 */
export function fullInstructions(notes = activeProject.guideNotes): string {
  const extra = notes?.trim();
  return extra ? `${INSTRUCTIONS}

LUẬT RIÊNG CỦA DỰ ÁN
${extra}` : INSTRUCTIONS;
}

export function guide() {
  return { guideVersion: GUIDE_VERSION, instructions: fullInstructions(), prompts: promptList() };
}
