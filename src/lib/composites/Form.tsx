'use client';

/**
 * Composite Form — ô nhập, nhãn, và một lần gửi.
 *
 * ## Ranh giới: builder dựng UI, BE sở hữu dữ liệu
 *
 * Chốt 07/09/2026. Form `POST` sang một API do backend cung cấp; builder KHÔNG
 * lưu, KHÔNG nhận, KHÔNG xuất gì. Không có bảng submission, không có route nhận.
 * Nên mọi câu về lưu trữ, quyền đọc, thời gian giữ và chống spam thật đều thuộc
 * về ai sở hữu cái endpoint đó — xem `formParams.endpointKey` trong `registry.ts`.
 *
 * ## Vì sao 'use client' mà vẫn SSR đầy đủ
 *
 * Cần `useState` cho trạng thái gửi và `fetch` cho lần gửi, nên nó là client
 * component. Nhưng App Router vẫn render HTML ban đầu ở server: ô nhập, nhãn,
 * nút và dòng ghi chú có trong HTML đầu tiên, nên crawler thấy form và người dùng
 * thấy nó trước khi JS tải xong. Cùng lý lẽ như `SavingsSimulator`.
 *
 * ## Vì sao KHÔNG có đường submit khi tắt JS
 *
 * Một `<form action>` trỏ sang origin khác vẫn gửi được, nhưng nó ĐIỀU HƯỚNG
 * trình duyệt sang phản hồi của BE — tức khách rời trang và thấy JSON. Nên submit
 * đi qua `fetch`, và không-JS nghĩa là form không dùng được.
 *
 * Đó là hệ quả của việc BE nằm ở origin khác, không phải một lựa chọn. Muốn
 * không-JS thì cần một route proxy CÙNG origin — và route đó sẽ là chỗ builder
 * chạm dữ liệu khách, tức đúng thứ ranh giới trên đang tránh.
 *
 * ## Ba chỗ a11y không được bỏ
 *
 *  - `<label for>` ↔ `<input id>`: id sinh từ `useId`, nên hai form cùng trang
 *    không đụng nhau. Đây là lý do ô nhập là params chứ không phải node — xem
 *    `formField`.
 *  - Thông báo kết quả nằm trong vùng `aria-live="polite"` và LUÔN có trong DOM
 *    (không mount/unmount): một vùng live vừa được chèn vào thường không được
 *    screen reader đọc.
 *  - `aria-describedby` nối ô nhập với dòng `help` của nó.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { resolveAfterSubmit } from './form-mode';
import type { FormFieldDef, FormParams } from './registry';

/** Ô ẩn bắt bot điền mọi thứ. Tên trông thật để nó không bị bỏ qua. */
const HONEYPOT = 'website_url';

type Status = 'idle' | 'sending' | 'ok' | 'error';

