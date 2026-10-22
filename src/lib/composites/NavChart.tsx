'use client';

/**
 * Composite NavChart — NAV theo mốc 1y/3y/5y/all.
 *
 * ## Vì sao SVG, không canvas, không chart lib
 *
 * `SavingsSimulator` đã chọn một lần và lý do vẫn đúng: `<canvas>` thì crawler
 * không thấy số và canvas không ăn token màu. Một chart lib thì thêm một scheduler
 * và một hệ màu nữa vào trang.
 *
 * `<polyline>` là **markup**, không phải thư viện: SSR được, `stroke="currentColor"`
 * ăn token, và viewBox 0…100 + `preserveAspectRatio="none"` nghĩa là nó giãn theo
 * ô chứa mà không cần đo DOM — tức tính được ở server (xem `navGeometry`).
 *
 * Simulator vẽ cột bằng node + CSS vì nó *có* 30 cột. NAV là một đường qua hàng
 * trăm điểm; biểu diễn nó bằng div là hàng trăm element cho một hình.
 *
 * ## Vì sao vẫn có bảng số
 *
 * Đường vẽ là hình, không phải dữ liệu. Số thật đi kèm dưới dạng `<table>` để
 * screen reader đọc được và crawler thấy được — cùng lý do `SavingsSimulator` giữ
 * bảng 30 hàng bên cạnh biểu đồ cột.
 *
 * ## Đổi mốc KHÔNG gọi mạng
 *
 * BE trả toàn bộ chuỗi một lần (xem `nav-series.ts`); mốc là phép lọc ở client.
 * Nên bấm đổi mốc là tức thì, và không có trạng thái loading nào phải thiết kế.
 * HTML ở server đã mang mốc mặc định, đầy đủ đường vẽ và bảng số.
 */

import { useId, useMemo, useState } from 'react';

import type { NavChartParams } from './registry';
import {
  NAV_RANGE_LABEL,
  availableRanges,
  navGeometry,
  pointsInRange,
  type NavPayload,
  type NavRange,
} from './nav-series';

export interface NavChartProps extends NavChartParams {
  /**
   * Chuỗi đã nạp ở tầng trang, hoặc `null`.
   *
   * `null` gộp ba ca — chưa đặt khoá endpoint, BE không trả được, JSON sai hình
   * dạng — và cả ba đều dẫn tới cùng một việc: nói ra rằng chưa có số liệu. Phân
   * biệt chúng trên trang công khai không giúp khách, và chi tiết lỗi của BE thì
   * không nên hiện cho khách.
   */
  data: NavPayload | null;
  /** Tiêu đề, đến từ slot — node `Text` thật nên dịch được. */
  heading?: React.ReactNode;
  note?: React.ReactNode;
}

function formatNav(value: number, currency: string): string {
  // `vi-VN` cứng, không theo locale trình duyệt: số trên trang phải khớp số trong
  // bảng và khớp bản in, và một khách đặt máy sang `en-US` không nên thấy dấu
  // phân cách khác với khách bên cạnh.
  return `${value.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${currency}`;
}

export function NavChart({ defaultRange, data, heading, note }: NavChartProps) {
  const uid = useId();
  // Memo, không phải `?? []` trần: mảng rỗng mới ở mỗi lượt render làm cả ba useMemo
  // bên dưới tính lại mỗi lượt khi chưa có dữ liệu.
  const points = useMemo(() => data?.points ?? [], [data?.points]);
  const ranges = useMemo(() => availableRanges(points), [points]);

  /**
   * Mốc mặc định phải là mốc CÓ THẬT.
   *
   * Chuỗi mới 6 tháng mà params khai `5y` thì `pointsInRange` trả về cả chuỗi và
   * nút `5y` không có trong danh sách — state trỏ vào một nút không tồn tại, và
   * không nút nào trông như đang được chọn.
   */
  const [range, setRange] = useState<NavRange>(
    ranges.includes(defaultRange) ? defaultRange : ranges[ranges.length - 1]!,
  );

  const shown = useMemo(() => pointsInRange(points, range), [points, range]);
  const geo = useMemo(() => navGeometry(shown), [shown]);
  const currency = data?.currency ?? 'VND';

  return (
    <div className="mm-nav-root">
      {heading}

      {!data || !points.length ? (
        <p className="mm-nav__empty" data-part="nav-empty">
          {!data
            ? 'Biểu đồ chưa có nguồn số liệu. Thêm khoá endpoint ở màn Cài đặt, rồi Publish.'
            : 'Chưa có dữ liệu NAV để hiển thị.'}
        </p>
      ) : (
        <>
          <div className="mm-nav__head">
            <p className="mm-nav__value" data-part="nav-value">
              {formatNav(geo.last!.nav, currency)}
              <span className="mm-nav__date"> · {geo.last!.date}</span>
            </p>
            {geo.changePct !== null && (
              <p
                className="mm-nav__change"
                data-part="nav-change"
                data-dir={geo.changePct >= 0 ? 'up' : 'down'}
              >
                {geo.changePct >= 0 ? '+' : ''}
                {geo.changePct.toFixed(2)}%
              </p>
            )}
          </div>

          {/* `role="group"` + nhãn: một dải nút không nhãn thì screen reader đọc
              bốn nút rời rạc và không nói chúng thuộc về cái gì. */}
          <div
            className="mm-nav__ranges"
            role="group"
            aria-label="Khoảng thời gian"
            data-part="nav-ranges"
          >
            {ranges.map((r) => (
              <button
                key={r}
                type="button"
                className="mm-nav__range"
                // `aria-pressed` chứ không chỉ một class: trạng thái "đang chọn"
                // phải đọc được, không chỉ nhìn được.
                aria-pressed={r === range}
                onClick={() => setRange(r)}
              >
                {NAV_RANGE_LABEL[r]}
              </button>
            ))}
          </div>

          <svg
            className="mm-nav__chart"
            viewBox="0 0 100 100"
            /* Giãn theo ô chứa, không giữ tỉ lệ — nhờ vậy hình học tính được ở
               server mà không cần biết bề rộng thật. */
            preserveAspectRatio="none"
            data-part="nav-chart"
            /* Hình là TRANG TRÍ: số thật nằm ở bảng dưới, và `aria-hidden` ở đây
               để screen reader không đọc một đống toạ độ. */
            aria-hidden="true"
            focusable="false"
          >
            <polyline
              className="mm-nav__line"
              points={geo.polyline}
              fill="none"
              stroke="currentColor"
              /* `vector-effect` giữ nét mảnh đúng 1 đơn vị dù viewBox bị giãn méo
                 — không có nó, nét dày lên theo trục bị kéo. */
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/*
            Bảng số thật, đi kèm hình.
            Đây là thứ crawler đọc và screen reader duyệt được. Ẩn bằng CSS
            (`.mm-nav__data`) chứ không bằng `hidden`: `hidden` là ẩn khỏi cả cây
            a11y, tức xoá luôn lý do bảng này tồn tại.
          */}
          <table className="mm-nav__data" data-part="nav-data">
            <caption id={`${uid}-cap`}>
              NAV theo ngày — {NAV_RANGE_LABEL[range]} ({shown.length} mốc)
            </caption>
            <thead>
              <tr>
                <th scope="col">Ngày</th>
                <th scope="col">NAV</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.date}>
                  <th scope="row">{p.date}</th>
                  <td>{formatNav(p.nav, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {note}
    </div>
  );
}

export default NavChart;
