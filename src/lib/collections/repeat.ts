/**
 * Một item của khối lặp → `Record<NodeId, ContentOverride>`.
 *
 * ## Vì sao THUẦN, và vì sao tách khỏi renderer
 *
 * Đây là cơ chế mà cả mốc 3 dựa vào, và cách nó hỏng là IM LẶNG: đưa một chuỗi vào
 * `content` (vốn là `RichText`, tức một MẢNG) thì `RichTextView` nhận một thứ không
 * lặp được và render ra rỗng — không lỗi, không cảnh báo, chỉ một thẻ trống. Tách
 * thuần nghĩa là mọi ca đó có test chạy trong một giây, không cần DB và không cần
 * dựng một trang.
 *
 * Không `server-only`: file này không chạm gì, và nó phải test được.
 */

import type { ContentOverride, NodeId, RepeatSpec, RichText } from '@/lib/doc/types';
import { isRelationRef } from './relation-expand';

export interface RepeatItem {
  /** Khoá React, và là id entry khi item là một entry. */
  key: string;
  data: Record<string, unknown>;
  slug?: string;
  typeKey?: string;
  /** Mốc đăng, ISO-8601. Là CỘT của `Entry` — xem `VIRTUAL_KEYS`. */
  publishedAt?: string;
  /** Mốc sửa gần nhất, ISO-8601. Cũng là cột. */
  updatedAt?: string;
  /**
   * Danh mục của entry, ĐÃ sắp thứ tự. Rỗng/vắng = bài chưa gắn danh mục nào.
   *
   * Thứ tự phải do bên nạp quyết định chứ không phải thứ tự Postgres trả về: khoá
   * ảo `taxonomy` lấy phần tử ĐẦU làm huy hiệu, nên một thứ tự không xác định là
   * một huy hiệu đổi chữ giữa hai lần tải trang.
   */
  taxonomies?: { key: string; name: string }[];
  /**
   * Tác giả — `Entry.createdBy`, KHÔNG phải `updatedBy`. Xem `VIRTUAL_KEYS`.
   *
   * `locked` có mặt nhưng KHÔNG hiện ra site: tài khoản đã khoá vẫn đứng tên bài
   * họ viết (đó là mục đích của việc khoá thay vì xoá). Nó ở đây để một màn quản
   * trị dùng lại `RepeatItem` còn biết mà dán nhãn.
   */
  author?: { email: string; name: string | null; avatarAssetId: string | null; locked: boolean };
}

const viNumber = new Intl.NumberFormat('vi-VN');
const viDate = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'long' });

/* ── Khoá ảo ──────────────────────────────────────────────────────────── */

/**
 * Thứ `map` đọc được mà KHÔNG nằm trong `Entry.data`.
 *
 * ## Vì sao phải có bảng này, và vì sao là MỘT bảng
 *
 * `Entry` có những thứ quan trọng nhất của một thẻ tin nằm ngoài JSONB: slug là
 * một cột, ngày đăng là một cột, danh mục là một BẢNG NỐI (`EntryTaxonomy` — xem
 * docblock của model `Taxonomy` để biết vì sao nó không thể nằm trong `data`).
 * Mà `readField` đọc `item.data[key]`, nên mọi thứ ấy trả `undefined`, và
 * `itemOverrides` cố ý bỏ qua `undefined` — lý do ấy đúng (xem `toRichText`), nên
 * hậu quả là một cấu hình được nhận, được lưu, rồi KHÔNG BAO GIỜ có tác dụng.
 *
 * Đó không phải giả thuyết: `map: { taxonomy: … }` đã nằm trên
 * `/blogs/san-pham` trên staging ở bản ĐÃ PUBLISH, và mọi thẻ mang huy hiệu
 * `Danh mục` thay vì `Sản phẩm`.
 *
 * Một bảng chứ không phải bốn nhánh `if` rải rác, vì bảng này còn được ĐỌC ở
 * đường ghi: `validateOps` từ chối một khoá `map` không có trong `FieldDef[]` của
 * loại và cũng không có ở đây. Hai bản của cùng một danh sách sẽ trôi khỏi nhau,
 * và thứ trôi mất là một lỗi im lặng nữa.
 *
 * ## `overrideData` — vì sao không cùng một luật cho mọi khoá
 *
 * `slug` PHẢI thắng: `data[<field slug>]` giữ chữ tác giả gõ (chưa qua `toSlug`,
 * chưa khử trùng lặp), còn `Entry.slug` là URL thật. Lấy nhầm là mọi thẻ bấm ra
 * 404.
 *
 * `published_at` / `updated_at` thì NGƯỢC LẠI: một loại nội dung được phép có
 * field cùng tên (bài nhập từ hệ thống cũ hay giữ ngày gốc trong `data`), và một
 * cột hệ thống lặng lẽ đè lên dữ liệu của tác giả là thứ không ai lần ra.
 *
 * ## Vì sao `taxonomy` là tên CỐ ĐỊNH, không theo tên field
 *
 * Loại nội dung khai field danh mục bằng tên gì cũng được (`danh_muc`,
 * `chuyen_muc`), nhưng file này THUẦN — nó không có `FieldDef[]` để tra, và nạp
 * schema vào đây là kéo cả một lượt đọc DB vào một hàm thuần (cùng lý lẽ với
 * `toDateText`). Nên tên ở đây cố định, và đường ghi chỉ chỗ: `validateOps` bắt
 * một `map` trỏ vào field `t: 'taxonomy'` và nói dùng khoá `taxonomy` thay thế.
 *
 * KHÔNG có `as: 'href'` cho hai khoá danh mục: `hrefBase` chọn gốc theo NGUỒN của
 * khối lặp, nên một khối nguồn `query` sẽ ghép tên danh mục vào gốc trang chi
 * tiết — `/blogs/post/san-pham`, một URL 404 chỉ lộ ra khi có người bấm.
 */
