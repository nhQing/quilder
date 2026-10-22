import { RouteSkeleton } from '@/components/builder/RouteSkeleton';

/**
 * Ranh giới đang tải của một component: trang chi tiết ↔ canvas sửa (`edit`).
 * Hình khung chọn theo URL đích — xem `builder/loading.tsx`.
 */
export default function Loading() {
  return <RouteSkeleton />;
}
