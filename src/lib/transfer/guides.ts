/**
 * Mã lỗi / việc cần làm của xuất–nhập trang → hướng dẫn từng bước.
 *
 * Mỗi chỗ người dùng phải tự làm một bước (máy chủ chặn, thiếu cấu hình…) có MỘT mã, và mỗi
 * mã có MỘT hướng dẫn cố định ở đây. Hộp thoại hiện hướng dẫn ngay tại chỗ lỗi xảy ra; test
 * khẳng định mã nào phát ra được thì có hướng dẫn. `{biến}` được thay bằng `issue.vars`.
 */

export type TransferCode =
  // Xuất (X) + cảnh báo khi xuất (W)
  | 'asset-row-missing' | 'asset-file-missing' | 'storage-unreachable' | 'component-missing'
  | 'doc-invalid' | 'too-large' | 'interrupted'
  | 'file-over-import-limit' | 'entries-not-included'
  // Nhập — chặn (G)
  | 'proxy-too-large' | 'file-too-large' | 'builder-too-old' | 'file-corrupt' | 'target-changed'
  | 'target-fixture' | 'network' | 'collection-type-missing' | 'target-shape-mismatch'
  | 'file-rejected'
  // Nhập — việc cần làm sau khi nhập (C)
  | 'endpoint-missing' | 'locale-missing' | 'locale-disabled' | 'embed-origin-missing'
  | 'collection-missing' | 'component-differs' | 'collection-field-missing' | 'publish';

export type IssueLevel = 'block' | 'warn' | 'todo';

export interface IssueItem {
  label: string;
  href?: string;
}

export interface TransferIssue {
  code: TransferCode;
  level: IssueLevel;
  /** Một câu cụ thể cho lần này ("3 file lớn hơn 10 MB"). */
  detail?: string;
  /** Danh sách chỗ dính lỗi, mỗi chỗ có thể kèm link mở editor tại node. */
  items?: IssueItem[];
  vars?: Record<string, string>;
}

export interface Guide {
  tag: string;
  title: string;
  why: string;
  steps: string[];
}

