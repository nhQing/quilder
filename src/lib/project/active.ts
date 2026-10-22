/**
 * Gói dự án đang chạy — một điểm nạp duy nhất cho lõi.
 *
 * `@project/index` do alias quyết (scripts/project-dir.mjs): gói thật hoặc `src/project/none`.
 * Kiểm hợp đồng ngay khi nạp: composite của gói trùng tên composite lõi là NÉM lúc khởi
 * động — im lặng đè lên `Form` của lõi là kiểu lỗi chỉ lộ ra khi một trang nào đó hỏng.
 */

import project from '@project/index';

import type { ProjectComposite, QuilderProject } from './types';

export function checkProject(p: QuilderProject, coreComposites: readonly string[]): QuilderProject {
  const seen = new Set<string>();
  for (const c of p.composites ?? []) {
    if (coreComposites.includes(c.key)) {
      throw new Error(`Gói "${p.name}": composite "${c.key}" trùng tên composite lõi.`);
    }
    if (seen.has(c.key)) throw new Error(`Gói "${p.name}": composite "${c.key}" khai hai lần.`);
    seen.add(c.key);
  }
  return p;
}

export const activeProject: QuilderProject = project;

export function projectComposites(): readonly ProjectComposite[] {
  return (activeProject.composites ?? []) as ProjectComposite[];
}

export function projectComposite(key: string): ProjectComposite | undefined {
  return projectComposites().find((c) => c.key === key);
}
