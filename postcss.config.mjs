/**
 * Tailwind v4 qua PostCSS.
 *
 * Phạm vi quét KHÔNG khai ở đây mà ở `src/styles/builder.css` bằng `@source` —
 * xem ghi chú trong file đó. Tailwind chỉ được phép chạm vào vỏ builder, không
 * chạm vào trang website được sinh ra từ DB.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
