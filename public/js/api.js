/**
 * Lớp gọi API: mọi lệnh fetch của giao diện đều nằm ở đây.
 * Phản hồi thành công có dạng { data, message?, pagination?, q?, filters?, summary? };
 * phản hồi lỗi { error: { code, message, details[], format? } } được chuyển thành ApiError.
 */
import { DEFAULT_SORT } from '/shared/productRules.js';

const API_BASE = '/api/products';
const NETWORK_ERROR_MESSAGE = 'Không kết nối được máy chủ. Vui lòng thử lại.';
const INVALID_RESPONSE_MESSAGE = 'Phản hồi từ máy chủ không hợp lệ. Vui lòng thử lại.';

const STATUS_MESSAGES = {
  400: 'Yêu cầu không hợp lệ.',
  404: 'Không tìm thấy dữ liệu yêu cầu.',
  413: 'Dữ liệu gửi lên vượt quá dung lượng cho phép.',
  500: 'Máy chủ gặp lỗi. Vui lòng thử lại sau.',
};

/** Lỗi từ API (hoặc lỗi mạng) với đầy đủ thông tin để giao diện hiển thị theo trường. */
export class ApiError extends Error {
  /**
   * @param {{ status?: number, code?: string, message?: string,
   *           details?: Array<Record<string, unknown>>, format?: string|null }} info
   */
  constructor({ status = 0, code = 'UNKNOWN_ERROR', message = '', details = [], format = null } = {}) {
    super(message || STATUS_MESSAGES[500]);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.format = format;
  }
}

function fallbackMessage(status) {
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  return status >= 500 ? STATUS_MESSAGES[500] : `Yêu cầu không thành công (mã ${status}).`;
}

function networkError() {
  return new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });
}

