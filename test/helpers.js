/**
 * Tiện ích dùng chung cho bộ kiểm thử (node:test).
 *
 * - Mỗi file kiểm thử tự khởi động một ứng dụng riêng: database ':memory:', thư mục uploads tạm trong
 *   os.tmpdir(), không dữ liệu mẫu; server lắng nghe cổng ngẫu nhiên (listen(0)).
 * - Sau khi chạy xong: đóng server, đóng database và xóa thư mục tạm.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import { IMPORTABLE_FIELDS, PRODUCT_FIELDS } from '../shared/productRules.js';
import { createApp } from '../src/app.js';

// ---------------------------------------------------------------------------
// Dữ liệu ảnh nhỏ nhất có đúng chữ ký (magic bytes) của từng định dạng
// ---------------------------------------------------------------------------

/** PNG 1×1 thật. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** JPEG tối thiểu (SOI + APP0 JFIF + EOI). */
export const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
  0x00, 0x00, 0xff, 0xd9,
]);

/** WebP lossless 1×1 (RIFF....WEBPVP8L). */
export const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8L'),
  Buffer.from([0x0d, 0, 0, 0, 0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00]),
]);

/** GIF thật (định dạng không được nhận). */
export const GIF_BYTES = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Khởi động / dừng ứng dụng
// ---------------------------------------------------------------------------

/** Thư mục tạm mới trong os.tmpdir() (tiền tố "qlsp-"). */
export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qlsp-'));
}

/**
 * Tạo ứng dụng + server HTTP trên cổng ngẫu nhiên.
 * @param {{ dbPath?: string, uploadsDir?: string, seedSampleData?: boolean }} [options]
 */
export async function startTestApp(options = {}) {
  const ownsUploadsDir = options.uploadsDir === undefined;
  const uploadsDir = options.uploadsDir ?? makeTempDir();
  const instance = createApp({ dbPath: ':memory:', seedSampleData: false, ...options, uploadsDir });
  const server = await new Promise((resolve, reject) => {
    const listening = instance.app.listen(0, '127.0.0.1');
    listening.once('listening', () => resolve(listening));
    listening.once('error', reject);
  });
  return {
    app: instance.app,
    db: instance.db,
    close: instance.close,
    server,
    uploadsDir,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      instance.close();
      if (ownsUploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    },
  };
}

/**
 * Đăng ký before()/after() cho file (hoặc describe) hiện tại: khởi động một ứng dụng riêng và dọn dẹp sau cùng.
 * Đối tượng trả về được điền dữ liệu khi before() chạy; `ctx.ready` là Promise hoàn tất khi server đã sẵn sàng.
 *
 * Lưu ý: ở cấp cao nhất của file, Node 24 chạy before() ngay khi đăng ký và không chờ hook trước đó,
 * nên các hook tạo dữ liệu phải `await app.ready` (client HTTP bên dưới tự chờ).
 * @param {{ dbPath?: string, uploadsDir?: string, seedSampleData?: boolean }} [options]
 */
export function useTestApp(options) {
  const ctx = {};
  before(() => {
    ctx.ready ??= startTestApp(options).then((instance) => Object.assign(ctx, instance));
    return ctx.ready;
  });
  after(async () => {
    await ctx.ready?.catch(() => {});
    await ctx.stop?.();
  });
  return ctx;
}

// ---------------------------------------------------------------------------
// Gửi yêu cầu HTTP
// ---------------------------------------------------------------------------

/**
 * Client HTTP gắn với một ứng dụng kiểm thử. Phản hồi JSON được parse sẵn vào `body`.
 * @param {{ baseUrl: string }} ctx
 */
