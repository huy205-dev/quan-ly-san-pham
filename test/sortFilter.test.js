/**
 * GET /api/products: sắp xếp (sort/order), lọc theo loại (type) và tình trạng kho (stock), thống kê (summary);
 * GET /api/products/types; xuất file theo cùng bộ lọc và thứ tự.
 *
 * Dữ liệu cố định: 12 sản phẩm (ID 1–12) có tên/loại/đơn vị tiếng Việt có dấu, giá trị trùng nhau ở mọi cột
 * (để kiểm tra phá hòa bằng ProductID), số lượng ở các ngưỡng 0, 1, 9, 10 và ngày tạo/cập nhật gán sẵn.
 */
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  LIMITS,
  PRODUCT_FIELDS,
  SORT_FIELDS,
  TEXT_SORT_FIELDS,
  normalizeSearchText,
  stockStatus,
} from '../shared/productRules.js';
import { assertApiError, createClient, createProduct, loadXlsx, parseXml, qs, rowValues, useTestApp } from './helpers.js';

const app = useTestApp();
const http = createClient(app);

const FIXTURES = [
  /*  1 */ { ProductName: 'Bàn học gỗ', ProductType: 'Nội thất', Quantity: 0, Unit: 'Cái', Price: 1_500_000, CreateDate: '2026-11-01T08:00:00.000Z', UpdateDate: '2026-11-05T01:00:00.000Z' },
  /*  2 */ { ProductName: 'Áo thun', ProductType: 'Thời trang', Quantity: 9, Unit: 'Cái', Price: 150_000, CreateDate: '2026-11-03T08:00:00.000Z', UpdateDate: '2026-11-03T08:00:00.000Z' },
  /*  3 */ { ProductName: 'Ao mưa', ProductType: 'thời trang', Quantity: 10, Unit: 'Chiếc', Price: 50_000, CreateDate: '2026-11-01T08:00:00.000Z', UpdateDate: '2026-11-04T00:00:00.000Z' },
  /*  4 */ { ProductName: 'Đèn ngủ', ProductType: 'Đồ điện', Quantity: 1, Unit: 'Bộ', Price: 150_000, CreateDate: '2026-10-30T23:59:59.999Z', UpdateDate: '2026-11-04T00:00:00.000Z' },
  /*  5 */ { ProductName: 'Dây điện', ProductType: 'Đồ điện', Quantity: 250, Unit: 'Cuộn', Price: 300_000, CreateDate: '2026-11-02T00:00:00.000Z', UpdateDate: '2026-11-02T00:00:00.000Z' },
  /*  6 */ { ProductName: 'Ao', ProductType: 'Phụ kiện', Quantity: 0, Unit: 'cái', Price: 0, CreateDate: '2026-10-31T12:00:00.000Z', UpdateDate: '2026-11-06T00:00:00.000Z' },
  /*  7 */ { ProductName: 'Áo', ProductType: 'Phu', Quantity: 10, Unit: 'Cái', Price: 50_000, CreateDate: '2026-11-03T08:00:00.000Z', UpdateDate: '2026-11-03T09:00:00.000Z' },
  /*  8 */ { ProductName: 'Zen', ProductType: 'PHỤ KIỆN', Quantity: 9, Unit: 'Đôi', Price: 1_000, CreateDate: '2026-11-04T10:00:00.000Z', UpdateDate: '2026-11-04T10:00:00.000Z' },
  /*  9 */ { ProductName: 'ăn vặt', ProductType: 'Phú', Quantity: 11, Unit: 'Gói', Price: 20_000, CreateDate: '2026-10-29T00:00:00.000Z', UpdateDate: '2026-11-01T00:00:00.000Z' },
  /* 10 */ { ProductName: 'Áo thun', ProductType: 'Phụ kiện mới', Quantity: 1000, Unit: 'Cái', Price: 150_000, CreateDate: '2026-11-02T00:00:00.000Z', UpdateDate: '2026-11-07T00:00:00.000Z' },
  /* 11 */ { ProductName: 'Ấm siêu tốc', ProductType: 'Thiết bị', Quantity: 5, Unit: 'Chiếc', Price: 400_000, CreateDate: '2026-11-05T00:00:00.000Z', UpdateDate: '2026-11-05T00:00:00.000Z' },
  /* 12 */ { ProductName: 'Bút', ProductType: 'Văn phòng phẩm', Quantity: 120, Unit: 'Hộp', Price: 5_000, CreateDate: '2026-10-28T00:00:00.000Z', UpdateDate: '2026-11-04T00:00:00.000Z' },
];
const ROWS = FIXTURES.map((fixture, index) => ({ ...fixture, ProductID: index + 1 }));
const ALL_IDS_DESC = ROWS.map((row) => row.ProductID).reverse();

