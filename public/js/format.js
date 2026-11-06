/**
 * Định dạng dữ liệu hiển thị và dựng phần tử DOM an toàn.
 * Mọi dữ liệu người dùng đi vào DOM qua textContent / thuộc tính, không bao giờ dựng từ chuỗi HTML.
 */
import {
  STOCK_LABELS, formatNumberVi, formatProductCode, normalizeImageReference, normalizeSearchText, stockStatus,
} from '/shared/productRules.js';
import { ApiError } from './api.js';

/** Ký hiệu hiển thị cho giá trị rỗng. */
export const EMPTY_TEXT = '—';

/** Số bảng màu pastel cho loại sản phẩm ([data-tone="0"] … [data-tone="7"] trong styles.css). */
const TONE_COUNT = 8;

/** Chữ ngắn của nhãn tình trạng kho trong bảng (chi tiết dùng STOCK_LABELS đầy đủ). */
const STOCK_SHORT_LABELS = Object.freeze({ low: 'Sắp hết', out: 'Hết hàng' });

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const UNEXPECTED_ERROR_MESSAGE = 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VIETNAM_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * Ngày giờ ISO-8601 (UTC) → "dd/MM/yyyy HH:mm:ss" theo giờ Việt Nam.
 * Ghép từng phần của formatToParts để không phụ thuộc thứ tự mặc định của locale.
 * @param {string|number|Date|null|undefined} value
 * @returns {string} "—" nếu rỗng hoặc không hợp lệ
 */
export function formatDateTime(value) {
  if (value === null || value === undefined || value === '') return EMPTY_TEXT;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_TEXT;
  const parts = {};
  for (const part of dateTimeFormatter.formatToParts(date)) parts[part.type] = part.value;
  // Một số engine trả "24" cho nửa đêm khi hour12 = false.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.day}/${parts.month}/${parts.year} ${hour}:${parts.minute}:${parts.second}`;
}

/**
 * Số nguyên theo kiểu Việt Nam (1.250.000); rỗng → "—".
 * @param {unknown} value
 * @returns {string}
 */
