import { AppError, ERROR_CODES, fileTooLargeError, internalError, notFoundError, validationError } from '../utils/errors.js';

/** Yêu cầu thuộc API (/api hoặc /api/...) thì luôn trả lỗi dạng JSON. */
function isApiRequest(req) {
  const pathname = (req.originalUrl ?? req.url ?? '').split('?')[0].toLowerCase();
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** Chuẩn hóa mọi lỗi về AppError; null nghĩa là lỗi không lường trước (500). */
function normalizeError(err) {
  if (err instanceof AppError) return err;
  switch (err?.type) {
    case 'entity.parse.failed':
      return validationError([], 'Dữ liệu JSON gửi lên không hợp lệ');
    case 'entity.too.large':
      return fileTooLargeError('Dữ liệu gửi lên vượt quá dung lượng cho phép (tối đa 1 MB)');
    case 'charset.unsupported':
      return new AppError(415, ERROR_CODES.VALIDATION_ERROR, 'Dữ liệu JSON phải được mã hóa UTF-8');
    case 'encoding.unsupported':
      return new AppError(415, ERROR_CODES.VALIDATION_ERROR, 'Kiểu nén dữ liệu gửi lên không được hỗ trợ');
    default:
      break;
  }
  // Lỗi 4xx khác của Express/body-parser/serve-static (URL không giải mã được, yêu cầu bị hủy…).
  const status = Number(err?.status ?? err?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    if (status === 404) return notFoundError('Không tìm thấy tài nguyên yêu cầu');
    if (status === 403) return new AppError(403, ERROR_CODES.VALIDATION_ERROR, 'Không có quyền truy cập tài nguyên này');
    return new AppError(status, ERROR_CODES.VALIDATION_ERROR, 'Yêu cầu không hợp lệ');
  }
  return null;
}

/** Bắt mọi đường dẫn /api/* không khớp route nào → 404 JSON. */
export function apiNotFoundHandler(req, res, next) {
  next(notFoundError(`Không tìm thấy API ${req.method} ${req.originalUrl.split('?')[0]}`));
}

/** Trang/tệp tĩnh không tồn tại → 404 dạng văn bản. */
export function pageNotFoundHandler(req, res) {
  res.status(404).type('text/plain; charset=utf-8').send('Không tìm thấy trang hoặc tệp yêu cầu');
}

/**
 * Bộ xử lý lỗi cuối cùng: JSON envelope cho /api/*, văn bản thuần cho phần còn lại.
 * Lỗi không lường trước được ghi log phía server, client chỉ nhận thông báo chung (không có stack trace).
 * Express nhận diện middleware xử lý lỗi qua đúng 4 tham số, nên giữ cả `next`.
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }
  let appError = normalizeError(err);
  if (!appError) {
    console.error('[Lỗi máy chủ]', err);
    appError = internalError();
  }
  res.status(appError.status);
  if (isApiRequest(req)) {
    res.json(appError.toResponseBody());
  } else {
    res.type('text/plain; charset=utf-8').send(appError.message);
  }
}
