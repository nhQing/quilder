'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ui } from '@/lib/builder/ui';
import type { SetupStatus } from '@/lib/setup/status';
import { normalizeSiteUrl } from '@/lib/site/origin-resolve';
import { Button } from '@/components/builder/ui/Button';
import { Consequence } from '@/components/builder/ui/Overlay';
import { ProgressRail, type StepState } from './ProgressRail';
import { StepBox } from './StepBox';
import { AdminAccount, checkAdmin, type AdminErrors, type AdminValues } from './steps/AdminAccount';
import { checkSite, SiteInfo, type SiteErrors, type SiteValues } from './steps/SiteInfo';
import { SystemCheck, systemReady } from './steps/SystemCheck';

/**
 * Màn cài đặt: ba box xếp dọc, cột progress dính bên trái.
 *
 * Bố cục do user chốt ngày 20/10/2026 (spec §5.3): cả ba box LUÔN hiện, box chưa tới
 * mờ đi; xong một bước thì cuộn mượt tới box kế và focus ô đầu của nó. Không phải
 * wizard ẩn/hiện từng bước — người cài nhìn thấy trước toàn bộ việc phải làm.
 *
 * Chỉ MỘT request ghi: nút "Cài đặt" ở bước 3. Lỗi server thuộc về ô của bước 2
 * (`field: 'siteUrl'`) thì mở lại box 2 và cuộn tới đó.
 */

const STEPS = ['Kiểm tra hệ thống', 'Thông tin site', 'Tài khoản quản trị'] as const;

