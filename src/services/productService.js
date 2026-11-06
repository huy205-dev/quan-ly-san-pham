import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  LIMITS,
  PAGE_SIZES,
  SORT_FIELDS,
  SORT_ORDERS,
  STOCK_FILTERS,
  buildCopyName,
  buildSearchTokens,
  formatNumberVi,
  formatProductCode,
  parseProductId,
  validateProductInput,
} from '../../shared/productRules.js';
import { productsNotFoundError, requestValidationError, validationError } from '../utils/errors.js';
import { nowUtcIso } from '../utils/time.js';

const INVALID_IDS_MESSAGE = 'Danh sách sản phẩm cần xử lý không hợp lệ';
/** "a, b hoặc c" */
const joinOr = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} hoặc ${items.at(-1)}` : items.join(''));
const SORT_MESSAGE = `Chỉ sắp xếp được theo: ${SORT_FIELDS.join(', ')}`;
const ORDER_MESSAGE = `Thứ tự sắp xếp chỉ là ${joinOr(SORT_ORDERS)}`;
const STOCK_MESSAGE = `Tình trạng kho chỉ là ${joinOr(STOCK_FILTERS)}`;
const TYPE_INVALID_MESSAGE = 'Loại sản phẩm cần lọc không hợp lệ';
const TYPE_TOO_LONG_MESSAGE = `Loại sản phẩm cần lọc tối đa ${formatNumberVi(LIMITS.productTypeMax)} ký tự`;
/** Giá trị removeImage được hiểu là "bỏ ảnh" (checkbox HTML gửi "on"). */
const TRUTHY_FLAGS = new Set(['true', '1', 'on']);

/**
 * Đọc tham số tìm kiếm q: chuỗi, cắt khoảng trắng, tối đa LIMITS.searchMax ký tự.
 * Lỗi được ghi vào mảng errors; trả về chuỗi đã cắt (hoặc '' khi lỗi/không có).
 * @param {unknown} raw giá trị req.query.q (chuỗi, mảng khi lặp tham số, hoặc undefined)
 * @param {Array<{ field: string, message: string }>} errors
 * @returns {string}
 */
export function readSearchQuery(raw, errors) {
  if (raw === undefined) return '';
  if (typeof raw !== 'string') {
    errors.push({ field: 'q', message: 'Từ khóa tìm kiếm không hợp lệ' });
    return '';
  }
  const q = raw.trim();
  if (q.length > LIMITS.searchMax) {
    errors.push({ field: 'q', message: `Từ khóa tìm kiếm tối đa ${LIMITS.searchMax} ký tự` });
    return '';
  }
  return q;
}

/** type: chuỗi, cắt khoảng trắng, tối đa LIMITS.productTypeMax ký tự; rỗng = không lọc theo loại. */
function readTypeFilter(raw, errors) {
  if (raw === undefined) return '';
  if (typeof raw !== 'string') {
    errors.push({ field: 'type', message: TYPE_INVALID_MESSAGE });
    return '';
  }
  const type = raw.trim();
  if (type.length > LIMITS.productTypeMax) {
    errors.push({ field: 'type', message: TYPE_TOO_LONG_MESSAGE });
    return '';
  }
  return type;
}

/** stock: một giá trị của STOCK_FILTERS (không phân biệt hoa/thường, cắt khoảng trắng); rỗng = không lọc. */
function readStockFilter(raw, errors) {
  if (raw === undefined) return '';
  const stock = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  if (stock === '') return '';
  if (STOCK_FILTERS.includes(stock)) return stock;
  errors.push({ field: 'stock', message: STOCK_MESSAGE });
  return '';
}

/** sort: đúng tên một cột của SORT_FIELDS (phân biệt hoa/thường); thiếu hoặc rỗng → mặc định. */
function readSort(raw, errors) {
  if (raw === undefined || raw === '') return DEFAULT_SORT.sort;
  if (typeof raw === 'string' && SORT_FIELDS.includes(raw)) return raw;
  errors.push({ field: 'sort', message: SORT_MESSAGE });
  return DEFAULT_SORT.sort;
}

/** order: asc | desc (không phân biệt hoa/thường, cắt khoảng trắng); thiếu hoặc rỗng → mặc định. */
function readOrder(raw, errors) {
  if (raw === undefined || raw === '') return DEFAULT_SORT.order;
  const order = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  if (SORT_ORDERS.includes(order)) return order;
  errors.push({ field: 'order', message: ORDER_MESSAGE });
  return DEFAULT_SORT.order;
}

/**
 * Đọc các tham số tìm kiếm, lọc và sắp xếp dùng chung cho danh sách và xuất file (q, type, stock, sort, order).
 * Lỗi được ghi vào mảng errors theo đúng thứ tự trên; giá trị trả về là giá trị hiệu lực
 * (type/stock = '' khi không lọc; sort/order luôn có giá trị).
 * @param {{ q?: unknown, type?: unknown, stock?: unknown, sort?: unknown, order?: unknown }} query
 * @param {Array<{ field: string, message: string }>} errors
 * @returns {{ q: string, type: string, stock: ''|'in'|'low'|'out', sort: string, order: 'asc'|'desc' }}
 */
export function readListCriteria(query, errors) {
  return {
    q: readSearchQuery(query.q, errors),
    type: readTypeFilter(query.type, errors),
    stock: readStockFilter(query.stock, errors),
    sort: readSort(query.sort, errors),
    order: readOrder(query.order, errors),
  };
}

function readPage(raw, errors) {
  if (raw === undefined || raw === '') return 1;
  // Số rất lớn vẫn hợp lệ: sẽ được đưa về trang cuối khi tính phân trang.
  if (typeof raw === 'string' && /^\d+$/.test(raw) && Number(raw) >= 1) return Number(raw);
  errors.push({ field: 'page', message: 'Trang phải là số nguyên dương' });
  return 1;
}

function readPageSize(raw, errors) {
  if (raw === undefined || raw === '') return DEFAULT_PAGE_SIZE;
  const size = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (PAGE_SIZES.includes(size)) return size;
  errors.push({ field: 'pageSize', message: `Số dòng mỗi trang chỉ được là ${PAGE_SIZES.join(' hoặc ')}` });
  return DEFAULT_PAGE_SIZE;
}

function requireProductId(raw) {
  const id = parseProductId(raw);
  if (id === null) throw requestValidationError([{ field: 'id', message: 'Mã sản phẩm không hợp lệ' }]);
  return id;
}

/** ids: mảng 1…LIMITS.bulkIdsMax phần tử, mỗi phần tử là ID hoặc mã SPxxxxxx; trả về ID không trùng, tăng dần. */
function requireIdList(raw) {
  const invalid = () => requestValidationError([{ field: 'ids', message: INVALID_IDS_MESSAGE }]);
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIMITS.bulkIdsMax) throw invalid();
  const ids = raw.map(parseProductId);
  if (ids.includes(null)) throw invalid();
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** Thân yêu cầu dạng object (JSON hoặc multipart); giá trị khác (thiếu, mảng, chuỗi…) coi như rỗng. */
function asObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  return typeof value === 'string' && TRUTHY_FLAGS.has(value.trim().toLowerCase());
}

/**
 * Dịch vụ sản phẩm: quy tắc nghiệp vụ, kiểm tra dữ liệu (dùng shared rules), xử lý ảnh, giao dịch.
 * @param {{ repository: ReturnType<typeof import('../repositories/productRepository.js').createProductRepository>,
 *           imageService: ReturnType<typeof import('./imageService.js').createImageService> }} deps
 */
export function createProductService({ repository, imageService }) {
  /**
   * Quyết định ảnh cho thêm/sửa, ghi lỗi (field image/PathImage) vào errors.
   * Thứ tự ưu tiên: file ảnh mới → removeImage (chỉ khi sửa) → khóa PathImage trong body JSON → giữ ảnh cũ (khi sửa).
   * PathImage chỉ dành cho client gửi JSON; trong multipart nó là trường lạ và bị bỏ qua, nên một trường
   * PathImage rỗng gửi kèm biểu mẫu không thể vô tình xóa ảnh.
   * @returns {{ upload?: { buffer: Buffer, ext: string }, pathImage?: string|null, keep?: true }}
   */
  function resolveImage(input, { file, isMultipart }, { isUpdate }, errors) {
    if (file) {
      const checked = imageService.inspectUpload(file);
      if (!checked.ok) {
        errors.push({ field: 'image', message: checked.message });
        return {};
      }
      return { upload: { buffer: file.buffer, ext: checked.ext } };
    }
    if (isUpdate && isTruthyFlag(input.removeImage)) return { pathImage: null };
    if (!isMultipart && Object.hasOwn(input, 'PathImage')) {
      const reference = imageService.checkReference(input.PathImage);
      if (!reference.ok) {
        errors.push({ field: 'PathImage', message: reference.message });
        return {};
      }
      return { pathImage: reference.value };
    }
    return isUpdate ? { keep: true } : { pathImage: null };
  }

  /**
   * Ghi ảnh mới (nếu có) rồi mới ghi database; nếu bước ghi database lỗi thì xóa ngay file vừa ghi.
   * @param {{ upload?: object, pathImage?: string|null }} image
   * @param {(pathImage: string|null) => T} write hàm ghi database (đồng bộ)
   * @template T
   */
  async function persistWithImage(image, write) {
    if (!image.upload) return write(image.pathImage ?? null);
    const pathImage = await imageService.saveUpload(image.upload);
    try {
      return write(pathImage);
    } catch (err) {
      await imageService.discardUpload(pathImage);
      throw err;
    }
  }

  /** Nạp toàn bộ sản phẩm theo ids; thiếu bất kỳ ID nào → 404 (dùng bên trong giao dịch). */
  function loadAllOrThrow(ids, action) {
    const found = repository.findByIds(ids);
    const foundIds = new Set(found.map((product) => product.ProductID));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length) {
      throw productsNotFoundError(missing, ids.length > 1 ? `chưa ${action} sản phẩm nào` : '');
    }
    return found;
  }

  return {
    /**
     * Danh sách có phân trang, tìm kiếm, lọc (loại, tình trạng kho) và sắp xếp; các điều kiện kết hợp bằng AND.
     * Trang vượt quá tổng số trang được đưa về trang cuối (ví dụ sau khi xóa hết trang cuối), giao diện dùng lại
     * pagination.page trả về. summary thống kê mọi sản phẩm khớp bộ lọc (không chỉ trang hiện tại);
     * pagination.total lấy từ chính summary nên luôn bằng summary.totalProducts.
     * @param {{ page?: unknown, pageSize?: unknown, q?: unknown, type?: unknown, stock?: unknown,
     *           sort?: unknown, order?: unknown }} [query]
     */
    list(query = {}) {
      const errors = [];
      const requestedPage = readPage(query.page, errors);
      const pageSize = readPageSize(query.pageSize, errors);
      const { q, type, stock, sort, order } = readListCriteria(query, errors);
      if (errors.length) throw requestValidationError(errors);

      const filter = { tokens: buildSearchTokens(q), type, stock };
      const summary = repository.summarize(filter);
      const total = summary.totalProducts;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const data = repository.findPage({ ...filter, sort, order, limit: pageSize, offset: (page - 1) * pageSize });
      return {
        data,
        pagination: { page, pageSize, total, totalPages },
        q,
        filters: { type, stock, sort, order },
        summary,
      };
    },

    /** Các loại sản phẩm đang có kèm số lượng sản phẩm mỗi loại (không phụ thuộc tham số tìm kiếm/lọc nào). */
    listTypes() {
      return { data: repository.listTypes() };
    },

    /** @param {unknown} rawId ID hoặc mã "SP000012" */
    getById(rawId) {
      const id = requireProductId(rawId);
      const product = repository.findById(id);
      if (!product) throw productsNotFoundError([id]);
      return { data: product };
    },

    /**
     * Thêm sản phẩm từ multipart (kèm file image) hoặc JSON (kèm PathImage tham chiếu ảnh đã có).
     * ProductID, CreateDate, UpdateDate và trường lạ trong body bị bỏ qua.
     * @param {{ body?: unknown, file?: object, isMultipart?: boolean }} request
     */
    async create({ body, file, isMultipart = false }) {
      const input = asObject(body);
      const { value, errors } = validateProductInput(input);
      const image = resolveImage(input, { file, isMultipart }, { isUpdate: false }, errors);
      if (errors.length) throw validationError(errors);

      return persistWithImage(image, (pathImage) => {
        const now = nowUtcIso();
        const product = repository.insert({ ...value, PathImage: pathImage, CreateDate: now, UpdateDate: now });
        return { data: product, message: `Đã thêm sản phẩm ${formatProductCode(product.ProductID)}` };
      });
    },

    /**
     * Cập nhật đầy đủ 6 trường sửa được; không chọn ảnh mới thì giữ ảnh cũ. File ảnh cũ không bị xóa.
     * @param {unknown} rawId
     * @param {{ body?: unknown, file?: object, isMultipart?: boolean }} request
     */
    async update(rawId, { body, file, isMultipart = false }) {
      const id = requireProductId(rawId);
      const existing = repository.findById(id);
      if (!existing) throw productsNotFoundError([id]);

      const input = asObject(body);
      const { value, errors } = validateProductInput(input);
      const image = resolveImage(input, { file, isMultipart }, { isUpdate: true }, errors);
      if (errors.length) throw validationError(errors);

      const resolved = image.keep ? { pathImage: existing.PathImage } : image;
      return persistWithImage(resolved, (pathImage) => {
        const product = repository.update(id, { ...value, PathImage: pathImage, UpdateDate: nowUtcIso() });
        // Sản phẩm có thể bị xóa bởi yêu cầu khác trong lúc đang ghi ảnh.
        if (!product) throw productsNotFoundError([id]);
        return { data: product, message: `Đã cập nhật sản phẩm ${formatProductCode(id)}` };
      });
    },

    /** Xóa một sản phẩm; file ảnh được giữ lại vì bản sao có thể dùng chung. */
    remove(rawId) {
      const id = requireProductId(rawId);
      if (repository.deleteById(id) === 0) throw productsNotFoundError([id]);
      return { data: { deleted: 1, ids: [id] }, message: `Đã xóa sản phẩm ${formatProductCode(id)}` };
    },

    /**
     * Xóa nhiều sản phẩm trong một giao dịch: thiếu bất kỳ ID nào thì không xóa gì.
     * @param {unknown} body `{ ids: [...] }`
     */
    bulkDelete(body) {
      const ids = requireIdList(asObject(body).ids);
      const deleted = repository.transaction(() => {
        loadAllOrThrow(ids, 'xóa');
        return repository.deleteByIds(ids);
      });
      return { data: { deleted, ids }, message: `Đã xóa ${formatNumberVi(deleted)} sản phẩm` };
    },

    /**
     * Sao chép một hoặc nhiều sản phẩm trong một giao dịch, theo thứ tự ProductID tăng dần.
     * Bản sao có ID và ngày mới, tên thêm hậu tố " (bản sao)", dùng chung đường dẫn ảnh với bản gốc.
     * @param {unknown} body `{ ids: [...] }`
     */
    bulkCopy(body) {
      const ids = requireIdList(asObject(body).ids);
      const copies = repository.transaction(() => {
        const originals = loadAllOrThrow(ids, 'sao chép').sort((a, b) => a.ProductID - b.ProductID);
        const now = nowUtcIso();
        return originals.map((original) =>
          repository.insert({
            ProductName: buildCopyName(original.ProductName),
            PathImage: original.PathImage,
            ProductType: original.ProductType,
            Quantity: original.Quantity,
            Unit: original.Unit,
            Price: original.Price,
            Description: original.Description,
            CreateDate: now,
            UpdateDate: now,
          }),
        );
      });
      return { data: copies, message: `Đã sao chép ${formatNumberVi(copies.length)} sản phẩm` };
    },
  };
}
