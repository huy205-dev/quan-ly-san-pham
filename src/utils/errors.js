import { VALIDATION_MESSAGE, formatNumberVi, formatProductCode } from '../../shared/productRules.js';

/** Mã lỗi của API (trường error.code trong phản hồi JSON). */
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FILE_ERROR: 'FILE_ERROR',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  IMPORT_VALIDATION_ERROR: 'IMPORT_VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

/**
 * Lỗi nghiệp vụ mang sẵn HTTP status, mã lỗi và chi tiết; errorHandler chuyển thành envelope
 * `{ error: { code, message, details, format? } }`.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code một giá trị của ERROR_CODES
   * @param {string} message thông báo tiếng Việt cho người dùng
   * @param {{ details?: object[], format?: string }} [options]
   */
  constructor(status, code, message, { details = [], format } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.format = format;
  }

  /** Thân phản hồi JSON theo envelope lỗi chung. */
  toResponseBody() {
    const error = { code: this.code, message: this.message, details: this.details };
    if (this.format) error.format = this.format;
    return { error };
  }
}

/**
 * 400 VALIDATION_ERROR (dữ liệu biểu mẫu, tham số, JSON hỏng, nội dung ảnh không hợp lệ).
 * @param {object[]} [details]
 * @param {string} [message]
 */
export function validationError(details = [], message = VALIDATION_MESSAGE) {
  return new AppError(400, ERROR_CODES.VALIDATION_ERROR, message, { details });
}

/**
 * 400 cho tham số yêu cầu (id, ids, page, pageSize, q, format): khi chỉ có một lỗi thì dùng luôn
 * thông báo của lỗi đó làm thông báo chính để giao diện hiển thị rõ ràng.
 * @param {Array<{ field: string, message: string }>} details
 */
export function requestValidationError(details) {
  return validationError(details, details.length === 1 ? details[0].message : VALIDATION_MESSAGE);
}

/**
 * 404 NOT_FOUND chung (ví dụ: đường dẫn API không tồn tại).
 * @param {string} message
 * @param {object[]} [details]
 */
export function notFoundError(message, details = []) {
  return new AppError(404, ERROR_CODES.NOT_FOUND, message, { details });
}

/**
 * 404 khi không tìm thấy một hoặc nhiều sản phẩm; mỗi ID thiếu có một dòng chi tiết.
 * @param {number[]} ids các ID không tồn tại
 * @param {string} [suffix] phần nối thêm vào thông báo chính, ví dụ "chưa xóa sản phẩm nào"
 */
export function productsNotFoundError(ids, suffix = '') {
  const details = ids.map((id) => ({ id, message: `Không tìm thấy sản phẩm ${formatProductCode(id)}` }));
  const head = ids.length === 1 ? details[0].message : `Không tìm thấy ${formatNumberVi(ids.length)} sản phẩm`;
  return notFoundError(suffix ? `${head}, ${suffix}` : head, details);
}

/**
 * 400 FILE_ERROR: thiếu file, sai loại file, file hỏng, sai cấu trúc file import…
 * @param {string} message
 * @param {object[]} [details]
 */
export function fileError(message, details = []) {
  return new AppError(400, ERROR_CODES.FILE_ERROR, message, { details });
}

/**
 * 413 FILE_TOO_LARGE: ảnh quá 5 MB, file import quá 10 MB, thân JSON quá 1 MB.
 * @param {string} message
 * @param {object[]} [details]
 */
export function fileTooLargeError(message, details = []) {
  return new AppError(413, ERROR_CODES.FILE_TOO_LARGE, message, { details });
}

/**
 * 400 IMPORT_VALIDATION_ERROR: lỗi theo dòng/trường trong file import; không sản phẩm nào được ghi.
 * @param {'xlsx'|'json'|'xml'} format
 * @param {Array<{ row: number, field: string|null, message: string }>} details
 */
export function importValidationError(format, details) {
  const message = `File có ${formatNumberVi(details.length)} lỗi, chưa nhập sản phẩm nào`;
  return new AppError(400, ERROR_CODES.IMPORT_VALIDATION_ERROR, message, { details, format });
}

/** 500 INTERNAL_ERROR với thông báo chung (chi tiết chỉ ghi log phía server). */
export function internalError() {
  return new AppError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    'Đã xảy ra lỗi không mong muốn trên máy chủ. Vui lòng thử lại sau.',
  );
}
