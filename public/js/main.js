/**
 * Điểm vào của giao diện: trạng thái danh sách và sổ đăng ký hành động (actions registry).
 * Nút trên giao diện và phím tắt đều gọi cùng các hàm trong `actions`, không có logic trùng lặp.
 */
import {
  DEFAULT_PAGE_SIZE, DEFAULT_SORT, LIMITS, PAGE_SIZES, SORT_FIELDS, SORT_ORDERS, STOCK_FILTERS,
  formatNumberVi, formatProductCode,
} from '/shared/productRules.js';
import { ApiError, bulkCopy, bulkDelete, deleteProduct, getProduct, listProductTypes, listProducts } from './api.js';
import { createColumnPicker } from './columns.js';
import { createDetailView } from './detail.js';
import {
  beginBusy, closeAllPopups, closeTopLayer, confirmAction, createPopup, initDialogs, isBusy, isDialogOpen,
  isTopLayer, setButtonBusy, setupDialog, showDialog, startProgress, toast, toastError,
} from './dialogs.js';
import { createFilterBar } from './filters.js';
import { describeError, formatProductLabel } from './format.js';
import { createProductForm } from './form.js';
import { createImportExport } from './importExport.js';
import { applyShortcutHints, installShortcuts, renderShortcutHelp } from './shortcuts.js';
import { createStatsPanel } from './stats.js';
import { createTable } from './table.js';

const SEARCH_DEBOUNCE_MS = 350;
const CONFIRM_LIST_LIMIT = 5;
const BUSY_MESSAGE = 'Đang xử lý thao tác trước, vui lòng đợi trong giây lát.';

const $ = (id) => document.getElementById(id);
const dom = {
  addButton: $('btn-add'),
  editButton: /** @type {HTMLButtonElement} */ ($('btn-edit')),
  viewButton: /** @type {HTMLButtonElement} */ ($('btn-view')),
  copyButton: /** @type {HTMLButtonElement} */ ($('btn-copy')),
  deleteButton: /** @type {HTMLButtonElement} */ ($('btn-delete')),
  importButton: $('btn-import'),
  helpButton: $('btn-help'),
  helpDialog: /** @type {HTMLDialogElement} */ ($('help-dialog')),
  helpClose: $('help-close'),
  productDialog: $('product-dialog'),
  searchForm: $('search-form'),
  searchInput: /** @type {HTMLInputElement} */ ($('search-input')),
  clearSearchButton: $('btn-clear-search'),
  clearSelectionButton: $('btn-clear-selection'),
  tableScroll: $('table-scroll'),
};

/**
 * Truy vấn danh sách đang áp dụng: trang, số dòng, từ khóa đã chốt, bộ lọc (loại, tình trạng kho; rỗng = không
 * lọc) và thứ tự sắp xếp.
 */
const state = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  q: '',
  type: '',
  stock: '',
  sort: DEFAULT_SORT.sort,
  order: DEFAULT_SORT.order,
  totalPages: 1,
};
/** Đổi một trong các giá trị này (trừ khi tải lại cùng truy vấn) thì bỏ chọn mọi dòng. */
const LIST_QUERY_KEYS = Object.freeze(['page', 'pageSize', 'q', 'type', 'stock', 'sort', 'order']);
let listRequestId = 0; // chống phản hồi cũ: chỉ phản hồi của yêu cầu mới nhất được vẽ
let typesRequestId = 0;
let dialogRequestId = 0; // chống mở hộp thoại muộn khi người dùng đã làm việc khác
let searchTimer = 0;
let copyInProgress = false;

initDialogs({ focusFallback: dom.tableScroll });

const table = createTable({
  onRowAction: (action, id) => runRowAction(action, id),
  onSelectionChange: () => updateToolbar(),
  onPageChange: (page) => actions.goToPage(page),
  onPageSizeChange: (pageSize) => actions.setPageSize(pageSize),
  onSortChange: (field) => actions.sortBy(field),
  onEmptyAction: (name) => runEmptyAction(name),
});

const filterBar = createFilterBar({
  onTypeChange: (type) => actions.setTypeFilter(type),
  onStockChange: (stock) => actions.setStockFilter(stock),
  onClear: () => actions.clearFilters(),
});

const stats = createStatsPanel({ onStockToggle: (stock) => actions.toggleStockFilter(stock) });

