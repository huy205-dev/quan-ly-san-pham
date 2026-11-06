/**
 * Quy tắc dữ liệu sản phẩm dùng chung cho frontend (trình duyệt) và backend (Node.js).
 *
 * - Backend import trực tiếp file này (đường dẫn tương đối).
 * - Express phục vụ file này tại /shared/productRules.js để trình duyệt import.
 *
 * Vì chạy ở cả hai môi trường, file chỉ dùng JavaScript chuẩn (ES2020+),
 * không phụ thuộc thư viện ngoài, API riêng của Node.js hay của trình duyệt.
 */

/** Đúng 10 trường của bảng Products, theo thứ tự đề bài. */
export const PRODUCT_FIELDS = Object.freeze([
  'ProductID',
  'ProductName',
  'PathImage',
  'ProductType',
  'Quantity',
  'Unit',
  'Price',
  'Description',
  'CreateDate',
  'UpdateDate',
]);

/** Các trường người dùng nhập qua biểu mẫu (PathImage xử lý riêng qua upload ảnh). */
export const EDITABLE_FIELDS = Object.freeze([
  'ProductName',
  'ProductType',
  'Quantity',
  'Unit',
  'Price',
  'Description',
]);

/** Các trường do server tự sinh; giá trị client gửi lên (form, API, file import) bị bỏ qua. */
export const SERVER_MANAGED_FIELDS = Object.freeze(['ProductID', 'CreateDate', 'UpdateDate']);

/** Các trường được đọc khi import (cũng là các cột của file mẫu), theo thứ tự đề bài. */
export const IMPORTABLE_FIELDS = Object.freeze([
  'ProductName',
  'PathImage',
  'ProductType',
  'Quantity',
  'Unit',
  'Price',
  'Description',
]);

/** Các cột/trường bắt buộc phải có trong file import. */
export const REQUIRED_IMPORT_FIELDS = Object.freeze([
  'ProductName',
  'ProductType',
  'Quantity',
  'Unit',
  'Price',
]);

/** Nhãn hiển thị (tiêu đề cột, nhãn biểu mẫu, chi tiết). */
export const FIELD_LABELS = Object.freeze({
  ProductID: 'Mã sản phẩm',
  ProductName: 'Tên sản phẩm',
  PathImage: 'Ảnh',
  ProductType: 'Loại sản phẩm',
  Quantity: 'Số lượng',
  Unit: 'Đơn vị tính',
  Price: 'Giá (VNĐ)',
  Description: 'Mô tả',
  CreateDate: 'Ngày tạo',
  UpdateDate: 'Ngày cập nhật',
});

/** Tên ngắn dùng trong câu thông báo lỗi. */
const MESSAGE_NAMES = Object.freeze({
  ProductID: 'Mã sản phẩm',
  ProductName: 'Tên sản phẩm',
  PathImage: 'Đường dẫn ảnh',
  ProductType: 'Loại sản phẩm',
  Quantity: 'Số lượng',
  Unit: 'Đơn vị tính',
  Price: 'Giá',
  Description: 'Mô tả',
  CreateDate: 'Ngày tạo',
  UpdateDate: 'Ngày cập nhật',
});

/** Giới hạn dữ liệu. Độ dài chuỗi tính theo String.prototype.length (giống thuộc tính maxlength của HTML). */
export const LIMITS = Object.freeze({
  productNameMax: 200,
  productTypeMax: 100,
  unitMax: 50,
  descriptionMax: 2000,
  pathImageMax: 255,
  quantityMax: 1_000_000_000,
  priceMax: 1_000_000_000_000,
  searchMax: 200,
  bulkIdsMax: 1000,
});

/** Số dòng mỗi trang được phép chọn; mặc định 10. */
export const PAGE_SIZES = Object.freeze([10, 15]);
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Các cột được phép sắp xếp (tham số sort của API). Mặc định: ProductID giảm dần (mới nhất trước).
 * Cột chữ được sắp theo chuỗi đã bỏ dấu (vn_norm) để "Áo" đứng cạnh "Ao".
 */
