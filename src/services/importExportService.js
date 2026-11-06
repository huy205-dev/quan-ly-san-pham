import ExcelJS from 'exceljs';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  EXPORT_FORMATS,
  IMPORTABLE_FIELDS,
  IMPORT_RULES,
  PRODUCT_FIELDS,
  REQUIRED_IMPORT_FIELDS,
  SERVER_MANAGED_FIELDS,
  buildSearchTokens,
  checkImportFileMeta,
  detectImportFormat,
  formatNumberVi,
  validateProductInput,
} from '../../shared/productRules.js';
import { fileError, importValidationError, requestValidationError } from '../utils/errors.js';
import { formatVietnamTimestamp, nowUtcIso } from '../utils/time.js';
import { readListCriteria } from './productService.js';

const CONTENT_TYPES = Object.freeze({
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
});

const SHEET_NAME = 'Products';
const HELP_SHEET_NAME = 'HuongDan';
const NO_FILE_MESSAGE = 'Vui lòng chọn file cần nhập (.xlsx, .json hoặc .xml)';
const FORMAT_MESSAGE = 'Định dạng chỉ hỗ trợ xlsx, json hoặc xml';
/**
 * Giới hạn tổng dung lượng giải nén khai báo trong file .xlsx (chống "zip bomb": ExcelJS giải nén toàn bộ
 * vào bộ nhớ). File thật với 1.000 sản phẩm chỉ cỡ vài MB sau giải nén.
 */
const XLSX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

const COLUMN_WIDTHS = Object.freeze({
  ProductID: 12,
  ProductName: 40,
  PathImage: 48,
  ProductType: 22,
  Quantity: 12,
  Unit: 14,
  Price: 16,
  Description: 60,
  CreateDate: 27,
  UpdateDate: 27,
});
const NUMBER_FORMAT_FIELDS = new Set(['Quantity', 'Price']);

/** ProductID, CreateDate, UpdateDate được chấp nhận trong file (để nhập lại file export) nhưng bị bỏ qua. */
const IGNORED_FIELDS = new Set(SERVER_MANAGED_FIELDS);
/** Tên trường so khớp không phân biệt hoa/thường, bỏ khoảng trắng hai đầu. */
const CANONICAL_FIELDS = new Map(PRODUCT_FIELDS.map((field) => [field.toLowerCase(), field]));
const FIELD_ORDER = new Map(PRODUCT_FIELDS.map((field, index) => [field, index]));

/** Hai dòng mẫu của file mẫu; PathImage để trống (đường dẫn giả sẽ không qua được bước kiểm tra). */
const TEMPLATE_ROWS = Object.freeze([
  {
    ProductName: 'Bút bi Thiên Long TL-027',
    PathImage: '',
    ProductType: 'Văn phòng phẩm',
    Quantity: 120,
    Unit: 'Hộp',
    Price: 45000,
    Description: 'Mực xanh, ngòi 0,5 mm, hộp 20 cây',
  },
  {
    ProductName: 'Nồi cơm điện Sharp 1,8 lít',
    PathImage: '',
    ProductType: 'Thiết bị gia dụng',
    Quantity: 15,
    Unit: 'Cái',
    Price: 1150000,
    Description: 'Lòng nồi chống dính, giữ ấm đến 12 giờ',
  },
]);

const TEMPLATE_INSTRUCTIONS = Object.freeze([
  'Hướng dẫn nhập sản phẩm từ file Excel',
  `1. Chỉ sheet "${SHEET_NAME}" được đọc; dòng 1 là tiêu đề cột, giữ nguyên tên trường: ${IMPORTABLE_FIELDS.join(', ')}.`,
  `2. Cột bắt buộc: ${REQUIRED_IMPORT_FIELDS.join(', ')}. PathImage và Description có thể để trống.`,
  '3. Quantity và Price là số nguyên không âm; Price tính bằng VNĐ.',
  '4. PathImage chỉ tham chiếu ảnh đã có trong ứng dụng, dạng /uploads/ten-file.png; file nhập không chứa dữ liệu ảnh.',
  '5. Chỉ nhập giá trị trực tiếp, không dùng công thức.',
  `6. Tối đa ${formatNumberVi(IMPORT_RULES.maxProducts)} sản phẩm, dung lượng file tối đa 10 MB.`,
  '7. ProductID, CreateDate, UpdateDate do hệ thống tự sinh; nếu có trong file sẽ được bỏ qua.',
  '8. Nếu có lỗi, hệ thống báo rõ dòng và trường bị lỗi và không nhập sản phẩm nào.',
]);

