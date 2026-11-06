/**
 * Nhập file (.xlsx/.json/.xml) qua hộp thoại, xuất toàn bộ kết quả (theo từ khóa, bộ lọc, thứ tự) và tải file mẫu.
 * Lỗi nhập được liệt kê theo dòng/sản phẩm và trường; server kiểm tra toàn bộ trước khi ghi.
 */
import {
  FIELD_LABELS, IMPORTABLE_FIELDS, IMPORT_RULES, REQUIRED_IMPORT_FIELDS,
  checkImportFileMeta, detectImportFormat, formatNumberVi,
} from '/shared/productRules.js';
import { ApiError, downloadExport, downloadTemplate, importProducts } from './api.js';
import {
  beginBusy, hideDialog, setButtonBusy, setupDialog, showDialog, startProgress, toast, toastError,
} from './dialogs.js';
import { el, formatFileSize } from './format.js';

const MAX_LISTED_ERRORS = 500;
const BUSY_MESSAGE = 'Đang có thao tác khác được xử lý. Vui lòng đợi trong giây lát rồi nhập lại.';
const UNEXPECTED_MESSAGE = 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';

function importRules() {
  const maxMegabytes = IMPORT_RULES.maxBytes / (1024 * 1024);
  return [
    `Định dạng ${IMPORT_RULES.extensions.join(', ')}: Excel dùng sheet "Products" với dòng 1 là tên trường; `
      + 'JSON là một mảng sản phẩm; XML có dạng <Products><Product>…</Product></Products>.',
    `Dung lượng tối đa ${formatNumberVi(maxMegabytes)} MB, tối đa ${formatNumberVi(IMPORT_RULES.maxProducts)} sản phẩm mỗi lần nhập.`,
    `Các trường: ${IMPORTABLE_FIELDS.join(', ')}; bắt buộc: ${REQUIRED_IMPORT_FIELDS.join(', ')}.`,
    'PathImage để trống hoặc chỉ tham chiếu ảnh đã có trong ứng dụng, dạng /uploads/ten-file.png (file không chứa dữ liệu ảnh).',
    'ProductID, ngày tạo và ngày cập nhật do hệ thống sinh lại; nhập file chỉ thêm sản phẩm mới.',
    'Không chấp nhận ô Excel chứa công thức và XML có DTD/ENTITY.',
    'Toàn bộ file được kiểm tra trước khi ghi: chỉ cần một lỗi thì chưa sản phẩm nào được nhập.',
  ];
}

/**
 * Một dòng lỗi import: "Dòng 3 – Giá (VNĐ): …" (xlsx) hoặc "Sản phẩm thứ 3 – …" (json/xml).
 * @param {Record<string, unknown>} detail
 * @param {string|null} format
 */
function fieldLabel(field) {
  if (typeof field !== 'string' || field === '') return null;
  return Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field] : field;
}

function describeImportDetail(detail, format) {
  const row = Number.isSafeInteger(detail.row) && Number(detail.row) > 0 ? Number(detail.row) : null;
  const field = fieldLabel(detail.field);
  let place = null;
  if (row !== null) place = format === 'json' || format === 'xml' ? `Sản phẩm thứ ${formatNumberVi(row)}` : `Dòng ${formatNumberVi(row)}`;
  const head = [place, field].filter(Boolean).join(' – ');
  const message = typeof detail.message === 'string' ? detail.message : '';
  return head ? `${head}: ${message}` : message;
}

/**
 * @param {{ onImported: (payload: { data?: { imported?: number, ids?: number[] }, message?: string }) => void }} handlers
 * @returns {{ openImport: () => void, exportFile: (format: string, query: object) => Promise<void>,
 *             downloadTemplateFile: (format: string) => Promise<void> }}
 */
