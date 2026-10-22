/**
 * Cắt một video thành hai lô ảnh khung cho effect `image-sequence`.
 *
 *   node scripts/video-to-frames.mjs --in <file|url> --out <dir> [--frames 120] [--quality 6]
 *
 *     <dir>/wide/f_0001.jpg …   rộng 1600
 *     <dir>/narrow/f_0001.jpg … rộng 800
 *
 * Hai lô trong MỘT lượt giải mã: ffmpeg đọc video một lần rồi tách hai nhánh
 * filter. Chạy hai lượt là giải mã hai lần cho cùng một file, và với video dài
 * đó là gấp đôi thời gian đợi mà không được gì.
 *
 * ## Tên file zero-pad bốn chữ số — BẮT BUỘC, không phải thẩm mỹ
 *
 * `nextAssetKey` giữ nguyên tên gốc rồi mới chèn hash (`f_0001` →
 * `f_0001-a1b2c3d4.jpg`), nên sắp kết quả `list_assets` theo `key` là ra đúng
 * thứ tự clip (tool trả theo ngày tạo, nên bước sắp là việc của bên gọi). Bỏ padding thì `f_10` đứng TRƯỚC `f_2` theo thứ tự chuỗi, và clip chạy
 * loạn — mà loạn theo kiểu vẫn chạy, nên không ai nghi là do tên file.
 *
 * Bốn chữ số phủ tới 9999 khung; trần của effect là 400.
 *
 * ## JPEG, không WebP/AVIF
 *
 * `sniff()` ở tầng upload chỉ nhận PNG/JPEG/SVG và nó dò theo NỘI DUNG, nên đổi
 * đuôi không lừa được. Bản tham chiếu đã thử một khung webp lên builder và ăn
 * 415 — đúng như đã ghi. Thử một khung trước rẻ hơn nhiều so với cắt cả loạt rồi
 * mới biết.
 *
 * ## Điều kiện tiên quyết
 *
 * `ffmpeg` phải có trong PATH. Trên Windows: `winget install Gyan.FFmpeg`.
 *
 * ## Script này KHÔNG upload
 *
 * Nó dừng ở chỗ có hai thư mục ảnh. Bước tiếp theo là HỎI chủ dự án lưu vào thư
 * mục asset nào rồi mới `upload_asset` — yêu cầu rõ ràng ngày 23/09/2026: tool
 * không bao giờ tự chọn thư mục. Gộp upload vào đây là biến một quyết định của
 * người thành một mặc định của máy.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const chay = promisify(execFile);

/** Bề rộng hai lô. Lô hẹp bằng nửa lô rộng — xem `narrowBelow` của effect. */
const RONG = 1600;
const HEP = 800;

/** Trần khung, khớp với `MAX_FRAMES` trong `image-sequence.ts`. */
const MAX_FRAMES = 400;

/** Số chữ số zero-pad. Đổi số này là đổi thứ tự sắp xếp của cả clip. */
const PAD = 4;

function doiSo(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const ten = a.slice(2);
    const sau = argv[i + 1];
    // Cờ không có giá trị đi kèm thì coi là bật. Hiện chưa cờ nào dùng tới, nhưng
    // đọc `--frames --out x` ra `frames = "--out"` là kiểu sai âm thầm nhất.
    out[ten] = sau && !sau.startsWith('--') ? sau : true;
    if (out[ten] !== true) i += 1;
  }
  return out;
}

function thoat(message) {
  console.error(message);
  process.exit(1);
}

const args = doiSo(process.argv.slice(2));

if (typeof args.in !== 'string' || typeof args.out !== 'string') {
  thoat(
    'Thiếu tham số.\n' +
      '  node scripts/video-to-frames.mjs --in <file|url> --out <dir> [--frames 120] [--quality 6]',
  );
}

const soKhung = Number(args.frames ?? 120);
if (!Number.isInteger(soKhung) || soKhung < 2 || soKhung > MAX_FRAMES) {
  thoat(`--frames phải là số nguyên trong khoảng 2..${MAX_FRAMES}, nhận được: ${args.frames}`);
}