/**
 * Thứ tự tăng dần mong đợi (tính tay): cột chữ theo chuỗi bỏ dấu → chuỗi gốc (byte UTF-8) → ProductID;
 * cột khác theo giá trị → ProductID. Thứ tự giảm dần là đảo ngược hoàn toàn (kể cả phần phá hòa ProductID).
 */
const EXPECTED_ASC = {
  ProductID: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ProductName: [11, 9, 6, 7, 3, 2, 10, 1, 12, 5, 4, 8],
  ProductType: [4, 5, 1, 7, 9, 8, 6, 10, 11, 2, 3, 12],
  Quantity: [1, 6, 4, 11, 2, 8, 3, 7, 9, 12, 5, 10],
  Unit: [4, 1, 2, 7, 10, 6, 3, 11, 5, 8, 9, 12],
  Price: [6, 8, 12, 9, 3, 7, 2, 4, 10, 5, 11, 1],
  CreateDate: [12, 9, 4, 6, 1, 3, 5, 10, 2, 7, 8, 11],
  UpdateDate: [9, 5, 2, 7, 3, 4, 12, 8, 11, 1, 6, 10],
};
const expectedOrder = (sort, order) => (order === 'asc' ? EXPECTED_ASC[sort] : [...EXPECTED_ASC[sort]].reverse());

const SORT_MESSAGE =
  'Chỉ sắp xếp được theo: ProductID, ProductName, ProductType, Quantity, Unit, Price, CreateDate, UpdateDate';
const ORDER_MESSAGE = 'Thứ tự sắp xếp chỉ là asc hoặc desc';
const STOCK_MESSAGE = 'Tình trạng kho chỉ là in, low hoặc out';
const TYPE_INVALID_MESSAGE = 'Loại sản phẩm cần lọc không hợp lệ';
const TYPE_TOO_LONG_MESSAGE = 'Loại sản phẩm cần lọc tối đa 100 ký tự';
const EMPTY_SUMMARY = { totalProducts: 0, totalQuantity: 0, totalValue: 0, lowStock: 0, outOfStock: 0 };
const DEFAULT_FILTERS = { type: '', stock: '', sort: 'ProductID', order: 'desc' };

before(async () => {
  const created = [];
  for (const { CreateDate, UpdateDate, ...fields } of FIXTURES) {
    created.push(await createProduct(http, { ...fields, Description: null }));
  }
  // Ngày do server tự sinh; gán lại trực tiếp trong database để có thứ tự và giá trị trùng nhau định trước.
  const setDates = app.db.prepare('UPDATE Products SET CreateDate = ?, UpdateDate = ? WHERE ProductID = ?');
  created.forEach((product, index) => setDates.run(FIXTURES[index].CreateDate, FIXTURES[index].UpdateDate, product.ProductID));
  assert.deepEqual(created.map((product) => product.ProductID), ROWS.map((row) => row.ProductID));
});

const list = (params = {}) => http.get(`/api/products${qs(params)}`);
const ids = (res) => res.body.data.map((product) => product.ProductID);

/** Danh sách thành công (kiểm tra status) với 15 dòng/trang để thấy đủ 12 sản phẩm. */
async function listOk(params) {
  const res = await list({ pageSize: 15, ...params });
  assert.equal(res.status, 200, res.text.slice(0, 600));
  return res;
}

/** Thống kê mong đợi, tính trực tiếp từ dữ liệu cố định của các ID đã cho. */
function summaryOf(productIds) {
  const rows = ROWS.filter((row) => productIds.includes(row.ProductID));
  return {
    totalProducts: rows.length,
    totalQuantity: rows.reduce((sum, row) => sum + row.Quantity, 0),
    totalValue: rows.reduce((sum, row) => sum + row.Price * row.Quantity, 0),
    lowStock: rows.filter((row) => stockStatus(row.Quantity) === 'low').length,
    outOfStock: rows.filter((row) => stockStatus(row.Quantity) === 'out').length,
  };
}

/** So sánh theo byte UTF-8 (giống collation BINARY mặc định của SQLite). */
const compareBytes = (a, b) => Buffer.compare(Buffer.from(a.normalize('NFC')), Buffer.from(b.normalize('NFC')));

// ---------------------------------------------------------------------------
// Sắp xếp
// ---------------------------------------------------------------------------

