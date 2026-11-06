/**
 * Mức ứng dụng: giao diện và file tĩnh, header bảo mật, envelope lỗi của API, lỗi 500,
 * lược đồ database (đúng 10 cột), giao dịch và tiện ích thời gian.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { normalizeSearchText } from '../shared/productRules.js';
import { createProductRepository } from '../src/repositories/productRepository.js';
import { formatVietnamTimestamp, nowUtcIso } from '../src/utils/time.js';
import {
  ISO_UTC_PATTERN,
  PNG_BYTES,
  assertApiError,
  countProducts,
  createClient,
  createProduct,
  productForm,
  useTestApp,
  validProduct,
} from './helpers.js';

const app = useTestApp();
const http = createClient(app);

const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const readProjectFile = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

describe('giao diện và file tĩnh', () => {
  test('GET / trả về public/index.html (text/html, tiếng Việt)', async () => {
    const res = await http.get('/');
    assert.equal(res.status, 200);
    assert.match(res.contentType, /^text\/html/);
    assert.equal(res.text, readProjectFile('public/index.html'));
    assert.match(res.text, /<html[^>]*lang="vi"/);
  });

  test('/shared/productRules.js được phục vụ dạng JavaScript để trình duyệt import', async () => {
    const res = await http.get('/shared/productRules.js');
    assert.equal(res.status, 200);
    assert.match(res.contentType, /^(text|application)\/javascript/);
    assert.equal(res.text, readProjectFile('shared/productRules.js'));
  });

  test('module JavaScript và CSS của giao diện có Content-Type đúng (bắt buộc khi có nosniff)', async () => {
    const script = await http.get('/js/main.js');
    assert.equal(script.status, 200);
    assert.match(script.contentType, /^(text|application)\/javascript/);
    const style = await http.get('/css/styles.css');
    assert.equal(style.status, 200);
    assert.match(style.contentType, /^text\/css/);
  });

  test('trang không tồn tại → 404 văn bản thuần tiếng Việt (không phải JSON)', async () => {
    const res = await http.get('/khong-co-trang-nay');
    assert.equal(res.status, 404);
    assert.match(res.contentType, /^text\/plain/);
    assert.equal(res.text, 'Không tìm thấy trang hoặc tệp yêu cầu');
  });

  test('/uploads không liệt kê nội dung thư mục', async () => {
    assert.equal((await http.get('/uploads/')).status, 404);
  });

  test('/uploads không phục vụ file ẩn (.gitkeep)', async () => {
    fs.writeFileSync(`${app.uploadsDir}/.gitkeep`, '');
    assert.equal((await http.get('/uploads/.gitkeep')).status, 404);
  });

  test('ảnh không tồn tại trong /uploads → 404', async () => {
    assert.equal((await http.get('/uploads/khong-co.png')).status, 404);
  });

  for (const url of ['/uploads/..%2Fpackage.json', '/uploads/%2e%2e/%2e%2e/package.json', '/shared/..%2Fpackage.json', '/..%2Fpackage.json']) {
    test(`chặn truy cập ngoài thư mục tĩnh: ${url}`, async () => {
      const res = await http.get(url);
      assert.notEqual(res.status, 200);
      assert.ok(!res.text.includes('"name": "quan-ly-san-pham"'));
    });
  }
});

describe('header bảo mật', () => {
  for (const url of ['/', '/shared/productRules.js', '/api/products', '/api/khong-co', '/khong-co']) {
    test(`${url}: Content-Security-Policy, nosniff, Referrer-Policy; không có X-Powered-By`, async () => {
      const res = await http.get(url);
      assert.equal(res.headers.get('content-security-policy'), CSP);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('referrer-policy'), 'same-origin');
      assert.equal(res.headers.get('x-powered-by'), null);
    });
  }

  test('ảnh upload được phục vụ kèm nosniff và CSP', async () => {
    const created = await http.post('/api/products', { form: productForm({}, { bytes: PNG_BYTES, name: 'a.png', type: 'image/png' }) });
    const res = await http.get(created.body.data.PathImage);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-security-policy'), CSP);
  });

  test('API: Cache-Control no-store, JSON UTF-8', async () => {
    const res = await http.get('/api/products');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.contentType, 'application/json; charset=utf-8');
  });
});

describe('envelope lỗi của API', () => {
  for (const [method, url] of [
    ['GET', '/api/khong-co'],
    ['GET', '/api'],
    ['POST', '/api/products/export'],
    ['PATCH', '/api/products/1'],
    ['DELETE', '/api/products'],
    ['GET', '/api/products/1/extra'],
  ]) {
    test(`${method} ${url} (không có route) → 404 JSON NOT_FOUND`, async () => {
      assertApiError(await http.request(method, url), 404, 'NOT_FOUND', {
        message: `Không tìm thấy API ${method} ${url}`,
        details: [],
      });
    });
  }

  test('thân JSON sai cú pháp → 400 VALIDATION_ERROR "Dữ liệu JSON gửi lên không hợp lệ"', async () => {
    assertApiError(await http.post('/api/products', { json: '{"ProductName": "x",' }), 400, 'VALIDATION_ERROR', {
      message: 'Dữ liệu JSON gửi lên không hợp lệ',
      details: [],
    });
    assertApiError(await http.post('/api/products/bulk-delete', { json: '{ids: [1]}' }), 400, 'VALIDATION_ERROR', {
      message: 'Dữ liệu JSON gửi lên không hợp lệ',
    });
  });

  test('thân JSON là chuỗi/số (không phải object/mảng) → 400', async () => {
    assertApiError(await http.post('/api/products', { json: '"chuoi"' }), 400, 'VALIDATION_ERROR');
  });

  test('thân JSON lớn hơn 1 MB → 413 FILE_TOO_LARGE', async () => {
    const before = countProducts(app);
    const json = JSON.stringify(validProduct({ Description: 'x'.repeat(1.2 * 1024 * 1024) }));
    assertApiError(await http.post('/api/products', { json }), 413, 'FILE_TOO_LARGE');
    assert.equal(countProducts(app), before);
  });

  test('URL mã hóa sai → 400 JSON (không lỗi 500)', async () => {
    assertApiError(await http.get('/api/products/%E0%A4%A'), 400, 'VALIDATION_ERROR');
  });

  test('Content-Type không được hỗ trợ (text/plain) → 400 VALIDATION_ERROR theo trường', async () => {
    const res = await http.post('/api/products', { body: 'ProductName=a', headers: { 'content-type': 'text/plain' } });
    assertApiError(res, 400, 'VALIDATION_ERROR', { fields: ['ProductName', 'ProductType', 'Quantity', 'Unit', 'Price'] });
  });

  test('400: { error: { code, message, details: [{ field, message }] } }', async () => {
    const res = await http.post('/api/products', { json: validProduct({ Price: -1 }) });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dữ liệu không hợp lệ',
        details: [{ field: 'Price', message: 'Giá phải là số nguyên không âm' }],
      },
    });
  });

  test('404: { error: { code, message, details: [{ id, message }] } }', async () => {
    const res = await http.get('/api/products/5');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, {
      error: {
        code: 'NOT_FOUND',
        message: 'Không tìm thấy sản phẩm SP000005',
        details: [{ id: 5, message: 'Không tìm thấy sản phẩm SP000005' }],
      },
    });
  });

  test('413: { error: { code, message, details: [{ field, message }] } }', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 10);
    PNG_BYTES.copy(big);
    const res = await http.post('/api/products', { form: productForm({}, { bytes: big, name: 'lon.png', type: 'image/png' }) });
    assert.equal(res.status, 413);
    assert.deepEqual(res.body, {
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'Ảnh vượt quá dung lượng tối đa 5 MB',
        details: [{ field: 'image', message: 'Ảnh vượt quá dung lượng tối đa 5 MB' }],
      },
    });
  });

  test('thành công: { data, message } (không có khóa error)', async () => {
    const res = await http.post('/api/products', { json: validProduct() });
    assert.deepEqual(Object.keys(res.body), ['data', 'message']);
  });
});

describe('lỗi không lường trước', () => {
  const broken = useTestApp();
  const brokenHttp = createClient(broken);

  test('lỗi database → 500 INTERNAL_ERROR thông báo chung, ghi log phía server, xóa ảnh vừa ghi', async (t) => {
    broken.db.exec('DROP TABLE Products');
    const logged = t.mock.method(console, 'error', () => {});
    const res = await brokenHttp.post('/api/products', {
      form: productForm({}, { bytes: PNG_BYTES, name: 'a.png', type: 'image/png' }),
    });
    assertApiError(res, 500, 'INTERNAL_ERROR', {
      message: 'Đã xảy ra lỗi không mong muốn trên máy chủ. Vui lòng thử lại sau.',
      details: [],
    });
    assert.ok(!res.text.includes('no such table') && !res.text.includes(' at '), 'không lộ chi tiết lỗi cho client');
    const lines = logged.mock.calls.map((call) => call.arguments.map(String).join(' '));
    assert.ok(lines.some((line) => line.includes('no such table')), 'lỗi được ghi log phía server');
    assert.deepEqual(fs.readdirSync(broken.uploadsDir), [], 'không để lại file ảnh mồ côi');
  });
});

describe('cơ sở dữ liệu', () => {
  test('bảng Products có đúng 10 cột theo thứ tự đề bài (PRAGMA table_info)', () => {
    const columns = app.db.prepare('PRAGMA table_info(Products)').all()
      .map(({ name, type, notnull, pk }) => ({ name, type, notnull: Number(notnull), pk: Number(pk) }));
    assert.deepEqual(columns, [
      { name: 'ProductID', type: 'INTEGER', notnull: 0, pk: 1 },
      { name: 'ProductName', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'PathImage', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'ProductType', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'Quantity', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'Unit', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'Price', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'Description', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'CreateDate', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'UpdateDate', type: 'TEXT', notnull: 1, pk: 0 },
    ]);
  });

  test('chỉ có một bảng dữ liệu là Products', () => {
    const tables = app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    assert.deepEqual(tables.map((table) => table.name), ['Products']);
  });

  test('ProductID tự tăng (AUTOINCREMENT): ID của sản phẩm đã xóa không bị dùng lại', async () => {
    const first = await createProduct(http);
    await http.delete(`/api/products/${first.ProductID}`);
    const second = await createProduct(http);
    assert.equal(second.ProductID, first.ProductID + 1);
  });

  test('ngày được lưu là chuỗi ISO-8601 UTC', async () => {
    const product = await createProduct(http);
    const row = app.db.prepare('SELECT CreateDate, UpdateDate FROM Products WHERE ProductID = ?').get(product.ProductID);
    assert.match(row.CreateDate, ISO_UTC_PATTERN);
    assert.match(row.UpdateDate, ISO_UTC_PATTERN);
  });

  test('database từ chối Quantity/Price âm (CHECK)', () => {
    const insert = (quantity, price) => app.db.prepare(
      "INSERT INTO Products (ProductName, ProductType, Quantity, Unit, Price, CreateDate, UpdateDate) VALUES ('x', 'y', ?, 'z', ?, 'd', 'd')",
    ).run(quantity, price);
    assert.throws(() => insert(-1, 0), /CHECK constraint failed/);
    assert.throws(() => insert(0, -1), /CHECK constraint failed/);
  });

  test('giao dịch: lỗi giữa chừng → hủy toàn bộ (rollback)', () => {
    const repository = createProductRepository(app.db);
    const before = countProducts(app);
    const fields = { ProductName: 'TX', PathImage: null, ProductType: 'T', Quantity: 1, Unit: 'u', Price: 1, Description: null, CreateDate: 'x', UpdateDate: 'x' };
    assert.throws(() => repository.transaction(() => {
      repository.insert(fields);
      repository.insert({ ...fields, Quantity: -1 });
    }));
    assert.equal(countProducts(app), before);
    assert.equal(app.db.isTransaction, false);
  });

  test('hàm SQL vn_norm dùng đúng quy tắc chuẩn hóa của shared rules (NULL → "")', () => {
    const text = 'Điện THOẠI   Đồng hồ';
    assert.equal(app.db.prepare('SELECT vn_norm(?) AS v').get(text).v, normalizeSearchText(text));
    assert.equal(app.db.prepare('SELECT vn_norm(NULL) AS v').get().v, '');
  });
});

describe('tiện ích thời gian', () => {
  test('nowUtcIso trả về thời điểm hiện tại dạng ISO-8601 UTC', () => {
    const before = Date.now();
    const value = nowUtcIso();
    assert.match(value, ISO_UTC_PATTERN);
    assert.ok(Date.parse(value) >= before && Date.parse(value) <= Date.now());
  });

  test('formatVietnamTimestamp dùng giờ Việt Nam (UTC+7), kể cả khi qua nửa đêm', () => {
    assert.equal(formatVietnamTimestamp(new Date('2026-11-04T12:04:05.999Z')), '20261104-190405');
    assert.equal(formatVietnamTimestamp(new Date('2026-12-31T17:30:00Z')), '20270101-003000');
    assert.match(formatVietnamTimestamp(), /^\d{8}-\d{6}$/);
  });
});
