'use client';

/**
 * Đầu panel Inspector: node đang chọn, đường dẫn tổ tiên, và **lớp đang ghi**.
 *
 * ## Vì sao tách khỏi `Inspector.tsx`
 *
 * File đó 1400 dòng. Đầu panel không dùng chung state nào với 34 ô bên dưới — nó chỉ
 * cần node, doc và breakpoint — nên để nó ở đó là làm một file đã quá lớn lớn thêm mà
 * không đổi lấy gì.
 *
 * ## Vì sao đường dẫn tổ tiên là NÚT, không phải chữ
 *
 * Câu hỏi thật của người dùng ở đầu panel không phải "tôi đang ở đâu" mà "cho tôi lên
 * một bậc". Chọn node cha bằng cây bên trái đòi tìm lại đúng hàng đó trong một cây có
 * thể đang gập — trong khi đường dẫn đã bày sẵn đúng chuỗi ấy. Chữ không bấm được là
 * bày ra câu trả lời rồi bắt người ta đi đường khác để dùng nó.
 *
 * Node CUỐI (chính node đang chọn) không phải nút: bấm vào nó không đổi gì, và một nút
 * không có tác dụng làm người dùng nghi cả hàng còn lại.
 *
 * ## Vì sao "đang ghi vào lớp" nằm ở đây chứ không ở canvas
 *
 * Chọn khổ màn nằm ở canvas — bấm vào khung nào thì làm việc ở khổ đó, và hai chỗ chọn
 * cùng một thứ là hai nguồn sự thật. Nhưng panel VẪN phải nói nó đang ghi vào lớp nào,
 * nếu không mọi thao tác bên dưới đều mơ hồ. Đó là hai việc khác nhau: canvas ĐẶT,
 * panel KHAI BÁO.
 */

import { breakpointInfo } from '@/lib/design/breakpoints';
import { ancestorPath, labelOf } from '@/lib/builder/node-label';
import { useEditor } from '@/lib/builder/store';
import { cn } from '@/lib/builder/cn';
import { focusRing } from '@/lib/builder/ui';
import type { Doc, Node } from '@/lib/doc/types';
import { useAiLink } from './AiLinkProvider';
import { SEG } from './controls';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/Button';

/**
 * Số bậc tổ tiên hiện ra. Sâu hơn thì gập phần giữa lại thành `…`.
 *
 * Bốn, không nhiều hơn: pane phải rộng ~300px, và đường dẫn dài hơn xuống thành hai ba
 * dòng — đẩy cả bảng thuộc tính xuống chỉ để bày những bậc giữa không ai bấm.
 */
const MAX_CRUMBS = 4;

/** Ngôn ngữ ĐÃ BẬT của site. `isDefault` là bản gốc. */
export interface LocaleOption {
  code: string;
  label: string;
  isDefault: boolean;
}

