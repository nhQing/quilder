#!/usr/bin/env node

/**
 * MCP server cho Quilder.
 *
 * Claude Desktop chạy file này qua stdio. Mọi tool nó công bố đều lấy động từ
 * `GET /api/ai/tool` của builder, và mọi lời gọi đều chuyển tiếp tới
 * `POST /api/ai/tool`. Ngoại lệ là các tool chạy tại chỗ bằng Playwright vì trình duyệt
 * nằm ở máy này chứ không nằm trong server: `screenshot_page`, `verify_page`, và bộ clone
 * (`clone_url`, `compare_with_url`).
 *
 * Lời dặn (`instructions`) và prompt (`/clone_website`) cũng lấy từ builder lúc `initialize`
 * (`GET /api/ai/guide`); bản chép trong file này chỉ là phương án dự phòng.
 *
 * ## Vì sao KHÔNG PHỤ THUỘC GÌ, kể cả SDK của MCP
 *
 * File này được phục vụ ở /api/tokens/client cho người dùng tải về một thư mục
 * bất kỳ. Nếu nó `import '@modelcontextprotocol/sdk'` thì trên máy đó `node
 * server.mjs` chết ngay với MODULE_NOT_FOUND — và thứ người dùng nhìn thấy
 * trong Claude Desktop chỉ là "server disconnected", không manh mối.
 *
 * Nên phần giao thức được viết tay ở đây. Nó nhỏ: MCP qua stdio là JSON-RPC 2.0,
 * mỗi tin nhắn một dòng. Đổi lại, file này chạy được với `node` trần trên mọi
 * máy, không cần npm install.
 *
 * Rủi ro của việc tự cài đặt giao thức là trôi khỏi chuẩn. Chốt chặn:
 * `mcp/smoke.mjs` dùng CLIENT CHÍNH THỨC của SDK để nói chuyện với server này.
 * Sai chuẩn thì smoke hỏng.
 *
 * ## Vì sao không import thẳng từ src/
 *
 * Đi qua HTTP nghĩa là phép kiểm quyền, bốn tầng validator và AuditLog chỉ tồn
 * tại một bản duy nhất, bên trong Next. Import thẳng sẽ tạo ra một đường ghi thứ
 * hai vào database — và đường thứ hai bao giờ cũng là đường quên cập nhật.
 */

import { createInterface } from 'node:readline';

const BASE = (process.env.MM_BUILDER_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const TOKEN = process.env.MM_BUILDER_TOKEN ?? '';

/**
 * Tên server báo cho Claude lúc bắt tay — kèm host của builder, để nối nhiều builder
 * (dev, product, dự án khác) thì log và danh sách server phân biệt được từng cái. Tên
 * hiện trong Claude Desktop là KHOÁ trong `mcpServers`, do trang Kết nối Claude sinh theo
 * domain (`src/lib/builder/mcp-name.ts`).
 */
const SERVER_NAME = (() => {
  try {
    return `quilder@${new URL(BASE).host}`;
  } catch {
    return 'quilder';
  }
})();

/** stdout thuộc về giao thức. Mọi log của ta phải đi stderr. */
const log = (...args) => console.error('[quilder]', ...args);

if (!TOKEN) {
  log('THIẾU MM_BUILDER_TOKEN. Lấy token ở <builder>/builder/claude');
  process.exit(1);
}

/* ── Hợp đồng với builder ─────────────────────────────────────────────── */

/**
 * Phiên bản của CHÍNH file này, gửi lên trong header `x-mm-client`.
 *
 * File này nằm trên máy người dùng hàng tháng. Khi server đổi tới mức bản cũ không
 * còn chạy đúng, server tăng `MIN_MCP_CLIENT` (src/lib/ai/contract.ts) và trả lời bản
 * cũ bằng một câu bảo tải lại — thay vì để nó gọi theo hợp đồng cũ rồi hỏng khó hiểu.
 */
const CLIENT_VERSION = 3;

/**
 * Phiên bản bộ đồ nghề clone mà file này hiểu (`kitVersion` ở `GET /api/ai/clone-kit`).
 * Builder trả bản cao hơn nghĩa là hình dạng dữ liệu đã đổi theo cách file này không xử lý được:
 * dừng lại và bảo người dùng tải bản mới, thay vì chạy rồi tạo ra một trang hỏng.
 */
const KIT_VERSION_SUPPORTED = 1;

/**
 * Hash bộ tool mà Claude đang thấy. Server gắn hash hiện tại vào mọi response
 * (`x-mm-contract`). Lệch nghĩa là builder vừa deploy bộ tool mới: báo client MCP tải
 * lại danh mục (`notifications/tools/list_changed`), không cần khởi động lại Claude.
 */
let knownContract = null;

function noteContract(response) {
  const current = response.headers.get('x-mm-contract');
  if (!current) return;
  if (knownContract && knownContract !== current) {
    log(`bộ tool của builder đã đổi (${knownContract} → ${current}), báo client tải lại`);
    send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  }
  knownContract = current;
}

/* ── Gọi builder ──────────────────────────────────────────────────────── */

async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-mm-client': String(CLIENT_VERSION),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw new Error(`Không kết nối được builder ở ${BASE}. (${error.message})`);
  }
  noteContract(response);

  if (response.status === 426) {
    throw new Error(
      'Bản mcp/server.mjs trên máy này đã cũ so với builder. Tải bản mới ở ' +
        '<builder>/builder/claude rồi khởi động lại Claude.',
    );
  }

  if (response.status === 401) {
    throw new Error(
      'Token hết hạn hoặc đã bị thu hồi. Cấp token mới ở <builder>/builder/claude',
    );
  }
  if (response.status === 403) {
    throw new Error('Tài khoản gắn với token này không đủ quyền cho hành động đó.');
  }
  if (response.status === 429) {
    throw new Error(
      `Vượt trần tần suất. Chờ ${response.headers.get('retry-after') ?? 60} giây rồi thử lại.`,
    );
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /*
     * HTML thay vì JSON gần như luôn là SAI CỔNG, không phải builder hỏng.
     *
     * `next dev` nhảy sang 3001 khi 3000 đã có người, và in cổng thật ra
     * terminal — nhưng `MM_BUILDER_URL` mặc định vẫn là 3000. Khi ở 3000 có một
     * app Next khác, ta nhận đúng trang 404 của nó: một stack trace dài đầy
     * `_next/static` mà không hé một chữ nào về cổng.
     */
    const looksLikeHtml = text.trimStart().startsWith('<');
    const hint = looksLikeHtml
      ? ` Đây là HTML, không phải JSON — gần như chắc chắn ${BASE} là một app khác${
          response.status === 404 ? ' (route không tồn tại ở đó)' : ''
        }. Kiểm cổng builder đang in ra ở terminal rồi đặt MM_BUILDER_URL cho đúng.`
      : '';
    throw new Error(
      `Builder trả về thứ không phải JSON (HTTP ${response.status}).${hint} ${text.slice(0, 200)}`,
    );
  }
  if (!response.ok) throw new Error(json.error ?? `Builder trả HTTP ${response.status}`);
  return json;
}

/* ── Trình duyệt tại chỗ: screenshot_page và verify_page ─────────────── */

/**
 * Khổ màn của hai tool chạy tại chỗ, theo đúng `DEFAULT_SCREENS` của builder
 * (src/lib/design/breakpoints.ts): mỗi khổ rơi vào đúng lớp style mang tên nó.
 *
 * Trước 08/10/2026 bảng này còn là lưới cũ (md = 900, sm = 560). Từ khi mốc `sm`
 * lên 768 và `md` lên 1024, "chụp md" ra bố cục của `sm` và "chụp sm" ra bố cục
 * của `base` — model nhìn ảnh rồi sửa nhầm lớp, không lỗi nào báo ra.
 * `src/lib/builder/mcp-screens.test.ts` giữ hai bảng không lệch nhau nữa.
 */
const SCREEN_WIDTH = { xl: 1920, lg: 1440, md: 1024, sm: 768, base: 320 };

