/**
 * Bảng sản phẩm: dựng dòng, chọn dòng, phân trang, sắp xếp theo cột, trạng thái đang tải / rỗng / lỗi,
 * ẩn/hiện cột và các cột dính bên trái khi cuộn ngang.
 * Lựa chọn chỉ gồm các dòng của trang đang hiển thị; mỗi lần vẽ lại sẽ bỏ các id không còn trên trang.
 */
import {
  DEFAULT_SORT, PAGE_SIZES, PRODUCT_FIELDS, SORT_FIELDS, formatNumberVi, formatProductCode,
} from '/shared/productRules.js';
import { COLUMN_LABELS } from './columns.js';
import {
  EMPTY_TEXT, displayText, el, formatDateTime, formatInteger, formatMoney, formatProductLabel, icon, imageUrl,
  initialPlaceholder, stockBadge, typeTag,
} from './format.js';

const CELL_CLASSES = Object.freeze({
  ProductID: 'col-code',
  PathImage: 'col-image',
  ProductName: 'col-name',
  ProductType: 'col-type',
  Quantity: 'col-num',
  Unit: 'col-unit',
  Price: 'col-num col-price',
  Description: 'col-desc',
  CreateDate: 'col-date',
  UpdateDate: 'col-date',
});

/** Nút thao tác trên từng dòng: luôn tác động lên chính dòng đó, không phụ thuộc ô chọn. */
const ROW_ACTIONS = Object.freeze([
  { action: 'view', title: 'Xem', label: 'Xem chi tiết', icon: 'eye' },
  { action: 'edit', title: 'Sửa', label: 'Sửa', icon: 'edit' },
  { action: 'copy', title: 'Sao chép', label: 'Sao chép', icon: 'copy' },
  { action: 'remove', title: 'Xóa', label: 'Xóa', icon: 'trash', danger: true },
]);

/** aria-sort của tiêu đề cột → biểu tượng chiều sắp xếp. */
const SORT_ICONS = Object.freeze({ none: 'sort', ascending: 'sort-asc', descending: 'sort-desc' });

/**
 * Các cột dính bên trái (sau cột ô chọn, theo thứ tự hiển thị) và lớp CSS / biến vị trí tương ứng.
 * Vị trí `left` tính bằng JS từ độ rộng thật của các cột dính đang hiện đứng trước.
 */
const STICKY_COLUMNS = Object.freeze([
  { field: 'ProductID', edge: 'code', className: 'sticky-code', offset: '--sticky-left-code' },
  { field: 'ProductName', edge: 'name', className: 'sticky-name', offset: '--sticky-left-name' },
]);
/** Các cột dính trái không chiếm quá tỉ lệ này của khung cuộn (màn hình hẹp vẫn còn chỗ để cuộn ngang). */
const STICKY_MAX_SHARE = 0.6;

function muted(text = EMPTY_TEXT) {
  return el('span', { className: 'muted', text });
}

function dateCell(value) {
  const text = formatDateTime(value);
  return text === EMPTY_TEXT ? muted() : el('time', { datetime: String(value), text });
}

function thumbnail(product) {
  const src = imageUrl(product.PathImage);
  if (!src) {
    // Ô giữ chỗ chỉ để trang trí; ô bảng vẫn có nhãn đọc được cho trình đọc màn hình.
    return [initialPlaceholder(product, 'thumb thumb-initial'), el('span', { className: 'visually-hidden', text: 'Không có ảnh' })];
  }
  const image = el('img', {
    className: 'thumb',
    src,
    alt: `Ảnh ${formatProductCode(product.ProductID)}`,
    width: 40,
    height: 40,
    loading: 'lazy',
    decoding: 'async',
  });
  image.addEventListener('error', () => {
    image.replaceWith(el('span', { className: 'thumb thumb-empty', title: 'Không tải được ảnh' }, icon('image')));
  }, { once: true });
  return image;
}

function clipped(value, className) {
  if (value === null || value === undefined || String(value).trim() === '') return muted();
  return el('span', { className: `cell-clip ${className}`, title: String(value), text: String(value) });
}

