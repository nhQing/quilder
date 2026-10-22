'use client';

/**
 * Xem trước một component ở nhiều khổ màn, và hình thu nhỏ của nó trên thẻ ở thư viện.
 *
 * ## Vì sao trang component phải có hình, không chỉ có cây node
 *
 * Bản trước liệt kê 30 dòng `ST hero__inner`, `TE hero_title`, `IM Image` — đúng
 * về dữ liệu và vô dụng về nghĩa. Không ai đọc danh sách id rồi dựng lại được
 * trong đầu component đó trông ra sao, nên câu hỏi thật ("cái này là cái gì, sửa
 * vào đây thì đổi chỗ nào") không có chỗ nào trả lời.
 *
 * ## Vì sao thu nhỏ chứ không cuộn ngang
 *
 * Khổ 1560 không lọt vào cột 1200px. Cuộn ngang thì mỗi lần đổi khổ lại phải kéo
 * đi tìm, và mất luôn thứ duy nhất mà việc đổi khổ dùng để trả lời: bố cục có vỡ
 * không. Thu nhỏ giữ trọn khung hình, đánh đổi bằng chữ nhỏ đi — mà chữ thì đã
 * có bản 1200 để đọc.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';

import { Button } from './ui/Button';
import { Tabs } from './ui/Tabs';

const WIDTHS = [
  { label: 'Desktop lớn', w: 1560 },
  { label: 'Desktop', w: 1200 },
  { label: 'Tablet', w: 900 },
  { label: 'Mobile', w: 390 },
];

/**
 * Chiều cao thật của nội dung, đo từ chính các node của component. 0 khi chưa có node.
 *
 * Hai cách hiển nhiên hơn đều sai ở đây:
 *
 * - `body.scrollHeight`: `site.css` cho body `min-height:100vh`, mà viewport
 *   của iframe chính là chiều cao ta vừa đặt — nên body luôn đo lại đúng con
 *   số cũ và khung kẹt ở giá trị khởi tạo.
 * - `body.firstElementChild`: đó là div portal rỗng của Next, cao 0.
 *
 * `[data-n]` là thứ `NodeRenderer` gắn lên mọi node, nên lấy mép dưới xa nhất
 * trong đám đó là đo đúng component, không đo chrome của framework. Cộng
 * `scrollTop` vì rect tính theo viewport, còn ta cần toạ độ theo tài liệu.
 */
function contentBottom(doc: Document): number {
  const nodes = doc.querySelectorAll('[data-n]');
  if (!nodes.length) return 0;

  const top = doc.documentElement.scrollTop;
  let bottom = 0;
  for (const el of nodes) {
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom + top);
  }
  return bottom;
}

