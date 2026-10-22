/**
 * Kiểm tra MCP server qua đúng đường mà Claude Desktop đi: spawn tiến trình,
 * nói chuyện bằng stdio, gọi tool thật.
 *
 * Chạy:  pnpm mcp:smoke
 *
 * Vì sao cần: gọi thẳng `/api/ai/tool` bằng curl không chứng minh được vỏ MCP
 * đúng. Ba thứ chỉ hỏng ở lớp này — bắt tay giao thức, hình dạng inputSchema mà
 * client chấp nhận, và việc log lỡ ghi ra stdout làm hỏng khung tin nhắn.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function mintToken() {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ['--env-file=.env', '--import', 'tsx', 'scripts/mint-service-token.ts'],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let out = '';
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.on('close', (code) => {
      const token = out.trim().split('\n')[0];
      if (code === 0 && token) resolve(token);
      else reject(new Error('Không cấp được token. Chạy `pnpm mcp:token` để xem lỗi.'));
    });
  });
}

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// Token có sẵn (stack e2e cấp trước, xem `scripts/e2e-stack.mjs proofs`) thì dùng luôn:
// môi trường đó không có `.env` để `mintToken` đọc.
const token = process.env.MM_BUILDER_TOKEN || (await mintToken());

// MM_SERVER_PATH để chạy smoke với một BẢN SAO ở thư mục trắng — cách duy nhất
// chứng minh file tải về chạy được mà không cần npm install.
const serverPath = process.env.MM_SERVER_PATH ?? path.join(here, 'server.mjs');
console.log(`server : ${serverPath}`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    ...process.env,
    MM_BUILDER_TOKEN: token,
    MM_BUILDER_URL: process.env.MM_BUILDER_URL ?? 'http://localhost:3001',
  },
});

const client = new Client({ name: 'mcp-smoke', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);
console.log('bắt tay: ok');

console.log('\ndanh mục tool');
const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
console.log(`  ${names.join(', ')}`);
check('có apply_ops', names.includes('apply_ops'));
check('có screenshot_page', names.includes('screenshot_page'));
check('có verify_page', names.includes('verify_page'));
check('có clone_url và compare_with_url (chạy tại chỗ)', names.includes('clone_url') && names.includes('compare_with_url'));
check('có create_clone_draft (bước ghi phía server)', names.includes('create_clone_draft'));

/*
 * Lời dặn và prompt: lấy từ builder lúc initialize, rơi về bản dự phòng khi không với tới.
 * Kiểm CẢ hai điều — có mục KHI CLONE và có prompt clone_website — vì thiếu một trong hai nghĩa
 * là Claude không được dẫn vào quy trình clone, mà không có lỗi nào báo ra.
 */
