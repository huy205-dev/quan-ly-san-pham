/**
 * GET /api/products: phân trang và tìm kiếm (mã, tên, mô tả, loại; không phân biệt hoa/thường và dấu).
 * Dữ liệu cố định: 8 sản phẩm đặc biệt (ID 1–8) + 15 "Hàng thường" (ID 9–23) = 23 sản phẩm.
 */
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { assertApiError, assertProductShape, createClient, createProduct, qs, useTestApp } from './helpers.js';

const app = useTestApp();
const http = createClient(app);

const FIXTURES = [
  { ProductName: 'Điện thoại Samsung Galaxy', ProductType: 'Điện thoại', Description: 'Màn hình lớn' },
  { ProductName: 'iPhone 15', ProductType: 'Điện thoại', Description: null },
  { ProductName: 'Laptop Dell', ProductType: 'Máy tính', Description: 'Máy tính xách tay' },
  { ProductName: 'Giảm giá 50% hôm nay', ProductType: 'Khuyến mãi', Description: null },
  { ProductName: 'Mã a_b đặc biệt', ProductType: 'Khác', Description: null },
  { ProductName: 'Nồi cơm', ProductType: 'Gia dụng', Description: 'Lòng nồi chống dính' },
  { ProductName: 'Đèn bàn', ProductType: 'Đồ điện', Description: 'Ánh sáng vàng ấm' },
  { ProductName: 'Dấu gạch \\ ngược', ProductType: 'Khác', Description: null },
];
const REGULAR_COUNT = 15;
const TOTAL = FIXTURES.length + REGULAR_COUNT;

before(async () => {
  for (const fixture of FIXTURES) await createProduct(http, fixture);
  for (let index = 1; index <= REGULAR_COUNT; index += 1) {
    await createProduct(http, { ProductName: `Hàng thường ${index}`, ProductType: 'Thường', Description: null });
  }
});

const list = (params = {}) => http.get(`/api/products${qs(params)}`);
const ids = (res) => res.body.data.map((product) => product.ProductID);
/** ID giảm dần từ `from` xuống `to`. */
const descending = (from, to) => Array.from({ length: from - to + 1 }, (_, index) => from - index);

