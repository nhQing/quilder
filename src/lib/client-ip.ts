/**
 * IP của người gọi, cho rate limit theo IP (đăng nhập, lượt xem bài).
 *
 * ## Vì sao lấy phần tử CUỐI của `x-forwarded-for`
 *
 * App chạy sau đúng một reverse proxy. Proxy kiểu nginx `proxy_add_x_forwarded_for`
 * NỐI IP nó thấy vào cuối header, giữ nguyên phần client tự gửi. Nên phần tử đầu là
 * thứ client muốn viết gì cũng được, còn phần tử cuối là thứ proxy của ta viết.
 * Lấy phần tử đầu thì một vòng lặp đổi header mỗi request là thoát mọi giới hạn.
 *
 * Thêm một tầng proxy (CDN đứng trước nginx) thì phải đổi chỗ này — phần tử cuối
 * khi đó là IP của CDN, và mọi người dùng bị gộp chung một gáo.
 *
 * Không có header nào (gọi thẳng vào cổng app lúc dev) thì trả 'unknown': mọi lời
 * gọi như vậy chung một gáo, chặt hơn chứ không lỏng hơn.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const last = forwarded.split(',').map((part) => part.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
