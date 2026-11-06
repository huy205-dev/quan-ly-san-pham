import { Router } from 'express';

/**
 * Router /api/products: chỉ nối URL/phương thức → middleware → hàm của controller.
 * Các đường dẫn cố định (export, template, types, bulk-*, import) phải khai báo trước các route /:id.
 * @param {{
 *   productController: ReturnType<typeof import('../controllers/productController.js').createProductController>,
 *   importExportController: ReturnType<typeof import('../controllers/importExportController.js').createImportExportController>,
 *   uploadImage: import('express').RequestHandler,
 *   uploadImportFile: import('express').RequestHandler,
 * }} deps
 */
export function createProductRouter({ productController, importExportController, uploadImage, uploadImportFile }) {
  const router = Router();

  router.get('/export', importExportController.exportFile);
  router.get('/template', importExportController.template);
  router.get('/types', productController.listTypes);
  router.post('/bulk-delete', productController.bulkDelete);
  router.post('/bulk-copy', productController.bulkCopy);
  router.post('/import', uploadImportFile, importExportController.importFile);

  router.get('/', productController.list);
  router.post('/', uploadImage, productController.create);
  router.get('/:id', productController.getById);
  router.put('/:id', uploadImage, productController.update);
  router.delete('/:id', productController.remove);

  return router;
}
