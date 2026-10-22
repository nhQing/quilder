import { RouteSkeleton } from '@/components/builder/RouteSkeleton';

/**
 * Ranh giới đang tải của một mục: form soạn ↔ bản xem trước.
 * Hình khung chọn theo URL đích — xem `builder/loading.tsx`.
 */
export default function Loading() {
  return <RouteSkeleton />;
}
