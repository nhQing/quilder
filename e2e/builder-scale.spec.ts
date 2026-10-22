import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * Vỏ builder ở ba khổ màn: 1440 · 1920 · 2500.
 *
 * ## Vì sao test này tồn tại
 *
 * `--shell-page-wide` từng là `96vw` KHÔNG TRẦN. Ở 1440 nó cho 1382px và không ai
 * thấy gì lạ; ở 2500 nó thành 2400px, tức một hàng bảng dài 2352px mà mắt phải đi
 * hết chiều ngang màn mới nối được cột đầu với cột cuối. Đó là loại lỗi không có
 * exception, không có log, và chỉ tồn tại trên MÀN của người dùng — nên chỗ duy
 * nhất bắt được nó là một test đổi bề rộng cửa sổ rồi ĐO.
 *
 * ## Trần là số cứng ở đây, có chủ đích
 *
 * Test không đọc `min(2200px, 96vw)` từ CSS rồi so với chính nó — làm vậy thì bỏ
 * trần đi test vẫn xanh, vì cả hai bên phép so đều đổi cùng nhau. Ba con số dưới
 * đây là HỢP ĐỒNG (`docs/BUILDER-UI-PROTO.html` §5); đổi trần trong CSS thì phải
 * đổi ở đây, và đó chính là chỗ để nghĩ lại một lần nữa.
 *
 * Phiên đến từ `storageState` (xem `playwright.config.ts` + `e2e/auth.setup.ts`),
 * nên ở đây chỉ `page.goto` — không tự đăng nhập.
 */

interface Kho {
  w: number;
  h: number;
  /** Cỡ chữ gốc mong đợi — một cần điều khiển duy nhất cho cả thang (C1). */
  font: number;
}

const KHO: Kho[] = [
  { w: 1440, h: 900, font: 16 },
  { w: 1920, h: 1080, font: 17 },
  { w: 2500, h: 1400, font: 18 },
];

/** Trần của từng mức, theo thứ tự khớp class: `-wide` và `-narrow` trước `page`. */
const TRAN: [tier: string, px: number][] = [
  ['shell-page-wide', 2200],
  ['shell-page-narrow', 900],
  ['shell-page', 1600],
];

function tranCua(tier: string): number {
  const found = TRAN.find(([name]) => name === tier);
  if (!found) throw new Error(`mức bề rộng lạ: ${tier}`);
  return found[1];
}

interface DoDuoc {
  fontSize: number;
  /** `scrollWidth - clientWidth` của trang. > 0 là đã tràn ngang. */
  overflow: number;
  tier: string | null;
  mainWidth: number;
  /** `max-width` ĐÃ TÍNH của `<main>` (px) — giá trị trần thật sự đang có hiệu lực. */
  mainMaxWidth: number;
  widest: { tag: string; cls: string; width: number } | null;
}

/**
 * Đo một trang vỏ builder.
 *
 * Bỏ qua hai loại phần tử, vì rộng hơn trần ở đó là ĐÚNG:
 *  - con của một vùng cuộn ngang (`overflow-x: auto` — bảng Văn bản dùng nó),
 *  - phần tử `position: fixed` (toast, popover) — chúng không thuộc cột nội dung.
 */
async function doTrang(page: Page): Promise<DoDuoc> {
  return page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement;
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const overflow = root.scrollWidth - root.clientWidth;
    const main = document.querySelector('main');
    if (!main) return { fontSize, overflow, tier: null, mainWidth: 0, mainMaxWidth: 0, widest: null };

    const tier =
      ['shell-page-wide', 'shell-page-narrow', 'shell-page'].find((c) =>
        main.classList.contains(c),
      ) ?? null;

    const trongVungCuon = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') {
          return true;
        }
      }
      return false;
    };

    let widest = { tag: '', cls: '', width: 0 };
    for (const el of Array.from(main.querySelectorAll('*'))) {
      const width = el.getBoundingClientRect().width;
      if (width <= widest.width) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      if (trongVungCuon(el)) continue;
      widest = {
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') ?? '').slice(0, 90),
        width,
      };
    }

    return {
      fontSize,
      overflow,
      tier,
      mainWidth: main.getBoundingClientRect().width,
      mainMaxWidth: parseFloat(getComputedStyle(main).maxWidth),
      widest,
    };
  });
}