export function ComponentPreview({ componentId }: { componentId: string }) {
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(360);
  const [scale, setScale] = useState(1);
  const [nonce, setNonce] = useState(0);
  // Tăng ở `onLoad`. Không có nó thì effect gắn ResizeObserver chạy lúc iframe
  // còn rỗng, không gắn được gì, và không bao giờ chạy lại — chiều cao chỉ đúng
  // ở lần đo đầu rồi đứng yên.
  const [loaded, setLoaded] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const bottom = contentBottom(doc);
    if (bottom > 0) setHeight(Math.ceil(bottom));
  }, []);

  // Font và ảnh xuống sau `load` sẽ đổi chiều cao. Đo một lần là chấp nhận một
  // khoảng trống hoặc một chỗ bị cắt ở đúng những component nhiều ảnh nhất.
  useEffect(() => {
    const root = frame.current?.contentDocument?.querySelector('[data-n]');
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure, nonce, width, loaded]);

  useEffect(() => {
    const fit = () => {
      const avail = box.current?.clientWidth ?? width;
      setScale(Math.min(1, avail / width));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [width]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          label="Khổ màn xem trước"
          value={String(width)}
          onChange={(id) => setWidth(Number(id))}
          items={WIDTHS.map((b) => ({
            id: String(b.w),
            label: (
              <>
                {b.label} <span className="font-shell-mono text-mini text-shell-muted">{b.w}</span>
              </>
            ),
          }))}
        />

        <span className="ml-auto font-shell-mono text-mini text-shell-muted">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="md"
          onClick={() => setNonce((n) => n + 1)}
          title="Nạp lại bản xem trước"
        >
          Nạp lại
        </Button>
      </div>

      <div className={cn(ui.inset, 'overflow-hidden p-4')}>
        {/* Đo bề ngang ở lớp KHÔNG có padding: đo cả lớp có padding thì tỉ lệ
            tính dư đúng phần padding và mép phải component bị cắt. */}
        <div ref={box}>
          {/* Hai lớp: lớp ngoài chiếm chỗ THẬT SỰ chiếm sau khi thu nhỏ, lớp trong
              giữ kích thước gốc rồi scale. Chỉ scale lớp trong sẽ để lại khoảng
              trống bằng đúng phần đã thu nhỏ. */}
          <div style={{ height: height * scale }}>
            <iframe
              key={`${componentId}-${nonce}`}
              ref={frame}
              title="Xem trước component"
              src={`/render/component/${componentId}`}
              onLoad={() => { measure(); setLoaded((n) => n + 1); }}
              width={width}
              height={height}
              className="block border-0 bg-shell-paper"
              style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Khổ dựng hình thu nhỏ: khổ Desktop, cùng khổ mặc định của bản xem trước. */
const THUMB_WIDTH = 1200;

/**
 * Hình thu nhỏ trên thẻ ở thư viện — cùng `/render/component/<id>` với bản xem trước,
 * dựng ở khổ Desktop rồi thu cho vừa bề ngang thẻ.
 *
 * Chỉ để nhìn: không bấm, không tab vào được. Bấm vào thẻ là mở trang chi tiết.
 *
 * Căn giữa theo chiều dọc khi nội dung thấp hơn khung (header thành một dải nằm
 * giữa); cao hơn thì giữ mép TRÊN và cắt phần dưới (`justify-center-safe`), vì
 * phần đầu của một component là phần nhận ra nó.
 */
export function ComponentThumb({ componentId, name }: { componentId: string; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  // Chiều cao nội dung ở khổ gốc; 0 là chưa đo được.
  const [height, setHeight] = useState(0);
  const [loaded, setLoaded] = useState(0);

  // Thẻ đổi bề ngang theo lưới, không theo cửa sổ — nên quan sát chính khung.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFit({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const bottom = contentBottom(doc);
    if (bottom > 0) setHeight(Math.ceil(bottom));
  }, []);

  useEffect(() => {
    const root = frame.current?.contentDocument?.querySelector('[data-n]');
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure, loaded]);

  const scale = fit.w / THUMB_WIDTH;
  // Trước khi đo được, iframe cao bằng khung (theo khổ gốc) — đủ để nội dung dựng ra mà đo.
  const frameHeight = height || (scale > 0 ? Math.ceil(fit.h / scale) : 600);

  return (
    <div ref={box} className="flex size-full flex-col justify-center-safe overflow-hidden">
      <div className="shrink-0 overflow-hidden" style={{ height: frameHeight * scale }}>
        <iframe
          title={`Hình thu nhỏ của ${name}`}
          src={`/render/component/${componentId}`}
          ref={frame}
          aria-hidden
          tabIndex={-1}
          loading="lazy"
          onLoad={() => { measure(); setLoaded((n) => n + 1); }}
          width={THUMB_WIDTH}
          height={frameHeight}
          className="pointer-events-none block border-0 bg-shell-paper transition-opacity duration-200"
          // Ẩn tới khi đo xong: không thì thẻ chớp một khối trắng cao bằng khung rồi mới co lại.
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left', opacity: height ? 1 : 0 }}
        />
      </div>
    </div>
  );
}
