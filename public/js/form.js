/**
 * Biểu mẫu thêm/sửa sản phẩm trong hộp thoại.
 * - Kiểm tra dữ liệu bằng quy tắc dùng chung (validateProductInput, checkImageFileMeta).
 * - Lỗi hiển thị dưới từng trường; lỗi từ server (details[].field) đổ về đúng các ô lỗi đó.
 * - Ảnh: xem trước, "Bỏ ảnh"; khi sửa mà không chọn ảnh mới thì không gửi gì → server giữ ảnh cũ.
 */
import {
  EDITABLE_FIELDS, IMAGE_RULES, LIMITS, VALIDATION_MESSAGE,
  checkImageFileMeta, formatNumberVi, formatProductCode, validateProductInput,
} from '/shared/productRules.js';
import { ApiError, createProduct, updateProduct } from './api.js';
import { beginBusy, hideDialog, setButtonBusy, setupDialog, showDialog } from './dialogs.js';
import { el, formatDateTime, formatFileSize, formatMoney, icon, imageUrl } from './format.js';

/** Trường trong details[] của server → ô lỗi trên biểu mẫu. */
const SERVER_FIELD_SLOTS = new Map([
  ...EDITABLE_FIELDS.map((field) => [field, field]),
  ['image', 'image'],
  ['PathImage', 'image'],
]);
/**
 * Giá trị ô số để kiểm tra. type="number" trả về '' khi nội dung không phải số (badInput): chuyển một giá trị
 * không hợp lệ cho rule chung để thông báo "phải là số nguyên không âm" thay vì "là bắt buộc".
 * @param {HTMLInputElement} input
 */
function numberValue(input) {
  return input.validity.badInput ? '?' : input.value;
}

const BUSY_MESSAGE = 'Đang có thao tác khác được xử lý. Vui lòng đợi trong giây lát rồi lưu lại.';
const UNEXPECTED_MESSAGE = 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';

/**
 * @param {{
 *   requestSave: () => void,
 *   onSaved: (result: { mode: 'add'|'edit', product: Record<string, any>|null, message: string }) => void,
 *   onMissing: (error: ApiError) => void,
 * }} handlers requestSave gọi actions.save() để nút Lưu, phím Enter và Alt+S đi chung một đường
 */
