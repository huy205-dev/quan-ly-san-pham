/**
 * Hộp thoại, menu bật lên, hộp xác nhận, thông báo (toast) và trạng thái bận.
 *
 * Mọi lớp đang mở (dialog hoặc menu) nằm trong một ngăn xếp. Mỗi lớp đăng ký đúng một hàm đóng;
 * nút Đóng/Hủy, phím Esc (actions.closeTop) và sự kiện `cancel` của <dialog> đều gọi hàm đó,
 * nên chỉ có một đường đóng và không bao giờ đóng hai lần.
 */
import { ApiError } from './api.js';
import { describeError, el, icon } from './format.js';

/** @type {Array<{ kind: 'dialog'|'popup', element: HTMLElement, close: () => void }>} */
const layers = [];
/** @type {WeakMap<HTMLDialogElement, { requestClose: () => void, onClosed?: () => void, returnTo: Element|null }>} */
const dialogConfigs = new WeakMap();
/** @type {Set<{ wrapper: HTMLElement, isOpen: () => boolean, close: (options?: { restoreFocus?: boolean }) => void }>} */
const popups = new Set();

const ui = {
  /** @type {HTMLElement|null} */ toastRegion: null,
  /** @type {HTMLElement|null} */ busyBar: null,
  /** @type {HTMLElement|null} */ focusFallback: null,
  confirm: null,
};

/**
 * Khởi tạo phần dùng chung (gọi một lần từ main.js khi DOM đã sẵn sàng).
 * @param {{ focusFallback: HTMLElement }} options phần tử nhận focus khi nút mở hộp thoại không còn
 */
export function initDialogs({ focusFallback }) {
  ui.toastRegion = document.getElementById('toast-region');
  ui.busyBar = document.getElementById('busy-bar');
  ui.focusFallback = focusFallback;
  ui.confirm = {
    dialog: document.getElementById('confirm-dialog'),
    title: document.getElementById('confirm-title'),
    message: document.getElementById('confirm-message'),
    list: document.getElementById('confirm-list'),
    more: document.getElementById('confirm-more'),
    cancel: document.getElementById('confirm-cancel'),
    ok: document.getElementById('confirm-ok'),
    state: null,
  };
  setupDialog(ui.confirm.dialog, { onRequestClose: requestConfirmClose });
  ui.confirm.ok.addEventListener('click', runConfirm);
  showToastRegion();
  // Bấm ra ngoài menu đang mở thì đóng menu (không lấy lại focus để không cản cú bấm).
  document.addEventListener('pointerdown', (event) => {
    for (const popup of popups) {
      if (popup.isOpen() && !popup.wrapper.contains(/** @type {Node} */ (event.target))) {
        popup.close({ restoreFocus: false });
      }
    }
  }, true);
}

/* ------------------------------------------------------------------ Ngăn xếp lớp */

function removeLayer(element) {
  const index = layers.findIndex((layer) => layer.element === element);
  if (index === -1) return false;
  layers.splice(index, 1);
  return true;
}

function canFocus(element) {
  return element instanceof HTMLElement
    && element.isConnected
    && !(/** @type {HTMLButtonElement} */ (element).disabled)
    && element.closest('[hidden], [inert]') === null;
}

function restoreFocus(target) {
  if (canFocus(target)) target.focus();
  else ui.focusFallback?.focus({ preventScroll: true });
}

/** Đóng lớp trên cùng bằng chính hàm đóng của nó. @returns {boolean} true nếu có lớp đang mở */
export function closeTopLayer() {
  const top = layers.at(-1);
  if (!top) return false;
  top.close();
  return true;
}

/** Có hộp thoại (không tính menu) nào đang mở không. */
export function isDialogOpen() {
  return layers.some((layer) => layer.kind === 'dialog');
}

/** Phần tử có phải lớp trên cùng không. */
export function isTopLayer(element) {
  return layers.at(-1)?.element === element;
}

