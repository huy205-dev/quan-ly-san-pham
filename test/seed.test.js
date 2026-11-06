/**
 * Dữ liệu mẫu và createApp(): chỉ thêm dữ liệu mẫu khi database mới tạo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { validateProductInput } from '../shared/productRules.js';
import { createApp } from '../src/app.js';
import { ISO_UTC_PATTERN, createClient, makeTempDir, useTestApp } from './helpers.js';

const app = useTestApp({ seedSampleData: true });
const http = createClient(app);

const SEED_COUNT = 32;
const SEED_TYPES = ['Điện thoại', 'Laptop', 'Phụ kiện', 'Thiết bị gia dụng', 'Thực phẩm', 'Đồ uống', 'Văn phòng phẩm', 'Thời trang'];

const exportAll = async () => JSON.parse((await http.get('/api/products/export?format=json')).text);

describe('dữ liệu mẫu (database mới, seedSampleData = true)', () => {
  test(`có ${SEED_COUNT} sản phẩm mẫu, mới nhất trước`, async () => {
    const res = await http.get('/api/products');
    assert.deepEqual(res.body.pagination, { page: 1, pageSize: 10, total: SEED_COUNT, totalPages: 4 });
    assert.equal(res.body.data[0].ProductID, SEED_COUNT);
  });

  test('trải đều 8 loại sản phẩm, không có ảnh', async () => {
    const products = await exportAll();
    assert.deepEqual([...new Set(products.map((product) => product.ProductType))].sort(), [...SEED_TYPES].sort());
    assert.ok(products.every((product) => product.PathImage === null));
  });

  test('trang đầu có nhiều loại sản phẩm khác nhau', async () => {
    const firstPage = (await http.get('/api/products')).body.data;
    assert.ok(new Set(firstPage.map((product) => product.ProductType)).size >= 5);
  });

  test('mọi sản phẩm mẫu hợp lệ theo quy tắc dùng chung', async () => {
    for (const product of await exportAll()) {
      assert.deepEqual(validateProductInput(product).errors, [], product.ProductName);
    }
  });

  test('có dấu tiếng Việt để thử tìm kiếm không dấu ("dien thoai" → "Điện thoại")', async () => {
    const res = await http.get('/api/products?q=dien%20thoai');
    assert.ok(res.body.pagination.total >= 3);
    assert.ok(res.body.data.every((product) => /điện thoại/i.test(`${product.ProductName} ${product.ProductType} ${product.Description}`)));
  });

  test('ngày ISO-8601 UTC, CreateDate ≤ UpdateDate ≤ hiện tại, trong vài ngày gần đây', async () => {
    const now = Date.now();
    for (const product of await exportAll()) {
      assert.match(product.CreateDate, ISO_UTC_PATTERN);
      assert.match(product.UpdateDate, ISO_UTC_PATTERN);
      assert.ok(product.CreateDate <= product.UpdateDate);
      assert.ok(Date.parse(product.UpdateDate) <= now);
      assert.ok(now - Date.parse(product.CreateDate) < 7 * 24 * 60 * 60 * 1000);
    }
  });

  test('một số sản phẩm đã được "sửa" sau khi tạo (UpdateDate khác CreateDate)', async () => {
    assert.ok((await exportAll()).some((product) => product.UpdateDate !== product.CreateDate));
  });
});

describe('createApp với file database', () => {
  const tempDir = makeTempDir();
  after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const countIn = (instance) => Number(instance.db.prepare('SELECT COUNT(*) AS n FROM Products').get().n);
  const open = (dbPath, seedSampleData) =>
    createApp({ dbPath, uploadsDir: path.join(tempDir, 'uploads'), seedSampleData });

  test('tạo thư mục database và thư mục uploads nếu chưa có', () => {
    const dbPath = path.join(tempDir, 'moi', 'long', 'products.db');
    const uploadsDir = path.join(tempDir, 'anh', 'uploads');
    const instance = createApp({ dbPath, uploadsDir, seedSampleData: false });
    instance.close();
    assert.ok(fs.existsSync(dbPath));
    assert.ok(fs.statSync(uploadsDir).isDirectory());
  });

  test('file database mới → thêm dữ liệu mẫu; mở lại file đã có → không thêm lại', () => {
    const dbPath = path.join(tempDir, 'data', 'products.db');
    const first = open(dbPath, true);
    assert.equal(countIn(first), SEED_COUNT);
    first.db.exec('DELETE FROM Products WHERE ProductID > 30');
    first.close();

    const second = open(dbPath, true);
    assert.equal(countIn(second), 30, 'database đã tồn tại không được thêm dữ liệu mẫu lần nữa');
    second.close();
  });

  test('database đã có nhưng bảng rỗng (người dùng xóa hết) → không tự thêm lại dữ liệu mẫu', () => {
    const dbPath = path.join(tempDir, 'rong', 'products.db');
    const first = open(dbPath, true);
    first.db.exec('DELETE FROM Products');
    first.close();
    const second = open(dbPath, true);
    assert.equal(countIn(second), 0);
    second.close();
  });

  test('seedSampleData = false → database mới rỗng', () => {
    const instance = open(path.join(tempDir, 'khong-mau.db'), false);
    assert.equal(countIn(instance), 0);
    instance.close();
  });

  test('dữ liệu được lưu bền vững giữa các lần mở', () => {
    const dbPath = path.join(tempDir, 'ben-vung.db');
    const first = open(dbPath, false);
    first.db.prepare(
      "INSERT INTO Products (ProductName, ProductType, Quantity, Unit, Price, CreateDate, UpdateDate) VALUES ('Lưu lại', 'Loại', 1, 'Cái', 1, 'd', 'd')",
    ).run();
    first.close();
    const second = open(dbPath, false);
    assert.equal(second.db.prepare('SELECT ProductName FROM Products').get().ProductName, 'Lưu lại');
    second.close();
  });

  test('close() gọi nhiều lần không lỗi', () => {
    const instance = open(':memory:', false);
    instance.close();
    assert.doesNotThrow(() => instance.close());
  });
});
