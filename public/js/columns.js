/**
 * Ẩn/hiện cột dữ liệu của bảng. Lựa chọn lưu trong localStorage; xuất file không bị ảnh hưởng.
 * Cột ô chọn và cột "Thao tác" luôn hiển thị; luôn giữ ít nhất một cột dữ liệu.
 */
import { PRODUCT_FIELDS } from '/shared/productRules.js';
import { createPopup } from './dialogs.js';
import { el } from './format.js';

/** Khóa localStorage (mảng JSON tên trường đang hiển thị). */
const COLUMNS_STORAGE_KEY = 'qlsp.visibleColumns.v1';

/** Tiêu đề cột của bảng (cũng là nhãn trong menu ẩn/hiện cột). */
export const COLUMN_LABELS = Object.freeze({
  ProductID: 'Mã',
  PathImage: 'Ảnh',
  ProductName: 'Tên sản phẩm',
  ProductType: 'Loại',
  Quantity: 'Số lượng',
  Unit: 'Đơn vị',
  Price: 'Giá',
  Description: 'Mô tả',
  CreateDate: 'Ngày tạo',
  UpdateDate: 'Ngày cập nhật',
});

const DEFAULT_VISIBLE_COLUMNS = Object.freeze([...PRODUCT_FIELDS]);

/**
 * Lọc danh sách cột: bỏ tên lạ và trùng, giữ thứ tự PRODUCT_FIELDS.
 * @param {unknown} value
 * @returns {string[]|null} null nếu không hợp lệ hoặc không còn cột nào
 */
function sanitizeVisibleColumns(value) {
  if (!Array.isArray(value)) return null;
  const wanted = new Set(value.filter((item) => typeof item === 'string'));
  const columns = PRODUCT_FIELDS.filter((field) => wanted.has(field));
  return columns.length > 0 ? columns : null;
}

/** Đọc cấu hình cột đã lưu; lỗi/không hợp lệ → mặc định (hiện đủ 10 cột). @returns {string[]} */
function loadVisibleColumns() {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (raw !== null) return sanitizeVisibleColumns(JSON.parse(raw)) ?? [...DEFAULT_VISIBLE_COLUMNS];
  } catch {
    // localStorage bị chặn hoặc dữ liệu hỏng: dùng mặc định.
  }
  return [...DEFAULT_VISIBLE_COLUMNS];
}

function saveVisibleColumns(columns) {
  try {
    window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Không lưu được (chế độ riêng tư, hết dung lượng…): lựa chọn chỉ áp dụng cho phiên hiện tại.
  }
}

/**
 * Menu chọn cột: mỗi cột dữ liệu một checkbox và nút "Khôi phục mặc định".
 * Áp dụng ngay qua onChange (không tải lại dữ liệu).
 * @param {{ onChange: (columns: string[]) => void }} options
 * @returns {{ getVisible: () => string[] }}
 */
export function createColumnPicker({ onChange }) {
  const list = document.getElementById('columns-list');
  const hint = document.getElementById('columns-hint');
  const resetButton = document.getElementById('btn-columns-reset');
  let visible = loadVisibleColumns();

  const checkboxes = new Map(PRODUCT_FIELDS.map((field) => [field, el('input', {
    type: 'checkbox',
    value: field,
  })]));
  list.replaceChildren(...PRODUCT_FIELDS.map((field) => el('label', { className: 'check-row' },
    checkboxes.get(field),
    el('span', { text: COLUMN_LABELS[field] }))));

  function sync() {
    const onlyOne = visible.length === 1;
    for (const [field, input] of checkboxes) {
      input.checked = visible.includes(field);
      // Không cho bỏ chọn cột cuối cùng.
      input.disabled = onlyOne && input.checked;
      input.title = input.disabled ? 'Cần giữ lại ít nhất một cột dữ liệu' : '';
    }
    hint.hidden = !onlyOne;
  }

  function apply(columns) {
    visible = columns;
    saveVisibleColumns(columns);
    sync();
    onChange([...columns]);
  }

  list.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const next = PRODUCT_FIELDS.filter((field) => (field === input.value ? input.checked : visible.includes(field)));
    if (next.length === 0) {
      input.checked = true;
      return;
    }
    apply(next);
  });
  resetButton.addEventListener('click', () => apply([...DEFAULT_VISIBLE_COLUMNS]));

  createPopup({
    trigger: /** @type {HTMLButtonElement} */ (document.getElementById('btn-columns')),
    panel: document.getElementById('columns-panel'),
  });
  sync();
  return { getVisible: () => [...visible] };
}