/* ------------------------------------------------------------------ Hộp thoại */

/**
 * Đăng ký một <dialog>. Nút [data-dialog-close], phím Esc và sự kiện cancel cùng gọi onRequestClose.
 * @param {HTMLDialogElement} dialog
 * @param {{ onRequestClose?: () => void, onClosed?: () => void }} [options]
 *        onRequestClose: hàm đóng duy nhất (mặc định: hideDialog); onClosed: dọn dẹp sau khi đóng
 */
export function setupDialog(dialog, { onRequestClose, onClosed } = {}) {
  const config = { requestClose: onRequestClose ?? (() => hideDialog(dialog)), onClosed, returnTo: null };
  dialogConfigs.set(dialog, config);
  // Esc/cử chỉ "quay lại" của trình duyệt: chặn đóng mặc định, đi qua cùng hàm đóng với nút Đóng/Hủy.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (layers.some((layer) => layer.element === dialog)) config.requestClose();
  });
  // Dự phòng: nếu trình duyệt vẫn tự đóng hộp thoại thì đồng bộ lại ngăn xếp và dọn dẹp.
  dialog.addEventListener('close', () => {
    if (removeLayer(dialog)) finishClose(config);
  });
  for (const button of dialog.querySelectorAll('[data-dialog-close]')) {
    button.addEventListener('click', () => config.requestClose());
  }
}

/**
 * Mở hộp thoại dạng modal (đóng mọi menu trước) và đặt focus mặc định.
 * @param {HTMLDialogElement} dialog
 * @param {{ initialFocus?: HTMLElement }} [options]
 */
export function showDialog(dialog, { initialFocus } = {}) {
  const config = dialogConfigs.get(dialog);
  if (!config || dialog.open) return;
  closeAllPopups();
  config.returnTo = document.activeElement;
  dialog.showModal();
  layers.push({ kind: 'dialog', element: dialog, close: () => config.requestClose() });
  showToastRegion();
  initialFocus?.focus();
}

/**
 * Đóng hộp thoại thật sự (các module gọi từ hàm đóng của mình), trả focus về nút đã mở nó.
 * @param {HTMLDialogElement} dialog
 */
export function hideDialog(dialog) {
  const config = dialogConfigs.get(dialog);
  const wasOpen = removeLayer(dialog);
  if (dialog.open) dialog.close();
  if (wasOpen && config) finishClose(config);
}

function finishClose(config) {
  config.onClosed?.();
  const target = config.returnTo;
  config.returnTo = null;
  restoreFocus(target);
}

/* ------------------------------------------------------------------ Menu bật lên */

/**
 * Menu/khung bật lên gắn với một nút. role="menu" hỗ trợ phím mũi tên; Esc đóng qua ngăn xếp.
 * @param {{ trigger: HTMLButtonElement, panel: HTMLElement, onOpen?: () => void }} options
 * @returns {{ open: () => void, close: (options?: { restoreFocus?: boolean }) => void, isOpen: () => boolean }}
 */