// ---------------------------------------------------------------------------
// Tiện ích chung
// ---------------------------------------------------------------------------

function canonicalField(name) {
  return CANONICAL_FIELDS.get(String(name).trim().toLowerCase()) ?? null;
}

/** Rút gọn tên cột/khóa lạ (do người dùng nhập) trước khi đưa vào thông báo lỗi. */
function shorten(text, max = 60) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function listNames(names, max = 10) {
  return names.length > max ? `${names.slice(0, max).join(', ')}, …` : names.join(', ');
}

function readFormat(raw, errors) {
  const format = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (EXPORT_FORMATS.includes(format)) return format;
  errors.push({ field: 'format', message: FORMAT_MESSAGE });
  return null;
}

/** 0 sản phẩm hoặc quá giới hạn → FILE_ERROR (kiểm tra sớm, trước khi đọc chi tiết từng dòng). */
function assertProductCount(count) {
  if (count === 0) throw fileError('File không có sản phẩm nào');
  if (count > IMPORT_RULES.maxProducts) {
    throw fileError(
      `File có ${formatNumberVi(count)} sản phẩm, vượt quá giới hạn ${formatNumberVi(IMPORT_RULES.maxProducts)} sản phẩm`,
    );
  }
}

/** Bản ghi đọc từ file: values theo tên trường chuẩn; badFields là các trường đã có lỗi ở bước đọc. */
function newRecord(row) {
  return { row, values: {}, badFields: new Set(), skip: false };
}

/** Ghi một lỗi đọc cho trường (mỗi trường chỉ báo một lần) và bỏ giá trị của trường đó. */
function flagField(record, errors, field, message) {
  if (record.badFields.has(field)) return;
  record.badFields.add(field);
  delete record.values[field];
  errors.push({ row: record.row, field, message });
}

function fieldRank(field) {
  if (field === null) return -1;
  return FIELD_ORDER.get(field) ?? PRODUCT_FIELDS.length;
}