export function InspectorHead({
  doc,
  node,
  locales,
}: {
  doc: Doc;
  /** Ngôn ngữ đã bật. Dưới hai dòng thì dải chọn không hiện — xem `LocaleSwitch`. */
  locales: LocaleOption[];
  /**
   * `undefined` cũng là một ca thật, không chỉ `null`: `Inspector` tra
   * `doc.nodes[selectedId]`, và `noUncheckedIndexedAccess` làm kết quả đó có thể vắng
   * khi `selectedId` trỏ tới một node vừa bị xoá bởi một op. Nhận cả hai ở đây thay vì
   * bắt chỗ gọi `?? null` — chỗ gọi nào quên là chỗ đó đỏ ở tsc, nhưng nhận cả hai thì
   * không ai phải nhớ.
   */
  node: Node | null | undefined;
}) {
  const breakpoint = useEditor((s) => s.breakpoint);
  const select = useEditor((s) => s.select);
  const info = breakpointInfo(breakpoint);

  const aiLink = useAiLink();

  const path = node ? ancestorPath(doc, node.id) : [];
  const crumbs = trimCrumbs(path);

  return (
    <div className="border-shell-line flex flex-col gap-1.5 border-b px-3.5 pt-3 pb-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="shrink-0 text-ui font-semibold">Thuộc tính</h2>
        <div className="flex min-w-0 items-center gap-1.5">
          {/*
            Nút "Copy link cho AI": chép một dòng + link trỏ thẳng tới node đang chọn để
            dán vào chat với Claude (MCP) — model mở đúng element, người dùng khỏi tả vị
            trí. Xem `AiLinkProvider`. Ẩn khi không có provider (không có địa chỉ để trỏ).
          */}
          {aiLink && (
            <IconButton
              icon="link"
              size="sm"
              data-ai-link="copy"
              disabled={!aiLink.canCopy}
              onClick={aiLink.copy}
              label={`Copy link cho AI (${aiLink.shortcut}) — dán vào chat với Claude kèm yêu cầu, nó sẽ sửa đúng element này`}
            />
          )}
          {/*
            Nhãn lớp mang `data-writing-layer` để e2e nhắm được vào nó bằng móc, không
            bằng chữ: tên lớp là chữ người dùng đọc ("Desktop"), và nó đổi được trong màn
            Cài đặt — một selector bám vào nó là một selector chờ hỏng.
          */}
          <Badge
            tone="accent"
            size="sm"
            data-writing-layer={breakpoint}
            className="min-w-0 truncate"
            title={`Sửa ở đây ghi vào lớp ${info.label} (${info.hint}) và mọi khổ lớn hơn`}
          >
            đang ghi: {info.label}
          </Badge>
        </div>
      </div>

      <LocaleSwitch locales={locales} />

      {aiLink?.inner && (
        /*
          Canvas trang chỉ chọn được cả Instance; phần tử người dùng vừa bấm BÊN TRONG nó
          chỉ có ở link. Nói ra để họ biết link sẽ dẫn tới phần tử nào, không phải cả
          component. `truncate` + `title`: tên component/phần tử do tác giả đặt, có thể dài.
        */
        <p
          data-ai-link="inner"
          className="min-w-0 truncate text-mini text-shell-muted"
          title={`Link cho AI trỏ tới: ${aiLink.inner.label} (trong component ${aiLink.inner.componentName})`}
        >
          Trỏ tới: <span className="font-semibold text-shell-ink">{aiLink.inner.label}</span> (trong component{' '}
          {aiLink.inner.componentName})
        </p>
      )}

      {node ? (
        <nav
          aria-label="Đường dẫn tổ tiên"
          className="font-shell-mono flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-mini"
        >
          {crumbs.map((c, i) =>
            c === null ? (
              <span key={`gap-${i}`} className="text-shell-muted" title="Bỏ qua các bậc giữa">
                …
              </span>
            ) : (
              <span key={c.id} className="flex min-w-0 items-center gap-1">
                {i > 0 && <span aria-hidden className="text-shell-muted">›</span>}
                {c.id === node.id ? (
                  <span
                    className="text-shell-ink truncate font-semibold"
                    /*
                      KHÔNG đưa `c.id` vào `title`.

                      `getByTitle` khớp chuỗi CON, và `getByTitle('ab000002')` là
                      selector mà một tá spec dùng để khẳng định node nào đang chọn —
                      nó trỏ vào khối Meta bên dưới, nơi id đã hiện thành chữ. Thêm id
                      vào đây làm selector đó khớp hai phần tử và 21 test đỏ cùng lúc
                      với "strict mode violation". Đã xảy ra thật, 09/09/2026.
                    */
                    title={`${labelOf(c)} · ${c.type}`}
                  >
                    {labelOf(c)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => select(c.id)}
                    title={`Chọn ${labelOf(c)} (${c.type})`}
                    className={cn(
                      'text-shell-muted hover:text-shell-ink truncate rounded-xs underline-offset-2 hover:underline',
                      focusRing,
                    )}
                  >
                    {labelOf(c)}
                  </button>
                )}
              </span>
            ),
          )}
        </nav>
      ) : null}
    </div>
  );
}