export function createImportExport({ onImported }) {
  const $ = (id) => document.getElementById(id);
  const dialog = /** @type {HTMLDialogElement} */ ($('import-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('import-form'));
  const fileInput = /** @type {HTMLInputElement} */ ($('import-file'));
  const dropzone = $('import-dropzone');
  const fileName = $('import-file-name');
  const fileError = $('import-file-error');
  const result = $('import-result');
  const resultTitle = $('import-result-title');
  const resultList = $('import-result-list');
  const submitButton = /** @type {HTMLButtonElement} */ ($('btn-import-submit'));
  const exportButton = /** @type {HTMLButtonElement} */ ($('btn-export'));

  /** @type {File|null} */
  let selectedFile = null;
  let importing = false;
  let exporting = false;
  /** @type {(() => void)|null} */
  let restoreSubmit = null;

  fileInput.accept = IMPORT_RULES.accept;
  $('import-rules').replaceChildren(...importRules().map((text) => el('li', { text })));

  function setFileError(message) {
    fileError.textContent = message;
    if (message) fileInput.setAttribute('aria-invalid', 'true');
    else fileInput.removeAttribute('aria-invalid');
    dropzone.classList.toggle('has-error', Boolean(message));
  }

  function clearResult() {
    result.hidden = true;
    resultTitle.textContent = '';
    resultList.replaceChildren();
  }

  function showResult(title, lines) {
    resultTitle.textContent = title;
    const shown = lines.slice(0, MAX_LISTED_ERRORS);
    resultList.replaceChildren(
      ...shown.map((line) => el('li', { text: line })),
      lines.length > shown.length ? el('li', { className: 'muted', text: `… và ${formatNumberVi(lines.length - shown.length)} lỗi khác` }) : null,
    );
    resultList.hidden = lines.length === 0;
    result.hidden = false;
    result.focus();
  }

  function selectFile(file) {
    selectedFile = file;
    fileName.textContent = `${file.name} (${formatFileSize(file.size)})`;
    dropzone.classList.add('has-file');
    clearResult();
    setFileError(checkImportFileMeta(file) ?? '');
  }

  function reset() {
    form.reset();
    selectedFile = null;
    fileName.textContent = 'Chưa chọn file';
    dropzone.classList.remove('has-file', 'is-dragover');
    setFileError('');
    clearResult();
  }

  function setImporting(value) {
    importing = value;
    fileInput.disabled = value;
    for (const button of dialog.querySelectorAll('[data-dialog-close]')) button.disabled = value;
    if (value) {
      restoreSubmit = setButtonBusy(submitButton, 'Đang nhập…');
    } else {
      restoreSubmit?.();
      restoreSubmit = null;
    }
  }

  /** Hàm đóng duy nhất (Hủy, ×, Esc): không đóng khi đang nhập. */
  function requestClose() {
    if (!importing) hideDialog(dialog);
  }

  setupDialog(dialog, { onRequestClose: requestClose, onClosed: reset });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) selectFile(file);
  });

  // Kéo thả file vào vùng chọn file.
  dropzone.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    // Luôn chặn mặc định để trình duyệt không tự mở file; đang nhập thì không nhận file mới.
    event.preventDefault();
    event.dataTransfer.dropEffect = importing ? 'none' : 'copy';
    dropzone.classList.toggle('is-dragover', !importing);
  });
  dropzone.addEventListener('dragleave', (event) => {
    if (!dropzone.contains(/** @type {Node|null} */ (event.relatedTarget))) dropzone.classList.remove('is-dragover');
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file && !importing) selectFile(file);
  });

  function renderImportError(error, fallbackFormat) {
    if (!(error instanceof ApiError)) {
      console.error(error);
      showResult(UNEXPECTED_MESSAGE, []);
      return;
    }
    if (error.code === 'IMPORT_VALIDATION_ERROR') {
      const format = error.format ?? fallbackFormat;
      showResult(error.message, error.details.map((detail) => describeImportDetail(detail, format)));
      return;
    }
    // FILE_ERROR, FILE_TOO_LARGE, lỗi mạng…: hiện thông báo (kèm chi tiết nếu có).
    const lines = error.details
      .map((detail) => detail.message)
      .filter((text) => typeof text === 'string' && text !== '' && text !== error.message);
    showResult(error.message, lines);
  }

  async function submitImport() {
    if (importing) return;
    clearResult();
    const metaError = checkImportFileMeta(selectedFile);
    if (metaError) {
      setFileError(metaError);
      fileInput.focus();
      return;
    }
    const endBusy = beginBusy();
    if (!endBusy) {
      showResult(BUSY_MESSAGE, []);
      return;
    }
    const file = /** @type {File} */ (selectedFile);
    setImporting(true);
    try {
      const payload = await importProducts(file);
      setImporting(false);
      hideDialog(dialog);
      onImported(payload);
    } catch (error) {
      setImporting(false);
      renderImportError(error, detectImportFormat(file.name));
    } finally {
      endBusy();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitImport(); // tự xử lý mọi lỗi bên trong
  });

  return {
    /** Mở hộp thoại nhập file. */
    openImport() {
      reset();
      showDialog(dialog, { initialFocus: fileInput });
    },

    /**
     * Xuất toàn bộ kết quả theo từ khóa, bộ lọc và thứ tự hiện tại (mọi trang, đủ 10 trường;
     * không phụ thuộc cột đang ẩn).
     * @param {'xlsx'|'json'|'xml'} format
     * @param {{ q?: string, type?: string, stock?: string, sort?: string, order?: string }} query
     */
    async exportFile(format, query) {
      if (exporting) {
        toast.info('Đang xuất file, vui lòng đợi…');
        return;
      }
      exporting = true;
      const restoreButton = setButtonBusy(exportButton, 'Đang xuất…');
      const stopProgress = startProgress();
      const pending = toast.info('Đang xuất file…', { duration: 0 });
      try {
        const { fileName: name } = await downloadExport(format, query);
        pending.close();
        toast.success(`Đã xuất file ${name}`);
      } catch (error) {
        pending.close();
        toastError(error);
      } finally {
        exporting = false;
        restoreButton();
        stopProgress();
      }
    },

    /**
     * Tải file mẫu nhập dữ liệu.
     * @param {'xlsx'|'json'|'xml'} format
     */
    async downloadTemplateFile(format) {
      const stopProgress = startProgress();
      try {
        const { fileName: name } = await downloadTemplate(format);
        toast.success(`Đã tải file mẫu ${name}`);
      } catch (error) {
        toastError(error);
      } finally {
        stopProgress();
      }
    },
  };
}
