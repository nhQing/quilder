import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyResponse, openBundle, postJson } from './client';
import { sampleBundle } from './fixtures';

describe('classifyResponse', () => {
  it('proxy trả HTML 413 → G1 kèm cỡ request, không ném lỗi JSON', () => {
    const r = classifyResponse({ status: 413, contentType: 'text/html', bodyText: '<html>413 Request Entity Too Large</html>', requestBytes: 6 * 1024 * 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]!.code).toBe('proxy-too-large');
      expect(r.issues[0]!.vars?.size).toBe('6.0 MB');
    }
  });

  it('HTML không phải 413 (502/504 của proxy, trang đăng nhập) → G7 nói rõ status, không phải G1', () => {
    for (const status of [502, 504, 200]) {
      const r = classifyResponse({ status, contentType: 'text/html', bodyText: '<html>x</html>', requestBytes: 100 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues[0]!.code).toBe('network');
        expect(r.issues[0]!.detail).toBe(`Máy chủ trả ${status} không phải từ app (có thể hết phiên đăng nhập hoặc máy chủ quá tải)`);
      }
    }
  });

  it('JSON lỗi của app giữ nguyên issues server gửi', () => {
    const r = classifyResponse({ status: 409, contentType: 'application/json', bodyText: JSON.stringify({ error: 'x', issues: [{ code: 'target-changed', level: 'block' }] }), requestBytes: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe('target-changed');
  });

  it('JSON thành công trả data', () => {
    expect(classifyResponse({ status: 200, contentType: 'application/json; charset=utf-8', bodyText: '{"a":1}', requestBytes: 1 })).toEqual({ ok: true, data: { a: 1 } });
  });
});

describe('openBundle', () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const sha = createHash('sha256').update(png).digest('hex');
  const manifest = () => {
    const b = sampleBundle();
    b.assets[0] = { ...b.assets[0]!, sha256: sha, file: `files/${sha}.png` };
    return b;
  };

  it('mở được gói đúng và lấy được file', async () => {
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest())), [`files/${sha}.png`]: png });
    const r = await openBundle(zip);
    expect(r.ok).toBe(true);
    if (r.ok) expect([...r.fileOf(`files/${sha}.png`)]).toEqual([...png]);
  });

  it('file bị sửa (sha không khớp) → G4', async () => {
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest())), [`files/${sha}.png`]: new Uint8Array([9, 9]) });
    const r = await openBundle(zip);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe('file-corrupt');
  });

  it('không phải zip, hoặc thiếu manifest → G4', async () => {
    expect((await openBundle(new Uint8Array([1, 2, 3]))).ok).toBe(false);
    expect((await openBundle(zipSync({ 'a.txt': strToU8('x') }))).ok).toBe(false);
  });
});

describe('postJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requestBytes tính bằng byte UTF-8, không phải số ký tự', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>413</html>', { status: 413, headers: { 'content-type': 'text/html' } })));
    const body = { t: 'ế'.repeat(1024 * 1024) }; // 1 Mi ký tự, mỗi ký tự 3 byte
    const r = await postJson('/x', body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.vars?.size).toBe('3.0 MB');
  });
});

describe('send - huỷ', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('signal đã huỷ → aborted, không báo mất mạng', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }));
    const ctl = new AbortController();
    ctl.abort();
    const r = await postJson('/x', {}, ctl.signal);
    expect(r).toMatchObject({ ok: false, aborted: true, issues: [] });
  });
});
