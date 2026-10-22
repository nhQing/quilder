/**
 * So hai `Doc`. Hàm thuần, không chạm database.
 *
 * Tách khỏi `draft-diff.ts` vì file đó khai `server-only` và import `prisma` cho
 * `draftDiff()` — hàm đọc DB. Phép so thì không cần gì cả, và nó có HAI người
 * dùng: so nháp-với-live (màn Publish) và so version-với-version (lịch sử trang).
 *
 * Cùng tiền lệ với `static-css.ts` tách khỏi `style-bundle.ts`.
 *
 * ## Vì sao chỉ so id node và chữ thuần
 *
 * Diff style ở mức thuộc tính là một dự án riêng, và với người soát nó là nhiễu:
 * "n42.style.md.spacing.pt đổi từ 24 sang 32" không trả lời được câu hỏi họ đang
 * hỏi. Thứ trả lời được là: thêm gì, mất gì, chữ nào đổi.
 */

import { plainText } from '@/lib/doc/plain-text';
import type { Doc } from '@/lib/doc/types';

export interface TextChange {
  nodeId: string;
  before: string;
  after: string;
}

export interface DocDiff {
  added: string[];
  removed: string[];
  textChanged: TextChange[];
}

/** So chữ sau khi gộp khoảng trắng — xem test để biết vì sao. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * So hai doc.
 *
 * `live === null` nghĩa là chưa có bản trước để so — trang chưa publish bao giờ,
 * hoặc đây là version đầu tiên. Nó khác hẳn "bản trước rỗng": mọi node là mới.
 * Trả mảng rỗng ở đó là nói dối rằng không có gì đổi.
 */
export function diffDocs(live: Doc | null, draft: Doc): DocDiff {
  const liveNodes = live?.nodes ?? {};
  const draftIds = new Set(Object.keys(draft.nodes));
  const liveIds = new Set(Object.keys(liveNodes));

  const added = [...draftIds].filter((id) => !liveIds.has(id)).sort();
  const removed = [...liveIds].filter((id) => !draftIds.has(id)).sort();

  const textChanged: TextChange[] = [];
  for (const id of [...draftIds].sort()) {
    // Node vừa thêm không tính là "đổi chữ" — không thì nó hiện hai lần trong báo
    // cáo và tổng số nghe to gấp đôi thực tế.
    if (!liveIds.has(id)) continue;

    const before = norm(plainText((liveNodes[id] as { content?: never })?.content));
    const after = norm(plainText((draft.nodes[id] as { content?: never })?.content));
    if (before !== after) textChanged.push({ nodeId: id, before, after });
  }

  return { added, removed, textChanged };
}