const instructions = client.getInstructions?.() ?? '';
check('instructions có mục KHI CLONE', instructions.includes('KHI CLONE'));
check('instructions vẫn nói không có tool publish', instructions.includes('Không có tool publish'));
const { prompts } = await client.listPrompts();
check('prompts/list có clone_website', prompts.some((p) => p.name === 'clone_website'));
const gotPrompt = await client.getPrompt({ name: 'clone_website', arguments: { url: 'https://example.com', slug: 'smoke-clone' } });
const promptText = gotPrompt.messages?.[0]?.content?.text ?? '';
check('prompts/get dựng được quy trình clone', promptText.includes('compare_with_url') && promptText.includes('clone_url'));
check('prompt bắt hỏi chủ site thư mục ảnh khi chưa có', /CHƯA CÓ — hỏi chủ site/.test(promptText));
check(
  'KHÔNG có tool publish',
  !names.some((n) => /publish|release|rollback/i.test(n)),
  'AI không được đưa thay đổi ra site thật',
);
check(
  'mọi tool có inputSchema kiểu object',
  tools.every((t) => t.inputSchema?.type === 'object'),
);
/**
 * Danh sách tool GHI, khai tường minh.
 *
 * Trước Đợt 2 phép kiểm này là "chỉ `apply_ops` được ghi". Đợt 2 cố ý phá nó — mục
 * tiêu của đợt là "mọi việc người dùng làm được trong builder, Agent làm được qua
 * MCP, trừ Publish".
 *
 * Nới thành "bỏ qua tool ghi" thì phép kiểm mất hết răng. Giữ nó có giá trị bằng
 * cách liệt kê ĐÍCH DANH: thêm một tool ghi mới buộc phải sửa dòng này, tức buộc
 * người thêm phải dừng lại một nhịp và nghĩ xem Agent có nên làm được việc đó không.
 *
 * Phép kiểm "KHÔNG có tool publish" ở trên vẫn là phép kiểm quan trọng nhất và
 * không bao giờ được nới.
 *
 * Từ 08/10/2026 danh sách ĐÍCH DANH đó là `writeTools` trong `contract.snapshot.json`,
 * không còn là một mảng viết tay ở đây. Mảng viết tay đã trôi: nó ghi 8 tool khi
 * registry có 13, nên smoke đỏ mà không ai biết vì không có gì chạy nó. Snapshot thì
 * `contract.test.ts` so với registry ở mỗi lần `pnpm test`, và thêm một tool ghi vẫn
 * buộc người thêm chạy `pnpm mcp:snapshot` — diff của nó là chỗ dừng lại để nghĩ.
 */
const snapshot = JSON.parse(
  readFileSync(path.join(here, 'contract.snapshot.json'), 'utf8'),
);
/*
 * `clone_url` chạy tại chỗ trong `server.mjs` (như screenshot_page) nên không nằm trong registry
 * của builder và không có trong snapshot — nhưng nó TẠO TRANG, nên là tool ghi và phải có tên ở
 * đây. Khai đích danh vì cùng lý do với danh sách trên: thêm một tool ghi mới phải buộc người
 * thêm dừng lại nghĩ xem Agent có nên làm được việc đó không.
 */
const LOCAL_WRITE_TOOLS = ['clone_url'];
const EXPECTED_WRITE_TOOLS = [...snapshot.writeTools, ...LOCAL_WRITE_TOOLS].sort();

const writeTools = tools
  .filter((t) => t.annotations?.readOnlyHint === false)
  .map((t) => t.name)
  .sort();

check(
  `đúng ${EXPECTED_WRITE_TOOLS.length} tool ghi, không hơn`,
  writeTools.join() === EXPECTED_WRITE_TOOLS.join(),
  `nhận: ${writeTools.join(', ')}`,
);