/** Sắp xếp lỗi theo dòng, rồi theo thứ tự trường (lỗi cả dòng đứng trước, trường lạ đứng sau). */
function sortImportErrors(errors) {
  return [...errors].sort((a, b) => a.row - b.row || fieldRank(a.field) - fieldRank(b.field));
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** Giải mã UTF-8 (tự bỏ BOM ở đầu file); nội dung không phải UTF-8 hợp lệ → FILE_ERROR. */
function decodeUtf8(buffer, label) {
  try {
    return utf8Decoder.decode(buffer);
  } catch {
    throw fileError(`File ${label} phải là văn bản mã hóa UTF-8`);
  }
}

// ---------------------------------------------------------------------------
// Excel (.xlsx)
// ---------------------------------------------------------------------------

const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_MIN_LENGTH = 22;
const ZIP_UINT32_MAX = 0xffffffff;

/** Kích thước giải nén ZIP64 (extra field 0x0001) của một mục trong central directory. */
function zip64UncompressedSize(buffer, start, length) {
  const end = Math.min(start + length, buffer.length);
  for (let offset = start; offset + 4 <= end; ) {
    const id = buffer.readUInt16LE(offset);
    const size = buffer.readUInt16LE(offset + 2);
    if (id === 0x0001 && size >= 8 && offset + 12 <= end) return Number(buffer.readBigUInt64LE(offset + 4));
    offset += 4 + size;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Tổng dung lượng giải nén mà central directory của file ZIP khai báo; null nếu cấu trúc ZIP sai.
 * @param {Buffer} buffer
 * @returns {number|null}
 */
function declaredUncompressedSize(buffer) {
  const stop = Math.max(0, buffer.length - ZIP_EOCD_MIN_LENGTH - 0xffff);
  let eocd = -1;
  for (let offset = buffer.length - ZIP_EOCD_MIN_LENGTH; offset >= stop; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return null;
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) return null;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const size = buffer.readUInt32LE(offset + 24);
    total += size === ZIP_UINT32_MAX ? zip64UncompressedSize(buffer, offset + 46 + nameLength, extraLength) : size;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return total;
}

/** File .xlsx phải là ZIP thật (chữ ký PK\x03\x04, central directory hợp lệ) và không phình quá lớn khi giải nén. */
function assertXlsxContainer(buffer) {
  const invalid = () => fileError('File Excel không hợp lệ hoặc bị hỏng (không đúng định dạng .xlsx)');
  if (buffer.length < ZIP_EOCD_MIN_LENGTH || !buffer.subarray(0, 4).equals(ZIP_LOCAL_HEADER)) throw invalid();
  const total = declaredUncompressedSize(buffer);
  if (total === null) throw invalid();
  if (total > XLSX_MAX_UNCOMPRESSED_BYTES) {
    throw fileError('File Excel có dung lượng sau giải nén quá lớn, không thể xử lý');
  }
}

function isFormulaCell(cell) {
  if (cell.type === ExcelJS.ValueType.Formula) return true;
  const { value } = cell;
  return value !== null && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value);
}

const formulaMessage = (cell) => `Ô ${cell.address} chứa công thức; chỉ chấp nhận giá trị nhập trực tiếp`;
const columnLetterOf = (cell) => cell.address.replace(/\d/g, '');

function richTextToString(value) {
  return Array.isArray(value?.richText) ? value.richText.map((part) => part.text ?? '').join('') : '';
}

/**
 * Giá trị thô của một ô (không phải công thức): null, số hoặc chuỗi.
 * Ngày, đúng/sai, mã lỗi Excel → unsupported.
 */
function readCellValue(cell) {
  const { ValueType } = ExcelJS;
  const { value } = cell;
  switch (cell.type) {
    case ValueType.Null:
    case ValueType.Merge: // ô phụ của vùng gộp: thực chất trống, giá trị nằm ở ô đầu vùng
      return { value: null };
    case ValueType.Number:
      return { value };
    case ValueType.String:
    case ValueType.SharedString:
      return { value: typeof value === 'string' ? value : cell.text };
    case ValueType.RichText:
      return { value: richTextToString(value) };
    case ValueType.Hyperlink:
      return { value: typeof value?.text === 'string' ? value.text : richTextToString(value?.text) };
    default:
      return { unsupported: true };
  }
}

const isBlank = (value) => value === null || (typeof value === 'string' && value.trim() === '');

/** Đọc dòng tiêu đề: Map số cột → tên trường chuẩn. Tiêu đề thiếu/trùng/lạ → FILE_ERROR. */
function readXlsxHeader(sheet) {
  const columns = new Map();
  const seen = new Set();
  const unknown = [];
  const duplicates = [];
  const formulaErrors = [];
  let headerCount = 0;

  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (cell.type === ExcelJS.ValueType.Merge) return;
    if (isFormulaCell(cell)) {
      formulaErrors.push({ row: 1, field: null, message: formulaMessage(cell) });
      return;
    }
    const { value, unsupported } = readCellValue(cell);
    const text = (unsupported ? String(cell.text ?? '') : String(value ?? '')).trim();
    if (!text) return;
    headerCount += 1;
    const field = canonicalField(text);
    if (!field) {
      unknown.push(shorten(text));
    } else if (seen.has(field)) {
      duplicates.push(shorten(text));
    } else {
      seen.add(field);
      columns.set(colNumber, field);
    }
  });

  if (formulaErrors.length) throw importValidationError('xlsx', formulaErrors);
  if (headerCount === 0) {
    throw fileError(`Sheet "${SHEET_NAME}" chưa có dòng tiêu đề: dòng 1 phải chứa tên các trường`);
  }
  const missing = REQUIRED_IMPORT_FIELDS.filter((field) => !seen.has(field));
  const problems = [];
  if (missing.length) problems.push(`thiếu cột bắt buộc ${listNames(missing)}`);
  if (duplicates.length) problems.push(`cột bị trùng ${listNames(duplicates)}`);
  if (unknown.length) problems.push(`cột không hợp lệ ${listNames(unknown)}`);
  if (problems.length) {
    const details = [
      ...missing.map((field) => ({ field, message: 'Thiếu cột bắt buộc' })),
      ...duplicates.map((field) => ({ field, message: 'Cột bị trùng' })),
      ...unknown.map((field) => ({ field, message: 'Cột không hợp lệ' })),
    ];
    throw fileError(`Tiêu đề cột trong sheet "${SHEET_NAME}" không hợp lệ: ${problems.join('; ')}`, details);
  }
  return columns;
}

