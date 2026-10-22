import { describe, expect, it } from 'vitest';

import { assetRemotePatterns, parseAssetHosts } from './asset-hosts.mjs';

describe('parseAssetHosts', () => {
  it('nhận URL, host trần (coi là https), cổng và path', () => {
    expect(parseAssetHosts('https://cdn.abc.vn, cdn-dev.abc.vn, http://localhost:9000/bucket/')).toEqual([
      { protocol: 'https', hostname: 'cdn.abc.vn', pathname: '/**' },
      { protocol: 'https', hostname: 'cdn-dev.abc.vn', pathname: '/**' },
      { protocol: 'http', hostname: 'localhost', port: '9000', pathname: '/bucket/**' },
    ]);
  });

  it('bỏ mục rỗng, từ chối scheme lạ', () => {
    expect(parseAssetHosts(' , ')).toEqual([]);
    expect(() => parseAssetHosts('ftp://x.vn')).toThrow(/http hoặc https/);
  });
});

describe('assetRemotePatterns', () => {
  it('ASSET_HOSTS thắng S3_PUBLIC_BASE_URL', () => {
    const r = assetRemotePatterns({ ASSET_HOSTS: 'a.vn', S3_PUBLIC_BASE_URL: 'https://b.vn/public' }, { production: true });
    expect(r.map((p) => p.hostname)).toEqual(['a.vn']);
  });

  it('không có ASSET_HOSTS thì lấy S3_PUBLIC_BASE_URL, giữ path làm tiền tố', () => {
    expect(assetRemotePatterns({ S3_PUBLIC_BASE_URL: 'https://cdn.abc.vn/public' }, { production: true })).toEqual([
      { protocol: 'https', hostname: 'cdn.abc.vn', pathname: '/public/**' },
    ]);
  });

  it('build production không có host nào thì DỪNG; dev thì cho qua', () => {
    expect(() => assetRemotePatterns({}, { production: true })).toThrow(/Thiếu ASSET_HOSTS/);
    expect(assetRemotePatterns({}, { production: false })).toEqual([]);
  });
});
