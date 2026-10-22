import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const root = mkdtempSync(join(tmpdir(), 'quilder-p-'));
mkdirSync(join(root, 'projects', 'abc', 'public', 'fonts'), { recursive: true });
writeFileSync(join(root, 'projects', 'abc', 'public', 'fonts', 'a.woff2'), 'FONT');
writeFileSync(join(root, 'projects', 'abc', 'secret.env'), 'KHONG-DUOC-LO');

const get = (...path: string[]) =>
  GET(new Request('http://x/p'), { params: Promise.resolve({ path }) });

beforeEach(() => {
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('QUILDER_PROJECT', 'abc');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /p/**', () => {
  it('phục vụ file trong public của gói, đúng mime', async () => {
    const res = await get('fonts', 'a.woff2');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('font/woff2');
    expect(await res.text()).toBe('FONT');
  });

  it('chặn thoát khỏi thư mục public', async () => {
    expect((await get('..', 'secret.env')).status).toBe(404);
    expect((await get('..', '..', '..', 'etc', 'passwd')).status).toBe(404);
  });

  it('đuôi lạ, file không có, hoặc không bật gói → 404', async () => {
    expect((await get('fonts', 'khong-co.woff2')).status).toBe(404);
    expect((await get('fonts', 'a.exe')).status).toBe(404);
    vi.stubEnv('QUILDER_PROJECT', '');
    expect((await get('fonts', 'a.woff2')).status).toBe(404);
  });
});
