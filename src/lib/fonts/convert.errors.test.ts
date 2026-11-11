import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lỗi khi cắt font: file hỏng thật (subset-font từ chối) là `not_font`; worker chết hay thiếu
 * module là lỗi PHÍA SERVER (`convert_failed`, 500) — không được bảo người dùng file hỏng.
 * Worker và `createRequire` được thay bằng bản giả để dựng từng ca.
 */

const m = vi.hoisted(() => ({
  /** Việc worker giả làm ngay sau khi được tạo. */
  behave: (_w: EventEmitter) => {},
  requireFails: false,
}));

vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => m.behave(this));
    }
    terminate() {
      return Promise.resolve(0);
    }
  },
}));

vi.mock('node:module', async (orig) => {
  const real = await orig<typeof import('node:module')>();
  return {
    ...real,
    createRequire: (base: string | URL) => {
      if (m.requireFails) {
        return { resolve: () => { throw new Error("Cannot find module 'subset-font'"); } };
      }
      return real.createRequire(base);
    },
  };
});

const { toWoff2 } = await import('./convert');
const { FONT_ERROR_STATUS, FontError } = await import('./types');

const ttf = new Uint8Array([0, 1, 0, 0, 1, 2, 3, 4]);
const errOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as InstanceType<typeof FontError>);

beforeEach(() => {
  m.requireFails = false;
  m.behave = () => {};
});

describe('toWoff2 — phân loại lỗi', () => {
  it('subset-font từ chối file (message ok:false) → not_font', async () => {
    m.behave = (w) => w.emit('message', { ok: false, message: 'hb_face_create failed' });
    const err = await errOf(toWoff2(ttf, 'ttf'));
    expect(err).toBeInstanceOf(FontError);
    expect(err!.code).toBe('not_font');
  });

  it('worker ném ngoài promise (không nạp được module/wasm) → convert_failed 500, không đổ cho file', async () => {
    m.behave = (w) => w.emit('error', new Error("Cannot find module 'harfbuzzjs/hb-subset.wasm'"));
    const err = await errOf(toWoff2(ttf, 'ttf'));
    expect(err!.code).toBe('convert_failed');
    expect(err!.status).toBe(500);
    expect(FONT_ERROR_STATUS.convert_failed).toBe(500);
    expect(err!.message).toContain('không phải do file');
    expect(err!.extra?.cause).toContain('harfbuzzjs');
  });

  it('worker thoát giữa chừng (crash/OOM) → convert_failed', async () => {
    m.behave = (w) => w.emit('exit', 1);
    expect((await errOf(toWoff2(ttf, 'ttf')))!.code).toBe('convert_failed');
  });

  it('không tìm được subset-font trong bản deploy → convert_failed', async () => {
    m.requireFails = true;
    const err = await errOf(toWoff2(ttf, 'ttf'));
    expect(err!.code).toBe('convert_failed');
    expect(err!.message).toContain('subset-font');
  });
});
