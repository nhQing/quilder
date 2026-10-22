/**
 * Soát bố cục một trang trên MỌI khổ màn hình.
 *
 * ## Vì sao thứ này tồn tại
 *
 * Ngày 17/08/2026 trang chủ có một dải đen 240px ở khổ hẹp. Nó không lộ ra ở bất
 * cứ cổng kiểm nào: HTML hợp lệ, CSS hợp lệ, 600 unit test xanh, `pnpm verify`
 * xanh. Tôi tìm ra bằng cách mở trang ở từng khổ rồi đo tay.
 *
 * Script này là đúng phép đo đó, viết lại thành thứ chạy được. Mẫu là Wix
 * Responsive Checker — công cụ tốt nhất trong sáu công cụ đã đối chiếu
 * (docs/BENCHMARK.md §1.6).
 *
 * ## Phân công: trình duyệt ĐO, Node PHÂN TÍCH
 *
 * `page.evaluate` dưới đây chỉ thu toạ độ — bốn dòng, không có logic để sai. Toàn
 * bộ phép đánh giá nằm ở `src/lib/builder/layout-checks.ts`, nơi nó có 15 test.
 *
 * Bản đầu làm ngược lại: đưa hàm đánh giá vào trình duyệt bằng
 * `Function.toString()`. Chuỗi ghép tay đó trôi khỏi mã thật ngay lần sửa đầu.
 *
 * ## Vì sao KHÔNG nằm trong `pnpm verify`
 *
 * Cần dev server đang chạy và mất vài chục giây. `verify` phải chạy được offline
 * trong vài giây, nếu không người ta sẽ ngừng chạy nó.
 *
 * ## Vì sao đo BẢN NHÁP
 *
 * Thứ sắp lên site là bản nháp. Soát bản đang chạy thì đã muộn.
 *
 * Chạy:
 *   pnpm check:layout                        # mọi trang
 *   pnpm check:layout gioi-thieu             # một trang
 *   pnpm check:layout "" http://localhost:3001
 */

import { chromium, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { checkLayout, type LayoutSnapshot } from '../src/lib/builder/layout-checks';
import { DEFAULT_SCREENS, breakpointForWidth } from '../src/lib/design/breakpoints';

const prisma = new PrismaClient();
const [slugArg, baseArg] = process.argv.slice(2);
const BASE = (baseArg ?? 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Đăng nhập và trả cookie phiên.
 *
 * `/preview/<id>` là màn của BUILDER nên nó sau `requireAuth` — không có phiên thì
 * nó trả 307 về trang đăng nhập.
 *
 * Bản đầu của script này bỏ qua bước đó, và hậu quả đáng ghi: nó đo được **0 node**
 * trên mọi trang, ở mọi khổ, rồi in "✓" cho tất cả. Một công cụ soát báo sạch trong
 * khi không đo gì là tệ hơn không có công cụ — nó tạo ra sự yên tâm sai.
 *
 * Đó cũng là lý do `main()` dưới đây NÉM khi snapshot rỗng.
 */
async function login(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: {
      email: process.env.BUILDER_EMAIL,
      password: process.env.BUILDER_PASSWORD,
    },
  });
  if (!res.ok()) throw new Error(`Đăng nhập thất bại: ${res.status()}`);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** Thu toạ độ mọi node mang `data-n`. Không có logic đánh giá nào ở đây. */
async function snapshot(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('[data-n]')];
    return {
      viewport: document.documentElement.clientWidth,
      nodes: els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          nodeId: el.getAttribute('data-n')!,
          parentId: el.parentElement?.closest('[data-n]')?.getAttribute('data-n') ?? null,
          rect: { top: r.top, left: r.left, width: r.width, height: r.height },
          position: getComputedStyle(el).position,
          // Có tổ tiên là composite không. `closest` từ CHA để chính node composite
          // vẫn được soát như một khối.
          insideComposite: Boolean(el.parentElement?.closest('[data-composite]')),
        };
      }),
    };
  });
}