export function createClient(ctx) {
  async function request(method, urlPath, { json, form, body, headers = {} } = {}) {
    if (ctx.ready) await ctx.ready;
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.body = typeof json === 'string' ? json : JSON.stringify(json);
      init.headers['content-type'] ??= 'application/json';
    } else if (form !== undefined) {
      init.body = form;
    } else if (body !== undefined) {
      init.body = body;
    }
    const res = await fetch(ctx.baseUrl + urlPath, init);
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = buffer.toString('utf8');
    const contentType = res.headers.get('content-type') ?? '';
    let parsed;
    if (contentType.startsWith('application/json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    return { status: res.status, headers: res.headers, contentType, body: parsed, text, buffer };
  }
  return {
    request,
    get: (urlPath, options) => request('GET', urlPath, options),
    post: (urlPath, options) => request('POST', urlPath, options),
    put: (urlPath, options) => request('PUT', urlPath, options),
    delete: (urlPath, options) => request('DELETE', urlPath, options),
  };
}

/** Chuỗi truy vấn "?a=1&b=2" (bỏ qua giá trị undefined; mảng → lặp tham số). */
export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// ---------------------------------------------------------------------------
// Dữ liệu sản phẩm, biểu mẫu, file
// ---------------------------------------------------------------------------

/** Dữ liệu sản phẩm hợp lệ (JSON). */
export function validProduct(overrides = {}) {
  return {
    ProductName: 'Bút bi Thiên Long',
    ProductType: 'Văn phòng phẩm',
    Quantity: 120,
    Unit: 'Hộp',
    Price: 45000,
    Description: 'Mực xanh, ngòi 0,5 mm',
    ...overrides,
  };
}

/**
 * FormData của biểu mẫu sản phẩm. Giá trị undefined bị bỏ qua.
 * @param {Record<string, unknown>} [fields]
 * @param {{ bytes: Buffer, name: string, type?: string, field?: string } | Array<object>} [files]
 */
export function productForm(fields = {}, files = []) {
  const form = new FormData();
  const values = {
    ProductName: 'Sản phẩm biểu mẫu',
    ProductType: 'Phụ kiện',
    Quantity: '5',
    Unit: 'Cái',
    Price: '1000',
    Description: 'Mô tả biểu mẫu',
    ...fields,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) form.append(key, String(value));
  }
  for (const file of Array.isArray(files) ? files : [files]) {
    form.append(file.field ?? 'image', new Blob([file.bytes], { type: file.type ?? 'application/octet-stream' }), file.name);
  }
  return form;
}

/** FormData chứa một file (mặc định trường "file", dùng cho import). */
export function fileForm(buffer, name, { type = 'application/octet-stream', field = 'file' } = {}) {
  const form = new FormData();
  form.append(field, new Blob([buffer], { type }), name);
  return form;
}

/**
 * Thân multipart/form-data viết tay (khi cần thứ FormData của Node không tạo được, ví dụ filename="").
 * @param {Array<{ name: string, value?: string|Buffer, filename?: string, type?: string }>} parts
 * @returns {{ body: Buffer, headers: Record<string, string> }}
 */
