import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_URL_PREFIX, checkImageFileMeta, normalizeImageReference } from '../../shared/productRules.js';

const INVALID_IMAGE_CONTENT_MESSAGE = 'Nội dung file không phải ảnh PNG, JPEG hoặc WebP hợp lệ';
const MISSING_IMAGE_MESSAGE = 'Ảnh không tồn tại trong ứng dụng';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Chữ ký (magic bytes) của các định dạng ảnh được nhận; đuôi file lưu lấy theo định dạng thật. */
const IMAGE_SIGNATURES = [
  { ext: '.png', test: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE) },
  { ext: '.jpg', test: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  {
    ext: '.webp',
    test: (buffer) =>
      buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP',
  },
];

/**
 * Nhận diện định dạng ảnh theo nội dung file (không tin đuôi file hay MIME do trình duyệt gửi).
 * @param {Buffer} buffer
 * @returns {'.png'|'.jpg'|'.webp'|null}
 */
export function detectImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  return IMAGE_SIGNATURES.find((signature) => signature.test(buffer))?.ext ?? null;
}

/**
 * Dịch vụ ảnh: kiểm tra ảnh upload, ghi file với tên ngẫu nhiên, kiểm tra tham chiếu PathImage.
 * Ảnh cũ không bao giờ bị xóa khi sửa/xóa sản phẩm vì các bản sao có thể dùng chung đường dẫn ảnh.
 * @param {{ uploadsDir: string }} options
 */
export function createImageService({ uploadsDir }) {
  const root = path.resolve(uploadsDir);
  /** pathImage đã chuẩn hóa ("/uploads/<tên hợp lệ>") nên không thể thoát ra ngoài thư mục uploads. */
  const toFilePath = (pathImage) => path.join(root, pathImage.slice(UPLOAD_URL_PREFIX.length));

  return {
    /**
     * Kiểm tra file ảnh Multer (đuôi, MIME, dung lượng, magic bytes) mà chưa ghi gì ra đĩa.
     * @param {{ originalname: string, mimetype: string, size: number, buffer: Buffer }} file
     * @returns {{ ok: true, ext: string } | { ok: false, message: string }}
     */
    inspectUpload(file) {
      const metaError = checkImageFileMeta(file);
      if (metaError) return { ok: false, message: metaError };
      const ext = detectImageExtension(file.buffer);
      return ext ? { ok: true, ext } : { ok: false, message: INVALID_IMAGE_CONTENT_MESSAGE };
    },

    /**
     * Ghi ảnh đã kiểm tra vào thư mục uploads với tên ngẫu nhiên (flag "wx": không ghi đè file có sẵn).
     * @param {{ buffer: Buffer, ext: string }} upload
     * @returns {Promise<string>} PathImage dạng "/uploads/<uuid>.<ext>"
     */
    async saveUpload({ buffer, ext }) {
      const fileName = `${crypto.randomUUID()}${ext}`;
      await fs.promises.mkdir(root, { recursive: true });
      await fs.promises.writeFile(path.join(root, fileName), buffer, { flag: 'wx' });
      return UPLOAD_URL_PREFIX + fileName;
    },

    /**
     * Xóa file ảnh vừa ghi trong cùng yêu cầu khi bước ghi database thất bại (tránh file mồ côi).
     * Không dùng cho ảnh của sản phẩm đã lưu.
     * @param {string} pathImage
     */
    async discardUpload(pathImage) {
      await fs.promises.rm(toFilePath(pathImage), { force: true });
    },

    /**
     * Kiểm tra giá trị PathImage do client/file import gửi: đúng dạng /uploads/<tên-file> và file có thật.
     * @param {unknown} value
     * @returns {{ ok: true, value: string|null } | { ok: false, message: string }}
     */
    checkReference(value) {
      const normalized = normalizeImageReference(value);
      if (!normalized.ok || normalized.value === null) return normalized;
      let exists = false;
      try {
        exists = fs.statSync(toFilePath(normalized.value), { throwIfNoEntry: false })?.isFile() ?? false;
      } catch {
        exists = false; // ví dụ tên thiết bị đặc biệt của Windows: coi như không có ảnh
      }
      return exists ? normalized : { ok: false, message: MISSING_IMAGE_MESSAGE };
    },
  };
}