export function createPopup({ trigger, panel, onOpen }) {
  const wrapper = /** @type {HTMLElement} */ (trigger.parentElement);
  const isMenu = panel.getAttribute('role') === 'menu';
  let open = false;

  const focusables = () => [...panel.querySelectorAll(isMenu
    ? '[role="menuitem"]:not(:disabled)'
    : 'input:not(:disabled), button:not(:disabled)')];

  function show() {
    if (open) return;
    closeAllPopups();
    open = true;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    layers.push({ kind: 'popup', element: panel, close: () => hide() });
    onOpen?.();
    panel.classList.remove('align-end');
    if (panel.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
      panel.classList.add('align-end');
    }
    focusables()[0]?.focus();
  }

  function hide({ restoreFocus: shouldRestore = true } = {}) {
    if (!open) return;
    open = false;
    removeLayer(panel);
    const hadFocus = panel.contains(document.activeElement);
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (shouldRestore && hadFocus) trigger.focus();
  }

  trigger.addEventListener('click', () => (open ? hide() : show()));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      show();
    }
  });
  panel.addEventListener('keydown', (event) => {
    if (!isMenu) return;
    const items = focusables();
    const index = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    let next = null;
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
    else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    else if (event.key === 'Tab') hide(); // focus về nút mở, Tab tiếp tục từ đó
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });
  // Focus rời khỏi khung (Tab ra ngoài) thì đóng; relatedTarget null nghĩa là bấm chuột — để pointerdown xử lý.
  wrapper.addEventListener('focusout', (event) => {
    const to = /** @type {Node|null} */ (event.relatedTarget);
    if (open && to && !wrapper.contains(to)) hide({ restoreFocus: false });
  });

  const handle = { wrapper, isOpen: () => open, close: hide };
  popups.add(handle);
  return { open: show, close: hide, isOpen: () => open };
}

/** Đóng mọi menu đang mở. @param {{ restoreFocus?: boolean }} [options] */
export function closeAllPopups(options) {
  for (const popup of popups) popup.close(options);
}

/* ------------------------------------------------------------------ Hộp xác nhận */

/**
 * Hộp thoại xác nhận (focus mặc định vào "Hủy"). onConfirm chạy khi bấm nút xác nhận;
 * trong lúc chờ, nút hiển thị busyLabel và không thể đóng hộp thoại.
 * @param {{ title: string, message: string, items?: string[], moreText?: string,
 *           confirmLabel?: string, busyLabel?: string, onConfirm: () => Promise<void> }} options
 */
export function confirmAction({ title, message, items = [], moreText = '', confirmLabel = 'Xóa', busyLabel = 'Đang xóa…', onConfirm }) {
  const c = ui.confirm;
  if (c.dialog.open) return;
  c.title.textContent = title;
  c.message.textContent = message;
  c.list.replaceChildren(...items.map((text) => el('li', { text })));
  c.list.hidden = items.length === 0;
  c.more.textContent = moreText;
  c.more.hidden = !moreText;
  c.ok.querySelector('.btn-label').textContent = confirmLabel;
  c.state = { onConfirm, busyLabel, pending: false };
  showDialog(c.dialog, { initialFocus: c.cancel });
}

async function runConfirm() {
  const c = ui.confirm;
  const state = c.state;
  if (!state || state.pending) return;
  state.pending = true;
  const restoreButton = setButtonBusy(c.ok, state.busyLabel);
  const closeButtons = [...c.dialog.querySelectorAll('[data-dialog-close]')];
  for (const button of closeButtons) button.disabled = true;
  try {
    await state.onConfirm();
  } finally {
    restoreButton();
    for (const button of closeButtons) button.disabled = false;
    state.pending = false;
    if (c.state === state) {
      c.state = null;
      hideDialog(c.dialog);
    }
  }
}

function requestConfirmClose() {
  const c = ui.confirm;
  if (c.state?.pending) return; // đang xóa: chờ kết quả
  c.state = null;
  hideDialog(c.dialog);
}

/* ------------------------------------------------------------------ Thông báo (toast) */

const TOAST_ICONS = { info: 'info', success: 'check-circle', warning: 'alert-triangle', error: 'alert-circle' };
const TOAST_DURATIONS = { info: 4000, success: 4000, warning: 4000, error: 7000 };
// Vùng toast nằm giữa phía trên, trong khoảng trống của header. Chỉ giữ toast mới nhất để thông báo
// không bao giờ xếp chồng xuống che thanh công cụ hay các nút thao tác.
const MAX_TOASTS = 1;

/**
 * Đưa vùng thông báo lên trên cùng (top layer) để toast không bị che bởi hộp thoại modal.
 * Trình duyệt chưa hỗ trợ Popover API thì vùng thông báo vẫn hiển thị bình thường trong trang.
 */
