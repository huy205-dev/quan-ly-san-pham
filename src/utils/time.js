/** Việt Nam dùng UTC+7 quanh năm (không có giờ mùa hè), nên một độ lệch cố định là đủ. */
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

const pad2 = (value) => String(value).padStart(2, '0');

/**
 * Thời điểm hiện tại dạng ISO-8601 UTC, ví dụ "2026-11-04T12:04:00.123Z" (dùng cho CreateDate/UpdateDate).
 * @returns {string}
 */
export function nowUtcIso() {
  return new Date().toISOString();
}

/**
 * Định dạng thời điểm theo giờ Việt Nam thành "YYYYMMDD-HHmmss" (dùng đặt tên file export).
 * @param {Date|number|string} [date] mặc định là thời điểm hiện tại
 * @returns {string}
 */
export function formatVietnamTimestamp(date = new Date()) {
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) throw new TypeError('Thời điểm không hợp lệ');
  const local = new Date(time + VIETNAM_OFFSET_MS);
  return (
    `${local.getUTCFullYear()}${pad2(local.getUTCMonth() + 1)}${pad2(local.getUTCDate())}` +
    `-${pad2(local.getUTCHours())}${pad2(local.getUTCMinutes())}${pad2(local.getUTCSeconds())}`
  );
}
