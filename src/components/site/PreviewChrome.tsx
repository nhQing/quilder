'use client';

/**
 * Thanh nổi giữa đáy trang xem nháp: chip "chưa publish" + dải ngôn ngữ + các nút giả
 * lập bề rộng. Vỏ thanh (hình viên thuốc, nền mờ, thu gọn) là `PreviewPill`.
 *
 * ## Vì sao các nút là LINK, không phải JavaScript
 *
 * Không thể thu hẹp khung nhìn từ bên trong chính trang đó — muốn giả lập 768px thì
 * nội dung phải nằm trong một iframe rộng 768px. Nên "đổi bề rộng" thật ra là "đi tới
 * một URL khác": `?w=768` cho bản có iframe, không có `w` cho bản nguyên bản.
 *
 * Là link nên nó chạy khi JavaScript tắt, và Back/Forward của trình duyệt hoạt động
 * đúng như người dùng mong — mức phóng là một phần của địa chỉ, không phải một trạng
 * thái ẩn.
 *
 * ## Vì sao KHÔNG có `w` là bản nguyên bản
 *
 * `/preview/<id>` trần phải render trang TRỰC TIẾP vào document, không qua iframe:
 * `pnpm check:layout` đo `[data-n]` ở document trên cùng, và bốn spec e2e
 * (`carousel`, `chapter-parallax`, `panel-stack`, `savings`) chạy effect ở đó. Bọc
 * iframe theo mặc định là làm hỏng cả năm thứ đó cùng lúc.
 *
 * ## Vì sao nổi ở ĐÁY (`fixed`), không dính ở trên (`sticky`)
 *
 * Thanh đã thử cả hai chỗ ở trên, và cả hai đều đè lên đúng phần người ta mở màn này để
 * soi — header và hero:
 *
 *  - Bản đầu `position: fixed; top: 0` **đè lên 32px đầu của trang**: `fixed` bị lấy khỏi
 *    luồng nên không có gì chừa chỗ cho nó.
 *  - Bản sau `sticky; top: 0` chiếm 32px trong luồng nên không đè lúc trang đứng yên.
 *    Nhưng site có header `fixed`/`sticky top: 0` của riêng nó, nên hai thanh dính cùng
 *    một chỗ và thanh này (z-index cao hơn) che header của site — người dùng báo đúng
 *    lỗi đó ngày 09/10/2026. Tệ hơn, 32px chèn vào luồng làm bản nháp **dài hơn bản thật
 *    32px**: mọi phép so ảnh nháp với bản đang chạy (tool `compare` của MCP) đều báo
 *    lệch chiều cao, ở mọi trang, kể cả trang không đổi gì.
 *
 * Viên thuốc nổi giữa đáy tránh được cả hai: không đụng phần trên của trang, và không
 * chiếm chỗ trong luồng — trang nháp có ĐÚNG hình học của trang thật: cùng chiều cao,
 * cùng toạ độ, cùng `100svh`.
 *
 * Đánh đổi, nói thẳng: nó che một dải ~38px ở giữa đáy màn hình, và khi cuộn tới cuối
 * trang thì đó là phần giữa của footer. Cách giảm:
 *
 *  - Gọn: một hàng 38px, rộng vừa nội dung, không kéo hết bề ngang.
 *  - Nền trong mờ + `backdrop-filter`, nên vẫn thấy thứ nằm sau nó.
 *  - Thu gọn được, còn mỗi chip trạng thái (`PreviewPill`).
 *
 * Cố ý KHÔNG chèn `padding-bottom` vào trang để "cuộn được quá thanh": đó là đổi bố cục
 * của chính trang đang soát — đúng lỗi của bản `sticky`, chỉ dời từ trên xuống dưới.
 * Chế độ giả lập (`?w=`) thì khác: vỏ ở đó là của mình, nên khung iframe ngắn lại đúng
 * bằng `PREVIEW_PILL_SPACE` và thanh nổi trên nền tối bên dưới, không che gì của trang.
 *
 * ## Vì sao đọc danh sách khổ từ `localStorage`
 *
 * Để các nút ở đây khớp với các nút trong builder — cùng người dùng, cùng máy, cùng
 * danh sách. Đọc trong `useEffect` chứ không lúc render: server không có
 * `localStorage`, và đọc lúc render sẽ làm HTML hai bên lệch nhau.
 */

import { useEffect, useState } from 'react';

import { DEFAULT_SCREENS, type Screen } from '@/lib/design/breakpoints';
import { readScreens } from '@/lib/builder/screens';

import { PreviewPill } from './PreviewPill';

