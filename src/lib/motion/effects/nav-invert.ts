/**
 * Header đảo màu khi đang nằm trên nền tối.
 *
 * Port từ ../new-website/js/effects/nav-invert.js. Anh em với nav-collapse và
 * xây cùng một kiểu: quyết định đúng một chuyện, không ghi style nào.
 *
 * ## Thế nào là "tối"
 *
 * Không suy ra từ màu computed. Một bề mặt TỰ khai bằng vai `nav-dark` trong `part`.
 * Khai báo tường minh nghĩa là một section tối trong tương lai không cần sửa
 * dòng code nào ở đây — chỉ cần `setProps { part: "nav-dark" }`.
 *
 * ## Vì sao hit-test chứ không so rect
 *
 * Phép thử hiển nhiên — rect của element đã khai có phủ nav không — SAI với
 * trang này. Các panel của Section 3 xếp chồng: panel mở đầu vẫn nằm trong
 * document và vẫn đen, trong khi panel bước một trượt lên che nó. So rect sẽ
 * giữ nav trắng rất lâu sau khi một thẻ gần trắng đã chiếm màn hình.
 *
 * `elementsFromPoint` trả lời đúng câu hỏi thật sự cần hỏi — cái gì đang nằm
 * TRÊN CÙNG phía sau nav — và kèm hai tính chất miễn phí:
 *   · trả về theo thứ tự hit, tức thứ tự vẽ, nên panel xếp chồng giải đúng mà
 *     không cần biết gì về z-index của Section 3;
 *   · bỏ qua `visibility: hidden`, đúng trạng thái của một panel đã dùng xong.
 *
 * Phải lọc bỏ chính các element của header khỏi danh sách đó: pill là
 * `pointer-events: auto` khi đã thu gọn và sẽ luôn là hit đầu tiên.
 *
 * ## Khác bản gốc
 *
 * Ghi `data-inverted="true"` thay cho class `.is-inverted`, khớp `style.states`.
 */

import { z } from 'zod';

import * as raf from '../raf';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /**
   * Selector đánh dấu bề mặt tối.
   *
   * Mặc định trỏ vào `part`, KHÔNG vào `[data-nav-invert]` như site cũ: không op
   * nào phát ra được attribute đó, nên effect gắn xong nằm im vĩnh viễn và không
   * có lỗi nào. `part` thì `setProps` ghi được, và nó đúng là "hợp đồng với
   * runtime" mà `NodeBase.part` được thiết kế cho.
   *
   * `~=` chứ không `=`: một section vừa là slot của composite vừa là nền tối, nên
   * `part` giữ nhiều vai.
   */
  markerSelector: z.string().default('[data-part~="nav-dark"]'),
});

type Params = z.infer<typeof paramsSchema>;

export default defineEffect<Params>({
  key: 'nav-invert',
  name: 'Thanh điều hướng đảo màu',
  paramsSchema,
  aiDescription:
    'Header đổi sang màu sáng khi trôi qua một section nền tối. Section tối tự đánh dấu bằng vai "nav-dark" trong part — setProps { part: "nav-dark" }, hoặc thêm vai đó vào part đang có nếu node đã là slot của composite. Ghi state "inverted".',
  runtimeCost: 'light',
  statesWritten: ['inverted'],
  appliesTo: ['Section'],
  gates: { respectReducedMotion: false },

  init(el, params) {
    let dirty = false;
    let inverted = false;

    /**
     * Bề mặt ngay sau TÂM của nav có phải nền tối không.
     *
     * Lấy mẫu ở tâm hộp của chính header chứ không phải mép trang: đó là điểm
     * logo và link thật sự được vẽ đè lên, và nó vẫn đúng với bề mặt không
     * full-bleed.
     */
    const overDarkSurface = (): boolean => {
      const rect = el.getBoundingClientRect();
      // Ngoài màn hình hoặc kích thước 0 (display:none, print, viewport sập) —
      // hit-test sẽ vô nghĩa, nên giữ nguyên state hiện tại.
      if (rect.width <= 0 || rect.height <= 0) return inverted;

      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      for (const hit of document.elementsFromPoint(x, y)) {
        if (el.contains(hit)) continue; // bề mặt của chính nav
        return Boolean(hit.closest(params.markerSelector));
      }

      // Không có gì sau nav cả: nền trang mới là cái tối, nhưng chuyện đó chỉ
      // xảy ra quá cuối document, nên coi là sáng và để bề mặt thật quyết định
      // ở frame sau.
      return false;
    };

    const apply = (next: boolean) => {
      inverted = next;
      if (next) el.dataset.inverted = 'true';
      else delete el.dataset.inverted;
    };

    const onScroll = () => {
      dirty = true;
    };

    const onFrame = () => {
      if (!dirty) return;
      dirty = false;
      const next = overDarkSurface();
      if (next === inverted) return;
      apply(next);
    };

    apply(overDarkSurface());

    window.addEventListener('scroll', onScroll, { passive: true });
    const unsubscribe = raf.add(onFrame, raf.PRIORITY.effect + 1);

    return () => {
      unsubscribe();
      window.removeEventListener('scroll', onScroll);
      delete el.dataset.inverted;
    };
  },
});