describe('sắp xếp (sort, order)', () => {
  test('bảng thứ tự mong đợi khớp quy tắc của hợp đồng (vn_norm → chuỗi gốc → ProductID)', () => {
    for (const field of SORT_FIELDS) {
      const reference = [...ROWS]
        .sort((a, b) => {
          if (TEXT_SORT_FIELDS.includes(field)) {
            return (
              compareBytes(normalizeSearchText(a[field]), normalizeSearchText(b[field])) ||
              compareBytes(a[field], b[field]) ||
              a.ProductID - b.ProductID
            );
          }
          const byValue = typeof a[field] === 'string' ? compareBytes(a[field], b[field]) : a[field] - b[field];
          return byValue || a.ProductID - b.ProductID;
        })
        .map((row) => row.ProductID);
      assert.deepEqual(reference, EXPECTED_ASC[field], field);
    }
  });

  for (const sort of SORT_FIELDS) {
    for (const order of ['asc', 'desc']) {
      test(`sort=${sort}&order=${order}`, async () => {
        const res = await listOk({ sort, order });
        assert.deepEqual(ids(res), expectedOrder(sort, order));
        assert.deepEqual(res.body.filters, { type: '', stock: '', sort, order });
      });
    }
  }

  test('mặc định (không có sort/order): ProductID giảm dần như trước', async () => {
    const res = await listOk({});
    assert.deepEqual(ids(res), ALL_IDS_DESC);
    assert.deepEqual(res.body.filters, DEFAULT_FILTERS);
  });

  test('sort=/order= rỗng → giá trị mặc định', async () => {
    const res = await http.get('/api/products?sort=&order=&pageSize=15');
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), ALL_IDS_DESC);
    assert.deepEqual(res.body.filters, DEFAULT_FILTERS);
  });

  test('chỉ có order=asc → ProductID tăng dần; chỉ có sort=Price → Price giảm dần', async () => {
    assert.deepEqual(ids(await listOk({ order: 'asc' })), EXPECTED_ASC.ProductID);
    const byPrice = await listOk({ sort: 'Price' });
    assert.deepEqual(ids(byPrice), expectedOrder('Price', 'desc'));
    assert.equal(byPrice.body.filters.order, 'desc');
  });

  test('order không phân biệt hoa/thường ("ASC", "Desc"); filters.order trả về chữ thường', async () => {
    const asc = await listOk({ sort: 'Quantity', order: 'ASC' });
    assert.deepEqual(ids(asc), expectedOrder('Quantity', 'asc'));
    assert.equal(asc.body.filters.order, 'asc');
    const desc = await listOk({ sort: 'Quantity', order: 'Desc' });
    assert.deepEqual(ids(desc), expectedOrder('Quantity', 'desc'));
    assert.equal(desc.body.filters.order, 'desc');
  });

  test('tên tiếng Việt: chữ có dấu đứng cạnh chữ không dấu, "Đ" xếp như "D"', async () => {
    const res = await listOk({ sort: 'ProductName', order: 'asc' });
    assert.deepEqual(res.body.data.map((product) => product.ProductName), [
      'Ấm siêu tốc',
      'ăn vặt',
      'Ao',
      'Áo',
      'Ao mưa',
      'Áo thun',
      'Áo thun',
      'Bàn học gỗ',
      'Bút',
      'Dây điện',
      'Đèn ngủ',
      'Zen',
    ]);
  });

  test('giá trị trùng nhau được phá hòa bằng ProductID theo cùng chiều', async () => {
    // "Áo thun" (ID 2 và 10), Price 150.000 (ID 2, 4, 10), Quantity 0 (ID 1, 6).
    const nameAsc = ids(await listOk({ sort: 'ProductName', order: 'asc' }));
    assert.ok(nameAsc.indexOf(2) + 1 === nameAsc.indexOf(10));
    const nameDesc = ids(await listOk({ sort: 'ProductName', order: 'desc' }));
    assert.ok(nameDesc.indexOf(10) + 1 === nameDesc.indexOf(2));
    const priceAsc = ids(await listOk({ sort: 'Price', order: 'asc' }));
    assert.deepEqual(priceAsc.slice(6, 9), [2, 4, 10]);
    const priceDesc = ids(await listOk({ sort: 'Price', order: 'desc' }));
    assert.deepEqual(priceDesc.slice(3, 6), [10, 4, 2]);
    assert.deepEqual(ids(await listOk({ sort: 'Quantity', order: 'asc' })).slice(0, 2), [1, 6]);
  });

  test('sắp xếp kết hợp phân trang: các trang nối lại đúng thứ tự, không trùng/sót; trang vượt quá được đưa về trang cuối', async () => {
    const params = { sort: 'ProductName', order: 'asc' };
    const first = await list({ ...params, page: 1 });
    const second = await list({ ...params, page: 2 });
    assert.deepEqual(first.body.pagination, { page: 1, pageSize: 10, total: 12, totalPages: 2 });
    assert.deepEqual([...ids(first), ...ids(second)], EXPECTED_ASC.ProductName);
    const clamped = await list({ ...params, page: 99 });
    assert.equal(clamped.body.pagination.page, 2);
    assert.deepEqual(ids(clamped), EXPECTED_ASC.ProductName.slice(10));
  });

  for (const sort of ['price', 'PRICE', 'Description', 'PathImage', 'ProductID DESC', 'vn_norm(ProductName)', ' Price', '1']) {
    test(`sort=${JSON.stringify(sort)} → 400 (field sort)`, async () => {
      assertApiError(await list({ sort }), 400, 'VALIDATION_ERROR', {
        message: SORT_MESSAGE,
        details: [{ field: 'sort', message: SORT_MESSAGE }],
      });
    });
  }

  for (const order of ['up', 'ascending', '1', 'asc;', 'desc desc']) {
    test(`order=${JSON.stringify(order)} → 400 (field order)`, async () => {
      assertApiError(await list({ order }), 400, 'VALIDATION_ERROR', {
        message: ORDER_MESSAGE,
        details: [{ field: 'order', message: ORDER_MESSAGE }],
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Lọc theo loại
// ---------------------------------------------------------------------------

describe('lọc theo loại (type)', () => {
  test('khớp chính xác, không phân biệt dấu/hoa thường: "Phu" khớp "Phu" và "Phú" nhưng không khớp "Phụ kiện"', async () => {
    for (const type of ['Phu', 'phu', 'PHU', 'Phú', 'PHÚ', 'Phụ']) {
      const res = await listOk({ type });
      assert.deepEqual(ids(res), [9, 7], type);
      assert.equal(res.body.filters.type, type);
    }
  });

  test('"phu kien" khớp "Phụ kiện" và "PHỤ KIỆN", không khớp "Phụ kiện mới"', async () => {
    for (const type of ['phu kien', 'Phụ kiện', 'PHỤ KIỆN', 'phụ KIỆN', 'Phụ kiện'.normalize('NFD')]) {
      assert.deepEqual(ids(await listOk({ type })), [8, 6], type);
    }
    assert.deepEqual(ids(await listOk({ type: 'Phụ kiện mới' })), [10]);
  });

  test('"đ" khớp "d": "do dien" → "Đồ điện"', async () => {
    assert.deepEqual(ids(await listOk({ type: 'do dien' })), [5, 4]);
    assert.deepEqual(ids(await listOk({ type: 'ĐỒ ĐIỆN' })), [5, 4]);
  });

  test('không khớp một phần và không hiểu ký tự đại diện của LIKE', async () => {
    for (const type of ['Ph', 'kiện', 'Phụ ki', 'Ph%', 'Ph_', '%', '_', 'Phụ kiện m', 'Phụ kiện mới nhất']) {
      const res = await listOk({ type });
      assert.deepEqual(ids(res), [], type);
      assert.equal(res.body.pagination.total, 0);
    }
  });

  test('giá trị được cắt khoảng trắng; filters.type trả về giá trị đã cắt', async () => {
    const res = await listOk({ type: '   Phụ kiện   ' });
    assert.deepEqual(ids(res), [8, 6]);
    assert.equal(res.body.filters.type, 'Phụ kiện');
  });

  test('type rỗng hoặc chỉ có khoảng trắng → không lọc', async () => {
    for (const type of ['', '   ']) {
      const res = await listOk({ type });
      assert.deepEqual(ids(res), ALL_IDS_DESC);
      assert.equal(res.body.filters.type, '');
    }
  });

  test(`type đúng ${LIMITS.productTypeMax} ký tự (sau khi cắt khoảng trắng) được chấp nhận`, async () => {
    const type = 'a'.repeat(LIMITS.productTypeMax);
    assert.equal((await list({ type })).status, 200);
    assert.equal((await list({ type: `  ${type}  ` })).status, 200);
  });

  test(`type dài hơn ${LIMITS.productTypeMax} ký tự → 400 (field type)`, async () => {
    assertApiError(await list({ type: 'a'.repeat(LIMITS.productTypeMax + 1) }), 400, 'VALIDATION_ERROR', {
      message: TYPE_TOO_LONG_MESSAGE,
      details: [{ field: 'type', message: TYPE_TOO_LONG_MESSAGE }],
    });
  });
});

// ---------------------------------------------------------------------------
// Lọc theo tình trạng kho
// ---------------------------------------------------------------------------

describe('lọc theo tình trạng kho (stock)', () => {
  test('out = 0, low = 1…9, in = từ 10 (đúng các ngưỡng 0, 1, 9, 10)', async () => {
    const out = await listOk({ stock: 'out' });
    const low = await listOk({ stock: 'low' });
    const inStock = await listOk({ stock: 'in' });
    assert.deepEqual(ids(out), [6, 1]);
    assert.deepEqual(ids(low), [11, 8, 4, 2]);
    assert.deepEqual(ids(inStock), [12, 10, 9, 7, 5, 3]);
    const quantities = (res) => res.body.data.map((product) => product.Quantity).sort((a, b) => a - b);
    assert.deepEqual(quantities(out), [0, 0]);
    assert.deepEqual(quantities(low), [1, 5, 9, 9]);
    assert.deepEqual(quantities(inStock), [10, 10, 11, 120, 250, 1000]);
    for (const [stock, res] of [['out', out], ['low', low], ['in', inStock]]) {
      assert.equal(res.body.filters.stock, stock);
      for (const product of res.body.data) assert.equal(stockStatus(product.Quantity), stock);
    }
    assert.equal(out.body.pagination.total + low.body.pagination.total + inStock.body.pagination.total, ROWS.length);
  });

  test('không phân biệt hoa/thường và khoảng trắng hai đầu; filters.stock trả về giá trị chuẩn', async () => {
    const res = await listOk({ stock: ' LOW ' });
    assert.deepEqual(ids(res), [11, 8, 4, 2]);
    assert.equal(res.body.filters.stock, 'low');
  });

  test('stock rỗng → không lọc', async () => {
    const res = await listOk({ stock: '' });
    assert.deepEqual(ids(res), ALL_IDS_DESC);
    assert.equal(res.body.filters.stock, '');
  });

  for (const stock of ['all', 'none', 'lowstock', '0', 'in,low', 'hết hàng']) {
    test(`stock=${JSON.stringify(stock)} → 400 (field stock)`, async () => {
      assertApiError(await list({ stock }), 400, 'VALIDATION_ERROR', {
        message: STOCK_MESSAGE,
        details: [{ field: 'stock', message: STOCK_MESSAGE }],
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Tham số lặp lại, nhiều lỗi cùng lúc
// ---------------------------------------------------------------------------

describe('tham số không hợp lệ', () => {
  for (const [param, message] of [
    ['sort', SORT_MESSAGE],
    ['order', ORDER_MESSAGE],
    ['type', TYPE_INVALID_MESSAGE],
    ['stock', STOCK_MESSAGE],
  ]) {
    test(`${param} lặp lại (mảng) → 400 (field ${param})`, async () => {
      const values = { sort: ['Price', 'Quantity'], order: ['asc', 'desc'], type: ['Phu', 'Phú'], stock: ['in', 'out'] };
      assertApiError(await list({ [param]: values[param] }), 400, 'VALIDATION_ERROR', {
        message,
        details: [{ field: param, message }],
      });
    });
  }

  test('nhiều tham số sai cùng lúc → liệt kê từng lỗi theo thứ tự, thông báo chung', async () => {
    const res = await list({ page: 'x', q: ['a', 'b'], type: ['a', 'b'], stock: 'x', sort: 'x', order: 'x' });
    assertApiError(res, 400, 'VALIDATION_ERROR', {
      message: 'Dữ liệu không hợp lệ',
      fields: ['page', 'q', 'type', 'stock', 'sort', 'order'],
    });
  });
});

// ---------------------------------------------------------------------------
// Kết hợp tìm kiếm + lọc + sắp xếp
// ---------------------------------------------------------------------------

describe('kết hợp q, type, stock, sort (AND)', () => {
  test('q + type', async () => {
    const res = await listOk({ q: 'ao', type: 'thoi trang' });
    assert.deepEqual(ids(res), [3, 2]);
    assert.equal(res.body.q, 'ao');
    assert.deepEqual(res.body.filters, { ...DEFAULT_FILTERS, type: 'thoi trang' });
  });

  test('q + type + stock', async () => {
    assert.deepEqual(ids(await listOk({ q: 'ao', type: 'thoi trang', stock: 'low' })), [2]);
    assert.deepEqual(ids(await listOk({ q: 'ao', type: 'thoi trang', stock: 'in' })), [3]);
    assert.deepEqual(ids(await listOk({ q: 'ao', type: 'thoi trang', stock: 'out' })), []);
  });

  test('q + sort: chỉ các kết quả tìm kiếm, theo thứ tự yêu cầu', async () => {
    assert.deepEqual(ids(await listOk({ q: 'ao', sort: 'ProductName', order: 'asc' })), [6, 7, 3, 2, 10]);
    assert.deepEqual(ids(await listOk({ q: 'ao', sort: 'Price', order: 'desc' })), [10, 2, 7, 3, 6]);
  });

  test('type + stock + sort', async () => {
    const res = await listOk({ type: 'Phụ kiện', stock: 'out', sort: 'Quantity', order: 'asc' });
    assert.deepEqual(ids(res), [6]);
    assert.deepEqual(res.body.filters, { type: 'Phụ kiện', stock: 'out', sort: 'Quantity', order: 'asc' });
    assert.deepEqual(res.body.summary, summaryOf([6]));
  });

  describe('lọc kết hợp phân trang (dữ liệu riêng: 23 sản phẩm "Lọc trang" Quantity 0…22 + 5 sản phẩm khác)', () => {
    const own = useTestApp();
    const ownHttp = createClient(own);
    const ownList = (params) => ownHttp.get(`/api/products${qs(params)}`);

    before(async () => {
      for (let quantity = 0; quantity <= 22; quantity += 1) {
        await createProduct(ownHttp, { ProductName: `Lọc ${quantity}`, ProductType: 'Lọc trang', Quantity: quantity, Price: 1000 });
      }
      for (let index = 1; index <= 5; index += 1) {
        await createProduct(ownHttp, { ProductName: `Khác ${index}`, ProductType: 'Khác', Quantity: 50, Price: 1000 });
      }
    });

    test('tổng, số trang và các trang theo kết quả lọc; trang vượt quá được đưa về trang cuối của kết quả', async () => {
      const params = { type: 'loc trang', stock: 'in', sort: 'Quantity', order: 'asc' };
      const quantities = (res) => res.body.data.map((product) => product.Quantity);
      const first = await ownList({ ...params, page: 1 });
      assert.deepEqual(first.body.pagination, { page: 1, pageSize: 10, total: 13, totalPages: 2 });
      assert.deepEqual(quantities(first), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      const second = await ownList({ ...params, page: 2 });
      assert.deepEqual(quantities(second), [20, 21, 22]);
      const clamped = await ownList({ ...params, page: 7 });
      assert.deepEqual(clamped.body.pagination, { page: 2, pageSize: 10, total: 13, totalPages: 2 });
      assert.deepEqual(quantities(clamped), [20, 21, 22]);
      // Thống kê tính trên mọi dòng khớp bộ lọc, không chỉ trang hiện tại.
      assert.deepEqual(clamped.body.summary, {
        totalProducts: 13,
        totalQuantity: 208,
        totalValue: 208_000,
        lowStock: 0,
        outOfStock: 0,
      });
    });

    test('stock=low với 15 dòng/trang: đúng 9 sản phẩm Quantity 1…9, một trang', async () => {
      const res = await ownList({ stock: 'low', pageSize: 15, sort: 'Quantity', order: 'desc' });
      assert.deepEqual(res.body.pagination, { page: 1, pageSize: 15, total: 9, totalPages: 1 });
      assert.deepEqual(res.body.data.map((product) => product.Quantity), [9, 8, 7, 6, 5, 4, 3, 2, 1]);
    });
  });
});

// ---------------------------------------------------------------------------
// Thống kê (summary)
// ---------------------------------------------------------------------------

describe('thống kê (summary)', () => {
  test('toàn bộ kho: đúng các giá trị, đúng thứ tự khóa, totalProducts = pagination.total', async () => {
    const res = await listOk({});
    assert.deepEqual(Object.keys(res.body), ['data', 'pagination', 'q', 'filters', 'summary']);
    assert.deepEqual(Object.keys(res.body.summary), ['totalProducts', 'totalQuantity', 'totalValue', 'lowStock', 'outOfStock']);
    assert.deepEqual(res.body.summary, {
      totalProducts: 12,
      totalQuantity: 1425,
      totalValue: 230_329_000,
      lowStock: 4,
      outOfStock: 2,
    });
    assert.deepEqual(res.body.summary, summaryOf(ALL_IDS_DESC));
    assert.equal(res.body.summary.totalProducts, res.body.pagination.total);
  });

  test('tính trên mọi dòng khớp bộ lọc, không phụ thuộc trang, số dòng/trang hay cách sắp xếp', async () => {
    const pageTwo = await list({ page: 2, sort: 'Price', order: 'asc' });
    assert.equal(pageTwo.body.data.length, 2);
    assert.deepEqual(pageTwo.body.summary, summaryOf(ALL_IDS_DESC));
  });

  test('theo bộ lọc tình trạng kho và loại', async () => {
    assert.deepEqual((await listOk({ stock: 'low' })).body.summary, {
      totalProducts: 4,
      totalQuantity: 24,
      totalValue: 3_509_000,
      lowStock: 4,
      outOfStock: 0,
    });
    assert.deepEqual((await listOk({ type: 'Phu' })).body.summary, {
      totalProducts: 2,
      totalQuantity: 21,
      totalValue: 720_000,
      lowStock: 0,
      outOfStock: 0,
    });
    for (const params of [{ stock: 'out' }, { stock: 'in' }, { q: 'ao' }, { q: 'ao', type: 'thoi trang', stock: 'low' }]) {
      const res = await listOk(params);
      assert.deepEqual(res.body.summary, summaryOf(ids(res)), JSON.stringify(params));
      assert.equal(res.body.summary.totalProducts, res.body.pagination.total);
    }
  });

  test('không có kết quả → mọi giá trị bằng 0 (số, không phải null)', async () => {
    for (const params of [{ type: 'Không có loại này' }, { q: 'khongcosanphamnao' }, { type: 'Phu', stock: 'out' }]) {
      const res = await listOk(params);
      assert.deepEqual(res.body.data, []);
      assert.deepEqual(res.body.summary, EMPTY_SUMMARY);
      for (const value of Object.values(res.body.summary)) assert.equal(typeof value, 'number');
    }
  });

  describe('giá trị rất lớn (Giá × Số lượng vượt giới hạn số nguyên 64 bit)', () => {
    const own = useTestApp();
    const ownHttp = createClient(own);

    test('không lỗi tràn số, trả về số thực', async () => {
      const max = { Price: LIMITS.priceMax, Quantity: LIMITS.quantityMax };
      await createProduct(ownHttp, { ProductName: 'Lớn 1', ...max });
      await createProduct(ownHttp, { ProductName: 'Lớn 2', ...max });
      // 10^12 × 9·10^6 = 9·10^18 vừa giới hạn INTEGER, nhưng tổng hai dòng thì vượt (SUM thông thường sẽ báo lỗi).
      await createProduct(ownHttp, { ProductName: 'Sát giới hạn 1', Price: LIMITS.priceMax, Quantity: 9_000_000 });
      await createProduct(ownHttp, { ProductName: 'Sát giới hạn 2', Price: LIMITS.priceMax, Quantity: 9_000_000 });
      await createProduct(ownHttp, { ProductName: 'Hết hàng', Price: LIMITS.priceMax, Quantity: 0 });
      assert.throws(
        () => own.db.prepare('SELECT SUM(Price * Quantity) AS v FROM Products WHERE Quantity = 9000000').get(),
        /integer overflow/,
      );

      const res = await ownHttp.get('/api/products');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.summary, {
        totalProducts: 5,
        totalQuantity: 2_018_000_000,
        totalValue: 2.018e21,
        lowStock: 0,
        outOfStock: 1,
      });
      const nearLimit = await ownHttp.get('/api/products?q=sat gioi han');
      assert.equal(nearLimit.body.summary.totalValue, 1.8e19);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/products/types
// ---------------------------------------------------------------------------

describe('GET /api/products/types', () => {
  // Các cách viết chỉ khác hoa/thường hoặc dấu được gộp (giống bộ lọc type); tên hiển thị là cách viết dùng
  // nhiều nhất, bằng nhau thì lấy cách viết của sản phẩm mới nhất (ID lớn nhất).
  const EXPECTED_TYPES = [
    { type: 'Đồ điện', count: 2 },
    { type: 'Nội thất', count: 1 },
    { type: 'Phú', count: 2 },
    { type: 'PHỤ KIỆN', count: 2 },
    { type: 'Phụ kiện mới', count: 1 },
    { type: 'Thiết bị', count: 1 },
    { type: 'thời trang', count: 2 },
    { type: 'Văn phòng phẩm', count: 1 },
  ];

  test('các loại (gộp hoa/thường, dấu) kèm số sản phẩm, xếp theo chuỗi bỏ dấu', async () => {
    const res = await http.get('/api/products/types');
    assert.equal(res.status, 200, res.text);
    assert.match(res.contentType, /^application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(res.body), ['data']);
    assert.deepEqual(res.body.data, EXPECTED_TYPES);
    for (const item of res.body.data) assert.deepEqual(Object.keys(item), ['type', 'count']);
    assert.equal(res.body.data.reduce((sum, item) => sum + item.count, 0), ROWS.length);
  });

  test('không bị route /:id bắt nhầm, và không bị ảnh hưởng bởi bất kỳ tham số truy vấn nào', async () => {
    const res = await http.get(`/api/products/types${qs({ q: 'zzz', type: 'Phu', stock: 'x', sort: 'x', order: 'x', page: 'x' })}`);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.data, EXPECTED_TYPES);
    // Đường dẫn khác "types" vẫn đi vào /:id như trước; /types chỉ có GET.
    assertApiError(await http.get('/api/products/typesx'), 400, 'VALIDATION_ERROR', { fields: ['id'] });
    assertApiError(await http.post('/api/products/types'), 404, 'NOT_FOUND', {
      message: 'Không tìm thấy API POST /api/products/types',
    });
  });

  describe('cập nhật theo dữ liệu (ứng dụng riêng)', () => {
    const own = useTestApp();
    const ownHttp = createClient(own);
    const types = async () => (await ownHttp.get('/api/products/types')).body.data;

    test('database rỗng → data []; thêm/sửa/xóa/sao chép làm thay đổi danh sách và số lượng', async () => {
      assert.deepEqual(await types(), []);
      const first = await createProduct(ownHttp, { ProductType: 'Laptop' });
      await createProduct(ownHttp, { ProductType: 'Laptop' });
      await createProduct(ownHttp, { ProductType: 'laptop' });
      assert.deepEqual(await types(), [{ type: 'Laptop', count: 3 }]);
      // Số đếm bằng số dòng khi lọc theo loại đó.
      assert.equal((await ownHttp.get('/api/products?type=Laptop')).body.pagination.total, 3);

      const updated = await ownHttp.put(`/api/products/${first.ProductID}`, {
        json: { ProductName: 'Đổi loại', ProductType: 'Điện thoại', Quantity: 1, Unit: 'Chiếc', Price: 1 },
      });
      assert.equal(updated.status, 200, updated.text);
      assert.deepEqual(await types(), [
        { type: 'Điện thoại', count: 1 },
        { type: 'laptop', count: 2 },
      ]);

      assert.equal((await ownHttp.post('/api/products/bulk-copy', { json: { ids: [first.ProductID] } })).status, 201);
      assert.equal((await ownHttp.delete(`/api/products/${first.ProductID}`)).status, 200);
      assert.deepEqual(await types(), [
        { type: 'Điện thoại', count: 1 },
        { type: 'laptop', count: 2 },
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// Xuất file theo bộ lọc và thứ tự
// ---------------------------------------------------------------------------

describe('GET /api/products/export theo q + type + stock + sort + order', () => {
  const exportFile = (params) => http.get(`/api/products/export${qs(params)}`);

  /** Các sản phẩm trong file xuất (đọc lại từ xlsx/json/xml), dạng { ProductID, ...10 trường }. */
  async function exportedProducts(format, params) {
    const res = await exportFile({ format, ...params });
    assert.equal(res.status, 200, res.text.slice(0, 600));
    if (format === 'json') return JSON.parse(res.text);
    if (format === 'xml') {
      const root = parseXml(res.text).Products;
      return root === '' ? [] : root.Product;
    }
    const sheet = (await loadXlsx(res.buffer)).getWorksheet('Products');
    assert.deepEqual(rowValues(sheet, 1, PRODUCT_FIELDS.length), [...PRODUCT_FIELDS]);
    return Array.from({ length: sheet.actualRowCount - 1 }, (_, index) => {
      const values = rowValues(sheet, index + 2, PRODUCT_FIELDS.length);
      return Object.fromEntries(PRODUCT_FIELDS.map((field, column) => [field, values[column]]));
    });
  }

  const CASES = [
    { params: { stock: 'low', sort: 'ProductName', order: 'asc' }, expected: [11, 2, 4, 8] },
    { params: { q: 'ao', type: 'thoi trang', sort: 'Price', order: 'asc' }, expected: [3, 2] },
    { params: { type: 'PHU KIEN', sort: 'UpdateDate', order: 'desc' }, expected: [6, 8] },
    { params: { sort: 'Unit', order: 'asc' }, expected: EXPECTED_ASC.Unit },
    { params: { type: 'Không có loại này' }, expected: [] },
  ];

  for (const format of ['json', 'xlsx', 'xml']) {
    test(`xuất ${format}: chỉ các dòng khớp mọi bộ lọc, đúng thứ tự yêu cầu, đủ 10 trường`, async () => {
      for (const { params, expected } of CASES) {
        const products = await exportedProducts(format, params);
        assert.deepEqual(products.map((product) => Number(product.ProductID)), expected, JSON.stringify(params));
        for (const product of products) assert.deepEqual(Object.keys(product), [...PRODUCT_FIELDS]);
        // Cùng thứ tự với danh sách trên giao diện (cùng tham số).
        const listed = await listOk(params);
        assert.deepEqual(ids(listed), expected, `danh sách ${JSON.stringify(params)}`);
      }
    });
  }

  test('xuất JSON có bộ lọc: nội dung từng sản phẩm giống hệt API', async () => {
    const params = { stock: 'in', sort: 'Quantity', order: 'desc' };
    assert.deepEqual(await exportedProducts('json', params), (await listOk(params)).body.data);
  });

  test('tham số không hợp lệ khi xuất → 400, kiểm tra giống hệt danh sách', async () => {
    assertApiError(await exportFile({ format: 'json', sort: 'price' }), 400, 'VALIDATION_ERROR', {
      message: SORT_MESSAGE,
      details: [{ field: 'sort', message: SORT_MESSAGE }],
    });
    assertApiError(await exportFile({ format: 'xlsx', order: 'up' }), 400, 'VALIDATION_ERROR', { fields: ['order'] });
    assertApiError(await exportFile({ format: 'xml', stock: 'all' }), 400, 'VALIDATION_ERROR', { fields: ['stock'] });
    assertApiError(await exportFile({ format: 'json', type: ['a', 'b'] }), 400, 'VALIDATION_ERROR', { fields: ['type'] });
    assertApiError(await exportFile({ format: 'json', type: 'x'.repeat(101) }), 400, 'VALIDATION_ERROR', {
      details: [{ field: 'type', message: TYPE_TOO_LONG_MESSAGE }],
    });
    assertApiError(await exportFile({ format: 'pdf', q: ['a', 'b'], sort: ['Price', 'Unit'], order: 'x' }), 400, 'VALIDATION_ERROR', {
      message: 'Dữ liệu không hợp lệ',
      fields: ['format', 'q', 'sort', 'order'],
    });
  });
});
