<!-- SINH TỰ ĐỘNG bởi scripts/gen-docs.ts từ src/lib/motion/effects (EFFECT_REGISTRY + manifest của từng effect). Đừng sửa tay: chạy `pnpm docs:gen`. -->

# Effect (23)

| Key | Gắn vào | Chi phí | Xung đột | State ghi ra | Params |
|---|---|---|---|---|---|
| `app-link` | `Button` | light | — | — | `ios`, `android` |
| `carousel` | — | light | `slider`, `marquee` | `carousel-ready` | `autoplayMs?`, `loop?` |
| `counter` | `Text` | light | — | — | `to`, `from?`, `duration?`, `decimals?`, `suffix?`, `prefix?` |
| `cursor` | — | light | — | — | `hoverSelector?`, `trail?` |
| `drag-scroll` | — | light | — | `dragging` | `trackPart?`, `itemPart?`, `momentum?`, `snap?` |
| `filter` | — | light | — | `filter-active`, `filter-inactive` | `param?`, `optionPart?`, `itemPart?`, `valuePart?` |
| `image-sequence` | `Section` | heavy | `rail-pin` | `seq-ready` | `frames`, `framesNarrow?`, `narrowBelow?`, `framesSuper?`, `superMinPx?`, `folder?`, `span?`, `tail?`, `pinPart?`, `framePart?` |
| `magnetic` | — | light | `tilt` | `magnetic-active` | `strength?`, `radius?` |
| `marquee` | — | medium | `slider`, `carousel` | `marquee-ready` | `speed?`, `direction?`, `reverseOnScroll?`, `velocityBoost?` |
| `menu-toggle` | `Section` | light | — | `menu-open`, `menu-sub-open` | `triggerPart?`, `panelPart?`, `closeOnNavigate?`, `closePart?`, `subTogglePart?`, `subPanelPart?`, `subExclusive?`, `closeFrom?` |
| `modal` | `Section` | light | — | `modal-open`, `modal-visible`, `modal-swapping`, `modal-panel` | `panelPart?`, `closePart?`, `scrimPart?`, `bodyPart?`, `headerSelector?`, `swapMs?`, `fadeMs?` |
| `nav-collapse` | `Section` | light | — | `collapsed` | `collapseAt?`, `hysteresis?` |
| `nav-invert` | `Section` | light | — | `inverted` | `markerSelector?` |
| `paginate` | — | light | — | `page-active`, `page-inactive`, `page-gap`, `page-disabled` | `pageSize?`, `param?`, `itemPart?`, `siblings?`, `scrollToTop?` |
| `parallax` | — | medium | `scrub-timeline` | — | `speed?`, `overscaleFactor?`, `scrub?` |
| `rail-pin` | `Section` | medium | `image-sequence` | `rail-pin-ready` | `pinPart?`, `viewportPart?`, `tail?` |
| `scroll-reveal` | — | light | — | `revealed` | `stagger?`, `delay?`, `rootMargin?`, `once?` |
| `share-link` | `Button` | light | — | `share-copied` | `copiedMs?`, `network?` |
| `show-more` | — | light | — | `more-open` | `togglePart?`, `panelPart?`, `labelOpen?` |
| `slider` | — | medium | `marquee`, `carousel` | `slider-ready`, `slider-begin`, `slider-end` | `preset?`, `slidesPerView?`, `spaceBetween?`, `centeredSlides?`, `grabCursor?`, `autoplay?`, `pauseOnHover?`, `disableOnInteraction?`, `reverseDirection?`, `direction?`, `breakpoints?`, `a11yLabel?`, `loop?`, `freeMode?`, `speedMs?`, `autoplayDelayMs?` |
| `steps` | — | light | — | `step-active`, `step-inactive` | `stepPart?`, `mediaPart?`, `initial?` |
| `tilt` | — | light | `magnetic` | `tilt-active` | `max?`, `smoothingHover?`, `smoothingRest?` |
| `video-lazy` | `Video` | medium | — | `playing`, `video-lazy-ready` | `minWidth?` |
