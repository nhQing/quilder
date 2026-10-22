/**
 * Dải ngang ghim lại và trượt theo cuộn dọc.
 *
 * Cuộn tới section thì nó đứng yên tại chỗ, và mỗi vòng lăn chuột đẩy dải thẻ
 * sang trái. Hết thẻ thì section mới nhả ra và trang đi tiếp.
 *
 * ## Ghim bằng CSS, scrub bằng JS — không dùng `pin:` của ScrollTrigger
 *
 * Đây là luật nhà, `panel-stack` và `chapter-parallax` đều theo: *"Việc ghim là
 * `position: sticky` thuần; module này chỉ sở hữu thứ phải bám theo vị trí
 * cuộn."* `pin: true` của ScrollTrigger cắt element ra khỏi luồng rồi chèn một
 * spacer thay chỗ — với Lenis đang eased vị trí cuộn (`motion/scroll.ts`), lớp
 * bù đó trễ một frame so với sticky của trình duyệt và mép ghim rung. Sticky thì
 * do compositor lo, không bao giờ lệch pha.
 *
 * Nên effect này cần cây node có hình dạng:
 *
 *   section            ← effect ghi `height` lên đây: đường băng
 *     [part="pin"]     ← `position: sticky; top: 0` — do NGƯỜI đặt ở tầng nội dung
 *       …
 *       [part="viewport"]   ← scrollport, `overflow-x: auto`
 *         track             ← con đầu tiên, rộng hơn scrollport
 *
 * ## Đường băng do effect sở hữu, không phải do node
 *
 * Chiều cao đường băng = chiều cao khối ghim + phần thừa ngang, mà phần thừa
 * ngang phụ thuộc số thẻ, bề rộng màn và cả font đã tải xong hay chưa. Không có
 * con số nào viết vào node là đúng ở mọi lúc.
 *
 * Cho effect ghi nó còn một hệ quả quan trọng hơn: khi effect KHÔNG chạy —
 * reduced motion, hoặc màn hẹp hơn `minBreakpoint` — không có ai ghi chiều cao,
 * nên section trở lại chiều cao tự nhiên và dải quay về đúng một scrollport vuốt
 * tay được. Đó là hành vi đúng cho cả hai nhóm, và nó tự đến chứ không phải thêm
 * một nhánh điều kiện. Nếu chiều cao nằm ở node thì lúc effect tắt sẽ còn lại
 * một khoảng trống cao bằng cả màn hình mà không ai giải thích được.
 *
 * ## Vì sao đẩy `scrollLeft` chứ không `transform`
 *
 * `transform: translateX` mượt hơn một chút, nhưng scrollport vẫn cuộn được bằng
 * trackpad ngang và bằng phím — và lúc đó hai hệ toạ độ chồng lên nhau: người
 * dùng đẩy `scrollLeft` trong khi effect đẩy `translateX`, ra tổng của cả hai.
 * Đẩy `scrollLeft` thì chỉ có MỘT nguồn sự thật, `Tab` tới thẻ khuất vẫn cuộn
 * đúng chỗ, và thanh cuộn ngang (nếu hệ điều hành vẽ) vẫn nói thật.
 *
 * Đổi lại phải tắt `scroll-snap-type` trong lúc scrub: snap sẽ kéo vị trí về mốc
 * gần nhất ngay giữa lượt, và dải giật từng nấc thay vì trượt.
 *
 * ## Chỗ này KHÔNG có trong bản thiết kế
 *
 * `screens/trang-chu` cho dải này cuộn tay tự do (`js/effects/drag-scroll.js` +
 * `scroll-snap`). Ghim-và-scrub là yêu cầu thêm của chủ dự án ngày 11/09/2026,
 * không phải port. Ai đối chiếu với bản thiết kế sau này sẽ thấy lệch ở đây và
 * lệch là CỐ Ý.
 */

import { z } from 'zod';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Vai của khối `position: sticky` bên trong section. */
  pinPart: z.string().min(1).max(40).default('pin'),

  /** Vai của scrollport ngang. Cùng tên vai mà `carousel` đang dùng. */
  viewportPart: z.string().min(1).max(40).default('viewport'),

  /**
   * Giữ thêm bao lâu sau khi dải đã chạy hết, tính theo phần chiều cao viewport.
   *
   * 0 nghĩa là thẻ cuối vừa vào khung thì section nhả ngay. Một nhịp giữ ngắn
   * (0.2–0.4) cho người đọc kịp nhìn thẻ cuối trước khi trang đi tiếp — nếu
   * không, thẻ cuối là thứ duy nhất không ai kịp đọc.
   */
  tail: z.number().min(0).max(2).default(0),
});