export const SORT_FIELDS = Object.freeze([
  'ProductID',
  'ProductName',
  'ProductType',
  'Quantity',
  'Unit',
  'Price',
  'CreateDate',
  'UpdateDate',
]);
export const TEXT_SORT_FIELDS = Object.freeze(['ProductName', 'ProductType', 'Unit']);
export const SORT_ORDERS = Object.freeze(['asc', 'desc']);
export const DEFAULT_SORT = Object.freeze({ sort: 'ProductID', order: 'desc' });

/** Ngưỡng "sắp hết hàng": 0 < Quantity < LOW_STOCK_THRESHOLD. */
export const LOW_STOCK_THRESHOLD = 10;

/** Bộ lọc tình trạng kho (tham số stock của API). */
export const STOCK_FILTERS = Object.freeze(['in', 'low', 'out']);
export const STOCK_LABELS = Object.freeze({
  in: 'Còn hàng',
  low: 'Sắp hết hàng',
  out: 'Hết hàng',
});

/**
 * Tình trạng kho của một số lượng: 'out' (= 0), 'low' (1 … LOW_STOCK_THRESHOLD - 1), 'in' (còn lại).
 * @param {number} quantity
 * @returns {'in'|'low'|'out'}
 */
export function stockStatus(quantity) {
  const n = Number(quantity);
  if (!Number.isFinite(n) || n <= 0) return 'out';
  return n < LOW_STOCK_THRESHOLD ? 'low' : 'in';
}

/** Hậu tố thêm vào tên khi sao chép sản phẩm. */
export const COPY_SUFFIX = ' (bản sao)';

/** Tiền tố mã hiển thị: ProductID 1 → SP000001. */
export const PRODUCT_CODE_PREFIX = 'SP';

/** Quy tắc ảnh upload. */
export const IMAGE_RULES = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
  extensions: Object.freeze(['.png', '.jpg', '.jpeg', '.webp']),
  /** Giá trị cho thuộc tính accept của input type=file. */
  accept: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp',
});

/** Quy tắc file import. */
export const IMPORT_RULES = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxProducts: 1000,
  formats: Object.freeze(['xlsx', 'json', 'xml']),
  extensions: Object.freeze(['.xlsx', '.json', '.xml']),
  /** Giá trị cho thuộc tính accept của input type=file. */
  accept: '.xlsx,.json,.xml',
});

/** Định dạng hỗ trợ cho export và file mẫu. */
export const EXPORT_FORMATS = Object.freeze(['xlsx', 'json', 'xml']);

/** Tiền tố URL công khai của ảnh đã upload. */
export const UPLOAD_URL_PREFIX = '/uploads/';

/** Tên file ảnh hợp lệ trong thư mục uploads (không có thư mục con, không có "..", chỉ đuôi ảnh cho phép). */
export const UPLOAD_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.(?:png|jpe?g|webp)$/i;

/** Tiêu đề hộp thoại mặc định cho lỗi dữ liệu. */
export const VALIDATION_MESSAGE = 'Dữ liệu không hợp lệ';

/**
 * Định dạng số theo kiểu Việt Nam (1000000 → "1.000.000").
 * Tự viết để không phụ thuộc dữ liệu ICU của môi trường chạy.
 * @param {number} value
 * @returns {string}
 */
export function formatNumberVi(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const negative = n < 0;
  const digits = String(Math.trunc(Math.abs(n)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negative ? '-' : '') + grouped;
}

/**
 * Mã hiển thị của sản phẩm: 1 → "SP000001", 1234567 → "SP1234567".
 * @param {number|string} id
 * @returns {string} chuỗi rỗng nếu id không hợp lệ
 */
export function formatProductCode(id) {
  const n = typeof id === 'string' && /^\d+$/.test(id.trim()) ? Number(id.trim()) : id;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) return '';
  return PRODUCT_CODE_PREFIX + String(n).padStart(6, '0');
}

/**
 * Đọc ID sản phẩm từ số nguyên dương, chuỗi chữ số ("12") hoặc mã ("SP000012", không phân biệt hoa/thường).
 * @param {unknown} value
 * @returns {number|null} ID hợp lệ hoặc null
 */