const productForm = createProductForm({
  requestSave: () => actions.save(),
  onSaved: ({ mode, product, message }) => {
    const ids = product?.ProductID ? [product.ProductID] : [];
    toast.success(message || (mode === 'edit' ? 'Đã cập nhật sản phẩm' : 'Đã thêm sản phẩm'));
    refreshTypes();
    // Sản phẩm mới có ID lớn nhất nên nằm ở trang 1 (thứ tự mặc định); sửa thì tải lại đúng trang đang xem.
    if (mode === 'edit') loadList({ highlight: ids });
    else navigate({ page: 1 }, { highlight: ids });
  },
  onMissing: (error) => {
    toastError(error);
    refreshTypes();
    loadList();
  },
});

const detailView = createDetailView({ onEdit: (id) => actions.edit(id) });

const importExport = createImportExport({
  onImported: (payload) => {
    const ids = Array.isArray(payload.data?.ids) ? payload.data.ids : [];
    const count = Number.isSafeInteger(payload.data?.imported) ? payload.data.imported : ids.length;
    toast.success(payload.message || `Đã nhập ${formatNumberVi(count)} sản phẩm`);
    table.clearSelection();
    refreshTypes();
    navigate({ page: 1 }, { highlight: ids });
  },
});

/* ==================================================================== tải danh sách */

/** Từ khóa, bộ lọc và thứ tự đang áp dụng (dùng chung cho tải danh sách và xuất file). */
function listQuery() {
  return { q: state.q, type: state.type, stock: state.stock, sort: state.sort, order: state.order };
}

/** Đang lọc theo loại hoặc tình trạng kho. */
function hasFilters() {
  return state.type !== '' || state.stock !== '';
}

/** Server trả về thứ tự thực sự đã áp dụng (filters.sort/order): giao diện dùng đúng giá trị đó. */
function adoptSort(filters) {
  if (!filters || typeof filters !== 'object') return;
  if (SORT_FIELDS.includes(filters.sort) && SORT_ORDERS.includes(filters.order)) {
    Object.assign(state, { sort: filters.sort, order: filters.order });
  }
}

/** Đồng bộ các điều khiển của danh sách (tiêu đề sắp xếp, thanh lọc, thẻ lọc) theo `state`. */
function syncListControls() {
  table.setSort(state);
  filterBar.sync(state);
  stats.setStockFilter(state.stock);
}

function normalizePagination(raw, itemCount) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const pageSize = PAGE_SIZES.includes(value.pageSize) ? value.pageSize : state.pageSize;
  const total = Number.isSafeInteger(value.total) && value.total >= 0 ? value.total : itemCount;
  const totalPages = Number.isSafeInteger(value.totalPages) && value.totalPages >= 1
    ? value.totalPages
    : Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isSafeInteger(value.page) && value.page >= 1 ? Math.min(value.page, totalPages) : 1;
  return { page, pageSize, total, totalPages };
}

/**
 * Tải trang theo `state`. Server tự đưa trang vượt quá về trang hợp lệ gần nhất; giao diện dùng
 * đúng pagination.page server trả về.
 * @param {{ highlight?: number[] }} [options] id cần làm nổi bật sau khi vẽ (vừa thêm/sửa/sao chép/nhập)
 */
async function loadList({ highlight = [] } = {}) {
  const requestId = ++listRequestId;
  table.setLoading(true);
  try {
    const payload = await listProducts({ page: state.page, pageSize: state.pageSize, ...listQuery() });
    if (requestId !== listRequestId) return;
    const items = Array.isArray(payload.data) ? payload.data : [];
    const pagination = normalizePagination(payload.pagination, items.length);
    Object.assign(state, { page: pagination.page, pageSize: pagination.pageSize, totalPages: pagination.totalPages });
    adoptSort(payload.filters);
    table.setSort(state);
    table.render({ items, pagination, q: state.q, filtered: hasFilters(), highlight });
    stats.render(payload.summary, { filtered: state.q !== '' || hasFilters() });
  } catch (error) {
    if (requestId !== listRequestId) return;
    table.showError(describeError(error));
    stats.showUnavailable();
    toastError(error);
  } finally {
    if (requestId === listRequestId) table.setLoading(false);
  }
}

/**
 * Nạp lại danh sách loại cho bộ lọc (khi mở trang và sau mỗi thao tác ghi dữ liệu).
 * Danh sách loại chỉ là gợi ý lọc: lỗi thì giữ danh sách cũ, lỗi kết nối đã được bảng báo riêng.
 */
async function refreshTypes() {
  const requestId = ++typesRequestId;
  try {
    const payload = await listProductTypes();
    if (requestId === typesRequestId) filterBar.setTypes(payload.data);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(error);
  }
}

/**
 * Đổi trang / số dòng / từ khóa / bộ lọc / thứ tự. Khi một trong các giá trị đó thay đổi thì bỏ chọn ngay
 * lập tức; tải lại cùng truy vấn thì giữ các dòng đã chọn còn tồn tại.
 * @param {Partial<typeof state>} changes
 * @param {{ highlight?: number[] }} [options]
 */
