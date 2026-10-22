/**
 * Clip chạy theo cuộn — một lô ảnh, hoán khung theo vị trí cuộn.
 *
 * Cuộn tới section thì nó đứng yên, và mỗi vòng lăn chuột đẩy clip tiến thêm
 * một khung. Cuộn ngược thì clip chạy lùi.
 *
 * ## Vì sao ẢNH chứ không phải `<video>`
 *
 * Tua `video.currentTime` buộc trình giải mã nhảy về keyframe gần nhất rồi giải
 * mã tới, nên hình giật và trễ; iOS Safari tệ hơn nữa. Ảnh đã decode sẵn trong
 * RAM nên đổi `src` là tức thì.
 *
 * Cái giá là băng thông, và đó là đánh đổi DUY NHẤT của kỹ thuật này. Nó được
 * trả bằng ba tầng rơi về (xem `gates` bên dưới) và bằng hai lô ảnh rộng/hẹp.
 *
 * ## Vì sao đổi `img.src` chứ không vẽ vào `<canvas>`
 *
 * Bản thiết kế đầu (`docs/superpowers/specs/2026-09-23-image-sequence-design.md`
 * §1/§4) chọn node `Canvas` + `drawImage`. Đổi ngày 23/09/2026 sau khi đối chiếu
 * với bản ĐÃ CHẠY THẬT ở site tĩnh cũ (commit
 * "hero dùng chuỗi 60 khung ảnh thay video 20.8 MB"): bản đó hoán
 * `img.src` và nó chạy trên site thật.
 *
 * Ba thứ thắng được nhờ bỏ canvas:
 *
 *  - Không phải thêm `'sequence'` vào enum `program` của `doc/schema.ts` — một
 *    thay đổi lan sang validator, inspector, preset và mọi doc đã publish.
 *  - Fallback KHÔNG phải viết: thẻ `<img>` với khung đầu đã nằm sẵn trong HTML
 *    do server render. Effect bị cổng chặn thì người dùng vẫn thấy một tấm ảnh
 *    thật, không phải một ô trống chờ JS.
 *  - `object-fit: cover` là việc của CSS trên node Image, không phải phép tính
 *    `drawImage` chín tham số viết tay. Canvas không có `object-fit`; `<img>` có.
 *
 * ## Cây node mà effect này cần
 *
 *   Section                        ← effect gắn Ở ĐÂY, nó ghi `height` đường băng
 *     [part="pin"]                 ← `position: sticky; top: 0` — do NGƯỜI đặt
 *       [part="frame"]  → <img>    ← effect hoán `src` của thẻ img bên trong
 *       …                          ← chữ, nút, gì cũng được
 *
 * `part="frame"` đặt trên NODE IMAGE. Tuỳ asset có sẵn width/height hay không,
 * renderer đặt `data-part` thẳng lên `<img>` hoặc lên một `<span>` bọc nó
 * (`NodeRenderer.tsx`), nên effect nhận cả hai: lấy khối mang vai, nếu nó chưa
 * phải `<img>` thì lấy `img` bên trong. Viết thẳng `querySelector('img')` trên cả
 * section là sai ngay khi section có thêm một icon.
 *
 * ## Ghim bằng CSS, scrub bằng JS — không dùng `pin:` của ScrollTrigger
 *
 * Luật nhà, giống `rail-pin`/`panel-stack`/`chapter-parallax`: việc ghim là
 * `position: sticky` thuần. `pin: true` của ScrollTrigger cắt element ra khỏi
 * luồng rồi chèn spacer thay chỗ — với Lenis đang eased vị trí cuộn
 * (`motion/scroll.ts`), lớp bù đó trễ một frame so với sticky của trình duyệt và
 * mép ghim rung. Docblock đầy đủ nằm ở `rail-pin.ts`.
 *
 * ## Đường băng do effect sở hữu, không phải do node
 *
 * Cũng như `rail-pin`: chiều cao phụ thuộc chiều cao khối ghim và chiều cao
 * viewport, không con số nào viết vào node là đúng ở mọi lúc. Quan trọng hơn,
 * khi effect KHÔNG chạy (reduced motion, `saveData`, RAM ≤ 2 GB) thì không ai
 * ghi chiều cao, nên section trở về chiều cao tự nhiên và người dùng thấy đúng
 * một tấm ảnh tĩnh. Nếu chiều cao nằm ở node thì lúc effect tắt sẽ còn lại một
 * khoảng trống cao bằng mấy màn hình mà không ai giải thích được.
 *
 * ## Ba cái bẫy đã cắn thật
 *
 * 1. **`srcset` thắng `src`.** `next/image` phát `<img srcset sizes>`; trình
 *    duyệt chọn ứng viên trong `srcset` và PHỚT LỜ `src`. Gán `img.src` mà không
 *    gỡ `srcset` trước thì clip đứng im ở khung đầu và không có lỗi nào. Nên
 *    effect gỡ `srcset`/`sizes` ngay TRƯỚC lần gán `src` đầu tiên — không sớm
 *    hơn: gỡ lúc init thì trình duyệt chọn lại `src` của `next/image` (bản
 *    optimizer rộng nhất), tải thêm một ảnh lớn và nháy — rồi trả lại lúc dọn.
 * 2. **Preload cả lô trước khi cho tua.** Bản tham chiếu ghi rõ: không preload
 *    thì cuộn nhanh sẽ NHÁY TRẮNG ở những khung chưa từng tải. Ở đây còn đi xa
 *    hơn một bước — trong lúc lô chưa về đủ, scrub hoán sang KHUNG GẦN NHẤT ĐÃ
 *    TẢI (§4 của spec). Nháy trắng là không thể xảy ra, vì `src` chỉ bao giờ trỏ
 *    tới một URL đã nằm trong cache; và clip giật một nhịp vẫn tốt hơn đứng hình
 *    cho tới khi byte cuối cùng về.
 * 3. **Giữ tham chiếu tới `new Image()`.** Thả nó cho GC là mời trình duyệt xoá
 *    ảnh khỏi bộ nhớ giải mã, và khung đã tải thành khung phải tải lại.
 *
 * ## URL khung KHÔNG đi qua `/_next/image`
 *
 * `collectEffects` resolve assetId thành URL GỐC của asset. Đi qua optimizer cho
 * AVIF nhỏ hơn ~40%, nhưng 120 ảnh là 120 lượt transform ở lần tải đầu — trên
 * máy chủ yếu đó là một lượt treo, và triệu chứng của nó (trang trắng lần đầu,
 * bình thường lần sau) rất khó truy. Bù lại bằng nén mạnh lúc cắt khung
 * (`scripts/video-to-frames.mjs`). Đánh đổi có ý thức, đảo lại được.
 */

