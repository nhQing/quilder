'use client';

/**
 * Sửa cấu hình site: tên, domain, và bảng `globals`.
 *
 * ## Vì sao `globals` là bảng khoá–giá trị, không phải form có sẵn field
 *
 * `Site.globals` là `Json` tự do, và nó cố ý như vậy: mỗi dự án có bộ chuỗi khác
 * nhau — hotline, số giấy phép, link store, mã số thuế. Một form với field cố định
 * sẽ đúng cho dự án đầu và sai cho dự án thứ hai, tức là phải sửa code mỗi lần fork.
 *
 * ## Vì sao giá trị KHÔNG phải chuỗi thì chỉ đọc
 *
 * `globals` có thể chứa object hoặc mảng (ví dụ `store: { ios, android }`). Một ô
 * input một dòng không sửa nổi thứ đó, và cho phép sửa nghĩa là cho phép một cú
 * gõ nhầm biến object thành chuỗi — mất dữ liệu, không hoàn lại được. Nên chúng
 * hiện dưới dạng JSON, khoá lại, và được gửi lại NGUYÊN TRẠNG.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  FAVICON_ACCEPT,
  FAVICON_MIMES,
  FAVICON_MIME_LABEL,
} from '@/lib/assets/favicon-mimes';
import { IMAGE_KINDS } from '@/lib/assets/kind';
import { ENDPOINT_KEY } from '@/lib/doc/site-bindings';
import { shareImageWarning } from '@/lib/render/share-meta';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { AssetPickerBox, type KnownAsset } from './asset/AssetPickerBox';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Switch, TextField } from './ui/Field';
import { Icon } from './ui/Icon';

interface KeyUsage {
  key: string;
  pages: { slug: string; title: string; nodeIds: string[] }[];
  components: string[];
}

interface Row {
  key: string;
  /** `null` = giá trị không phải chuỗi, giữ nguyên ở `raw`. */
  value: string | null;
  raw: unknown;
}

function toRows(globals: Record<string, unknown>): Row[] {
  return Object.entries(globals)
    // `endpoint` có ô riêng ("Form" ở cột trái). Không bày ở đây, và không gửi lại: server
    // giữ nguyên nó khi `globals` vắng khoá này (xem `updateSiteSettings`).
    .filter(([key]) => key !== ENDPOINT_KEY)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, raw]) => ({
      key,
      value: typeof raw === 'string' ? raw : null,
      raw,
    }));
}

