/**
 * Hộp thoại xem chi tiết (chỉ đọc): đủ 10 trường kèm nhãn và ảnh sản phẩm.
 */
import { FIELD_LABELS, PRODUCT_FIELDS, formatProductCode } from '/shared/productRules.js';
import { hideDialog, setupDialog, showDialog } from './dialogs.js';
import {
  EMPTY_TEXT, displayText, el, formatDateTime, formatInteger, formatMoney, formatProductLabel, imageUrl,
  initialPlaceholder, stockBadge, typeTag,
} from './format.js';

function emptyValue() {
  return el('span', { className: 'muted', text: EMPTY_TEXT });
}

function dateValue(value) {
  const text = formatDateTime(value);
  if (text === EMPTY_TEXT) return [emptyValue()];
  return [
    el('time', { datetime: String(value), title: `Lưu theo UTC: ${value}`, text }),
    el('span', { className: 'muted', text: ' (giờ Việt Nam, GMT+7)' }),
  ];
}

/** Giá trị hiển thị của từng trường. */
const FIELD_VALUES = Object.freeze({
  ProductID: (p) => [
    el('span', { className: 'code', text: formatProductCode(p.ProductID) }),
    el('span', { className: 'muted', text: ` (ProductID: ${p.ProductID})` }),
  ],
  ProductName: (p) => displayText(p.ProductName),
  PathImage: (p) => (p.PathImage ? el('code', { className: 'path', text: p.PathImage }) : emptyValue()),
  ProductType: (p) => (p.ProductType ? typeTag(p.ProductType) : emptyValue()),
  Quantity: (p) => el('span', { className: 'detail-qty' }, formatInteger(p.Quantity), stockBadge(p.Quantity)),
  Unit: (p) => displayText(p.Unit),
  Price: (p) => formatMoney(p.Price),
  Description: (p) => (p.Description ? el('p', { className: 'detail-description', text: p.Description }) : emptyValue()),
  CreateDate: (p) => dateValue(p.CreateDate),
  UpdateDate: (p) => dateValue(p.UpdateDate),
});

/** Ảnh giữ chỗ cỡ lớn (chữ cái đầu, tông màu theo loại) kèm dòng chữ mô tả đọc được. */
function imagePlaceholder(product, text) {
  return el('div', { className: 'image-placeholder' },
    initialPlaceholder(product, 'media-initial'),
    el('span', { className: 'placeholder-caption', text }));
}

/**
 * @param {{ onEdit: (id: number) => void }} handlers onEdit gọi actions.edit(id) (nút "Sửa")
 * @returns {{ open: (product: Record<string, any>) => void }}
 */
export function createDetailView({ onEdit }) {
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('detail-dialog'));
  const subtitle = document.getElementById('detail-subtitle');
  const media = document.getElementById('detail-media');
  const list = document.getElementById('detail-list');
  const editButton = document.getElementById('detail-edit');
  const closeButton = document.getElementById('detail-close');
  /** @type {Record<string, any>|null} */
  let current = null;

  setupDialog(dialog, { onClosed: () => { current = null; } });

  // "Sửa": đóng chi tiết rồi mở biểu mẫu sửa của chính sản phẩm này.
  editButton.addEventListener('click', () => {
    if (!current) return;
    const id = current.ProductID;
    hideDialog(dialog);
    onEdit(id);
  });

  function renderMedia(product) {
    const src = imageUrl(product.PathImage);
    if (!src) {
      media.replaceChildren(imagePlaceholder(product, 'Không có ảnh'));
      return;
    }
    const image = el('img', { className: 'detail-image', src, alt: `Ảnh sản phẩm ${formatProductLabel(product)}` });
    image.addEventListener('error', () => image.replaceWith(imagePlaceholder(product, 'Không tải được ảnh')), { once: true });
    media.replaceChildren(image);
  }

  return {
    open(product) {
      current = product;
      subtitle.textContent = formatProductLabel(product);
      renderMedia(product);
      list.replaceChildren(...PRODUCT_FIELDS.map((field) => el('div', { className: 'detail-row' },
        el('dt', { text: FIELD_LABELS[field] }),
        el('dd', {}, FIELD_VALUES[field](product)))));
      showDialog(dialog, { initialFocus: closeButton });
    },
  };
}