export function rawMultipart(parts) {
  const boundary = '----qlsp-test-boundary';
  const chunks = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) head += `; filename="${part.filename}"`;
    head += '\r\n';
    if (part.type) head += `Content-Type: ${part.type}\r\n`;
    chunks.push(Buffer.from(`${head}\r\n`), Buffer.from(part.value ?? ''), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

// ---------------------------------------------------------------------------
// Excel / XML
// ---------------------------------------------------------------------------

/**
 * Tạo file .xlsx từ { tênSheet: dòng[] }. Mỗi dòng là mảng giá trị theo cột (undefined = ô không ghi);
 * dòng null được bỏ trống (không ghi gì) để kiểm tra số dòng thật.
 * Giá trị có thể là object của ExcelJS (ví dụ { formula: 'A1*2' }).
 * @param {Record<string, Array<unknown[]|null>>} sheets
 */
export async function buildXlsx(sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    rows.forEach((row, rowIndex) => {
      if (!row) return;
      row.forEach((value, colIndex) => {
        if (value !== undefined) sheet.getCell(rowIndex + 1, colIndex + 1).value = value;
      });
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Một dòng dữ liệu theo thứ tự IMPORTABLE_FIELDS. */
export function importRow(values = {}) {
  const row = {
    ProductName: 'Hàng nhập Excel',
    PathImage: null,
    ProductType: 'Thực phẩm',
    Quantity: 10,
    Unit: 'Kg',
    Price: 25000,
    Description: 'Mô tả Excel',
    ...values,
  };
  return IMPORTABLE_FIELDS.map((field) => row[field]);
}

export async function loadXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/** Giá trị các ô 1..count của một dòng (ô trống → null). */
export function rowValues(sheet, rowNumber, count) {
  const row = sheet.getRow(rowNumber);
  return Array.from({ length: count }, (_, index) => row.getCell(index + 1).value ?? null);
}

/** Parser XML để đọc file export/template (giữ chuỗi, <Product> luôn là mảng). */
export function parseXml(text) {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    isArray: (tagName, jPath) => jPath === 'Products.Product',
  });
  return parser.parse(text);
}

const xmlElement = (tag, content) => `<${tag}>${content}</${tag}>`;

/** Chuỗi XML <Products> từ danh sách object (giá trị phải được escape sẵn nếu cần). */
export function xmlProducts(items) {
  const products = items.map((item) =>
    xmlElement('Product', Object.entries(item).map(([tag, value]) => xmlElement(tag, value)).join('')));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Products>\n  ${products.join('\n  ')}\n</Products>\n`;
}

// ---------------------------------------------------------------------------
// Kiểm tra (assert) dùng chung
// ---------------------------------------------------------------------------

/**
 * Kiểm tra envelope lỗi `{ error: { code, message, details[] } }` và trả về error.
 * @param {{ status: number, contentType: string, body: any, text: string }} res
 * @param {number} status
 * @param {string} code
 * @param {{ message?: string|RegExp, details?: object[], fields?: Array<string|null> }} [expected]
 */
export function assertApiError(res, status, code, expected = {}) {
  assert.equal(res.status, status, `HTTP ${res.status}, body: ${res.text.slice(0, 600)}`);
  assert.match(res.contentType, /^application\/json/);
  assert.ok(res.body && typeof res.body === 'object', 'phản hồi phải là JSON');
  assert.deepEqual(Object.keys(res.body), ['error']);
  const { error } = res.body;
  for (const key of Object.keys(error)) {
    assert.ok(['code', 'message', 'details', 'format'].includes(key), `khóa lạ trong error: ${key}`);
  }
  assert.equal(error.code, code);
  assert.equal(typeof error.message, 'string');
  assert.ok(error.message.length > 0);
  assert.ok(Array.isArray(error.details), 'details phải là mảng');
  if (expected.message instanceof RegExp) assert.match(error.message, expected.message);
  else if (expected.message !== undefined) assert.equal(error.message, expected.message);
  if (expected.details !== undefined) assert.deepEqual(error.details, expected.details);
  if (expected.fields !== undefined) assert.deepEqual(error.details.map((detail) => detail.field), expected.fields);
  return error;
}

/** Sản phẩm có đúng 10 khóa theo thứ tự PRODUCT_FIELDS và kiểu dữ liệu hợp lệ. */
export function assertProductShape(product) {
  assert.deepEqual(Object.keys(product), [...PRODUCT_FIELDS]);
  assert.ok(Number.isSafeInteger(product.ProductID) && product.ProductID > 0);
  assert.equal(typeof product.ProductName, 'string');
  assert.equal(typeof product.ProductType, 'string');
  assert.equal(typeof product.Unit, 'string');
  assert.ok(Number.isSafeInteger(product.Quantity) && product.Quantity >= 0);
  assert.ok(Number.isSafeInteger(product.Price) && product.Price >= 0);
  assert.ok(product.PathImage === null || typeof product.PathImage === 'string');
  assert.ok(product.Description === null || typeof product.Description === 'string');
  assert.match(product.CreateDate, ISO_UTC_PATTERN);
  assert.match(product.UpdateDate, ISO_UTC_PATTERN);
}

// ---------------------------------------------------------------------------
// Truy cập trực tiếp trạng thái của ứng dụng kiểm thử
// ---------------------------------------------------------------------------

/** Số dòng trong bảng Products. */
export function countProducts(ctx) {
  return Number(ctx.db.prepare('SELECT COUNT(*) AS n FROM Products').get().n);
}

/** Toàn bộ sản phẩm (object thường, 10 trường), ProductID giảm dần. */
export function allProducts(ctx) {
  return ctx.db
    .prepare(`SELECT ${PRODUCT_FIELDS.join(', ')} FROM Products ORDER BY ProductID DESC`)
    .all()
    .map((row) => Object.fromEntries(PRODUCT_FIELDS.map((field) => [field, row[field]])));
}

/** Danh sách file trong thư mục uploads (đã sắp xếp). */
export function listUploads(ctx) {
  return fs.readdirSync(ctx.uploadsDir).sort();
}

/** Đường dẫn file trên đĩa của một PathImage "/uploads/<tên>". */
export function uploadFilePath(ctx, pathImage) {
  return path.join(ctx.uploadsDir, pathImage.replace(/^\/uploads\//, ''));
}

/** Tạo sản phẩm qua API JSON và trả về sản phẩm. */
export async function createProduct(http, overrides = {}) {
  const res = await http.post('/api/products', { json: validProduct(overrides) });
  assert.equal(res.status, 201, res.text);
  return res.body.data;
}

const DEFAULT_IMAGE = Object.freeze({ bytes: PNG_BYTES, name: 'anh.png', type: 'image/png' });

/** Tạo sản phẩm kèm ảnh (mặc định PNG) qua multipart và trả về sản phẩm. */
export async function createProductWithImage(http, fields = {}, image = DEFAULT_IMAGE) {
  const res = await http.post('/api/products', { form: productForm(fields, image) });
  assert.equal(res.status, 201, res.text);
  return res.body.data;
}