function showToastRegion() {
  const region = ui.toastRegion;
  if (!region || typeof region.showPopover !== 'function') return;
  try {
    if (region.matches(':popover-open')) region.hidePopover();
    region.showPopover();
  } catch {
    // Không hỗ trợ :popover-open — giữ cách hiển thị thường.
  }
}

function showToast(type, message, { duration = TOAST_DURATIONS[type] } = {}) {
  const closeButton = el('button', { type: 'button', className: 'toast-close', 'aria-label': 'Đóng thông báo', title: 'Đóng' },
    icon('close'));
  const node = el('div', { className: `toast toast-${type}` },
    icon(TOAST_ICONS[type], 'icon toast-icon'),
    el('p', { className: 'toast-message', text: message }),
    closeButton);
  let timer = 0;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 200);
  };
  const schedule = (ms) => {
    clearTimeout(timer);
    if (ms > 0) timer = setTimeout(close, ms);
  };
  closeButton.addEventListener('click', close);
  // Rê chuột vào toast thì giữ lại để kịp đọc.
  node.addEventListener('pointerenter', () => clearTimeout(timer));
  node.addEventListener('pointerleave', () => schedule(Math.min(duration, 2500)));

  ui.toastRegion.append(node);
  const visible = [...ui.toastRegion.querySelectorAll('.toast:not(.is-leaving)')];
  for (const old of visible.slice(0, Math.max(0, visible.length - MAX_TOASTS))) old.remove();
  showToastRegion();
  schedule(duration);
  return { close };
}

/** Toast theo loại; duration 0 = giữ đến khi gọi close(). Lỗi tự ẩn sau ~7 giây, loại khác ~4 giây. */
export const toast = {
  info: (message, options) => showToast('info', message, options),
  success: (message, options) => showToast('success', message, options),
  warning: (message, options) => showToast('warning', message, options),
  error: (message, options) => showToast('error', message, options),
};

/** Hiện toast lỗi cho một lỗi bất kỳ; lỗi không phải ApiError (lỗi lập trình) được ghi ra console. */
export function toastError(error) {
  if (!(error instanceof ApiError)) console.error(error);
  return toast.error(describeError(error));
}

/* ------------------------------------------------------------------ Trạng thái bận */

let busyActive = false;
let progressCount = 0;

function renderActivity() {
  if (ui.busyBar) ui.busyBar.hidden = !busyActive && progressCount === 0;
  document.body.classList.toggle('is-busy', busyActive);
}

/** Có thao tác ghi dữ liệu (thêm/sửa/xóa/sao chép/nhập) đang chạy không. */
export function isBusy() {
  return busyActive;
}

/**
 * Bắt đầu một thao tác ghi dữ liệu. Trả về hàm kết thúc, hoặc null nếu đang có thao tác khác
 * (chặn chạy hai thao tác ghi cùng lúc).
 * @returns {(() => void)|null}
 */
export function beginBusy() {
  if (busyActive) return null;
  busyActive = true;
  renderActivity();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    busyActive = false;
    renderActivity();
  };
}

/** Hiện thanh tiến trình cho một yêu cầu đọc (không chặn thao tác khác). @returns {() => void} */
export function startProgress() {
  progressCount += 1;
  renderActivity();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    progressCount -= 1;
    renderActivity();
  };
}

/**
 * Đổi nút sang trạng thái "Đang …": vô hiệu hóa và thay nhãn. Trả về hàm khôi phục.
 * @param {HTMLButtonElement} button
 * @param {string} busyLabel
 * @returns {() => void}
 */
export function setButtonBusy(button, busyLabel) {
  const label = button.querySelector('.btn-label') ?? button;
  const original = label.textContent;
  const wasDisabled = button.disabled;
  label.textContent = busyLabel;
  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  return () => {
    label.textContent = original;
    button.disabled = wasDisabled;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
  };
}
