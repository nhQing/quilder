/**
 * Tách chữ theo dòng/từ/ký tự rồi hiện lần lượt.
 *
 * Port từ ../new-website/js/effects/text-split.js. Viết tay, không dùng SplitText.
 * Phần đáng chú ý là phát hiện dòng: các từ được đặt phẳng một lượt, đọc
 * `offsetTop` để gom thành dòng thị giác, rồi mới dựng lại markup với một wrapper
 * cắt cho mỗi dòng. Đó là thứ cho phép các đơn vị trượt lên từ sau hộp dòng của
 * chính nó.
 *
 * ## NGOẠI LỆ CÓ CHỦ ĐÍCH — đọc trước khi sửa
 *
 * Đây là effect DUY NHẤT mà GSAP sở hữu transform hoàn toàn, phá quy ước
 * "CSS sở hữu trạng thái" của cả codebase. Lý do nằm ở `effects/reveal.css` và
 * phải giữ nguyên: nếu CSS cũng khai một transform khởi đầu, thì animate về
 * `yPercent: 0` sẽ KHÔNG ghi transform nào cả, và rule CSS kia giữ chữ ẩn vĩnh
 * viễn. Đừng thêm transform khởi đầu cho `.split__unit` trong CSS.
 *
 * ## Vì sao đợi font
 *
 * Phát hiện dòng đo chữ đã render, nên phải đo trong đúng font cuối. Tách trước
 * rồi tách lại khi `fonts.ready` cũng chạy được, nhưng tiêu đề sẽ ngắt dòng lại
 * thấy rõ khi webfont về. Đợi thì sạch hơn: chữ đơn giản là chưa tách (và đọc
 * được đầy đủ) cho tới lúc đó. `Promise.race` với 1500ms canh trường hợp font
 * không bao giờ resolve.
 */

import { z } from 'zod';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { defineEffect } from './types';

const paramsSchema = z.object({
  mode: z.enum(['lines', 'words', 'chars']).default('lines'),
  /** Giây giữa hai đơn vị liền nhau. */
  stagger: z.number().min(0).max(0.5).default(0.03),
  duration: z.number().min(0.1).max(4).default(1.15),
  /** % chiều cao đơn vị mà nó trượt lên từ đó. */
  yPercent: z.number().min(0).max(300).default(110),
  ease: z.string().max(32).default('expo.out'),
});

type Params = z.infer<typeof paramsSchema>;

/** Đặt các từ phẳng ra để đo được vị trí dòng của chúng. */
function measurePass(el: HTMLElement, words: string[]): HTMLElement[] {
  const fragment = document.createDocumentFragment();
  const probes: HTMLElement[] = [];

  words.forEach((word, index) => {
    const span = document.createElement('span');
    span.className = 'split__word';
    span.textContent = word;
    fragment.append(span);
    probes.push(span);
    if (index < words.length - 1) fragment.append(document.createTextNode(' '));
  });

  el.replaceChildren(fragment);
  return probes;
}

/** Gom chỉ số từ theo dòng mà chúng rơi vào. */
function groupIntoLines(probes: HTMLElement[], words: string[]): string[][] {
  const lines: string[][] = [];
  let currentTop: number | null = null;

  probes.forEach((probe, index) => {
    const top = probe.offsetTop;
    // Lệch dưới pixel giữa các hộp inline: trong vòng 2px vẫn là cùng một dòng.
    if (currentTop === null || Math.abs(top - currentTop) > 2) {
      currentTop = top;
      lines.push([]);
    }
    lines[lines.length - 1]!.push(words[index]!);
  });

  return lines.length ? lines : [words];
}