const SCREENSHOT_TOOL = {
  name: 'screenshot_page',
  title: 'Chụp ảnh trang',
  description:
    'Chụp ảnh bản nháp của một trang ở một kích thước màn hình, rồi trả về ảnh để ' +
    'bạn TỰ NHÌN kết quả mình vừa sửa.\n\n' +
    'Dùng sau apply_ops để kiểm tra thay đổi có ra đúng ý không, và trước khi sửa ' +
    'những thứ liên quan tới bố cục — mô tả bằng chữ không cho biết thứ gì đang ' +
    'tràn, đè hay lệch. Muốn soát cả năm khổ và so với bản đang chạy thì dùng verify_page.\n\n' +
    'Cần Playwright trên máy chạy MCP. Chưa có thì tool báo cách cài.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'Lấy từ list_pages.' },
      screen: {
        type: 'string',
        enum: ['xl', 'lg', 'md', 'sm', 'base'],
        default: 'lg',
        description:
          'xl = Desktop lớn 1920, lg = Desktop 1440, md = Tablet ngang 1024, sm = Tablet 768, base = Mobile 320. ' +
          'Mỗi khổ hiện đúng lớp style cùng tên.',
      },
      fullPage: { type: 'boolean', default: false, description: 'Chụp cả trang thay vì khung nhìn đầu.' },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
};

const VERIFY_TOOL = {
  name: 'verify_page',
  title: 'Soát bản nháp ở mọi khổ',
  description:
    'Soát BẢN NHÁP của một trang ở năm khổ màn (1920, 1440, 1024, 768, 320) và so nó với ' +
    'bản ĐANG CHẠY trên site.\n\n' +
    'Gọi sau một chuỗi sửa bố cục, TRƯỚC khi báo là xong. Mỗi khổ trả về: tỉ lệ pixel ' +
    'khác so với bản đang chạy, các vùng khác (toạ độ px), và các vấn đề bố cục kèm ' +
    'nodeId — tràn ngang, chồng lấn, khe hở ở mép. Kèm MỘT ảnh ghép nháp | đang chạy ở ' +
    'khổ khác nhiều nhất.\n\n' +
    'Khác biệt KHÔNG phải lỗi: nó là thứ bạn vừa sửa. Việc của bạn là xác nhận vùng ' +
    'khác đúng là vùng bạn định sửa, và không có vấn đề bố cục mới. Trang chưa publish ' +
    'lần nào thì chỉ soát bố cục.\n\n' +
    'Cần Playwright trên máy chạy MCP.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'Lấy từ list_pages.' },
      screens: {
        type: 'array',
        items: { type: 'string', enum: ['xl', 'lg', 'md', 'sm', 'base'] },
        description: 'Mặc định cả năm khổ.',
      },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
};

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    throw new Error(
      'Máy này chưa có Playwright nên không chụp ảnh được. Cài trong thư mục chứa ' +
        'server.mjs: `npm i playwright && npx playwright install chromium`. ' +
        'Các tool khác vẫn dùng bình thường.',
    );
  }
}

/**
 * Một context đã mang phiên, ở đúng bề rộng.
 *
 * Token service dùng được cả làm cookie phiên: nó CHÍNH LÀ cùng một JWT mà trình
 * duyệt mang. Nhờ vậy Playwright vào được /preview mà không cần một đường xác thực
 * riêng (middleware cho token service đọc /preview — src/lib/auth/service-scope.ts).
 */
async function sessionContext(browser, width, extra = {}) {
  const context = await browser.newContext({
    viewport: { width, height: Math.round(Math.max(width * 0.66, 568)) },
    deviceScaleFactor: 1,
    ...extra,
  });
  const { hostname } = new URL(BASE);
  await context.addCookies([
    { name: 'mm_session', value: TOKEN, domain: hostname, path: '/', httpOnly: true },
  ]);
  return context;
}

async function openPage(context, path) {
  const page = await context.newPage();
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
  if (response && response.status() >= 400) {
    throw new Error(`${path} trả HTTP ${response.status()}`);
  }
  if (page.url().includes('/builder/login')) {
    throw new Error('Token không mở được bản nháp — có thể đã bị thu hồi.');
  }
  // Cho scroll-reveal kịp chạy: chụp ngay sau networkidle thường ra một trang mà
  // mọi thứ còn ở trạng thái ẩn ban đầu.
  await page.waitForTimeout(600);
  return page;
}

async function screenshot(input) {
  const chromium = await loadChromium();
  const width = SCREEN_WIDTH[input.screen ?? 'lg'] ?? SCREEN_WIDTH.lg;
  const browser = await chromium.launch();
  try {
    const context = await sessionContext(browser, width);
    const page = await openPage(context, `/preview/${input.pageId}`);
    const buffer = await page.screenshot({ fullPage: Boolean(input.fullPage), type: 'png' });
    return buffer.toString('base64');
  } finally {
    await browser.close();
  }
}

/**
 * Toạ độ mọi node mang `data-n` — CHỈ ĐO, không đánh giá.
 *
 * Cùng phép đo với `scripts/check-layout.ts`. Phần đánh giá chạy ở server (tool
 * `analyze_layout` → `src/lib/builder/layout-checks.ts`), nên luật soát chỉ có một bản
 * và đã có test; file này không chép lại nó.
 */
function measure(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-n]')];
    return {
      viewport: document.documentElement.clientWidth,
      nodes: els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          nodeId: el.getAttribute('data-n'),
          parentId: el.parentElement?.closest('[data-n]')?.getAttribute('data-n') ?? null,
          rect: { top: r.top + window.scrollY, left: r.left, width: r.width, height: r.height },
          position: getComputedStyle(el).position,
          insideComposite: Boolean(el.parentElement?.closest('[data-composite]')),
        };
      }),
    };
  });
}

/**
 * So hai ảnh chụp, NGAY TRONG trình duyệt: canvas có sẵn, không cần thư viện diff nào
 * trên máy người dùng (file này chạy bằng `node` trần).
 *
 * Thu nhỏ một nửa trước khi so: trang dài 12.000px ở khổ 1920 là 92 triệu pixel, quá
 * nặng cho một canvas, trong khi khác biệt đáng nói đều lớn hơn 2px. So theo ô 32px
 * (CSS px), một ô "khác" khi hơn 2% pixel trong nó lệch rõ (tổng lệch RGB > 48). Các
 * ô khác liền hàng gộp thành vùng; trả tối đa 8 vùng lớn nhất, kèm một ảnh ghép
 * nháp | đang chạy quanh vùng lớn nhất.
 */