interface VirtualKey {
  read: (item: RepeatItem) => unknown;
  /** `true` = cột thắng field cùng tên. Xem docblock. */
  overrideData: boolean;
  /** Nhãn cho ô chọn *Ánh xạ* của Inspector. */
  label: string;
  /** Hiện ra trong câu lỗi của `validateOps`, nên viết cho người dựng đọc. */
  note: string;
}

export const VIRTUAL_KEYS: Record<string, VirtualKey> = {
  slug: {
    read: (i) => i.slug,
    overrideData: true,
    label: 'Đường dẫn',
    note: 'đường dẫn của bài (cột `Entry.slug`) — ánh xạ vào `href`',
  },
  published_at: {
    read: (i) => i.publishedAt,
    overrideData: false,
    label: 'Ngày đăng',
    note: 'ngày đăng (cột `Entry.publishedAt`) — vào `content` sẽ ra ngày kiểu Việt Nam',
  },
  updated_at: {
    read: (i) => i.updatedAt,
    overrideData: false,
    label: 'Ngày sửa gần nhất',
    note: 'ngày sửa gần nhất (cột `Entry.updatedAt`)',
  },
  taxonomy: {
    read: (i) => i.taxonomies?.[0]?.name,
    overrideData: true,
    label: 'Danh mục (cái đầu tiên)',
    note: 'tên danh mục ĐẦU TIÊN của bài — dùng cho huy hiệu một chữ trên thẻ',
  },
  taxonomies: {
    read: (i) => {
      const names = i.taxonomies?.map((t) => t.name).filter(Boolean) ?? [];
      return names.length ? names.join(', ') : undefined;
    },
    overrideData: true,
    label: 'Danh mục (tất cả)',
    note: 'TẤT CẢ danh mục của bài, nối bằng dấu phẩy',
  },
  author: {
    /*
     * Tên, rơi về email khi tài khoản chưa đặt tên.
     *
     * Rơi về email chứ không về rỗng: một byline trống trông như thẻ hỏng, và
     * nó không nói cho ai biết phải sửa ở đâu. Một email trên byline thì XẤU, và
     * cái xấu ấy là thứ làm người ta vào đặt tên cho tài khoản.
     */
    read: (i) => i.author?.name?.trim() || i.author?.email,
    overrideData: true,
    label: 'Tác giả',
    note: 'tên tài khoản đã TẠO bài (`Entry.createdBy`) — không phải người sửa gần nhất',
  },
  author_avatar: {
    /*
     * Hình dạng `{ assetId, alt }` để `as: 'assetId'` dùng lại nguyên nhánh đã có
     * cho field ảnh — kể cả phần tự điền `alt`, thứ mà không có nó thì mười ảnh
     * đại diện khác nhau được đọc lên bằng cùng một câu.
     */
    read: (i) =>
      i.author?.avatarAssetId
        ? { assetId: i.author.avatarAssetId, alt: i.author.name?.trim() || i.author.email }
        : undefined,
    overrideData: true,
    label: 'Ảnh đại diện tác giả',
    note: 'ảnh đại diện của tài khoản đã tạo bài — ánh xạ vào `assetId`',
  },
};

