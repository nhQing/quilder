/**
 * URL API công khai của một loại nội dung — phần THUẦN.
 *
 * ## Vì sao là một module riêng có test, không phải vài dòng trong component
 *
 * Thứ khu này bán là SỰ CHÍNH XÁC. Người dùng copy một dòng rồi dán thẳng vào app
 * mobile hoặc vào Postman; một URL sai ở đây không sai ở đây — nó sai ở chỗ khác,
 * vài ngày sau, và người đi tìm lỗi là người không có repo này. Một khu "API mẫu"
 * in ra URL không gọi được còn tệ hơn không có khu nào.
 *
 * Không `server-only`: component copy chạy ở client.
 */

/**
 * `Site.primaryDomain` → origin gọi được.
 *
 * Cột đó lưu HOST TRẦN (`localhost:3001`, `stg.ten-mien.vn`) — không scheme. Dán
 * thẳng vào chỗ cần URL thì được `localhost:3001/api/...`, một chuỗi trình duyệt
 * hiểu là đường dẫn tương đối và Postman từ chối.
 *
 * Chọn scheme theo host chứ không mặc định `https`: máy dev chạy `http`, và một URL
 * `https://localhost:3001` không kết nối được — người dùng sẽ kết luận API hỏng.
 * Ngược lại, mặc định `http` cho tên miền thật là dạy người ta copy một URL không mã
 * hoá lên production.
 */
export function siteOrigin(primaryDomain: string): string {
  const raw = primaryDomain.trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;

  const host = raw.split('/')[0]!.split(':')[0]!.toLowerCase();
  const local =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local');
  return `${local ? 'http' : 'https'}://${raw}`;
}

export interface ApiUrlRow {
  /** Khoá ổn định để React và e2e nhắm tới — nhãn thì đổi được. */
  id: string;
  label: string;
  url: string;
  /** Một câu nói rõ cái bẫy của dòng đó, hoặc không có gì để nói. */
  note?: string;
}

export interface ApiUrlInput {
  origin: string;
  typeKey: string;
  /** Khoá danh mục có thật của loại này. `undefined` = loại chưa có danh mục nào. */
  taxonomyKey?: string;
  /** Slug của một bài có thật, cho ví dụ endpoint chi tiết. */
  sampleSlug?: string;
  /** Field có thật, cho ví dụ `?fields=`. Lấy tối đa hai. */
  fieldKeys: string[];
  /** Mã một ngôn ngữ KHÁC mặc định đang bật. */
  locale?: string;
}

/**
 * Danh sách dòng để copy.
 *
 * Mỗi dòng chỉ xuất hiện khi nó GỌI ĐƯỢC với dữ liệu thật của loại này: chưa có
 * danh mục thì không in dòng `?taxonomy=`, chưa có bài nào thì không in endpoint
 * chi tiết. In một ví dụ với giá trị bịa (`?taxonomy=tin-thi-truong` trong khi loại
 * này không có danh mục đó) là dạy người dùng một tham số trả về danh sách rỗng, và
 * rỗng thì trông y hệt "API hỏng".
 */
export function publicApiUrls(input: ApiUrlInput): ApiUrlRow[] {
  const base = `${input.origin}/api/public/v1`;
  const rows: ApiUrlRow[] = [
    {
      id: 'list',
      label: 'Danh sách',
      url: `${base}/${input.typeKey}?pageSize=20&sort=publishedAt:desc`,
      note: 'Chỉ bài đã đăng và đã tới mốc. Trần pageSize là 100 — vượt thì bị kẹp, không bị từ chối.',
    },
  ];

  if (input.taxonomyKey) {
    rows.push({
      id: 'taxonomy',
      label: 'Lọc theo danh mục',
      url: `${base}/${input.typeKey}?taxonomy=${input.taxonomyKey}&pageSize=20`,
      note: 'Tham số nhận KHOÁ danh mục, không phải id. Khoá không tồn tại trả danh sách rỗng.',
    });
  }

  if (input.sampleSlug) {
    rows.push({
      id: 'detail',
      label: 'Một bài theo slug',
      url: `${base}/${input.typeKey}/${input.sampleSlug}`,
    });
  }

  if (input.fieldKeys.length) {
    rows.push({
      id: 'fields',
      label: 'Chỉ vài field',
      url: `${base}/${input.typeKey}?fields=${input.fieldKeys.slice(0, 2).join(',')}&pageSize=100`,
      note: 'Cắt payload. Khoá hệ thống (id, slug, publishedAt…) luôn có, không cần xin.',
    });
  }

  if (input.locale) {
    rows.push({
      id: 'locale',
      label: `Bản dịch (${input.locale})`,
      url: `${base}/${input.typeKey}?locale=${input.locale}&pageSize=20`,
      note: 'Đổi cả phép lọc "đã đăng" sang bản dịch, không chỉ đổi chữ: bài chưa duyệt bản này sẽ không có trong danh sách.',
    });
  }

  if (input.taxonomyKey) {
    rows.push({
      id: 'taxonomies',
      label: 'Cây danh mục',
      url: `${base}/taxonomies/${input.typeKey}`,
    });
  }

  return rows;
}
