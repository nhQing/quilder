import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { canonicalJson, contractHash, toolContracts } from './contract';
import { TOOLS } from './tools';

const snapshot = JSON.parse(readFileSync('mcp/contract.snapshot.json', 'utf8')) as {
  hash: string;
  writeTools: string[];
  tools: { name: string; readOnly: boolean; schema: string }[];
};

describe('hợp đồng MCP khớp snapshot đã commit', () => {
  it('cùng danh sách tool, cùng cờ đọc/ghi, cùng schema', () => {
    // Đỏ ở đây nghĩa là tool đã đổi mà snapshot chưa: chạy `pnpm mcp:snapshot`, đọc
    // diff của mcp/contract.snapshot.json, rồi commit. Đừng sửa tay file snapshot.
    expect(toolContracts(TOOLS)).toEqual(snapshot.tools);
  });

  it('cùng hash', () => {
    expect(contractHash(TOOLS)).toBe(snapshot.hash);
  });

  it('không tool nào publish, rollback hay xoá', () => {
    // Nguyên tắc "AI không publish" được bảo đảm bằng cách KHÔNG CÓ tool — HANDOFF §2.4.
    for (const { name } of snapshot.tools) {
      expect(name).not.toMatch(/publish|rollback|release|^delete_|_delete$/i);
    }
  });
});

describe('canonicalJson', () => {
  it('không phụ thuộc thứ tự khoá', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
  });

  it('bỏ khoá undefined, giữ null', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe('contractHash', () => {
  const tool = (name: string, input: z.ZodTypeAny, readOnly = true) => ({ name, readOnly, input });

  it('đổi schema một tool là đổi hash', () => {
    const a = contractHash([tool('x', z.object({ id: z.string() }))]);
    const b = contractHash([tool('x', z.object({ id: z.number() }))]);
    expect(a).not.toBe(b);
  });

  it('đổi cờ đọc/ghi là đổi hash', () => {
    const input = z.object({});
    expect(contractHash([tool('x', input, true)])).not.toBe(contractHash([tool('x', input, false)]));
  });

  it('thứ tự tool không đổi hash', () => {
    const a = tool('a', z.object({}));
    const b = tool('b', z.object({}));
    expect(contractHash([a, b])).toBe(contractHash([b, a]));
  });
});