/**
 * Giá trị bất kỳ → `RichText`, hoặc `undefined` nếu không ánh xạ được.
 *
 * `undefined` là câu trả lời ĐÚNG cho chuỗi rỗng: một `RichText` rỗng ghi đè chữ của
 * component bằng chữ trắng, và thẻ trông như hỏng. Vắng override thì thẻ giữ chữ gốc
 * — trông có chủ đích hơn hẳn, và người dựng thấy ngay là mình chưa ánh xạ field đó.
 */
export function toRichText(v: unknown): RichText | undefined {
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? [{ t: 'text', v: s }] : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return [{ t: 'text', v: viNumber.format(v) }];
  // Field `richtext` đã là cây inline — giữ NGUYÊN, không bọc thêm một lớp. Bọc lại
  // là biến `<strong>Đậm</strong>` thành chữ thường mà không ai thấy vì sao.
  if (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof v[0] === 'object' &&
    v[0] !== null &&
    't' in (v[0] as object)
  ) {
    return v as RichText;
  }
  return undefined;
}

/**
 * Chuỗi ISO-8601 CÓ GIỜ → ngày kiểu Việt Nam. Mọi thứ khác trả `undefined`.
 *
 * Vì sao phải đoán từ hình dạng chuỗi: `RepeatItem.data` đến thẳng từ JSONB và ở đây
 * KHÔNG có `FieldDef[]` để tra kiểu — nạp schema vào hàm này là kéo cả `field-def` và
 * một lượt đọc DB vào một hàm thuần. Không có bước đoán này thì một field `date` hiện
 * nguyên `2026-08-15T00:00:00.000Z` trên thẻ tin, và đó là thứ lọt ra production vì
 * nó "vẫn hiện chữ".
 *
 * Cố ý HẸP — chỉ khớp dạng đầy đủ có `T` và giờ. `2026` và `19/08` là chữ người ta gõ,
 * không phải mốc thời gian, và đổi chúng thành ngày là sửa dữ liệu của tác giả.
 */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

export function toDateText(v: unknown): RichText | undefined {
  if (typeof v !== 'string' || !ISO_DATETIME.test(v.trim())) return undefined;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? undefined : [{ t: 'text', v: viDate.format(d) }];
}

/**
 * `RelationRef` (hoặc một mảng chúng) → thứ mà một vai cụ thể cần.
 *
 * Trả `undefined` khi vai ấy không có gì để lấy — thẻ giữ nội dung gốc, đúng
 * luật chung của file này.
 *
 * ## Vì sao `many` cư xử khác nhau theo vai
 *
 * `content`/`label` NỐI mọi tiêu đề: "Lãi suất, Tiết kiệm" là câu trả lời đúng
 * cho một huy hiệu nhiều chuyên đề, và cùng luật với khoá ảo `taxonomies`.
 *
 * `href`/`assetId` lấy CÁI ĐẦU: một thẻ có đúng một đường dẫn và đúng một ảnh,
 * nên nối lại là vô nghĩa. Lấy cái đầu là quy ước, và nó xác định được vì thứ tự
 * ID trong JSONB là thứ tự người biên tập đã chọn.
 */
function fromRelation(raw: unknown, as: keyof ContentOverride): unknown {
  const refs = Array.isArray(raw) ? raw.filter(isRelationRef) : isRelationRef(raw) ? [raw] : null;
  if (!refs || !refs.length) return undefined;

  switch (as) {
    case 'content':
    case 'label':
    case 'alt':
    case 'a11yLabel': {
      const titles = refs.map((r) => r.title).filter(Boolean);
      return titles.length ? titles.join(', ') : undefined;
    }
    case 'href':
      return refs[0]!.href;
    case 'assetId':
      return refs[0]!.assetId ? { assetId: refs[0]!.assetId, alt: refs[0]!.alt } : undefined;
  }
}

/** Một khoá `map` → giá trị, qua bảng khoá ảo rồi mới tới `data`. */
function readField(item: RepeatItem, key: string): unknown {
  const virtual = VIRTUAL_KEYS[key];
  if (!virtual) return item.data[key];

  const fromColumn = virtual.read(item);
  if (virtual.overrideData) return fromColumn ?? item.data[key];
  return item.data[key] ?? fromColumn;
}

