/**
 * Ô chọn "Gửi tới" (Form) / "Nguồn số liệu" (NavChart) của Inspector — phần thuần.
 *
 * ## Vì sao ở file riêng
 *
 * Cùng lý lẽ với `node-label.ts`: hàm thuần ở file thuần, không import store, không
 * import component, nên test không phải dựng gì. `EndpointPicker.tsx` chỉ còn phần vẽ
 * và một lần `dispatch`.
 *
 * ## Vì sao khoá đang dùng LUÔN có trong danh sách, kể cả khi bảng không có nó
 *
 * Một `<select>` có `value` không khớp option nào sẽ HIỆN option đầu tiên. Inspector
 * khi đó nói form gửi tới `contact` trong khi thật ra nó đang tắt vì khoá `newsletter`
 * chưa có URL — và người dùng tin thứ họ thấy. Chọn lại đúng option đang hiện thì
 * `onChange` không bắn, nên họ cũng không có cách nào "sửa" cho khớp.
 */

import { parseCompositeParams } from '@/lib/composites/registry';
import type { EndpointTable } from '@/lib/doc/endpoint-table';

export interface EndpointOption {
  key: string;
  /** Host của URL, kèm cổng nếu có. `null` khi khoá không có URL dùng được. */
  host: string | null;
  /**
   * Form / biểu đồ trỏ vào khoá này bị TẮT lúc render: bảng chưa có khoá, hoặc URL
   * không phải http(s) — đúng hai ca mà `siteEndpoint` trả `null`.
   */
  missing: boolean;
  /** Chữ trong `<option>`, ví dụ `subscribe — api.ten-mien.vn`. */
  label: string;
}

/**
 * Host để nhận ra URL: đủ phân biệt staging với production mà không tràn ô chọn
 * rộng 280px. Đường dẫn đầy đủ nằm ở màn Cài đặt.
 */
function hostOf(url: string): string | null {
  // Cùng luật với `siteEndpoint`: `URL` parse được `javascript:` nhưng render thì không nhận.
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * Các lựa chọn: mọi khoá trong bảng, cộng khoá đang dùng nếu bảng chưa có — sắp A→Z.
 *
 * Sắp theo tên chứ không đưa khoá thiếu lên đầu: danh sách ngắn, và thứ tự đổi theo
 * trạng thái nghĩa là cùng một bảng hiện hai thứ tự ở hai form khác nhau.
 */
export function endpointOptions(table: EndpointTable, current: string): EndpointOption[] {
  const keys = new Set(Object.keys(table));
  if (current) keys.add(current);

  return [...keys].sort().map((key) => {
    // `hasOwn` chứ không `table[key]`: `constructor` là một khoá hợp lệ theo
    // `ENDPOINT_KEY_RE`, và trên object thường nó trả về một hàm của prototype.
    const url = Object.hasOwn(table, key) ? table[key] : undefined;
    const host = url === undefined ? null : hostOf(url);
    const label =
      url === undefined ? `${key} — chưa có URL`
      : host ? `${key} — ${host}`
      : `${key} — URL không hợp lệ`;
    return { key, host, missing: host === null, label };
  });
}

/** `params` thô là một object thường — thứ duy nhất trải ra được mà không sinh rác. */
function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

/**
 * Khoá CÓ HIỆU LỰC của một Form / NavChart — đúng khoá renderer dùng, kể cả mặc định.
 *
 * Đọc qua `parseCompositeParams` chứ không đọc thẳng `params.endpointKey`: params thiếu
 * khoá thì renderer lấy mặc định (`newsletter` / `nav`), và params hỏng ở BẤT KỲ field
 * nào thì `.catch()` của registry đưa cả object về mặc định. Ô chọn phải hiện thứ form
 * thật sự đang làm, không phải thứ đang nằm trong JSON.
 *
 * `ignored`: `params.endpointKey` ghi một khoá KHÁC khoá có hiệu lực — tức có một tham
 * số khác đang hỏng và khoá vừa chọn không có tác dụng. Không nói ra thì người dùng
 * chọn `subscribe`, thấy ô chọn bật về `newsletter`, và không có manh mối nào.
 *
 * `null` với composite không dùng bảng endpoint.
 */
export function readEndpointKey(
  composite: string,
  raw: unknown,
): { key: string; ignored: boolean } | null {
  if (composite !== 'Form' && composite !== 'NavChart') return null;
  const parsed = parseCompositeParams(composite, raw) as { endpointKey?: unknown } | null;
  if (typeof parsed?.endpointKey !== 'string') return null;

  const key = parsed.endpointKey;
  const written = isRecord(raw) && typeof raw.endpointKey === 'string' ? raw.endpointKey : null;
  return { key, ignored: written !== null && written !== key };
}

/**
 * `params` mới với khoá đã đổi — giữ NGUYÊN mọi tham số khác.
 *
 * `setProps` THAY cả giá trị của `params`, không gộp: gửi `{ endpointKey }` trần là xoá
 * sạch ô nhập, nhãn nút và thông báo của form.
 */
export function withEndpointKey(raw: unknown, key: string): Record<string, unknown> {
  return { ...(isRecord(raw) ? raw : {}), endpointKey: key };
}