/**
 * `-q:v` của ffmpeg: 2 là gần như không mất chất, 31 là nát. 6 là mức mà một
 * khung 1600px ra ~30–60 KB — nhân 120 khung là 4–7 MB cho cả lô.
 *
 * Nén mạnh ở đây là nửa còn lại của quyết định "không đi qua `/_next/image`"
 * trong `image-sequence.ts`. Bỏ qua optimizer nghĩa là byte gửi đi đúng bằng byte
 * cắt ra, nên chất lượng nén là thứ DUY NHẤT còn điều khiển được kích thước lô.
 */
const chatLuong = Number(args.quality ?? 6);
if (!Number.isInteger(chatLuong) || chatLuong < 2 || chatLuong > 31) {
  thoat(`--quality phải là số nguyên trong khoảng 2..31, nhận được: ${args.quality}`);
}

const thuMuc = resolve(process.cwd(), args.out);
const duongRong = resolve(thuMuc, 'wide');
const duongHep = resolve(thuMuc, 'narrow');

await mkdir(duongRong, { recursive: true });
await mkdir(duongHep, { recursive: true });

/** Đúng tên file script này ghi ra — không đụng tới file nào khác trong thư mục. */
const LA_KHUNG = new RegExp(`^f_\\d{${PAD}}\\.jpg$`);

/*
 * Xoá khung của lần cắt TRƯỚC, trước khi cắt lần này.
 *
 * ffmpeg chỉ ghi đè những tên nó ghi lại. Cắt lại với `--frames` nhỏ hơn thì
 * `f_0121.jpg`… của lần trước vẫn nằm đó, bị đếm vào tổng ở cuối và bị upload lẫn
 * vào lô — clip chạy hết cảnh mới rồi nhảy sang đuôi của cảnh cũ.
 *
 * Chỉ xoá file khớp `LA_KHUNG`: `--out` có thể trỏ nhầm vào một thư mục có sẵn đồ,
 * và một script cắt khung không có quyền dọn đồ của người khác.
 */
for (const dir of [duongRong, duongHep]) {
  for (const ten of await readdir(dir)) {
    if (LA_KHUNG.test(ten)) await rm(resolve(dir, ten));
  }
}

/*
 * Thời lượng phải đọc trước, và đây là chỗ dễ làm sai nhất cả script.
 *
 * Cách "không cần biết gì về video" — đặt `fps` cố định rồi để `-frames:v` cắt —
 * chạy trơn tru và cho ra đúng số khung yêu cầu, nên nó TRÔNG như đúng. Nhưng ở
 * fps cố định, N khung chỉ phủ N/fps giây ĐẦU: 120 khung ở 25fps là 4,8 giây đầu
 * của một video 18 giây, và hai phần ba clip biến mất. Không có cảnh báo nào, vì
 * ffmpeg đã làm đúng thứ được bảo.
 *
 * Nên `fps` phải suy từ thời lượng: `soKhung / thời lượng`. `ffprobe` đi cùng gói
 * với `ffmpeg`, nên nó không thêm điều kiện tiên quyết nào.
 */
let thoiLuong;
try {
  const { stdout } = await chay('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    args.in,
  ]);
  thoiLuong = Number(String(stdout).trim());
} catch (e) {
  if (e.code === 'ENOENT') {
    thoat('Không tìm thấy `ffprobe` trong PATH. Trên Windows: winget install Gyan.FFmpeg');
  }
  thoat(`Không đọc được thời lượng của ${args.in}: ${e.message}`);
}

if (!Number.isFinite(thoiLuong) || thoiLuong <= 0) {
  thoat(`Thời lượng đọc được không dùng được (${thoiLuong}). File có phải video không?`);
}