/** Đọc một dòng dữ liệu; trả về null nếu dòng hoàn toàn trống. */
function readXlsxRow(row, columns, errors, headerlessColumns) {
  const record = newRecord(row.number);
  let hasData = false;
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (cell.type === ExcelJS.ValueType.Merge) return;
    const field = columns.get(colNumber) ?? null;
    const formula = isFormulaCell(cell);
    const { value, unsupported } = formula ? {} : readCellValue(cell);
    if (!formula && !unsupported && isBlank(value)) return;
    hasData = true;
    if (field === null) {
      headerlessColumns.add(columnLetterOf(cell));
    } else if (formula) {
      flagField(record, errors, field, formulaMessage(cell));
    } else if (!IGNORED_FIELDS.has(field)) {
      if (unsupported) flagField(record, errors, field, `Kiểu dữ liệu của ô ${cell.address} không được hỗ trợ`);
      else record.values[field] = value;
    }
  });
  return hasData ? record : null;
}

async function readXlsx(buffer) {
  assertXlsxContainer(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw fileError('Không đọc được file Excel: file bị hỏng hoặc không đúng định dạng .xlsx');
  }
  const sheet = workbook.worksheets.find((worksheet) => worksheet.name.trim().toLowerCase() === 'products');
  if (!sheet) throw fileError(`Không tìm thấy sheet "${SHEET_NAME}" trong file Excel`);

  const columns = readXlsxHeader(sheet);
  const errors = [];
  const records = [];
  const headerlessColumns = new Set();
  let count = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = readXlsxRow(row, columns, errors, headerlessColumns);
    if (!record) return;
    count += 1;
    if (count <= IMPORT_RULES.maxProducts) records.push(record);
  });
  if (headerlessColumns.size) {
    throw fileError(`Cột ${listNames([...headerlessColumns])} có dữ liệu nhưng không có tiêu đề ở dòng 1`);
  }
  assertProductCount(count);
  return { records, errors };
}