describe('phân trang', () => {
  test('mặc định: trang 1, 10 dòng, có tổng số bản ghi và tổng số trang', async () => {
    const res = await list();
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ['data', 'pagination', 'q', 'filters', 'summary']);
    assert.deepEqual(res.body.pagination, { page: 1, pageSize: 10, total: TOTAL, totalPages: 3 });
    assert.equal(res.body.q, '');
    assert.deepEqual(res.body.filters, { type: '', stock: '', sort: 'ProductID', order: 'desc' });
    assert.equal(res.body.summary.totalProducts, TOTAL);
    assert.equal(res.body.data.length, 10);
    res.body.data.forEach(assertProductShape);
  });

  test('sắp xếp mới nhất trước (ProductID giảm dần)', async () => {
    assert.deepEqual(ids(await list()), descending(23, 14));
  });

  test('duyệt hết các trang: mỗi sản phẩm xuất hiện đúng một lần', async () => {
    const seen = [];
    for (let page = 1; page <= 3; page += 1) seen.push(...ids(await list({ page })));
    assert.deepEqual(seen, descending(TOTAL, 1));
  });

  test('chọn 15 dòng/trang', async () => {
    const first = await list({ pageSize: 15 });
    assert.deepEqual(first.body.pagination, { page: 1, pageSize: 15, total: TOTAL, totalPages: 2 });
    assert.deepEqual(ids(first), descending(23, 9));
    const second = await list({ pageSize: 15, page: 2 });
    assert.deepEqual(second.body.pagination, { page: 2, pageSize: 15, total: TOTAL, totalPages: 2 });
    assert.deepEqual(ids(second), descending(8, 1));
  });

  test('trang cuối chỉ chứa phần còn lại', async () => {
    const res = await list({ page: 3 });
    assert.deepEqual(res.body.pagination, { page: 3, pageSize: 10, total: TOTAL, totalPages: 3 });
    assert.deepEqual(ids(res), [3, 2, 1]);
  });

  test('trang vượt quá tổng số trang được đưa về trang cuối', async () => {
    const res = await list({ page: 99 });
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.page, 3);
    assert.deepEqual(ids(res), [3, 2, 1]);
  });

  test('số trang cực lớn vẫn được đưa về trang cuối (không lỗi)', async () => {
    const res = await list({ page: '99999999999999999999999' });
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.page, 3);
  });

  test('page/pageSize rỗng → giá trị mặc định', async () => {
    const res = await http.get('/api/products?page=&pageSize=');
    assert.equal(res.status, 200);
    assert.equal(res.body.pagination.page, 1);
    assert.equal(res.body.pagination.pageSize, 10);
  });

  test('không có kết quả: data rỗng, total 0, totalPages 1, page 1', async () => {
    const res = await list({ q: 'khongtontaitukhoanay', page: 4 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
      q: 'khongtontaitukhoanay',
      filters: { type: '', stock: '', sort: 'ProductID', order: 'desc' },
      summary: { totalProducts: 0, totalQuantity: 0, totalValue: 0, lowStock: 0, outOfStock: 0 },
    });
  });

  for (const page of ['0', '-1', 'abc', '1.5', '1e2', ' 1', ['1', '2']]) {
    test(`page=${JSON.stringify(page)} → 400 VALIDATION_ERROR (field page)`, async () => {
      assertApiError(await list({ page }), 400, 'VALIDATION_ERROR', {
        message: 'Trang phải là số nguyên dương',
        details: [{ field: 'page', message: 'Trang phải là số nguyên dương' }],
      });
    });
  }

  for (const pageSize of ['20', '5', '0', 'abc', '10.0', '-10', ['10', '15']]) {
    test(`pageSize=${JSON.stringify(pageSize)} → 400 VALIDATION_ERROR (field pageSize)`, async () => {
      assertApiError(await list({ pageSize }), 400, 'VALIDATION_ERROR', {
        message: 'Số dòng mỗi trang chỉ được là 10 hoặc 15',
        details: [{ field: 'pageSize', message: 'Số dòng mỗi trang chỉ được là 10 hoặc 15' }],
      });
    });
  }

  test('nhiều tham số sai cùng lúc → liệt kê từng lỗi, thông báo chung', async () => {
    assertApiError(await list({ page: 'x', pageSize: 'y', q: ['a', 'b'] }), 400, 'VALIDATION_ERROR', {
      message: 'Dữ liệu không hợp lệ',
      fields: ['page', 'pageSize', 'q'],
    });
  });
});

