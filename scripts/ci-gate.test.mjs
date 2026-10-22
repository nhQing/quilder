import { describe, expect, it } from 'vitest';
import { ciVerdict } from './ci-gate.mjs';

let n = 0;
const run = (status, conclusion, createdAt, event = 'push') => ({
  databaseId: ++n,
  status,
  conclusion,
  event,
  createdAt,
  url: `https://github.com/x/y/actions/runs/${n}`,
});

describe('ciVerdict', () => {
  it('không có run nào → missing', () => {
    expect(ciVerdict([])).toEqual({ kind: 'missing' });
  });

  it('một run xanh → ok', () => {
    const r = run('completed', 'success', '2026-10-08T08:00:00Z');
    expect(ciVerdict([r])).toEqual({ kind: 'ok', run: r });
  });

  it('một run đỏ → failed', () => {
    const r = run('completed', 'failure', '2026-10-08T08:00:00Z');
    expect(ciVerdict([r])).toEqual({ kind: 'failed', run: r });
  });

  it('đang chạy, chưa có kết quả → pending', () => {
    const r = run('in_progress', '', '2026-10-08T08:00:00Z');
    expect(ciVerdict([r])).toEqual({ kind: 'pending', run: r });
  });

  it('run xong MỚI NHẤT quyết định: chạy lại đỏ sau một lần xanh là đỏ', () => {
    const green = run('completed', 'success', '2026-10-08T08:00:00Z');
    const red = run('completed', 'failure', '2026-10-08T19:00:00Z', 'schedule');
    expect(ciVerdict([green, red]).kind).toBe('failed');
    expect(ciVerdict([red, green]).kind).toBe('failed'); // không phụ thuộc thứ tự gh trả
  });

  it('chạy lại xanh sau một lần đỏ → ok', () => {
    const red = run('completed', 'failure', '2026-10-08T08:00:00Z');
    const green = run('completed', 'success', '2026-10-08T09:00:00Z');
    expect(ciVerdict([green, red])).toEqual({ kind: 'ok', run: green });
  });

  it('run bị huỷ không tính: xanh trước đó vẫn là xanh', () => {
    const green = run('completed', 'success', '2026-10-08T08:00:00Z');
    const cancelled = run('completed', 'cancelled', '2026-10-08T09:00:00Z');
    expect(ciVerdict([cancelled, green])).toEqual({ kind: 'ok', run: green });
  });

  it('chỉ có run bị huỷ → missing, không phải ok', () => {
    expect(ciVerdict([run('completed', 'cancelled', '2026-10-08T08:00:00Z')]).kind).toBe('missing');
  });

  it('đã xanh thì không chờ lượt chạy mới hơn', () => {
    const green = run('completed', 'success', '2026-10-08T08:00:00Z');
    const nightly = run('in_progress', '', '2026-10-08T19:00:00Z', 'schedule');
    expect(ciVerdict([nightly, green])).toEqual({ kind: 'ok', run: green });
  });

  it('đỏ mà đang chạy lại → pending, chờ lượt chạy lại', () => {
    const red = run('completed', 'failure', '2026-10-08T08:00:00Z');
    const rerun = run('queued', '', '2026-10-08T08:30:00Z');
    expect(ciVerdict([rerun, red])).toEqual({ kind: 'pending', run: rerun });
  });
});