async function diffImages(browser, draftPng, livePng) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ a, b }) => {
        const load = (src) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = `data:image/png;base64,${src}`;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const SCALE = 0.5;
        const CELL = 16; // ô 16px ở tỉ lệ 0.5 = 32 CSS px
        const w = Math.round(Math.min(ia.width, ib.width) * SCALE);
        const h = Math.round(Math.min(ia.height, ib.height) * SCALE);
        const draw = (img) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, img.width * SCALE, img.height * SCALE);
          return ctx.getImageData(0, 0, w, h).data;
        };
        const da = draw(ia);
        const db = draw(ib);

        const cols = Math.ceil(w / CELL);
        const rows = Math.ceil(h / CELL);
        const changed = new Uint8Array(cols * rows);
        let changedPixels = 0;
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            let diff = 0;
            let total = 0;
            for (let y = cy * CELL; y < Math.min(h, (cy + 1) * CELL); y++) {
              for (let x = cx * CELL; x < Math.min(w, (cx + 1) * CELL); x++) {
                const i = (y * w + x) * 4;
                const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
                total++;
                if (d > 48) diff++;
              }
            }
            changedPixels += diff;
            if (diff / total > 0.02) changed[cy * cols + cx] = 1;
          }
        }

        // Gộp: mỗi dải hàng liên tiếp có ô khác thành một vùng, bề ngang từ ô trái nhất
        // tới ô phải nhất của dải. Thô, nhưng đủ để nói "phần hero" hay "chân trang".
        const regions = [];
        let band = null;
        for (let cy = 0; cy <= rows; cy++) {
          let minX = Infinity;
          let maxX = -1;
          if (cy < rows) {
            for (let cx = 0; cx < cols; cx++) {
              if (changed[cy * cols + cx]) {
                minX = Math.min(minX, cx);
                maxX = Math.max(maxX, cx);
              }
            }
          }
          if (maxX >= 0) {
            band = band
              ? { top: band.top, bottom: cy, minX: Math.min(band.minX, minX), maxX: Math.max(band.maxX, maxX) }
              : { top: cy, bottom: cy, minX, maxX };
          } else if (band) {
            regions.push(band);
            band = null;
          }
        }
        const px = (cells) => Math.round((cells * CELL) / SCALE);
        const out = regions
          .map((r) => ({
            top: px(r.top),
            left: px(r.minX),
            width: px(r.maxX - r.minX + 1),
            height: px(r.bottom - r.top + 1),
          }))
          .sort((x, y) => y.width * y.height - x.width * x.height)
          .slice(0, 8);

        // Ảnh ghép quanh vùng lớn nhất: nháp bên trái, đang chạy bên phải, mỗi bên
        // rộng tối đa 600px.
        let composite = null;
        if (out.length) {
          const r = out[0];
          const pad = 40;
          const sx = 0;
          const sw = Math.min(ia.width, ib.width);
          const sy = Math.max(0, r.top - pad);
          const sh = Math.min(r.height + pad * 2, 1400, Math.min(ia.height, ib.height) - sy);
          const k = Math.min(1, 600 / sw);
          const c = document.createElement('canvas');
          c.width = Math.round(sw * k) * 2 + 8;
          c.height = Math.round(sh * k);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#e11d48';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(ia, sx, sy, sw, sh, 0, 0, Math.round(sw * k), Math.round(sh * k));
          ctx.drawImage(ib, sx, sy, sw, sh, Math.round(sw * k) + 8, 0, Math.round(sw * k), Math.round(sh * k));
          // JPEG: ảnh ghép chỉ để NHÌN, và PNG của hai ảnh chụp trang là cả trăm KB.
          composite = c.toDataURL('image/jpeg', 0.82).split(',')[1];
        }

        return {
          diffRatio: Math.round((changedPixels / (w * h)) * 10000) / 10000,
          heightDelta: Math.round(ia.height - ib.height),
          regions: out,
          composite,
        };
      },
      { a: draftPng.toString('base64'), b: livePng.toString('base64') },
    );
  } finally {
    await page.close();
  }
}

async function toolResult(name, input) {
  const payload = await call('/api/ai/tool', { method: 'POST', body: JSON.stringify({ tool: name, input }) });
  if (payload?.ok === false) throw new Error(payload.error ?? `${name} thất bại`);
  return payload.result;
}