export function createProductForm({ requestSave, onSaved, onMissing }) {
  const $ = (id) => document.getElementById(id);
  const dialog = /** @type {HTMLDialogElement} */ ($('product-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('product-form'));
  const fieldset = /** @type {HTMLFieldSetElement} */ ($('product-fieldset'));
  const title = $('product-dialog-title');
  const subtitle = $('product-dialog-subtitle');
  const alertBox = $('product-form-alert');
  const meta = $('product-meta');
  const saveButton = /** @type {HTMLButtonElement} */ ($('btn-save'));
  const fileInput = /** @type {HTMLInputElement} */ ($('f-image'));
  const previewImage = /** @type {HTMLImageElement} */ ($('image-preview-img'));
  const previewEmpty = $('image-preview-empty');
  const previewText = $('image-preview-text');
  const imageStatus = $('image-status');
  const removeImageButton = $('btn-remove-image');
  const restoreImageButton = $('btn-restore-image');
  const priceHint = $('hint-Price');
  const descriptionCount = $('count-Description');

  /** @type {Record<string, HTMLInputElement|HTMLTextAreaElement>} */
  const inputs = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, $(`f-${field}`)]));
  const controls = { ...inputs, image: fileInput };
  // Thứ tự ô lỗi theo vị trí trên biểu mẫu: focus vào trường lỗi đầu tiên người dùng nhìn thấy.
  const slotOrder = [...form.querySelectorAll('[data-field]')].map((node) => /** @type {HTMLElement} */ (node).dataset.field);
  const errorNodes = Object.fromEntries(slotOrder.map((slot) => [slot, $(`err-${slot}`)]));

  const state = {
    mode: /** @type {'add'|'edit'} */ ('add'),
    /** @type {Record<string, any>|null} */ product: null,
    /** @type {string|null} */ existingImage: null,
    /** @type {File|null} */ newFile: null,
    removeExisting: false,
    /** @type {string|null} */ previewUrl: null,
    saving: false,
    /** @type {(() => void)|null} */ restoreSaveButton: null,
  };

  // Thuộc tính HTML phản ánh đúng giới hạn dùng chung.
  inputs.ProductName.maxLength = LIMITS.productNameMax;
  inputs.ProductType.maxLength = LIMITS.productTypeMax;
  inputs.Unit.maxLength = LIMITS.unitMax;
  inputs.Description.maxLength = LIMITS.descriptionMax;
  inputs.Quantity.max = String(LIMITS.quantityMax);
  inputs.Price.max = String(LIMITS.priceMax);
  fileInput.accept = IMAGE_RULES.accept;

  /* ---------------------------------------------------------------- lỗi theo trường */

  function setFieldError(slot, message) {
    errorNodes[slot].textContent = message;
    controls[slot].setAttribute('aria-invalid', 'true');
    controls[slot].closest('.field')?.classList.add('has-error');
  }

  function clearFieldError(slot) {
    errorNodes[slot].textContent = '';
    controls[slot].removeAttribute('aria-invalid');
    controls[slot].closest('.field')?.classList.remove('has-error');
  }

  function showAlert(message, lines = []) {
    alertBox.replaceChildren(
      icon('alert-circle', 'icon form-alert-icon'),
      el('div', { className: 'form-alert-body' },
        el('p', { className: 'form-alert-title', text: message }),
        lines.length > 0 ? el('ul', { className: 'form-alert-list' }, lines.map((line) => el('li', { text: line }))) : null),
    );
    alertBox.hidden = false;
  }

  function clearErrors() {
    for (const slot of slotOrder) clearFieldError(slot);
    alertBox.hidden = true;
    alertBox.replaceChildren();
  }

  /**
   * Hiện lỗi dưới từng trường (mỗi trường lỗi đầu tiên) và focus trường lỗi đầu tiên.
   * @param {Array<{ field: string, message: string }>} fieldErrors
   * @param {{ message?: string, extra?: string[] }} [options] extra: lỗi không gắn được với trường nào
   */
  function showErrors(fieldErrors, { message = VALIDATION_MESSAGE, extra = [] } = {}) {
    const marked = new Set();
    for (const error of fieldErrors) {
      if (marked.has(error.field)) continue;
      marked.add(error.field);
      setFieldError(error.field, error.message);
    }
    if (extra.length > 0) showAlert(message, extra);
    const first = slotOrder.find((slot) => marked.has(slot));
    if (first) controls[first].focus();
    else saveButton.focus();
  }

  /* ---------------------------------------------------------------- ảnh */

  function revokePreview() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }

  function renderImage() {
    revokePreview();
    let src = null;
    let status;
    if (state.newFile) {
      state.previewUrl = URL.createObjectURL(state.newFile);
      src = state.previewUrl;
      status = `Ảnh mới: ${state.newFile.name} (${formatFileSize(state.newFile.size)}), được lưu khi bấm Lưu.`;
    } else if (state.existingImage && !state.removeExisting) {
      src = state.existingImage;
      status = 'Đang dùng ảnh hiện tại. Không chọn ảnh mới thì ảnh này được giữ nguyên.';
    } else if (state.existingImage) {
      status = 'Ảnh hiện tại sẽ được gỡ khỏi sản phẩm khi bấm Lưu.';
    } else {
      status = 'Chưa chọn ảnh (không bắt buộc).';
    }
    if (src) previewImage.src = src;
    else previewImage.removeAttribute('src');
    previewImage.hidden = !src;
    previewEmpty.hidden = Boolean(src);
    previewText.textContent = 'Chưa có ảnh';
    imageStatus.textContent = status;
    removeImageButton.hidden = !src;
    restoreImageButton.hidden = !(state.existingImage && (state.newFile || state.removeExisting));
  }

  previewImage.addEventListener('error', () => {
    if (!previewImage.getAttribute('src')) return;
    previewImage.hidden = true;
    previewEmpty.hidden = false;
    previewText.textContent = 'Không tải được ảnh';
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return; // hủy hộp chọn file: giữ nguyên lựa chọn trước đó
    // File được giữ trong state; để input trống để chọn lại đúng file đó vẫn phát sinh sự kiện change.
    fileInput.value = '';
    const error = checkImageFileMeta(file);
    if (error) {
      setFieldError('image', error);
      return;
    }
    clearFieldError('image');
    state.newFile = file;
    renderImage();
  });

  removeImageButton.addEventListener('click', () => {
    state.newFile = null;
    state.removeExisting = Boolean(state.existingImage);
    clearFieldError('image');
    renderImage();
    fileInput.focus();
  });

  restoreImageButton.addEventListener('click', () => {
    state.newFile = null;
    state.removeExisting = false;
    clearFieldError('image');
    renderImage();
    fileInput.focus();
  });

  /* ---------------------------------------------------------------- gợi ý nhập */

  function updatePriceHint() {
    const raw = inputs.Price.value.trim();
    priceHint.textContent = /^\d+$/.test(raw) ? `Hiển thị: ${formatMoney(Number(raw))}` : '';
  }

  function updateDescriptionCount() {
    const length = inputs.Description.value.length;
    descriptionCount.textContent = `${formatNumberVi(length)}/${formatNumberVi(LIMITS.descriptionMax)}`;
  }

  for (const field of EDITABLE_FIELDS) inputs[field].addEventListener('input', () => clearFieldError(field));
  inputs.Price.addEventListener('input', updatePriceHint);
  inputs.Description.addEventListener('input', updateDescriptionCount);

  /* ---------------------------------------------------------------- mở / đóng */

  function resetState() {
    form.reset();
    clearErrors();
    Object.assign(state, { product: null, existingImage: null, newFile: null, removeExisting: false });
    renderImage();
    updatePriceHint();
    updateDescriptionCount();
  }

  /** Hàm đóng duy nhất (nút Hủy, nút ×, Esc): không đóng khi đang lưu. */
  function requestClose() {
    if (!state.saving) hideDialog(dialog);
  }

  setupDialog(dialog, { onRequestClose: requestClose, onClosed: resetState });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    requestSave();
  });

  function setSaving(saving) {
    state.saving = saving;
    fieldset.disabled = saving;
    for (const button of dialog.querySelectorAll('[data-dialog-close]')) button.disabled = saving;
    if (saving) {
      state.restoreSaveButton = setButtonBusy(saveButton, 'Đang lưu…');
    } else {
      state.restoreSaveButton?.();
      state.restoreSaveButton = null;
    }
  }

  /* ---------------------------------------------------------------- lưu */

  function readValues() {
    return {
      ProductName: inputs.ProductName.value,
      ProductType: inputs.ProductType.value,
      Quantity: numberValue(inputs.Quantity),
      Unit: inputs.Unit.value,
      Price: numberValue(inputs.Price),
      Description: inputs.Description.value,
    };
  }

  function buildFormData(value) {
    const data = new FormData();
    data.append('ProductName', value.ProductName);
    data.append('ProductType', value.ProductType);
    data.append('Quantity', String(value.Quantity));
    data.append('Unit', value.Unit);
    data.append('Price', String(value.Price));
    data.append('Description', value.Description ?? '');
    if (state.newFile) data.append('image', state.newFile, state.newFile.name);
    else if (state.mode === 'edit' && state.removeExisting) data.append('removeImage', 'true');
    // Sửa mà không chọn ảnh mới và không bỏ ảnh: không gửi trường ảnh nào → server giữ ảnh cũ.
    return data;
  }

  function handleSaveError(error, mode) {
    if (!(error instanceof ApiError)) {
      console.error(error);
      showAlert(UNEXPECTED_MESSAGE);
      saveButton.focus();
      return;
    }
    if (mode === 'edit' && error.status === 404) {
      hideDialog(dialog);
      onMissing(error);
      return;
    }
    const fieldErrors = [];
    const extra = [];
    for (const detail of error.details) {
      const text = typeof detail.message === 'string' && detail.message ? detail.message : error.message;
      const slot = typeof detail.field === 'string' ? SERVER_FIELD_SLOTS.get(detail.field) : undefined;
      if (slot) fieldErrors.push({ field: slot, message: text });
      else extra.push(text);
    }
    if (fieldErrors.length === 0 && extra.length === 0) {
      showAlert(error.message);
      saveButton.focus();
      return;
    }
    showErrors(fieldErrors, { message: error.message, extra });
  }

  /** Lưu biểu mẫu đang mở (actions.save). Lần gọi thứ hai trong lúc đang lưu bị bỏ qua. */
  async function save() {
    if (!dialog.open || state.saving) return;
    clearErrors();
    const { value, errors } = validateProductInput(readValues());
    const imageError = state.newFile ? checkImageFileMeta(state.newFile) : null;
    if (imageError) errors.push({ field: 'image', message: imageError });
    if (errors.length > 0) {
      showErrors(errors);
      return;
    }
    const endBusy = beginBusy();
    if (!endBusy) {
      showAlert(BUSY_MESSAGE);
      return;
    }
    const { mode } = state;
    const productId = state.product?.ProductID;
    setSaving(true);
    try {
      const formData = buildFormData(value);
      const payload = mode === 'edit' ? await updateProduct(productId, formData) : await createProduct(formData);
      setSaving(false);
      hideDialog(dialog);
      onSaved({
        mode,
        product: payload.data && typeof payload.data === 'object' ? payload.data : null,
        message: typeof payload.message === 'string' ? payload.message : '',
      });
    } catch (error) {
      setSaving(false);
      handleSaveError(error, mode);
    } finally {
      endBusy();
    }
  }

  /** Mở biểu mẫu thêm mới. */
  function openAdd() {
    resetState();
    state.mode = 'add';
    title.textContent = 'Thêm sản phẩm mới';
    subtitle.textContent = 'Điền thông tin sản phẩm; các trường có dấu * là bắt buộc.';
    meta.hidden = true;
    showDialog(dialog, { initialFocus: inputs.ProductName });
  }

  /**
   * Mở biểu mẫu sửa với dữ liệu mới nhất vừa tải từ server.
   * @param {Record<string, any>} product
   */
  function openEdit(product) {
    resetState();
    const code = formatProductCode(product.ProductID);
    Object.assign(state, { mode: 'edit', product, existingImage: imageUrl(product.PathImage) });
    title.textContent = `Sửa sản phẩm ${code}`;
    subtitle.textContent = 'Mã và ngày tháng do hệ thống quản lý. Không chọn ảnh mới thì ảnh hiện tại được giữ nguyên.';
    $('meta-code').textContent = `${code} (ID ${product.ProductID})`;
    $('meta-created').textContent = formatDateTime(product.CreateDate);
    $('meta-updated').textContent = formatDateTime(product.UpdateDate);
    meta.hidden = false;
    inputs.ProductName.value = product.ProductName ?? '';
    inputs.ProductType.value = product.ProductType ?? '';
    inputs.Quantity.value = product.Quantity === null || product.Quantity === undefined ? '' : String(product.Quantity);
    inputs.Unit.value = product.Unit ?? '';
    inputs.Price.value = product.Price === null || product.Price === undefined ? '' : String(product.Price);
    inputs.Description.value = product.Description ?? '';
    renderImage();
    updatePriceHint();
    updateDescriptionCount();
    showDialog(dialog, { initialFocus: inputs.ProductName });
  }

  return {
    openAdd,
    openEdit,
    save,
    /** Biểu mẫu có đang mở không. */
    isOpen: () => dialog.open,
  };
}
