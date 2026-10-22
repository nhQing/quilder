export const NONE_PROJECT: string;
export function projectDir(
  env?: Record<string, string | undefined>,
  root?: string,
): { name: string | null; dir: string };