async function verifyPage(input) {
  const chromium = await loadChromium();
  const { pages } = await toolResult('list_pages', {});
  const meta = pages.find((p) => p.id === input.pageId);
  if (!meta) throw new Error(`Không có trang ${input.pageId}. Lấy id từ list_pages.`);

  const keys = input.screens?.length ? input.screens : Object.keys(SCREEN_WIDTH);
  const browser = await chromium.launch();
  const report = [];
  let worst = null;
  try {
    for (const key of keys) {
      const width = SCREEN_WIDTH[key];
      if (!width) continue;
      // Giảm chuyển động: effect hiện nội dung ngay, nên hai lần chụp so được với nhau
      // thay vì bắt hai khoảnh khắc khác nhau của cùng một animation.
      const context = await sessionContext(browser, width, { reducedMotion: 'reduce' });
      try {
        const draft = await openPage(context, `/preview/${input.pageId}`);
        const snapshot = await measure(draft);
        const draftPng = await draft.screenshot({ fullPage: true, type: 'png' });
        const { issues } = await toolResult('analyze_layout', snapshot);

        const entry = { screen: key, width, layoutIssues: issues.slice(0, 10), layoutIssueCount: issues.length };
        if (meta.published) {
          const live = await openPage(context, meta.path);
          const livePng = await live.screenshot({ fullPage: true, type: 'png' });
          const diff = await diffImages(browser, draftPng, livePng);
          Object.assign(entry, {
            diffRatio: diff.diffRatio,
            heightDelta: diff.heightDelta,
            changedRegions: diff.regions,
            ...(diff.heightDelta
              ? {
                  note:
                    `Bản nháp ${diff.heightDelta > 0 ? 'dài' : 'ngắn'} hơn ${Math.abs(diff.heightDelta)}px, nên mọi vùng ` +
                    'BÊN DƯỚI chỗ lệch đầu tiên đều hiện là khác dù nội dung không đổi. Vùng khác đầu tiên ' +
                    '(top nhỏ nhất) mới là chỗ cần nhìn.',
                }
              : {}),
          });
          if (diff.composite && (!worst || diff.diffRatio > worst.diffRatio)) {
            worst = { screen: key, diffRatio: diff.diffRatio, image: diff.composite };
          }
        }
        report.push(entry);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const content = [
    {
      type: 'text',
      text: JSON.stringify(
        {
          page: { id: meta.id, path: meta.path, published: meta.published },
          compared: meta.published ? 'bản nháp với bản đang chạy' : 'chưa publish — chỉ soát bố cục',
          screens: report,
          ...(worst ? { image: `ảnh ghép nháp | đang chạy ở khổ ${worst.screen}, quanh vùng khác lớn nhất` } : {}),
        },
        null,
        2,
      ),
    },
  ];
  if (worst) content.push({ type: 'image', data: worst.image, mimeType: 'image/jpeg' });
  return content;
}

/* ── Bộ clone: clone_url và compare_with_url ─────────────────────────── */

/**
 * ## Vì sao hai tool này chạy ở máy này
 *
 * Cùng lý lẽ với `screenshot_page`: việc cần trình duyệt thì làm ở nơi có trình duyệt. Nhưng PHẦN
 * NÃO — bảng token, khổ đo, mã trích chạy trong trang, luật so sánh — KHÔNG nằm trong file này: nó
 * được kéo từ `GET /api/ai/clone-kit` mỗi lần gọi. File này chỉ lái Playwright, tải và upload
 * asset, rồi chuyển kết quả cho server ghi (`create_clone_draft`). Nhờ vậy cải thiện converter chỉ
 * cần deploy builder; không ai phải tải lại file này.
 *
 * Mã lấy từ builder được chạy ở đây (trong trình duyệt và trong Node), nên nó được tin ở mức đúng
 * bằng chính file này: cả hai cùng đến từ builder mà người dùng đã cấp token.
 */

const CLONE_TOOL = {
  name: 'clone_url',
  title: 'Clone một trang web thành trang nháp',
  description:
    'Clone MỘT TRANG WEB THẬT thành trang nháp MỚI trong builder — bằng converter tất định, KHÔNG phải gõ tay từng node.\n\n' +
    'Cách làm: mở trang nguồn bằng trình duyệt ở 5 khổ (390 → 1560), cuộn qua cả trang để nội dung lazy-load và ' +
    'hiệu ứng vào chạy xong, chờ ổn định, đo style thật của từng phần tử, dựng cây node (token khớp chính xác ' +
    'mới dùng, còn lại là giá trị thật; khác biệt giữa các khổ thành override breakpoint), tải ảnh/video lên thư ' +
    'mục ảnh, rồi tạo trang nháp noindex.\n\n' +
    'BẮT BUỘC `folder`: thư mục ảnh do CHỦ SITE chọn. HỎI họ — không tự đặt tên. ' +
    'Chỉ tạo trang MỚI: slug đã có thì dừng, không ghi đè. Không publish. Trang luôn noindex.\n\n' +
    'Kết quả có `report` — danh sách phần KHÔNG clone được hoặc clone gần đúng (canvas/WebGL, iframe, hành vi JS ' +
    'chưa có trong builder, font không có, asset lỗi/quá 10 MB…). PHẢI kể lại đủ cho người dùng, không được lược. ' +
    'Xong thì dùng compare_with_url để so với trang thật và sửa chỗ lệch.\n\n' +
    'Cần Playwright trên máy chạy MCP. Mất khoảng 30–90 giây.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL trang cần clone (http/https).' },
      slug: {
        type: 'string',
        description: 'Đường dẫn của trang nháp MỚI (ví dụ "clone-demo"). Phải chưa tồn tại; không được là trang chủ.',
      },
      folder: {
        type: 'string',
        description:
          'Thư mục ảnh trong kho (ví dụ "clone/ten-site"), do chủ site chọn. BẮT BUỘC — hỏi chủ site, đừng tự đặt.',
      },
      title: { type: 'string', description: 'Tiêu đề trang nháp. Bỏ trống = lấy <title> của trang nguồn.' },
      settleSeconds: {
        type: 'number',
        minimum: 1,
        maximum: 15,
        default: 4,
        description: 'Số giây chờ hiệu ứng vào chạy xong sau khi cuộn (mặc định 4).',
      },
    },
    required: ['url', 'slug', 'folder'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
};

const COMPARE_TOOL = {
  name: 'compare_with_url',
  title: 'So bản nháp với trang tham chiếu',
  description:
    'ĐO bản nháp trong builder và trang tham chiếu (URL thật) ở cùng các khổ màn, rồi trả BẢNG LỆCH theo từng ' +
    'section: kích thước/vị trí hộp, font-size/weight/line-height/letter-spacing, màu, khe cách giữa phần tử — ' +
    'chỉ liệt kê dòng vượt ngưỡng, kèm nodeId của bản nháp để sửa đúng chỗ.\n\n' +
    'Mặc định 1440 và 390. Mỗi khổ: cuộn từng section vào khung nhìn, chờ hiệu ứng vào (~3–4 giây) rồi mới đo; ' +
    'đo phần tử MANG CHỮ TRỰC TIẾP và bỏ bản nhân đôi 0×0 (site hay có menu mobile/desktop ẩn).\n\n' +
    'Cách dùng: sửa ĐÚNG các dòng trong bảng bằng apply_ops (1440 ghi vào lớp lg, 390 vào lớp base), rồi gọi lại ' +
    'để đo lại. Dòng "THIẾU" nghĩa là phần tử có ở trang tham chiếu mà bản nháp không có. Section ở mục ' +
    '"không ghép được" thường là lỗi nặng hơn mọi con số lệch.\n\n' +
    'Cần Playwright trên máy chạy MCP.',
  inputSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: 'Trang nháp cần đo. Lấy từ list_pages hoặc kết quả clone_url.' },
      url: { type: 'string', description: 'URL trang tham chiếu (trang thật).' },
      viewports: {
        type: 'array',
        items: { type: 'number', minimum: 320, maximum: 2560 },
        description: 'Bề rộng các khổ cần đo. Mặc định [1440, 390].',
      },
      settleSeconds: {
        type: 'number',
        minimum: 1,
        maximum: 15,
        default: 3.5,
        description: 'Giây chờ hiệu ứng vào sau lần cuộn đầu (mặc định 3.5).',
      },
      tolerance: {
        type: 'object',
        description:
          'Ngưỡng lệch để báo. px (vị trí/kích thước, mặc định 4), font (px, 0.6), line (px, 1.5), tracking (px, 0.3), color (tổng chênh RGB, 12).',
        properties: {
          px: { type: 'number' },
          font: { type: 'number' },
          line: { type: 'number' },
          tracking: { type: 'number' },
          color: { type: 'number' },
        },
        additionalProperties: false,
      },
      maxRows: { type: 'number', minimum: 10, maximum: 300, default: 80, description: 'Số dòng lệch tối đa mỗi khổ.' },
    },
    required: ['pageId', 'url'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
};

/** Lớp style mà một bề rộng khổ ghi vào — theo `BREAKPOINT_PX` của builder (768/1024/1200/1560). */
function layerForWidth(width) {
  if (width >= 1560) return 'xl';
  if (width >= 1200) return 'lg';
  if (width >= 1024) return 'md';
  if (width >= 768) return 'sm';
  return 'base';
}

function parseHttpUrl(raw, what) {
  let u;
  try {
    u = new URL(String(raw ?? ''));
  } catch {
    throw new Error(`${what} không phải URL hợp lệ: ${String(raw ?? '').slice(0, 80)}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`${what} phải là http hoặc https.`);
  return u;
}

async function loadKit() {
  let kit;
  try {
    kit = await call('/api/ai/clone-kit');
  } catch (error) {
    // Builder cũ chưa có route này trả 404 (HTML) — nói thẳng nguyên nhân thay vì "không phải JSON".
    if (/HTTP 404|không phải JSON/.test(String(error.message))) {
      throw new Error(
        'Builder này chưa có bộ clone (chưa deploy bản mới có /api/ai/clone-kit). Deploy builder rồi thử lại.',
      );
    }
    throw error;
  }
  if (!kit || typeof kit.kitVersion !== 'number') {
    throw new Error('Builder không trả bộ đồ nghề clone. Builder này có thể chưa deploy bản có clone.');
  }
  if (kit.kitVersion > KIT_VERSION_SUPPORTED) {
    throw new Error(
      `Builder dùng bộ clone phiên bản ${kit.kitVersion}, file mcp/server.mjs này chỉ hiểu tới ` +
        `${KIT_VERSION_SUPPORTED}. Tải bản mới ở <builder>/builder/claude rồi khởi động lại Claude.`,
    );
  }
  return kit;
}

/** UA của Chrome thường — UA mặc định của Chromium headless có chữ "HeadlessChrome" và bị nhiều site chặn. */
async function pageUserAgent(browser) {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
}

/**
 * Cuộn qua cả trang theo từng bước 70% khung nhìn: kích hoạt lazy-load và scroll-reveal, và nhìn
 * thấy trang dài ra khi nội dung đổ thêm. Trần số bước để một trang cuộn vô hạn không treo mãi.
 */
async function sweepPage(page, { stepWaitMs = 260, maxSteps = 80 } = {}) {
  const vh = await page.evaluate(() => window.innerHeight);
  let y = 0;
  let steps = 0;
  let height = await page.evaluate(() => document.documentElement.scrollHeight);
  while (y < height && steps < maxSteps) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(stepWaitMs);
    y += Math.round(vh * 0.7);
    steps += 1;
    height = await page.evaluate(() => document.documentElement.scrollHeight);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  return { steps, capped: steps >= maxSteps && y < height, height };
}

/** Mở một trang, chờ tải xong tương đối (mạng có thể không bao giờ im: có trần). */
async function gotoSettled(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (response && response.status() >= 400) throw new Error(`${url} trả HTTP ${response.status()}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

const evalKit = (page, source) => page.evaluate(source);

/** Tải tối đa `max` byte; vượt thì HUỶ giữa chừng (không kéo hết một video 200 MB về rồi mới từ chối). */
async function downloadCapped(url, referer, max, userAgent) {
  const res = await fetch(url, {
    headers: { 'user-agent': userAgent, referer, accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return { error: `HTTP ${res.status}`, code: 'fetch' };
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) {
    return { error: `vượt ${Math.round(max / 1024 / 1024)} MB (${Math.round(declared / 1024 / 1024)} MB)`, code: 'too-large' };
  }
  const chunks = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { error: `vượt ${Math.round(max / 1024 / 1024)} MB`, code: 'too-large' };
    }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks) };
}

function assetFileName(ref, svgKey) {
  if (svgKey) return `icon-${svgKey}.svg`;
  try {
    const last = new URL(ref).pathname.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // data: URL — đặt tên theo nội dung bên dưới.
  }
  let h = 5381;
  for (let i = 0; i < ref.length; i += 1) h = ((h << 5) + h + ref.charCodeAt(i)) | 0;
  return `asset-${(h >>> 0).toString(36)}`;
}

/** Tải một asset về rồi đẩy lên kho. Trả `{ assetId }` hoặc `{ error, code }` — không bao giờ ném. */
async function transferAsset(ref, { svgs, referer, folder, maxBytes, userAgent }) {
  try {
    let bytes;
    let name;
    if (ref.startsWith('svg:')) {
      const key = ref.slice(4);
      if (!svgs[key]) return { error: 'SVG nội dòng không còn trong kết quả trích', code: 'unsupported' };
      bytes = Buffer.from(svgs[key], 'utf8');
      name = assetFileName(ref, key);
    } else if (ref.startsWith('data:')) {
      const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(ref);
      if (!m) return { error: 'data: URL sai định dạng', code: 'fetch' };
      bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
      if (bytes.length > maxBytes) return { error: `vượt ${Math.round(maxBytes / 1024 / 1024)} MB`, code: 'too-large' };
      name = assetFileName(ref);
    } else if (ref.startsWith('blob:')) {
      return { error: 'blob: URL không tải được từ ngoài trang', code: 'unsupported' };
    } else {
      const got = await downloadCapped(ref, referer, maxBytes, userAgent);
      if (got.error) return got;
      bytes = got.bytes;
      name = assetFileName(ref);
    }
    const { asset } = await uploadBuffer(bytes, name, folder);
    return { assetId: asset.id, ...(asset.reused ? { reused: true } : {}) };
  } catch (error) {
    return { error: String(error instanceof Error ? error.message : error).slice(0, 300), code: 'upload' };
  }
}

async function runPool(items, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await work(item);
      }
    }),
  );
}