function navigate(changes, options) {
  const next = { ...state, ...changes };
  if (LIST_QUERY_KEYS.some((key) => next[key] !== state[key])) table.clearSelection();
  Object.assign(state, next);
  syncListControls();
  return loadList(options);
}

/* ==================================================================== tìm kiếm */

function syncSearchClearButton() {
  dom.clearSearchButton.hidden = dom.searchInput.value === '';
}

function applySearch(force) {
  const q = dom.searchInput.value.trim();
  if (!force && q === state.q) return;
  navigate({ q, page: 1 });
}

/* ==================================================================== thanh công cụ */

function setDisabled(button, disabled) {
  if (button.disabled === disabled) return;
  const hadFocus = document.activeElement === button;
  button.disabled = disabled;
  if (disabled && hadFocus) dom.tableScroll.focus({ preventScroll: true });
}

/** Sửa/Xem cần đúng 1 dòng; Sao chép/Xóa cần ít nhất 1 dòng. */
function updateToolbar() {
  const count = table.getSelectedIds().length;
  setDisabled(dom.editButton, count !== 1);
  setDisabled(dom.viewButton, count !== 1);
  setDisabled(dom.copyButton, count === 0 || copyInProgress);
  setDisabled(dom.deleteButton, count === 0);
}

function singleSelectedId() {
  const ids = table.getSelectedIds();
  return ids.length === 1 ? ids[0] : null;
}

/**
 * Tải dữ liệu mới nhất của một sản phẩm trước khi mở hộp thoại sửa/xem.
 * Bỏ kết quả nếu đã có yêu cầu mới hơn hoặc người dùng đã mở hộp thoại khác.
 */
async function fetchForDialog(id) {
  const requestId = ++dialogRequestId;
  const stopProgress = startProgress();
  try {
    const payload = await getProduct(id);
    if (requestId !== dialogRequestId || isDialogOpen()) return null;
    return payload.data && typeof payload.data === 'object' ? payload.data : null;
  } catch (error) {
    if (requestId !== dialogRequestId) return null;
    toastError(error);
    if (error instanceof ApiError && error.status === 404) loadList();
    return null;
  } finally {
    stopProgress();
  }
}

async function deleteProducts(ids) {
  const endBusy = beginBusy();
  if (!endBusy) {
    toast.warning(BUSY_MESSAGE);
    return;
  }
  try {
    const payload = ids.length === 1 ? await deleteProduct(ids[0]) : await bulkDelete(ids);
    toast.success(payload.message || `Đã xóa ${formatNumberVi(ids.length)} sản phẩm`);
    table.clearSelection();
  } catch (error) {
    // Xóa nhiều là "tất cả hoặc không": lỗi thì không dòng nào bị xóa; hiện thông báo của server.
    toastError(error);
  } finally {
    endBusy();
  }
  // Tải lại cùng trang; nếu trang cuối vừa bị xóa hết, server trả về trang hợp lệ gần nhất.
  refreshTypes();
  loadList();
}

/* ==================================================================== actions registry */

