'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { normalizeSiteUrl } from '@/lib/site/origin-resolve';
import { defaultRobotsTxt } from '@/lib/site/robots';
import { applyTitleTemplate } from '@/lib/site/seo-template';
import { SITE_THEME_LABEL, SITE_THEMES, type SiteTheme } from '@/lib/site/theme';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Checkbox, TextField } from './ui/Field';
import { ConfirmDialog, Consequence } from './ui/Overlay';

/**
 * Khối "Tên miền & SEO" của màn Cài đặt: URL site, SEO mặc định, robots.txt, sitemap.
 *
 * Lưu qua `PATCH /api/settings/seo` — đường riêng, xem `update-seo.ts`. Cả khối có
 * hiệu lực NGAY (không chờ Publish): đây là cấu hình của site, không niêm phong vào
 * release, cùng nhóm với favicon.
 *
 * robots.txt có hai chế độ: Tự sinh (cột `null`) và Tự soạn. Bật Tự soạn lần đầu thì
 * ô soạn được điền sẵn đúng nội dung đang tự sinh — người ta sửa từ thứ đang chạy,
 * không phải từ một ô trắng.
 */

export interface SiteSeoInitial {
  siteUrl: string | null;
  theme: SiteTheme;
  /** Env `SITE_URL` đang ghi đè — ô URL khoá. */
  siteUrlEnv: string | null;
  /** Gốc đang chạy (env → DB → localhost), cho nội dung robots mặc định. */
  origin: string;
  seoTitleTemplate: string | null;
  seoDescription: string | null;
  siteName: string;
  robotsTxt: string | null;
  sitemapRules: { include: string[]; exclude: string[] };
}

type Field = 'theme' | 'siteUrl' | 'seoTitleTemplate' | 'seoDescription' | 'robotsTxt' | 'sitemapRules';

const textarea = cn(ui.field, ui.textarea, 'font-shell-mono text-small');

