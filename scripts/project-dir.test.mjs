import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NONE_PROJECT, projectDir } from './project-dir.mjs';

describe('projectDir', () => {
  const root = mkdtempSync(join(tmpdir(), 'quilder-proj-'));
  mkdirSync(join(root, 'projects', 'abc'), { recursive: true });
  writeFileSync(join(root, 'projects', 'abc', 'index.ts'), 'export default {}');

  it('trống → gói rỗng', () => {
    expect(projectDir({}, root)).toEqual({ name: null, dir: NONE_PROJECT });
    expect(projectDir({ QUILDER_PROJECT: '  ' }, root).dir).toBe(NONE_PROJECT);
  });

  it('có gói → projects/<tên>', () => {
    expect(projectDir({ QUILDER_PROJECT: 'abc' }, root)).toEqual({ name: 'abc', dir: 'projects/abc' });
  });

  it('gói không tồn tại hoặc tên lạ → ném, không lặng lẽ ra Quilder thuần', () => {
    expect(() => projectDir({ QUILDER_PROJECT: 'khong-co' }, root)).toThrow(/không có projects\/khong-co/);
    expect(() => projectDir({ QUILDER_PROJECT: '../x' }, root)).toThrow(/không hợp lệ/);
  });
});