async function chup(page: Page, info: TestInfo, ten: string): Promise<void> {
  await info.attach(ten, {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
}

/** Một loại nội dung không-singleton, để mở được route `-narrow` (Danh mục). */
async function typeKeyBatKy(page: Page): Promise<string | null> {
  const res = await page.request.get('/api/collections/types');
  if (!res.ok()) return null;
  const { types } = (await res.json()) as { types?: { key: string; singleton: boolean }[] };
  return types?.find((t) => !t.singleton)?.key ?? null;
}

test.describe('thang bề rộng của vỏ builder', () => {
  test('ba trang vỏ ở ba khổ: không tràn ngang, không vượt trần', async ({
    page,
  }, info) => {
    // Ba trang × ba khổ trong MỘT test (màn editor là test riêng bên dưới): mỗi
    // test mới phải chờ Next biên dịch lại route lần đầu, và chi phí đó không đáng
    // nhân lên cho một phép kiểm chỉ đọc.
    test.setTimeout(300_000);

    const typeKey = await typeKeyBatKy(page);

    // Ba VAI TRÒ, không phải ba trang bất kỳ — mỗi vai trò dùng một mức bề rộng
    // khác nhau, nên bỏ một vai trò là bỏ luôn một mức không còn ai canh.
    const trang: { route: string; vai: string }[] = [
      { route: '/builder/text', vai: 'bảng nhiều cột' },
      { route: '/builder/admin', vai: 'form' },
      ...(typeKey
        ? [{ route: `/builder/content/${typeKey}/taxonomies`, vai: 'đọc theo dòng' }]
        : []),
    ];

    for (const kho of KHO) {
      await page.setViewportSize({ width: kho.w, height: kho.h });

      for (const { route, vai } of trang) {
        await page.goto(route);
        await expect(page.locator('main')).toBeVisible();

        const d = await doTrang(page);
        await chup(page, info, `${kho.w}px ${route.replace(/\//g, '_')}.png`);

        const o = `${route} (${vai}) @ ${kho.w}px`;

        // Một cần điều khiển: 16 → 17 → 18px. Xoá một `@media` trong `builder.css`
        // là mọi chữ, padding và gap của vỏ đứng lại ở bậc dưới — không hỏng, chỉ
        // bé, tức không ai báo.
        expect(d.fontSize, `cỡ chữ gốc sai ở ${o}`).toBeCloseTo(kho.font, 1);

        // Tràn ngang: thanh cuộn ngang ở cấp TRANG nghĩa là có một khối vượt ra
        // ngoài khung, và ở vỏ builder thì thường là một bảng thiếu vùng cuộn riêng.
        expect(d.overflow, `trang tràn ngang ở ${o}`).toBeLessThanOrEqual(1);

        // Mất class bề rộng là trang thành full-bleed — vẫn "đẹp" ở 1440 nên lọt
        // qua mắt, và vỡ đúng ở khổ mà thang này tồn tại để lo.
        expect(d.tier, `main không còn mức bề rộng nào ở ${o}`).not.toBeNull();
        const tran = tranCua(d.tier!);

        expect(
          d.mainWidth,
          `${o}: main rộng ${Math.round(d.mainWidth)}px, vượt trần ${tran}px của ${d.tier}`,
        ).toBeLessThanOrEqual(tran + 1);

        expect(
          d.widest!.width,
          `${o}: <${d.widest!.tag} class="${d.widest!.cls}"> rộng ` +
            `${Math.round(d.widest!.width)}px, vượt trần ${tran}px`,
        ).toBeLessThanOrEqual(tran + 1);

        // Ở 2500 thì cả ba mức đều bị TRẦN chặn (94/96/92vw đều lớn hơn trần), nên
        // đây là phép kiểm duy nhất bắt được việc bỏ trần: `96vw` không trần cho
        // 2400px và chỉ dòng này đỏ.
        //
        // Đo `max-width` ĐÃ TÍNH chứ không đo bề rộng `main`: từ giao diện v2 thanh menu
        // nằm DỌC bên trái, nên khung nội dung ở 2500 chỉ còn ~2180px — hẹp hơn trần
        // 2200 của mức wide. `main` khi đó rộng bằng khung dù trần có hay không, và phép
        // so bề rộng không còn phân biệt được "trần đúng" với "vw thắng".
        if (kho.w === 2500) {
          expect(
            Math.round(d.mainMaxWidth),
            `${o}: trần ${d.tier} không có hiệu lực — vw đang thắng`,
          ).toBe(tran);
        }
      }
    }
  });

  test('màn editor ba pane giãn theo màn, và không tràn ngang', async ({ page }, info) => {
    test.setTimeout(180_000);

    const res = await page.request.post('/api/ai/tool', {
      data: { tool: 'list_pages', input: {} },
    });
    const pageId = (await res.json()).result?.pages?.[0]?.id as string | undefined;
    test.skip(!pageId, 'chưa seed trang nào');

    for (const kho of KHO) {
      await page.setViewportSize({ width: kho.w, height: kho.h });
      await page.goto(`/builder/${pageId}`);
      await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible({
        timeout: 60_000,
      });
      await chup(page, info, `${kho.w}px editor.png`);

      const d = await page.evaluate(() => {
        const root = document.scrollingElement as HTMLElement;
        // Lưới ba pane là phần tử duy nhất đặt `grid-template-columns` bằng style
        // inline (`EditorShell`/`ComponentEditorShell` ghép chuỗi từ ba biến shell).
        // Tìm theo dấu vết đó, không theo class: hai shell viết class khác nhau, và
        // giá trị đọc ra phải là px ĐÃ TÍNH chứ không phải chuỗi `var()`.
        const grid = Array.from(
          document.querySelectorAll<HTMLElement>('[style*="grid-template-columns"]'),
        ).find(
          (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length === 3,
        );
        const cols = grid
          ? getComputedStyle(grid)
              .gridTemplateColumns.split(' ')
              .map((v) => parseFloat(v))
          : null;
        return {
          overflow: root.scrollWidth - root.clientWidth,
          fontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
          cols,
        };
      });

      expect(d.fontSize, `cỡ chữ gốc sai ở editor @ ${kho.w}px`).toBeCloseTo(kho.font, 1);
      expect(d.overflow, `editor tràn ngang @ ${kho.w}px`).toBeLessThanOrEqual(1);

      expect(d.cols, `không tìm thấy lưới ba pane @ ${kho.w}px`).not.toBeNull();
      // `noUncheckedIndexedAccess` bật, nên đọc phần tử mảng ra `number | undefined`.
      // Kiểm độ dài rồi mới rút ra: một lưới ba pane mà chỉ có hai cột là lỗi thật,
      // và `!` sẽ giấu nó cho tới khi `toBeLessThanOrEqual(undefined)` báo một câu
      // không nói được gì.
      expect(d.cols!.length, `lưới ba pane có ${d.cols!.length} cột @ ${kho.w}px`).toBe(3);
      const [left, , right] = d.cols as [number, number, number];

      // Trần pane: 440 / 560. Chúng có trần vì pane nuốt canvas thì hỏng theo chiều
      // ngược lại — cây node rộng 700px không giúp gì cho việc dựng trang.
      const o = `@ ${kho.w}px`;
      expect(left, `pane trái ${Math.round(left)}px vượt trần 440px ${o}`).toBeLessThanOrEqual(
        441,
      );
      expect(right, `pane phải ${Math.round(right)}px vượt trần 560px ${o}`).toBeLessThanOrEqual(
        561,
      );

      if (kho.w === 2500) {
        // Trần cũ là 380/480. Ở 2500 thì `17vw`/`21vw` cho 425/525, tức hai con số
        // này chỉ đạt được khi trần ĐÃ được nới — đây là phép kiểm của bước C1.
        expect(left, 'pane trái vẫn bị trần cũ 380px chặn @ 2500px').toBeGreaterThan(400);
        expect(right, 'pane phải vẫn bị trần cũ 480px chặn @ 2500px').toBeGreaterThan(500);
      }
    }
  });
});