describe('tìm kiếm', () => {
  const search = async (q, extra = {}) => {
    const res = await list({ pageSize: 15, q, ...extra });
    assert.equal(res.status, 200, res.text);
    return res;
  };

  test('theo tên', async () => {
    assert.deepEqual(ids(await search('samsung')), [1]);
    assert.deepEqual(ids(await search('IPHONE')), [2]);
  });

  test('theo loại sản phẩm', async () => {
    assert.deepEqual(ids(await search('khuyến mãi')), [4]);
  });

  test('theo mô tả', async () => {
    assert.deepEqual(ids(await search('chống dính')), [6]);
  });

  test('theo mã hiển thị: "SP000002", "sp000002" và "000002"', async () => {
    for (const q of ['SP000002', 'sp000002', '000002']) {
      const res = await search(q);
      assert.deepEqual(ids(res), [2], q);
      assert.equal(res.body.pagination.total, 1, q);
    }
  });

  test('theo một phần mã: "SP00001" khớp SP000010–SP000019', async () => {
    assert.deepEqual(ids(await search('SP00001')), descending(19, 10));
  });

  test('không phân biệt dấu và hoa/thường', async () => {
    for (const q of ['dien thoai', 'Điện thoại', 'ĐIỆN THOẠI', 'DIEN THOAI', 'điện THOẠI']) {
      assert.deepEqual(ids(await search(q)), [2, 1], q);
    }
  });

  test('"đ"/"Đ" khớp với "d"', async () => {
    for (const q of ['den', 'Đèn', 'ĐÈN BÀN', 'dEn BaN']) assert.deepEqual(ids(await search(q)), [7], q);
  });

  test('từ khóa dạng Unicode NFD khớp dữ liệu NFC', async () => {
    assert.deepEqual(ids(await search('Nồi cơm'.normalize('NFD'))), [6]);
  });

  test('nhiều từ: mọi từ phải khớp (AND), mỗi từ có thể ở trường khác nhau', async () => {
    assert.deepEqual(ids(await search('samsung dien')), [1]);
    assert.deepEqual(ids(await search('laptop xach')), [3]);
    assert.deepEqual(ids(await search('may tinh')), [3]);
    assert.equal((await search('samsung laptop')).body.pagination.total, 0);
  });

  test('ký tự % được tìm theo nghĩa đen', async () => {
    assert.deepEqual(ids(await search('%')), [4]);
    assert.deepEqual(ids(await search('50%')), [4]);
  });

  test('ký tự _ được tìm theo nghĩa đen', async () => {
    assert.deepEqual(ids(await search('_')), [5]);
    assert.deepEqual(ids(await search('a_b')), [5]);
  });

  test('dấu gạch ngược \\ được tìm theo nghĩa đen', async () => {
    assert.deepEqual(ids(await search('\\')), [8]);
  });

  test('từ khóa được cắt khoảng trắng và trả lại trong phản hồi', async () => {
    const res = await search('   laptop   ');
    assert.equal(res.body.q, 'laptop');
    assert.deepEqual(ids(res), [3]);
  });

  test('từ khóa chỉ có khoảng trắng → toàn bộ danh sách', async () => {
    const res = await list({ q: '    ' });
    assert.equal(res.body.q, '');
    assert.equal(res.body.pagination.total, TOTAL);
  });

  test('tìm kiếm kết hợp phân trang: tổng và số trang theo kết quả tìm', async () => {
    const first = await list({ q: 'hang thuong' });
    assert.deepEqual(first.body.pagination, { page: 1, pageSize: 10, total: 15, totalPages: 2 });
    assert.deepEqual(ids(first), descending(23, 14));
    const second = await list({ q: 'hang thuong', page: 2 });
    assert.deepEqual(ids(second), descending(13, 9));
  });

  test('trang vượt quá khi đang tìm kiếm được đưa về trang cuối của kết quả', async () => {
    const res = await list({ q: 'dien thoai', page: 5 });
    assert.deepEqual(res.body.pagination, { page: 1, pageSize: 10, total: 2, totalPages: 1 });
  });

  test('từ khóa đúng 200 ký tự (sau khi cắt khoảng trắng) được chấp nhận', async () => {
    assert.equal((await list({ q: 'a'.repeat(200) })).status, 200);
    assert.equal((await list({ q: `   ${'a'.repeat(200)}   ` })).status, 200);
  });

  test('từ khóa dài hơn 200 ký tự → 400 (field q)', async () => {
    assertApiError(await list({ q: 'a'.repeat(201) }), 400, 'VALIDATION_ERROR', {
      message: 'Từ khóa tìm kiếm tối đa 200 ký tự',
      details: [{ field: 'q', message: 'Từ khóa tìm kiếm tối đa 200 ký tự' }],
    });
  });

  test('q lặp lại (mảng) → 400 (field q)', async () => {
    assertApiError(await http.get('/api/products?q=a&q=b'), 400, 'VALIDATION_ERROR', {
      message: 'Từ khóa tìm kiếm không hợp lệ',
      details: [{ field: 'q', message: 'Từ khóa tìm kiếm không hợp lệ' }],
    });
  });
});

describe('xóa hết trang cuối → về trang hợp lệ gần nhất', () => {
  const own = useTestApp();
  const ownHttp = createClient(own);

  test('yêu cầu lại trang 2 sau khi xóa toàn bộ trang 2 trả về trang 1', async () => {
    for (let index = 1; index <= 12; index += 1) await createProduct(ownHttp, { ProductName: `Trang cuối ${index}` });
    const lastPage = await ownHttp.get('/api/products?page=2');
    assert.deepEqual(ids(lastPage), [2, 1]);

    const removed = await ownHttp.post('/api/products/bulk-delete', { json: { ids: ids(lastPage) } });
    assert.equal(removed.status, 200);

    const after = await ownHttp.get('/api/products?page=2');
    assert.equal(after.status, 200);
    assert.deepEqual(after.body.pagination, { page: 1, pageSize: 10, total: 10, totalPages: 1 });
    assert.deepEqual(ids(after), descending(12, 3));
  });
});
