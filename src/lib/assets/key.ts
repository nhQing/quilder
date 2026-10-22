import { createHash } from 'node:crypto';

/**
 * Khoá lưu trữ cho một asset, đánh địa chỉ theo NỘI DUNG.
 *
 * ## Vì sao "thay ảnh" phải tạo khoá mới, không ghi đè khoá cũ
 *
 * `Release.assets` chụp metadata chứ không chụp file. Điều đó chỉ đúng khi một
 * `key` mãi mãi trỏ tới cùng byte.
 *
 * Ghi đè `key` là làm MỌI release cũ trỏ tới ảnh mới. Lùi một release sẽ lùi bố
 * cục, chữ, token và CSS — nhưng ảnh thì không. Người soát thấy một trang **gần
 * đúng**, và không có gì chỉ ra chỗ sai. Đó là dạng lỗi tệ nhất trong cả hợp đồng
 * này, vì nó trông giống thành công.
 *
 * Kèm một lợi ích thứ hai: khoá theo nội dung thì `Cache-Control: immutable` đặt
 * được — URL không bao giờ trả byte khác.
 *
 * ## Vì sao 8 ký tự
 *
 * 32 bit trên phạm vi MỘT site. Với hàng nghìn asset thì xác suất trùng vẫn ở mức
 * không đáng kể, và khoá còn đọc được bằng mắt khi soi bucket — thứ có giá trị thật
 * lúc gỡ lỗi, và là lý do không dùng thẳng 64 ký tự.
 *
 * ## Trạng thái cưỡng chế
 *
 * Đợt 1 chỉ có LUẬT và test này. Đường ghi asset (API upload/replace) thuộc Đợt 2,
 * nên tới lúc đó luật này **chưa được cưỡng chế** — `scripts/wire-*.ts` vẫn upsert
 * theo `key` cố định. Ghi ra đây để không ai tưởng nó đã có hiệu lực.
 */
export function nextAssetKey(base: string, content: Uint8Array): string {
  return assetKeyFromDigest(base, createHash('sha256').update(content).digest('hex'));
}

/**
 * Cùng khoá như `nextAssetKey`, tính từ sha256 (hex) thay vì từ byte.
 *
 * Màn nhập trang có sha256 của mọi file trong manifest TRƯỚC khi tải lên, và phải đoán
 * đúng khoá `uploadAsset` sẽ sinh để biết đích đã có file đó chưa. Một hàm định dạng dùng
 * chung, không chép, để hai phép không lệch nhau.
 */
export function assetKeyFromDigest(base: string, sha256hex: string): string {
  const digest = sha256hex.slice(0, 8);

  const slash = base.lastIndexOf('/');
  const dir = slash === -1 ? '' : base.slice(0, slash + 1);
  const file = base.slice(slash + 1);

  // `dot <= 0` gộp hai trường hợp: không có dấu chấm, và dấu chấm ở đầu tên
  // (`.gitkeep`). Cả hai đều nghĩa là "không có phần mở rộng" — coi `gitkeep` là
  // đuôi sẽ cho ra `-abc12345.gitkeep`, một tên không ai nhận ra.
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return `${dir}${file}-${digest}`;

  return `${dir}${file.slice(0, dot)}-${digest}${file.slice(dot)}`;
}

/**
 * Tên file người dùng gửi lên → phần gốc của khoá.
 *
 * Chỉ giữ chữ, số, gạch và chấm; mọi thứ khác thành gạch nối. Tên file là dữ liệu
 * KHÔNG tin được: nó đi vào khoá S3, và một tên chứa `../` hay khoảng trắng sẽ tạo
 * ra khoá phải escape hoặc trỏ ra ngoài tiền tố dự định.
 *
 * Kết quả luôn có tiền tố `public/builder/`, và tiền tố đó chịu ba lực:
 *
 *  1. **`public/` là chỗ bucket phục vụ ra CDN.** URL công khai dựng bằng đúng
 *     `S3_PUBLIC_BASE_URL + '/' + key` (`objectUrl`), nên khoá và URL là ánh xạ
 *     1-1: nhìn URL biết object nằm đâu, và không có tầng viết lại đường dẫn nào
 *     ở giữa để mà lệch. Thiếu `public/` thì object ghi vào chỗ CDN không phục vụ.
 *  2. **Phân biệt với 11 asset đi kèm mã nguồn** — hai nguồn cùng tồn tại, và
 *     nhìn khoá là biết cái nào.
 *  3. **Không đụng Strapi.** Bucket production dùng chung với Strapi, vốn ghi vào
 *     gốc hoặc vào `uploads/`. Bản đầu của hàm này dùng `uploads/` — đúng cái tiền
 *     tố ấy.
 *
 * Tiền tố phải chốt TRƯỚC khi có ảnh thật: `Asset.key` là bất biến (`Release.assets`
 * chụp metadata mà không chụp file, nên release cũ trỏ tới khoá cũ mãi mãi). Đổi
 * tiền tố sau đó là không làm được cho ảnh đã có — chỉ áp cho ảnh mới, và kho thành
 * hai nửa mang hai quy ước.
 *
 * 24/08/2026: đã đổi từ `builder/` sang `public/builder/`. Ảnh tải lên TRƯỚC mốc
 * đó mang khoá cũ và **giữ nguyên khoá cũ** — đúng theo đoạn trên. Chúng cần được
 * chép sang tiền tố mới trong bucket rồi cập nhật `Asset.key`, hoặc chấp nhận sống
 * ở nửa cũ. Đếm chúng bằng: `SELECT count(*) FROM "Asset" WHERE key LIKE 'builder/%'`.
 *
 * Vì sao KHÔNG nhét `/public` vào `S3_PUBLIC_BASE_URL` cho nhanh: làm vậy thì khoá
 * trong database (`builder/x.jpg`) không còn là đường dẫn thật trong bucket
 * (`public/builder/x.jpg`), và mọi công cụ đọc `Asset.key` — script dọn kho, phép
 * so bucket với DB, `headObject` lúc gỡ lỗi — đều trỏ sai. Một biến môi trường
 * không được phép mang một nửa của khoá.
 */
export function assetKeyBase(fileName: string): string {
  const cleaned = (fileName || 'asset')
    .split(/[\\/]/)
    .pop()!
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);

  return `public/builder/${cleaned || 'asset'}`;
}
