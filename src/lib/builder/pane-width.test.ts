import { describe, expect, it } from 'vitest';

import { clampRightPane, RIGHT_PANE_MAX, RIGHT_PANE_MIN, rightPaneMax } from './pane-width';

describe('clampRightPane', () => {
  it('kẹp trong [280, 560] ở màn rộng', () => {
    expect(clampRightPane(100, 2000)).toBe(RIGHT_PANE_MIN);
    expect(clampRightPane(400.6, 2000)).toBe(401);
    expect(clampRightPane(900, 2000)).toBe(RIGHT_PANE_MAX);
  });

  it('màn hẹp: trần là 45% bề rộng, nhưng không dưới tối thiểu', () => {
    expect(rightPaneMax(1000)).toBe(450);
    expect(clampRightPane(560, 1000)).toBe(450);
    expect(rightPaneMax(500)).toBe(RIGHT_PANE_MIN);
  });
});