/**
 * Gốc để dựng href, chọn theo NGUỒN của khối lặp.
 *
 * Một trang danh sách có thể mang cả hai khối cùng lúc: dải danh mục (nguồn
 * `taxonomy`, href phải ra `/blogs/<key>`) và thẻ tin (nguồn `query`, href phải ra
 * `/blogs/post/<slug>`). Dùng chung một gốc là dải danh mục trỏ vào gốc bài viết —
 * mọi ô đều bấm ra 404, và chỉ lộ ra khi có người bấm.
 */
function hrefBase(spec: RepeatSpec, opts: HrefBases): string | undefined {
  return spec.source.kind === 'taxonomy' ? opts.taxonomyBase : opts.detailBase;
}

export interface HrefBases {
  /** Gốc trang chi tiết, ví dụ '/blogs/post'. */
  detailBase?: string;
  /** Gốc trang danh mục, ví dụ '/blogs'. */
  taxonomyBase?: string;
}

export function itemOverrides(
  item: RepeatItem,
  spec: RepeatSpec,
  opts: HrefBases,
): Record<NodeId, ContentOverride> {
  const out: Record<NodeId, ContentOverride> = {};

  for (const [fieldKey, target] of Object.entries(spec.map)) {
    const read = readField(item, fieldKey);

    /*
     * Quan hệ đã nở được dịch sang vai TRƯỚC `switch`, rồi đi tiếp bằng đúng các
     * nhánh đã có (chuỗi cho chữ, `{ assetId, alt }` cho ảnh).
     *
     * `isRelation` phải kiểm riêng chứ không dựa vào `fromRelation` trả
     * `undefined`: một quan hệ có thật mà bản ghi đích chưa đặt tiêu đề cũng cho
     * `undefined`, và rơi về `read` ở đó sẽ in nguyên `{ __rel: true, id: … }`
     * — tức đúng cái cuid mà cả cơ chế này tồn tại để không in ra.
     */
    const isRelation = Array.isArray(read) ? read.some(isRelationRef) : isRelationRef(read);
    const raw = isRelation ? fromRelation(read, target.as) : read;
    if (raw === undefined || raw === null) continue;

    // Gộp thay vì gán: hai field ánh xạ vào CÙNG một node (chữ của nút + đường dẫn của
    // nút) là cấu hình bình thường, và gán sẽ làm cái sau xoá cái trước — im lặng.
    const at = (out[target.nodeId] ??= {});

    switch (target.as) {
      case 'content':
      case 'label': {
        // Ngày TRƯỚC chữ: `toRichText` nhận mọi chuỗi, nên thử nó trước sẽ làm mọi
        // mốc thời gian hiện nguyên dạng ISO. Xem `toDateText`.
        const rt = toDateText(raw) ?? toRichText(raw);
        if (rt) at[target.as] = rt;
        break;
      }
      case 'assetId': {
        if (typeof raw === 'object' && raw !== null && 'assetId' in raw) {
          const pick = raw as { assetId?: unknown; alt?: unknown };
          if (typeof pick.assetId === 'string') at.assetId = pick.assetId;
          // `alt` đi kèm mà KHÔNG cần một dòng ánh xạ riêng: dòng đó ai cũng quên, và
          // hậu quả là mười thẻ dùng chung một chữ thay ảnh của component — tức mười
          // ảnh khác nhau được đọc lên bằng cùng một câu.
          if (typeof pick.alt === 'string' && pick.alt.trim()) at.alt = pick.alt.trim();
        } else if (typeof raw === 'string' && raw) {
          at.assetId = raw;
        }
        break;
      }
      case 'href': {
        if (typeof raw === 'string' && raw) {
          const base = hrefBase(spec, opts);
          at.href = base ? `${base.replace(/\/+$/, '')}/${raw}` : raw;
        } else if (typeof raw === 'object' && raw !== null && 'href' in raw) {
          // Field `link` là `{ href, label }` — xem `zLinkValue` ở entry-data.ts.
          const link = raw as { href?: unknown };
          if (typeof link.href === 'string' && link.href) at.href = link.href;
        }
        break;
      }
      case 'alt':
      case 'a11yLabel': {
        if (typeof raw === 'string' && raw.trim()) at[target.as] = raw.trim();
        break;
      }
    }

    // Không ánh xạ được gì thì gỡ HẲN khoá: một override rỗng `{}` làm `applyOverride`
    // chạy một lượt clone node cho không có gì, mười lần mỗi thẻ.
    if (Object.keys(at).length === 0) delete out[target.nodeId];
  }

  return out;
}
