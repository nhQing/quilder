import { describe, expect, it } from 'vitest';

import { parseWeight } from './types';

describe('parseWeight', () => {
  it.each([[undefined], [null], ['']])('%j → undefined', (v) => {
    expect(parseWeight(v)).toBeUndefined();
  });
  it.each([
    ['400', '400'],
    [' 700 ', '700'],
    ['100 900', '100 900'],
    [500, '500'],
    ['1', '1'],
    ['1000', '1000'],
  ])('%j → %j', (v, out) => expect(parseWeight(v)).toBe(out));
  it.each([['0'], ['1001'], ['abc'], ['900 100'], ['100-900'], ['12345'], ['100 200 300'], ['4.5'], ['-1']])(
    '%j → bad_weight 422',
    (v) => {
      expect(() => parseWeight(v)).toThrowError(
        expect.objectContaining({ code: 'bad_weight', status: 422 }),
      );
    },
  );
});
