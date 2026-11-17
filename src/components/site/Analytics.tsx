import Script from 'next/script';

/**
 * Google Analytics 4 cho site công khai.
 *
 * Mã đo đọc LÚC CHẠY từ `GA_MEASUREMENT_ID` (không `NEXT_PUBLIC_`): component này
 * render ở server, nên đổi mã hay tắt GA chỉ cần đổi env và khởi động lại, không
 * build lại. Thiếu biến (stg, máy dev) hoặc sai dạng `G-…` thì không phát gì — không
 * có bản build nào vô tình gửi số liệu của môi trường thử vào property thật.
 *
 * Chỉ mount ở `(site)/layout.tsx` và KHÔNG ở màn bản nháp: lượt xem của nhân viên
 * trong builder/preview không được lẫn vào số liệu khách.
 *
 * ## Consent Mode: mặc định từ chối
 *
 * Site chưa có banner đồng ý cookie. GA đọc cookie `_ga` để nhận diện người xem —
 * dữ liệu cá nhân theo Nghị định 13/2023 — nên mọi loại lưu trữ mặc định `denied`.
 * GA vẫn nhận ping không cookie (đếm lượt, không nhận diện được khách quay lại).
 * Khi có banner, nó gọi `gtag('consent', 'update', { analytics_storage: 'granted' })`
 * sau khi khách đồng ý; không cần đổi gì ở đây.
 */
const ID_RE = /^G-[A-Z0-9]{4,20}$/;

export function Analytics() {
  const id = process.env.GA_MEASUREMENT_ID?.trim();
  if (!id || !ID_RE.test(id)) return null;

  // `id` đã qua ID_RE nên chỉ gồm chữ hoa, số và dấu gạch — nhúng vào script an toàn.
  const init = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;
gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
gtag('js',new Date());gtag('config','${id}');`;

  return (
    <>
      <Script id="ga-init" strategy="afterInteractive">
        {init}
      </Script>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
    </>
  );
}
