'use client';

/**
 * Nút "Chia sẻ" của một trang: link xem nháp và link trên site thật, mỗi link chép
 * được bằng một cú bấm hoặc mở được ở tab mới.
 *
 * ## Link xem nháp ĐÒI ĐĂNG NHẬP
 *
 * `/preview/<id>` nằm sau middleware (`isProtected`), và đó là đúng: bản nháp chưa
 * duyệt không được lộ ra ngoài. Link này vì thế chỉ dành cho người có tài khoản
 * builder, và bảng nói thẳng ra như vậy — người nhận không nên phải gặp màn đăng nhập
 * rồi mới hiểu. Link nháp cho người ngoài (token ký hạn) chưa có; xem docblock của
 * `(site)/preview/[pageId]/page.tsx`.
 *
 * ## Link site thật đọc `SITE_URL`
 *
 * Cùng một gốc với canonical, sitemap và ảnh chia sẻ. Thiếu biến đó thì lấy origin
 * của chính builder (cùng app phục vụ site) và nói ra, vì ở production đó thường
 * KHÔNG phải tên miền khách thấy.
 *
 * ## Theo ngôn ngữ đang xem
 *
 * Editor đang ở bản dịch `en` thì hai link là bản `en`: `?locale=en` và `/en/<slug>`.
 * Người vừa sửa bản dịch muốn gửi đúng bản dịch đó đi, không phải bản gốc.
 */

import { useEffect, useRef, useState } from 'react';

import { copyText } from '@/lib/builder/clipboard';
import { isTemplateSlug } from '@/lib/builder/slug';
import { localePath } from '@/lib/i18n/locale';

import type { LocaleOption } from './InspectorHead';
import { Button, IconButton, buttonClass } from './ui/Button';
import { TextField } from './ui/Field';
import { Icon, type IconName } from './ui/Icon';
import { Popover } from './ui/Overlay';

export function PageShare({
  pageId,
  slug,
  siteUrl,
  published,
  locale,
  size = 'md',
}: {
  pageId: string;
  slug: string;
  /** `SITE_URL` của server, `null` khi chưa đặt. */
  siteUrl: string | null;
  /** Trang đã từng publish chưa — chưa thì chưa có link trên site. */
  published: boolean;
  /** Ngôn ngữ của hai link. */
  locale: LocaleOption;
  size?: 'sm' | 'md';
}) {
  // `window` chỉ có ở client; render đầu ở server thì link chưa có gốc.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const previewUrl = origin
    ? `${origin}/preview/${pageId}${locale.isDefault ? '' : `?locale=${encodeURIComponent(locale.code)}`}`
    : '';
  const base = (siteUrl?.trim() || origin).replace(/\/+$/, '');
  const liveUrl = base ? `${base}${localePath(locale, slug)}` : '';

  const liveBlocked = isTemplateSlug(slug)
    ? 'Đây là trang mẫu: mỗi bài có URL riêng, nên không có một link chung cho cả trang.'
    : !published
      ? 'Trang chưa publish lần nào. Publish xong mới có link trên site.'
      : null;

  return (
    <Popover
      label="Chia sẻ trang"
      panelClassName="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-4 p-4"
      trigger={(p) => (
        <Button variant="secondary" size={size} icon="share" {...p}>
          Chia sẻ
        </Button>
      )}
    >
      <ShareRow
        icon="eye"
        title="Link xem nháp"
        url={previewUrl}
        hint="Bản nháp mới nhất, chưa publish. Chỉ người có tài khoản builder mở được — người khác sẽ gặp màn đăng nhập."
      />
      <span aria-hidden className="h-px bg-shell-line" />
      <ShareRow
        icon="globe"
        title="Link trên site"
        url={liveUrl}
        blocked={liveBlocked}
        hint={
          siteUrl?.trim()
            ? 'Bản đang chạy — thứ khách đang thấy, ai cũng mở được.'
            : 'SITE_URL chưa đặt nên link dùng địa chỉ của builder; có thể khác tên miền khách thấy.'
        }
      />
    </Popover>
  );
}

function ShareRow({
  icon,
  title,
  url,
  hint,
  blocked,
}: {
  icon: IconName;
  title: string;
  url: string;
  hint: string;
  /** Lý do chưa có link. Có thì không vẽ ô link. */
  blocked?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await copyText(url);
      setCopied(true);
    } catch {
      // Clipboard API cần trang an toàn (https/localhost) và quyền của trình duyệt. Không
      // có thì bôi đen sẵn link: Ctrl+C vẫn chép được, thay vì một nút bấm không làm gì.
      input.current?.focus();
      input.current?.select();
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-small font-semibold text-shell-ink">
        <Icon name={icon} size={16} className="text-shell-muted" />
        {title}
      </h3>
      {blocked ? (
        <p className="rounded bg-shell-raised px-3 py-2.5 text-small text-shell-muted">{blocked}</p>
      ) : (
        <div className="flex items-center gap-1.5">
          <TextField
            ref={input}
            label={title}
            hideLabel
            readOnly
            mono
            size="md"
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            wrapperClassName="min-w-0 flex-1"
            className="text-mini"
          />
          <IconButton
            icon={copied ? 'check' : 'copy'}
            label={copied ? 'Đã chép' : `Chép ${title.toLowerCase()}`}
            onClick={() => void copy()}
            disabled={!url}
            className={copied ? 'text-shell-ok hover:text-shell-ok' : undefined}
          />
          <a
            href={url || undefined}
            target="_blank"
            rel="noreferrer"
            aria-label={`Mở ${title.toLowerCase()} ở tab mới`}
            title={`Mở ${title.toLowerCase()} ở tab mới`}
            className={buttonClass('ghost', 'md', 'w-control-md px-0 text-shell-muted')}
          >
            <Icon name="external" size={18} />
          </a>
        </div>
      )}
      <p className="text-mini leading-relaxed text-shell-muted">{hint}</p>
      {/* Đọc cho screen reader khi chép xong — đổi icon thôi thì người không nhìn không biết. */}
      <span role="status" className="sr-only">
        {copied ? `Đã chép ${title.toLowerCase()}` : ''}
      </span>
    </section>
  );
}
