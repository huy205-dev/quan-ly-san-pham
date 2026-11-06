/** Dữ liệu sản phẩm của yêu cầu thêm/sửa: body (JSON hoặc trường multipart), file ảnh, loại body. */
function productInput(req) {
  return { body: req.body, file: req.file, isMultipart: Boolean(req.is('multipart/form-data')) };
}

/**
 * Controller sản phẩm: đọc req, gọi đúng một hàm của service, ghi phản hồi JSON.
 * Không chứa SQL hay quy tắc nghiệp vụ. Lỗi (kể cả từ hàm async) được Express 5 chuyển tới errorHandler.
 * @param {ReturnType<typeof import('../services/productService.js').createProductService>} productService
 */
export function createProductController(productService) {
  return {
    /** GET /api/products?page=&pageSize=&q=&type=&stock=&sort=&order= */
    list(req, res) {
      const { page, pageSize, q, type, stock, sort, order } = req.query;
      res.json(productService.list({ page, pageSize, q, type, stock, sort, order }));
    },

    /** GET /api/products/types */
    listTypes(req, res) {
      res.json(productService.listTypes());
    },

    /** GET /api/products/:id */
    getById(req, res) {
      res.json(productService.getById(req.params.id));
    },

    /** POST /api/products (multipart có trường image, hoặc JSON) */
    async create(req, res) {
      const result = await productService.create(productInput(req));
      res.status(201).json(result);
    },

    /** PUT /api/products/:id */
    async update(req, res) {
      const result = await productService.update(req.params.id, productInput(req));
      res.json(result);
    },

    /** DELETE /api/products/:id */
    remove(req, res) {
      res.json(productService.remove(req.params.id));
    },

    /** POST /api/products/bulk-delete { ids } */
    bulkDelete(req, res) {
      res.json(productService.bulkDelete(req.body));
    },

    /** POST /api/products/bulk-copy { ids } */
    bulkCopy(req, res) {
      res.status(201).json(productService.bulkCopy(req.body));
    },
  };
}
