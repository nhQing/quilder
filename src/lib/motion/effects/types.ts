/**
 * Hợp đồng của một effect.
 *
 * ## Khác site cũ: init nhận một element và TRẢ VỀ hàm dọn của chính nó
 *
 * Bản gốc dùng `init()` không tham số, tự `querySelectorAll` rồi giữ trạng thái
 * ở cấp module cùng một cờ `active`. Đúng cho một trang tải một lần.
 *
 * Ở đây mỗi lần gắn là một instance độc lập, và instance đó tự sở hữu cleanup
 * của mình. Không còn trạng thái cấp module nghĩa là không có gì để rò rỉ khi
 * React mount/unmount nhiều lần, và hai node cùng gắn `tilt` với tham số khác
 * nhau là chuyện bình thường thay vì không biểu diễn nổi.
 *
 * ## Manifest là thứ AI nhìn thấy
 *
 * AI không bao giờ đọc code effect. Nó đọc manifest: params schema, điều kiện,
 * xung đột, chi phí runtime, và các state mà effect ghi ra. Đây là lý do
 * `paramsSchema` dùng Zod — cùng một schema sinh ra JSON Schema cho tool của AI,
 * validate output của AI, và validate output của inspector panel.
 */

import type { z } from 'zod';

import type { Gates } from '../capabilities';
import type { NodeType } from '@/lib/doc/types';

export type RuntimeCost = 'light' | 'medium' | 'heavy';

/** Trả về hàm dọn. Trả về void nghĩa là không có gì phải dọn. */
export type EffectDispose = (() => void) | void;

export interface EffectModule<P> {
  /** Khớp với Effect.key trong DB. */
  key: string;

  /**
   * Nhãn cho người đọc, tiếng Việt. Hiện trong inspector và trong `list_effects`.
   *
   * Bắt buộc, và nằm ở ĐÂY chứ không ở script đồng bộ: `Effect.name` trong DB là
   * bản sao dẫn xuất, nên nếu nhãn sống trong script thì nó là một nguồn sự thật
   * thứ hai — và nguồn thứ hai bao giờ cũng trôi. Bắt buộc (không `?`) để thêm một
   * effect mới mà quên nhãn là lỗi kiểu, không phải một hàng DB trống.
   */
  name: string;

  /**
   * Nguồn sự thật duy nhất cho tham số.
   *
   * Input khai là `unknown` chứ không phải `P`: tham số đến từ JSONB trong
   * Postgres hoặc từ tool call của AI, tức là dữ liệu không tin được. Và schema
   * dùng `.default()` nên input hợp lệ được phép thiếu trường — khai input = P
   * sẽ khiến TypeScript từ chối đúng những schema có default.
   */
  paramsSchema: z.ZodType<P, z.ZodTypeDef, unknown>;

  /** Mô tả cho AI. Ngắn, viết để retrieval khớp được. */
  aiDescription: string;

  /** Node type gắn được. Bỏ trống = mọi type. */
  appliesTo?: NodeType[];

  /**
   * Tham số KHÔNG có giá trị mặc định, người gắn buộc phải cung cấp.
   *
   * Phần lớn effect gắn vào là chạy được ngay. Vài cái thì không: `counter` cần
   * `to`, vì một bộ đếm không có giá trị đích là vô nghĩa. AI phải biết khác
   * biệt đó trước khi gọi tool, nếu không nó sẽ gắn rồi mới nhận lỗi validate.
   *
   * Test registry đối chiếu danh sách này với việc schema có parse nổi `{}` hay
   * không, nên hai bên không thể lệch.
   */
  requiredParams?: string[];

  /**
   * data-attribute mà effect ghi ra khi chạy, không có tiền tố `data-`.
   * Validator tầng semantic đối chiếu `style.states` với danh sách này, nên
   * không thể tạo ra một state chết mà selector không bao giờ khớp.
   */
  statesWritten?: string[];

  /** Tính vào motion budget của trang. Tối đa 2 effect `heavy`. */
  runtimeCost: RuntimeCost;

  /** Key của effect không được gắn cùng node. */
  conflicts?: string[];

  /** Điều kiện mặc định. Gates trên node ghi đè từng trường. */
  gates?: Gates;

  /**
   * Gắn vào một element. Trả về hàm dọn.
   *
   * Được gọi SAU khi `allows()` đã đồng ý, nên bên trong không cần kiểm
   * reduced-motion hay pointer nữa — runtime đã lo.
   */
  init(el: HTMLElement, params: P): EffectDispose;
}

/** Ép kiểu khi gom nhiều effect có kiểu params khác nhau vào một registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEffectModule = EffectModule<any>;

/** Helper giữ được suy luận kiểu của params từ schema. */
export function defineEffect<P>(mod: EffectModule<P>): EffectModule<P> {
  return mod;
}