export function SiteSeoForm({ initial }: { initial: SiteSeoInitial }) {
  const router = useRouter();
  const [siteUrl, setSiteUrl] = useState(initial.siteUrl ?? '');
  const [theme, setTheme] = useState<SiteTheme>(initial.theme);
  const [template, setTemplate] = useState(initial.seoTitleTemplate ?? '');
  const [description, setDescription] = useState(initial.seoDescription ?? '');
  const [robotsCustom, setRobotsCustom] = useState(initial.robotsTxt !== null);
  const [robots, setRobots] = useState(initial.robotsTxt ?? defaultRobotsTxt(initial.origin));
  const [include, setInclude] = useState(initial.sitemapRules.include.join('\n'));
  const [exclude, setExclude] = useState(initial.sitemapRules.exclude.join('\n'));

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ field?: Field; message: string } | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  /*
   * Nút Lưu chỉ sáng khi form KHÁC lần lưu gần nhất. So ảnh chụp chuỗi của mọi ô; nội dung
   * robots chỉ tính khi đang "Tự soạn" — ở chế độ tự sinh nó không được gửi đi.
   */
  const snapshot = JSON.stringify([
    theme, siteUrl, template, description, robotsCustom, robotsCustom ? robots : null, include, exclude,
  ]);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;

  const origin = initial.siteUrlEnv ?? normalizeSiteUrl(siteUrl) ?? initial.origin;
  const fieldError = (f: Field) => (error?.field === f ? error.message : undefined);

  const save = async (confirmWarnings = false) => {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/settings/seo', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          theme,
          ...(initial.siteUrlEnv ? {} : { siteUrl }),
          seoTitleTemplate: template,
          seoDescription: description,
          robotsTxt: robotsCustom ? robots : null,
          sitemapRules: { include: include.split('\n'), exclude: exclude.split('\n') },
          confirmWarnings,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: Field;
        warnings?: string[];
      };
      if (res.status === 409 && json.warnings?.length) {
        setWarnings(json.warnings);
        return;
      }
      if (!res.ok) {
        setError({ field: json.field, message: json.error ?? `Lưu thất bại (HTTP ${res.status})` });
        return;
      }
      setWarnings(null);
      setSaved(true);
      setSavedSnapshot(snapshot);
      router.refresh();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error && !error.field && <Consequence>{error.message}</Consequence>}

      {/* ── Giao diện — `Site.theme`, xem src/lib/site/theme.ts ────── */}
      <div className="flex flex-col gap-1.5">
        <span className={ui.label} id="seo-theme-label">
          Giao diện site
        </span>
        {/* `auto-cols-fr` + `w-fit`: ba ô rộng bằng nhau và bằng nhãn DÀI NHẤT. Bản `flex-1` trong
            khung `max-w-md` chia đều 28rem, nên "Theo máy người xem" bị bẻ xuống dòng hai. */}
        <div
          role="radiogroup"
          aria-labelledby="seo-theme-label"
          className="grid w-fit max-w-full auto-cols-fr grid-flow-col gap-0.5 rounded-sm bg-shell-raised p-0.5"
        >
          {SITE_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              data-site-theme={t}
              onClick={() => setTheme(t)}
              className={cn(
                'h-7 truncate whitespace-nowrap rounded-xs px-4 text-small font-medium transition-colors',
                theme === t
                  ? 'bg-shell-panel text-shell-ink shadow-shell-card'
                  : 'text-shell-muted hover:text-shell-ink',
              )}
            >
              {SITE_THEME_LABEL[t]}
            </button>
          ))}
        </div>
        <p className={ui.hint}>
          “Theo máy người xem” là chế độ tối tự động: khách để máy ở chế độ tối thì site hiện tối.
        </p>
        {fieldError('theme') && <span className={ui.error}>{fieldError('theme')}</span>}
      </div>

      {/* ── Tên miền ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <TextField
          id="seo-site-url"
          label="URL site"
          type="url"
          mono
          spellCheck={false}
          disabled={Boolean(initial.siteUrlEnv)}
          value={initial.siteUrlEnv ?? siteUrl}
          error={fieldError('siteUrl')}
          onChange={(e) => setSiteUrl(e.target.value)}
          hint={
            initial.siteUrlEnv ? (
              <>
                Đang bị biến môi trường <code className="font-shell-mono">SITE_URL</code> ghi đè — đổi ở env
                của server.
              </>
            ) : (
              <>
                Canonical, sitemap và thẻ chia sẻ dựng từ{' '}
                <code className="font-shell-mono text-shell-ink">{origin}/…</code>
              </>
            )
          }
        />
      </div>

      {/* ── SEO mặc định ─────────────────────────────────────────── */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
        <TextField
          id="seo-title-template"
          label="Template tiêu đề"
          placeholder={`%s · ${initial.siteName}`}
          value={template}
          error={fieldError('seoTitleTemplate')}
          onChange={(e) => setTemplate(e.target.value)}
          hint={
            template.trim() ? (
              <>
                Trang “Giới thiệu” sẽ có tiêu đề:{' '}
                <span className="text-shell-ink">{applyTitleTemplate(template, 'Giới thiệu')}</span>
              </>
            ) : (
              'Để trống = tiêu đề trang giữ nguyên. %s là chỗ tiêu đề của từng trang.'
            )
          }
        />
        <TextField
          id="seo-description"
          label="Mô tả mặc định"
          value={description}
          error={fieldError('seoDescription')}
          onChange={(e) => setDescription(e.target.value)}
          hint="Dùng cho trang chưa có mô tả riêng. Tối đa 300 ký tự."
        />
      </div>

      {/* ── robots.txt ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className={ui.label}>robots.txt</span>
          <Checkbox
            id="seo-robots-custom"
            label="Tự soạn"
            checked={robotsCustom}
            onChange={(e) => {
              setRobotsCustom(e.target.checked);
              // Bật lần đầu: điền đúng nội dung đang tự sinh, không để ô trắng.
              if (e.target.checked && initial.robotsTxt === null) setRobots(defaultRobotsTxt(origin));
            }}
          />
          <a className="ml-auto text-mini text-shell-accent underline-offset-4 hover:underline" href="/robots.txt" target="_blank" rel="noreferrer">
            Xem /robots.txt
          </a>
        </div>
        {robotsCustom ? (
          <>
            <textarea
              id="seo-robots"
              aria-label="Nội dung robots.txt"
              rows={9}
              spellCheck={false}
              className={textarea}
              aria-invalid={Boolean(fieldError('robotsTxt')) || undefined}
              value={robots}
              onChange={(e) => setRobots(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="ghost" icon="undo" onClick={() => setRobots(defaultRobotsTxt(origin))}>
                Về mặc định
              </Button>
              {fieldError('robotsTxt') && <span className={ui.error}>{fieldError('robotsTxt')}</span>}
            </div>
          </>
        ) : (
          <p className={ui.hint}>
            Đang tự sinh: cho phép mọi trang, chặn builder và API, khai sitemap. Bật “Tự soạn” để thêm dòng —
            ví dụ chặn một bot.
          </p>
        )}
      </div>

      {/* ── sitemap.xml ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className={ui.label}>sitemap.xml</span>
          <a className="ml-auto text-mini text-shell-accent underline-offset-4 hover:underline" href="/sitemap.xml" target="_blank" rel="noreferrer">
            Xem /sitemap.xml
          </a>
        </div>
        <p className={ui.hint}>
          Tự sinh từ trang và bài viết đã đăng; trang đặt “noindex” không vào. Hai ô dưới để điều chỉnh — mỗi dòng
          một mục.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Loại trừ (tiền tố đường dẫn)</span>
            <textarea
              id="seo-sitemap-exclude"
              rows={4}
              spellCheck={false}
              placeholder="/thu-nghiem"
              className={textarea}
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Thêm URL</span>
            <textarea
              id="seo-sitemap-include"
              rows={4}
              spellCheck={false}
              placeholder="/trang-ngoai-builder"
              className={textarea}
              value={include}
              onChange={(e) => setInclude(e.target.value)}
            />
          </label>
        </div>
        {fieldError('sitemapRules') && <span className={ui.error}>{fieldError('sitemapRules')}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-shell-line pt-4">
        <span className="min-w-0 flex-[1_1_16rem] text-mini leading-relaxed text-shell-muted">
          Có hiệu lực ngay trên site thật — không cần Publish.
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

      <ConfirmDialog
        open={Boolean(warnings)}
        onClose={() => setWarnings(null)}
        onConfirm={() => void save(true)}
        busy={busy}
        title="robots.txt có cảnh báo"
        description="Vẫn lưu được, nhưng kiểm lại trước:"
        confirmLabel="Vẫn lưu"
      >
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-small">
          {warnings?.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