export interface FormProps extends FormParams {
  /**
   * URL đích, đã resolve từ `Site.globals.endpoint[endpointKey]`.
   *
   * `null` khi khoá không có trong globals. Khi đó form render ở trạng thái VÔ
   * HIỆU kèm một dòng nói rõ lý do — không phải một form trông bình thường mà bấm
   * không có gì xảy ra. Cùng luật với `Canvas.fallbackChildId`: thiếu cấu hình
   * phải THẤY ĐƯỢC.
   */
  action: string | null;
  /** Nội dung slot: tiêu đề và dòng ghi chú. Node `Text` thật, dịch được. */
  heading?: React.ReactNode;
  note?: React.ReactNode;
  /**
   * Nội dung hộp thoại khi `afterSubmit = 'dialog'`: `success` sau khi gửi được,
   * `error` khi thất bại. Chỉ được mount BÊN TRONG `<dialog>` và chỉ sau khi có kết
   * quả — trước đó chúng không có trong DOM / HTML render sẵn, nên trang tải không lóe
   * và crawler đọc HTML không nhầm lời cảm ơn là nội dung trang. Chúng VẪN nằm trong
   * payload RSC (là prop của client component này, phải gửi xuống thì mới mount được
   * sau đó): đừng đặt vào slot thứ gì không được lộ trước khi khách gửi form.
   */
  success?: React.ReactNode;
  error?: React.ReactNode;
  /**
   * Đang render trong KHUNG XEM TRƯỚC của builder (route `/render/...`, cờ `canvas` của
   * RenderContext) — site thật không bao giờ đặt cờ này.
   *
   * Khi bật và form ở chế độ `dialog`, hai slot được render thêm một lần, TẠI CHỖ và ẩn
   * (`hidden`), trong khối `.mm-form__preview`. Lý do: hộp thoại thật chỉ mount slot sau
   * khi gửi, mà trong builder không ai gửi được (canvas chặn submit) — node slot sẽ không
   * bao giờ có trên canvas để thấy và bấm chọn. Công tắc "Xem trước" của sidebar bật khối
   * tương ứng bằng CSS chèn vào khung (`formPreviewCss`), không cần nạp lại trang.
   */
  canvasPreview?: boolean;
  /**
   * Site key Turnstile khi `captcha = 'turnstile'`, đọc từ biến môi trường của server lúc
   * render. `null` khi form có captcha mà server chưa đặt key: form hiện tắt kèm dòng báo.
   */
  captchaSiteKey?: string | null;
}

/** Script Turnstile — nạp một lần cho cả trang, chế độ `render=explicit`. */
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}

let turnstileLoading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  turnstileLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => {
      turnstileLoading = null;
      reject(new Error('turnstile'));
    };
    document.head.append(s);
  });
  return turnstileLoading;
}

/**
 * Câu báo cho KHÁCH mà nơi nhận gửi kèm (`{ userMessage, field }`).
 *
 * Chỉ đọc khoá `userMessage` — khoá có tên riêng nói rõ "câu này viết cho người dùng
 * cuối", nên nơi nhận phải chủ động đặt nó. Mọi khoá khác (`error`, `message`, stack) bị
 * bỏ qua: chúng có thể mang chi tiết nội bộ. Trần độ dài chặn một nơi nhận lỗi đổ cả
 * trang HTML vào ô báo.
 */
export async function serverNotice(res: Response): Promise<{ message?: string; field?: string }> {
  try {
    const body = (await res.json()) as { userMessage?: unknown; field?: unknown };
    const message =
      typeof body.userMessage === 'string' && body.userMessage.trim() && body.userMessage.length <= 300
        ? body.userMessage.trim()
        : undefined;
    const field = typeof body.field === 'string' && /^[a-z][a-z0-9_]*$/.test(body.field) ? body.field : undefined;
    return { message, field };
  } catch {
    return {};
  }
}

function inputMode(kind: FormFieldDef['kind']): 'email' | 'tel' | 'numeric' | undefined {
  if (kind === 'email') return 'email';
  if (kind === 'tel') return 'tel';
  if (kind === 'number') return 'numeric';
  return undefined;
}

/**
 * Báo GA một lượt gửi form thành công (event chuẩn `generate_lead` của GA4).
 *
 * Chỉ gửi KHOÁ nơi nhận, không bao giờ gửi giá trị khách nhập: điều khoản GA cấm
 * dữ liệu nhận diện cá nhân, và đây là dữ liệu đăng ký của khách. Không có GA
 * (env thiếu, bản nháp, trình chặn quảng cáo) thì `gtag` vắng và không làm gì.
 * Lượt bị honeypot/quá nhanh chặn không đi qua đây — chúng không phải lượt thật.
 */
