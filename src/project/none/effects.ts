/** Gói rỗng: không có effect riêng. Gói thật export `Record<string, Entry>` ở projects/<tên>/effects.ts. */
import type { Entry } from '@/lib/motion/effects/registry';

const effects: Record<string, Entry> = {};
export default effects;
