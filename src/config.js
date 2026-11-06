import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Thư mục gốc của dự án, tính từ vị trí file này (không phụ thuộc thư mục đang chạy lệnh). */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Cấu hình ứng dụng, đọc từ biến môi trường với giá trị mặc định hợp lý.
 * - PORT: cổng HTTP (mặc định 3000)
 * - DB_PATH: file SQLite (mặc định data/products.db)
 * - UPLOAD_DIR: thư mục lưu ảnh upload (mặc định uploads/)
 * - SEED_SAMPLE_DATA: đặt 0/false/no để không tạo dữ liệu mẫu khi database mới
 */
export const config = {
  rootDir,
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(rootDir, 'data', 'products.db'),
  uploadsDir: process.env.UPLOAD_DIR || path.join(rootDir, 'uploads'),
  publicDir: path.join(rootDir, 'public'),
  sharedDir: path.join(rootDir, 'shared'),
  seedSampleData: !['0', 'false', 'no'].includes(String(process.env.SEED_SAMPLE_DATA ?? '').toLowerCase()),
};