/** Tool trả JSON trong content[0].text. */
async function callJson(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.find((c) => c.type === 'text')?.text ?? '';
  return { res, json: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
}

console.log('\ntool đọc');
const { json: pages } = await callJson('list_pages', {});
check('list_pages trả về trang', Array.isArray(pages.pages) && pages.pages.length > 0);

const page = pages.pages?.[0];
if (page) {
  const { json: out } = await callJson('get_page_outline', { pageId: page.id });
  check('get_page_outline trả về node', Array.isArray(out.nodes) && out.nodes.length > 0);
  check(
    'dàn ý KHÔNG mang style',
    !JSON.stringify(out.nodes).includes('"style"'),
    'dàn ý mang style sẽ thổi bay ngân sách context',
  );

  const { json: tokens } = await callJson('search_tokens', { category: 'space', limit: 5 });
  check('search_tokens trả về token', tokens.tokens?.length > 0);

  /*
   * Hai tool đọc cho bề mặt sửa của bảng thuộc tính.
   *
   * Kiểm CỜ AN TOÀN chứ không chỉ kiểm "có trả về gì": giá trị của list_text_units
   * nằm ở chỗ nó nói đơn vị nào KHÔNG sửa được bằng chuỗi, và ghi bằng op nào. Thiếu
   * hai field đó thì Agent vẫn ghi được — nhưng ghi mù, và cái nó phá (href của link,
   * cây component) không báo lỗi.
   */
  const { json: units } = await callJson('list_text_units', { pageId: page.id, limit: 20 });
  check('list_text_units trả về đơn vị chữ', units.units?.length > 0);
  check(
    'mỗi đơn vị có khoá nodeId:field',
    units.units?.every((u) => typeof u.key === 'string' && u.key.includes(':')),
  );
  check(
    'mỗi đơn vị nói rõ flat và op để ghi',
    units.units?.every((u) => typeof u.flat === 'boolean' && typeof u.writeWith === 'string'),
    'thiếu flat/writeWith thì Agent ghi mù và san phẳng RichText có cấu trúc',
  );

  const firstNode = out.nodes?.[0]?.id;
  if (firstNode) {
    const { json: rs } = await callJson('resolve_style', { pageId: page.id, nodeId: firstNode });
    check('resolve_style trả về bản đồ lớp', !!rs.layers && 'base' in rs.layers);
    check(
      'mỗi ô nói rõ property CSS nó phát ra',
      Array.isArray(rs.fields) && rs.fields.every((f) => typeof f.cssProperty === 'string'),
      'không có cssProperty thì Agent phải đoán khi người dùng nói "đổi width"',
    );
  }
}

console.log('\ntool ghi — đường từ chối');
const bad = await client.callTool({
  name: 'apply_ops',
  arguments: {
    pageId: page.id,
    ops: [{ op: 'setStyle', nodeId: 'khong-ton-tai', target: 'base', patch: { spacing: { pt: { v: 8, u: 'px' } } } }],
  },
});
const badText = bad.content.find((c) => c.type === 'text')?.text ?? '';
check('op sai bị từ chối', badText.includes('missing-node') || badText.includes('"ok": false'), badText.slice(0, 120));

console.log('\ntool đọc collection');
const { json: types } = await callJson('list_collection_types', {});
check('list_collection_types trả về mảng types', Array.isArray(types.types));
check(
  'mỗi loại mang CẤU TRÚC FIELD, không chỉ tên',
  (types.types ?? []).every((t) => Array.isArray(t.fields)),
  'thiếu fields thì Agent phải đoán khoá field khi cấu hình khối lặp',
);

const firstType = types.types?.[0];
if (firstType) {
  const { json: entries } = await callJson('list_entries', { typeKey: firstType.key, limit: 5 });
  check('list_entries trả về tổng số và bộ đếm theo trạng thái', typeof entries.total === 'number' && !!entries.counts);

  const firstEntry = entries.entries?.[0];
  if (firstEntry) {
    const { json: entry } = await callJson('get_entry', { entryId: firstEntry.id });
    check('get_entry trả về data của entry', !!entry.data && entry.id === firstEntry.id);
    /*
     * Tool ĐỌC của builder thấy cả nháp, nên nó KHÔNG được chiếu qua bộ lọc của
     * API công khai — nhưng cũng vì vậy nó là chỗ dễ nhất để quên rằng hai bề mặt
     * có hai luật khác nhau. Kiểm rằng nó nói rõ trạng thái.
     */
    check('get_entry nói rõ trạng thái', typeof entry.status === 'string');
  }

  const { json: rep } = await callJson('resolve_repeat', {
    repeat: {
      source: { kind: 'query', query: { typeKey: firstType.key, limit: 5 } },
      map: {},
    },
  });
  check('resolve_repeat đếm được một RepeatSpec tối thiểu', typeof rep.matched === 'number', JSON.stringify(rep).slice(0, 160));
}

const { json: badRepeat } = await callJson('resolve_repeat', { repeat: { source: { kind: 'khong-co' } } });
check(
  'resolve_repeat từ chối RepeatSpec sai hình dạng',
  typeof badRepeat.error === 'string',
  'input khai lỏng (z.unknown) nên handler PHẢI là chỗ validate',
);

await client.close();

console.log(failures === 0 ? '\nTẤT CẢ ĐẠT' : `\n${failures} MỤC HỎNG`);
process.exit(failures === 0 ? 0 : 1);