export const GUIDES: Record<TransferCode, Guide> = {
  'asset-row-missing': {
    tag: 'X1', title: 'Ảnh đã bị xoá khỏi thư viện',
    why: 'Node vẫn trỏ tới một ảnh không còn trong thư viện, nên gói sẽ thiếu ảnh.',
    steps: ['Bấm link để mở node dùng ảnh đó.', 'Chọn lại ảnh, hoặc xoá node.', 'Xuất lại.'],
  },
  'asset-file-missing': {
    tag: 'X2', title: 'File ảnh không còn trong kho',
    why: 'Ảnh còn trong thư viện nhưng file trên kho (S3/MinIO) đã mất.',
    steps: ['Mở Thư viện ảnh, tìm ảnh theo link.', 'Bấm "Thay ảnh" và chọn lại file gốc.', 'Xuất lại.'],
  },
  'storage-unreachable': {
    tag: 'X3', title: 'Không kết nối được kho ảnh',
    why: 'Server không đọc được file từ kho ảnh của môi trường này.',
    steps: [
      'Báo người quản trị: kiểm các biến S3_* và kho ảnh có đang chạy không (ở máy local: `pnpm db:up`).',
      'Bấm "Thử lại".',
    ],
  },
  'component-missing': {
    tag: 'X4', title: 'Component đã bị xoá',
    why: 'Trang cắm một component không còn tồn tại.',
    steps: ['Bấm link để mở node instance.', 'Xoá instance đó, hoặc cắm lại một component có thật.', 'Xuất lại.'],
  },
  'doc-invalid': {
    tag: 'X5', title: 'Bản nháp không hợp lệ',
    why: 'Bản nháp không qua được bước kiểm dữ liệu, nên môi trường khác sẽ không đọc được nó.',
    steps: ['Mở từng node trong danh sách và sửa theo lỗi — hoặc lùi bản nháp bằng Lịch sử.', 'Xuất lại.'],
  },
  'too-large': {
    tag: 'X6', title: 'Gói quá lớn',
    why: 'Gói có quá 5000 file, hoặc dữ liệu trang quá 5 MB.',
    steps: ['Xem các node nhiều file nhất trong danh sách.', 'Bớt khung hình hoặc tách trang.', 'Xuất lại.'],
  },
  interrupted: {
    tag: 'X7', title: 'Tải về bị ngắt giữa chừng',
    why: 'Kết nối tới server bị đứt khi đang tải gói.',
    steps: ['Bấm "Thử lại".'],
  },
  'file-over-import-limit': {
    tag: 'W1', title: 'Có file lớn hơn 10 MB',
    why: 'Gói vẫn xuất được, nhưng môi trường đích sẽ không nhận các file này.',
    steps: ['Nếu cần nhập ở môi trường khác: thay các file trong danh sách bằng bản nhẹ hơn rồi xuất lại.'],
  },
  'entries-not-included': {
    tag: 'W2', title: 'Bài viết không đi theo gói',
    why: 'Gói chỉ có bố cục của trang; bài viết trong kho dữ liệu không được xuất kèm.',
    steps: ['Nếu môi trường đích chưa có bài, thêm bài ở đó (hoặc dùng tính năng xuất/nhập bài viết khi có).'],
  },
  'proxy-too-large': {
    tag: 'G1', title: 'Máy chủ chặn request lớn',
    why: 'Proxy đứng trước app (Nginx/Caddy) chặn một request cỡ {size} trước khi nó tới app.',
    steps: [
      'Báo người quản trị máy chủ của môi trường này.',
      'Nginx: thêm `client_max_body_size 12m;` vào khối `server {}` của site. Caddy: thêm `request_body { max_size 12MB }` vào khối của site.',
      'Nạp lại proxy: `nginx -s reload` hoặc `caddy reload`.',
      'Bấm "Tiếp tục" — file đã tải lên rồi sẽ không tải lại.',
    ],
  },
  'file-too-large': {
    tag: 'G2', title: 'File lớn hơn 10 MB',
    why: 'Kho ảnh chỉ nhận file tối đa 10 MB.',
    steps: [
      'Ở môi trường nguồn, thay file trong danh sách bằng bản nhẹ hơn.',
      'Xuất lại trang ở nguồn.',
      'Nhập file mới.',
    ],
  },
  'builder-too-old': {
    tag: 'G3', title: 'Môi trường này chạy bản builder cũ hơn nguồn',
    why: 'Gói dùng thứ mà bản builder ở đây chưa có: {missing}.',
    steps: ['Deploy lên môi trường này đúng bản builder đang chạy ở nguồn.', 'Mở lại hộp thoại và chọn lại file.'],
  },
  'file-corrupt': {
    tag: 'G4', title: 'File gói bị hỏng',
    why: 'Nội dung trong file không khớp với mã kiểm tra lúc xuất.',
    steps: ['Xuất lại ở môi trường nguồn.', 'Tải file mới về — đừng mở hay sửa file .zip bằng tay.', 'Nhập lại.'],
  },
  'target-changed': {
    tag: 'G5', title: 'Trang đích vừa bị sửa',
    why: 'Có người sửa trang đích sau khi bạn xem trước, nên nhập lúc này sẽ ghi đè thay đổi đó.',
    steps: ['Bấm "Xem trước lại".', 'Kiểm lại thay đổi.', 'Bấm "Nhập".'],
  },
  'target-fixture': {
    tag: 'G6', title: 'Trang đích là trang dùng cho test tự động',
    why: 'Nhập đè trang này sẽ làm hỏng bộ test e2e.',
    steps: ['Chọn trang khác, hoặc tạo trang mới.'],
  },
  network: {
    tag: 'G7', title: 'Mất kết nối giữa chừng',
    why: 'Trình duyệt không gửi được request tới server.',
    steps: ['Kiểm mạng.', 'Bấm "Tiếp tục" — file đã lên rồi sẽ không tải lại.'],
  },
  'collection-type-missing': {
    tag: 'G8', title: 'Chưa có loại nội dung "{typeKey}"',
    why: 'Trang này hiện bài của loại "{typeKey}". Không có loại đó thì trang không có gì để hiện.',
    steps: [
      'Mở Nội dung, tạo loại nội dung khoá "{typeKey}" với các field: {fields}.',
      'Bấm "Xem trước lại".',
    ],
  },
  'target-shape-mismatch': {
    tag: 'G9', title: 'Trang đích không cùng dạng',
    why: 'Gói là {bundleShape}, còn trang đích là {targetShape}.',
    steps: ['Chọn trang cùng dạng trong danh sách — hoặc tạo trang mới.'],
  },
  'file-rejected': {
    tag: 'G10', title: 'Kho ảnh ở đây không nhận file này',
    why: '{reason}',
    steps: ['Ở môi trường nguồn, thay file trong danh sách bằng định dạng kho nhận (PNG, JPEG, WebP, SVG, MP4…).', 'Xuất lại rồi nhập lại.'],
  },
  'endpoint-missing': {
    tag: 'C1', title: 'Form chưa có URL nhận dữ liệu',
    why: 'Form "{form}" gửi tới khoá {key}, nhưng môi trường này chưa đặt URL cho khoá đó — form đang tắt.',
    steps: [
      'Mở Cài đặt › Form.',
      'Tìm box của form "{form}" (khoá {key}).',
      'Dán URL nhận dữ liệu CỦA MÔI TRƯỜNG NÀY, bấm "Lưu URL".',
    ],
  },
  'locale-missing': {
    tag: 'C2', title: 'Chưa có ngôn ngữ {locale}',
    why: '{count} bản dịch {locale} trong gói đã bị bỏ qua.',
    steps: ['Mở Cài đặt › Ngôn ngữ, thêm ngôn ngữ {locale}.', 'Nhập lại trang để lấy các bản dịch đó.'],
  },
  'locale-disabled': {
    tag: 'C2', title: 'Ngôn ngữ {locale} đang tắt',
    why: 'Bản dịch {locale} đã được nhập, nhưng chưa hiện trên site vì ngôn ngữ đang tắt.',
    steps: ['Bật ngôn ngữ {locale} ở Cài đặt › Ngôn ngữ khi đã sẵn sàng.'],
  },
  'embed-origin-missing': {
    tag: 'C3', title: 'Khối mã nhúng tải từ nguồn chưa được phép',
    why: 'Khối CustomCode tải từ {origin}, nguồn này chưa được phép ở môi trường này nên khối sẽ không chạy.',
    steps: ['Nhờ dev thêm {origin} vào bảng EmbedOrigin của môi trường này (chưa có giao diện).', 'Bấm "Kiểm lại".'],
  },
  'collection-missing': {
    tag: 'C4', title: 'Khối danh sách dùng loại nội dung chưa có',
    why: 'Khối lặp dùng loại "{typeKey}" chưa có ở đây, nên sẽ rỗng.',
    steps: ['Mở Nội dung, tạo loại nội dung khoá "{typeKey}".', 'Thêm bài.'],
  },
  'component-differs': {
    tag: 'C5', title: 'Component ở đây khác bản trong gói',
    why: 'Trang dùng component "{name}" đang có ở đây, và bản này khác bản ở nguồn. {orphans}',
    steps: ['Mở component ở đây (link).', 'So với bản ở nguồn.', 'Muốn giống nguồn thì sửa tay. Chỉnh riêng không còn khớp sẽ không có tác dụng — Inspector có nút dọn.'],
  },
  'collection-field-missing': {
    tag: 'C7', title: 'Loại nội dung thiếu field',
    why: 'Bố cục gắn field "{field}" mà loại "{typeKey}" ở đây không có, nên chỗ đó sẽ trống.',
    steps: ['Mở Nội dung › {typeKey}, thêm field "{field}" cùng kiểu.', 'Bấm "Kiểm lại".'],
  },
  publish: {
    tag: 'C6', title: 'Publish khi đã kiểm',
    why: 'Nhập chỉ ghi bản nháp. Site thật chưa đổi.',
    steps: ['Mở bản nháp, kiểm từng phần.', 'Bấm Publish khi đã ổn.'],
  },
};

