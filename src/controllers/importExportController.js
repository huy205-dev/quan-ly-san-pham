/** Gửi file tải về: đúng Content-Type, tên file trong Content-Disposition, không cache. */
function sendDownload(res, { buffer, contentType, fileName }) {
  res.set({
    'Content-Type': contentType,
    // Tên file do server tự tạo, chỉ gồm ký tự ASCII an toàn.
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
  res.send(buffer);
}

/**
 * Controller nhập/xuất file: đọc req, gọi service, ghi phản hồi (JSON hoặc file tải về).
 * @param {ReturnType<typeof import('../services/importExportService.js').createImportExportService>} importExportService
 */
export function createImportExportController(importExportService) {
  return {
    /** POST /api/products/import (multipart, trường "file") */
    async importFile(req, res) {
      const result = await importExportService.importFile(req.file);
      res.status(201).json(result);
    },

    /** GET /api/products/export?format=xlsx|json|xml&q=&type=&stock=&sort=&order= */
    async exportFile(req, res) {
      const { format, q, type, stock, sort, order } = req.query;
      sendDownload(res, await importExportService.exportProducts({ format, q, type, stock, sort, order }));
    },

    /** GET /api/products/template?format=xlsx|json|xml */
    async template(req, res) {
      sendDownload(res, await importExportService.buildTemplate({ format: req.query.format }));
    },
  };
}
