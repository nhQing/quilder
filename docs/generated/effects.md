<!-- SINH TỰ ĐỘNG bởi scripts/gen-docs.ts từ src/lib/motion/effects (EFFECT_REGISTRY + manifest của từng effect). Đừng sửa tay: chạy `pnpm docs:gen`. -->

# Effect (19)

| Key | Gắn vào | Chi phí | Xung đột | State ghi ra | Params |
|---|---|---|---|---|---|
| `app-link` | `Button` | light | — | — | `ios`, `android` |
| `carousel` | — | light | `slider`, `marquee` | `carousel-ready` | `autoplayMs?`, `loop?` |
| `counter` | `Text` | light | — | — | `to`, `from?`, `duration?`, `decimals?`, `suffix?`, `prefix?` |
| `cursor` | — | light | — | — | `hoverSelector?`, `trail?` |
| `drag-scroll` | — | light | — | `dragging` | `trackPart?`, `itemPart?`, `momentum?`, `snap?` |
| `image-sequence` | `Section` | heavy | `rail-pin` | `seq-ready` | `frames`, `framesNarrow?`, `narrowBelow?`, `framesSuper?`, `superMinPx?`, `folder?`, `span?`, `tail?`, `pinPart?`, `framePart?` |
| `magnetic` | — | light | `tilt` | `magnetic-active` | `strength?`, `radius?` |
| `marquee` | — | medium | `slider`, `carousel` | `marquee-ready` | `speed?`, `direction?`, `reverseOnScroll?`, `velocityBoost?` |
| `menu-toggle` | `Section` | light | — | `menu-open`, `menu-sub-open` | `triggerPart?`, `panelPart?`, `closeOnNavigate?`, `closePart?`, `subTogglePart?`, `closeFrom?` |
| `modal` | `Section` | light | — | `modal-open`, `modal-visible`, `modal-swapping`, `modal-panel` | `panelPart?`, `closePart?`, `scrimPart?`, `bodyPart?`, `headerSelector?`, `swapMs?`, `fadeMs?` |
| `nav-collapse` | `Section` | light | — | `collapsed` | `collapseAt?`, `hysteresis?` |
| `nav-invert` | `Section` | light | — | `inverted` | `markerSelector?` |
| `parallax` | — | medium | `scrub-timeline` | — | `speed?`, `overscaleFactor?`, `scrub?` |
| `rail-pin` | `Section` | medium | `image-sequence` | `rail-pin-ready` | `pinPart?`, `viewportPart?`, `tail?` |
| `scroll-reveal` | — | light | — | `revealed` | `stagger?`, `delay?`, `rootMargin?`, `once?` |
| `show-more` | — | light | — | `more-open` | `togglePart?`, `panelPart?`, `labelOpen?` |
| `slider` | — | medium | `marquee`, `carousel` | `slider-ready`, `slider-begin`, `slider-end` | `preset?`, `slidesPerView?`, `spaceBetween?`, `centeredSlides?`, `grabCursor?`, `autoplay?`, `pauseOnHover?`, `disableOnInteraction?`, `reverseDirection?`, `direction?`, `breakpoints?`, `a11yLabel?`, `loop?`, `freeMode?`, `speedMs?`, `autoplayDelayMs?` |
| `tilt` | — | light | `magnetic` | `tilt-active` | `max?`, `smoothingHover?`, `smoothingRest?` |
| `video-lazy` | `Video` | medium | — | `playing`, `video-lazy-ready` | `minWidth?` |