async function main() {
  const pages = await prisma.page.findMany({
    where: {
      archivedAt: null,
      draftVersionId: { not: null },
      ...(slugArg ? { slug: slugArg } : {}),
    },
    orderBy: { slug: 'asc' },
    select: { id: true, slug: true, title: true },
  });

  if (!pages.length) {
    console.log(slugArg ? `Không có trang slug "${slugArg}".` : 'Không có trang nào.');
    return;
  }

  const browser = await chromium.launch();
  const storageState = await login(browser);
  let total = 0;

  for (const p of pages) {
    console.log(`\n/${p.slug} — ${p.title}`);

    for (const screen of DEFAULT_SCREENS) {
      const ctx = await browser.newContext({
        // Chiều cao THẬT của thiết bị, không phải 900 cho mọi khổ.
        //
        // Trang này dùng nhiều đơn vị viewport, nên chiều cao khung nhìn đổi cả bố
        // cục. Đo ở 900px cho khổ 320 là đo một thiết bị không tồn tại.
        //
        // Đo ngày 20/08/2026: đổi sang chiều cao thiết bị cho ra **đúng 14 phát hiện
        // như cũ** — nên đây là việc tăng độ trung thực, không phải sửa lỗi. Ghi lại
        // để người sau không tưởng con số thay đổi vì thay đổi này.
        viewport: { width: screen.width, height: screen.height },
        storageState,
      });
      const page = await ctx.newPage();

      // Bản NHÁP, không phải site đang chạy.
      await page.goto(`${BASE}/preview/${p.id}`, { waitUntil: 'networkidle', timeout: 60_000 });

      // Chờ ảnh về: một ảnh chưa tải xong chiếm 0px và làm mọi phép đo sai.
      await page
        .waitForFunction(() => [...document.images].every((i) => i.complete), undefined, {
          timeout: 20_000,
        })
        .catch(() => undefined);

      const snap = await snapshot(page);

      // Đo được 0 node nghĩa là trang không render (307 về đăng nhập, lỗi 500,
      // đổi tên thuộc tính…) — KHÔNG phải trang sạch. Ném thay vì in dấu tích.
      if (snap.nodes.length === 0) {
        throw new Error(
          `Không đo được node nào ở /preview/${p.id} (${screen.width}px). ` +
            `Trang không render, hoặc renderer đã ngừng phát data-n.`,
        );
      }

      const issues = checkLayout(snap);
      total += issues.length;

      // Nhãn là LỚP STYLE, không phải tên thiết bị: khổ màn giờ là con số tuỳ ý, còn
      // lớp style là thứ người đọc báo cáo cần để biết sửa ở đâu.
      const layer = breakpointForWidth(screen.width);
      const head = `  ${layer.padEnd(5)} ${String(screen.width).padStart(4)}px`;
      if (!issues.length) {
        console.log(`${head}  ✓`);
      } else {
        console.log(`${head}  ${issues.length} vấn đề`);
        // Cắt ở 5: một trang hỏng nặng sinh hàng trăm dòng, và năm dòng đầu đã đủ
        // biết chuyện gì xảy ra. Báo cáo dài hơn màn hình là báo cáo không ai đọc.
        for (const i of issues.slice(0, 5)) {
          console.log(`      ${i.kind.padEnd(12)} ${i.nodeId.padEnd(12)} ${i.detail}`);
        }
        if (issues.length > 5) console.log(`      … và ${issues.length - 5} nữa`);
      }

      await ctx.close();
    }
  }

  await browser.close();

  console.log(
    total === 0
      ? '\nKhông tìm thấy vấn đề bố cục nào.'
      : `\n${total} vấn đề. Mở node theo id trong builder để xem.`,
  );

  // KHÔNG đặt exit code khác 0. Đây là công cụ SOÁT, không phải cổng chặn: một dải
  // chạy hết màn hình có thể là cố ý, và làm CI đỏ vì nó là cách nhanh nhất khiến
  // người ta tắt công cụ này đi.
}