function trackLead(endpointKey: string | undefined) {
  const gtag = (window as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  try {
    gtag('event', 'generate_lead', { form_key: endpointKey || 'unknown' });
  } catch {
    // Số liệu không được làm hỏng lượt gửi đã thành công.
  }
}

export function Form({
  action,
  endpointKey,
  fields,
  submitLabel,
  successMessage,
  errorMessage,
  a11yLabel,
  successPanel,
  afterSubmit,
  heading,
  note,
  success,
  error,
  canvasPreview = false,
  captcha,
  captchaSiteKey = null,
}: FormProps) {
  const uid = useId();
  const [status, setStatus] = useState<Status>('idle');
  /**
   * Lúc form được dựng, đặt trong ref chứ không trong state khởi tạo.
   *
   * `Date.now()` khi render sẽ khác nhau ở server và ở client, tức hydration
   * mismatch. Ref gán trong lần render đầu ở CLIENT là đủ: nó chỉ dùng cho phép
   * đo "gửi nhanh bất thường", không đi vào HTML.
   */
  const mountedAt = useRef<number | null>(null);
  if (mountedAt.current === null && typeof window !== 'undefined') {
    mountedAt.current = Date.now();
  }

  const mode = resolveAfterSubmit({ afterSubmit, successPanel });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  /** Hộp thoại đang hiện kết quả nào; `null` = đóng (và slot không mount). */
  const [shown, setShown] = useState<'success' | 'error' | null>(null);
  /** Câu báo riêng của nơi nhận (thay `successMessage` / `errorMessage`) và ô bị báo sai. */
  const [notice, setNotice] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);

  /*
   * Captcha. Widget dựng bằng JS (render=explicit) SAU hydrate — HTML server chỉ có ô
   * chứa trống, nên không lệch hydrate. Widget tự chèn `<input name="cf-turnstile-response">`
   * vào ô chứa nằm TRONG form, nên `FormData` mang token đi mà không cần state.
   * Không dựng trong khung builder: ở đó không ai gửi form.
   */
  const needsCaptcha = captcha === 'turnstile';
  const captchaRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  useEffect(() => {
    if (!needsCaptcha || !captchaSiteKey || canvasPreview) return;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !captchaRef.current || widgetId.current) return;
        widgetId.current = ts.render(captchaRef.current, { sitekey: captchaSiteKey, language: 'vi' });
      })
      .catch(() => {
        /* Không tải được script: nơi nhận sẽ từ chối vì thiếu token, form báo lỗi chung. */
      });
    return () => {
      cancelled = true;
      const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (ts && widgetId.current) ts.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [needsCaptcha, captchaSiteKey, canvasPreview]);

  /** Token Turnstile chỉ dùng được MỘT lần — xin token mới sau mỗi lượt gửi. */
  const resetCaptcha = () => {
    const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (ts && widgetId.current) ts.reset(widgetId.current);
  };

  // `showModal()` cho focus trap, Esc và lớp nền của trình duyệt — không tự dựng lại.
  useEffect(() => {
    const d = dialogRef.current;
    if (shown && d && !d.open) d.showModal();
  }, [shown]);

  /**
   * MỘT đường đóng cho mọi cách đóng (nút Đóng, bấm nền, Esc, sự kiện `close`).
   * Idempotent: gọi hai lần (`d.close()` rồi `onClose`) vô hại.
   * Trả focus về nút gửi — lúc này status đã ok/error nên nút không còn disabled;
   * nếu để Esc tự xử lý thì focus rơi về body.
   */
  const closeDialog = () => {
    const d = dialogRef.current;
    if (d?.open) d.close();
    setShown(null);
    submitRef.current?.focus();
  };

  const captchaMissing = needsCaptcha && !captchaSiteKey;
  const disabled = !action || captchaMissing || status === 'sending';

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || captchaMissing) return;
    setNotice(null);
    setInvalidField(null);

    const form = event.currentTarget;
    const data = new FormData(form);

    /*
     * Hai phép chặn bot thô, và cả hai chỉ là GỢI Ý cho BE.
     *
     * Honeypot: người không thấy ô đó nên không điền. Mốc thời gian: người cần
     * hơn hai giây để đọc nhãn và gõ. BE KHÔNG được tin chúng — chúng đến từ
     * client, và client thì bot sở hữu. Chống spam thật là việc của BE.
     */
    const trap = String(data.get(HONEYPOT) ?? '');
    const tooFast = mountedAt.current !== null && Date.now() - mountedAt.current < 2000;
    data.delete(HONEYPOT);

    if (trap || tooFast) {
      // Báo THÀNH CÔNG mà không gửi: nói "bạn là bot" là chỉ cho bot biết phép
      // kiểm nằm ở đâu. Người thật gõ nhanh bất thường thì mất một lần gửi —
      // cái giá đó nhỏ hơn việc dạy bot cách lách.
      setStatus('ok');
      if (mode === 'dialog') setShown('success');
      form.reset();
      return;
    }

    setStatus('sending');
    try {
      const res = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      const { message, field } = await serverNotice(res);
      if (!res.ok) {
        setNotice(message ?? null);
        setInvalidField(field ?? null);
        throw new Error(String(res.status));
      }
      setNotice(message ?? null);
      setStatus('ok');
      trackLead(endpointKey);
      if (mode === 'dialog') setShown('success');
      // Báo cho modal bao ngoài (nếu có) chuyển sang panel cảm ơn — xem `successPanel`.
      if (mode === 'panel' && successPanel) {
        form.dispatchEvent(new CustomEvent('modal:show', { bubbles: true, detail: { panel: successPanel } }));
      }
      form.reset();
    } catch {
      // KHÔNG hiện thông báo của server: nó có thể mang chi tiết nội bộ, và người
      // dùng cuối không làm gì được với chúng. `errorMessage` là chuỗi người dựng
      // trang đã duyệt.
      setStatus('error');
      if (mode === 'dialog') setShown('error');
    } finally {
      if (needsCaptcha) resetCaptcha();
    }
  };

  return (
    <div className="mm-form-root">
      {heading}

      <form
        className="mm-form"
        onSubmit={onSubmit}
        noValidate={false}
        {...(a11yLabel ? { 'aria-label': a11yLabel } : {})}
        data-part="form"
        data-status={status}
      >
        {fields.map((f) => {
          const id = `${uid}-${f.name}`;
          const helpId = f.help ? `${id}-help` : undefined;
          if (f.kind === 'hidden') {
            return <input key={f.name} type="hidden" name={f.name} value={f.value ?? ''} />;
          }
          const common = {
            id,
            name: f.name,
            required: f.required,
            disabled,
            'data-part': `field-${f.name}`,
            ...(invalidField === f.name ? { 'aria-invalid': true as const } : {}),
            ...(helpId ? { 'aria-describedby': helpId } : {}),
            ...(f.autocomplete ? { autoComplete: f.autocomplete } : {}),
          };

          return (
            <div
              key={f.name}
              className={`mm-form__row mm-form__row--${f.kind}`}
              data-part="field"
            >
              <label className="mm-form__label" htmlFor={id}>
                {f.label}
                {/* Dấu sao là TRANG TRÍ: `required` trên input đã là hợp đồng thật
                    với trình duyệt và với screen reader. */}
                {f.required && (
                  <span className="mm-form__req" aria-hidden="true">
                    {' *'}
                  </span>
                )}
              </label>

              {f.kind === 'textarea' ? (
                <textarea
                  {...common}
                  className="mm-form__input mm-form__input--textarea"
                  rows={4}
                  {...(f.placeholder ? { placeholder: f.placeholder } : {})}
                />
              ) : f.kind === 'select' ? (
                <select {...common} className="mm-form__input mm-form__input--select" defaultValue="">
                  {/* Lựa chọn rỗng đứng đầu để `required` có nghĩa: không có nó thì
                      giá trị đầu tiên đã được chọn sẵn và không ai "bỏ trống" được. */}
                  <option value="" disabled={f.required}>
                    {f.placeholder ?? '— Chọn —'}
                  </option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.kind === 'checkbox' ? (
                <input {...common} type="checkbox" className="mm-form__checkbox" value="1" />
              ) : (
                <input
                  {...common}
                  type={f.kind}
                  className="mm-form__input"
                  {...(inputMode(f.kind) ? { inputMode: inputMode(f.kind) } : {})}
                  {...(f.placeholder ? { placeholder: f.placeholder } : {})}
                />
              )}

              {f.help && (
                <p className="mm-form__help" id={helpId}>
                  {f.help}
                </p>
              )}
            </div>
          );
        })}

        {/* Honeypot: ẩn bằng CSS, KHÔNG bằng `type=hidden` — bot điền mọi field
            nhìn thấy được trong DOM, và `hidden` là thứ chúng bỏ qua.
            `tabIndex={-1}` và `aria-hidden` để người dùng bàn phím và screen
            reader không bao giờ gặp nó. */}
        <div className="mm-form__trap" aria-hidden="true">
          <label htmlFor={`${uid}-${HONEYPOT}`}>Đừng điền ô này</label>
          <input
            id={`${uid}-${HONEYPOT}`}
            name={HONEYPOT}
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {needsCaptcha && !canvasPreview && (
          <div ref={captchaRef} className="mm-form__captcha" data-part="captcha" />
        )}

        <button
          ref={submitRef}
          type="submit"
          className="btn btn--primary mm-form__submit"
          disabled={disabled}
          data-part="submit"
        >
          {status === 'sending' ? 'Đang gửi…' : submitLabel}
        </button>

        {/*
          Vùng live LUÔN có trong DOM, kể cả khi rỗng.
          Mount nó cùng lúc với thông báo thì screen reader thường không đọc —
          `aria-live` chỉ phát khi NỘI DUNG của một vùng đã tồn tại thay đổi.
        */}
        <p className="mm-form__status" data-part="status" role="status" aria-live="polite">
          {/* Chế độ dialog: kết quả nằm trong hộp thoại, đọc hai lần là ồn. */}
          {mode === 'dialog'
            ? ''
            : status === 'ok'
              ? (notice ?? successMessage)
              : status === 'error'
                ? (notice ?? errorMessage)
                : ''}
        </p>

        {!action && (
          <p className="mm-form__misconfig" data-part="misconfig">
            Chọn form rồi đặt nơi nhận ở sidebar
            {endpointKey ? (
              <>
                {' '}
                (khoá <code>{endpointKey}</code> chưa có URL)
              </>
            ) : null}
            .
          </p>
        )}
        {action && captchaMissing && (
          <p className="mm-form__misconfig" data-part="misconfig">
            Form bật captcha nhưng server chưa đặt <code>TURNSTILE_SITE_KEY</code>.
          </p>
        )}
      </form>

      {canvasPreview && mode === 'dialog' && (
        <>
          {(
            [
              ['success', success],
              ['error', error],
            ] as const
          ).map(([kind, content]) => (
            // `div`, không phải `<dialog open>`: dialog không modal mặc định nằm `absolute`
            // đè lên trang. Cùng class `mm-form__dialog` để style phần "Hộp thoại" áp y như thật.
            <div key={kind} className="mm-form__preview" data-preview={kind} hidden>
              <div className="mm-form__dialog" data-part="dialog">
                <div className="mm-form__dialog-body" data-part="dialog-body">
                  <span className="mm-form__dialog-close" aria-hidden="true">
                    ×
                  </span>
                  {content}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {note}

      {mode === 'dialog' && (
        <dialog
          ref={dialogRef}
          className="mm-form__dialog"
          data-part="dialog"
          onClose={closeDialog}
          aria-label={a11yLabel ?? 'Kết quả gửi form'}
          // Bấm nền (chính phần tử dialog, không phải nội dung) thì đóng.
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          {shown && (
            <div className="mm-form__dialog-body" data-part="dialog-body">
              <button
                type="button"
                className="mm-form__dialog-close"
                aria-label="Đóng"
                data-part="dialog-close"
                onClick={closeDialog}
              >
                ×
              </button>
              {shown === 'success' ? success : error}
            </div>
          )}
        </dialog>
      )}
    </div>
  );
}

export default Form;