import { z } from 'zod';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { BREAKPOINTS } from '@/lib/design/breakpoints';
import { atLeast } from '../capabilities';
import { defineEffect } from './types';

/**
 * Trần 400 khung, hai lô.
 *
 * Không phải con số tròn cho đẹp: 400 khung JPEG nén mạnh là ~12 MB, đã là mức
 * mà một kết nối 3G không tải xong trong một lượt cuộn. Trần ở schema để một
 * tool gọi sai không dựng ra được một section tự nó là một sự cố.
 */
const MAX_FRAMES = 400;

const paramsSchema = z.object({
  /**
   * Lô rộng. Mảng assetId lúc nằm trong doc; `collectEffects` đổi thành URL
   * trước khi tới đây. BẮT BUỘC — một sequence không có khung là vô nghĩa.
   */
  frames: z.array(z.string().min(1)).min(2).max(MAX_FRAMES),

  /** Lô hẹp cho màn nhỏ. Rỗng = dùng chung lô rộng. */
  framesNarrow: z.array(z.string().min(1)).max(MAX_FRAMES).default([]),

  /** Dưới mốc này thì lấy lô hẹp. */
  narrowBelow: z.enum(BREAKPOINTS).default('md'),

  /**
   * Lô siêu rộng cho màn lớn / màn mật độ cao. Rỗng = không có bậc này.
   *
   * Thêm 25/09/2026: lô rộng 1920px phóng lên màn 2560 là mờ thấy rõ.
   */
  framesSuper: z.array(z.string().min(1)).max(MAX_FRAMES).default([]),

  /**
   * Từ bao nhiêu ĐIỂM ẢNH THẬT thì lấy lô siêu rộng: `innerWidth × devicePixelRatio`.
   *
   * Theo điểm ảnh thật chứ không theo breakpoint: laptop 1440 màn Retina vẽ 2880
   * điểm ảnh, tức mờ y như màn 2560 nếu nhận lô 1920. Mặc định 2200 ≈ nơi lô 1920
   * bắt đầu bị phóng quá ~15%.
   */
  superMinPx: z.number().min(0).max(10000).default(2200),

  /**
   * Thư mục asset đã sinh ra lô này.
   *
   * CHỈ là metadata cho tool biết đường làm mới. Lúc render không ai đọc nó, nên
   * `frames` vẫn là nguồn sự thật duy nhất — thả thêm một ảnh vào thư mục không
   * đổi được site đang chạy mà không qua Publish.
   */
  folder: z.string().max(120).default(''),

  /**
   * Đường băng dài bao nhiêu màn hình. Đây là thứ sẽ được chỉnh nhiều nhất: nó
   * quyết định clip chạy nhanh hay chậm so với vòng lăn chuột.
   */
  span: z.number().min(1).max(10).default(3),

  /**
   * Giữ thêm bao lâu sau khi clip đã hết, tính theo phần chiều cao viewport.
   *
   * 0 nghĩa là khung cuối vừa hiện thì section nhả ngay. Một nhịp giữ ngắn
   * (0.2–0.4) cho người xem kịp nhìn khung cuối — nếu không, khung cuối là thứ
   * duy nhất không ai kịp thấy. Cùng ngữ nghĩa với `tail` của `rail-pin`.
   */
  tail: z.number().min(0).max(2).default(0),

  /** Vai của khối `position: sticky` bên trong section. */
  pinPart: z.string().min(1).max(40).default('pin'),

  /** Vai của node Image mang khung hình. */
  framePart: z.string().min(1).max(40).default('frame'),
});