export function SiteSettingsForm({
  initial,
}: {
  initial: {
    name: string;
    primaryDomain: string;
    globals: Record<string, unknown>;
    faviconAssetId: string | null;
    faviconFile: KnownAsset | null;
    ogImageId: string | null;
    ogImageFile: KnownAsset | null;
    /** Kích thước ảnh chia sẻ — để cảnh báo cỡ/tỉ lệ mà không phải đọc lại kho. */
    ogImageSize: { width: number | null; height: number | null } | null;
    /** Nhận diện của chính builder — xem `lib/builder/branding.ts`. */
    builderLogoAssetId: string | null;
    builderLogoFile: KnownAsset | null;
    builderFaviconAssetId: string | null;
    builderFaviconFile: KnownAsset | null;
    builderFaviconUseSite: boolean;
  };
}) {
  const router = useRouter();
  const [builderLogo, setBuilderLogo] = useState(initial.builderLogoAssetId ?? '');
  const [builderLogoFile, setBuilderLogoFile] = useState(initial.builderLogoFile);
  const [builderIcon, setBuilderIcon] = useState(initial.builderFaviconAssetId ?? '');
  const [builderIconFile, setBuilderIconFile] = useState(initial.builderFaviconFile);
  const [useSiteIcon, setUseSiteIcon] = useState(initial.builderFaviconUseSite);
  const [name, setName] = useState(initial.name);
  const domain = initial.primaryDomain;
  const [favicon, setFavicon] = useState(initial.faviconAssetId ?? '');
  /*
   * File giữ riêng, không suy ra từ `initial`: sau khi chọn ảnh trong dialog, ô
   * xem trước phải đổi NGAY. `initial.faviconFile` chỉ mới lại sau `router.refresh()`,
   * tức sau khi bấm Lưu — người dùng sẽ chọn một ảnh và thấy ảnh cũ.
   */
  const [faviconFile, setFaviconFile] = useState(initial.faviconFile);
  const [ogImage, setOgImage] = useState(initial.ogImageId ?? '');
  const [ogImageFile, setOgImageFile] = useState(initial.ogImageFile);
  const [ogImageSize, setOgImageSize] = useState(initial.ogImageSize);

  /*
   * Cảnh báo tính LẠI mỗi lần đổi ảnh, không chờ lưu.
   *
   * Người dùng chọn một ảnh vuông 800×800 và cần biết nó sẽ bị cắt NGAY lúc đó,
   * không phải sau khi bấm Lưu rồi dán link vào Zalo để xem.
   */
  const ogWarning = ogImage
    ? shareImageWarning({
        url: ogImageFile?.url ?? '',
        width: ogImageSize?.width,
        height: ogImageSize?.height,
      })
    : null;
  const [rows, setRows] = useState<Row[]>(() => toRows(initial.globals));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [inUse, setInUse] = useState<KeyUsage[] | null>(null);

  // Nút Lưu chỉ sáng khi form KHÁC lần lưu gần nhất — cùng kiểu `dirty` của SiteEndpointsForm.
  const snapshot = JSON.stringify([
    name, favicon, ogImage, builderLogo, builderIcon, useSiteIcon,
    rows.map((r) => [r.key, r.value === null ? r.raw : r.value]),
  ]);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;

  const save = async (force = false) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    setInUse(null);
    try {
      const globals: Record<string, unknown> = {};
      for (const r of rows) {
        const k = r.key.trim();
        if (!k) continue;
        globals[k] = r.value === null ? r.raw : r.value;
      }

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          primaryDomain: domain,
          globals,
          // Chuỗi rỗng = bỏ favicon. `null` chứ không `''`: cột là nullable, và một
          // chuỗi rỗng trong đó là một id không bao giờ khớp asset nào.
          faviconAssetId: favicon.trim() || null,
          ogImageId: ogImage.trim() || null,
          builderLogoAssetId: builderLogo.trim() || null,
          builderFaviconAssetId: builderIcon.trim() || null,
          builderFaviconUseSite: useSiteIcon,
          force,
        }),
      });
      const json = await res.json();

      if (res.status === 409 && json.inUse) {
        setInUse(json.inUse as KeyUsage[]);
        setError(json.error as string);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? 'Lưu thất bại');

      setSaved(true);
      setSavedSnapshot(snapshot);
      router.refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(13.75rem,1fr))] gap-4">
        <TextField id="site-name" label="Tên site" value={name} onChange={(e) => setName(e.target.value)} />
        {/* Ô "Domain chính" đã chuyển thành ô URL site ở khối "Tên miền & SEO" (20/10/2026):
            lưu URL ở đó đồng bộ luôn `primaryDomain`. Form này vẫn gửi giá trị cũ, không đổi. */}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(13.75rem,1fr))] gap-4">
        {/*
          Favicon chọn bằng DIALOG, không phải bằng một ô gõ id.

          Ô id trần trước đây bắt người dùng: mở trang Ảnh → tải file → chép một cuid
          → quay lại đây → dán. Năm bước cho một việc, và bước "chép cuid" là bước
          không ai làm đúng ngay lần đầu.

          Lo ngại cũ vẫn được tôn trọng: tab "Tải lên" của dialog POST đúng
          `/api/assets` mà `AssetGrid` và tool MCP `upload_asset` dùng, nên vẫn chỉ có
          MỘT đường ghi asset. Thứ bị cấm là endpoint thứ hai, không phải nút thứ hai.

          Từ 07/09/2026 dùng chung `AssetPickerBox` với Inspector và form nội dung:
          cùng một khung vuông, cùng một dialog. Ô `size-9` cũ nhỏ hơn chính cái
          favicon nó đang xem trước ở nhiều màn hình — nó không cho biết ảnh có nền
          trong suốt hay không, mà đó là câu hỏi DUY NHẤT cần trả lời ở đây.

          `known` có sẵn từ server nên ô không phải chờ nạp kho ảnh chỉ để vẽ thứ
          nó đã biết. Khung hẹp lại: một khung vuông rộng bằng cột form sẽ là một ô
          vài trăm pixel cho một ảnh 32px.
        */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={ui.label}>Favicon</span>
          <AssetPickerBox
            value={favicon || null}
            onPick={(a) => {
              setFavicon(a?.id ?? '');
              setFaviconFile(a);
            }}
            label="favicon"
            known={faviconFile}
            mimes={FAVICON_MIMES}
            mimeLabel={FAVICON_MIME_LABEL}
            accept={FAVICON_ACCEPT}
            dialogTitle="Favicon"
            className="max-w-[9rem]"
          />
          <p className={cn(ui.hint, 'leading-relaxed')}>
            {FAVICON_MIME_LABEL} — JPEG bị từ chối vì không có nền trong suốt, logo sẽ có một ô vuông
            quanh nó trên tab. Áp dụng <strong className="text-shell-ink">ngay</strong> sau khi bấm Lưu,
            không chờ Publish: favicon là chrome của site, không phải nội dung trang.
          </p>
        </div>

        {/*
          Ảnh chia sẻ mặc định — cạnh favicon vì cùng một loại: chrome của site, áp
          dụng ngay, không chờ Publish.

          KHÔNG lọc mime như favicon. Favicon bị siết vì JPEG không có nền trong
          suốt; ảnh chia sẻ thì JPEG là định dạng ĐÚNG NHẤT — ảnh 1200×630 nhiều màu
          ở PNG nặng gấp mấy lần mà không đẹp hơn.
        */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={ui.label}>Ảnh chia sẻ mặc định</span>
          <AssetPickerBox
            value={ogImage || null}
            onPick={(a) => {
              setOgImage(a?.id ?? '');
              setOgImageFile(a);
              setOgImageSize(a ? { width: a.width ?? null, height: a.height ?? null } : null);
            }}
            label="ảnh chia sẻ"
            known={ogImageFile}
            kinds={IMAGE_KINDS}
            dialogTitle="Ảnh chia sẻ mặc định"
            className="max-w-[13rem]"
          />
          <p className={cn(ui.hint, 'leading-relaxed')}>
            Ảnh hiện khi ai đó dán link site vào Zalo, Facebook hay Slack — dùng cho trang nào chưa đặt
            ảnh riêng. Cỡ chuẩn <strong className="text-shell-ink">1200×630</strong>.
          </p>
          {/*
            Cảnh báo tính từ chính luật của nền tảng (`shareImageWarning`), không phải
            một câu chung chung. Người dùng cần biết ảnh họ vừa chọn sẽ ra sao TRƯỚC
            khi chạy quảng cáo, không phải sau khi thấy thẻ trắng.
          */}
          {ogWarning && (
            <p className="flex gap-2 rounded-md bg-shell-warn-soft px-3 py-2 text-mini leading-relaxed text-shell-ink">
              <Icon name="alert" size={15} className="mt-px text-shell-warn" />
              {ogWarning}
            </p>
          )}
        </div>
      </div>

      {/*
        Nhận diện của CHÍNH BUILDER — tách khỏi hai ô của site ở trên: hai ô kia là thứ
        khách thấy, ô này là thứ người dựng thấy. Cùng nút Lưu, áp dụng ngay, không qua
        Publish (builder không có release).
      */}
      <fieldset className="flex flex-col gap-3 rounded-md border border-shell-line p-4">
        <legend className="px-1.5 text-small font-semibold text-shell-ink">Nhận diện builder</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(13.75rem,1fr))] gap-4">
          {/*
            Hai cột cùng dáng: hàng tiêu đề cao ít nhất bằng công tắc (`min-h-6`) ở CẢ HAI
            cột, nên ô logo và ô favicon bắt đầu ở cùng một độ cao. Công tắc nằm bên phải
            hàng tiêu đề favicon thay vì chen giữa tiêu đề và ảnh — đứng đó nó đẩy ảnh favicon
            thấp hơn ảnh logo (người dùng báo 19/10/2026).
          */}
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className={cn(ui.label, 'flex min-h-6 items-center')}>Logo builder</span>
            <AssetPickerBox
              value={builderLogo || null}
              onPick={(a) => {
                setBuilderLogo(a?.id ?? '');
                setBuilderLogoFile(a);
              }}
              label="logo"
              known={builderLogoFile}
              kinds={IMAGE_KINDS}
              dialogTitle="Logo builder"
              className="max-w-[9rem]"
            />
            <p className={cn(ui.hint, 'leading-relaxed')}>
              Hiện ở thanh menu và màn đăng nhập. Trống là logo Quilder mặc định. Ảnh vuông, nền
              trong suốt (PNG/SVG) trông gọn nhất.
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            {/* Một hàng, không xuống dòng: cột chỉ ~290px, và công tắc rớt xuống dòng hai
                là lại đẩy ảnh lệch. Chữ hiện ngắn; tên trợ năng đủ nghĩa. */}
            <div className="flex min-h-6 items-center justify-between gap-3">
              <span className={ui.label}>Favicon builder</span>
              <Switch
                label={
                  <span title="Dùng chung favicon của web">
                    Dùng của web<span className="sr-only"> — favicon chung với site</span>
                  </span>
                }
                checked={useSiteIcon}
                onChange={setUseSiteIcon}
                className="shrink-0 text-small whitespace-nowrap text-shell-muted"
              />
            </div>
            {useSiteIcon ? (
              <p className={cn(ui.hint, 'leading-relaxed')}>
                Tab builder hiện đúng favicon của site ở trên
                {favicon ? '.' : ' — site chưa đặt favicon nên tab dùng icon mặc định.'}
              </p>
            ) : (
              <>
                <AssetPickerBox
                  value={builderIcon || null}
                  onPick={(a) => {
                    setBuilderIcon(a?.id ?? '');
                    setBuilderIconFile(a);
                  }}
                  label="favicon"
                  known={builderIconFile}
                  mimes={FAVICON_MIMES}
                  mimeLabel={FAVICON_MIME_LABEL}
                  accept={FAVICON_ACCEPT}
                  dialogTitle="Favicon builder"
                  className="max-w-[9rem]"
                />
                <p className={cn(ui.hint, 'leading-relaxed')}>
                  {FAVICON_MIME_LABEL}. Giúp phân biệt tab builder với tab site khi mở cạnh nhau.
                </p>
              </>
            )}
          </div>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={ui.label}>Globals</span>
          <p className={cn(ui.hint, 'leading-relaxed')}>
            Nguồn cho binding <code className="font-shell-mono">source: &quot;site&quot;</code> — hotline,
            số giấy phép, tên công ty. Sửa một chỗ, mọi trang dùng nó đổi theo.
          </p>
        </div>

        {/*
          GRID ba cột, không phải flex.

          Bản flex trước đây viết ô khoá là `${field} … w-40 shrink-0`, mà `field` đã
          chứa `w-full`. Hai utility cùng thuộc tính `width` thì thứ tự trong
          STYLESHEET quyết định, không phải thứ tự trong chuỗi class — nên `w-full`
          thắng, ô khoá chiếm hết hàng, `shrink-0` không cho nó co lại, ô giá trị bị
          ép còn vài pixel và nút ✕ trào ra ngoài viền.

          Grid không có cái bẫy đó: bề rộng thuộc về CỘT, ba ô con đều `w-full` bên
          trong cột của mình. Cột ✕ là `auto` nên không cách nào bị đẩy ra ngoài, dù
          tên khoá dài bao nhiêu. `minmax(0,…)` chứ không `1fr` trần: `min-width:auto`
          mặc định của grid item khiến ô giá trị không co được xuống dưới nội dung
          của nó — cùng một lỗi tràn, chỉ đổi chỗ.
        */}
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-2">
              <input
                aria-label={`Khoá ${i + 1}`}
                value={r.key}
                onChange={(e) =>
                  setRows((all) => all.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                }
                placeholder="hotline"
                spellCheck={false}
                className={cn(ui.fieldMd, 'font-shell-mono')}
              />
              {r.value === null ? (
                <input
                  aria-label={`Giá trị ${i + 1} (chỉ đọc)`}
                  readOnly
                  value={JSON.stringify(r.raw)}
                  title="Giá trị không phải chuỗi — sửa bằng script, không sửa ở đây"
                  className={cn(ui.fieldMd, 'font-shell-mono bg-shell-raised text-shell-muted')}
                />
              ) : (
                <input
                  aria-label={`Giá trị ${i + 1}`}
                  value={r.value}
                  onChange={(e) =>
                    setRows((all) =>
                      all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                  className={ui.fieldMd}
                />
              )}
              <IconButton
                icon="x"
                label={`Xoá khoá ${r.key || i + 1}`}
                variant="danger"
                onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>

        {rows.length === 0 && (
          <p className={cn(ui.inset, 'px-4 py-3 text-center text-small text-shell-muted')}>
            Chưa có khoá nào.
          </p>
        )}

        <Button
          variant="ghost"
          size="sm"
          icon="plus"
          className="self-start"
          onClick={() => setRows((r) => [...r, { key: '', value: '', raw: '' }])}
        >
          Thêm khoá
        </Button>
      </div>

      {error && (
        <p role="alert" className={cn(ui.error, 'text-small leading-relaxed')}>
          {error}
        </p>
      )}

      {inUse && (
        <div className="flex flex-col gap-3 rounded-md bg-shell-danger-soft p-4">
          <p className="text-small font-semibold">Những khoá này đang được dùng:</p>
          <ul className="flex flex-col gap-1.5">
            {inUse.map((u) => (
              <li key={u.key} className="text-small">
                <code className="font-shell-mono">{u.key}</code>
                <span className="text-shell-muted">
                  {' — '}
                  {u.pages.map((p) => `/${p.slug} (${p.nodeIds.length} node)`).join(', ')}
                  {u.components.length ? ` · component: ${u.components.join(', ')}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <Button
            variant="danger"
            size="md"
            icon="trash"
            className="self-start"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Xoá vẫn tiếp tục
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-shell-line pt-4">
        <span className="min-w-0 flex-[1_1_16rem] text-mini leading-relaxed text-shell-muted">
          <code className="font-shell-mono">globals</code> niêm phong theo release — site thật đổi khi
          bấm <strong className="text-shell-ink">Publish</strong>.
        </span>
        {saved && !dirty && (
          <Badge tone="ok" dot>
            đã lưu
          </Badge>
        )}
        <Button variant="primary" disabled={!dirty || busy} loading={busy} onClick={() => void save(false)}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </div>
    </div>
  );
}