/** Mọi nguồn asset mà cây thô tham chiếu — cùng luật với `collectAssetRefs` phía server. */
function collectRefs(nodes) {
  const refs = new Set();
  for (const n of Object.values(nodes)) {
    if (n.type === 'Image' && typeof n._src === 'string' && n._src) refs.add(n._src);
    if (n.type === 'Video') {
      if (typeof n._src === 'string' && n._src) refs.add(n._src);
      if (typeof n._posterSrc === 'string' && n._posterSrc) refs.add(n._posterSrc);
    }
    if (Array.isArray(n._bgSrc)) for (const u of n._bgSrc) if (typeof u === 'string') refs.add(u);
  }
  return [...refs];
}

async function cloneUrl(args) {
  const source = parseHttpUrl(args.url, 'url');
  const folder = typeof args.folder === 'string' ? args.folder.trim() : '';
  if (!folder) {
    throw new Error(
      'Thiếu `folder` (thư mục ảnh). HỎI chủ site muốn đặt ảnh của bản clone vào thư mục nào ' +
        '(ví dụ "clone/ten-site") rồi gọi lại — không được tự đặt tên.',
    );
  }
  const slug = String(args.slug ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!slug) throw new Error('Thiếu `slug`: đường dẫn của trang nháp MỚI (không được là trang chủ).');
  const settleMs = Math.round(Math.min(15, Math.max(1, Number(args.settleSeconds) || 4)) * 1000);

  const chromium = await loadChromium();
  const kit = await loadKit();

  // Kiểm sớm: slug đã có thì dừng TRƯỚC khi mất một phút mở trình duyệt. Server kiểm lại lần nữa khi ghi.
  const { pages } = await toolResult('list_pages', {});
  if (pages.some((p) => p.path === `/${slug}`)) {
    throw new Error(`Đường dẫn /${slug} đã có trang. Clone chỉ tạo trang MỚI, không ghi đè — chọn slug khác.`);
  }

  const browser = await chromium.launch();
  const localNotes = {};
  const note = (code, sample) => {
    const n = (localNotes[code] ??= { count: 0, samples: [] });
    n.count += 1;
    if (sample && n.samples.length < 6) n.samples.push(sample);
  };

  try {
    const userAgent = await pageUserAgent(browser);
    const context = await browser.newContext({
      viewport: { width: 390, height: 900 },
      bypassCSP: true,
      userAgent,
    });
    const page = await context.newPage();
    const blank = await context.newPage();

    log(`clone ${source.href}: mở trang…`);
    await gotoSettled(page, source.href);
    await evalKit(page, kit.extractorSource);
    await evalKit(blank, kit.extractorSource);

    const passes = [];
    let first = true;
    for (const vp of kit.viewports) {
      log(`clone: khổ ${vp.width} → lớp ${vp.layer}`);
      await page.setViewportSize({ width: vp.width, height: 900 });
      await blank.setViewportSize({ width: vp.width, height: 900 });
      await page.waitForTimeout(500);
      // Lần đầu cuộn chậm (lazy-load, hiệu ứng vào); các khổ sau trang đã tải/chạy xong nên cuộn nhanh.
      const sweep = await sweepPage(page, first ? {} : { stepWaitMs: 110 });
      if (sweep.capped) note('scroll-capped', `${sweep.steps} bước, trang cao ${sweep.height}px`);
      // Lần đầu chờ lâu (hiệu ứng vào chạy lần đầu); các khổ sau trang đã "ấm".
      await page.waitForTimeout(first ? settleMs : Math.min(settleMs, 1500));
      first = false;
      await page.evaluate(() => window.__mmClone.finishAnimations());

      const tables = await blank.evaluate((o) => window.__mmClone.tokenTables(o), {
        tokensCss: kit.tokensCss,
        tokenNames: kit.tokenNames,
        categories: kit.tokenCategories,
      });
      const result = await page.evaluate((o) => window.__mmClone.extract(o), {
        tables,
        layer: vp.layer,
        maxNodes: kit.maxNodes,
      });
      passes.push({ layer: vp.layer, result });
    }

    const extraction = await page.evaluate((p) => window.__mmClone.merge(p), passes);
    await context.close();

    /* ── Asset: tải về rồi đẩy lên thư mục chủ site đã chọn ── */
    const refs = collectRefs(extraction.nodes);
    const assets = {};
    log(`clone: ${Object.keys(extraction.nodes).length} node, ${refs.length} asset`);
    await runPool(refs, 4, async (ref) => {
      assets[ref] = await transferAsset(ref, {
        svgs: extraction.svgs,
        referer: source.href,
        folder,
        maxBytes: kit.maxAssetBytes,
        userAgent,
      });
    });

    // SVG đã thành asset: không gửi mã SVG lên nữa. Giàn giáo `_…` vẫn ở lại để server nối asset.
    const notes = { ...extraction.notes };
    for (const [code, v] of Object.entries(localNotes)) notes[code] = v;

    const input = {
      url: source.href,
      title: (args.title && String(args.title).trim()) || extraction.page.title || source.hostname,
      slug,
      folder,
      doc: { rootId: extraction.rootId, nodes: extraction.nodes },
      assets,
      notes,
      page: {
        title: extraction.page.title || undefined,
        description: extraction.page.description || undefined,
        lang: extraction.page.lang || undefined,
        ogImage: extraction.page.ogImage || undefined,
        url: extraction.page.url || undefined,
      },
    };
    const body = JSON.stringify({ tool: 'create_clone_draft', input });
    if (body.length > 14 * 1024 * 1024) {
      throw new Error(`Kết quả clone quá lớn (${Math.round(body.length / 1024 / 1024)} MB) để gửi lên builder.`);
    }

    const payload = await call('/api/ai/tool', { method: 'POST', body });
    if (payload?.ok === false) throw new Error(payload.error ?? 'create_clone_draft thất bại');
    const result = payload.result;
    if (result?.ok === false) {
      throw new Error(`${result.error}${result.issues?.length ? `
${result.issues.slice(0, 6).join('\n')}` : ''}`);
    }

    const failed = Object.values(assets).filter((a) => a.error).length;
    return {
      ...result,
      localSteps: {
        viewports: kit.viewports.map((v) => v.width),
        assetsUploaded: refs.length - failed,
        assetsFailed: failed,
      },
      next:
        'ĐỌC `report` và kể lại ĐỦ cho người dùng. Rồi gọi compare_with_url với pageId này và url nguồn để so ở 1440 và 390.',
    };
  } finally {
    await browser.close();
  }
}