type Params = z.infer<typeof paramsSchema>;

/* ── Số học thuần, tách ra để test được không cần DOM ──────────────────── */

/**
 * Tiến độ cuộn thô → tiến độ CLIP, sau khi trừ nhịp giữ ở cuối.
 *
 * `tail` là nhịp giữ ở CUỐI, nên tiến độ phải được kéo giãn để clip chạy hết
 * TRƯỚC nhịp đó rồi đứng yên. Không có phép chia này thì `tail` chỉ làm clip
 * chạy chậm đi chứ không tạo ra nhịp giữ nào — và đó là kiểu sai không ai nhìn
 * ra khi đọc code, chỉ thấy khi cuộn.
 *
 * `span` luôn ≥ 1 theo schema nên mẫu số không bao giờ bằng 0.
 */
export function seqProgress(progress: number, span: number, tail: number): number {
  const raw = Math.min(1, Math.max(0, progress));
  const phan = span / (span + tail);
  if (!(phan > 0)) return raw;
  return Math.min(1, raw / phan);
}

/**
 * Tiến độ 0..1 → chỉ số khung, 0-based.
 *
 * `Math.round` chứ không `Math.floor`: với floor thì khung CUỐI chỉ hiện đúng
 * tại `p === 1` — một điểm duy nhất mà cuộn eased gần như không bao giờ dừng
 * đúng vào. Triệu chứng là "clip không bao giờ chạy hết khung cuối".
 */
export function frameAt(p: number, count: number): number {
  if (count <= 1) return 0;
  const raw = Math.round(Math.min(1, Math.max(0, p)) * (count - 1));
  return Math.min(count - 1, Math.max(0, raw));
}

/**
 * Khung gần nhất ĐÃ TẢI quanh `want`. Trả `-1` khi chưa có khung nào.
 *
 * Dò đều hai phía để clip lúc đang tải vẫn chạy đúng hướng thay vì dính về khung
 * đầu. Trả `-1` chứ không trả 0: chỉ số 0 khi khung 0 chưa tải sẽ làm `src` trỏ
 * vào một URL chưa có trong cache — đúng cái nháy trắng cần tránh.
 */
export function nearestLoaded(loaded: readonly boolean[], want: number): number {
  if (loaded[want]) return want;
  for (let d = 1; d < loaded.length; d += 1) {
    if (loaded[want - d]) return want - d;
    if (loaded[want + d]) return want + d;
  }
  return -1;
}

/**
 * Lô nào được dùng ở bề rộng hiện tại.
 *
 * Nằm TRONG `init()` chứ không phải trong `gates`: `allows()` chỉ chạy một lần
 * lúc khởi tạo và nó chỉ biết cho qua hay chặn, không biết đổi tham số.
 *
 * Ngưỡng là 2 chứ không phải 1: một "lô hẹp" chỉ có một khung không phải lô hẹp,
 * nó là một lô dựng dở, và rơi vào nó là clip đứng hình trên đúng nhóm máy yếu.
 *
 * Chọn MỘT LẦN rồi giữ nguyên cả vòng đời. Xoay ngang điện thoại không đổi lô —
 * cố ý: lô đã tải xong rồi, tải lại vài MB để đổi sang bản rộng hơn là trả một
 * cái giá thật để đổi lấy một khác biệt không ai nhìn ra giữa lượt cuộn.
 */