export function parseProductId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const match = /^(?:sp)?(\d{1,15})$/i.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Chuẩn hóa chuỗi để tìm kiếm tiếng Việt không phân biệt hoa/thường và dấu:
 * bỏ dấu thanh/dấu mũ (NFD + xóa ký tự tổ hợp), đ/Đ → d, chữ thường, gộp khoảng trắng.
 * Backend đăng ký hàm này làm hàm SQL để so khớp cả hai phía bằng cùng một quy tắc.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tách chuỗi tìm kiếm thành các từ khóa đã chuẩn hóa (không trùng, tối đa 10 từ).
 * Một sản phẩm khớp khi MỖI từ khóa xuất hiện trong ít nhất một trường: mã, tên, mô tả, loại.
 * @param {unknown} q
 * @returns {string[]}
 */
export function buildSearchTokens(q) {
  const normalized = normalizeSearchText(q);
  if (!normalized) return [];
  return [...new Set(normalized.split(' '))].slice(0, 10);
}

/**
 * Tên của bản sao: "Tên" → "Tên (bản sao)". Cắt bớt phần tên gốc nếu vượt độ dài tối đa.
 * @param {string} name
 * @returns {string}
 */
export function buildCopyName(name) {
  const base = String(name ?? '').trim();
  const maxBase = LIMITS.productNameMax - COPY_SUFFIX.length;
  const safeBase = base.length > maxBase ? base.slice(0, maxBase).trimEnd() : base;
  return safeBase + COPY_SUFFIX;
}

function readText(input, field, { required, max }, errors) {
  const raw = input[field];
  const name = MESSAGE_NAMES[field];
  let text;
  if (raw === undefined || raw === null) {
    text = '';
  } else if (typeof raw === 'string') {
    text = raw;
  } else if (typeof raw === 'number' && Number.isFinite(raw)) {
    text = String(raw);
  } else {
    errors.push({ field, message: `${name} không hợp lệ` });
    return null;
  }
  text = text.normalize('NFC').trim();
  if (!text) {
    if (required) errors.push({ field, message: `${name} là bắt buộc` });
    return null;
  }
  if (text.length > max) {
    errors.push({ field, message: `${name} tối đa ${formatNumberVi(max)} ký tự` });
    return null;
  }
  return text;
}

function readNonNegativeInteger(input, field, max, errors) {
  const raw = input[field];
  const name = MESSAGE_NAMES[field];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    errors.push({ field, message: `${name} là bắt buộc` });
    return null;
  }
  let n = Number.NaN;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    n = Number(raw.trim());
  }
  if (!Number.isInteger(n) || n < 0) {
    errors.push({ field, message: `${name} phải là số nguyên không âm` });
    return null;
  }
  if (n > max) {
    errors.push({ field, message: `${name} không được vượt quá ${formatNumberVi(max)}` });
    return null;
  }
  return n + 0; // đổi -0 thành 0
}

/**
 * Kiểm tra và chuẩn hóa dữ liệu sản phẩm người dùng nhập (biểu mẫu, API JSON, một dòng import).
 * - Chuỗi: chấp nhận string hoặc số hữu hạn; chuẩn hóa NFC và cắt khoảng trắng hai đầu.
 * - Số nguyên: chấp nhận số nguyên hoặc chuỗi chỉ gồm chữ số (cho phép khoảng trắng hai đầu).
 * - Bỏ qua ProductID, PathImage, CreateDate, UpdateDate và các trường lạ.
 *
 * @param {Record<string, unknown>} [input]
 * @returns {{
 *   value: { ProductName: string|null, ProductType: string|null, Quantity: number|null,
 *            Unit: string|null, Price: number|null, Description: string|null },
 *   errors: Array<{ field: string, message: string }>
 * }} value chỉ dùng được khi errors rỗng; Description rỗng → null
 */
export function validateProductInput(input) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = [];
  const value = {
    ProductName: readText(source, 'ProductName', { required: true, max: LIMITS.productNameMax }, errors),
    ProductType: readText(source, 'ProductType', { required: true, max: LIMITS.productTypeMax }, errors),
    Quantity: readNonNegativeInteger(source, 'Quantity', LIMITS.quantityMax, errors),
    Unit: readText(source, 'Unit', { required: true, max: LIMITS.unitMax }, errors),
    Price: readNonNegativeInteger(source, 'Price', LIMITS.priceMax, errors),
    Description: readText(source, 'Description', { required: false, max: LIMITS.descriptionMax }, errors),
  };
  return { value, errors };
}