async function writeXlsx(rows, fields, { withInstructions = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = fields.map((field) => ({
    header: field,
    key: field,
    width: COLUMN_WIDTHS[field],
    ...(NUMBER_FORMAT_FIELDS.has(field) ? { style: { numFmt: '#,##0' } } : {}),
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(fields.map((field) => (row[field] === '' ? null : (row[field] ?? null))));
  }
  if (withInstructions) {
    const help = workbook.addWorksheet(HELP_SHEET_NAME);
    help.getColumn(1).width = 120;
    TEMPLATE_INSTRUCTIONS.forEach((line, index) => {
      help.getCell(index + 1, 1).value = line;
    });
    help.getRow(1).font = { bold: true, size: 13 };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

function readJsonProduct(item, row, errors) {
  const record = newRecord(row);
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    errors.push({ row, field: null, message: 'Phần tử phải là một đối tượng sản phẩm' });
    record.skip = true;
    return record;
  }
  for (const [key, value] of Object.entries(item)) {
    const field = canonicalField(key);
    if (!field) {
      errors.push({ row, field: shorten(key), message: 'Trường không hợp lệ' });
    } else if (IGNORED_FIELDS.has(field) || record.badFields.has(field)) {
      // bỏ qua trường do server quản lý; trường đã báo lỗi thì không báo lại
    } else if (Object.hasOwn(record.values, field)) {
      flagField(record, errors, field, 'Trường bị lặp');
    } else if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
      flagField(record, errors, field, 'Giá trị phải là chuỗi, số hoặc null');
    } else {
      record.values[field] = value;
    }
  }
  return record;
}

function readJson(buffer) {
  const text = decodeUtf8(buffer, 'JSON');
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw fileError(`File JSON không hợp lệ: ${err.message}`);
  }
  if (!Array.isArray(data)) throw fileError('File JSON phải là một mảng sản phẩm');
  assertProductCount(data.length);
  const errors = [];
  const records = data.map((item, index) => readJsonProduct(item, index + 1, errors));
  return { records, errors };
}

function writeJson(rows, fields) {
  const items = rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null])));
  return Buffer.from(JSON.stringify(items, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const XML_PREDEFINED_ENTITIES = Object.freeze({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });
const XML_ENTITY_PATTERN = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(lt|gt|amp|quot|apos));/g;
/** Ký tự không được phép trong XML 1.0 (bị loại khi xuất để file luôn hợp lệ). */
const INVALID_XML_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const isXmlChar = (cp) =>
  cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) ||
  (cp >= 0x10000 && cp <= 0x10ffff);

/**
 * Bộ giải mã thực thể cho fast-xml-parser: chỉ 5 thực thể chuẩn của XML và tham chiếu số (&#272;, &#x1EC7;).
 * Mặc định thư viện không giải mã tham chiếu số; DTD/ENTITY tự định nghĩa đã bị từ chối trước khi phân tích.
 */
const xmlEntityDecoder = {
  setExternalEntities() {},
  addInputEntities() {},
  reset() {},
  setXmlVersion() {},
  decode(text) {
    return text.replace(XML_ENTITY_PATTERN, (match, decimal, hex, name) => {
      if (name) return XML_PREDEFINED_ENTITIES[name];
      const codePoint = decimal === undefined ? Number.parseInt(hex, 16) : Number(decimal);
      return isXmlChar(codePoint) ? String.fromCodePoint(codePoint) : match;
    });
  },
};

/** CDATA, chú thích, chỉ thị xử lý (bỏ qua) hoặc một tham chiếu "&...;" cần kiểm tra. */
const XML_REFERENCE_SCAN = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|&([^\s&;<]+);/g;

/**
 * Không có DTD nên XML chỉ hợp lệ với 5 thực thể chuẩn và mã ký tự hợp lệ; XMLValidator không kiểm tra điều này,
 * và nếu bỏ qua thì "&nbsp;" hay "&#0;" bị nhập nguyên văn vào dữ liệu. Tham chiếu trong CDATA là văn bản thường.
 * @param {string} text
 * @returns {string|null} thông báo lỗi kèm số dòng, hoặc null nếu hợp lệ
 */
function findInvalidXmlReference(text) {
  for (const match of text.matchAll(XML_REFERENCE_SCAN)) {
    const name = match[1];
    if (name === undefined || Object.hasOwn(XML_PREDEFINED_ENTITIES, name)) continue;
    const numeric = /^#(?:x([0-9a-fA-F]{1,6})|(\d{1,7}))$/.exec(name);
    const codePoint = numeric && (numeric[1] === undefined ? Number(numeric[2]) : Number.parseInt(numeric[1], 16));
    if (numeric && isXmlChar(codePoint)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    const problem = name.startsWith('#')
      ? `mã ký tự ${match[0]} không hợp lệ`
      : `thực thể ${match[0]} chưa được khai báo (chỉ dùng &lt; &gt; &amp; &quot; &apos; hoặc mã ký tự như &#272;)`;
    return `File XML không hợp lệ (dòng ${line}): ${problem}`;
  }
  return null;
}

function createXmlParser() {
  return new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false, // giữ nguyên chuỗi, việc đọc số do validateProductInput đảm nhận
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    entityDecoder: xmlEntityDecoder,
    isArray: (tagName, jPath) => jPath === 'Products.Product',
  });
}

