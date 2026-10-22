/**
 * Gói MẪU của Quilder — tài liệu sống cho cách viết một gói dự án, và là thứ test dùng để
 * kiểm cơ chế gói. Bật bằng `QUILDER_PROJECT=example`.
 *
 * Một gói thật (ví dụ của một công ty) có cùng cấu trúc, nằm ở `projects/<tên>/` và là
 * một repo git riêng — repo Quilder chỉ commit gói mẫu này. Xem README.md cạnh file này.
 */
import { defineProject } from '@/lib/project/types';

import { hello } from './src/hello';

export default defineProject({
  name: 'example',
  composites: [hello],
  guideNotes: 'Gói mẫu: composite `ExampleHello` chỉ để thử cơ chế gói, đừng dùng trên trang thật.',
});