const CELL_RENDERERS = Object.freeze({
  ProductID: (p) => el('span', { className: 'code', text: formatProductCode(p.ProductID) || EMPTY_TEXT }),
  PathImage: (p) => thumbnail(p),
  ProductName: (p) => clipped(p.ProductName, 'cell-name'),
  ProductType: (p) => (p.ProductType ? typeTag(p.ProductType) : muted()),
  // Số đứng trước nhãn trong DOM (đọc "7, Sắp hết"); CSS đặt nhãn bên trái để các con số thẳng lề phải.
  Quantity: (p) => el('span', { className: 'qty' }, formatInteger(p.Quantity), stockBadge(p.Quantity, { compact: true })),
  Unit: (p) => displayText(p.Unit),
  Price: (p) => formatMoney(p.Price),
  Description: (p) => clipped(p.Description, 'cell-desc'),
  CreateDate: (p) => dateCell(p.CreateDate),
  UpdateDate: (p) => dateCell(p.UpdateDate),
});

/**
 * Danh sách nút số trang có dấu "…": luôn có trang đầu, trang cuối và các trang quanh trang hiện tại.
 * @returns {Array<number|'gap'>}
 */
function pageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  let start = Math.max(2, current - 1);
  let end = Math.min(total - 1, current + 1);
  if (current <= 3) {
    start = 2;
    end = 4;
  } else if (current >= total - 2) {
    start = total - 3;
    end = total - 1;
  }
  const items = [1];
  if (start > 2) items.push('gap');
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < total - 1) items.push('gap');
  items.push(total);
  return items;
}

/**
 * Ô tiêu đề cột. Cột sắp xếp được có nút (dùng được bằng bàn phím) gồm nhãn và biểu tượng chiều sắp xếp.
 * @param {string} field
 */
function headerCell(field) {
  const label = COLUMN_LABELS[field];
  const cell = el('th', { scope: 'col', className: CELL_CLASSES[field], 'data-col': field });
  if (!SORT_FIELDS.includes(field)) {
    cell.textContent = label;
    return cell;
  }
  cell.setAttribute('aria-sort', 'none');
  cell.append(el('button', { type: 'button', className: 'sort-btn', dataset: { sort: field }, title: `Sắp xếp theo ${label}` },
    el('span', { text: label }),
    icon(SORT_ICONS.none, 'icon sort-icon')));
  return cell;
}

/**
 * Tạo bảng sản phẩm gắn với các phần tử trong index.html.
 * @param {{
 *   onRowAction: (action: 'view'|'edit'|'copy'|'remove', id: number) => void,
 *   onSelectionChange: (count: number) => void,
 *   onPageChange: (page: number) => void,
 *   onPageSizeChange: (pageSize: number) => void,
 *   onSortChange: (field: string) => void,
 *   onEmptyAction: (action: 'add'|'clear-search'|'clear-filters'|'retry') => void,
 * }} handlers
 */
