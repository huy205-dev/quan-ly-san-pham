import multer from 'multer';
import { IMAGE_RULES, IMPORT_RULES, checkImageFileMeta, checkImportFileMeta } from '../../shared/productRules.js';
import { AppError, fileError, fileTooLargeError, validationError } from '../utils/errors.js';

/**
 * Giới hạn cho các trường văn bản đi kèm file (chặn yêu cầu multipart quá nhiều/quá dài).
 * fieldSize đủ rộng để Mô tả dài vẫn tới được bước kiểm tra và nhận thông báo lỗi theo trường.
 */
const TEXT_LIMITS = Object.freeze({
  fieldNameSize: 100,
  fieldSize: 100 * 1024,
  fields: 30,
  parts: 32,
  fieldNestingDepth: 2,
  fieldArrayIndexLimit: 20,
});

/** Chuyển lỗi của Multer/busboy thành AppError tiếng Việt với field tương ứng. */
function toUploadError(err, { field, tooLargeMessage }) {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return fileTooLargeError(tooLargeMessage, [{ field, message: tooLargeMessage }]);
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      const message = `Chỉ nhận một file trong trường "${field}"`;
      return fileError(message, [{ field, message }]);
    }
    return validationError([], 'Dữ liệu biểu mẫu vượt quá giới hạn cho phép');
  }
  // Còn lại là lỗi phân tích multipart (thiếu boundary, dữ liệu bị cắt cụt…) do client gửi sai.
  return validationError([], 'Dữ liệu gửi lên không đúng định dạng multipart/form-data');
}

/**
 * Middleware nhận đúng một file (bộ nhớ RAM, không ghi đĩa) cho trường `field`.
 * Yêu cầu không phải multipart được cho qua nguyên vẹn (ví dụ JSON).
 */
function createSingleFileUpload({ field, maxBytes, checkMeta, tooLargeMessage }) {
  const middleware = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8', // tên file tiếng Việt do trình duyệt gửi ở dạng UTF-8
    limits: { ...TEXT_LIMITS, fileSize: maxBytes, files: 1 },
    fileFilter(req, file, callback) {
      const message = checkMeta(file);
      callback(message ? fileError(message, [{ field, message }]) : null, !message);
    },
  }).single(field);

  return function singleFileUpload(req, res, next) {
    middleware(req, res, (err) => {
      if (err) next(toUploadError(err, { field, tooLargeMessage }));
      else next();
    });
  };
}

/**
 * Upload ảnh sản phẩm (trường "image"): PNG/JPEG/WebP, tối đa 5 MB.
 * fileFilter chỉ kiểm tra đuôi/MIME; nội dung thật (magic bytes) do imageService kiểm tra.
 */
export function createImageUpload() {
  return createSingleFileUpload({
    field: 'image',
    maxBytes: IMAGE_RULES.maxBytes,
    checkMeta: checkImageFileMeta,
    tooLargeMessage: 'Ảnh vượt quá dung lượng tối đa 5 MB',
  });
}

/** Upload file nhập (trường "file"): .xlsx, .json, .xml, tối đa 10 MB. */
export function createImportUpload() {
  return createSingleFileUpload({
    field: 'file',
    maxBytes: IMPORT_RULES.maxBytes,
    checkMeta: checkImportFileMeta,
    tooLargeMessage: 'File nhập vượt quá dung lượng tối đa 10 MB',
  });
}
