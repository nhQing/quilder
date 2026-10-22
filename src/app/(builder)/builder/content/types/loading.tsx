import { RouteSkeleton } from '@/components/builder/RouteSkeleton';

/**
 * Ranh giới đang tải giữa hai màn cấu trúc field (`types/a` → `types/b`).
 * Hình khung chọn theo URL đích — xem `builder/loading.tsx`.
 */
export default function Loading() {
  return <RouteSkeleton />;
}