/*
 * Cộng thêm một chút vào fps để khung CUỐI không bị rơi.
 *
 * Bộ lọc `fps` lấy mẫu tại `k/fps` giây; với `fps = N/thời lượng` thì mẫu thứ N
 * rơi đúng vào mốc kết thúc và thường không có khung nào ở đó. Kết quả là N-1
 * khung, tức khung cuối của clip — khung mà `tail` sinh ra để người xem kịp nhìn
 * — không tồn tại. `-frames:v` vẫn chặn trần nên dư ra không thành vấn đề.
 */
const fps = (soKhung + 0.5) / thoiLuong;

const filter =
  `[0:v]fps=${fps.toFixed(6)},split=2[a][b];` +
  `[a]scale=${RONG}:-2:flags=lanczos[w];` +
  `[b]scale=${HEP}:-2:flags=lanczos[n]`;

const argsFfmpeg = [
  '-hide_banner',
  '-loglevel',
  'warning',
  '-y',
  '-i',
  args.in,
  '-filter_complex',
  filter,
  '-map',
  '[w]',
  '-frames:v',
  String(soKhung),
  '-q:v',
  String(chatLuong),
  resolve(duongRong, `f_%0${PAD}d.jpg`),
  '-map',
  '[n]',
  '-frames:v',
  String(soKhung),
  '-q:v',
  String(chatLuong),
  resolve(duongHep, `f_%0${PAD}d.jpg`),
];

console.log(
  `Cắt ${soKhung} khung từ ${args.in} (${thoiLuong.toFixed(1)}s, ~${fps.toFixed(2)} khung/giây) …`,
);

const ma = await new Promise((xong) => {
  // `shell: false` (mặc định): đường dẫn có dấu cách là chuyện thường trên
  // Windows, và qua shell thì nó vỡ thành hai tham số.
  const p = spawn('ffmpeg', argsFfmpeg, { stdio: 'inherit' });
  p.on('error', (e) => {
    if (e.code === 'ENOENT') {
      thoat('Không tìm thấy `ffmpeg` trong PATH. Trên Windows: winget install Gyan.FFmpeg');
    }
    thoat(`Chạy ffmpeg thất bại: ${e.message}`);
  });
  p.on('close', xong);
});

if (ma !== 0) thoat(`ffmpeg thoát với mã ${ma}.`);

const [dsRong, dsHep] = (await Promise.all([readdir(duongRong), readdir(duongHep)])).map((ds) =>
  ds.filter((ten) => LA_KHUNG.test(ten)),
);

/*
 * Đếm lại từ ĐĨA chứ không tin `-frames:v`.
 *
 * Video ngắn hơn số khung yêu cầu thì ffmpeg vẫn thoát 0 và chỉ ghi ra bao nhiêu
 * khung nó có. Không đếm lại thì bước sau upload một lô ngắn hơn dự định mà
 * không ai biết, và `span` của effect được chỉnh theo một con số sai.
 */
console.log(`\nXong.`);
console.log(`  ${duongRong} — ${dsRong.length} khung, rộng ${RONG}`);
console.log(`  ${duongHep} — ${dsHep.length} khung, rộng ${HEP}`);
if (dsRong.length < soKhung) {
  console.log(`  Lưu ý: chỉ ra được ${dsRong.length}/${soKhung} khung — video quá ngắn hoặc thưa khung.`);
}
console.log(
  '\nBước tiếp theo — KHÔNG tự chọn thư mục:\n' +
    '  1. Gọi `list_asset_folders`, rồi HỎI chủ dự án lưu vào đâu.\n' +
    '  2. `upload_asset` với folder `<đã chốt>/wide` và `<đã chốt>/narrow`.\n' +
    '  3. `list_assets` theo từng thư mục, TỰ sắp lại theo `key` (tool trả theo ngày tạo,\n' +
    '     tối đa 200 mục một lần — lô trên 200 khung chưa liệt kê hết được), lấy mảng assetId.\n' +
    '  4. `apply_ops` dựng cây node rồi gắn effect `image-sequence`.',
);
