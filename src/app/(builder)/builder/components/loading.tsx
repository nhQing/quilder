import { RouteSkeleton } from '@/components/builder/RouteSkeleton';

/**
 * Ranh giới đang tải của thư viện component: danh sách ↔ chi tiết một component.
 * Hình khung chọn theo URL đích — xem `builder/loading.tsx`.
 */
export default function Loading() {
  return <RouteSkeleton />;
}
