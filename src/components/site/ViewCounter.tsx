'use client';

/**
 * Báo một lượt xem cho trang chi tiết đang mở.
 *
 * ## Vì sao là client component chứ không đếm ngay lúc render server
 *
 * Trang site được cache (`unstable_cache` + `s-maxage`), nên một lượt render
 * server KHÔNG tương ứng một lượt người đọc: bài hot render một lần rồi phục vụ
 * từ cache nghìn lần, và bộ đếm sẽ đứng yên ở 1. Ngược lại, một lượt
 * `revalidate` hay một con bot hâm nóng cache lại tính thành lượt xem.
 *
 * Gọi từ trình duyệt thì một lượt người đọc là một lượt đếm, và bot không chạy JS
 * không được đếm — một hiệu ứng phụ có lợi, không phải một cơ chế chống bot.
 *
 * ## Vì sao `keepalive`
 *
 * Người đọc bấm sang bài khác ngay sau khi trang hiện ra là chuyện thường, và một
 * `fetch` thường bị huỷ khi trang bị gỡ. `keepalive` cho request sống qua lần
 * điều hướng ấy — cùng cơ chế `sendBeacon` dùng, nhưng giữ được method và đường
 * dẫn ta muốn.
 *
 * ## Vì sao ref thay vì để `useEffect` chạy một lần
 *
 * Ở chế độ dev, React StrictMode chạy effect HAI lần có chủ đích. Không chặn thì
 * mọi con số trên máy dev gấp đôi, và không ai nhớ ra lý do khi đối chiếu với
 * production.
 */

import { useEffect, useRef } from 'react';

export function ViewCounter({ entryId }: { entryId: string }) {
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (sent.current === entryId) return;
    sent.current = entryId;

    // Nuốt lỗi: không đếm được một lượt xem không phải lý do để hiện gì lên trang
    // của người đọc, và cũng không phải lý do để bẩn console của họ.
    void fetch(`/api/views/${entryId}`, { method: 'POST', keepalive: true }).catch(() => {});
  }, [entryId]);

  return null;
}