interface SetupResponse {
  ok?: boolean;
  error?: string;
  field?: string;
  warnings?: string[];
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function SetupSteps({ initialStatus }: { initialStatus: SetupStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [checking, setChecking] = useState(false);

  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState<boolean[]>([false, false, false]);
  /** Box đã xong mà người dùng bấm mở lại. */
  const [reopened, setReopened] = useState<boolean[]>([false, false, false]);

  const [site, setSite] = useState<SiteValues>({ siteName: '', siteUrl: '' });
  const [siteErrors, setSiteErrors] = useState<SiteErrors>({});
  const [admin, setAdmin] = useState<AdminValues>({ email: '', password: '', confirm: '', token: '' });
  const [adminErrors, setAdminErrors] = useState<AdminErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  // Cột progress tự đo các box này (xem `ProgressRail`); ở đây chỉ giữ ref.
  const listRef = useRef<HTMLOListElement>(null);
  const boxRefs = useRef<(HTMLLIElement | null)[]>([]);

  /* ── Chuyển bước: cuộn tới box và focus ô đầu ─────────────────────── */
  const focusStep = useCallback((i: number) => {
    // Đợi một khung hình: box vừa thôi `inert` và vừa mở ra ở lượt render này.
    requestAnimationFrame(() => {
      const el = boxRefs.current[i];
      if (!el) return;
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      el.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus({ preventScroll: true });
    });
  }, []);

  const goTo = useCallback(
    (i: number) => {
      setCurrent(i);
      setReopened([false, false, false]);
      focusStep(i);
    },
    [focusStep],
  );

  const complete = useCallback(
    (i: number) => {
      setDone((d) => d.map((v, k) => (k === i ? true : v)));
      if (i < STEPS.length - 1) goTo(i + 1);
    },
    [goTo],
  );

  /* ── Bước 1 tự chạy ───────────────────────────────────────────────── */
  useEffect(() => {
    // URL mặc định: chính địa chỉ đang mở builder. Đọc ở client vì server không biết
    // khách gõ host nào (sau proxy, header Host không đáng tin).
    setSite((s) => (s.siteUrl ? s : { ...s, siteUrl: window.location.origin }));
    if (systemReady(initialStatus)) complete(0);
    // Chỉ một lần lúc mở màn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recheck = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/setup/status', { cache: 'no-store' });
      const next = (await res.json()) as SetupStatus;
      // Đã cài (ai đó vừa cài ở tab khác): server trả 404 với đúng `{ installed: true }`,
      // nên kiểm TRƯỚC khi đưa nó vào state — nó không có `env` để màn đọc.
      if (next.installed) {
        router.replace('/builder/login');
        return;
      }
      setStatus(next);
      if (systemReady(next)) complete(0);
    } catch {
      // Server không trả lời — giữ trạng thái cũ; nút vẫn bấm lại được.
    } finally {
      setChecking(false);
    }
  };

  /* ── Bước 2 ───────────────────────────────────────────────────────── */
  const nextFromSite = () => {
    const errors = checkSite(site, status.env.siteUrlEnv);
    setSiteErrors(errors);
    if (Object.keys(errors).length) {
      focusStep(1);
      return;
    }
    complete(1);
  };

  /* ── Bước 3: request duy nhất ─────────────────────────────────────── */
  const submit = async () => {
    const errors = checkAdmin(admin, status.tokenRequired);
    setAdminErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length) return;

    // Bước 2 có thể đã bị mở lại và sửa thành sai sau khi bấm Tiếp.
    const sErrors = checkSite(site, status.env.siteUrlEnv);
    if (Object.keys(sErrors).length) {
      setSiteErrors(sErrors);
      setDone((d) => [d[0]!, false, false]);
      goTo(1);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          siteName: site.siteName.trim(),
          siteUrl: normalizeSiteUrl(site.siteUrl) ?? site.siteUrl,
          email: admin.email,
          password: admin.password,
          token: admin.token,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as SetupResponse;

      if (!res.ok) {
        const msg = json.error ?? `Cài đặt thất bại (HTTP ${res.status})`;
        if (json.field === 'siteName' || json.field === 'siteUrl') {
          setSiteErrors({ [json.field]: msg });
          setDone((d) => [d[0]!, false, false]);
          goTo(1);
        } else if (json.field === 'email' || json.field === 'password' || json.field === 'token') {
          setAdminErrors({ [json.field]: msg });
        } else {
          setFormError(msg);
        }
        if (res.status === 409) router.replace('/builder/login');
        setBusy(false);
        return;
      }

      setDone([true, true, true]);
      if (json.warnings?.length) {
        setWarnings(json.warnings);
        setBusy(false);
        return;
      }
      router.replace('/builder');
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const states: StepState[] = STEPS.map((_, i) => (done[i] ? 'done' : i === current ? 'current' : 'future'));
  const toggle = (i: number) => setReopened((r) => r.map((v, k) => (k === i ? !v : v)));
  const siteSummary = `${site.siteName.trim()} · ${status.env.siteUrlEnv ?? normalizeSiteUrl(site.siteUrl) ?? ''}`;

  return (
    <main className="mx-auto flex w-full max-w-[45rem] min-w-0 flex-col gap-8 py-6 sm:py-10">
      <header className="flex flex-col gap-1.5">
        <p className={ui.eyebrow}>Cài đặt lần đầu</p>
        <h1 className="text-page font-bold text-balance">Cài đặt website</h1>
        <p className="text-ui leading-relaxed text-shell-muted">
          Ba bước, khoảng một phút. Xong là vào thẳng builder với trang chủ và trang 404 có sẵn.
        </p>
      </header>

      <div className="flex min-w-0 gap-5 sm:gap-6">
        <ProgressRail
          listRef={listRef}
          boxRefs={boxRefs}
          states={states}
          onJump={(i) => {
            if (states[i] === 'done') setReopened((r) => r.map((v, k) => (k === i ? true : v)));
            focusStep(i);
          }}
        />

        <ol ref={listRef} className="relative flex min-w-0 flex-1 flex-col gap-5">
          <StepBox
            ref={(el) => {
              boxRefs.current[0] = el;
            }}
            index={0}
            title={STEPS[0]}
            state={states[0]!}
            open={reopened[0]!}
            onToggle={() => toggle(0)}
            summary="Database đã sẵn sàng."
          >
            <SystemCheck status={status} checking={checking} onRecheck={recheck} />
          </StepBox>

          <StepBox
            ref={(el) => {
              boxRefs.current[1] = el;
            }}
            index={1}
            title={STEPS[1]}
            state={states[1]!}
            open={reopened[1]!}
            onToggle={() => toggle(1)}
            summary={siteSummary}
          >
            <SiteInfo
              values={site}
              errors={siteErrors}
              siteUrlEnv={status.env.siteUrlEnv}
              onChange={setSite}
              onNext={nextFromSite}
            />
          </StepBox>

          <StepBox
            ref={(el) => {
              boxRefs.current[2] = el;
            }}
            index={2}
            title={STEPS[2]}
            state={states[2]!}
            open={reopened[2]!}
            summary={admin.email}
          >
            {warnings ? (
              <div className="flex flex-col gap-3">
                <p className="text-ui">Đã cài đặt xong. Có vài việc phụ chưa làm được:</p>
                {warnings.map((w) => (
                  <Consequence key={w} tone="warn">
                    {w}
                  </Consequence>
                ))}
                <div>
                  <Button
                    variant="primary"
                    iconRight="arrow-right"
                    onClick={() => {
                      router.replace('/builder');
                      router.refresh();
                    }}
                  >
                    Vào builder
                  </Button>
                </div>
              </div>
            ) : (
              <AdminAccount
                values={admin}
                errors={adminErrors}
                tokenRequired={status.tokenRequired}
                busy={busy}
                formError={formError}
                onChange={setAdmin}
                onSubmit={submit}
              />
            )}
          </StepBox>
        </ol>
      </div>
    </main>
  );
}
