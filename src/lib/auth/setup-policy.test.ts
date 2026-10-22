import { describe, expect, it } from 'vitest';

import { setupTokenRequired } from './setup-policy';

describe('setupTokenRequired', () => {
  it('production đòi mã', () => {
    expect(setupTokenRequired('production')).toBe(true);
  });

  it('dev và test không đòi', () => {
    expect(setupTokenRequired('development')).toBe(false);
    expect(setupTokenRequired('test')).toBe(false);
  });
});
