'use client';

/**
 * Đổi tiêu đề và đường dẫn của một trang, trong một dialog.
 *
 * ## Vì sao cùng khuôn `<dialog>` với `PageHistory`
 *
 * Hai mục cạnh nhau trong cùng một menu "…" thì phải mở ra hai thứ hành xử giống
 * nhau: Esc đóng, focus bị bẫy, nền bị chặn. Xem docblock `PageHistory` cho lý do đầy
 * đủ của việc dùng thẻ `<dialog>` thật. Dialog do thẻ trang mở (`open`), vì menu đóng
 * lại ngay khi chọn xong và không thể là cha của nó.
 *
 * ## Vì sao ô đường dẫn KHÔNG tự chuẩn hoá khi đang gõ
 *
 * `toSlug` cắt dấu và cắt khoảng trắng. Chạy nó theo từng phím nghĩa là người
 * dùng gõ "tin tức" và thấy con trỏ nhảy sau mỗi ký tự vì "tin-" → "tin" →
 * "tin-t". Xem trước bên dưới ô nói cho họ kết quả sẽ ra sao mà không giành lấy
 * ô nhập.
 *
 * Nút "Tạo lại từ tiêu đề" KHÔNG phá luật đó: nó ghi vào ô một lần, do người dùng
 * bấm, chứ không chạy theo từng phím. Và nó chỉ hiện khi tiêu đề đã lệch khỏi
 * đường dẫn — xem `autoSlugState`.
 *
 * ## Vì sao hàm chuẩn hoá không còn là bản chép
 *
 * File này từng có `previewSlug`, một bản chép của `toSlug` — vì `create-page.ts`
 * khai `server-only`. Hàm thuần đã tách ra `builder/slug.ts` từ 27/08/2026, nên
 * bản chép mất lý do tồn tại và chỉ còn là hai luật chờ trôi khỏi nhau.
 *
 * ## Vì sao cảnh báo chỉ hiện với trang ĐÃ publish
 *
 * Trang chưa publish thì đổi slug không có hậu quả nào: chưa ai có link cũ. Hiện
 * một cảnh báo ở đó là dạy người dùng bỏ qua cảnh báo.
 *
 * ## Vì sao vai `relation` kéo theo một ô thứ BA
 *
 * Ba vai kia chỉ cần `{typeKey, param}`. Vai `relation` bắt buộc thêm `field` — khoá
 * của field `relation` trên loại đang chọn — và cả hai tầng server đều cưỡng chế:
 * `zCollection.superRefine` (`site-tools.ts`) và `checkCollectionPairing`
 * (`page-collection.ts`). Chào vai này trong dropdown mà không có ô field là chào một
 * lựa chọn server LUÔN LUÔN từ chối; người dùng chỉ đọc được một câu lỗi và không có
 * cách nào làm nó hết lỗi.
 *
 * Server còn chặn chiều ngược lại — `field` trên một vai khác cũng bị từ chối — nên
 * `draftCollection` xoá nó theo vai chứ không gửi nguyên trạng thái của ô.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { autoSlugState } from '@/lib/builder/auto-slug';
import { cn } from '@/lib/builder/cn';
import {
  PARAM_ROLE_EXAMPLE,
  type PageCollection,
  type PageParamRole,
} from '@/lib/builder/page-collection';
import type { FieldDef } from '@/lib/collections/field-def';
import { isTemplateSlug, toSlugPath } from '@/lib/builder/slug';
import { focusRing, ui } from '@/lib/builder/ui';

import { Button } from './ui/Button';
import { SelectField, TextField } from './ui/Field';
import { Icon } from './ui/Icon';
import { Dialog } from './ui/Overlay';

/*
 * ROLE_LABEL sống ở `lib/builder/page-collection.ts`, KHÔNG ở đây.
 *
 * File này là `'use client'`. Danh sách trang (`app/(builder)/builder/page.tsx`) là
 * server component và cũng cần đúng bảng nhãn ấy — mà mọi export của một module
 * `'use client'` đến với server dưới dạng client reference, không phải object thật.
 * Khai ở đây rồi để server đọc đã làm `/builder` trả 500 trên stg ngày 14/09/2026;
 * lý do đầy đủ nằm trong docblock của hằng đó.
 *
 * Re-export để chỗ gọi và test trong thư mục này không phải đổi đường import.
 */