export function loChon(
  params: Pick<Params, 'frames' | 'framesNarrow' | 'framesSuper' | 'narrowBelow' | 'superMinPx'>,
  man: { rongNhat: boolean; diemAnh: number } = {
    rongNhat: atLeast(params.narrowBelow),
    diemAnh: typeof window === 'undefined' ? 0 : window.innerWidth * (window.devicePixelRatio || 1),
  },
): string[] {
  if (params.framesNarrow.length >= 2 && !man.rongNhat) return params.framesNarrow;
  if (params.framesSuper.length >= 2 && man.diemAnh >= params.superMinPx) return params.framesSuper;
  return params.frames;
}

/** Bao nhiêu ảnh được tải song song. Xem ghi chú ở chỗ gọi. */
const SONG_SONG = 6;

export default defineEffect<Params>({
  key: 'image-sequence',
  name: 'Clip chạy theo cuộn',
  paramsSchema,
  aiDescription:
    'Section đứng yên khi cuộn tới, và cuộn tiếp sẽ tua một lô ảnh như một đoạn clip; ' +
    'cuộn ngược thì clip chạy lùi. Cần một khối con part "pin" đặt position sticky top 0, ' +
    'bên trong có một node Image mang part "frame" — effect hoán src của chính thẻ ảnh đó. ' +
    'Tham số `frames` là mảng assetId đã sắp đúng thứ tự khung (dùng scripts/video-to-frames.mjs ' +
    'để cắt video rồi upload_asset theo thư mục). `span` là số màn hình mà clip chạy hết. ' +
    'Nặng băng thông nhất trong cả hệ: không chạy khi người dùng tắt chuyển động, bật tiết kiệm ' +
    'dữ liệu, hoặc máy có RAM thấp — lúc đó người dùng thấy đúng khung đầu như một ảnh tĩnh.',
  appliesTo: ['Section'],
  // Effect đầu tiên mang hạng này. Motion budget cho tối đa 2 `heavy` mỗi trang;
  // đó là hạn mức đúng cho thứ tải hàng MB ảnh.
  runtimeCost: 'heavy',
  statesWritten: ['seq-ready'],
  // `minTier: 'full'` là có chủ đích, không phải thận trọng thừa: đây là effect
  // tốn băng thông nhất trong cả hệ, và `capabilities.ts` ghi rõ "phần lớn
  // traffic VN là Android tầm trung". `saveData` hoặc RAM ≤ 2 GB thì KHÔNG tải
  // một MB nào — người dùng thấy khung đầu, section cao tự nhiên.
  //
  // KHAI LẶP LẠI trong `registry.ts`. Lệch là `registry.test.ts` đỏ.
  gates: { minTier: 'full' },
  // Cả hai đều ghi `height` hoặc ghim section; chồng nhau là hỏng cả hai. Quan hệ
  // HAI CHIỀU — rail-pin khai ngược lại 'image-sequence'. Effect ghim của gói dự án
  // (ví dụ panel-stack) tự khai xung đột với effect này; validator đọc cả hai phía.
  conflicts: ['rail-pin'],
  requiredParams: ['frames'],

  init(el, params) {
    const pin = el.querySelector<HTMLElement>(`[data-part~="${params.pinPart}"]`);
    const khoi = el.querySelector<HTMLElement>(`[data-part~="${params.framePart}"]`);
    // Node Image render thành `<span data-part><img></span>`, nên vai nằm ở lớp
    // bọc. Nhận cả trường hợp vai rơi thẳng lên `<img>` để không phụ thuộc vào
    // một chi tiết của renderer.
    const img =
      khoi instanceof HTMLImageElement ? khoi : khoi?.querySelector<HTMLImageElement>('img');

    // Thiếu một trong hai thì im lặng bỏ qua: một section chưa dựng xong không
    // đáng làm sập trang. Cùng lý lẽ với `rail-pin` và `panel-stack`.
    if (!pin || !img) return;

    const lo = loChon(params);
    if (lo.length < 2) return;

    gsap.registerPlugin(ScrollTrigger);

    /*
     * Nhớ `srcset`/`sizes` để trả lại lúc dọn. Chúng được GỠ trong `hoan`, ngay
     * trước lần gán `src` đầu tiên — xem bẫy số 1 ở docblock đầu file.
     */
    const srcCu = img.getAttribute('src');
    const srcsetCu = img.getAttribute('srcset');
    const sizesCu = img.getAttribute('sizes');

    /*
     * `decoding="async"` là thứ làm clip NHẤP NHÁY (25/09/2026).
     *
     * `next/image` phát `decoding="async" loading="lazy"`. Với `async`, mỗi lần đổi
     * `src` trình duyệt được phép vẽ khung hình kế tiếp TRƯỚC khi ảnh mới giải mã
     * xong — tức vẽ một nhịp trống giữa hai khung. Đã đo: 60/60 khung nằm sẵn
     * trong cache, không request nào khi cuộn, `complete` luôn đúng — mà vẫn nháy.
     * Ảnh đã decode sẵn (xem `taiMot`) nên `sync` không làm chậm gì.
     */
    const decodingCu = img.getAttribute('decoding');
    const loadingCu = img.getAttribute('loading');
    img.decoding = 'sync';
    img.loading = 'eager';

    let song = true;
    const daTai: boolean[] = new Array(lo.length).fill(false);
    /* Giữ tham chiếu: thả cho GC là mời trình duyệt xoá ảnh khỏi bộ nhớ giải mã. */
    const giu: HTMLImageElement[] = new Array(lo.length);
    /** Lượt tải đang dở — dọn dẹp phải huỷ được chúng, xem cuối `init`. */
    const dangTai = new Map<HTMLImageElement, () => void>();

    let dangHien = -1;

    /** Hoán khung theo tiến độ clip. Không bao giờ trỏ `src` vào URL chưa tải. */
    const hoan = (p: number) => {
      // Ghi tiến độ ra ngoài cho CSS. Chi phí gần bằng 0, và nó là móc để đợt sau
      // cắm "chữ đổi theo mốc tiến độ" vào mà không phải viết lại effect.
      el.style.setProperty('--seq-progress', String(p));

      const co = nearestLoaded(daTai, frameAt(p, lo.length));
      if (co < 0 || co === dangHien) return;
      if (dangHien < 0) {
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
      }
      dangHien = co;
      img.src = lo[co]!;
    };

    const taiMot = (i: number) =>
      new Promise<void>((xong) => {
        const pre = new Image();
        const ket = () => {
          dangTai.delete(pre);
          xong();
        };
        pre.decoding = 'async';
        pre.onload = () => {
          // "Đã tải" nghĩa là ĐÃ GIẢI MÃ, không chỉ đã về byte: một khung chưa
          // decode mà được gán vào `src` là một nhịp trống giữa lượt cuộn.
          pre.decode().catch(() => undefined).then(() => {
            if (!song) return;
            daTai[i] = true;
            ket();
          });
        };
        // Lỗi thì KHÔNG đánh dấu đã tải: `nearestLoaded` sẽ nhảy qua khung đó
        // thay vì trỏ `src` vào một URL 404 và hiện icon ảnh vỡ giữa clip.
        pre.onerror = ket;
        dangTai.set(pre, ket);
        pre.src = lo[i]!;
        giu[i] = pre;
      });

    /*
     * Khung đầu tải trước và hiện ngay, rồi phần còn lại tải song song tối đa 6
     * request một lúc để không bóp nghẹt kết nối.
     *
     * Khung đầu đi riêng vì thẻ `<img>` đang hiện bản đã qua `/_next/image` —
     * một URL KHÁC với `lo[0]`. Không hoán nó sớm thì cú hoán đầu tiên rơi vào
     * giữa lượt cuộn và người dùng thấy một nhịp tải giữa clip.
     */
    let con = 1;
    const tho = async () => {
      while (song) {
        const i = con;
        con += 1;
        if (i >= lo.length) return;
        await taiMot(i);
      }
    };

    /**
     * Ghi chiều cao đường băng.
     *
     * Đo `pin.offsetHeight` chứ không phải `el`: `el` chính là thứ ta đang ghi
     * chiều cao lên, nên đọc nó là đọc lại con số của lần trước và đường băng sẽ
     * cộng dồn mỗi lần refresh. Bẫy này `rail-pin` đã cắn.
     */
    const dat = () => {
      el.style.height = `${pin.offsetHeight + window.innerHeight * (params.span + params.tail)}px`;
    };

    dat();

    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      /*
       * Đo đường băng bằng đúng quãng mà khối pin DÍNH, không phải `bottom bottom`.
       *
       * Sticky dính từ lúc mép trên section chạm đỉnh màn tới lúc mép dưới section
       * chạm mép dưới khối pin — quãng `el.height − pin.height`, tức đúng
       * `innerHeight × (span + tail)` theo `dat()`. `bottom bottom` đo
       * `el.height − innerHeight`, hai số chỉ trùng khi pin cao đúng 100vh; pin
       * thấp hơn thì clip chạy xong SAU khi section đã nhả, và nhịp `tail` lệch.
       */
      end: () => `+=${window.innerHeight * (params.span + params.tail)}`,
      scrub: true,
      invalidateOnRefresh: true,
      // `onRefreshInit` chạy TRƯỚC khi ScrollTrigger đo lại start/end, nên chiều
      // cao mới đã có mặt lúc nó đo.
      onRefreshInit: dat,
      onUpdate: (self) => hoan(seqProgress(self.progress, params.span, params.tail)),
    });

    /*
     * Tải bắt đầu SAU khi `st` đã dựng xong, không phải trước.
     *
     * Không phải để làm vừa lòng TDZ — mà vì lượt tải nào xong cũng muốn hỏi
     * "vị trí cuộn hiện giờ ở đâu", và câu hỏi đó chỉ có người trả lời khi
     * ScrollTrigger đã đo xong đường băng.
     */
    const batDauTai = async () => {
      await taiMot(0);
      if (!song) return;
      // Theo vị trí cuộn THẬT lúc này, không phải 0: người dùng có thể mở trang
      // bằng một anchor rơi thẳng vào giữa section.
      hoan(seqProgress(st.progress, params.span, params.tail));
      el.dataset.seqReady = 'true';
      await Promise.all(Array.from({ length: SONG_SONG }, tho));
      // Lô về đủ thì đặt lại một lần theo vị trí cuộn hiện tại: trong lúc tải,
      // `hoan` đã dính vào khung gần nhất có sẵn và nó có thể lệch khung đúng.
      if (song) hoan(seqProgress(st.progress, params.span, params.tail));
    };

    /*
     * Và chỉ tải khi section đã ở trong tầm MỘT màn hình (24/09/2026).
     *
     * Lô là 5–12 MB. Tải ngay lúc trang mở là để nó tranh băng thông với ảnh lớn
     * nhất màn đầu (LCP) cho một section có thể nằm tít bên dưới mà người dùng
     * chưa chắc cuộn tới. Một màn hình đi trước là đủ để khung đầu kịp về trước khi
     * section chạm đỉnh — khung đầu SSR vẫn nằm sẵn trong HTML trong lúc chờ.
     *
     * Không có `IntersectionObserver` (trình duyệt quá cũ) thì tải ngay như trước.
     */
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          io = null;
          void batDauTai();
        },
        { rootMargin: '100% 0px' },
      );
      io.observe(el);
    } else {
      void batDauTai();
    }

    /** Đường băng tính theo `innerHeight`, nên đổi khổ màn là phải đo lại. */
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);

    return () => {
      song = false;
      io?.disconnect();
      /*
       * Huỷ mọi lượt tải đang dở. `song = false` chỉ chặn lượt KẾ TIẾP; không huỷ
       * thì sau một lần điều hướng phía client vẫn còn tới 6 request chạy tiếp cho
       * một trang đã rời đi. Gọi `ket` để promise của `tho` khép lại thay vì treo.
       */
      for (const [pre, ket] of dangTai) {
        pre.onload = null;
        pre.onerror = null;
        pre.src = '';
        ket();
      }
      giu.length = 0;
      st.kill();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      el.style.removeProperty('height');
      el.style.removeProperty('--seq-progress');
      delete el.dataset.seqReady;

      /*
       * Trả thẻ ảnh về đúng HTML mà server đã render.
       *
       * Bỏ nó ở khung giữa chừng sau một lần điều hướng phía client là để người
       * dùng quay lại thấy một clip đã tua sẵn mà không hiểu vì sao — cùng lý do
       * `rail-pin` trả `scrollLeft` về 0.
       */
      if (srcCu !== null) img.setAttribute('src', srcCu);
      if (srcsetCu !== null) img.setAttribute('srcset', srcsetCu);
      if (sizesCu !== null) img.setAttribute('sizes', sizesCu);
      if (decodingCu !== null) img.setAttribute('decoding', decodingCu);
      else img.removeAttribute('decoding');
      if (loadingCu !== null) img.setAttribute('loading', loadingCu);
      else img.removeAttribute('loading');
    };
  },
});
