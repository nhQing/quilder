/**
 * Kho asset cho phía client: nạp MỘT lần, chia cho mọi ô đang cần.
 *
 * ## Vì sao cache promise, không cache kết quả
 *
 * Một form nội dung có sáu field ảnh, và Inspector của một node Video có hai ô. Nếu
 * mỗi ô tự `fetch('/api/assets')` thì cùng một danh sách bị kéo về sáu, tám lần cho
 * một lần mở màn. Cache PROMISE nghĩa là những ô mount cùng lúc cùng chờ đúng một
 * request đang bay — cache kết quả thì vẫn có sáu request rồi mới có một kết quả.
 *
 * ## Vì sao xoá cache khi lỗi
 *
 * Giữ lại một promise đã reject là biến một lần mạng chập thành một bộ chọn VĨNH VIỄN
 * không mở được: mọi lần bấm sau đều nhận lại đúng cái lỗi cũ, và không có gì nói cho
 * người dùng biết chỉ cần thử lại.
 *
 * ## Vì sao có `force`
 *
 * Người dùng MỞ bảng chọn nghĩa là họ đang đi tìm một file có thể vừa được tải lên ở
 * tab Thư viện. Lúc đó danh sách phải mới. Còn ô xem trước của giá trị đã chọn thì
 * bản cache là đủ — nó chỉ cần biết tên và kiểu của một asset đã tồn tại.
 */

export interface AssetOption {
  id: string;
  key: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
}

let cached: Promise<AssetOption[]> | null = null;

export function loadAssets(force = false): Promise<AssetOption[]> {
  if (force || !cached) {
    cached = fetch('/api/assets')
      .then(async (res) => {
        const json = (await res.json()) as { assets?: AssetOption[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? `Lỗi ${res.status}`);
        return json.assets ?? [];
      })
      .catch((e: unknown) => {
        cached = null;
        throw e;
      });
  }
  return cached;
}

/** Sau khi tải lên một file mới: bản cache đã cũ. */
export function invalidateAssets(): void {
  cached = null;
}
