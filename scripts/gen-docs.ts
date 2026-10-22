/**
 * Sinh tài liệu từ registry trong code: node type, op, tool AI, loại field, effect.
 *
 *   pnpm docs:gen      # ghi docs/generated/*.md và điền các vùng <!-- gen:… --> trong README
 *   pnpm docs:check    # như trên rồi `git diff --exit-code` — CI dùng lệnh này
 *
 * ## Vì sao tồn tại
 *
 * Đối chiếu với Webstudio ngày 07/10/2026 tìm ra 8 chỗ tài liệu nói một đằng, code
 * làm một nẻo: README ghi "9 primitive + Composite" khi đã có 11 node type, HANDOFF
 * ghi 24 tool khi đã có khoảng 37, API-PUBLIC ghi 16 loại field khi đã có 17 (và
 * thiếu hẳn mô tả của `html`). Không ai sai lúc viết — con số chỉ cũ đi.
 * Webstudio chặn đúng loại lỗi này bằng `scripts/docs/generate-mcp-docs.ts` cộng một
 * bước CI: tài liệu lệch là CI đỏ.
 *
 * ## Luật
 *
 * - File trong `docs/generated/` là ĐẦU RA. Sửa tay sẽ bị ghi đè; sửa nguồn trong code.
 * - Con số trong tài liệu viết tay thì đặt trong vùng đánh dấu, ví dụ
 *   `<!-- gen:op-count -->15<!-- /gen -->`, để script này điền.
 * - HANDOFF là nhật ký: con số trong một mục là số liệu LÚC VIẾT mục đó, nên script
 *   không viết lại nó. Đầu HANDOFF trỏ về đây cho số liệu hiện hành.
 *
 * Chạy với `--conditions=react-server` vì registry tool import `server-only`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { TOOLS } from '../src/lib/ai/tools';
import { toolInputSchema } from '../src/lib/ai/json-schema';
import { FIELD_TYPES } from '../src/lib/collections/field-def';
import { LEAF_TYPE_SET, NODE_TYPE_LIST, propsKeysFor, zOp } from '../src/lib/doc/schema';
import { EFFECT_REGISTRY, loadEffect } from '../src/lib/motion/effects/registry';

const OUT_DIR = 'docs/generated';
const HEADER = (source: string) =>
  `<!-- SINH TỰ ĐỘNG bởi scripts/gen-docs.ts từ ${source}. Đừng sửa tay: chạy \`pnpm docs:gen\`. -->\n\n`;

/** Bỏ các lớp bọc (effects, optional, default…) để đọc được shape của object. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema;
  for (;;) {
    if (s instanceof z.ZodEffects) s = s.innerType();
    else if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap();
    else if (s instanceof z.ZodDefault) s = s._def.innerType;
    else if (s instanceof z.ZodLazy) s = s.schema;
    else return s;
  }
}

function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/* ── node type ─────────────────────────────────────────────────────────── */

function nodeTypes(): { md: string; count: number; primitives: string[]; others: string[] } {
  const types = [...NODE_TYPE_LIST];
  const special = new Set(['Composite', 'Instance']);
  const primitives = types.filter((t) => !special.has(t));
  const others = types.filter((t) => special.has(t));

  let md = HEADER('src/lib/doc/schema.ts (NODE_TYPE_LIST, zPropsFor)');
  md += `# Node type (${types.length})\n\n`;
  md += `${primitives.length} primitive, cộng ${others.map((t) => `\`${t}\``).join(' và ')}. `;
  md += 'Bộ này **đóng băng** (README, mục "Bộ node type bị đóng băng").\n\n';
  md += '| Type | Lá (không có con) | Props riêng |\n|---|---|---|\n';
  for (const type of types) {
    const props = propsKeysFor(type);
    md += `| \`${type}\` | ${LEAF_TYPE_SET.has(type) ? 'có' : '—'} | ${
      props.length ? props.map((p) => `\`${p}\``).join(', ') : '—'
    } |\n`;
  }
  return { md, count: types.length, primitives, others };
}

/* ── op ────────────────────────────────────────────────────────────────── */

function ops(): { md: string; count: number } {
  const options = (zOp as unknown as { options: z.ZodTypeAny[] }).options;
  let md = HEADER('src/lib/doc/schema.ts (zOp)');
  md += `# Op (${options.length})\n\n`;
  md += 'Mọi thay đổi doc — từ inspector, undo, AI — là một batch các op này, đi qua `validateOps` 4 tầng.\n\n';
  md += '| Op | Trường |\n|---|---|\n';
  for (const option of options) {
    const shape = (unwrap(option) as z.ZodObject<z.ZodRawShape>).shape;
    const name = (shape.op as z.ZodLiteral<string>).value;
    const fields = Object.keys(shape)
      .filter((k) => k !== 'op')
      .map((k) => (shape[k]!.isOptional() ? `\`${k}?\`` : `\`${k}\``));
    md += `| \`${name}\` | ${fields.join(', ') || '—'} |\n`;
  }
  return { md, count: options.length };
}

