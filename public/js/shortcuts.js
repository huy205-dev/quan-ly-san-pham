/**
 * Phím tắt: một bảng định nghĩa duy nhất dùng cho bộ xử lý keydown, gợi ý trên nút và bảng hướng dẫn.
 * Mỗi phím gọi đúng hàm trong actions registry (main.js) mà nút tương ứng cũng gọi.
 */
import { el } from './format.js';

/**
 * @typedef {object} Shortcut
 * @property {string} action tên hàm trong actions registry
 * @property {string[]} keys phím hiển thị, ví dụ ['Alt', 'N']
 * @property {string} code KeyboardEvent.code (không phụ thuộc bố cục bàn phím / bộ gõ tiếng Việt)
 * @property {string} description mô tả hiển thị trong bảng hướng dẫn
 * @property {boolean} [alwaysAvailable] vẫn hoạt động khi đang nhập liệu hoặc khi hộp thoại mở
 */

/** @type {ReadonlyArray<Readonly<Shortcut>>} */
const SHORTCUTS = Object.freeze([
  { action: 'add', keys: ['Alt', 'N'], code: 'KeyN', description: 'Thêm sản phẩm mới' },
  { action: 'save', keys: ['Alt', 'S'], code: 'KeyS', description: 'Lưu biểu mẫu đang mở', alwaysAvailable: true },
  { action: 'edit', keys: ['Alt', 'U'], code: 'KeyU', description: 'Sửa sản phẩm đang chọn (đúng 1)' },
  { action: 'view', keys: ['Alt', 'V'], code: 'KeyV', description: 'Xem chi tiết sản phẩm đang chọn (đúng 1)' },
  { action: 'remove', keys: ['Alt', 'X'], code: 'KeyX', description: 'Xóa sản phẩm đang chọn (luôn hỏi xác nhận)' },
  { action: 'copy', keys: ['Alt', 'C'], code: 'KeyC', description: 'Sao chép sản phẩm đang chọn' },
  { action: 'focusSearch', keys: ['Alt', 'Q'], code: 'KeyQ', description: 'Đến ô tìm kiếm' },
  { action: 'help', keys: ['Alt', 'H'], code: 'KeyH', description: 'Mở bảng hướng dẫn phím tắt' },
  { action: 'closeTop', keys: ['Esc'], code: 'Escape', description: 'Đóng hộp thoại/menu đang mở', alwaysAvailable: true },
].map((shortcut) => Object.freeze(shortcut)));

/** Ghi chú hiển thị dưới bảng hướng dẫn. */
const SHORTCUT_NOTE = 'Khi đang nhập liệu, chỉ Alt+S (lưu) và Esc (đóng) hoạt động. Phím xóa luôn yêu cầu xác nhận.';

const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color']);

/**
 * Phần tử có phải ô nhập văn bản không (input dạng chữ/số, textarea, select, contenteditable).
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function isTextEntry(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return false;
}

/** Chuỗi hiển thị của tổ hợp phím, ví dụ "Alt+N". */
function shortcutText(shortcut) {
  return shortcut.keys.join('+');
}

function ariaKeyShortcut(shortcut) {
  return shortcut.keys.map((key) => (key === 'Esc' ? 'Escape' : key)).join('+');
}

function matches(event, shortcut) {
  if (shortcut.code === 'Escape') {
    return (event.key === 'Escape' || event.key === 'Esc') && !event.altKey && !event.ctrlKey && !event.metaKey;
  }
  return event.code === shortcut.code && event.altKey && !event.ctrlKey && !event.metaKey;
}

/**
 * Gắn bộ xử lý phím tắt toàn cục.
 * Quy tắc: đang nhập liệu hoặc có hộp thoại mở → chỉ xử lý Alt+S (khi biểu mẫu sản phẩm là lớp trên cùng)
 * và Esc; các phím khác đi tiếp nguyên vẹn. Phím được xử lý thì gọi preventDefault().
 * @param {{ actions: Record<string, (...args: any[]) => unknown>,
 *           isDialogOpen: () => boolean,
 *           isProductFormActive: () => boolean,
 *           beforeAction?: () => void }} context
 */
export function installShortcuts({ actions, isDialogOpen, isProductFormActive, beforeAction }) {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const shortcut = SHORTCUTS.find((item) => matches(event, item));
    if (!shortcut) return;
    const restricted = isTextEntry(event.target) || isDialogOpen();
    if (restricted && !shortcut.alwaysAvailable) return;
    if (shortcut.action === 'save' && !isProductFormActive()) return;

    if (shortcut.action === 'closeTop') {
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      // closeTop() trả về false khi không có gì để đóng: khi đó để phím Esc đi tiếp.
      if (actions.closeTop()) event.preventDefault();
      return;
    }

    event.preventDefault();
    if (event.repeat) return; // giữ phím không lặp lại thao tác
    if (!restricted) beforeAction?.();
    actions[shortcut.action]();
  }, true);
}

/**
 * Gắn gợi ý phím tắt cho các phần tử có data-shortcut="<action>": aria-keyshortcuts, title cho nút
 * và chữ trong <kbd data-shortcut-hint>.
 * @param {ParentNode} [root]
 */
export function applyShortcutHints(root = document) {
  for (const element of root.querySelectorAll('[data-shortcut]')) {
    const shortcut = SHORTCUTS.find((item) => item.action === element.getAttribute('data-shortcut'));
    if (!shortcut) continue;
    const text = shortcutText(shortcut);
    element.setAttribute('aria-keyshortcuts', ariaKeyShortcut(shortcut));
    const hint = element.querySelector('[data-shortcut-hint]');
    if (hint) hint.textContent = text;
    if (element instanceof HTMLButtonElement && !element.title) {
      const label = element.querySelector('.btn-label')?.textContent.trim();
      element.title = label ? `${label} (${text})` : text;
    }
  }
}

function keyCombo(keys) {
  const combo = el('kbd', { className: 'kbd-combo' });
  keys.forEach((key, index) => {
    if (index > 0) combo.append(el('span', { className: 'kbd-plus', 'aria-hidden': 'true', text: '+' }));
    combo.append(el('kbd', { text: key }));
  });
  return combo;
}

/**
 * Dựng bảng hướng dẫn phím tắt từ cùng bảng định nghĩa SHORTCUTS.
 * @param {HTMLTableSectionElement} tbody
 * @param {HTMLElement} note
 */
export function renderShortcutHelp(tbody, note) {
  tbody.replaceChildren(...SHORTCUTS.map((shortcut) => el('tr', {},
    el('td', { className: 'shortcut-keys' }, keyCombo(shortcut.keys)),
    el('td', { text: shortcut.description }))));
  note.textContent = SHORTCUT_NOTE;
}
