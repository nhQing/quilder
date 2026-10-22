import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const readExportFile = vi.fn(async (f: { entry: string }) => new TextEncoder().encode(`noi dung ${f.entry}`));
vi.mock('./export', () => ({ readExportFile }));

const files = [
  { entry: 'files/a.png', asset: { key: 'a', url: 'https://x/a' } },
  { entry: 'files/b.png', asset: { key: 'b', url: 'https://x/b' } },
];

describe('zipStream', () => {
  it('đọc file theo nhịp người nhận: manifest trước, file sau chỉ đọc khi được kéo', async () => {
    const { zipStream } = await import('./zip');
    const { sampleBundle } = await import('./fixtures');
    readExportFile.mockClear();
    const reader = zipStream(sampleBundle() as never, files).getReader();
    await new Promise((r) => setTimeout(r, 10));
    // Chưa ai đọc: chỉ manifest đã được dựng, chưa đụng kho.
    expect(readExportFile).not.toHaveBeenCalled();

    const parts: Uint8Array[] = [];
    const first = await reader.read();
    parts.push(first.value!);
    await new Promise((r) => setTimeout(r, 10));
    // Lấy một chunk thì kéo thêm tối đa MỘT file, không phải cả hai.
    expect(readExportFile.mock.calls.length).toBeLessThanOrEqual(1);

    for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value);
    expect(readExportFile).toHaveBeenCalledTimes(2);
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    const out = unzipSync(all);
    expect(Object.keys(out)).toEqual(['manifest.json', 'files/a.png', 'files/b.png']);
    expect(JSON.parse(strFromU8(out['manifest.json']!)).page.slug).toBe('abc');
    expect(strFromU8(out['files/b.png']!)).toBe('noi dung files/b.png');
  });

  it('đọc file hỏng → stream báo lỗi, không treo', async () => {
    const { zipStream } = await import('./zip');
    const { sampleBundle } = await import('./fixtures');
    readExportFile.mockImplementationOnce(async () => { throw new Error('kho sập'); });
    const reader = zipStream(sampleBundle() as never, files).getReader();
    await expect((async () => { for (;;) { const r = await reader.read(); if (r.done) return; } })()).rejects.toThrow('kho sập');
  });
});