/* ── tool AI ───────────────────────────────────────────────────────────── */

function tools(): { md: string; count: number; writes: number } {
  const writes = TOOLS.filter((t) => !t.readOnly);
  let md = HEADER('src/lib/ai/tools.ts (TOOLS)');
  md += `# Tool AI (${TOOLS.length}, trong đó ${writes.length} tool ghi)\n\n`;
  md += 'Phục vụ qua `GET/POST /api/ai/tool`; `mcp/server.mjs` thêm `screenshot_page` chạy tại chỗ. ';
  md += '**Không có tool publish, rollback hay xoá** — e2e/mcp.spec.ts khoá điều đó.\n\n';
  md += '| Tool | Loại | Tham số | Mô tả |\n|---|---|---|---|\n';
  for (const tool of TOOLS) {
    const schema = toolInputSchema(tool) as { properties?: Record<string, unknown>; required?: string[] };
    const required = new Set(schema.required ?? []);
    const params = Object.keys(schema.properties ?? {}).map((k) => (required.has(k) ? `\`${k}\`` : `\`${k}?\``));
    md += `| \`${tool.name}\` | ${tool.readOnly ? 'đọc' : '**ghi**'} | ${params.join(', ') || '—'} | ${cell(
      firstLine(tool.description),
    )} |\n`;
  }
  return { md, count: TOOLS.length, writes: writes.length };
}

/* ── field ─────────────────────────────────────────────────────────────── */

function fields(): { md: string; count: number } {
  let md = HEADER('src/lib/collections/field-def.ts (FIELD_TYPES)');
  md += `# Loại field của nội dung (${FIELD_TYPES.length})\n\n`;
  md += 'Hình dạng JSON của từng loại trong API công khai: docs/API-PUBLIC.md mục 3.\n\n';
  md += FIELD_TYPES.map((t) => `- \`${t}\``).join('\n') + '\n';
  return { md, count: FIELD_TYPES.length };
}

/* ── effect ────────────────────────────────────────────────────────────── */

async function effects(): Promise<{ md: string; count: number }> {
  const keys = Object.keys(EFFECT_REGISTRY).sort();
  let md = HEADER('src/lib/motion/effects (EFFECT_REGISTRY + manifest của từng effect)');
  md += `# Effect (${keys.length})\n\n`;
  md += '| Key | Gắn vào | Chi phí | Xung đột | State ghi ra | Params |\n|---|---|---|---|---|---|\n';
  for (const key of keys) {
    const mod = await loadEffect(key);
    if (!mod) continue;
    const json = zodToJsonSchema(mod.paramsSchema, { $refStrategy: 'none' }) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const required = new Set(json.required ?? []);
    const params = Object.keys(json.properties ?? {}).map((k) => (required.has(k) ? `\`${k}\`` : `\`${k}?\``));
    const list = (xs?: readonly string[]) => (xs?.length ? xs.map((x) => `\`${x}\``).join(', ') : '—');
    md += `| \`${key}\` | ${list(mod.appliesTo)} | ${mod.runtimeCost} | ${list(mod.conflicts)} | ${list(
      mod.statesWritten,
    )} | ${params.join(', ') || '—'} |\n`;
  }
  return { md, count: keys.length };
}