function readXmlProduct(item, row, errors) {
  const record = newRecord(row);
  if (item === '') return record; // <Product/>: sản phẩm rỗng, sẽ báo thiếu các trường bắt buộc
  if (item === null || typeof item !== 'object') {
    errors.push({ row, field: null, message: 'Phần tử <Product> phải chứa các trường sản phẩm' });
    record.skip = true;
    return record;
  }
  for (const [tag, value] of Object.entries(item)) {
    const field = tag === '#text' ? undefined : canonicalField(tag);
    if (field === undefined) {
      errors.push({ row, field: null, message: 'Phần tử <Product> chứa văn bản nằm ngoài các trường' });
    } else if (field === null) {
      errors.push({ row, field: shorten(tag), message: 'Trường không hợp lệ' });
    } else if (IGNORED_FIELDS.has(field) || record.badFields.has(field)) {
      // bỏ qua trường do server quản lý; trường đã báo lỗi thì không báo lại
    } else if (Array.isArray(value) || Object.hasOwn(record.values, field)) {
      flagField(record, errors, field, 'Trường bị lặp');
    } else if (typeof value === 'object' && value !== null) {
      flagField(record, errors, field, 'Giá trị không hợp lệ');
    } else {
      record.values[field] = value;
    }
  }
  return record;
}

function readXml(buffer) {
  const text = decodeUtf8(buffer, 'XML');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw fileError('File XML chứa DTD/ENTITY, không được phép nhập');
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    throw fileError(`File XML không hợp lệ (dòng ${validation.err.line}): ${validation.err.msg}`);
  }
  const referenceError = findInvalidXmlReference(text);
  if (referenceError) throw fileError(referenceError);
  let document;
  try {
    document = createXmlParser().parse(text);
  } catch (err) {
    throw fileError(`File XML không hợp lệ: ${err.message}`);
  }
  const rootNames = Object.keys(document);
  if (rootNames.length !== 1 || rootNames[0] !== 'Products' || Array.isArray(document.Products)) {
    throw fileError('File XML phải có đúng một phần tử gốc <Products>');
  }
  const root = document.Products;
  if (root === '') assertProductCount(0); // <Products/> hoặc <Products></Products>: báo "không có sản phẩm nào"
  if (root === null || typeof root !== 'object' || Object.keys(root).some((name) => name !== 'Product')) {
    throw fileError('Phần tử <Products> chỉ được chứa các phần tử <Product>');
  }
  assertProductCount(root.Product.length);
  const errors = [];
  const records = root.Product.map((item, index) => readXmlProduct(item, index + 1, errors));
  return { records, errors };
}

function toXmlText(value) {
  return value === null || value === undefined ? '' : String(value).replace(INVALID_XML_CHARS, '');
}

function writeXml(rows, fields) {
  const builder = new XMLBuilder({ format: true, indentBy: '  ', suppressEmptyNode: false });
  const products = rows.map((row) => Object.fromEntries(fields.map((field) => [field, toXmlText(row[field])])));
  const body = builder.build({ Products: products.length ? { Product: products } : '' });
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, 'utf8');
}

const READERS = Object.freeze({ xlsx: readXlsx, json: readJson, xml: readXml });
const WRITERS = Object.freeze({ xlsx: writeXlsx, json: writeJson, xml: writeXml });

// ---------------------------------------------------------------------------
// Dịch vụ
// ---------------------------------------------------------------------------

/**
 * Dịch vụ nhập/xuất file sản phẩm (.xlsx, .json, .xml) và file mẫu.
 * @param {{ repository: ReturnType<typeof import('../repositories/productRepository.js').createProductRepository>,
 *           imageService: ReturnType<typeof import('./imageService.js').createImageService> }} deps
 */