async function send(url, init = {}) {
  try {
    return await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    throw networkError();
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Dựng ApiError từ phản hồi không thành công (kể cả khi thân phản hồi không phải JSON). */
async function errorFromResponse(response) {
  const payload = await readJson(response);
  const error = payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object'
    ? payload.error
    : {};
  return new ApiError({
    status: response.status,
    code: typeof error.code === 'string' ? error.code : `HTTP_${response.status}`,
    message: typeof error.message === 'string' && error.message ? error.message : fallbackMessage(response.status),
    details: Array.isArray(error.details)
      ? error.details.filter((detail) => detail !== null && typeof detail === 'object')
      : [],
    format: typeof error.format === 'string' ? error.format : null,
  });
}

/**
 * Gửi yêu cầu và trả về thân JSON đã kiểm tra.
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Record<string, any>>}
 */
async function request(url, init) {
  const response = await send(url, init);
  if (!response.ok) throw await errorFromResponse(response);
  const payload = await readJson(response);
  if (!payload || typeof payload !== 'object') {
    throw new ApiError({ status: response.status, code: 'INVALID_RESPONSE', message: INVALID_RESPONSE_MESSAGE });
  }
  return payload;
}

function jsonRequest(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function productUrl(id) {
  return `${API_BASE}/${encodeURIComponent(String(id))}`;
}

/**
 * Lấy tên file từ header Content-Disposition (hỗ trợ filename*=UTF-8''… và filename="…").
 * @param {string|null} header
 * @returns {string|null}
 */
function fileNameFromDisposition(header) {
  if (!header) return null;
  let name = null;
  const encoded = /filename\*\s*=\s*(?:utf-8|iso-8859-1)?'[^']*'([^;]+)/i.exec(header);
  if (encoded) {
    try {
      name = decodeURIComponent(encoded[1].trim().replace(/^"(.*)"$/, '$1'));
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(header);
    if (plain) name = plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2].trim();
  }
  // Không cho phép ký tự đường dẫn/điều khiển trong tên file tải về.
  const safe = name ? name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() : '';
  return safe || null;
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Thu hồi URL sau một lúc để trình duyệt kịp bắt đầu tải.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Tải file qua fetch → blob → <a download>; lỗi (JSON) được ném thành ApiError để hiện toast. */
async function download(url, fallbackName) {
  const response = await send(url, { headers: { Accept: '*/*' } });
  if (!response.ok) throw await errorFromResponse(response);
  let blob;
  try {
    blob = await response.blob();
  } catch {
    throw networkError();
  }
  const fileName = fileNameFromDisposition(response.headers.get('Content-Disposition')) || fallbackName;
  saveBlob(blob, fileName);
  return { fileName };
}

/**
 * @typedef {object} ListQuery từ khóa, bộ lọc và thứ tự đang áp dụng (dùng chung cho danh sách và xuất file)
 * @property {string} [q]
 * @property {string} [type] loại sản phẩm; rỗng = mọi loại
 * @property {string} [stock] 'in' | 'low' | 'out'; rỗng = mọi tình trạng
 * @property {string} [sort] một trong SORT_FIELDS
 * @property {string} [order] 'asc' | 'desc'
 */

/**
 * Thêm tham số tìm kiếm/lọc/sắp xếp vào URL. Bỏ qua giá trị rỗng và thứ tự mặc định
 * (server dùng đúng DEFAULT_SORT khi thiếu sort/order) để URL gọn như trước khi có tính năng này.
 * @param {URLSearchParams} params
 * @param {ListQuery} query
 */
function appendListQuery(params, { q = '', type = '', stock = '', sort = DEFAULT_SORT.sort, order = DEFAULT_SORT.order }) {
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (stock) params.set('stock', stock);
  if (sort !== DEFAULT_SORT.sort || order !== DEFAULT_SORT.order) {
    params.set('sort', sort);
    params.set('order', order);
  }
  return params;
}

/**
 * Danh sách có phân trang, tìm kiếm, lọc và sắp xếp.
 * @param {{ page: number, pageSize: number } & ListQuery} query
 * @returns {Promise<{ data: object[], pagination: { page: number, pageSize: number, total: number, totalPages: number },
 *                     q: string, filters?: Record<string, string>, summary?: Record<string, number> }>}
 */
export function listProducts({ page, pageSize, ...query }) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return request(`${API_BASE}?${appendListQuery(params, query)}`);
}

/** Các loại sản phẩm đang có kèm số lượng → { data: [{ type, count }] }. */
export function listProductTypes() {
  return request(`${API_BASE}/types`);
}

/** Chi tiết một sản phẩm → { data }. */
export function getProduct(id) {
  return request(productUrl(id));
}

/** Thêm mới (multipart/form-data) → { data, message }. */
export function createProduct(formData) {
  return request(API_BASE, { method: 'POST', body: formData });
}

/** Cập nhật (multipart/form-data) → { data, message }. */
export function updateProduct(id, formData) {
  return request(productUrl(id), { method: 'PUT', body: formData });
}

/** Xóa một sản phẩm → { data: { deleted, ids }, message }. */
export function deleteProduct(id) {
  return request(productUrl(id), { method: 'DELETE' });
}

/** Xóa nhiều sản phẩm trong một giao dịch → { data: { deleted, ids }, message }. */
export function bulkDelete(ids) {
  return request(`${API_BASE}/bulk-delete`, jsonRequest('POST', { ids }));
}

/** Sao chép một/nhiều sản phẩm trong một giao dịch → { data: Product[], message }. */
export function bulkCopy(ids) {
  return request(`${API_BASE}/bulk-copy`, jsonRequest('POST', { ids }));
}

/** Nhập file .xlsx/.json/.xml → { data: { imported, ids }, message }. */
export function importProducts(file) {
  const formData = new FormData();
  formData.append('file', file, file.name);
  return request(`${API_BASE}/import`, { method: 'POST', body: formData });
}

/**
 * Xuất toàn bộ kết quả theo từ khóa, bộ lọc và thứ tự hiện tại (mọi trang, đủ 10 trường).
 * @param {'xlsx'|'json'|'xml'} format
 * @param {ListQuery} [query]
 * @returns {Promise<{ fileName: string }>}
 */
export function downloadExport(format, query = {}) {
  const params = appendListQuery(new URLSearchParams({ format }), query);
  return download(`${API_BASE}/export?${params}`, `san-pham.${format}`);
}

/**
 * Tải file mẫu nhập dữ liệu.
 * @param {'xlsx'|'json'|'xml'} format
 * @returns {Promise<{ fileName: string }>}
 */
export function downloadTemplate(format) {
  const params = new URLSearchParams({ format });
  return download(`${API_BASE}/template?${params}`, `mau-nhap-san-pham.${format}`);
}
