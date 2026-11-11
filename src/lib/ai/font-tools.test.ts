import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({ listFonts: vi.fn(), addFace: vi.fn() }));
const google = vi.hoisted(() => ({ importGoogleFamily: vi.fn() }));
const fetchUrl = vi.hoisted(() => ({ fetchUrlBytes: vi.fn() }));
vi.mock('@/lib/fonts/service', () => svc);
vi.mock('@/lib/fonts/google', () => google);
vi.mock('@/lib/assets/fetch-url', () => fetchUrl);

import type { SessionPayload } from '@/lib/auth/session';
import { FONT_TOOLS } from './font-tools';

type Res = Record<string, any>;
const byName = (n: string) => FONT_TOOLS.find((t) => t.name === n)!;
const ctx = { session: { email: 'a@b.c', sub: 's1' } as SessionPayload, origin: 'https://a.test' };
const run = (n: string, input: unknown) =>
  (byName(n).run as (i: unknown, c: unknown) => Promise<Res>)(input, ctx);

beforeEach(() => {
  svc.listFonts.mockReset();
  svc.addFace.mockReset();
  google.importGoogleFamily.mockReset();
  fetchUrl.fetchUrlBytes.mockReset();
});

describe('list_fonts', () => {
  it('trả danh sách, có Inter source builtin', async () => {
    svc.listFonts.mockResolvedValue([{ cssName: 'Inter', token: 'font-inter', source: 'builtin' }]);
    const r = await run('list_fonts', {});
    expect(r.ok).toBe(true);
    expect(r.fonts[0].source).toBe('builtin');
  });
  it('mô tả có ba câu dặn', () => {
    const d = byName('list_fonts').description;
    expect(d).toContain('Kiểm font đã có trước khi tải mới.');
    expect(d).toContain('typography.family: { $token:');
    expect(d).toContain('sau khi người dùng Publish');
    expect(byName('list_fonts').readOnly).toBe(true);
  });
});

describe('upload_font', () => {
  it('filePath phía server bị từ chối', async () => {
    const r = await run('upload_font', { filePath: 'C:/x.woff2', licenseConfirmed: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('filePath chỉ dùng được qua MCP server');
    expect(svc.addFace).not.toHaveBeenCalled();
  });
  it('thiếu cả ba nguồn -> lỗi', async () => {
    const r = await run('upload_font', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/filePath, sourceUrl|google/);
  });
  it('hai nguồn cùng lúc -> lỗi', async () => {
    const r = await run('upload_font', { sourceUrl: 'https://x.test/a.woff2', google: { family: 'Lora' } });
    expect(r.ok).toBe(false);
  });
  it('google gọi importGoogleFamily, không cần licenseConfirmed', async () => {
    google.importGoogleFamily.mockResolvedValue({ ok: true, dryRun: true });
    const r = await run('upload_font', { google: { family: 'Lora', weights: [400], italic: false }, fallback: 'serif', dryRun: true });
    expect(r.ok).toBe(true);
    const [req, actor] = google.importGoogleFamily.mock.calls[0]!;
    expect(req.family).toBe('Lora');
    expect(req.weights).toEqual([400]);
    expect(req.italic).toBe(false);
    expect(req.dryRun).toBe(true);
    expect(req.fallback).toMatch(/serif/);
    expect(actor).toEqual({ email: 'a@b.c', sub: 's1' });
  });
  it('sourceUrl: tải rồi addFace, không tự điền licenseConfirmed', async () => {
    fetchUrl.fetchUrlBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), fileName: 'a.woff2' });
    svc.addFace.mockResolvedValue({ ok: true });
    await run('upload_font', { sourceUrl: 'https://x.test/a.woff2' });
    expect(svc.addFace.mock.calls[0]![0].licenseConfirmed).toBe(false);
    await run('upload_font', { sourceUrl: 'https://x.test/a.woff2', licenseConfirmed: true, weight: '400', style: 'italic' });
    const input = svc.addFace.mock.calls[1]![0];
    expect(input.licenseConfirmed).toBe(true);
    expect(input.weight).toBe('400');
    expect(input.style).toBe('italic');
  });
  it('weight sai -> bad_weight, style sai -> lỗi', async () => {
    const w = await run('upload_font', { sourceUrl: 'https://x.test/a.woff2', weight: 'bold' });
    expect(w.ok).toBe(false);
    expect(w.code).toBe('bad_weight');
    const s = await run('upload_font', { sourceUrl: 'https://x.test/a.woff2', style: 'oblique' });
    expect(s.ok).toBe(false);
    expect(fetchUrl.fetchUrlBytes).not.toHaveBeenCalled();
  });
  it('filePath rỗng + sourceUrl -> coi như chỉ có sourceUrl', async () => {
    fetchUrl.fetchUrlBytes.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), fileName: 'a.ttf' });
    svc.addFace.mockResolvedValue({ ok: true });
    const r = await run('upload_font', { filePath: '', sourceUrl: 'https://x/a.ttf' });
    expect(r.ok).toBe(true);
    expect(fetchUrl.fetchUrlBytes).toHaveBeenCalledWith('https://x/a.ttf', 'Font');
  });
  it('sourceUrl rỗng một mình -> lỗi sạch, không ném', async () => {
    const r = await run('upload_font', { sourceUrl: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/filePath, sourceUrl|google/);
    expect(fetchUrl.fetchUrlBytes).not.toHaveBeenCalled();
    const r2 = await run('upload_font', { filePath: '  ' });
    expect(r2.ok).toBe(false);
  });
  it('lỗi tải URL được báo lại', async () => {
    fetchUrl.fetchUrlBytes.mockResolvedValue({ ok: false, error: 'boom', status: 400 });
    const r = await run('upload_font', { sourceUrl: 'https://x.test/a.woff2' });
    expect(r).toMatchObject({ ok: false, error: 'boom' });
  });
  it('mô tả có ba câu dặn', () => {
    const d = byName('upload_font').description;
    expect(d).toContain('Mỗi lần gọi một file');
    expect(d).toContain('dryRun');
    expect(d).toContain('hỏi người dùng');
    expect(d).toContain('KHÔNG tự điền licenseConfirmed');
    expect(byName('upload_font').readOnly).toBe(false);
  });
});