export function createImportExportService({ repository, imageService }) {
  /** Kiểm tra một bản ghi bằng shared rules + kiểm tra PathImage; trả về dữ liệu sẵn sàng ghi. */
  function validateRecord(record, errors) {
    const { value, errors: fieldErrors } = validateProductInput(record.values);
    for (const error of fieldErrors) {
      if (!record.badFields.has(error.field)) {
        errors.push({ row: record.row, field: error.field, message: error.message });
      }
    }
    let pathImage = null;
    if (!record.badFields.has('PathImage')) {
      const reference = imageService.checkReference(record.values.PathImage);
      if (reference.ok) pathImage = reference.value;
      else errors.push({ row: record.row, field: 'PathImage', message: reference.message });
    }
    return { ...value, PathImage: pathImage };
  }

  return {
    /**
     * Nhập file: kiểm tra toàn bộ trước, có bất kỳ lỗi nào thì không ghi gì; hợp lệ thì thêm mới tất cả
     * trong một giao dịch (ID và ngày do server sinh lại, không cập nhật sản phẩm có sẵn).
     * @param {{ originalname: string, size: number, buffer: Buffer } | undefined} file file Multer (trường "file")
     */
    async importFile(file) {
      if (!file) throw fileError(NO_FILE_MESSAGE, [{ field: 'file', message: NO_FILE_MESSAGE }]);
      const metaError = checkImportFileMeta(file);
      if (metaError) throw fileError(metaError, [{ field: 'file', message: metaError }]);

      const format = detectImportFormat(file.originalname);
      const { records, errors } = await READERS[format](file.buffer);
      const products = records.filter((record) => !record.skip).map((record) => validateRecord(record, errors));
      if (errors.length) throw importValidationError(format, sortImportErrors(errors));

      const now = nowUtcIso();
      const ids = repository.transaction(() =>
        products.map((product) => repository.insert({ ...product, CreateDate: now, UpdateDate: now }).ProductID),
      );
      return { data: { imported: ids.length, ids }, message: `Đã nhập ${formatNumberVi(ids.length)} sản phẩm` };
    },

    /**
     * Xuất toàn bộ sản phẩm khớp q + type + stock (mọi trang), theo đúng cách sắp xếp yêu cầu (mặc định ProductID
     * giảm dần), đủ 10 trường, không phụ thuộc ẩn/hiện cột. Tham số được kiểm tra giống hệt danh sách.
     * @param {{ format?: unknown, q?: unknown, type?: unknown, stock?: unknown, sort?: unknown, order?: unknown }} [query]
     * @returns {Promise<{ buffer: Buffer, contentType: string, fileName: string }>}
     */
    async exportProducts({ format, ...query } = {}) {
      const errors = [];
      const selected = readFormat(format, errors);
      const { q, type, stock, sort, order } = readListCriteria(query, errors);
      if (errors.length) throw requestValidationError(errors);

      const products = repository.findAll({ tokens: buildSearchTokens(q), type, stock, sort, order });
      return {
        buffer: await WRITERS[selected](products, PRODUCT_FIELDS),
        contentType: CONTENT_TYPES[selected],
        fileName: `san-pham-${formatVietnamTimestamp()}.${selected}`,
      };
    },

    /**
     * File mẫu: 7 trường nhập được (theo thứ tự IMPORTABLE_FIELDS) và 2 dòng mẫu; bản Excel có thêm sheet hướng dẫn.
     * @param {{ format?: unknown }} [query]
     * @returns {Promise<{ buffer: Buffer, contentType: string, fileName: string }>}
     */
    async buildTemplate({ format } = {}) {
      const errors = [];
      const selected = readFormat(format, errors);
      if (errors.length) throw requestValidationError(errors);

      return {
        buffer: await WRITERS[selected](TEMPLATE_ROWS, IMPORTABLE_FIELDS, { withInstructions: true }),
        contentType: CONTENT_TYPES[selected],
        fileName: `mau-nhap-san-pham.${selected}`,
      };
    },
  };
}