/**
 * Chuẩn hóa giá trị PathImage tham chiếu tới ảnh đã có trong ứng dụng (dùng cho import và API JSON).
 * Chỉ nhận "/uploads/<tên-file>" hoặc "uploads/<tên-file>" với tên file hợp lệ; không nhận URL, data URI,
 * đường dẫn tuyệt đối hay thư mục con. Việc file có tồn tại hay không do backend kiểm tra thêm.
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: string|null } | { ok: false, message: string }}
 *          value null nghĩa là không có ảnh
 */
export function normalizeImageReference(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, message: 'Đường dẫn ảnh không hợp lệ' };
  }
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  const invalid = {
    ok: false,
    message: 'Đường dẫn ảnh chỉ được tham chiếu ảnh đã có trong ứng dụng, dạng /uploads/ten-file.png',
  };
  if (text.length > LIMITS.pathImageMax) return invalid;
  const match = /^\/?uploads\/([^/\\]+)$/.exec(text);
  if (!match || !UPLOAD_FILENAME_PATTERN.test(match[1])) return invalid;
  return { ok: true, value: UPLOAD_URL_PREFIX + match[1] };
}

function extensionOf(fileName) {
  const name = String(fileName ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot) : '';
}

/**
 * Kiểm tra sơ bộ thông tin file ảnh (đuôi, kiểu MIME, dung lượng) trước khi gửi/nhận.
 * Nhận cả đối tượng File của trình duyệt ({ name, type, size }) và file của Multer
 * ({ originalname, mimetype, size }). Nội dung thật của file do backend kiểm tra (magic bytes).
 * @param {{ name?: string, originalname?: string, type?: string, mimetype?: string, size?: number }} file
 * @returns {string|null} thông báo lỗi, hoặc null nếu hợp lệ
 */
export function checkImageFileMeta(file) {
  if (!file) return null;
  const ext = extensionOf(file.name ?? file.originalname);
  const type = String(file.type ?? file.mimetype ?? '').toLowerCase();
  const typeOk = IMAGE_RULES.mimeTypes.includes(type) || type === '' || type === 'application/octet-stream';
  if (!IMAGE_RULES.extensions.includes(ext) || !typeOk) {
    return 'Ảnh phải là file PNG, JPEG hoặc WebP';
  }
  if (typeof file.size === 'number' && file.size > IMAGE_RULES.maxBytes) {
    return 'Ảnh vượt quá dung lượng tối đa 5 MB';
  }
  if (typeof file.size === 'number' && file.size === 0) {
    return 'File ảnh rỗng';
  }
  return null;
}

/**
 * Xác định định dạng file import theo đuôi file.
 * @param {string} fileName
 * @returns {'xlsx'|'json'|'xml'|null}
 */
export function detectImportFormat(fileName) {
  const ext = extensionOf(fileName);
  if (ext === '.xlsx') return 'xlsx';
  if (ext === '.json') return 'json';
  if (ext === '.xml') return 'xml';
  return null;
}

/**
 * Kiểm tra sơ bộ file import (đuôi, dung lượng).
 * @param {{ name?: string, originalname?: string, size?: number }} file
 * @returns {string|null} thông báo lỗi, hoặc null nếu hợp lệ
 */
export function checkImportFileMeta(file) {
  if (!file) return 'Vui lòng chọn file cần nhập';
  if (!detectImportFormat(file.name ?? file.originalname)) {
    return 'Chỉ hỗ trợ file .xlsx, .json hoặc .xml';
  }
  if (typeof file.size === 'number' && file.size > IMPORT_RULES.maxBytes) {
    return 'File nhập vượt quá dung lượng tối đa 10 MB';
  }
  if (typeof file.size === 'number' && file.size === 0) {
    return 'File nhập rỗng';
  }
  return null;
}
