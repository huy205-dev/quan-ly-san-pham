/**
 * Thẻ thống kê phía trên bảng, lấy từ `summary` của API danh sách: tính trên mọi sản phẩm khớp từ khóa và
 * bộ lọc (không chỉ trang đang xem). Hai thẻ "Sắp hết hàng" / "Hết hàng" là nút bật/tắt bộ lọc tình trạng kho.
 */
import { LOW_STOCK_THRESHOLD } from '/shared/productRules.js';
import { EMPTY_TEXT, formatInteger, formatMoney } from './format.js';

/** Khóa trong summary → cách hiển thị. */
const STAT_FORMATTERS = Object.freeze({
  totalProducts: formatInteger,
  totalQuantity: formatInteger,
  totalValue: formatMoney,
  lowStock: formatInteger,
  outOfStock: formatInteger,
});

/** Gợi ý (title) của thẻ lọc: [khi chưa bật, khi đang bật]. */
const TOGGLE_TITLES = Object.freeze({
  low: [`Lọc các sản phẩm sắp hết hàng (số lượng 1–${LOW_STOCK_THRESHOLD - 1})`, 'Đang lọc sắp hết hàng — bấm để bỏ lọc'],
  out: ['Lọc các sản phẩm hết hàng (số lượng 0)', 'Đang lọc hết hàng — bấm để bỏ lọc'],
});

/**
 * @param {{ onStockToggle: (stock: 'low'|'out') => void }} handlers
 * @returns {{
 *   render: (summary: unknown, options: { filtered: boolean }) => void,
 *   showUnavailable: () => void,
 *   setStockFilter: (stock: string) => void,
 * }}
 */
export function createStatsPanel({ onStockToggle }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('stats');
  const caption = $('stats-caption');
  const captionText = $('stats-caption-text');
  const values = Object.fromEntries(Object.keys(STAT_FORMATTERS).map((key) => [key, panel.querySelector(`[data-stat="${key}"]`)]));
  const toggles = [...panel.querySelectorAll('button[data-stock-toggle]')];

  panel.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('button[data-stock-toggle]');
    if (button) onStockToggle(/** @type {'low'|'out'} */ (button.dataset.stockToggle));
  });

  function setVisible(visible) {
    panel.hidden = !visible;
    caption.hidden = !visible;
  }

  function fill(read) {
    for (const [key, node] of Object.entries(values)) node.textContent = read(key);
  }

  return {
    /**
     * Hiện số liệu của lần tải danh sách vừa xong. Server cũ không trả summary → ẩn các thẻ.
     * @param {unknown} summary
     * @param {{ filtered: boolean }} options filtered: đang có từ khóa hoặc bộ lọc
     */
    render(summary, { filtered }) {
      if (!summary || typeof summary !== 'object') {
        setVisible(false);
        return;
      }
      fill((key) => {
        const value = summary[key];
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? STAT_FORMATTERS[key](value) : EMPTY_TEXT;
      });
      captionText.textContent = filtered ? 'Theo bộ lọc hiện tại' : 'Toàn bộ kho';
      caption.classList.toggle('is-filtered', filtered);
      setVisible(true);
    },

    /** Không tải được danh sách: giữ chỗ các thẻ nhưng không hiện số liệu cũ. */
    showUnavailable() {
      fill(() => EMPTY_TEXT);
    },

    /** Trạng thái nhấn (aria-pressed) của hai thẻ lọc theo bộ lọc tình trạng kho đang áp dụng. */
    setStockFilter(stock) {
      for (const button of toggles) {
        const key = /** @type {'low'|'out'} */ (button.dataset.stockToggle);
        const pressed = key === stock;
        button.setAttribute('aria-pressed', String(pressed));
        button.title = TOGGLE_TITLES[key][pressed ? 1 : 0];
      }
    },
  };
}