const actions = {
  /** Alt+N / nút "Thêm mới". */
  add() {
    dialogRequestId += 1;
    productForm.openAdd();
  },

  /** Alt+S / nút "Lưu" / Enter trong biểu mẫu. */
  save() {
    return productForm.save();
  },

  /** Alt+U / nút "Sửa" (đúng 1 dòng đang chọn) hoặc nút "Sửa" trên dòng / trong chi tiết (id). */
  async edit(id) {
    const targetId = id ?? singleSelectedId();
    if (targetId === null) {
      toast.warning('Vui lòng chọn đúng một sản phẩm để sửa');
      return;
    }
    const product = await fetchForDialog(targetId);
    if (product) productForm.openEdit(product);
  },

  /** Alt+V / nút "Xem" (đúng 1 dòng đang chọn) hoặc nút "Xem" trên dòng (id). */
  async view(id) {
    const targetId = id ?? singleSelectedId();
    if (targetId === null) {
      toast.warning('Vui lòng chọn đúng một sản phẩm để xem chi tiết');
      return;
    }
    const product = await fetchForDialog(targetId);
    if (product) detailView.open(product);
  },

  /** Alt+X / nút "Xóa": chỉ mở hộp xác nhận, không bao giờ xóa trực tiếp. */
  remove(ids) {
    const targetIds = ids ?? table.getSelectedIds();
    if (targetIds.length === 0) {
      toast.warning('Vui lòng chọn ít nhất một sản phẩm');
      return;
    }
    if (isBusy()) {
      toast.warning(BUSY_MESSAGE);
      return;
    }
    const lines = targetIds.slice(0, CONFIRM_LIST_LIMIT).map((id) => {
      const product = table.findProduct(id);
      return product ? formatProductLabel(product) : formatProductCode(id);
    });
    const rest = targetIds.length - lines.length;
    confirmAction({
      title: 'Xác nhận xóa',
      message: `Bạn có chắc muốn xóa ${formatNumberVi(targetIds.length)} sản phẩm?`,
      items: lines,
      moreText: rest > 0 ? `… và ${formatNumberVi(rest)} sản phẩm khác` : '',
      confirmLabel: 'Xóa',
      busyLabel: 'Đang xóa…',
      onConfirm: () => deleteProducts(targetIds),
    });
  },

  /** Alt+C / nút "Sao chép": sao chép một hoặc nhiều dòng trong một giao dịch. */
  async copy(ids) {
    const targetIds = ids ?? table.getSelectedIds();
    if (targetIds.length === 0) {
      toast.warning('Vui lòng chọn ít nhất một sản phẩm');
      return;
    }
    const endBusy = beginBusy();
    if (!endBusy) {
      toast.warning(BUSY_MESSAGE);
      return;
    }
    copyInProgress = true;
    const restoreButton = setButtonBusy(dom.copyButton, 'Đang sao chép…');
    try {
      const payload = await bulkCopy(targetIds);
      const copies = Array.isArray(payload.data) ? payload.data : [];
      toast.success(payload.message || `Đã sao chép ${formatNumberVi(copies.length || targetIds.length)} sản phẩm`);
      table.clearSelection();
      refreshTypes();
      // Bản sao có ID mới nhất nên nằm ở trang 1 (thứ tự mặc định).
      navigate({ page: 1 }, { highlight: copies.map((product) => product.ProductID) });
    } catch (error) {
      toastError(error);
      loadList();
    } finally {
      copyInProgress = false;
      restoreButton();
      endBusy();
      updateToolbar();
    }
  },

  /** Alt+Q: đến ô tìm kiếm. */
  focusSearch() {
    dom.searchInput.focus();
    dom.searchInput.select();
  },

  /** Alt+H / nút "Phím tắt". */
  help() {
    dialogRequestId += 1;
    showDialog(dom.helpDialog, { initialFocus: dom.helpClose });
  },

  /**
   * Esc: đóng menu/hộp thoại trên cùng bằng chính hàm đóng của nó; không có gì mở mà đang ở ô
   * tìm kiếm thì rời ô tìm kiếm. @returns {boolean} true nếu phím đã được xử lý
   */
  closeTop() {
    if (closeTopLayer()) return true;
    if (document.activeElement === dom.searchInput) {
      dom.searchInput.blur();
      return true;
    }
    return false;
  },

  /** Nút "Nhập file". */
  openImport() {
    dialogRequestId += 1;
    importExport.openImport();
  },

  /** Menu "Xuất file": toàn bộ kết quả theo từ khóa, bộ lọc và thứ tự đang áp dụng. */
  exportFile(format) {
    return importExport.exportFile(format, listQuery());
  },

  /** Menu "File mẫu" và các nút tải mẫu trong hộp thoại nhập. */
  downloadTemplate(format) {
    return importExport.downloadTemplateFile(format);
  },

  /** Enter trong ô tìm kiếm / nút "Tìm kiếm": tìm ngay. */
  search() {
    clearTimeout(searchTimer);
    applySearch(true);
  },

  /** Nút xóa từ khóa. */
  clearSearch() {
    clearTimeout(searchTimer);
    dom.searchInput.value = '';
    syncSearchClearButton();
    applySearch(true);
    dom.searchInput.focus();
  },

  /** Liên kết "Bỏ chọn". */
  clearSelection() {
    table.clearSelection();
  },

  /** Nút chuyển trang. */
  goToPage(page) {
    const target = Math.min(Math.max(1, Math.trunc(page) || 1), state.totalPages);
    if (target !== state.page) navigate({ page: target });
  },

  /** Ô chọn số dòng mỗi trang. */
  setPageSize(pageSize) {
    if (PAGE_SIZES.includes(pageSize) && pageSize !== state.pageSize) navigate({ pageSize, page: 1 });
  },

  /** Bấm tiêu đề cột: cột mới → tăng dần; bấm lại cột đang sắp xếp → đổi chiều. Về trang 1. */
  sortBy(field) {
    if (!SORT_FIELDS.includes(field)) return;
    const order = field === state.sort && state.order === 'asc' ? 'desc' : 'asc';
    navigate({ sort: field, order, page: 1 });
  },

  /** Ô lọc "Loại sản phẩm" (rỗng = mọi loại). Về trang 1. */
  setTypeFilter(type) {
    const value = typeof type === 'string' ? type : '';
    if (value !== state.type) navigate({ type: value, page: 1 });
  },

  /** Ô lọc "Tình trạng kho" (rỗng = mọi tình trạng). Về trang 1. */
  setStockFilter(stock) {
    const value = STOCK_FILTERS.includes(stock) ? stock : '';
    if (value !== state.stock) navigate({ stock: value, page: 1 });
  },

  /** Thẻ "Sắp hết hàng" / "Hết hàng": bật bộ lọc đó, bấm lại thẻ đang bật thì bỏ lọc. */
  toggleStockFilter(stock) {
    actions.setStockFilter(state.stock === stock ? '' : stock);
  },

  /** Nút "Bỏ lọc": bỏ cả hai bộ lọc, giữ nguyên từ khóa tìm kiếm. */
  clearFilters() {
    if (hasFilters()) navigate({ type: '', stock: '', page: 1 });
  },

  /** Tải lại trang hiện tại (nút "Thử lại"). */
  reload() {
    return loadList();
  },
};