export function createTable({ onRowAction, onSelectionChange, onPageChange, onPageSizeChange, onSortChange, onEmptyAction }) {
  const $ = (id) => document.getElementById(id);
  const table = $('product-table');
  const headRow = $('table-head-row');
  const body = $('table-body');
  const region = $('table-region');
  const scroller = $('table-scroll');
  const selectionBar = $('selection-bar');
  const selectionInfo = $('selection-info');
  const clearSelectionButton = $('btn-clear-selection');
  const summary = $('page-summary');
  const pageSizeSelect = $('page-size');
  const pager = document.querySelector('.pager');
  const firstButton = $('page-first');
  const prevButton = $('page-prev');
  const nextButton = $('page-next');
  const lastButton = $('page-last');
  const pageNumbers = $('page-numbers');
  const pageIndicator = $('page-indicator');

  /** @type {Array<Record<string, any>>} */
  let items = [];
  let pagination = { page: 1, pageSize: PAGE_SIZES[0], total: 0, totalPages: 1 };
  let query = '';
  let filtered = false;
  let visibleColumns = new Set(PRODUCT_FIELDS);
  /** @type {Set<number>} */
  const selected = new Set();

  const selectAll = el('input', {
    type: 'checkbox',
    id: 'select-all',
    className: 'row-check',
    'aria-label': 'Chọn tất cả sản phẩm trên trang này',
    title: 'Chọn tất cả trên trang này',
  });
  const checkHeader = el('th', { scope: 'col', className: 'col-check' }, selectAll);
  /** @type {Map<string, HTMLElement>} */
  const headerCells = new Map(PRODUCT_FIELDS.map((field) => [field, headerCell(field)]));
  const actionsHeader = el('th', { scope: 'col', className: 'col-actions', text: 'Thao tác' });
  headRow.replaceChildren(checkHeader, ...headerCells.values(), actionsHeader);
  pageSizeSelect.replaceChildren(...PAGE_SIZES.map((size) => el('option', { value: String(size), text: `${size} dòng` })));

  /* ---------------------------------------------------------------- sắp xếp */

  /** @param {{ sort: string, order: string }} current */
  function renderSort({ sort, order }) {
    for (const [field, cell] of headerCells) {
      if (!cell.hasAttribute('aria-sort')) continue;
      let direction = 'none';
      if (field === sort) direction = order === 'asc' ? 'ascending' : 'descending';
      cell.setAttribute('aria-sort', direction);
      cell.querySelector('.sort-icon use').setAttribute('href', `#icon-${SORT_ICONS[direction]}`);
    }
  }

  headRow.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('button[data-sort]');
    if (button) onSortChange(button.dataset.sort);
  });
  renderSort(DEFAULT_SORT);

  /* ---------------------------------------------------------------- cột dính khi cuộn ngang */

  /**
   * Tính lại các cột dính bên trái: ô chọn luôn dính; Mã và Tên dính nếu đang hiện và còn trong giới hạn
   * STICKY_MAX_SHARE của phần khung không bị cột "Thao tác" (dính phải) che. `left` của mỗi cột = tổng độ rộng
   * các cột dính đang hiện đứng trước nó. Gọi sau khi vẽ dòng, đổi cột hiển thị và khi khung bảng đổi kích thước.
   */
  function layoutStickyColumns() {
    const actionsWidth = actionsHeader.getBoundingClientRect().width;
    const budget = (scroller.clientWidth - actionsWidth) * STICKY_MAX_SHARE;
    let left = checkHeader.getBoundingClientRect().width;
    let edge = 'check';
    let fits = true;
    for (const column of STICKY_COLUMNS) {
      const header = /** @type {HTMLElement} */ (headerCells.get(column.field));
      const width = header.hidden ? 0 : header.getBoundingClientRect().width;
      // Các cột dính phải liền nhau từ mép trái: một cột không vừa thì các cột sau cũng không dính.
      const sticky = fits && width > 0 && left + width <= budget;
      if (width > 0 && !sticky) fits = false;
      table.classList.toggle(column.className, sticky);
      if (sticky) {
        table.style.setProperty(column.offset, `${left}px`);
        left += width;
        edge = column.edge;
      }
    }
    table.dataset.stickyEdge = edge;
    // scroll-padding ngang = phần bị cột dính che: focus bằng bàn phím hay scrollIntoView sẽ đưa ô vào đúng
    // vùng nhìn thấy thay vì để nó nằm khuất dưới cột dính.
    scroller.style.setProperty('--sticky-start', `${left}px`);
    scroller.style.setProperty('--sticky-end', `${actionsWidth}px`);
    syncScrollEdges();
  }

  /** Bóng mờ ở mép cột dính chỉ hiện khi có nội dung bị cuộn khuất phía sau nó. */
  function syncScrollEdges() {
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    table.classList.toggle('is-scrolled-left', scroller.scrollLeft > 0);
    table.classList.toggle('can-scroll-right', scroller.scrollLeft < maxScroll - 1);
  }

  scroller.addEventListener('scroll', syncScrollEdges, { passive: true });
  // Đổi kích thước cửa sổ (và khung bảng) → tính lại giới hạn và vị trí các cột dính.
  new ResizeObserver(() => layoutStickyColumns()).observe(scroller);

  /* ---------------------------------------------------------------- dựng dòng */

  function buildRow(product, flash) {
    const id = String(product.ProductID);
    const label = formatProductLabel(product);
    const row = el('tr', { dataset: { id }, className: flash ? 'row-flash' : null });
    row.append(el('td', { className: 'col-check' }, el('input', {
      type: 'checkbox',
      className: 'row-check',
      dataset: { id },
      'aria-label': `Chọn ${label}`,
    })));
    for (const field of PRODUCT_FIELDS) {
      const isHeader = field === 'ProductID';
      row.append(el(isHeader ? 'th' : 'td', {
        className: CELL_CLASSES[field],
        scope: isHeader ? 'row' : null,
        'data-col': field,
        hidden: !visibleColumns.has(field),
      }, CELL_RENDERERS[field](product)));
    }
    row.append(el('td', { className: 'col-actions' }, el('div', { className: 'row-actions' },
      ROW_ACTIONS.map((action) => el('button', {
        type: 'button',
        className: action.danger ? 'icon-btn icon-btn-danger' : 'icon-btn',
        dataset: { action: action.action, id },
        title: action.title,
        'aria-label': `${action.label} ${label}`,
      }, icon(action.icon))))));
    return row;
  }

  /**
   * @param {string} iconName
   * @param {string} title
   * @param {string} text
   * @param {Array<{ action: string, label: string }>} [buttons]
   */
  function messageRow(iconName, title, text, buttons = []) {
    return el('tr', { className: 'message-row' }, el('td', { colSpan: visibleColumns.size + 2 },
      el('div', { className: 'empty-state' },
        icon(iconName, 'icon empty-icon'),
        el('p', { className: 'empty-title', text: title }),
        text ? el('p', { className: 'empty-text', text }) : null,
        buttons.length > 0 ? el('div', { className: 'empty-actions' }, buttons.map((button) => el('button', {
          type: 'button',
          className: 'btn btn-sm',
          dataset: { emptyAction: button.action },
        }, el('span', { className: 'btn-label', text: button.label })))) : null)));
  }

  function emptyRow() {
    if (query && filtered) {
      return messageRow('search', `Không tìm thấy sản phẩm phù hợp với "${query}" và bộ lọc đang chọn`,
        'Hãy thử từ khóa khác hoặc bỏ lọc để mở rộng kết quả.',
        [{ action: 'clear-filters', label: 'Bỏ lọc' }, { action: 'clear-search', label: 'Xóa từ khóa' }]);
    }
    if (filtered) {
      return messageRow('filter', 'Không có sản phẩm phù hợp với bộ lọc',
        'Hãy chọn loại hoặc tình trạng kho khác, hoặc bỏ lọc để xem toàn bộ danh sách.',
        [{ action: 'clear-filters', label: 'Bỏ lọc' }]);
    }
    if (query) {
      return messageRow('search', `Không tìm thấy sản phẩm phù hợp với "${query}"`,
        'Hãy thử từ khóa khác (không cần gõ dấu) hoặc xóa từ khóa để xem toàn bộ danh sách.',
        [{ action: 'clear-search', label: 'Xóa từ khóa' }]);
    }
    return messageRow('inbox', 'Không có sản phẩm nào', 'Bấm "Thêm mới" hoặc nhập sản phẩm từ file để bắt đầu.',
      [{ action: 'add', label: 'Thêm sản phẩm' }]);
  }

  /* ---------------------------------------------------------------- focus khi vẽ lại */

  function captureFocus() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !body.contains(active)) return null;
    const row = active.closest('tr[data-id]');
    return { id: row?.dataset.id ?? null, action: active.dataset.action ?? null };
  }

  function restoreFocus(saved) {
    if (!saved) return;
    const row = saved.id ? body.querySelector(`tr[data-id="${CSS.escape(saved.id)}"]`) : null;
    let target = null;
    if (row) {
      target = saved.action
        ? row.querySelector(`button[data-action="${CSS.escape(saved.action)}"]`)
        : row.querySelector('input.row-check');
    }
    (target ?? scroller).focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- lựa chọn */

  function syncSelection() {
    let count = 0;
    for (const row of body.querySelectorAll('tr[data-id]')) {
      const isSelected = selected.has(Number(row.dataset.id));
      if (isSelected) count += 1;
      row.classList.toggle('is-selected', isSelected);
      const checkbox = row.querySelector('input.row-check');
      if (checkbox) checkbox.checked = isSelected;
    }
    selectAll.checked = items.length > 0 && count === items.length;
    selectAll.indeterminate = count > 0 && count < items.length;
    selectAll.disabled = items.length === 0;
    selectionInfo.textContent = `Đã chọn ${formatNumberVi(count)} sản phẩm`;
    selectionBar.classList.toggle('has-selection', count > 0);
    clearSelectionButton.hidden = count === 0;
    onSelectionChange(count);
  }

  function toggleRow(id, checked) {
    if (checked) selected.add(id);
    else selected.delete(id);
    syncSelection();
  }

  // "Chọn tất cả" chỉ tác động lên các dòng của trang hiện tại.
  selectAll.addEventListener('change', () => {
    selected.clear();
    if (selectAll.checked) for (const product of items) selected.add(product.ProductID);
    syncSelection();
  });

  body.addEventListener('change', (event) => {
    const checkbox = /** @type {HTMLElement} */ (event.target).closest('input.row-check');
    if (checkbox) toggleRow(Number(checkbox.dataset.id), checkbox.checked);
  });

  body.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const actionButton = target.closest('button[data-action]');
    if (actionButton) {
      onRowAction(actionButton.dataset.action, Number(actionButton.dataset.id));
      return;
    }
    const emptyButton = target.closest('button[data-empty-action]');
    if (emptyButton) {
      onEmptyAction(emptyButton.dataset.emptyAction);
      return;
    }
    // Bấm vào vùng trống của dòng cũng chọn/bỏ chọn dòng (trừ khi đang bôi đen chữ).
    if (target.closest('a, button, input, label, select, textarea')) return;
    const row = target.closest('tr[data-id]');
    if (!row || String(window.getSelection() ?? '') !== '') return;
    const id = Number(row.dataset.id);
    toggleRow(id, !selected.has(id));
  });

  /* ---------------------------------------------------------------- phân trang */

  function renderPagination({ available = true } = {}) {
    const { page, pageSize, total, totalPages } = pagination;
    const pagerHadFocus = pager.contains(document.activeElement);
    if (!available) {
      summary.textContent = 'Chưa tải được dữ liệu';
    } else if (total === 0) {
      summary.textContent = 'Tổng cộng 0 sản phẩm';
    } else {
      const from = (page - 1) * pageSize + 1;
      const to = Math.min(total, from + Math.max(items.length, 1) - 1);
      summary.textContent = `Hiển thị ${formatNumberVi(from)}–${formatNumberVi(to)} trên tổng ${formatNumberVi(total)} sản phẩm`;
    }
    firstButton.disabled = !available || page <= 1;
    prevButton.disabled = !available || page <= 1;
    nextButton.disabled = !available || page >= totalPages;
    lastButton.disabled = !available || page >= totalPages;
    pageNumbers.replaceChildren(...(available ? pageItems(page, totalPages) : []).map((item) => (item === 'gap'
      ? el('span', { className: 'page-gap', 'aria-hidden': 'true', text: '…' })
      : el('button', {
        type: 'button',
        className: 'page-btn',
        dataset: { page: String(item) },
        'aria-label': `Trang ${item}`,
        'aria-current': item === page ? 'page' : null,
        text: String(item),
      }))));
    pageIndicator.textContent = available ? `Trang ${formatNumberVi(page)}/${formatNumberVi(totalPages)}` : '';
    pageSizeSelect.value = String(pageSize);
    // Nút đang có focus bị vẽ lại hoặc bị vô hiệu hóa: chuyển focus sang nút trang hiện tại.
    const active = document.activeElement;
    if (pagerHadFocus && (!pager.contains(active) || /** @type {HTMLButtonElement} */ (active).disabled)) {
      (pageNumbers.querySelector('[aria-current="page"]') ?? scroller).focus({ preventScroll: true });
    }
  }

  firstButton.addEventListener('click', () => onPageChange(1));
  prevButton.addEventListener('click', () => onPageChange(pagination.page - 1));
  nextButton.addEventListener('click', () => onPageChange(pagination.page + 1));
  lastButton.addEventListener('click', () => onPageChange(pagination.totalPages));
  pageNumbers.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('button[data-page]');
    const page = button ? Number(button.dataset.page) : Number.NaN;
    if (Number.isInteger(page) && page !== pagination.page) onPageChange(page);
  });
  pageSizeSelect.addEventListener('change', () => onPageSizeChange(Number(pageSizeSelect.value)));

  /* ---------------------------------------------------------------- API của bảng */

  return {
    /**
     * Vẽ một trang dữ liệu. Giữ lại các id đã chọn còn xuất hiện trên trang (tải lại cùng trang).
     * @param {{ items: object[], pagination: typeof pagination, q: string, filtered?: boolean, highlight?: number[] }} data
     *        filtered: đang lọc theo loại/tình trạng kho (nội dung khi không có dòng nào)
     */
    render(data) {
      items = data.items;
      pagination = data.pagination;
      query = data.q;
      filtered = Boolean(data.filtered);
      const present = new Set(items.map((product) => product.ProductID));
      for (const id of selected) if (!present.has(id)) selected.delete(id);
      const saved = captureFocus();
      const flash = new Set(data.highlight ?? []);
      body.replaceChildren(...(items.length > 0
        ? items.map((product) => buildRow(product, flash.has(product.ProductID)))
        : [emptyRow()]));
      restoreFocus(saved);
      renderPagination();
      syncSelection();
      layoutStickyColumns();
    },

    /** Hiện lỗi tải danh sách (kèm nút Thử lại) thay cho dữ liệu cũ. @param {string} message */
    showError(message) {
      items = [];
      selected.clear();
      const saved = captureFocus();
      body.replaceChildren(messageRow('alert-circle', 'Không tải được danh sách sản phẩm', message,
        [{ action: 'retry', label: 'Thử lại' }]));
      if (saved) body.querySelector('button[data-empty-action]')?.focus();
      renderPagination({ available: false });
      syncSelection();
      layoutStickyColumns();
    },

    /**
     * Hiện cột và chiều đang sắp xếp trên tiêu đề (aria-sort + biểu tượng).
     * @param {{ sort: string, order: string }} current
     */
    setSort(current) {
      renderSort(current);
    },

    /** Bật/tắt lớp phủ "Đang tải dữ liệu…". */
    setLoading(isLoading) {
      region.classList.toggle('is-loading', isLoading);
      scroller.setAttribute('aria-busy', String(isLoading));
    },

    /** Áp dụng danh sách cột hiển thị ngay trên DOM hiện có (không tải lại dữ liệu). */
    setVisibleColumns(columns) {
      visibleColumns = new Set(columns);
      for (const cell of table.querySelectorAll('[data-col]')) {
        cell.hidden = !visibleColumns.has(/** @type {HTMLElement} */ (cell).dataset.col);
      }
      for (const cell of body.querySelectorAll('tr.message-row > td')) cell.colSpan = visibleColumns.size + 2;
      layoutStickyColumns();
    },

    /** Id các dòng đang chọn, theo thứ tự hiển thị. */
    getSelectedIds() {
      return items.filter((product) => selected.has(product.ProductID)).map((product) => product.ProductID);
    },

    /** Sản phẩm trên trang hiện tại theo id (dùng cho nội dung hộp xác nhận). */
    findProduct(id) {
      return items.find((product) => product.ProductID === id) ?? null;
    },

    /** Bỏ chọn tất cả. */
    clearSelection() {
      selected.clear();
      syncSelection();
    },
  };
}