/** Chọn phần tử gốc nội dung của trang nháp: node cấp cao nhất mang `data-n`. */
async function draftRootSelector(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-n]')].find((e) => !e.parentElement?.closest('[data-n]'));
    return el ? `[data-n="${el.getAttribute('data-n')}"]` : 'body';
  });
}

/** Đo một trang ở khổ hiện tại: cuộn từng section vào khung nhìn, chờ, đo. */
async function measurePage(page, kit, rootSelector, settleMs) {
  await evalKit(page, kit.extractorSource);
  await sweepPage(page);
  await page.waitForTimeout(settleMs);
  await page.evaluate(() => window.__mmClone.finishAnimations());
  const sel = rootSelector === 'auto' ? await draftRootSelector(page) : rootSelector;
  const info = await page.evaluate((s) => window.__mmClone.listSections(s), sel);
  if (!info.ok) throw new Error(info.error);
  const sections = [];
  const count = Math.min(info.count, 60);
  for (let i = 0; i < count; i += 1) {
    await page.evaluate((idx) => window.__mmClone.scrollToSection(idx), i);
    await page.waitForTimeout(450);
    await page.evaluate(() => window.__mmClone.finishAnimations());
    sections.push(await page.evaluate((idx) => window.__mmClone.measureSection(idx), i));
  }
  const docHeight = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
  const docWidth = await page.evaluate(() => Math.round(document.documentElement.scrollWidth));
  return { viewport: await page.evaluate(() => window.innerWidth), docHeight, docWidth, sections, truncated: info.count > count };
}

async function compareWithUrl(args) {
  const reference = parseHttpUrl(args.url, 'url');
  const chromium = await loadChromium();
  const kit = await loadKit();
  const { pages } = await toolResult('list_pages', {});
  const meta = pages.find((p) => p.id === args.pageId);
  if (!meta) throw new Error(`Không có trang ${args.pageId}. Lấy id từ list_pages hoặc kết quả clone_url.`);

  const widths = (Array.isArray(args.viewports) && args.viewports.length ? args.viewports : [1440, 390]).map(Number);
  const settleMs = Math.round(Math.min(15, Math.max(1, Number(args.settleSeconds) || 3.5)) * 1000);
  const compare = (0, eval)(kit.compareSource);

  const browser = await chromium.launch();
  const results = [];
  try {
    const userAgent = await pageUserAgent(browser);
    for (const width of widths) {
      log(`compare: khổ ${width}…`);
      const height = Math.round(Math.max(width * 0.66, 568));

      const refContext = await browser.newContext({ viewport: { width, height }, bypassCSP: true, userAgent });
      let refMeasure;
      try {
        const refPage = await refContext.newPage();
        await gotoSettled(refPage, reference.href);
        refMeasure = await measurePage(refPage, kit, 'body', settleMs);
      } finally {
        await refContext.close();
      }

      const draftContext = await sessionContext(browser, width);
      let draftMeasure;
      try {
        const draftPage = await openPage(draftContext, `/preview/${args.pageId}`);
        draftMeasure = await measurePage(draftPage, kit, 'auto', settleMs);
      } finally {
        await draftContext.close();
      }

      results.push({ width, refMeasure, draftMeasure, ...compare(refMeasure, draftMeasure, { tolerance: args.tolerance, maxRows: args.maxRows ?? 80 }) });
    }
  } finally {
    await browser.close();
  }

  const lines = [
    `So bản nháp ${meta.path ?? args.pageId} (${BASE}/preview/${args.pageId}) với ${reference.href}`,
    'Dòng "Lệch" = bản nháp − tham chiếu. Sửa đúng nodeId trong bảng; 1440 ghi vào lớp lg, 390 vào lớp base.',
  ];
  for (const r of results) {
    const s = r.summary;
    lines.push(
      '',
      `## Khổ ${r.width}px (lớp ${layerForWidth(r.width)})`,
      `Section: tham chiếu ${s.referenceSections}, bản nháp ${s.draftSections}, ghép được ${s.matchedSections}. ` +
        `Cao trang: ${s.pageHeight.reference}px → ${s.pageHeight.draft}px (${s.pageHeight.delta >= 0 ? '+' : ''}${s.pageHeight.delta}px). ` +
        `Rộng cuộn: ${s.pageWidth.reference}px → ${s.pageWidth.draft}px` +
        `${s.pageWidth.delta > 2 ? ' — bản nháp TRÀN NGANG' : ''}.`,
    );
    if (r.refMeasure.truncated || r.draftMeasure.truncated) lines.push('(Chỉ đo 60 section đầu.)');
    if (s.skippedOffscreen) {
      lines.push(`(Bỏ qua ${s.skippedOffscreen} phần tử nằm ngoài khung ngang — băng chuyền/marquee do JS cuộn, không so được.)`);
    }
    if (r.unmatched.missingInDraft.length) {
      lines.push('', 'Section có ở tham chiếu mà bản nháp KHÔNG có/khác hẳn:', ...r.unmatched.missingInDraft.map((x) => `- ${x}`));
    }
    if (r.unmatched.extraInDraft.length) {
      lines.push('', 'Section chỉ có ở bản nháp:', ...r.unmatched.extraInDraft.map((x) => `- ${x}`));
    }
    lines.push(
      '',
      s.rowsOverTolerance
        ? `${s.rowsOverTolerance} dòng vượt ngưỡng${s.rowsShown < s.rowsOverTolerance ? ` (hiện ${s.rowsShown} dòng lệch nặng nhất)` : ''}:`
        : 'Không có dòng nào vượt ngưỡng ở khổ này.',
      ...(s.rowsOverTolerance ? ['', r.table] : []),
    );
  }
  return lines.join('\n');
}

/* ── Giao thức MCP: JSON-RPC 2.0 qua stdio ────────────────────────────── */

/** Phiên bản giao thức ta biết. Client yêu cầu bản khác thì vẫn đáp bản của ta. */
const PROTOCOL_VERSION = '2024-11-05';
const SUPPORTED = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function listTools() {
  const { tools } = await call('/api/ai/tool');
  return {
    tools: [
      ...tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly },
      })),
      SCREENSHOT_TOOL,
      VERIFY_TOOL,
      CLONE_TOOL,
      COMPARE_TOOL,
    ],
  };
}

/**
 * Tải một ảnh từ ĐĨA MÁY NÀY lên builder.
 *
 * ## Vì sao xử lý tại chỗ thay vì chuyển tiếp như mọi tool khác
 *
 * Vì byte không được đi qua context của model. Một ảnh 400 KB mã hoá base64 là
 * ~530 KB văn bản, tức khoảng 130 nghìn token cho một lần chèn ảnh — không dùng
 * được, và tệ hơn là nó *gần như* dùng được với ảnh nhỏ nên lỗi chỉ lộ ra khi có
 * người tải ảnh thật.
 *
 * File này chạy trên máy người dùng, nên nó đọc file rồi POST multipart thẳng vào
 * `/api/assets`. Model chỉ thấy đường dẫn đi và metadata về.
 *
 * Cùng lý lẽ với `screenshot_page`: việc gì cần tài nguyên của máy này thì làm ở
 * máy này.
 */
async function uploadLocalFile(filePath, folder) {
  const { readFile } = await import('node:fs/promises');
  const { basename } = await import('node:path');

  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    throw new Error(`Không đọc được file ${filePath}. (${error.message})`);
  }
  return uploadBuffer(bytes, basename(filePath), folder);
}

/**
 * Đẩy MỘT khối byte đã có sẵn trong bộ nhớ lên `/api/assets`.
 *
 * Tách khỏi `uploadLocalFile` để `clone_url` dùng chung đúng đường này cho ảnh/video/SVG vừa tải
 * về — một đường upload thì một bản luật (`folder`, `x-mm-client`, báo lỗi), không phải hai.
 */