const ROW_ACTIONS = {
  view: (id) => actions.view(id),
  edit: (id) => actions.edit(id),
  copy: (id) => actions.copy([id]),
  remove: (id) => actions.remove([id]),
};

function runRowAction(action, id) {
  if (Object.hasOwn(ROW_ACTIONS, action) && Number.isSafeInteger(id)) ROW_ACTIONS[action](id);
}

function runEmptyAction(name) {
  if (name === 'add') actions.add();
  else if (name === 'clear-search') actions.clearSearch();
  else if (name === 'clear-filters') actions.clearFilters();
  else if (name === 'retry') actions.reload();
}

/* ==================================================================== gắn sự kiện */

dom.addButton.addEventListener('click', () => actions.add());
dom.editButton.addEventListener('click', () => actions.edit());
dom.viewButton.addEventListener('click', () => actions.view());
dom.copyButton.addEventListener('click', () => actions.copy());
dom.deleteButton.addEventListener('click', () => actions.remove());
dom.importButton.addEventListener('click', () => actions.openImport());
dom.helpButton.addEventListener('click', () => actions.help());
dom.clearSelectionButton.addEventListener('click', () => actions.clearSelection());
dom.clearSearchButton.addEventListener('click', () => actions.clearSearch());

dom.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  actions.search();
});
dom.searchInput.addEventListener('input', () => {
  syncSearchClearButton();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applySearch(false), SEARCH_DEBOUNCE_MS);
});

// Mục menu xuất file / file mẫu (và nút tải mẫu trong hộp thoại nhập).
document.addEventListener('click', (event) => {
  const target = /** @type {HTMLElement} */ (event.target);
  const exportItem = target.closest('[data-export-format]');
  if (exportItem) {
    closeAllPopups();
    actions.exportFile(exportItem.getAttribute('data-export-format'));
    return;
  }
  const templateItem = target.closest('[data-template-format]');
  if (templateItem) {
    closeAllPopups();
    actions.downloadTemplate(templateItem.getAttribute('data-template-format'));
  }
});

// Thả file ra ngoài vùng nhận file thì không để trình duyệt mở file và rời khỏi ứng dụng.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files')) return;
    if (/** @type {HTMLElement} */ (event.target).closest?.('.dropzone')) return;
    event.preventDefault();
    if (type === 'dragover') event.dataTransfer.dropEffect = 'none';
  });
}

/* ==================================================================== khởi động */

dom.searchInput.maxLength = LIMITS.searchMax;
applyShortcutHints();
renderShortcutHelp(/** @type {HTMLTableSectionElement} */ ($('shortcut-rows')), $('shortcut-note'));
setupDialog(dom.helpDialog);
createPopup({ trigger: /** @type {HTMLButtonElement} */ ($('btn-export')), panel: $('export-menu') });
createPopup({ trigger: /** @type {HTMLButtonElement} */ ($('btn-template')), panel: $('template-menu') });
const columnPicker = createColumnPicker({ onChange: (columns) => table.setVisibleColumns(columns) });
table.setVisibleColumns(columnPicker.getVisible());
installShortcuts({
  actions,
  isDialogOpen,
  isProductFormActive: () => productForm.isOpen() && isTopLayer(dom.productDialog),
  beforeAction: () => closeAllPopups(),
});
syncSearchClearButton();
syncListControls();
updateToolbar();
refreshTypes();
loadList();