/*
 * ## Trạng thái ngày 20/08/2026: 7 báo cáo (từ 14), ba nhóm đều đã có kết luận
 *
 * Đo lại sau khi bộ khổ mặc định đổi sang 1920/1440/1024/768/320 (trước là
 * 1560/1200/900/560/390). Bộ mới cho **14**, bộ cũ cho **8** trên cùng bản nháp — đã
 * chạy cả hai để so, không suy đoán. Sửa nhóm 1 còn **10**, sửa nhóm 2 còn **7**.
 *
 * ### Nhóm 1 — `trust__*` tràn 50px ở khổ 320. ĐÃ SỬA 20/08/2026.
 *
 * `n0000037` (trust__lede), `n0000038` (trust__facts), `n0000039`
 * (trust__fact--licence) khai `width: 350px` ở lớp **base** — lớp mobile-first — nên
 * chúng tràn ở mọi khung hẹp hơn 350px cộng lề. `n0000041` là con, tràn theo.
 *
 * **Đây là giàn giáo migration, không phải thiết kế.** CSS gốc
 * (`new-website/css/layout/_trustbar.css`) khai `inline-size: 100%` cho
 * `.trust__lede` và `.trust__facts` ở khổ hẹp, và `inline-size: 100%` cho
 * `.trust__fact--licence` ở `≤639.98px`. `html-to-doc` ghi lại bề rộng **đo được** ở
 * viewport 390px — và 390 − 2×20px lề = đúng 350. Ba lớp còn lại cũng vậy: 810px ở
 * 900, 1080px ở 1200, 506.172px ở 1560.
 *
 * Bản sửa: `size.width` ở lớp base → `'full'`, đúng `inline-size: 100%` của site gốc.
 * Đo lại sau khi sửa:
 *
 *     320px  280px (vừa khung)   ← trước là 350, tràn
 *     390px  350px               ← KHÔNG đổi, đúng con số migration đã đo
 *     500px  460px               ← trước 350; giờ đúng `100%` như site gốc
 *     ≥560px không đổi           ← lớp sm/md/lg/xl không bị chạm
 *
 * Chỉ có bộ khổ CŨ mới không thấy nhóm này: khổ hẹp nhất của nó là 390px, và
 * 390 > 350. **Đó là giá trị cụ thể của việc đổi bộ khổ**, không phải con số 14 > 12.
 *
 * Cách tìm loại lỗi này ở nơi khác: một node có `width` bằng px ở lớp `base` gần như
 * luôn là giàn giáo migration. Lớp base áp cho MỌI màn hẹp, nên một con số px ở đó là
 * một lời khẳng định về mọi thiết bị.
 *
 * ### Nhóm 2 — `footer__store*` tràn 14–16px ở khổ 320. ĐÃ SỬA 20/08/2026.
 *
 * Khác nhóm 1: đây **không** phải giàn giáo migration. CSS gốc khai
 * `inline-size: calc(152 * var(--mm-foot-u))` với `--mm-foot-u: min(1px, 0.05208cqw)`,
 * NHƯNG `@media (max-width: 1200px)` ghim `--mm-foot-u: 1px` — nên ở khổ hẹp site gốc
 * cũng ra đúng 152px và **cũng tràn**. Migration sao chép trung thực một lỗi có thật,
 * nên sửa nó là một quyết định thiết kế (chủ dự án đã chốt: sửa).
 *
 * **Cần HAI thay đổi, và đây là chỗ dễ sai nhất.** Bản đầu chỉ đặt
 * `size.minWidth: 0` trên hai badge — và không có gì đổi cả, badge vẫn 152px. Lý do:
 *
 *   - cha `footer__brand-col` là flex **column** với `align-items: start`, nên con tự
 *     co về bề rộng NỘI DUNG (316px) và không bao giờ bị bó theo khung nhìn;
 *   - `flex-shrink` chỉ chạy khi container HẸP HƠN tổng các item — mà ở đây container
 *     rộng bằng đúng tổng đó, nên không có gì để co.
 *
 * Mảnh còn thiếu là `size.maxWidth: 100%` trên `footer__stores` (hàng chứa badge).
 * Có nó thì hàng bị bó theo cha, và lúc đó `minWidth: 0` mới có tác dụng.
 *
 * Đo sau khi sửa — badge chỉ co KHI CẦN, không co sớm:
 *
 *     320px  hàng 281px, badge 134×39   ← vừa khung, trang không cuộn ngang nữa
 *     360px  hàng 316px, badge 152×43   ← đã đủ chỗ, về đúng kích thước thiết kế
 *     ≥390px không đổi
 *
 * Áp cho CẢ doc trang và cây component Footer — hai bản sao độc lập.
 *
 * ### Nhóm 3 — `n0000057` chồng `n0000059`. KẾT LUẬN: dương tính giả.
 *
 * Đã xác minh ngày 20/08/2026 thay vì tiếp tục nghi:
 *
 *   - phần chồng nhau CAO ĐÚNG BẰNG chiều cao khung nhìn ở cả năm khổ
 *     (1920×1080, 1440×900, 1024×768, 768×1024, 320×568);
 *   - cả hai đều `position: relative`, `overflow: visible`;
 *   - cả hai đều là node `Composite` (s2 và s3 — hai section kể chuyện theo cuộn).
 *
 * Chồng đúng một màn ở mọi kích thước là thiết kế, không phải tai nạn: s3 được dựng để
 * trùm lên đuôi s2 đúng một màn.
 *
 * Bộ soát hiện bỏ qua *phần bên trong* composite (`insideComposite`) nhưng không bỏ qua
 * *chính* node composite. Sửa được bằng cách bỏ qua khi CẢ HAI node là composite —
 * nhưng làm vậy là mất khả năng bắt hai composite thật sự đặt sai chỗ. Cố ý để ngỏ cho
 * chủ dự án quyết, và cố ý KHÔNG chỉnh ngưỡng: chỉnh cho tới khi báo cáo trống là biến
 * công cụ soát thành công cụ trấn an.
 *
 * ### `n0000074` KHÔNG còn tái hiện — và lý do đáng ghi
 *
 * Bản ghi 19/08 nói `n0000074` tràn 248–252px ở khổ hẹp, "đáng xem trước nhất". Chạy
 * lại hôm nay: không thấy, ở CẢ bộ khổ mới lẫn bộ cũ.
 *
 * Vì con số 12 hôm đó được đo trong khoảng 06:38–08:44, tức đúng lúc trang chủ **đang
 * mất section hero** (12 node bị xoá, xem HANDOFF §3.35). Một baseline đo trên trang
 * hỏng thì không phải baseline. Bài học: khi ghi lại số phát hiện, ghi luôn bản nháp
 * nào đã được đo.
 */

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