/**
 * Dải chọn ngôn ngữ — và là chỗ KHAI BÁO rằng thao tác đang ghi vào bản dịch.
 *
 * ## Vì sao nó ở đây, cạnh chip lớp
 *
 * Hai chip trả lời cùng một câu hỏi: *"thứ tôi sửa sẽ ghi vào đâu?"*. Lớp
 * (breakpoint) do canvas ĐẶT vì ở đó có một cái khung để bấm; ngôn ngữ thì không
 * có khung nào tương ứng, nên panel vừa đặt vừa khai. Xem docblock đầu file cho
 * ranh giới "canvas ĐẶT, panel KHAI BÁO".
 *
 * ## Vì sao là dải nút, không phải `<select>`
 *
 * Cùng lý lẽ với `SegmentedControl`: hai hoặc ba ngôn ngữ là tập nhỏ, và giá trị
 * đang chọn phải ĐỌC ĐƯỢC mà không cần mở ra — đây là thứ quyết định mọi thao tác
 * bên dưới ghi vào đâu, nên nó không được phép nằm sau một cú bấm. Cùng công thức
 * hình (`SEG`) với dải đó, nên hai thứ cùng loại trông như một.
 *
 * ## Site chỉ có một ngôn ngữ thì KHÔNG hiện gì
 *
 * Một dải một nút là nhiễu thuần tuý. Nó xuất hiện đúng lúc có ngôn ngữ thứ hai
 * được bật trong Cài đặt.
 */
function LocaleSwitch({ locales }: { locales: LocaleOption[] }) {
  const locale = useEditor((s) => s.locale);
  const setLocale = useEditor((s) => s.setLocale);

  if (locales.length < 2) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className={cn(SEG.group, 'min-w-0')} role="group" aria-label="Ngôn ngữ đang sửa">
        {locales.map((l) => {
          // Ngôn ngữ mặc định LÀ bản gốc, nên nó là `null` trong store — không phải
          // mã của nó. Một mã ở đây nghĩa là "đang sửa bản dịch", và cả Inspector
          // đọc đúng phép phân biệt đó.
          const value = l.isDefault ? null : l.code;
          const on = locale === value;
          return (
            <button
              key={l.code}
              type="button"
              data-locale={l.code}
              aria-pressed={on}
              onClick={() => setLocale(value)}
              title={
                l.isDefault
                  ? 'Bản gốc — sửa được mọi thứ'
                  : `Bản ${l.label} — chỉ sửa được nội dung; bố cục dùng chung với bản gốc`
              }
              className={cn(SEG.item, 'flex-none px-2.5', on && SEG.on)}
            >
              {l.label}
            </button>
          );
        })}
      </div>
      {locale && (
        <Badge
          tone="warn"
          size="sm"
          className="ml-auto shrink-0"
          title="Bố cục và style dùng chung mọi ngôn ngữ"
        >
          đang sửa bản dịch
        </Badge>
      )}
    </div>
  );
}

/**
 * Giữ bậc ĐẦU và ba bậc CUỐI, chèn `null` làm chỗ gập.
 *
 * Giữ bậc đầu vì nó là gốc trang — mất nó thì đường dẫn không nói được node đang nằm
 * trong trang hay trong một component. Giữ ba bậc cuối vì đó là vùng người ta thao tác.
 * Phần bị bỏ là khúc giữa, khúc duy nhất không trả lời câu hỏi nào.
 *
 * Tách thành hàm thuần để test được mà không dựng React.
 */
export function trimCrumbs(path: Node[]): (Node | null)[] {
  if (path.length <= MAX_CRUMBS) return path;
  const first = path[0]!;
  const tail = path.slice(-(MAX_CRUMBS - 1));
  return [first, null, ...tail];
}
