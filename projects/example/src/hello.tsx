import { z } from 'zod';

import { defineComposite } from '@/lib/project/types';

const params = z
  .object({
    /** Lời chào. Dịch được — xem `translatableParams`. */
    greeting: z.string().max(120).default('Xin chào từ gói mẫu'),
  })
  .strict();

/** Composite tối giản: một khối chữ, class `example-hello` (CSS ở styles/index.css). */
export const hello = defineComposite({
  key: 'ExampleHello',
  params,
  description: 'Khối chào của gói mẫu. Tham số: greeting (chuỗi). Chỉ để thử cơ chế gói dự án.',
  translatableParams: [['greeting', 120]],
  Component: ({ params: p }) => <p className="example-hello">{p.greeting}</p>,
});
