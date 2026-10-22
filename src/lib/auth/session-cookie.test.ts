import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionCookieSecure } from './session';

describe('sessionCookieSecure', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('production mặc định Secure', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COOKIE_SECURE', '');
    expect(sessionCookieSecure()).toBe(true);
  });

  it('dev mặc định không Secure — localhost không có HTTPS', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('COOKIE_SECURE', '');
    expect(sessionCookieSecure()).toBe(false);
  });

  it('COOKIE_SECURE=false tắt Secure cả trên production (builder nội bộ chạy http)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COOKIE_SECURE', ' FALSE ');
    expect(sessionCookieSecure()).toBe(false);
  });

  it('COOKIE_SECURE=true bật Secure cả trên dev', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('COOKIE_SECURE', 'true');
    expect(sessionCookieSecure()).toBe(true);
  });

  it('giá trị lạ không tắt Secure — gõ nhầm thì giữ mặc định an toàn', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COOKIE_SECURE', '0');
    expect(sessionCookieSecure()).toBe(true);
  });
});