import { ROLE_LABEL } from '@/lib/builder/page-collection';

export { ROLE_LABEL };

/** Một field `relation` chọn được, kèm loại ĐÍCH của nó. */
export interface RelationFieldChoice {
  key: string;
  label: string;
  /** Loại mà đoạn động trên URL mang `slug` của nó. */
  typeKey: string;
}

/**
 * Field `relation` của một loại — nguồn duy nhất của ô thứ ba.
 *
 * Đọc từ `schema` mà `/api/collections/types` trả về, tức vỏ mỏng của
 * `getCollectionTypes()` — CÙNG hàm mà `relationTargetType` đọc khi phân giải URL.
 * Hai bên đọc cùng một chỗ thì danh sách chào ở đây không lệch được với danh sách
 * server chấp nhận.
 */
export function relationFieldsOf(schema: FieldDef[] | undefined): RelationFieldChoice[] {
  return (schema ?? [])
    .filter((f): f is Extract<FieldDef, { t: 'relation' }> => f.t === 'relation')
    .map((f) => ({ key: f.key, label: f.label, typeKey: f.typeKey }));
}

/**
 * Ba ô → lời khai gửi lên server.
 *
 * `field` bị XOÁ ở mọi vai không phải `relation`, không phải giữ lại cho tiện: nó là
 * lời khai không bao giờ được đọc (`parsePageCollection` bỏ nó) và là một trong hai
 * thứ `zCollection.superRefine` từ chối. Trạng thái sinh ra nó có thật — chọn
 * relation, chọn field, rồi đổi ý sang "chi tiết".
 */
export function draftCollection(
  typeKey: string,
  role: PageParamRole,
  field: string,
): PageCollection | null {
  if (!typeKey) return null;
  if (role !== 'relation') return { typeKey, param: role };
  return { typeKey, param: role, field };
}

/**
 * Cảnh báo TẠI CHỖ cho cặp slug ↔ vai ↔ field, thay vì chờ server từ chối.
 *
 * Người dùng đang nhìn cả ba ô cùng lúc; nói ngay ở đây thì họ sửa được trước khi
 * bấm. Đây là bản rút gọn của `checkCollectionPairing` cộng luật `field` của
 * `zCollection` — server vẫn là nơi quyết định, và mọi luật còn lại (loại có tồn tại
 * không, đã có trang chi tiết chưa) chỉ trả lời được ở đó.
 *
 * `relationFields: null` nghĩa là CHƯA đọc xong `/api/collections/types`. Khi ấy vẫn
 * chặn nếu ô field rỗng — mạng chậm không phải lý do để gửi đi một hình dạng server
 * từ chối — nhưng KHÔNG chặn khi field đã có sẵn từ lời khai cũ, vì trang đó có thể
 * chỉ đang đổi tiêu đề.
 */
export function collectionProblem(args: {
  /** Slug ĐÃ chuẩn hoá. */
  slug: string;
  typeKey: string;
  role: PageParamRole;
  field: string;
  relationFields: RelationFieldChoice[] | null;
}): string | null {
  const { slug, typeKey, role, field, relationFields } = args;
  const template = isTemplateSlug(slug);

  if (template && !typeKey) {
    return 'Đường dẫn có đoạn động [..] thì phải chọn loại nội dung, nếu không địa chỉ này chỉ trả 404.';
  }
  if (template && role === 'list') {
    return 'Trang danh sách không được có đoạn động. Bỏ [..] đi, hoặc đổi vai.';
  }
  if (!template && typeKey && role !== 'list') {
    // `PARAM_ROLE_EXAMPLE` chứ không phải ví dụ viết cứng tại đây: một bản ví dụ cho
    // cả câu lỗi server lẫn mô tả tool MCP, nếu không ba chỗ dạy ba cú pháp.
    return `Vai này cần một đoạn động, ví dụ ${PARAM_ROLE_EXAMPLE[role]}.`;
  }
  if (typeKey && role === 'relation' && !field) {
    return relationFields && relationFields.length === 0
      ? 'Loại này không có field relation nào, nên vai "theo quan hệ" không dùng được. Chọn vai khác, hoặc thêm một field relation ở Kho dữ liệu.'
      : 'Vai theo quan hệ phải chọn một field relation — không có nó thì đoạn động trên đường dẫn không biết tra vào loại nào, và địa chỉ chỉ trả 404.';
  }
  return null;
}