async function uploadBuffer(bytes, fileName, folder) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), fileName);

  /*
   * `folder` phải đi kèm, và đây là chỗ nó đã bị bỏ rơi cho tới 23/09/2026.
   *
   * Nhánh này không bao giờ đi qua `call()` — nó tự dựng multipart ngay tại đây (xem docblock
   * của `uploadLocalFile`) — nên tham số nào không được append tay là tham số biến mất. Hậu quả:
   * MỌI ảnh upload từ máy qua MCP đều rơi vào "Chưa phân loại", bất kể model gửi `folder` gì, và
   * không có lỗi nào báo ra. Triệu chứng là một kho ảnh phẳng mà ai cũng tưởng do mình quên khai.
   *
   * Chuỗi rỗng thì KHÔNG gửi: `/api/assets` phân biệt ba trạng thái và "rỗng" có nghĩa riêng của
   * nó (nhóm chưa phân loại). Không khai thì đừng gửi gì.
   */
  if (typeof folder === 'string' && folder) form.append('folder', folder);

  // KHÔNG dùng `call()`: nó đặt cứng `content-type: application/json`, và
  // multipart cần boundary do FormData tự sinh. Đặt tay là hỏng phần thân.
  const response = await fetch(`${BASE}/api/assets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'x-mm-client': String(CLIENT_VERSION) },
    body: form,
  });

  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // Không phải JSON thì dùng nguyên văn — thà thô còn hơn nuốt mất lý do.
    }
    throw new Error(`Tải ảnh thất bại (${response.status}): ${message}`);
  }
  return JSON.parse(text);
}

async function callTool(params) {
  const { name, arguments: args = {} } = params ?? {};

  if (name === 'upload_asset' && args.filePath) {
    const { asset } = await uploadLocalFile(args.filePath, args.folder);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ...asset,
              note:
                'Dùng assetId này trong op setProps để gắn ảnh vào một node Image. ' +
                'Ảnh chỉ lên site thật sau khi người dùng bấm Publish.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  if (name === 'clone_url') {
    return { content: [{ type: 'text', text: JSON.stringify(await cloneUrl(args), null, 2) }] };
  }

  if (name === 'compare_with_url') {
    return { content: [{ type: 'text', text: await compareWithUrl(args) }] };
  }

  if (name === 'verify_page') {
    return { content: await verifyPage(args) };
  }

  if (name === 'screenshot_page') {
    const data = await screenshot(args);
    return {
      content: [
        { type: 'image', data, mimeType: 'image/png' },
        {
          type: 'text',
          text: `Bản nháp trang ${args.pageId} ở màn ${args.screen ?? 'lg'} (${
            SCREEN_WIDTH[args.screen ?? 'lg']
          }px).`,
        },
      ],
    };
  }

  const payload = await call('/api/ai/tool', {
    method: 'POST',
    body: JSON.stringify({ tool: name, input: args }),
  });

  // Route tra ve {ok:false,error} kem HTTP 200 khi tool that bai. Neu cu doc
  // `result` thi JSON.stringify(undefined) ra undefined, content.text khong con
  // la string, va client bao loi schema — che mat ly do that su.
  if (payload?.ok === false || payload?.result === undefined) {
    const reason = payload?.error ?? 'Tool khong tra ve ket qua.';
    return {
      isError: true,
      content: [{ type: 'text', text: String(reason) }],
    };
  }

  return { content: [{ type: 'text', text: JSON.stringify(payload.result, null, 2) }] };
}

/**
 * Lời dặn cấp server — BẢN DỰ PHÒNG.
 *
 * Bản thật nằm ở builder (`src/lib/ai/guide.ts`) và được lấy lúc `initialize`: đổi câu chữ chỉ
 * cần deploy builder, không ai phải tải lại file này. Chuỗi dưới đây chỉ dùng khi builder không
 * với tới được lúc khởi động, hoặc là bản cũ chưa có `/api/ai/guide`. Nó là bản sao nguyên văn
 * của `INSTRUCTIONS` ở `guide.ts` tại thời điểm viết — có thể cũ hơn bản thật, và đó chấp nhận được
 * vì dự phòng chỉ cần ĐỦ DÙNG.
 *
 * ## Vì sao cần ô `instructions`, khi đã có `get_design_system`
 *
 * Quy ước của builder trước đây chỉ **kéo được**: agent phải nghĩ ra việc gọi
 * `get_design_system` mới biết luật. Ô `instructions` là kênh **đẩy**: client MCP
 * đưa chuỗi này cho model TRƯỚC khi nó gọi tool nào.
 */
const FALLBACK_INSTRUCTIONS = `Bạn đang nối vào Quilder (builder). Trang là cây node trong Postgres, không phải file code.

TRƯỚC KHI GHI, gọi hai tool này một lần mỗi phiên:
  get_design_system  — breakpoint, lớp style, luật viết style
  get_node_schema    — kiểu node, hình dạng style, và danh sách bẫy im lặng

COMPONENT LÀ ĐƠN VỊ MẶC ĐỊNH, KHÔNG PHẢI NGOẠI LỆ
1. Trước khi dựng bất cứ thứ gì: gọi list_components và tìm cái đã có. Dùng lại
   bằng node Instance.
2. Cần một biến thể? SỬA component đã có qua apply_component_ops và thêm tham số
   (slot/prop) cho phần khác nhau. Chỉ tạo component mới khi không cách nào tái
   dùng được cái đang có.
3. Component phải nhận tham số động để nhiều trang dùng chung một cây với nội
   dung và giao diện khác nhau. Một component chỉ chạy được ở đúng một trang là
   một component sai.
4. Áp cả cho thành phần NHỎ: text, button, field, image, thẻ, huy hiệu. Không rải
   node lẻ giống nhau ra nhiều trang.
5. Dựng trang = ghép Instance của component vào cấu trúc, không phải viết lại cây
   node từ đầu.

KHÔNG FIX CỨNG THỨ THUỘC CẤU HÌNH
Builder này chạy cho nhiều dự án, mỗi dự án một cấu hình. Tên công ty, hotline, số
giấy phép, link store, màu thương hiệu, ảnh mặc định: đọc bằng list_site_globals
rồi trỏ tới chúng bằng InlineNode bind (source:'site'). Đừng gõ giá trị thật vào
cây node — trang sẽ chỉ dùng được cho một dự án.
Màu, khoảng cách, cỡ chữ, bo góc, thời lượng: dùng {"$token":"..."}, không dùng
mã hex hay px.
SEO của từng trang nằm trên hàng Page (title, description, ogImageId, canonical,
noindex, jsonLd) — không nhét thẻ meta vào cây node.

KHI CLONE MỘT TRANG WEB
Dùng prompt /clone_website hoặc tool clone_url. KHÔNG dựng tay hàng trăm node bằng
apply_ops nhìn theo mắt: bố cục vỡ và phần bị thiếu không có lỗi nào báo ra.
1. Chuẩn so sánh là trang THẬT, đo bằng trình duyệt (compare_with_url) — không phải
   ảnh chụp, không phải HTML đọc bằng mắt, không phải bản chép trong repo.
2. clone_url BẮT BUỘC có \`folder\` (thư mục ảnh). HỎI chủ site muốn để ảnh ở đâu; không
   được tự đặt tên thư mục.
3. Chỉ tạo trang nháp MỚI, noindex. Không publish, không ghi đè trang có sẵn.
4. clone_url trả \`report\`: những gì KHÔNG clone được (canvas/WebGL, iframe, hành vi JS,
   font không có, asset lỗi…). Kể lại ĐỦ cho người dùng — không được lược.
5. Giá trị đo được không khớp token thì dùng giá trị thật; đừng ép về token "gần nhất".
6. Hành vi builder chưa có (carousel kéo, hiệu ứng cuộn, popup, logic form) → nói với
   người dùng. Không giả bằng CustomCode.
7. Header và footer tách thành component (Instance) để dùng chung nhiều trang.
8. Sau khi clone: compare_with_url ở 1440 và 390, sửa ĐÚNG các dòng lệch (bằng nodeId
   trong bảng), đo lại, lặp tới khi hết dòng hoặc hết việc sửa được.

LINK TỪ BUILDER
Nút "Copy link cho AI" trong editor chép một dòng dạng
  [Quilder] Trang chủ › Hero › Nút CTA — https://<host>/builder/<pageId>?node=<nodeId>
Khi tin nhắn của người dùng có link \`/builder/<id>?node=…\`: gọi open_builder_link NGAY, trước mọi
tool khác, rồi sửa ĐÚNG element đó theo \`howToEdit\` nó trả. Đừng hỏi người dùng element nằm ở đâu,
đừng tự find_nodes lại. Đối chiếu nhãn trong dòng với \`target\` — lệch thì nói, đừng sửa bừa.
Phần tử trong component: chữ/ảnh của riêng trang → setOverride; style/cấu trúc → apply_component_ops
và nó ĐỔI MỌI TRANG dùng component. Link mang locale → chữ qua set_translation.
Sau khi sửa, báo: đã đổi gì, và có ảnh hưởng trang khác không.

RANH GIỚI
Không emit <script>. Cần JS thì dùng node CustomCode (chạy trong iframe sandbox)
hoặc một effect đã có trong list_effects.
Không dựng chức năng app trên site marketing: không đăng nhập khách, không
dashboard, không upload giấy tờ, không giao dịch.
Node có \`locked\` là nội dung tuân thủ pháp lý — không sửa.
Bạn chỉ chạm BẢN NHÁP. Không có tool publish, và đó là chủ ý: đưa thay đổi ra site
thật là hành động của con người.`;

/** Prompt dự phòng — bản rút gọn của `clone_website` ở `guide.ts`, dùng khi không với tới builder. */
const FALLBACK_PROMPTS = [
  {
    name: 'clone_website',
    title: 'Clone một website thành trang nháp',
    description: 'Quy trình clone một trang web thật thành trang nháp MỚI (bản dự phòng, builder không với tới được).',
    arguments: [
      { name: 'url', description: 'URL trang cần clone.', required: true },
      { name: 'slug', description: 'Đường dẫn trang nháp mới.', required: true },
      { name: 'title', description: 'Tiêu đề trang nháp.', required: false },
      { name: 'folder', description: 'Thư mục ảnh do chủ site chọn.', required: false },
    ],
  },
];

function fallbackPromptText(args) {
  return [
    `Clone trang ${args.url ?? '(thiếu url)'} thành MỘT TRANG NHÁP MỚI /${args.slug ?? '(thiếu slug)'}.`,
    `Thư mục ảnh: ${args.folder?.trim() || '(CHƯA CÓ — HỎI chủ site trước khi chạy clone_url)'}`,
    '',
    'Nguyên tắc: chuẩn là trang THẬT đo bằng trình duyệt; KHÔNG dựng tay hàng trăm node bằng apply_ops (dùng clone_url);',
    'giá trị thật khi không khớp token, không ép token gần nhất; hành vi builder chưa có (carousel, hiệu ứng cuộn, popup,',
    'form, canvas, iframe) thì NÓI với người dùng, không giả bằng CustomCode; không publish; trang luôn mới và noindex.',
    '',
    'Quy trình: 1) get_design_system, list_components, list_asset_folders; hỏi chủ site thư mục ảnh nếu chưa có.',
    '2) clone_url { url, slug, title, folder }. 3) Đọc và kể lại ĐỦ `report` cho người dùng.',
    '4) compare_with_url ở 1440 và 390, sửa đúng các dòng lệch bằng apply_ops, đo lại.',
    '5) Tách header/footer thành component (Instance). 6) screenshot_page để nhìn lại. 7) Tổng kết bằng tiếng Việt.',
  ].join('\n');
}

/**
 * Lời dặn và prompt: lấy từ builder lúc `initialize`, rơi về bản chép ở trên khi không được.
 *
 * Trần 4 giây: `initialize` là thứ client đứng chờ — builder chậm thì ta không được làm cả phiên
 * treo vì một chuỗi chữ.
 */
let guideCache = null;

async function loadGuide() {
  if (guideCache?.source === 'builder') return guideCache;
  try {
    const g = await call('/api/ai/guide', { signal: AbortSignal.timeout(4000) });
    if (typeof g?.instructions === 'string' && Array.isArray(g.prompts)) {
      guideCache = { instructions: g.instructions, prompts: g.prompts, source: 'builder' };
      return guideCache;
    }
    log('builder trả lời không đúng hình dạng /api/ai/guide, dùng lời dặn dự phòng');
  } catch (error) {
    log(`không lấy được lời dặn từ builder (${error.message}), dùng bản dự phòng`);
  }
  guideCache ??= { instructions: FALLBACK_INSTRUCTIONS, prompts: FALLBACK_PROMPTS, source: 'embedded' };
  return guideCache;
}

async function getPrompt(params) {
  const { name, arguments: args = {} } = params ?? {};
  try {
    const r = await call('/api/ai/guide', { method: 'POST', body: JSON.stringify({ prompt: name, arguments: args }), signal: AbortSignal.timeout(8000) });
    return { description: r.description, text: r.text };
  } catch (error) {
    // Lỗi do người gọi (tên sai, thiếu tham số) khác lỗi mạng: chỉ lỗi mạng mới đáng rơi về bản dự phòng.
    if (!String(error.message).startsWith('Không kết nối được builder') && !/không phải JSON/.test(error.message)) throw error;
    const fallback = FALLBACK_PROMPTS.find((x) => x.name === name);
    if (!fallback) throw error;
    log('prompts/get: dùng bản dự phòng');
    return { description: fallback.description, text: fallbackPromptText(args) };
  }
}

async function handle(message) {
  const { id, method, params } = message;

  // Notification (không có id) thì không được đáp — đáp lại là sai giao thức.
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        const guide = await loadGuide();
        reply(id, {
          protocolVersion: SUPPORTED.has(asked) ? asked : PROTOCOL_VERSION,
          // listChanged: proxy báo khi builder deploy bộ tool mới — xem `noteContract`.
          // prompts: `/clone_website` và các quy trình khác — xem `loadGuide`.
          capabilities: { tools: { listChanged: true }, prompts: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: '0.4.0' },
          instructions: guide.instructions,
        });
        return;
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;

      case 'ping':
        reply(id, {});
        return;

      case 'tools/list':
        reply(id, await listTools());
        return;

      case 'prompts/list': {
        // Thử lại nếu lần đầu phải dùng bản dự phòng: builder có thể vừa lên.
        const guide = await loadGuide();
        reply(id, {
          prompts: guide.prompts.map((x) => ({
            name: x.name,
            title: x.title,
            description: x.description,
            arguments: x.arguments,
          })),
        });
        return;
      }

      case 'prompts/get': {
        try {
          const prompt = await getPrompt(params);
          reply(id, {
            description: prompt.description,
            messages: [{ role: 'user', content: { type: 'text', text: prompt.text } }],
          });
        } catch (error) {
          // -32602: tham số sai (tên prompt lạ, thiếu tham số bắt buộc) — lỗi của người gọi, không phải của server.
          replyError(id, -32602, error instanceof Error ? error.message : String(error));
        }
        return;
      }

      case 'tools/call': {
        try {
          reply(id, await callTool(params));
        } catch (error) {
          // Lỗi của TOOL trả về trong result kèm isError, không phải lỗi
          // JSON-RPC: model cần đọc được thông điệp để tự sửa, còn lỗi giao thức
          // thì cắt luôn lượt.
          reply(id, {
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true,
          });
        }
        return;
      }

      default:
        if (!isNotification) replyError(id, -32601, `Không hỗ trợ method: ${method}`);
    }
  } catch (error) {
    if (!isNotification) {
      replyError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;

  let message;
  try {
    message = JSON.parse(text);
  } catch {
    replyError(null, -32700, 'JSON không hợp lệ');
    return;
  }

  // Không await: nhiều lời gọi tool được phép chạy song song, và chờ tuần tự sẽ
  // biến một lần chụp ảnh 2 giây thành đứng hình cả phiên.
  void handle(message);
});

rl.on('close', () => process.exit(0));

log(`sẵn sàng — builder ở ${BASE}`);
