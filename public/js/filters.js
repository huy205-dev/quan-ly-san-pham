/**
 * Thanh lọc cạnh ô tìm kiếm: loại sản phẩm (danh sách từ GET /api/products/types, kèm số lượng) và
 * tình trạng kho. Chỉ hiển thị và báo thay đổi; trạng thái lọc nằm trong main.js.
 */
import {
  LOW_STOCK_THRESHOLD, STOCK_FILTERS, STOCK_LABELS, formatNumberVi, normalizeSearchText,
} from '/shared/productRules.js';
import { el } from './format.js';

/**
 * Nhãn lựa chọn tình trạng kho: "Còn hàng (SL ≥ 10)", "Sắp hết hàng (SL 1–9)", "Hết hàng (SL = 0)".
 * Ghi rõ "SL" (số lượng) để không bị đọc nhầm thành số sản phẩm như "Laptop (4)" ở ô lọc loại.
 */
const STOCK_OPTION_LABELS = Object.freeze({
  in: `${STOCK_LABELS.in} (SL ≥ ${LOW_STOCK_THRESHOLD})`,
  low: `${STOCK_LABELS.low} (SL 1–${LOW_STOCK_THRESHOLD - 1})`,
  out: `${STOCK_LABELS.out} (SL = 0)`,
});

/**
 * Chuẩn hóa danh sách loại từ API. Server lọc loại không phân biệt hoa/thường và dấu, nên các cách viết
 * chỉ khác nhau ở hoa/thường/dấu ("Laptop", "laptop") được gộp thành một lựa chọn (cộng dồn số lượng,
 * hiển thị theo cách viết đầu tiên mà server trả về).
 * @param {unknown} data
 * @returns {Array<{ type: string, count: number }>}
 */
function mergeTypes(data) {
  /** @type {Map<string, { type: string, count: number }>} */
  const groups = new Map();
  for (const item of Array.isArray(data) ? data : []) {
    if (!item || typeof item.type !== 'string' || item.type.trim() === '') continue;
    const count = Number.isSafeInteger(item.count) && item.count >= 0 ? item.count : 0;
    const key = normalizeSearchText(item.type);
    const group = groups.get(key);
    if (group) group.count += count;
    else groups.set(key, { type: item.type, count });
  }
  return [...groups.values()];
}

/**
 * @param {{
 *   onTypeChange: (type: string) => void,
 *   onStockChange: (stock: string) => void,
 *   onClear: () => void,
 * }} handlers
 * @returns {{
 *   setTypes: (data: unknown) => void,
 *   sync: (filters: { type: string, stock: string }) => void,
 * }}
 */
export function createFilterBar({ onTypeChange, onStockChange, onClear }) {
  const typeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('filter-type'));
  const stockSelect = /** @type {HTMLSelectElement} */ (document.getElementById('filter-stock'));
  const clearButton = document.getElementById('btn-clear-filters');
  /** @type {Array<{ type: string, count: number }>} */
  let types = [];
  let current = { type: '', stock: '' };

  stockSelect.replaceChildren(
    el('option', { value: '', text: 'Tất cả tình trạng' }),
    ...STOCK_FILTERS.map((stock) => el('option', { value: stock, text: STOCK_OPTION_LABELS[stock] })),
  );

  function renderTypeOptions() {
    const options = types.map(({ type, count }) => el('option', { value: type, text: `${type} (${formatNumberVi(count)})` }));
    // Loại đang lọc không còn sản phẩm nào (vừa xóa hết): vẫn giữ lựa chọn "(0)" cho tới khi người dùng đổi.
    const key = normalizeSearchText(current.type);
    if (current.type && !types.some((item) => normalizeSearchText(item.type) === key)) {
      options.push(el('option', { value: current.type, text: `${current.type} (0)` }));
    }
    typeSelect.replaceChildren(el('option', { value: '', text: 'Tất cả loại' }), ...options);
    const selected = types.find((item) => normalizeSearchText(item.type) === key);
    typeSelect.value = selected ? selected.type : current.type;
  }

  typeSelect.addEventListener('change', () => onTypeChange(typeSelect.value));
  stockSelect.addEventListener('change', () => onStockChange(stockSelect.value));
  clearButton.addEventListener('click', () => onClear());

  return {
    /** Nạp danh sách loại (phản hồi data của GET /api/products/types). */
    setTypes(data) {
      types = mergeTypes(data);
      renderTypeOptions();
    },

    /** Hiển thị đúng bộ lọc đang áp dụng; nút "Bỏ lọc" chỉ hiện khi có bộ lọc. */
    sync({ type, stock }) {
      const typeChanged = type !== current.type;
      current = { type, stock };
      if (typeChanged) renderTypeOptions();
      stockSelect.value = stock;
      typeSelect.classList.toggle('is-active', type !== '');
      stockSelect.classList.toggle('is-active', stock !== '');
      const hadFocus = document.activeElement === clearButton;
      clearButton.hidden = type === '' && stock === '';
      // Nút "Bỏ lọc" vừa ẩn đi khi đang có focus: chuyển focus sang ô lọc đầu tiên thay vì mất focus.
      if (hadFocus && clearButton.hidden) typeSelect.focus();
    },
  };
}
