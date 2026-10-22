'use client';

/**
 * Khối "Gửi tới" (Form) / "Nguồn số liệu" (NavChart) trong Inspector.
 *
 * ## Vì sao có nó
 *
 * Form gửi tới URL tra theo KHOÁ (`params.endpointKey`) trong bảng `Site.globals.endpoint`
 * — xem `formParams.endpointKey` trong registry cho lý do không để URL trong params. Bảng
 * sửa được ở màn Cài đặt, nhưng cho tới hôm nay không có chỗ nào trong editor chọn được
 * KHOÁ của một form: Inspector không bày params của Composite, nên form nào cũng dùng
 * `newsletter` mặc định, và đổi nó chỉ làm được qua AI/MCP.
 *
 * ## Vì sao chọn từ danh sách, không gõ tự do
 *
 * Một khoá gõ sai chính tả là một form im lặng tắt trên site. Ô chọn chỉ bày khoá có
 * trong bảng (kèm host để phân biệt staging với production) — cộng khoá đang dùng nếu
 * bảng chưa có nó, xem `endpointOptions`. Khoá MỚI thì tạo ở Cài đặt, nơi nhập URL.
 *
 * ## Ghi bằng `setProps`
 *
 * Cùng một `dispatch` với mọi ô khác của Inspector, nên undo, lịch sử và validator
 * (`composite_params`) đi theo không cần dòng code nào. `setProps` THAY cả `params`,
 * nên phải trải params thô cũ ra — xem `withEndpointKey`.
 */

import Link from 'next/link';

import { cn } from '@/lib/builder/cn';
import { endpointOptions, readEndpointKey, withEndpointKey } from '@/lib/builder/endpoint-options';
import { selectStyleLocked, useEditor } from '@/lib/builder/store';
import { focusRing, ui } from '@/lib/builder/ui';
import type { EndpointTable } from '@/lib/doc/endpoint-table';
import type { Node } from '@/lib/doc/types';
import { SelectField } from './ui/Field';
import { Icon } from './ui/Icon';

/**
 * Nhãn và lời giải thích theo composite. Composite không có ở đây thì không có khối —
 * cùng tập với `ENDPOINT_COMPOSITES` của `site-bindings.ts`.
 */
const COPY = {
  Form: { label: 'Gửi tới', off: 'form đang tắt (hiện vô hiệu kèm lý do)' },
  NavChart: { label: 'Nguồn số liệu', off: 'biểu đồ hiện "chưa có nguồn số liệu"' },
} as const;

/** Lời nhắc "vẫn chạy, nhưng có thứ bạn nên biết" — cùng khuôn `WARN_NOTE` của Inspector. */
const WARN = 'bg-shell-warn-soft text-shell-warn rounded-sm px-2.5 py-1.5 text-mini leading-snug';

const SETTINGS_HREF = '/builder/settings#settings-endpoints';

export function EndpointPicker({
  node,
  endpoints,
}: {
  node: Extract<Node, { type: 'Composite' }>;
  endpoints: EndpointTable;
}) {
  const dispatch = useEditor((s) => s.dispatch);
  // Khoá cả khi đang sửa bản dịch, dù khối đã ẩn ở chế độ đó: nguồn dữ liệu dùng chung
  // mọi ngôn ngữ, và selector này là MỘT chỗ quyết định điều đó cho cả Inspector.
  const saving = useEditor(selectStyleLocked);

  const copy = node.composite === 'Form' ? COPY.Form : node.composite === 'NavChart' ? COPY.NavChart : null;
  const state = readEndpointKey(node.composite, node.params);
  if (!copy || !state) return null;

  const current = state.key;
  const options = endpointOptions(endpoints, current);
  const missing = options.find((o) => o.key === current)?.missing ?? true;
  const empty = Object.keys(endpoints).length === 0;

  const pick = (key: string) => {
    if (key === current) return;
    void dispatch(
      [{ op: 'setProps', nodeId: node.id, props: { params: withEndpointKey(node.params, key) } }],
      { label: `đổi endpoint: ${key}` },
    );
  };

  return (
    <section data-endpoint-picker="" className="flex flex-col gap-1.5 px-3.5">
      {/*
        Bảng rỗng thì KHÔNG bày ô chọn: một ô chỉ có đúng một lựa chọn "chưa có URL" là
        một ô không chọn được gì, và nó trông y như một ô hỏng. Nói thẳng việc cần làm.
      */}
      {empty ? (
        <>
          <span className={ui.label}>{copy.label}</span>
          <p className={WARN} data-endpoint-missing="">
            Site chưa có endpoint nào — {copy.off} cho tới khi khoá{' '}
            <code className="font-shell-mono">{current}</code> có URL ở Cài đặt.
          </p>
        </>
      ) : (
        <>
          <SelectField
            size="sm"
            label={copy.label}
            value={current}
            disabled={saving}
            onChange={(e) => pick(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </SelectField>

          {missing && (
            <p className={WARN} data-endpoint-missing="">
              Khoá <code className="font-shell-mono">{current}</code> chưa có URL dùng được —{' '}
              {copy.off} cho tới khi đặt URL ở Cài đặt, rồi Publish.
            </p>
          )}
        </>
      )}

      {state.ignored && (
        // Khoá đã ghi nhưng `.catch()` của registry đưa cả params về mặc định — xem
        // `readEndpointKey`. Không nói ra thì ô chọn bật về khoá cũ mà không lý do.
        <p className={WARN}>
          Một tham số khác của {node.composite} đang sai, nên cả bộ tham số chạy theo mặc
          định và khoá vừa chọn chưa có tác dụng. Sửa tham số đó qua AI/MCP.
        </p>
      )}

      <Link
        href={SETTINGS_HREF}
        className={cn(
          'text-shell-accent inline-flex items-center gap-1 self-start rounded-xs text-mini font-medium underline-offset-2 hover:underline',
          focusRing,
        )}
        title="Mở màn Cài đặt ở ô Form — đổi URL, hoặc tách URL riêng cho form này"
      >
        Đặt URL ở Cài đặt › Form
        <Icon name="arrow-right" size={12} />
      </Link>
    </section>
  );
}
