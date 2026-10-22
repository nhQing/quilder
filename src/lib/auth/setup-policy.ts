/**
 * Màn cài đặt có đòi mã cài đặt không.
 *
 * Mã cài đặt chặn bot quét cổng chiếm quyền admin trong vài phút giữa lúc container
 * lên và lúc người vận hành mở trình duyệt (xem `setup-token.ts`). Mối đe doạ đó chỉ
 * có thật với một bản PUBLIC. `next dev` không bao giờ là bản public, và bắt người
 * chạy dev đi lấy mã trong log là một bước không chặn được ai.
 *
 * ## Vì sao suy từ `NODE_ENV` mà không thêm một biến riêng
 *
 * `next build` và `next start` luôn ép `NODE_ENV=production`, nên image prod không
 * thể lỡ tay tắt phép kiểm này. Một biến riêng kiểu `SETUP_TOKEN_REQUIRED=false` thì
 * có thể bị chép nhầm từ `.env` dev sang server — đúng loại sai không ai thấy.
 */
export function setupTokenRequired(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === 'production';
}
