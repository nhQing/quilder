/**
 * Tên của CHÍNH BUILDER — cạnh logo ở thanh menu, màn đăng nhập, và tiêu đề tab.
 *
 * Đặt logo riêng ở Cài đặt → Nhận diện builder là nói "builder này là của dự án X", nên
 * tên đi theo: "<Tên site> builder" (Tên site cũng ở màn Cài đặt). Chưa đặt logo riêng
 * thì vẫn là Quilder — logo mặc định đã mang chữ Quilder, đặt tên dự án cạnh nó là sai.
 *
 * Thuần, không `server-only`: thanh menu là client component, nhận chuỗi đã tính sẵn.
 */
export const DEFAULT_BUILDER_TITLE = 'Quilder';

export function builderTitle({ siteName, hasLogo }: { siteName: string | null; hasLogo: boolean }): string {
  const name = siteName?.trim();
  return hasLogo && name ? `${name} builder` : DEFAULT_BUILDER_TITLE;
}
