import { RouteSkeleton } from '@/components/builder/RouteSkeleton';

/**
 * Ranh giới đang tải của Kho dữ liệu: phủ danh sách loại và mọi màn con (`<loại>`, `types`,
 * `groups`). Hình khung chọn theo URL đích — xem `builder/loading.tsx`.
 */
export default function Loading() {
  return <RouteSkeleton />;
}
