/**
 * Composite Accordion — FAQ mở/đóng, KHÔNG một dòng JavaScript nào.
 *
 * ## Vì sao composite chứ không phải effect
 *
 * Spec §7 đề xuất một effect `accordion` ghi state `open`. Không dùng cách đó, và
 * lý do là cơ học: `<details>`/`<summary>` không dựng được từ cây node —
 * `SectionNode.tag` chỉ nhận `section|header|footer|main|nav|aside`. Thêm hai tag
 * đó vào enum thì builder cho đặt một `summary` ở bất cứ đâu, mà một `summary`
 * ngoài `details` là vô nghĩa và không có gì chặn được.
 *
 * Đây đúng lằn ranh mà `PanelStack` đã kẻ: **nội dung là node, KHUNG là composite** —
 * *"quan hệ slot ↔ panel là chỗ dựng sai một tầng là sticky im lặng không hoạt
 * động, và im lặng không hoạt động là loại lỗi tệ nhất trong một công cụ trực
 * quan."* Với accordion, dựng sai một tầng nghĩa là tám mục FAQ mở sẵn vĩnh viễn.
 *
 * ## Vì sao KHÔNG có JavaScript
 *
 * `<details>` đã cho mở/đóng, bàn phím, và `Ctrl+F` tìm được chữ trong mục đang
 * đóng (Chrome/Safari hiện đại tự mở mục khớp). Và `<details name="...">` cho luật
 * "một mục mở" — thứ mà spec dự tính phải viết JS để có.
 *
 * README ghi non-goal *"Không hỗ trợ mọi browser. Evergreen thôi"*, và `name` có ở
 * Chrome 120+ / Safari 17.2+ / Firefox 130+. Trên bản cũ hơn, thuộc tính bị bỏ qua
 * và accordion vẫn dùng được — chỉ là mở được nhiều mục cùng lúc. Đó là degrade
 * đúng chiều: mất một luật, không mất tính năng.
 *
 * Cái giá: không có hoạt ảnh chiều cao. Hoạt ảnh cho `<details>` cần JS đo chiều
 * cao thật, và nó là thứ đánh đổi 100% khả năng dùng-được-khi-tắt-JS cho một
 * chuyển động. Nếu về sau muốn, nó là một effect RIÊNG gắn thêm — không phải lý do
 * để bỏ `<details>`.
 *
 * ## Quy ước khoá slot
 *
 * `q-1`/`a-1` … `q-N`/`a-N` — câu hỏi và câu trả lời của mục thứ N. Sắp theo SỐ,
 * không theo chuỗi: sắp theo chuỗi thì `q-10` nằm giữa `q-1` và `q-2`.
 *
 * Mục thiếu `q-N` bị BỎ QUA (một `summary` rỗng là một mục không bấm được), còn
 * thiếu `a-N` thì vẫn render — một câu hỏi chưa có câu trả lời là nội dung đang
 * viết dở, và ẩn nó đi thì tác giả không thấy chỗ mình còn nợ.
 */

import type { NodeId } from '@/lib/doc/types';
import type { AccordionParams } from './registry';

export interface AccordionItem {
  key: string;
  n: number;
  question: NodeId[];
  answer: NodeId[];
}

export function itemsFrom(slots: Record<string, NodeId[]>): AccordionItem[] {
  const out: AccordionItem[] = [];

  for (const [key, children] of Object.entries(slots)) {
    const m = /^q-(\d+)$/.exec(key);
    if (!m || !children?.length) continue;
    const n = Number(m[1]);
    out.push({ key, n, question: children, answer: slots[`a-${n}`] ?? [] });
  }

  out.sort((a, b) => a.n - b.n);
  return out;
}

export interface AccordionProps extends AccordionParams {
  slots: Record<string, NodeId[]>;
  renderChild: (id: NodeId) => React.ReactNode;
  /** Id node, để `name` của nhóm không đụng accordion khác trên cùng trang. */
  groupName: string;
}

export function Accordion({ slots, renderChild, single, openFirst, groupName }: AccordionProps) {
  const items = itemsFrom(slots);

  // Không có mục nào: hiện khung rỗng thay vì không gì cả, để node vẫn chọn được
  // trong builder. Một composite vô hình là một node không sửa được.
  if (!items.length) {
    return <div className="mm-accordion-root" data-accordion-empty="" />;
  }

  return (
    <div className="mm-accordion-root">
      {items.map((item, i) => (
        <details
          key={item.key}
          className="mm-accordion__item"
          data-part="accordion-item"
          /*
           * `name` là thứ tạo ra luật "một mục mở", ở tầng trình duyệt.
           *
           * Lấy theo id node chứ không một chuỗi cố định: hai accordion trên cùng
           * trang mà chung `name` thì mở một mục ở khối này sẽ đóng mục ở khối kia
           * — và không có gì trên giao diện giải thích tại sao.
           */
          {...(single ? { name: `mm-acc-${groupName}` } : {})}
          {...(openFirst && i === 0 ? { open: true } : {})}
        >
          <summary className="mm-accordion__q" data-part="accordion-q">
            {item.question.map(renderChild)}
          </summary>
          <div className="mm-accordion__a" data-part="accordion-a">
            {item.answer.map(renderChild)}
          </div>
        </details>
      ))}
    </div>
  );
}

export default Accordion;
