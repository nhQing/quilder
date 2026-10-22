import 'server-only';

/**
 * Kho asset — tầng lưu trữ.
 *
 * ## Vì sao bọc sau một bề mặt hẹp
 *
 * `pnpm test` phải chạy được khi KHÔNG có mạng và KHÔNG có credential. Bốn hàm
 * dưới đây là toàn bộ thứ mà phần còn lại của app thấy, nên test dùng bản giả mà
 * không phải mock cả SDK.
 *
 * ## Vì sao `forcePathStyle` phụ thuộc `S3_ENDPOINT`
 *
 * MinIO địa chỉ hoá kiểu `endpoint/bucket/key` (path-style); AWS mặc định
 * `bucket.s3.region.amazonaws.com/key` (virtual-host). Đặt cứng một kiểu thì dev
 * chạy còn production 404, hoặc ngược lại — và lỗi đó chỉ lộ ra SAU khi deploy,
 * lúc có người tải ảnh đầu tiên.
 *
 * ## Vì sao không presigned PUT thẳng từ client
 *
 * Credential ở lại phía server, và ứng dụng là chỗ DUY NHẤT tính được
 * `nextAssetKey()` từ nội dung — presigned URL phải biết khoá *trước* khi thấy
 * byte, tức phải tin client đặt khoá đúng. Đánh đổi: byte đi qua Node một lần lúc
 * tải lên. Đọc thì không, và đọc mới là đường nóng.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  publicBaseUrl: string;
}

/**
 * Đọc và kiểm cấu hình.
 *
 * Ném kèm TÊN biến thiếu, không phải một câu chung chung: người đọc thông báo này
 * đang ở giữa một lần deploy hỏng, và thứ họ cần là tên biến để đặt.
 *
 * `entrypoint.sh` kiểm cùng danh sách này lúc khởi động, nên trong production lỗi
 * lộ ra lúc container start chứ không phải lúc người dùng tải ảnh đầu tiên.
 */
export function s3Config(): S3Config {
  const missing: string[] = [];
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) missing.push(k);
    return v ?? '';
  };

  const bucket = need('S3_BUCKET');
  const region = need('S3_REGION');
  const publicBaseUrl = need('S3_PUBLIC_BASE_URL');
  need('S3_ACCESS_KEY_ID');
  need('S3_SECRET_ACCESS_KEY');

  if (missing.length) {
    throw new Error(
      `Thiếu cấu hình kho asset: ${missing.join(', ')}. Xem .env.example để biết đặt gì.`,
    );
  }

  return {
    bucket,
    region,
    // Rỗng nghĩa là AWS thật. Chuỗi rỗng và `undefined` khác nhau với SDK, nên
    // chuẩn hoá ở đây thay vì để mỗi chỗ gọi tự đoán.
    endpoint: process.env.S3_ENDPOINT || undefined,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
  };
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const cfg = s3Config();
  client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: Boolean(cfg.endpoint),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

/** URL công khai của một khoá. Trình duyệt tải thẳng từ đây, không qua app. */
export function objectUrl(key: string): string {
  return `${s3Config().publicBaseUrl}/${key}`;
}

/**
 * Ghi một object.
 *
 * `CacheControl` đặt Ở ĐÂY và là VĨNH VIỄN: object đã ghi thì header đã ghi, và
 * `immutable` nghĩa là trình duyệt sẽ không bao giờ hỏi lại. An toàn vì khoá mang
 * hash nội dung (`nextAssetKey`), nên một URL luôn trả cùng byte — cùng lý lẽ như
 * `/mm-css/<hash>.css` ở Đợt 1.
 *
 * Ghi sai `contentType` ở đây cũng không sửa lại được, chỉ ghi khoá mới. Đó là lý
 * do kiểu phải dò từ NỘI DUNG chứ không lấy từ đuôi file — xem `sniff.ts`.
 */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const cfg = s3Config();
  await s3().send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

/** Metadata của một object. Dùng để KIỂM header đã ghi đúng chưa. */
export async function headObject(key: string) {
  const cfg = s3Config();
  return s3().send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
}

/** Đọc trọn một object — dùng khi XUẤT trang (gói mang theo file ảnh). */
export async function getObject(key: string): Promise<Uint8Array> {
  const cfg = s3Config();
  const res = await s3().send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  if (!res.Body) throw new Error(`Object rỗng: ${key}`);
  return res.Body.transformToByteArray();
}

/**
 * Xoá một object.
 *
 * Hai đường gọi, và chỉ hai:
 *
 *  1. Script kiểm thử, để DỌN object chúng tự tạo.
 *  2. "Xoá hoàn toàn" ảnh từ thùng rác (`src/lib/builder/asset-trash.ts`), sau một
 *     loạt rào chắn: chỉ admin, chỉ ảnh đã nằm trong thùng rác, kiểm lại tham chiếu
 *     ngay lúc xoá, xoá hàng DB + ghi AuditLog TRƯỚC, và kiểm lại rằng không hàng
 *     `Asset` nào mang khoá này ngay trước khi gọi hàm này.
 *
 * Không có tool MCP nào gọi nó, và đừng thêm đường gọi thứ ba bỏ qua các rào chắn
 * trên: xoá là việc một chiều của người, và với `immutable` thì một object bị xoá
 * nhầm vẫn còn nằm trong cache của trình duyệt hàng năm — trạng thái "có chỗ thấy,
 * có chỗ không" khó chẩn đoán hơn hẳn việc thừa một file.
 */
export async function deleteObject(key: string): Promise<void> {
  const cfg = s3Config();
  await s3().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}