type Params = z.infer<typeof paramsSchema>;

export default defineEffect<Params>({
  key: 'rail-pin',
  name: 'Dải ngang ghim theo cuộn',
  paramsSchema,
  aiDescription:
    'Section đứng yên khi cuộn tới, và cuộn tiếp sẽ đẩy dải thẻ ngang trượt sang trái; hết dải thì trang mới đi tiếp. Cần một khối con part "pin" đặt position sticky top 0, bên trong có scrollport part "viewport". Không chạy trên màn hẹp và khi người dùng tắt chuyển động — lúc đó dải quay về vuốt tay bình thường.',
  appliesTo: ['Section'],
  runtimeCost: 'medium',
  statesWritten: ['rail-pin-ready'],
  // Ghim cuộn trên màn hẹp là cướp cử chỉ vuốt mà người dùng dùng để đi tiếp.
  // Dưới md thì dải vẫn vuốt ngang được như thiết kế gốc.
  gates: { minBreakpoint: 'md' },
  // Cả hai đều ghi `height` lên chính section này để dựng đường băng; gắn chồng
  // thì cái sau ghi đè con số của cái trước và cả hai cùng scrub sai. Quan hệ
  // khai hai chiều — xem `conflicts` trong `image-sequence.ts`.
  conflicts: ['image-sequence'],

  init(el, params) {
    const pin = el.querySelector<HTMLElement>(`[data-part~="${params.pinPart}"]`);
    const viewport = el.querySelector<HTMLElement>(`[data-part~="${params.viewportPart}"]`);
    const track = viewport?.firstElementChild as HTMLElement | null | undefined;

    // Thiếu một trong ba thì im lặng bỏ qua: một section chưa dựng xong không
    // đáng làm sập trang. Cùng lý lẽ với `panel-stack` khi không có slot nào.
    if (!pin || !viewport || !track) return;

    gsap.registerPlugin(ScrollTrigger);

    /** Phần thừa ngang, px. Hàm chứ không phải giá trị: nó đổi khi resize. */
    const thua = () => Math.max(0, track.scrollWidth - viewport.clientWidth);

    /**
     * Ghi chiều cao đường băng.
     *
     * Đo `pin.offsetHeight` chứ không phải `el`: `el` chính là thứ ta đang ghi
     * chiều cao lên, nên đọc nó là đọc lại con số của lần trước và đường băng sẽ
     * cộng dồn mỗi lần refresh.
     */
    const dat = () => {
      const t = thua();
      if (t <= 0) {
        // Không thừa gì thì không có gì để scrub — trả section về chiều cao tự
        // nhiên thay vì ghim một dải đã vừa màn.
        el.style.removeProperty('height');
        return;
      }
      el.style.height = `${pin.offsetHeight + t + window.innerHeight * params.tail}px`;
    };

    dat();

    const snapCu = viewport.style.scrollSnapType;
    viewport.style.scrollSnapType = 'none';

    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      invalidateOnRefresh: true,
      // `onRefresh` chạy trước khi ScrollTrigger đo lại start/end, nên chiều cao
      // mới đã có mặt lúc nó đo. Đặt ở `onRefreshInit` thì nó đo chiều cao cũ.
      onRefreshInit: dat,
      onUpdate: (self) => {
        const t = thua();
        if (t <= 0) return;
        // `tail` là nhịp giữ ở CUỐI, nên tiến độ phải được kéo giãn để dải chạy
        // hết trước nhịp đó, rồi đứng yên. Không có phép chia này thì `tail` chỉ
        // làm dải trượt chậm đi chứ không tạo ra nhịp giữ nào.
        const span = t / (t + window.innerHeight * params.tail);
        const p = span > 0 ? Math.min(1, self.progress / span) : self.progress;
        viewport.scrollLeft = p * t;
      },
    });

    /** Biên phải đo lại sau khi font thật về, và sau mỗi lần đổi khổ màn. */
    const refresh = () => ScrollTrigger.refresh();
    void document.fonts?.ready.then(refresh);
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);

    el.dataset.railPinReady = 'true';

    return () => {
      st.kill();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      el.style.removeProperty('height');
      // Trả dải về đầu: bỏ lại nó ở giữa chừng sau một lần điều hướng phía client
      // là để người dùng quay lại thấy một dải đã trượt sẵn mà không hiểu vì sao.
      viewport.scrollLeft = 0;
      if (snapCu) viewport.style.scrollSnapType = snapCu;
      else viewport.style.removeProperty('scroll-snap-type');
      delete el.dataset.railPinReady;
    };
  },
});