/** Dựng lại element thành các dòng chứa đơn vị animate được. */
function buildPass(
  el: HTMLElement,
  lines: string[][],
  mode: 'lines' | 'words' | 'chars',
): HTMLElement[] {
  const fragment = document.createDocumentFragment();
  const units: HTMLElement[] = [];

  for (const words of lines) {
    const line = document.createElement('span');
    line.className = 'split__line';

    if (mode === 'lines') {
      // Cả dòng là một đơn vị — rẻ nhất và là mặc định.
      const unit = document.createElement('span');
      unit.className = 'split__unit';
      unit.textContent = words.join(' ');
      line.append(unit);
      units.push(unit);
      fragment.append(line);
      continue;
    }

    words.forEach((word, wordIndex) => {
      const isLast = wordIndex === words.length - 1;

      if (mode === 'chars') {
        // Giữ một wrapper nowrap cho mỗi từ, để ký tự không bao giờ ngắt giữa từ.
        const wordEl = document.createElement('span');
        wordEl.className = 'split__word';
        for (const char of word) {
          const unit = document.createElement('span');
          unit.className = 'split__unit';
          unit.textContent = char;
          wordEl.append(unit);
          units.push(unit);
        }
        line.append(wordEl);
        if (!isLast) line.append(document.createTextNode(' '));
      } else {
        const unit = document.createElement('span');
        unit.className = 'split__unit';
        // Khoảng trắng cuối đi kèm trong đơn vị (CSS đặt white-space: pre) để
        // các từ giữ được khoảng cách khi trở thành inline-block.
        unit.textContent = isLast ? word : `${word} `;
        line.append(unit);
        units.push(unit);
      }
    });

    fragment.append(line);
  }

  el.replaceChildren(fragment);
  return units;
}

function debounce<T extends (...a: never[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return wrapped;
}

export default defineEffect<Params>({
  key: 'text-split',
  name: 'Tách chữ theo dòng/từ/ký tự',
  paramsSchema,
  aiDescription:
    'Tiêu đề hiện lên từng dòng (hoặc từng từ, từng ký tự), trượt lên từ sau hộp dòng. Dùng cho tiêu đề lớn ở hero và đầu section.',
  runtimeCost: 'medium',
  statesWritten: ['split-ready'],
  appliesTo: ['Text'],

  init(el, params) {
    // Văn bản gốc, giữ để khôi phục lúc dispose và để tách lại khi resize.
    const originalText = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!originalText) return;

    let trigger: ScrollTrigger | null = null;
    let revealed = false;
    let disposed = false;

    const split = (): HTMLElement[] => {
      const words = originalText.split(' ');
      el.classList.add('split', `split--${params.mode}`);
      // Screen reader phải nghe cả câu, không phải 47 span rời rạc.
      el.setAttribute('aria-label', originalText);

      const probes = measurePass(el, words);
      const lines = groupIntoLines(probes, words);
      const units = buildPass(el, lines, params.mode);

      units.forEach((u) => u.setAttribute('aria-hidden', 'true'));
      el.dataset.splitReady = 'true';
      return units;
    };

    const animate = (units: HTMLElement[]) => {
      // Đã hiện rồi thì khôi phục trạng thái cuối, không phát lại.
      if (revealed) {
        gsap.set(units, { yPercent: 0 });
        return;
      }

      gsap.set(units, { yPercent: params.yPercent });

      trigger = ScrollTrigger.create({
        trigger: el,
        start: 'top 88%',
        once: true,
        onEnter: () => {
          gsap.to(units, {
            yPercent: 0,
            duration: params.duration,
            ease: params.ease,
            stagger: { each: params.stagger, from: 'start' },
            onStart: () => { revealed = true; },
          });
        },
      });
    };

    const rebuild = () => {
      trigger?.kill();
      trigger = null;
      const units = split();
      if (units.length) animate(units);
      ScrollTrigger.refresh();
    };

    let lastWidth = window.innerWidth;
    // Dòng chỉ đúng với bề rộng hiện tại, nên dựng lại khi bề rộng đổi. Bỏ qua
    // resize chỉ đổi chiều cao — trên mobile đó là thanh địa chỉ trượt, xảy ra
    // liên tục và không ảnh hưởng cách ngắt dòng.
    const onResize = debounce(() => {
      if (disposed || window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      rebuild();
    }, 220);

    const start = () => {
      if (disposed) return;
      const units = split();
      if (units.length) animate(units);
      window.addEventListener('resize', onResize);
      ScrollTrigger.refresh();
    };

    if (document.fonts && document.fonts.status !== 'loaded') {
      Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]).then(start, start);
    } else {
      start();
    }

    return () => {
      disposed = true;
      trigger?.kill();
      window.removeEventListener('resize', onResize);
      onResize.cancel();
      // Trả về đúng văn bản tác giả viết, không phải markup đã tách.
      el.textContent = originalText;
      el.classList.remove('split', 'split--lines', 'split--words', 'split--chars');
      el.removeAttribute('aria-label');
      delete el.dataset.splitReady;
    };
  },
});
