'use client';

/**
 * Màn 4 — form entry.
 *
 * ## Một nguồn sự thật duy nhất
 *
 * `data` sống ở đây; `FieldInput` chỉ nhận giá trị và bắn `path` lên. Mọi thao tác
 * đi qua bốn hàm của `form-state.ts`, vốn đã có test — nên component này không
 * chứa một phép biến đổi cây nào.
 *
 * ## Vì sao "Lưu nháp" và "Đăng" là hai nút
 *
 * Gộp chúng thành một nút Lưu có checkbox `publish` là cách chắc chắn để một lần
 * lưu nháp vô tình đưa bài lên sóng — và với `Entry` là nguồn LIVE thì "lên sóng"
 * nghĩa là ngay lập tức, không có bước publish nào để rút lại.
 *
 * ## Thanh hành động đổi theo trạng thái, không bày hết mọi lúc
 *
 * Bài CHƯA đăng: `Lưu nháp` (phụ) + `Đăng` (chính). Bài ĐÃ đăng: `Chuyển về nháp`
 * (nguy hiểm) + `Lưu` (chính) — không còn nút "Đăng" vì bài đang ở trên site rồi,
 * và với nguồn LIVE thì bấm Lưu CHÍNH LÀ đẩy bản mới lên. Nhãn "Lưu nháp" trên một
 * bài đang chạy là nói dối: nó không hạ bài xuống nháp.
 *
 * Trước đây khối Trạng thái ở sidebar còn một toggle `Nháp | Đã đăng` đổi được
 * trạng thái — bốn điều khiển cho cùng một việc. Toggle đã bị bỏ; mọi thứ đổi
 * trạng thái đều là nút và đều ở đây.
 *
 * ## Vì sao KHÔNG có xem trước slug tại chỗ
 *
 * Slug do SERVER suy ra (`deriveSlug` + `uniqueSlug` trong `entry-write.ts`): nó
 * cần biết những slug đã bị chiếm để thêm hậu tố. Tính lại ở client là chép luật
 * ra chỗ thứ hai, và chỗ thứ hai sẽ hiện một đường dẫn khác với đường dẫn thật
 * ngay lần đầu có hai bài trùng tiêu đề. Ô slug hiện giá trị THẬT sau khi lưu, và
 * "Sửa tay" ghi vào `data` — server tôn trọng giá trị đã có.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { toSlug } from '@/lib/builder/slug';
import { ui } from '@/lib/builder/ui';

import type { FieldDef, GroupTable } from '@/lib/collections/field-def';
import {
  appendItem, emptyEntry, moveItem, removeItem, writeAt, type FormPath,
} from '@/lib/collections/form-state';
import { applyEntryLocale, localeCoverage } from '@/lib/collections/i18n';
import { seoKeyOf } from '@/lib/collections/seo';
import { localePublishState, type LocalePublishState } from '@/lib/collections/entry-locale';
import { FieldInput } from './FieldInput';
import type { SeoContext } from './SeoFieldInput';
import type { EntryActivity, WriterOption } from '@/lib/collections/entry-activity';
import { EntryActions, EntryDangerBox, EntryViewBox } from './EntryActions';
import { EntryLocalePanel } from './EntryLocalePanel';
import { EntrySidebar } from './EntrySidebar';
import { EntryPreview } from './EntryPreview';
import { Button } from './ui/Button';
import { Note } from './ui/Note';
import { PageHeader, PageShell } from './ui/Page';
import { Tabs } from './ui/Tabs';

/** Trạng thái đăng của một bản dịch, nói bằng chữ trong `title` của tab ngôn ngữ. */
const LOCALE_STATE_TEXT: Record<LocalePublishState, string> = {
  live: 'đang trên site',
  scheduled: 'đã hẹn giờ',
  draft: 'nháp',
  missing: 'chưa có bản này',
};

/**
 * Khoá `localStorage` cho lựa chọn bật/tắt cột xem cạnh.
 *
 * Tiền tố `mm-` để không đụng khoá của thư viện nào, và không mang id entry: người
 * dùng bật cột này là một thói quen làm việc, không phải một thuộc tính của từng bài
 * — mang id vào khoá thì bật ở bài này rồi mở bài khác lại thấy tắt.
 */
const PREVIEW_KEY = 'mm-entry-preview';

/**
 * Nhãn ngày trên nút "Hẹn đăng" — ngày/tháng, không giờ, không năm.
 *
 * Nút phải đọc lướt được. Mốc đầy đủ đã nằm ngay dưới, trong ô "Đăng lúc" của khối
 * Trạng thái; lặp lại nó trên nút chỉ làm nút dài ra chứ không nói thêm gì.
 */
const DAY = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' });

