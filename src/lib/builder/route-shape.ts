/**
 * Màn builder nào nằm ở địa chỉ này — để khung đang tải (`RouteSkeleton`) vẽ ĐÚNG HÌNH của màn
 * sắp hiện, bất kể ranh giới `loading.tsx` nào bắt được lượt chờ.
 *
 * ## Vì sao chọn theo URL, không để mỗi `loading.tsx` tự vẽ hình của khu mình
 *
 * Bản đầu làm vậy, và đo trên trình duyệt thật thì sai: bấm "Văn bản" từ màn "Trang", URL đã
 * sang `/builder/text` mà màn vẫn hiện lưới thẻ của màn "Trang". Lý do nằm ở router: nó commit
 * ngay khi dòng RSC đầu tiên tới, lúc đó dữ liệu của đoạn `text` (kể cả `text/loading.tsx`) có
 * thể chưa tới, nên đoạn `text` treo và ranh giới bắt được là của đoạn CHA — `builder/loading`.
 * Prefetch ở bản production che được phần lớn, nhưng không che `router.push`, link chưa kịp
 * prefetch, hay mạng chậm.
 *
 * Nên mọi `loading.tsx` vẽ cùng một khung, và khung đọc `usePathname()` — lúc khung hiện, router
 * đã commit nên đó là URL của màn ĐÍCH. Ranh giới nào bắt cũng ra cùng một hình.
 *
 * Danh sách đi theo cây `src/app/(builder)/builder`; thêm màn mới thì thêm một nhánh ở đây (route
 * lạ vẫn có khung `generic` — đầu màn trống — nên quên cũng không vỡ).
 */

export type RouteShape =
  | 'dashboard'
  | 'editor'
  | 'text'
  | 'content'
  | 'entries'
  | 'entry-form'
  | 'entry-preview'
  | 'taxonomy'
  | 'schema'
  | 'components'
  | 'component-detail'
  | 'component-editor'
  | 'assets'
  | 'settings'
  | 'releases'
  | 'users'
  | 'tokens'
  | 'blank'
  | 'generic';

/** Màn đứng một mình ngay dưới `/builder`. Đoạn nào khác là id của một trang → editor. */
const TOP: Record<string, RouteShape> = {
  text: 'text',
  content: 'content',
  components: 'components',
  assets: 'assets',
  settings: 'settings',
  releases: 'releases',
  admin: 'users',
  claude: 'tokens',
  // Đăng nhập và cài đặt lần đầu không có thanh menu, không có đầu màn: khung trống.
  login: 'blank',
  setup: 'blank',
};

export function routeShape(pathname: string): RouteShape {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'builder') return 'generic';
  const [, a, b, c, d] = parts;
  const depth = parts.length;

  if (depth === 1) return 'dashboard';
  if (depth === 2) return TOP[a!] ?? 'editor';

  if (a === 'content') {
    if (b === 'types' || b === 'groups') return depth === 4 ? 'schema' : 'generic';
    if (depth === 3) return 'entries';
    if (depth === 4) return c === 'taxonomies' ? 'taxonomy' : 'entry-form';
    if (depth === 5 && d === 'preview') return 'entry-preview';
    return 'generic';
  }
  if (a === 'components') {
    if (depth === 3) return 'component-detail';
    if (depth === 4 && c === 'edit') return 'component-editor';
    return 'generic';
  }
  if (a === 'admin' && depth === 3 && b === 'tokens') return 'tokens';
  return 'generic';
}
