/**
 * Thay cho `server-only` khi chạy vitest.
 *
 * Bản thật ném lỗi ngay lúc import nếu không ở trong bối cảnh React Server
 * Component, nên nó làm mọi module khai nó trở thành không test được. Rào chắn
 * vẫn nguyên vẹn lúc Next build — alias này chỉ có tác dụng trong vitest.
 */
export {};