export function PreviewChrome({
  pageId,
  locale,
  locales,
  width,
  binding,
}: {
  pageId: string;
  locale?: string;
  /** Ngôn ngữ đã bật của site. Dưới hai dòng thì dải ngôn ngữ không hiện. */
  locales: { code: string; label: string; isDefault: boolean }[];
  /** Bề rộng đang giả lập, hoặc `null` khi đang xem nguyên bản. */
  width: number | null;
  /**
   * Bản ghi mà trang mẫu đang được xem cùng, ví dụ `bài "lai-suat-thang-8"`.
   *
   * `null` trên trang thường. Bắt buộc nói ra trên trang mẫu: URL xem trước là
   * `/preview/<pageId>` và không mang giá trị đoạn động, nên nếu không nói thì người
   * xem không có cách nào biết mình đang nhìn bài nào — hay tệ hơn, tưởng nội dung
   * đang thấy là một phần của mẫu.
   */
  binding?: string | null;
}) {
  // Mặc định lúc render đầu (cả server lẫn client) rồi mới đồng bộ với bản đã lưu —
  // nếu render thẳng bản đã lưu thì hydration lệch.
  const [screens, setScreens] = useState<readonly Screen[]>(DEFAULT_SCREENS);
  useEffect(() => { setScreens(readScreens()); }, []);

  /**
   * Cùng bề rộng đang xem, đổi ngôn ngữ.
   *
   * Giữ `w`: người soát đang xem khổ 768 mà bấm sang tiếng Anh thì họ muốn xem
   * tiếng Anh ở 768, không phải nhảy về toàn màn rồi bấm lại.
   */
  const localeHref = (code: string | undefined) => {
    const params = new URLSearchParams();
    if (code) params.set('locale', code);
    if (width !== null) params.set('w', String(width));
    const qs = params.toString();
    return `/preview/${pageId}${qs ? `?${qs}` : ''}`;
  };

  const href = (w: number | null) => {
    const params = new URLSearchParams();
    if (locale) params.set('locale', locale);
    if (w !== null) params.set('w', String(w));
    const qs = params.toString();
    return `/preview/${pageId}${qs ? `?${qs}` : ''}`;
  };

  /*
   * Nút đang chọn mang `aria-current="page"`: nó trỏ đúng địa chỉ đang mở, và CSS của
   * thanh tô nút đó bằng chính thuộc tính này — trạng thái đọc được bằng screen reader
   * và trạng thái nhìn thấy là MỘT thứ, không lệch nhau được.
   */
  const current = (on: boolean) => (on ? ('page' as const) : undefined);

  return (
    <PreviewPill
      label="Công cụ xem nháp"
      tone="warn"
      statusTitle="Bản nháp — chưa publish"
      data={{ 'data-preview-banner': '' }}
      status={
        <>
          {/* Màn hẹp còn "nháp": chip vẫn mang màu cảnh báo và câu đầy đủ ở `title`. */}
          <span data-pill-long="">bản nháp · chưa publish</span>
          <span data-pill-short="">nháp</span>
        </>
      }
    >
      {/*
        Dải ngôn ngữ — LINK, cùng lý lẽ với dải bề rộng ở cuối thanh.

        Trước đây chỗ này chỉ IN RA mã ngôn ngữ đang xem. `?locale=en` đã chạy từ
        lâu, nhưng không có gì bấm được, nên đường duy nhất để người soát xem bản
        tiếng Anh là tự sửa URL — tức là một tính năng chỉ dùng được bởi người biết
        nó tồn tại. Gửi link này cho khách hàng thì họ không biết.

        Chỉ hiện khi site có từ hai ngôn ngữ: một dải một nút là nhiễu.
      */}
      {locales.length > 1 && (
        <>
          <span data-pill-sep="" aria-hidden="true" />
          <span data-pill-group="" data-preview-locales="" role="group" aria-label="Ngôn ngữ">
            {locales.map((l) => (
              <a
                key={l.code}
                href={localeHref(l.isDefault ? undefined : l.code)}
                data-pill-seg=""
                data-preview-locale={l.code}
                title={l.label}
                aria-current={current(l.isDefault ? !locale : locale === l.code)}
              >
                {/* Màn hẹp: mã ngôn ngữ thay cho tên đầy đủ — "Tiếng Việt" không có chỗ. */}
                <span data-pill-long="">{l.label}</span>
                <span data-pill-short="">{l.code.toUpperCase()}</span>
              </a>
            ))}
          </span>
        </>
      )}

      {binding && (
        <>
          <span data-pill-sep="" aria-hidden="true" />
          {/* Co lại và cắt `…` trước tiên khi thiếu chỗ; câu đầy đủ nằm ở `title`. */}
          <span data-pill-chip="" data-preview-binding="" title={`đang xem với: ${binding}`}>
            đang xem với: {binding}
          </span>
        </>
      )}

      <span data-pill-sep="" aria-hidden="true" />
      {/*
        Dải bề rộng co lại và TỰ CUỘN NGANG khi không đủ chỗ, thay vì đẩy cả thanh rộng
        ra — thanh không bao giờ được rộng hơn màn: trước đây ở 390px dải cũ đẩy trang
        rộng thành 403px, tức CHÍNH màn xem nháp có thanh cuộn ngang mà site thật không có,
        và người soát tưởng trang của mình bị tràn.
      */}
      <span
        data-pill-group=""
        data-pill-scroll=""
        data-preview-widths=""
        role="group"
        aria-label="Bề rộng màn"
      >
        <a href={href(null)} data-pill-seg="" data-preview-width="full" aria-current={current(width === null)}>
          Toàn bộ
        </a>
        {screens.map((s) => (
          <a
            key={s.id}
            href={href(s.width)}
            data-pill-seg=""
            data-pill-mono=""
            data-preview-width={s.width}
            title={`Xem ở bề rộng ${s.width}px`}
            aria-current={current(width === s.width)}
          >
            {s.width}
          </a>
        ))}
      </span>
    </PreviewPill>
  );
}