export function EntryForm(props: {
  typeKey: string;
  typeName: string;
  fields: FieldDef[];
  groups: GroupTable;
  taxonomies: { id: string; key: string; name: string; parentId: string | null }[];
  locales: { code: string; label: string; isDefault: boolean; enabled: boolean }[];
  entry: {
    id: string; slug: string; data: Record<string, unknown>; i18n: Record<string, unknown>;
    status: string; publishedAt: Date | null; taxonomyIds: string[];
    /** Slug và trạng thái đăng của từng ngôn ngữ — hàng `EntryLocale`. */
    locales: { locale: string; slug: string | null; status: string; publishedAt: Date | null }[];
    createdAt: Date; createdBy: string; updatedAt: Date; updatedBy: string;
  } | null;
  /**
   * Host được phép cho `<iframe>` trong thân bài `html` — chỉ dùng cho CỘT XEM TRƯỚC.
   *
   * Form không lọc gì lúc gửi: đường ghi (`entry-data.ts`) làm sạch bằng danh sách
   * host đọc từ database ngay lúc đó, và một bản sao trong state của form sẽ cũ hơn.
   * Prop này chỉ để cột xem trước hiện ĐÚNG thứ sẽ lên site.
   */
  iframeHosts: readonly string[];
  /**
   * Cho khung xem trước Google của field `seo`: gốc site, `title.template`, gốc trang chi
   * tiết (`null` khi loại không có), và field tiêu đề của loại. Đọc ở server page.
   */
  /** Người tạo, người sửa kèm avatar, và lịch sử cập nhật — `getEntryActivity`. `null` với bài mới. */
  activity?: EntryActivity | null;
  /** Tài khoản để đổi tác giả — chỉ admin nhận danh sách; rỗng là chỉ xem. */
  writerOptions?: WriterOption[];
  seoPreview: {
    origin: string;
    siteHost: string | null;
    titleTemplate: string | null;
    detailBase: string | null;
    titleField: string | null;
  };
}) {
  const router = useRouter();

  /*
   * Field `slug` KHÔNG thuộc lớp phủ bản dịch, và phải bị GỠ chứ không chỉ bị ẩn.
   *
   * Slug riêng của một ngôn ngữ sống ở bảng `EntryLocale`. Ẩn ô nhập là chưa đủ: giá
   * trị vẫn nằm trong object lớp phủ (từ `emptyEntry`) và vẫn đi lên theo `PATCH`, và
   * `validateEntryDataPartial` từ chối cả lớp phủ vì slug rỗng —
   *
   *     Bản dịch en: slug: Không được để trống
   *
   * tức KHÔNG dịch được bài nào. e2e bắt được đúng câu đó.
   *
   * Gỡ nó còn sửa một chỗ thứ hai: `localeCoverage` đếm trên số field không rỗng của
   * `data`, nên còn `slug` trong mẫu số thì một bài dịch xong tiêu đề hiện 50% và
   * KHÔNG BAO GIỜ tới được 100% — một con số không thể đúng là một con số không ai tin.
   */
  const slugKeys = new Set(props.fields.filter((f) => f.t === 'slug').map((f) => f.key));
  /** Khoá field SEO — lớp phủ ngôn ngữ xử lý riêng nó, xem `applyEntryLocale`. */
  const seoKey = seoKeyOf(props.fields);
  const withoutSlug = (v: Record<string, unknown>): Record<string, unknown> => {
    if (!slugKeys.size) return v;
    const out = { ...v };
    for (const k of slugKeys) delete out[k];
    return out;
  };

  const [data, setData] = useState<Record<string, unknown>>(
    // Entry cũ được PHỦ lên giá trị rỗng, không dùng thẳng: một field vừa được
    // thêm vào cấu trúc thì entry cũ không có khoá đó, và control của nó sẽ nhận
    // `undefined` — React nhảy sang uncontrolled và mất con trỏ giữa lúc gõ.
    props.entry
      ? { ...emptyEntry(props.fields, props.groups), ...props.entry.data }
      : emptyEntry(props.fields, props.groups),
  );
  const [taxonomyIds, setTaxonomyIds] = useState<string[]>(props.entry?.taxonomyIds ?? []);
  const [status, setStatus] = useState(props.entry?.status ?? 'draft');
  const [publishedAt, setPublishedAt] = useState<string>(
    props.entry?.publishedAt ? toLocalInput(props.entry.publishedAt) : '',
  );
  const [slugManual, setSlugManual] = useState(false);

  /*
   * Ngôn ngữ đang mở. `null` = BẢN GỐC.
   *
   * Cùng quy ước với đường đọc (`locale === undefined` là mặc định, xem
   * `entry-locale.ts`), nên không có phép chuyển đổi nào giữa hai đầu — một cái
   * `undefined` và một cái `null` chỉ vì `useState` không phân biệt được "chưa đặt".
   */
  const [active, setActive] = useState<string | null>(null);

  /*
   * Lớp phủ của TỪNG ngôn ngữ, phủ lên giá trị rỗng đúng như `data`.
   *
   * Phủ lên `emptyEntry` chứ không dùng thẳng lớp phủ đã lưu, vì lớp phủ là BỘ PHẬN:
   * field chưa dịch không có khoá, control của nó nhận `undefined`, và React nhảy
   * sang uncontrolled rồi mất con trỏ giữa lúc gõ — đúng cái bẫy đã ghi ở `data`.
   *
   * Lưu một lớp phủ toàn giá trị rỗng là VÔ HẠI: `applyEntryLocale` bỏ qua giá trị
   * rỗng và `localeCoverage` không đếm chúng, nên mở tab rồi lưu mà không gõ gì vẫn
   * là 0% đã dịch.
   */
  const [i18n, setI18n] = useState<Record<string, Record<string, unknown>>>(() => {
    const src = (props.entry?.i18n ?? {}) as Record<string, unknown>;
    const out: Record<string, Record<string, unknown>> = {};
    for (const l of props.locales) {
      if (l.isDefault || !l.enabled) continue;
      const at = src[l.code];
      out[l.code] = withoutSlug({
        ...emptyEntry(props.fields, props.groups),
        ...(at && typeof at === 'object' ? (at as Record<string, unknown>) : {}),
      });
    }
    return out;
  });

  /** Slug + trạng thái đăng của từng ngôn ngữ, dạng đã sẵn cho `<input>`. */
  const [locState, setLocState] = useState<
    Record<string, { slug: string; status: string; publishedAt: string; exists: boolean }>
  >(() => {
    const rows = props.entry?.locales ?? [];
    const out: Record<string, { slug: string; status: string; publishedAt: string; exists: boolean }> = {};
    for (const l of props.locales) {
      if (l.isDefault || !l.enabled) continue;
      const row = rows.find((r) => r.locale === l.code);
      out[l.code] = {
        slug: row?.slug ?? '',
        status: row?.status ?? 'draft',
        publishedAt: row?.publishedAt ? toLocalInput(row.publishedAt) : '',
        exists: !!row,
      };
    }
    return out;
  });

  /** Ngôn ngữ dịch được: đã bật, và không phải mặc định. */
  const transLocales = props.locales.filter((l) => !l.isDefault && l.enabled);
  const baseLocale = props.locales.find((l) => l.isDefault);

  /** Giá trị đang được sửa: `data` ở tab gốc, lớp phủ ở tab ngôn ngữ. */
  const values = active ? (i18n[active] ?? {}) : data;

  /*
   * Mốc "bây giờ" chụp MỘT lần, không gọi `new Date()` trong thân render.
   *
   * Huy hiệu trên tab phân biệt "đã hẹn giờ" với "đang trên site" bằng một phép so
   * mốc, và một `new Date()` mới ở mỗi lượt render nghĩa là hai lượt render cạnh
   * nhau có thể ra hai chữ khác nhau — React báo lệch hydration và bỏ markup của
   * server. Huy hiệu này không cần đúng tới giây; nó cần ổn định.
   */
  const [mountedAt] = useState(() => Date.now());
  /*
   * Cột xem cạnh: bật/tắt và bản chụp đã hoãn.
   *
   * Mặc định TẮT rồi mới đọc `localStorage` trong effect, không đọc trong hàm khởi
   * tạo `useState`: component này là `'use client'` nhưng vẫn được render ở server,
   * và server không có `localStorage`. Đọc lúc khởi tạo cho hai kết quả khác nhau ở
   * hai phía và React sẽ báo lệch hydration — rồi bỏ luôn markup của server.
   *
   * Lựa chọn này là TIỆN LỢI của một người trên một máy, không phải state của dữ
   * liệu, nên nó thuộc `localStorage` chứ không thuộc `Entry`.
   */
  const [preview, setPreview] = useState(false);
  // Khởi tạo bằng `data`, không bằng `{}`: khi `localStorage` bật cột lên ngay lúc
  // mount, một khởi tạo rỗng cho 200ms hiện một bài trắng trước khi bản chụp đầu
  // tiên tới.
  const [shown, setShown] = useState<Record<string, unknown>>(() => data);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  /*
   * "Có gì chưa ghi hay không" — cái quyết định ba nút sáng hay tối.
   *
   * Mục MỚI thì dirty ngay từ đầu: có một bài chưa tồn tại đang chờ được tạo. Mục cũ
   * mở ra thì KHÔNG, dù `saved` cũng là `false` — `saved` trả lời "vừa lưu xong
   * chưa" (để hiện chữ "đã lưu"), không trả lời "có gì để lưu không". Dùng lẫn hai
   * câu đó làm mọi mục vừa mở ra trông như đang có thay đổi chưa ghi.
   */
  const [dirty, setDirty] = useState(!props.entry);

  /**
   * Đánh dấu có thay đổi. MỌI đường ghi vào form phải đi qua đây.
   *
   * Trước đó chỉ `onChange` gọi `setSaved(false)`; `onAppend`, `onRemove`, `onMove`,
   * danh mục và mốc đăng thì không. Với nút luôn bấm được thì lỗi đó vô hình — thêm
   * một khối vào bài rồi bấm Lưu vẫn lưu đúng. Từ lúc nút SÁNG THEO trạng thái này,
   * bỏ sót một đường ghi nghĩa là người dùng sửa thật mà nút vẫn tối, và không có
   * cách nào lưu ngoài việc gõ thêm vào một field text.
   */
  const touch = () => {
    setSaved(false);
    setDirty(true);
  };

  /*
   * MỘT bộ handler cho hai đích, không phải hai bộ.
   *
   * `FieldInput` không biết nó đang sửa bản gốc hay bản dịch, và nó không nên biết:
   * hai bộ handler nghĩa là mọi field phải được truyền đúng bộ, và chỗ nào quên là
   * chỗ đó gõ vào tab tiếng Anh mà ghi vào bản gốc — thứ không có cách nào phát
   * hiện ngoài việc mở site ra xem.
   */
  const edit = (fn: (cur: Record<string, unknown>) => Record<string, unknown>) => {
    if (active) setI18n((m) => ({ ...m, [active]: fn(m[active] ?? {}) }));
    else setData(fn);
  };

  const onChange = (path: FormPath, value: unknown) => {
    touch();
    edit((d) => writeAt(d, path, value));
  };
  const onAppend = (path: FormPath, item: unknown) => {
    touch();
    edit((d) => appendItem(d, path, item));
  };
  const onRemove = (path: FormPath, i: number) => {
    touch();
    edit((d) => removeItem(d, path, i));
  };
  const onMove = (path: FormPath, i: number, dir: -1 | 1) => {
    touch();
    edit((d) => moveItem(d, path, i, dir));
  };

  useEffect(() => {
    try {
      setPreview(window.localStorage.getItem(PREVIEW_KEY) === '1');
    } catch {
      // Chế độ riêng tư của Safari ném ở chính lời gọi `getItem`. Một tuỳ chọn hiển
      // thị không được phép làm cả form không mở được.
    }
  }, []);

  /*
   * Hoãn 200ms.
   *
   * Cột xem trước render lại cả cây `RichDoc` mỗi lần đổi, và `data` đổi ở MỖI phím
   * gõ. Không hoãn thì mỗi ký tự là một lượt render toàn bài — thấy được thành hiện
   * tượng gõ bị trễ trên một bài dài. Không chạy timer khi cột đang tắt.
   */
  /*
   * Cột xem cạnh phải hiện ĐÚNG thứ site sẽ hiện cho tab đang mở.
   *
   * Ở tab một ngôn ngữ, đó là lớp phủ ĐÃ ĐẶT LÊN bản gốc — cùng hàm
   * `applyEntryLocale` mà đường render dùng, không phải một phép trộn thứ hai. Hiện
   * thẳng lớp phủ thì mọi field chưa dịch trông như trống, trong khi trên site chúng
   * hiện bản gốc; hiện thẳng `data` thì cột xem không phản ánh thứ đang gõ.
   */
  const effective = active
    ? applyEntryLocale(data, { [active]: i18n[active] ?? {} }, active, seoKey)
    : data;

  /*
   * Ngữ cảnh của khối SEO: dữ liệu HIỆU LỰC của tab đang mở (cùng `effective` của cột
   * xem trước), và đường dẫn của chính bài ở tab đó — slug riêng của ngôn ngữ nếu có.
   */
  const ownSlug = active
    ? locState[active]?.slug || props.entry?.slug || ''
    : props.entry?.slug ?? '';
  const seoContext: SeoContext | undefined = seoKey
    ? {
        effective,
        shape: { titleField: props.seoPreview.titleField, fields: props.fields },
        origin: props.seoPreview.origin,
        siteHost: props.seoPreview.siteHost,
        titleTemplate: props.seoPreview.titleTemplate,
        selfPath:
          props.seoPreview.detailBase && ownSlug
            ? `${active ? `/${active}` : ''}${props.seoPreview.detailBase}/${ownSlug}`
            : null,
        locale: active,
      }
    : undefined;

  useEffect(() => {
    if (!preview) return;
    const t = setTimeout(() => setShown(effective), 200);
    return () => clearTimeout(t);
    // `effective` được tính lại mỗi lượt render nên không đưa vào deps — hai nguồn
    // thật của nó là `data` và lớp phủ đang mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, i18n, active, preview]);

  const titleKey = props.fields.find((f) => f.t === 'text')?.key;
  const excerptField = props.fields.find(
    (f) => f.t === 'text' && f.multiline === true && f.key !== titleKey,
  );

  /*
   * Danh mục đi đường riêng (bảng `EntryTaxonomy`), và MỌI field kiểu `relation`
   * hiển thị ở sidebar — cột trái chỉ còn nội dung thật của bài.
   *
   * Trước đây chỉ quan hệ tới CHÍNH loại này (self-relation, ví dụ "bài liên quan")
   * được đưa ra sidebar; quan hệ tới loại KHÁC (ví dụ một field `relation` trỏ tới
   * loại "Danh mục" — một loại nội dung tự tạo, khác cơ chế `taxonomy` có sẵn) vẫn
   * nằm lẫn trong cột trái, giữa các field nội dung. Người chọn nó phải cuộn qua cả
   * bài để tìm, trong khi đây đúng là một ô CHỌN, không phải nội dung — cùng lý do
   * danh mục và self-relation đã ở sidebar. Hai loại quan hệ vẫn tách riêng thành
   * hai khối trong `EntrySidebar` vì self-relation có thêm hành vi tự xếp theo danh
   * mục trùng khi bỏ trống (`relatedEntries`), điều KHÔNG áp dụng cho quan hệ khác
   * loại.
   */
  const selfRelationFields = props.fields.filter((f) => f.t === 'relation' && f.typeKey === props.typeKey);
  const crossRelationFields = props.fields.filter((f) => f.t === 'relation' && f.typeKey !== props.typeKey);
  const mainFields = props.fields.filter(
    (f) => f.t !== 'taxonomy' && f.t !== 'relation',
  );
  const hasTaxonomyField = props.fields.some((f) => f.t === 'taxonomy');

  /**
   * Lưu bản dịch của ngôn ngữ đang mở.
   *
   * HAI lượt gọi, đúng theo ranh giới của route: `PATCH` mang nội dung (`i18n`),
   * `POST` mang trạng thái công bố của hàng `EntryLocale` (slug, status, mốc). Gộp
   * chúng thành một endpoint mới nghĩa là một cửa ghi thứ ba cho cùng dữ liệu, và
   * cửa thứ ba là chỗ phép kiểm bị quên.
   */
  async function saveLocale(publish: boolean) {
    const code = active!;
    const entryId = props.entry!.id;
    setBusy(true);
    setError(null);

    const content = await fetch(`/api/collections/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      // Gỡ lần nữa ở đây, không chỉ lúc khởi tạo: một lớp phủ ghi từ HTTP API hay MCP
      // trước đó có thể đã mang khoá slug, và nó sẽ làm mọi lần lưu sau đó bị từ chối.
      body: JSON.stringify({ i18n: { [code]: withoutSlug(i18n[code] ?? {}) } }),
    });
    const cj = (await content.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!content.ok || !cj.ok) {
      setBusy(false);
      setError(cj.error ?? `Không lưu được bản ${code}`);
      return;
    }

    const st = locState[code]!;
    const res = await fetch(`/api/collections/entries/${entryId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        locale: code,
        // Rỗng = BỎ slug riêng, nên phải là `null` chứ không phải chuỗi rỗng: chuỗi
        // rỗng đi qua `toSlug` thành rỗng và bị từ chối, và người dùng nhận một lỗi
        // cho hành động "để trống" vốn hợp lệ.
        slug: st.slug.trim() ? st.slug.trim() : null,
        status: publish ? 'published' : st.status,
        publishedAt: st.publishedAt ? new Date(st.publishedAt).toISOString() : undefined,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setBusy(false);
      setError(json.error ?? `Không đăng được bản ${code}`);
      return;
    }

    if (publish) {
      setLocState((m) => ({ ...m, [code]: { ...m[code]!, status: 'published', exists: true } }));
    } else {
      setLocState((m) => ({ ...m, [code]: { ...m[code]!, exists: true } }));
    }
    setBusy(false);
    setSaved(true);
    setDirty(false);
    router.refresh();
  }

  async function save(publish: boolean) {
    if (active) return saveLocale(publish);

    setBusy(true);
    setError(null);

    let id = props.entry?.id;
    if (!id) {
      const res = await fetch(`/api/collections/${props.typeKey}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data, taxonomyIds }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; entry?: { id: string } };
      if (!res.ok || !json.ok) {
        setBusy(false);
        setError(json.error ?? 'Không lưu được');
        return;
      }
      id = json.entry!.id;
    } else {
      const res = await fetch(`/api/collections/entries/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data, taxonomyIds }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setBusy(false);
        setError(json.error ?? 'Không lưu được');
        return;
      }
    }

    /*
     * Mốc "Đăng lúc" đổi cũng phải đi POST, không chỉ khi trạng thái đổi.
     *
     * Điều kiện cũ chỉ có `publish || status đổi`, nên trên một bài ĐÃ đăng, sửa mốc
     * rồi bấm Lưu thì mốc mới rơi mất im lặng — ô vẫn hiện giá trị vừa gõ (state
     * client), còn DB giữ giá trị cũ, và người dùng chỉ biết khi tải lại trang.
     */
    const atChanged =
      !!props.entry &&
      (publishedAt ? new Date(publishedAt).getTime() : null) !==
        (props.entry.publishedAt ? props.entry.publishedAt.getTime() : null);

    if (publish || (props.entry && status !== props.entry.status) || atChanged) {
      const res = await fetch(`/api/collections/entries/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: publish ? 'published' : status === 'published' ? 'published' : 'draft',
          publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setBusy(false);
        setError(json.error ?? 'Không đăng được');
        return;
      }
      if (publish) setStatus('published');
    }

    setBusy(false);
    setSaved(true);
    setDirty(false);
    // Điều hướng thay vì `router.refresh()` khi vừa tạo: URL đang là `/moi`, và
    // để nguyên thì bấm Lưu lần nữa sẽ tạo bài thứ hai.
    if (!props.entry) router.replace(`/builder/content/${props.typeKey}/${id}`);
    else router.refresh();
  }

  /**
   * Gỡ bài đang chạy xuống nháp.
   *
   * Là một HÀNH ĐỘNG riêng chứ không phải một giá trị gửi kèm lần lưu: nó chỉ đụng
   * trạng thái, không đụng nội dung, nên nó không được kéo theo bản nháp đang gõ dở
   * lên server. Cùng lý do đó, nó không gửi `publishedAt` — gỡ xuống rồi đăng lại
   * phải giữ nguyên mốc cũ, không âm thầm dời sang bây giờ.
   *
   * Không có hộp xác nhận: thao tác này lùi được bằng đúng một lần bấm Đăng, và một
   * dialog cho mỗi việc lùi được là cách dạy người dùng bấm Đồng ý mà không đọc.
   */
  async function unpublish() {
    if (!props.entry) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/collections/entries/${props.entry.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(active ? { locale: active, status: 'draft' } : { status: 'draft' }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setBusy(false);
      setError(json.error ?? 'Không gỡ được bài xuống');
      return;
    }
    if (active) setLocState((m) => ({ ...m, [active]: { ...m[active]!, status: 'draft' } }));
    else setStatus('draft');
    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  /**
   * Bỏ bài vào lưu trữ.
   *
   * `DELETE` không kèm `?purge=1` là LƯU TRỮ, không phải xoá vĩnh viễn: hàng `Entry`
   * còn nguyên với `archivedAt`, và có đường `?restore=1` để lấy lại. Đó là lý do nút
   * mang chữ "Xoá bài" mà vẫn dám hỏi một câu rồi làm — mất thật thì phải có nhiều
   * hơn một hộp xác nhận. Câu hỏi đó nằm ở `EntryDangerBox`: hàm này chạy SAU khi
   * người dùng đã xác nhận.
   *
   * Chỉ gọi được khi bài KHÔNG đang hiện trên site; phép chặn nằm ở `EntryDangerBox`.
   * Server thì vẫn cho lưu trữ một bài đang đăng (`archiveEntry` không kiểm `status`),
   * nên đây là luật của GIAO DIỆN: bắt người dùng gỡ trước, để việc "bài biến mất
   * khỏi site" luôn là một cú bấm có tên, không phải tác dụng phụ của một cú bấm khác.
   */
  async function archive() {
    if (!props.entry) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/collections/entries/${props.entry.id}`, { method: 'DELETE' });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setBusy(false);
      setError(json.error ?? 'Không lưu trữ được bài này');
      return;
    }
    // Điều hướng, không `refresh()`: bài vừa rời khỏi danh sách đang mở, nên ở lại
    // một URL trỏ vào nó là ở lại một màn nói về thứ không còn ở đó.
    router.push(`/builder/content/${props.typeKey}`);
  }

  /*
   * Trạng thái ĐANG hiện trên thanh nút. Ở tab một ngôn ngữ thì nút thao tác lên
   * hàng `EntryLocale` của ngôn ngữ đó, nên trạng thái phải đọc từ đó chứ không từ
   * bản gốc — nếu không, bản tiếng Anh còn nháp vẫn hiện nút "Chuyển về nháp".
   */
  const curStatus = active ? (locState[active]?.status ?? 'draft') : status;
  const curAt = active ? (locState[active]?.publishedAt ?? '') : publishedAt;
  const isPublished = curStatus === 'published';
  /* So với `mountedAt` chứ không `Date.now()`: xem lý do ở chỗ khai `mountedAt`. */
  const willSchedule = curAt !== '' && new Date(curAt).getTime() > mountedAt;

  const activeLabel = active ? (transLocales.find((l) => l.code === active)?.label ?? active) : null;

  /*
   * Tab ngôn ngữ — chỉ với bài ĐÃ LƯU: bản dịch là lớp phủ lên một hàng `Entry`, nên
   * nó cần một `entryId` để phủ lên. Hiện tab ở form tạo mới là mời người dùng gõ bản
   * tiếng Anh rồi mất trắng khi lưu.
   *
   * Số trên tab là phần trăm đã dịch; trạng thái đăng của bản đó nói bằng chữ trong
   * `title` và trong khối của bản đó ở cột phải — không bằng một chấm màu đứng một mình.
   */
  const localeTabs =
    props.entry && transLocales.length > 0
      ? [
          {
            id: 'base',
            label: `Bản gốc${baseLocale ? ` · ${baseLocale.label}` : ''}`,
            data: { 'data-locale': 'base' } as Record<`data-${string}`, string>,
          },
          ...transLocales.map((l) => {
            const cov = localeCoverage(withoutSlug(data), { [l.code]: i18n[l.code] ?? {} }, l.code, seoKey);
            const st = locState[l.code]!;
            const state = localePublishState(
              { slug: props.entry!.slug, status: props.entry!.status, publishedAt: props.entry!.publishedAt },
              st.exists
                ? [{
                    locale: l.code,
                    slug: st.slug || null,
                    status: st.status,
                    publishedAt: st.publishedAt ? new Date(st.publishedAt) : null,
                  }]
                : [],
              l.code,
              new Date(mountedAt),
            );
            return {
              id: l.code,
              label: (
                <span title={`${l.label} — ${cov.translated}/${cov.total} field đã dịch · ${LOCALE_STATE_TEXT[state]}`}>
                  {l.label}
                </span>
              ),
              count: `${cov.total ? Math.round((cov.translated / cov.total) * 100) : 0}%`,
              /*
               * Móc cho e2e. Nhãn ngôn ngữ là dữ liệu trong bảng `Locale` — nó do
               * người dùng đặt và đổi được, nên một test nhắm theo nhãn sẽ đỏ vì
               * một lần đổi tên vô hại. Mã ngôn ngữ thì là khoá chính.
               */
              data: { 'data-locale': l.code } as Record<`data-${string}`, string>,
            };
          }),
        ]
      : null;

  return (
    <PageShell>
      <PageHeader
        crumbs={[
          { label: 'Kho dữ liệu', href: '/builder/content' },
          { label: props.typeName, href: `/builder/content/${props.typeKey}` },
          {
            label: props.entry ? (
              <span title={props.entry.slug} className="font-shell-mono inline-block max-w-[28ch] truncate align-bottom">
                {props.entry.slug}
              </span>
            ) : (
              'mục mới'
            ),
          },
        ]}
        title={props.entry ? 'Sửa mục' : `Thêm ${props.typeName.toLowerCase()}`}
        actions={
          localeTabs && (
            <Tabs
              label="Bản ngôn ngữ"
              items={localeTabs}
              value={active ?? 'base'}
              onChange={(id) => setActive(id === 'base' ? null : id)}
            />
          )
        }
      />

      {/* ── Dải cảnh báo: bắt buộc, không phải trang trí ─────────────── */}
      <Note tone="warn" role="note">
        <p>
          Đăng bài <b>không</b> cần publish release. Nội dung lên site ngay khi bấm Đăng. Lùi
          release sau này lùi bố cục, <i>không</i> lùi bài viết.
        </p>
      </Note>

      {error && (
        <Note tone="danger" role="alert">
          <p>{error}</p>
        </Note>
      )}

      {props.fields.length === 0 && (
        <Note tone="warn">
          <p>
            Loại này chưa có field nào, hoặc cấu trúc đang lỗi.{' '}
            <Link
              href={`/builder/content/types/${props.typeKey}`}
              className="font-semibold text-shell-accent underline-offset-4 hover:underline"
            >
              Mở màn cấu trúc field
            </Link>
            .
          </p>
        </Note>
      )}

      {active && (
        <Note tone="info">
          <p>
            Đang sửa bản <b>{activeLabel}</b>. Field để trống sẽ hiện bản gốc trên site. Danh
            mục, quan hệ và ảnh dùng chung với bản gốc — sửa chúng ở tab Bản gốc.
          </p>
        </Note>
      )}

      {/* ── Hai cột ────────────────────────────────────────────────── */}
      {/* Cột xem cạnh chen vào GIỮA, không đẩy cột phải xuống: cột phải mang trạng thái
          đăng bài và danh mục, thứ người soạn cần thấy cùng lúc với nội dung. Dưới khổ
          `lg` mọi cột xếp chồng — ở điện thoại không có chỗ cho hai cột cạnh nhau. */}
      <div
        className={cn(
          'grid items-start gap-5',
          preview
            ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]'
            : 'lg:grid-cols-[minmax(0,1fr)_20rem]',
        )}
      >
        <section aria-label="Nội dung bài" className={cn(ui.card, 'flex min-w-0 flex-col gap-6 p-5 sm:p-6')}>
          {/*
            Ở tab một ngôn ngữ, field `slug` KHÔNG hiện ở đây: slug riêng của ngôn ngữ
            nằm trong `EntryLocale`, không nằm trong lớp phủ `i18n`. Để nó ở đây thì
            người dùng gõ vào một ô ghi vào `i18n.<locale>.slug` — một khoá không
            đường đọc nào nhìn vào, tức một ô không có tác dụng.
          */}
          {mainFields.filter((f) => !(active && f.t === 'slug')).map((f) =>
            f.t === 'slug' ? (
              (() => {
                const source =
                  typeof data[f.from] === 'string' ? (data[f.from] as string) : '';
                const typed = typeof data[f.key] === 'string' ? (data[f.key] as string) : '';
                const current = props.entry?.slug ?? '';
                const suggestion = toSlug(source);

                /*
                 * Ba ca, và ô hiện ba thứ khác nhau:
                 *
                 *  - sửa tay      → thứ người dùng đang gõ
                 *  - bài đã có    → đường dẫn THẬT, thứ đang nằm trong link người khác giữ
                 *  - bài mới      → gợi ý từ tiêu đề, chạy theo từng phím
                 */
                const shown = slugManual ? typed : props.entry ? current : suggestion;

                /*
                 * Chỉ đề nghị khi TIÊU ĐỀ ĐÃ ĐỔI so với lúc mở bài — không phải khi
                 * slug khác tiêu đề. Một bài đặt slug riêng là chuyện bình thường,
                 * và luật kia sẽ treo nút "Tạo lại" lên nó vĩnh viễn.
                 *
                 * Bài mới thì ô đã tự chạy theo tiêu đề rồi, không có gì để tạo lại.
                 */
                const originalTitle =
                  typeof props.entry?.data[f.from] === 'string'
                    ? (props.entry.data[f.from] as string)
                    : '';
                const canRegen =
                  !!props.entry &&
                  !slugManual &&
                  source !== originalTitle &&
                  suggestion !== '' &&
                  suggestion !== current;
                const published = props.entry?.status === 'published';
                const id = `f-${f.key}`;

                return (
                  <div key={f.key} className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <label htmlFor={id} className={ui.label}>
                        {f.label}
                      </label>
                      <span className="font-shell-mono text-micro text-shell-muted">{f.key}</span>
                    </div>
                    <input
                      id={id}
                      readOnly={!slugManual}
                      value={shown}
                      placeholder={`suy từ “${f.from}” khi lưu`}
                      aria-describedby={`${id}-hint`}
                      onChange={(e) => onChange([f.key], e.target.value)}
                      className={cn(ui.field, 'font-shell-mono', !slugManual && 'bg-shell-raised text-shell-muted')}
                    />
                    {/*
                      Ô này hiện ĐỀ NGHỊ, không hứa hẹn. `uniqueSlug` ở server còn thêm
                      hậu tố khi trùng bài khác, và client không biết slug nào đã bị
                      chiếm — tính lại ở đây sẽ nói sai ngay lần đầu có hai bài trùng
                      tiêu đề. Sau khi lưu, ô hiện giá trị thật.
                    */}
                    {!props.entry && suggestion !== '' && (
                      <p className={ui.hint}>
                        Trùng bài khác thì hệ thống tự thêm hậu tố —{' '}
                        <code className="font-shell-mono">{suggestion}-2</code>.
                      </p>
                    )}
                    <p id={`${id}-hint`} className={cn(ui.hint, 'leading-relaxed', published && 'text-shell-warn')}>
                      {published
                        ? 'Bài này ĐÃ ĐĂNG. Bài trong collection không có chuyển hướng 301 như trang — đổi đường dẫn là link cũ chết hẳn, và mất luôn thứ hạng tìm kiếm của nó.'
                        : 'Đổi đường dẫn của bài đã đăng làm mất thứ hạng tìm kiếm của đường dẫn cũ.'}
                    </p>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {canRegen && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="redo"
                          onClick={() => {
                            setSlugManual(true);
                            onChange([f.key], suggestion);
                          }}
                          title={`Đặt lại thành ${suggestion}`}
                          className={cn('max-w-full', published && 'text-shell-warn')}
                        >
                          Tạo lại →<span className="font-shell-mono min-w-0 truncate">{suggestion}</span>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={slugManual ? 'undo' : 'edit'}
                        onClick={() => setSlugManual((v) => !v)}
                      >
                        {slugManual ? 'Dùng tự sinh' : 'Sửa tay'}
                      </Button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <FieldInput
                key={f.key}
                field={f}
                path={[f.key]}
                value={values[f.key]}
                groups={props.groups}
                taxonomies={props.taxonomies}
                depth={1}
                onChange={onChange}
                onAppend={onAppend}
                onRemove={onRemove}
                onMove={onMove}
                seo={f.t === 'seo' ? seoContext : undefined}
              />
            ),
          )}
        </section>

        {preview && (
          <EntryPreview
            fields={mainFields}
            data={shown}
            titleKey={titleKey}
            typeName={props.typeName}
            slug={props.entry?.slug ?? ''}
            iframeHosts={props.iframeHosts}
            /*
              Route riêng, tab mới. Nó đọc từ bản ĐÃ LƯU, nên nó khác cột này chứ
              không trùng: một cái soát bản đang gõ, một cái soát bản đã ghi. Nút nằm
              trên đầu cột xem trước — xem docblock của `EntryViewBox`.
            */
            fullHref={
              props.entry
                ? `/builder/content/${props.typeKey}/${props.entry.id}/preview`
                : null
            }
          />
        )}

        {/*
          Cột phải: HÀNH ĐỘNG trên cùng, thông tin ở giữa, XEM dưới cùng.

          `<aside>` ở đây chứ không trong `EntrySidebar`, vì nó bọc nhiều thẻ chứ không
          một. Các component bên trong dùng thẻ gốc `<div>`/`<section>` — hai `<aside>`
          lồng nhau là hai landmark cho một vùng, và trình đọc màn hình sẽ đọc cả hai.
        */}
        <aside aria-label="Thuộc tính bài" className="flex min-w-0 flex-col gap-4">
        <EntryActions
          published={isPublished}
          dirty={dirty}
          busy={busy}
          saved={saved}
          scheduleLabel={willSchedule ? `Hẹn đăng ${DAY.format(new Date(curAt))}` : null}
          /*
            Nút tác động lên NGÔN NGỮ đang mở — `curStatus`/`curAt` đã đọc từ đó (xem
            chỗ khai chúng). Truyền nhãn xuống để nút tự nói ra điều đó: bấm Đăng ở tab
            English mà tưởng đang đăng cả bài là lỗi không có gì báo.
          */
          localeLabel={activeLabel}
          onSave={() => void save(false)}
          onPublish={() => void save(true)}
        />

        {active ? (
          <EntryLocalePanel
            label={activeLabel ?? active}
            code={active}
            baseSlug={props.entry?.slug ?? ''}
            slug={locState[active]?.slug ?? ''}
            // Tiêu đề ĐÃ DỊCH của ngôn ngữ đang mở, không phải tiêu đề gốc: một
            // đường dẫn tiếng Anh sinh từ tiêu đề tiếng Việt thì vô nghĩa. Chưa
            // dịch tiêu đề thì rỗng, và nút "Tạo từ tiêu đề" không hiện.
            titleSource={
              titleKey && typeof (i18n[active] ?? {})[titleKey] === 'string'
                ? ((i18n[active] as Record<string, unknown>)[titleKey] as string)
                : ''
            }
            onSlug={(v) => {
              touch();
              setLocState((m) => ({ ...m, [active]: { ...m[active]!, slug: v } }));
            }}
            publishedAt={locState[active]?.publishedAt ?? ''}
            onPublishedAt={(v) => {
              touch();
              setLocState((m) => ({ ...m, [active]: { ...m[active]!, publishedAt: v } }));
            }}
            state={localePublishState(
              { slug: props.entry?.slug ?? '', status: props.entry?.status ?? 'draft', publishedAt: props.entry?.publishedAt ?? null },
              locState[active]?.exists
                ? [{
                    locale: active,
                    slug: locState[active]!.slug || null,
                    status: locState[active]!.status,
                    publishedAt: locState[active]!.publishedAt ? new Date(locState[active]!.publishedAt) : null,
                  }]
                : [],
              active,
              new Date(mountedAt),
            )}
            coverage={localeCoverage(withoutSlug(data), { [active]: i18n[active] ?? {} }, active, seoKey)}
          />
        ) : (
        <EntrySidebar
          entryId={props.entry?.id ?? null}
          writerOptions={props.writerOptions ?? []}
          typeKey={props.typeKey}
          status={status}
          publishedAt={publishedAt}
          onPublishedAt={(v) => {
            touch();
            setPublishedAt(v);
          }}
          taxonomies={props.taxonomies}
          taxonomyIds={taxonomyIds}
          /*
            Bọc `touch()` quanh hai setter này, không truyền setter trần.

            Gắn một danh mục hay dời mốc đăng là thay đổi CHƯA GHI y như gõ vào một
            field. Truyền `setTaxonomyIds` trần thì nút Lưu vẫn tối sau khi người
            dùng vừa đổi danh mục — xem docblock của `touch`.
          */
          onTaxonomyIds={(ids) => {
            touch();
            setTaxonomyIds(ids);
          }}
          hasTaxonomyField={hasTaxonomyField}
          relationFields={selfRelationFields}
          crossRelationFields={crossRelationFields}
          groups={props.groups}
          data={data}
          onChange={onChange}
          onAppend={onAppend}
          onRemove={onRemove}
          onMove={onMove}
          seo={{
            title: typeof data[titleKey ?? ''] === 'string' ? (data[titleKey ?? ''] as string) : '',
            slug: props.entry?.slug ?? '',
            excerpt:
              excerptField && typeof data[excerptField.key] === 'string'
                ? (data[excerptField.key] as string)
                : '',
          }}
          log={
            props.entry
              ? {
                  createdAt: props.entry.createdAt,
                  createdBy: props.entry.createdBy,
                  updatedAt: props.entry.updatedAt,
                  updatedBy: props.entry.updatedBy,
                  publishedAt: props.entry.publishedAt,
                  activity: props.activity ?? null,
                }
              : null
          }
        />
        )}

        {/*
          Khối NGUY HIỂM ở dưới cùng, dưới cả khối Xem.

          Thứ tự trong cột này là thứ tự tần suất: việc làm mỗi lần mở bài ở trên,
          việc làm một lần trong đời bài ở dưới. Đặt "Xoá bài" cạnh "Đăng" là đặt hai
          nút cách nhau 8px cho hai kết cục không có gì giống nhau.
        */}
        {props.entry && (
          <EntryDangerBox
            published={isPublished}
            busy={busy}
            slug={props.entry.slug}
            localeLabel={activeLabel}
            onUnpublish={() => void unpublish()}
            onArchive={() => void archive()}
          />
        )}

        <EntryViewBox
          previewOpen={preview}
          onTogglePreview={() => {
            const next = !preview;
            setPreview(next);
            if (next) setShown(data);
            try {
              window.localStorage.setItem(PREVIEW_KEY, next ? '1' : '0');
            } catch {
              // Không ghi được thì lựa chọn chỉ sống trong lượt này. Chấp nhận được.
            }
          }}
        />
        </aside>
      </div>

      {/*
        KHÔNG còn dòng "bản dịch sửa ở bảng Văn bản".
        Nó chỉ sang `/builder/text`, và màn đó làm việc với bảng `Translation` khoá
        theo `pageId/nodeId/field` — nó không biết entry là gì. Câu chỉ dẫn đó dẫn
        người soạn tới một màn không làm được việc, suốt từ khi được viết ra.
      */}
    </PageShell>
  );
}

/**
 * `Date` → chuỗi cho `<input type="datetime-local">`, theo múi giờ LOCAL.
 *
 * `toISOString().slice(0,16)` là UTC, nên một bài hẹn 08:00 giờ Việt Nam hiện ra
 * 01:00 trong ô — và người dùng sẽ "sửa lại cho đúng", tạo ra một mốc lệch 7 giờ.
 */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