export function formatInteger(value) {
  if (value === null || value === undefined || value === '') return EMPTY_TEXT;
  const n = Number(value);
  // Tổng giá trị tồn kho có thể từ 1e21 trở lên, khi đó String(n) ra dạng "1e+21": đổi sang BigInt
  // để vẫn hiện đủ chữ số (nhóm hàng nghìn giống formatNumberVi).
  if (Number.isFinite(n) && n >= 1e21) return BigInt(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const text = formatNumberVi(value);
  return text === '' ? EMPTY_TEXT : text;
}

/**
 * Giá tiền VNĐ: formatNumberVi(price) + ' ₫'.
 * @param {unknown} value
 * @returns {string}
 */
export function formatMoney(value) {
  const text = formatInteger(value);
  return text === EMPTY_TEXT ? text : `${text} ₫`;
}

/**
 * Chuỗi hiển thị; null/rỗng → "—".
 * @param {unknown} value
 * @returns {string}
 */
export function displayText(value) {
  if (value === null || value === undefined) return EMPTY_TEXT;
  const text = String(value);
  return text.trim() === '' ? EMPTY_TEXT : text;
}

/**
 * Dung lượng file dễ đọc, dấu thập phân kiểu Việt Nam (1,5 MB).
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return EMPTY_TEXT;
  if (size < 1024) return `${formatNumberVi(size)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${String(Math.round(value * 10) / 10).replace('.', ',')} ${units[unit]}`;
}

/**
 * Nhãn ngắn của sản phẩm: "SP000001 – Tên sản phẩm".
 * @param {{ ProductID: number, ProductName?: string|null }} product
 * @returns {string}
 */
export function formatProductLabel(product) {
  const code = formatProductCode(product.ProductID);
  return product.ProductName ? `${code} – ${product.ProductName}` : code;
}

/**
 * Tông màu cố định (0–7) của một loại sản phẩm, dùng cho nhãn loại và ảnh giữ chỗ.
 * Băm chuỗi đã chuẩn hóa (bỏ dấu, chữ thường) nên "Điện thoại" và "dien thoai" luôn cùng màu.
 * Hàm băm: 32 bit thấp của cyrb53 (phân bố đều hơn FNV/djb2 khi chỉ lấy 3 bit cuối).
 * @param {unknown} type
 * @returns {number}
 */
function typeTone(type) {
  const text = normalizeSearchText(type);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return (h1 >>> 0) % TONE_COUNT;
}

/**
 * Chữ cái/chữ số đầu tiên của tên (viết hoa) cho ảnh giữ chỗ; không có thì "?".
 * @param {unknown} name
 * @returns {string}
 */
function productInitial(name) {
  const match = /[\p{L}\p{N}]\p{M}*/u.exec(String(name ?? ''));
  return match ? match[0].normalize('NFC').toLocaleUpperCase('vi-VN') : '?';
}

/**
 * Nhãn loại sản phẩm tô theo tông màu của loại.
 * @param {string} type
 * @returns {HTMLElement}
 */
export function typeTag(type) {
  return el('span', { className: 'tag', title: type, dataset: { tone: String(typeTone(type)) }, text: type });
}

/**
 * Ảnh giữ chỗ khi sản phẩm không có ảnh: ô vuông bo góc với chữ cái đầu của tên, tô theo tông màu của loại.
 * Chỉ để trang trí (aria-hidden); nơi dùng tự kèm nhãn truy cập như "Không có ảnh".
 * @param {{ ProductName?: string|null, ProductType?: string|null }} product
 * @param {string} className
 * @returns {HTMLElement}
 */
export function initialPlaceholder(product, className) {
  return el('span', {
    className,
    dataset: { tone: String(typeTone(product.ProductType)) },
    'aria-hidden': 'true',
    text: productInitial(product.ProductName),
  });
}

/**
 * Nhãn tình trạng kho theo stockStatus() dùng chung.
 * compact (bảng): chỉ "Sắp hết" / "Hết hàng", còn hàng thì không có nhãn; đầy đủ (chi tiết): cả ba trạng thái.
 * @param {unknown} quantity
 * @param {{ compact?: boolean }} [options]
 * @returns {HTMLElement|null}
 */
export function stockBadge(quantity, { compact = false } = {}) {
  if (quantity === null || quantity === undefined || quantity === '') return null;
  const status = stockStatus(quantity);
  if (compact && status === 'in') return null;
  return el('span', {
    className: 'stock-badge',
    dataset: { stock: status },
    text: compact ? STOCK_SHORT_LABELS[status] : STOCK_LABELS[status],
  });
}

/**
 * URL ảnh an toàn để gán vào <img src>: chỉ nhận đường dẫn /uploads/<tên-file-hợp-lệ>.
 * @param {unknown} path
 * @returns {string|null}
 */
export function imageUrl(path) {
  const result = normalizeImageReference(path);
  return result.ok ? result.value : null;
}

/**
 * Câu thông báo lỗi cho người dùng từ ApiError (kèm tối đa 3 chi tiết).
 * Lỗi không phải ApiError là lỗi lập trình: chỉ hiện câu chung, không lộ nội dung kỹ thuật.
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (!(error instanceof ApiError)) return UNEXPECTED_ERROR_MESSAGE;
  const message = error.message || UNEXPECTED_ERROR_MESSAGE;
  const details = error.details
    .map((detail) => detail.message)
    .filter((text) => typeof text === 'string' && text !== '' && text !== message);
  if (details.length === 0) return message;
  const shown = details.slice(0, 3).join('; ');
  const more = details.length > 3 ? ` (và ${formatNumberVi(details.length - 3)} lỗi khác)` : '';
  return `${message.replace(/[.:]\s*$/, '')}: ${shown}${more}`;
}

/**
 * Tạo phần tử DOM. Thuộc tính đặc biệt: text (textContent), className, dataset.
 * Giá trị boolean/number gán qua property (checked, disabled, hidden, colSpan…), chuỗi qua setAttribute.
 * Con là Node hoặc chuỗi (chuỗi thành text node). null/undefined/false bị bỏ qua.
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @param {...(Node|string|number|null|undefined|false|Array<Node|string>)} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'className') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (typeof value === 'boolean' || typeof value === 'number') node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/**
 * Biểu tượng SVG từ bộ icon nội tuyến trong index.html (clone khuôn <template id="icon-template">).
 * @param {string} name tên icon, ví dụ "edit" → #icon-edit
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function icon(name, className = 'icon') {
  const template = /** @type {HTMLTemplateElement} */ (document.getElementById('icon-template'));
  const svg = /** @type {SVGSVGElement} */ (template.content.firstElementChild.cloneNode(true));
  svg.setAttribute('class', className);
  svg.querySelector('use').setAttribute('href', `#icon-${name}`);
  return svg;
}