export function issue(
  code: TransferCode,
  level: IssueLevel,
  extra: Partial<Pick<TransferIssue, 'detail' | 'items' | 'vars'>> = {},
): TransferIssue {
  return { code, level, ...extra };
}

const fill = (s: string, vars: Record<string, string> | undefined) =>
  s.replace(/\{(\w+)\}/g, (all, k: string) => vars?.[k] ?? all);

export function renderGuide(i: TransferIssue): Guide {
  const g = GUIDES[i.code];
  return {
    tag: g.tag,
    title: fill(g.title, i.vars),
    why: fill(g.why, i.vars),
    steps: g.steps.map((s) => fill(s, i.vars)),
  };
}

/**
 * Hoàn tác lần nhập làm gì — hiện ở hộp xác nhận của CẢ hai chỗ bấm (màn kết quả, menu ⋯ của
 * thẻ trang), để hai nơi không nói khác nhau.
 */
export const UNDO_IMPORT_CONSEQUENCE =
  'Bản nháp và bản dịch của trang trở về như trước lần nhập; tiêu đề/SEO cũng trở về nếu lần nhập đã đổi chúng. '
  + 'Nếu lần nhập đã tạo ra trang này thì trang bị xoá hẳn. Component, token và ảnh đã thêm vẫn giữ lại. Site thật không đổi.';