/* ── vùng đánh dấu trong tài liệu viết tay ─────────────────────────────── */

function fillMarkers(file: string, values: Record<string, string>): void {
  if (!existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  const after = before.replace(
    /<!-- gen:([a-z-]+) -->([\s\S]*?)<!-- \/gen -->/g,
    (whole, key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`${file}: không có giá trị cho vùng gen:${key}`);
      return `<!-- gen:${key} -->${value}<!-- /gen -->`;
    },
  );
  if (after !== before) writeFileSync(file, after);
}

/* ── main ──────────────────────────────────────────────────────────────── */

/*
 * `--check` so nội dung TRƯỚC và SAU khi sinh, không so với git: sửa tay README mà chưa
 * commit không được làm phép kiểm đỏ — nó chỉ đỏ khi phần SINH TỪ CODE lệch.
 */
const HAND_WRITTEN = ['README.md', 'docs/API-PUBLIC.md', 'docs/HANDOFF.md'];
const snapshotFiles = (): Map<string, string | null> => {
  const files = new Map<string, string | null>();
  const generated = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).map((f) => `${OUT_DIR}/${f}`) : [];
  for (const f of [...generated, ...HAND_WRITTEN]) files.set(f, existsSync(f) ? readFileSync(f, 'utf8') : null);
  return files;
};
const before = snapshotFiles();

const nodes = nodeTypes();
const op = ops();
const tool = tools();
const field = fields();
const effect = await effects();

mkdirSync(OUT_DIR, { recursive: true });
const files: Record<string, string> = {
  'node-types.md': nodes.md,
  'ops.md': op.md,
  'ai-tools.md': tool.md,
  'field-kinds.md': field.md,
  'effects.md': effect.md,
};
let index = HEADER('registry trong src/');
index += '# Số liệu hiện hành, sinh từ code\n\n';
index += '| Thứ | Số | Chi tiết |\n|---|---|---|\n';
index += `| Node type | ${nodes.count} | [node-types.md](node-types.md) |\n`;
index += `| Op | ${op.count} | [ops.md](ops.md) |\n`;
index += `| Tool AI | ${tool.count} (${tool.writes} ghi) | [ai-tools.md](ai-tools.md) |\n`;
index += `| Loại field | ${field.count} | [field-kinds.md](field-kinds.md) |\n`;
index += `| Effect | ${effect.count} | [effects.md](effects.md) |\n`;
files['README.md'] = index;

// Dòng cuối của mọi file kết thúc bằng một \n, cho diff của git gọn.
for (const [name, content] of Object.entries(files)) {
  writeFileSync(`${OUT_DIR}/${name}`, content.endsWith('\n') ? content : `${content}\n`);
}

const markers = {
  'node-count': String(nodes.count),
  'node-types': `${nodes.count} node type — ${nodes.primitives.length} primitive (${nodes.primitives
    .map((t) => `\`${t}\``)
    .join(', ')}) cộng ${nodes.others.map((t) => `\`${t}\``).join(' và ')}`,
  'op-count': String(op.count),
  'tool-count': String(tool.count),
  'tool-write-count': String(tool.writes),
  'field-count': String(field.count),
  'effect-count': String(effect.count),
};
for (const file of HAND_WRITTEN) fillMarkers(file, markers);

console.log(
  `docs/generated: ${nodes.count} node type, ${op.count} op, ${tool.count} tool (${tool.writes} ghi), ` +
    `${field.count} loại field, ${effect.count} effect`,
);

if (process.argv.includes('--check')) {
  const after = snapshotFiles();
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (f) => before.get(f) !== after.get(f),
  );
  if (changed.length) {
    for (const f of changed) console.error(`  lệch: ${f}`);
    console.error('\n✗ Tài liệu sinh từ code đã lệch so với code. Kết quả mới đã được ghi — commit nó.\n');
    process.exit(1);
  }
  console.log('✓ Tài liệu khớp code.');
}
// Thoát tường minh: registry tool kéo Prisma vào, và client Prisma giữ tiến trình sống.
process.exit(0);