export function PageRename({
  open,
  onClose,
  pageId,
  slug,
  title,
  isPublished,
  collection,
  types,
  system = null,
}: {
  open: boolean;
  onClose: () => void;
  pageId: string;
  slug: string;
  title: string;
  isPublished: boolean;
  /** Lời khai hiện tại, `null` khi đây là trang thường. */
  collection: PageCollection | null;
  /** Loại nội dung đang có, để đổ vào ô chọn. */
  types: { key: string; name: string }[];
  /** Trang hệ thống (404): đường dẫn khoá — server cũng từ chối đổi (`renamePage`). */
  system?: string | null;
}) {
  const router = useRouter();
  const titleInput = useRef<HTMLInputElement>(null);
  /*
   * `useId` chứ không phải id cố định: danh sách trang render MỘT `PageRename` cho
   * mỗi trang, nên `id={`${uid}-slug`}` sẽ trùng ngay ở trang thứ hai. Id trùng làm
   * `htmlFor` nối nhãn vào ô của trang khác — bấm nhãn nhảy focus sang dialog khác,
   * và trình đọc màn hình đọc sai ô.
   */
  const uid = useId();
  const [nextTitle, setNextTitle] = useState(title);
  const [nextSlug, setNextSlug] = useState(slug);
  const [typeKey, setTypeKey] = useState(collection?.typeKey ?? '');
  const [role, setRole] = useState<PageParamRole>(collection?.param ?? 'list');
  const [field, setField] = useState(collection?.field ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /*
   * Schema của từng loại, đọc từ `/api/collections/types` — CHỈ khi dialog mở ra.
   *
   * Danh sách trang render một `PageRename` cho MỖI trang, nên đọc lúc mount là N
   * lượt gọi mạng cho một dialog chưa ai bấm vào. `types` (prop) đã đủ cho ô loại;
   * thứ duy nhất cần thêm là `schema`, và nó chỉ có nghĩa sau khi người dùng mở
   * dialog ra.
   *
   * Đọc ở CLIENT chứ không thêm prop: prop phải do `builder/page.tsx` truyền xuống,
   * và file ấy ngoài phạm vi lần sửa này. Đường này cũng là đường `Inspector` đã
   * dùng cho đúng nhu cầu ấy.
   */
  const [schemas, setSchemas] = useState<Map<string, FieldDef[]> | null>(null);
  const fetched = useRef(false);

  /*
   * Nạp lại ô từ prop ở lượt chuyển đóng → MỞ, không ở mọi lần prop đổi.
   *
   * Sau khi lưu, `router.refresh()` đổ `title`/`slug` mới xuống trong lúc dialog vẫn
   * mở (để người dùng đọc câu về redirect). Nạp lại theo prop ở lúc đó sẽ xoá luôn câu
   * ấy — nên chỉ lượt mở mới được đặt lại form.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;

    setNextTitle(title);
    setNextSlug(slug);
    setTypeKey(collection?.typeKey ?? '');
    setRole(collection?.param ?? 'list');
    setField(collection?.field ?? '');
    setError(null);
    setNote(null);
    // `showModal()` (trong `Dialog`, chạy trước effect này) sẽ focus nút đóng đứng đầu
    // DOM; ô đầu tiên mới là chỗ người ta mở dialog ra để gõ.
    titleInput.current?.focus();

    if (fetched.current) return;
    fetched.current = true;
    fetch('/api/collections/types')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { types?: { key: string; schema?: FieldDef[] }[] }) => {
        setSchemas(new Map((d.types ?? []).map((t) => [t.key, t.schema ?? []])));
      })
      .catch(() => {
        // Cho phép thử lại ở lần mở sau. Không dựng câu lỗi riêng: `collectionProblem`
        // đã nói đúng thứ người dùng cần làm khi ô field trống.
        fetched.current = false;
      });
  }, [open, title, slug, collection]);

  const close = () => {
    setBusy(false);
    onClose();
  };

  /*
   * `manual: true` LUÔN LUÔN ở dialog này.
   *
   * Đây là một trang đã tồn tại: nó đã có địa chỉ, và địa chỉ đó có thể đang nằm
   * trong link người khác gửi nhau. Slug rỗng cũng là một giá trị hợp lệ và có
   * nghĩa — đó là trang chủ — nên "rỗng" ở đây KHÔNG được hiểu là "chưa điền, cứ
   * tự sinh đi". Đổi địa chỉ phải là một cú bấm có chủ đích.
   */
  const auto = autoSlugState({
    title: nextTitle,
    slug: nextSlug,
    manual: true,
    // So với tiêu đề LÚC MỞ dialog, không so với slug: mở ra mà chưa sửa gì thì
    // không có đề nghị nào, kể cả với trang chủ (slug rỗng) hay trang đặt slug
    // riêng như "Về chúng tôi" ở /about.
    titleChanged: nextTitle !== title,
  });
  // `toSlugPath` chứ không `toSlug`: dấu `/` là ranh giới đoạn, và `[slug]` phải
  // sống sót qua chuẩn hoá. Xem trước bên dưới ô nói ra kết quả.
  const cleaned = toSlugPath(nextSlug);
  const slugChanged = cleaned !== slug;

  /*
   * `null` = CHƯA đọc xong schema, khác hẳn `[]` = loại này không có field relation
   * nào. Gộp hai trạng thái làm câu cảnh báo nói sai một trong hai lúc.
   */
  const relationFields = schemas ? relationFieldsOf(schemas.get(typeKey)) : null;
  /*
   * Field đang khai mà KHÔNG còn trong schema vẫn phải đứng trong ô chọn.
   *
   * Nó xảy ra khi có người đổi loại của field hoặc xoá nó ở Kho dữ liệu. Bỏ nó khỏi
   * danh sách làm `<select>` tự nhảy về mục đầu, tức dialog IM LẶNG đổi định tuyến
   * của trang chỉ vì người dùng mở nó ra để sửa tiêu đề.
   */
  const fieldChoices =
    field && relationFields && !relationFields.some((f) => f.key === field)
      ? [{ key: field, label: field, typeKey: '' }, ...relationFields]
      : (relationFields ?? (field ? [{ key: field, label: field, typeKey: '' }] : []));

  const nextCollection = draftCollection(typeKey, role, field);
  const collectionChanged =
    (nextCollection?.typeKey ?? null) !== (collection?.typeKey ?? null) ||
    (nextCollection?.param ?? null) !== (collection?.param ?? null) ||
    // `field` phải nằm trong phép so sánh: đổi mỗi field mà vẫn giữ loại và vai là
    // một thay đổi THẬT — nó trỏ đoạn động sang một loại đích khác — và bỏ nó ra là
    // một lần bấm Lưu không lưu gì mà cũng không báo gì.
    (nextCollection?.field ?? null) !== (collection?.field ?? null);

  const pairing = collectionProblem({ slug: cleaned, typeKey, role, field, relationFields });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        // Gửi cả hai: server tự nhận ra cái nào không đổi. Gửi chuỗi rỗng cho slug
        // là hợp lệ và có nghĩa — đó là trang chủ.
        body: JSON.stringify({
          title: nextTitle,
          slug: cleaned,
          // Chỉ gửi khi ĐỔI. Gửi mọi lần thì mỗi lần đổi tiêu đề cũng ghi một dòng
          // audit `page.collection` không có gì đổi — và nhật ký đầy những dòng như
          // thế là nhật ký không ai đọc.
          ...(collectionChanged ? { collection: nextCollection } : {}),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; note?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Lỗi ${res.status}`);
        setBusy(false);
        return;
      }
      setNote(json.note ?? null);
      router.refresh();
      // Đóng ngay khi không có gì cần nói thêm; giữ lại khi có, để người dùng đọc
      // được câu về redirect trước khi dialog biến mất.
      if (!json.note) onClose();
      setBusy(false);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const formId = `${uid}-form`;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Đổi tên trang"
      description={<span className="font-shell-mono">/{slug}</span>}
      actions={
        <>
          <Button variant="secondary" onClick={close}>
            {note ? 'Đóng' : 'Huỷ'}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={busy}
            disabled={pairing !== null}
            title={pairing ?? undefined}
          >
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || pairing !== null) return;
          void save();
        }}
        className="flex flex-col gap-4"
      >
        <TextField
          ref={titleInput}
          label="Tiêu đề"
          value={nextTitle}
          onChange={(e) => setNextTitle(e.target.value)}
        />

        {/*
          Nút NẰM NGOÀI `<label>`, và đó không phải chuyện thẩm mỹ.

          Đặt nó bên trong thì thuật toán tính tên trợ năng chạy vào luật
          "phần tử con của một label đang gán nhãn cho một control": nút nhận
          tên của label — đo được là `"Đường dẫn /"` — thay vì chữ trên chính
          nó, còn ô nhập thì tụt xuống lấy tên từ `placeholder`. Trình đọc màn
          hình đọc ra hai thứ sai cùng lúc, và `getByRole` cũng không tìm thấy
          nút (đây là cách lỗi bị phát hiện).

          Nên: `htmlFor` nối nhãn với ô một cách tường minh, nút là anh em của
          nhãn chứ không phải con.
        */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <label htmlFor={`${uid}-slug`} className={ui.label}>
              Đường dẫn
            </label>
            {auto.canRegenerate && !system && (
              <button
                type="button"
                onClick={() => setNextSlug(auto.suggestion)}
                className={cn(
                  'ml-auto rounded-sm text-mini font-medium text-shell-accent underline-offset-4 hover:underline',
                  focusRing,
                )}
              >
                Tạo lại từ tiêu đề → <span className="font-shell-mono">/{auto.suggestion}</span>
              </button>
            )}
          </div>
          <div className="relative flex items-center">
            <span aria-hidden className="pointer-events-none absolute left-3.5 font-shell-mono text-ui text-shell-muted">
              /
            </span>
            <input
              id={`${uid}-slug`}
              value={nextSlug}
              onChange={(e) => setNextSlug(e.target.value)}
              placeholder="để trống = trang chủ"
              disabled={Boolean(system)}
              aria-describedby={`${uid}-slug-hint`}
              className={cn(ui.field, 'pl-7 font-shell-mono')}
            />
          </div>
          {cleaned !== nextSlug && (
            <span className={cn(ui.hint, 'font-shell-mono')}>sẽ lưu thành: /{cleaned}</span>
          )}
          <p id={`${uid}-slug-hint`} className={cn(ui.hint, 'leading-relaxed')}>
            {system ? (
              <>Trang hệ thống không mở bằng đường dẫn riêng, nên đường dẫn của nó không đổi được.</>
            ) : (
              <>
            Nhiều đoạn thì ngăn bằng <span className="font-shell-mono">/</span>. Đoạn trong ngoặc
            vuông là <strong className="font-semibold text-shell-ink">đoạn động</strong>, đúng cú pháp
            Next.js — <span className="font-shell-mono">blogs/post/[slug]</span> phục vụ mọi bài viết.
            Tối đa một đoạn động, và nó không được đứng đầu.
              </>
            )}
          </p>
        </div>

        {/*
          Ô chọn loại nội dung nằm NGAY DƯỚI ô đường dẫn, không ở một màn riêng.

          Hai thứ này là một quyết định: `blogs/[category]` không có nghĩa gì cho tới
          khi có người nói đoạn động ấy trỏ vào đâu. Tách chúng ra hai chỗ là bảo
          đảm sẽ có trang đặt một nửa rồi quên nửa kia — và một mẫu không khai vai
          là một URL 404 im lặng.
        */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <SelectField
              id={`${uid}-type`}
              label="Loại nội dung"
              value={typeKey}
              onChange={(e) => {
                setTypeKey(e.target.value);
                // `field` là khoá của một field TRÊN loại vừa bỏ đi, nên giữ lại là
                // giữ một lời khai trỏ vào chỗ không còn tồn tại.
                setField('');
              }}
              wrapperClassName="min-w-48 flex-1"
            >
              <option value="">Trang thường — không gắn loại nào</option>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            {typeKey && (
              <SelectField
                label="Vai của trang"
                hideLabel
                value={role}
                onChange={(e) => setRole(e.target.value as PageParamRole)}
                wrapperClassName="min-w-56 flex-[1.4]"
              >
                {(Object.keys(ROLE_LABEL) as PageParamRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </SelectField>
            )}
          </div>

          {/*
            Ô THỨ BA, chỉ cho vai `relation`.

            Không phải một ô tuỳ chọn: `parsePageCollection` trả `null` cho một lời
            khai `relation` thiếu `field`, và cả `zCollection` lẫn
            `checkCollectionPairing` đều từ chối nó. Chào vai này mà không có ô này
            là chào một lựa chọn không bao giờ lưu được.

            Nằm ở DÒNG RIÊNG chứ không chen vào hàng trên: nhãn field tiếng Việt kèm
            tên loại đích ("Danh mục → danh-muc") dài hơn hẳn hai ô kia, và ba
            `<select>` một hàng trong một dialog cỡ vừa thì ô nào cũng hẹp tới mức
            không đọc được giá trị đang chọn.
          */}
          {typeKey && role === 'relation' && (
            <SelectField
              id={`${uid}-field`}
              label="Field quan hệ"
              value={field}
              onChange={(e) => setField(e.target.value)}
              wrapperClassName="mt-2"
              hint={
                <>
                  Đoạn động mang <strong className="font-semibold text-shell-ink">slug của một bản ghi</strong>{' '}
                  thuộc loại đích của field này — không phải <span className="font-shell-mono">key</span>{' '}
                  của một hàng trong bảng Danh mục. Loại đích đọc từ chính field, nên không khai lại ở
                  đây.
                </>
              }
            >
              <option value="">
                {relationFields === null ? 'đang đọc danh sách field…' : '— chọn field —'}
              </option>
              {fieldChoices.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                  {f.typeKey ? ` → ${f.typeKey}` : ''}
                </option>
              ))}
            </SelectField>
          )}

          {pairing && <p className="text-mini font-medium text-shell-warn">{pairing}</p>}
          {!types.length && (
            <p className={ui.hint}>Chưa có loại nội dung nào. Tạo ở Kho dữ liệu trước.</p>
          )}
        </div>

        {slugChanged && isPublished && (
          <div className="flex gap-3 rounded-md bg-shell-warn-soft px-4 py-3 text-small leading-relaxed">
            <Icon name="info" size={18} className="mt-px text-shell-warn" />
            <p className="min-w-0">
              Trang này đã publish. Địa chỉ cũ <span className="font-shell-mono">/{slug}</span> sẽ được
              chuyển hướng <strong className="font-semibold">301</strong> sang địa chỉ mới — link cũ
              không chết. Chuyển hướng chỉ bắt đầu chạy{' '}
              <strong className="font-semibold">sau khi Publish</strong>; tới lúc đó site thật vẫn phục
              vụ địa chỉ cũ như bình thường.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-small leading-relaxed text-shell-danger">
            {error}
          </p>
        )}
        {note && (
          <p role="status" className="rounded-md bg-shell-ok-soft px-4 py-3 text-small leading-relaxed">
            {note}
          </p>
        )}
      </form>
    </Dialog>
  );
}
