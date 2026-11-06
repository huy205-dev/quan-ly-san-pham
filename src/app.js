import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { createImportExportController } from './controllers/importExportController.js';
import { createProductController } from './controllers/productController.js';
import { openDatabase } from './db/database.js';
import { seedSampleData as insertSampleData } from './db/seed.js';
import { apiNotFoundHandler, errorHandler, pageNotFoundHandler } from './middlewares/errorHandler.js';
import { createImageUpload, createImportUpload } from './middlewares/upload.js';
import { createProductRepository } from './repositories/productRepository.js';
import { createProductRouter } from './routes/productRoutes.js';
import { createImageService } from './services/imageService.js';
import { createImportExportService } from './services/importExportService.js';
import { createProductService } from './services/productService.js';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/** Header bảo mật cho mọi phản hồi (giao diện, API, file tĩnh). */
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  });
  next();
}

/** Dữ liệu API luôn thay đổi theo thao tác, không để trình duyệt lưu cache. */
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * Tạo ứng dụng Express cùng kết nối database; các phụ thuộc được nối tường minh (không singleton toàn cục).
 * Dữ liệu mẫu chỉ được thêm khi seedSampleData = true và database mới tạo (file chưa tồn tại, hoặc ':memory:').
 * @param {{ dbPath?: string, uploadsDir?: string, seedSampleData?: boolean }} [options]
 * @returns {{ app: import('express').Express, db: import('node:sqlite').DatabaseSync, close: () => void }}
 */
export function createApp({
  dbPath = config.dbPath,
  uploadsDir = config.uploadsDir,
  seedSampleData = config.seedSampleData,
} = {}) {
  const uploadsRoot = path.resolve(uploadsDir);
  fs.mkdirSync(uploadsRoot, { recursive: true });

  const inMemory = dbPath === ':memory:';
  if (!inMemory) fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const isNewDatabase = inMemory || !fs.existsSync(dbPath);

  const db = openDatabase(dbPath);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    db.close();
  };

  try {
    if (seedSampleData && isNewDatabase) insertSampleData(db);

    // db → repository → imageService → productService → importExportService → controllers → router
    const repository = createProductRepository(db);
    const imageService = createImageService({ uploadsDir: uploadsRoot });
    const productService = createProductService({ repository, imageService });
    const importExportService = createImportExportService({ repository, imageService });
    const productRouter = createProductRouter({
      productController: createProductController(productService),
      importExportController: createImportExportController(importExportService),
      uploadImage: createImageUpload(),
      uploadImportFile: createImportUpload(),
    });

    const app = express();
    app.disable('x-powered-by');
    app.use(securityHeaders);

    app.use('/api', noStore, express.json({ limit: '1mb' }));
    app.use('/api/products', productRouter);
    app.use('/api', apiNotFoundHandler);

    app.use('/shared', express.static(config.sharedDir));
    // Ảnh upload: không liệt kê thư mục; file ẩn (.gitkeep) bị bỏ qua như không tồn tại.
    app.use('/uploads', express.static(uploadsRoot, { index: false }));
    app.use(express.static(config.publicDir));

    app.use(pageNotFoundHandler);
    app.use(errorHandler);

    return { app, db, close };
  } catch (err) {
    close();
    throw err;
  }
}
