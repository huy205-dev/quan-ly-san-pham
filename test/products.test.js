/**
 * Thêm / xem / sửa / xóa sản phẩm, ảnh upload, xóa nhiều và sao chép (một hoặc nhiều).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { formatProductCode } from '../shared/productRules.js';
import {
  GIF_BYTES,
  JPEG_BYTES,
  PNG_BYTES,
  WEBP_BYTES,
  assertApiError,
  assertProductShape,
  countProducts,
  createClient,
  createProduct,
  createProductWithImage,
  listUploads,
  productForm,
  rawMultipart,
  sleep,
  uploadFilePath,
  useTestApp,
  validProduct,
} from './helpers.js';

const app = useTestApp();
const http = createClient(app);

const MB = 1024 * 1024;
const uploadPathPattern = (ext) => new RegExp(`^/uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${ext}$`);
const png = (name = 'anh.png') => ({ bytes: PNG_BYTES, name, type: 'image/png' });

/** POST /api/products bằng JSON. */
const postJson = (json) => http.post('/api/products', { json });
/** POST /api/products bằng multipart. */
const postForm = (fields, files) => http.post('/api/products', { form: productForm(fields, files) });

describe('POST /api/products (JSON)', () => {
  test('tạo sản phẩm → 201, đủ 10 trường, ID tự tăng, ngày do server tạo theo UTC', async () => {
    const startedAt = Date.now();
    const res = await postJson(validProduct());
    const finishedAt = Date.now();
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(Object.keys(res.body), ['data', 'message']);
    const product = res.body.data;
    assertProductShape(product);
    assert.equal(res.body.message, `Đã thêm sản phẩm ${formatProductCode(product.ProductID)}`);
    assert.deepEqual({ ...product, ProductID: 0, CreateDate: '', UpdateDate: '' }, {
      ProductID: 0,
      ProductName: 'Bút bi Thiên Long',
      PathImage: null,
      ProductType: 'Văn phòng phẩm',
      Quantity: 120,
      Unit: 'Hộp',
      Price: 45000,
      Description: 'Mực xanh, ngòi 0,5 mm',
      CreateDate: '',
      UpdateDate: '',
    });
    assert.equal(product.CreateDate, product.UpdateDate);
    const created = Date.parse(product.CreateDate);
    assert.ok(created >= startedAt && created <= finishedAt, 'CreateDate là thời điểm tạo');
  });

  test('sản phẩm vừa tạo đọc lại được qua GET /api/products/:id', async () => {
    const product = await createProduct(http);
    const res = await http.get(`/api/products/${product.ProductID}`);
    assert.deepEqual(res.body, { data: product });
  });

  test('bỏ qua ProductID, CreateDate, UpdateDate và trường lạ do client gửi', async () => {
    const res = await postJson(validProduct({
      ProductID: 99999,
      CreateDate: '2000-01-01T00:00:00.000Z',
      UpdateDate: '2000-01-02T00:00:00.000Z',
      Foo: 'bar',
      removeImage: true,
    }));
    assert.equal(res.status, 201);
    const product = res.body.data;
    assert.notEqual(product.ProductID, 99999);
    assert.notEqual(product.CreateDate, '2000-01-01T00:00:00.000Z');
    assert.notEqual(product.UpdateDate, '2000-01-02T00:00:00.000Z');
    assertProductShape(product);
    assertApiError(await http.get('/api/products/99999'), 404, 'NOT_FOUND');
  });

  test('cắt khoảng trắng hai đầu; Mô tả rỗng lưu là null', async () => {
    const product = await createProduct(http, { ProductName: '  Tên có khoảng trắng  ', Unit: ' Cái ', Description: '   ' });
    assert.equal(product.ProductName, 'Tên có khoảng trắng');
    assert.equal(product.Unit, 'Cái');
    assert.equal(product.Description, null);
  });

  test('số lượng và giá dạng chuỗi chữ số được đổi thành số nguyên', async () => {
    const product = await createProduct(http, { Quantity: '007', Price: '1250000' });
    assert.equal(product.Quantity, 7);
    assert.equal(product.Price, 1250000);
  });

  test('giá trị biên hợp lệ được lưu nguyên vẹn (200/100/50/2.000 ký tự, 0 và giá trị tối đa)', async () => {
    const input = {
      ProductName: 'Đ'.repeat(200),
      ProductType: 'L'.repeat(100),
      Unit: 'u'.repeat(50),
      Description: 'm'.repeat(2000),
      Quantity: 1_000_000_000,
      Price: 1_000_000_000_000,
    };
    const product = await createProduct(http, input);
    for (const [field, value] of Object.entries(input)) assert.equal(product[field], value, field);
    const zero = await createProduct(http, { Quantity: 0, Price: 0 });
    assert.equal(zero.Quantity, 0);
    assert.equal(zero.Price, 0);
  });

  test('tiếng Việt và emoji được lưu nguyên vẹn', async () => {
    const product = await createProduct(http, { ProductName: 'Bánh tráng trộn 😀 ỹ ữ ặ', Description: 'Đặc sản Tây Ninh' });
    assert.equal(product.ProductName, 'Bánh tráng trộn 😀 ỹ ữ ặ');
    assert.equal(product.Description, 'Đặc sản Tây Ninh');
  });

  test('thiếu toàn bộ trường bắt buộc → 400 VALIDATION_ERROR với lỗi từng trường', async () => {
    assertApiError(await postJson({}), 400, 'VALIDATION_ERROR', {
      message: 'Dữ liệu không hợp lệ',
      details: [
        { field: 'ProductName', message: 'Tên sản phẩm là bắt buộc' },
        { field: 'ProductType', message: 'Loại sản phẩm là bắt buộc' },
        { field: 'Quantity', message: 'Số lượng là bắt buộc' },
        { field: 'Unit', message: 'Đơn vị tính là bắt buộc' },
        { field: 'Price', message: 'Giá là bắt buộc' },
      ],
    });
  });

  const RULES = [
    ['Tên rỗng', { ProductName: '' }, 'ProductName', 'Tên sản phẩm là bắt buộc'],
    ['Tên chỉ có khoảng trắng', { ProductName: '   ' }, 'ProductName', 'Tên sản phẩm là bắt buộc'],
    ['Tên dài 201 ký tự', { ProductName: 'a'.repeat(201) }, 'ProductName', 'Tên sản phẩm tối đa 200 ký tự'],
    ['Tên là object', { ProductName: { a: 1 } }, 'ProductName', 'Tên sản phẩm không hợp lệ'],
    ['Thiếu loại', { ProductType: undefined }, 'ProductType', 'Loại sản phẩm là bắt buộc'],
    ['Loại dài 101 ký tự', { ProductType: 'a'.repeat(101) }, 'ProductType', 'Loại sản phẩm tối đa 100 ký tự'],
    ['Thiếu số lượng', { Quantity: null }, 'Quantity', 'Số lượng là bắt buộc'],
    ['Số lượng âm', { Quantity: -1 }, 'Quantity', 'Số lượng phải là số nguyên không âm'],
    ['Số lượng thập phân', { Quantity: 2.5 }, 'Quantity', 'Số lượng phải là số nguyên không âm'],
    ['Số lượng là chữ', { Quantity: 'mười' }, 'Quantity', 'Số lượng phải là số nguyên không âm'],
    ['Số lượng vượt tối đa', { Quantity: 1_000_000_001 }, 'Quantity', 'Số lượng không được vượt quá 1.000.000.000'],
    ['Thiếu đơn vị', { Unit: '' }, 'Unit', 'Đơn vị tính là bắt buộc'],
    ['Đơn vị dài 51 ký tự', { Unit: 'a'.repeat(51) }, 'Unit', 'Đơn vị tính tối đa 50 ký tự'],
    ['Thiếu giá', { Price: '' }, 'Price', 'Giá là bắt buộc'],
    ['Giá âm', { Price: -1000 }, 'Price', 'Giá phải là số nguyên không âm'],
    ['Giá thập phân', { Price: 99.5 }, 'Price', 'Giá phải là số nguyên không âm'],
    ['Giá có dấu chấm ngăn cách', { Price: '1.000.000' }, 'Price', 'Giá phải là số nguyên không âm'],
    ['Giá vượt tối đa', { Price: 1_000_000_000_001 }, 'Price', 'Giá không được vượt quá 1.000.000.000.000'],
    ['Mô tả dài 2.001 ký tự', { Description: 'a'.repeat(2001) }, 'Description', 'Mô tả tối đa 2.000 ký tự'],
  ];
  for (const [label, overrides, field, message] of RULES) {
    test(`${label} → 400, lỗi tại trường ${field}, không thêm sản phẩm`, async () => {
      const before = countProducts(app);
      assertApiError(await postJson(validProduct(overrides)), 400, 'VALIDATION_ERROR', {
        message: 'Dữ liệu không hợp lệ',
        details: [{ field, message }],
      });
      assert.equal(countProducts(app), before);
    });
  }

  test('mọi lỗi (kể cả PathImage) được trả về cùng lúc, theo thứ tự trường', async () => {
    const res = await postJson(validProduct({ ProductName: '', Quantity: -1, Price: 'abc', PathImage: '/uploads/khong-co.png' }));
    assertApiError(res, 400, 'VALIDATION_ERROR', { fields: ['ProductName', 'Quantity', 'Price', 'PathImage'] });
  });

  test('thân JSON là mảng → coi như rỗng, báo thiếu trường bắt buộc', async () => {
    assertApiError(await postJson([1, 2]), 400, 'VALIDATION_ERROR', {
      fields: ['ProductName', 'ProductType', 'Quantity', 'Unit', 'Price'],
    });
  });

  test('PathImage tham chiếu ảnh đã upload → dùng lại đúng đường dẫn đó (chuẩn hóa "uploads/..." → "/uploads/...")', async () => {
    const withImage = await createProductWithImage(http);
    const fileName = path.basename(withImage.PathImage);
    const res = await postJson(validProduct({ ProductName: 'Dùng ảnh có sẵn', PathImage: `uploads/${fileName}` }));
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data.PathImage, withImage.PathImage);
  });

  test('PathImage tới ảnh không tồn tại → 400 (field PathImage)', async () => {
    assertApiError(await postJson(validProduct({ PathImage: '/uploads/khong-ton-tai.png' })), 400, 'VALIDATION_ERROR', {
      details: [{ field: 'PathImage', message: 'Ảnh không tồn tại trong ứng dụng' }],
    });
  });

  test('PathImage là thư mục (không phải file) → 400 (field PathImage)', async () => {
    fs.mkdirSync(path.join(app.uploadsDir, 'thu-muc.png'));
    assertApiError(await postJson(validProduct({ PathImage: '/uploads/thu-muc.png' })), 400, 'VALIDATION_ERROR', {
      details: [{ field: 'PathImage', message: 'Ảnh không tồn tại trong ứng dụng' }],
    });
  });

  test('PathImage tới file không phải ảnh có sẵn trong uploads → 400', async () => {
    fs.writeFileSync(path.join(app.uploadsDir, 'ghi-chu.txt'), 'không phải ảnh');
    assertApiError(await postJson(validProduct({ PathImage: '/uploads/ghi-chu.txt' })), 400, 'VALIDATION_ERROR', {
      fields: ['PathImage'],
    });
  });

  for (const bad of [
    '../package.json',
    '/uploads/../package.json',
    '/uploads/..%2Fpackage.json',
    '/uploads/sub/anh.png',
    '..\\..\\anh.png',
    'C:\\Windows\\win.ini',
    'http://evil.example/anh.png',
    'data:image/png;base64,iVBORw0KGgo=',
    '/uploads/anh.gif',
    12,
    { path: '/uploads/a.png' },
  ]) {
    test(`PathImage ${JSON.stringify(bad)} bị từ chối (field PathImage)`, async () => {
      const before = countProducts(app);
      assertApiError(await postJson(validProduct({ PathImage: bad })), 400, 'VALIDATION_ERROR', { fields: ['PathImage'] });
      assert.equal(countProducts(app), before);
    });
  }

  test('PathImage rỗng hoặc null → sản phẩm không có ảnh', async () => {
    assert.equal((await createProduct(http, { PathImage: '' })).PathImage, null);
    assert.equal((await createProduct(http, { PathImage: null })).PathImage, null);
  });
});

describe('POST /api/products (multipart + ảnh)', () => {
  test('ảnh PNG → 201, lưu file tên ngẫu nhiên .png trong uploads với nội dung nguyên vẹn', async () => {
    const res = await postForm({ ProductName: 'Ảnh PNG' }, png());
    assert.equal(res.status, 201, res.text);
    const product = res.body.data;
    assertProductShape(product);
    assert.match(product.PathImage, uploadPathPattern('png'));
    assert.ok(fs.readFileSync(uploadFilePath(app, product.PathImage)).equals(PNG_BYTES));
    assert.equal(product.ProductName, 'Ảnh PNG');
    assert.equal(product.Quantity, 5);
    assert.equal(product.Price, 1000);
    assert.equal(res.body.message, `Đã thêm sản phẩm ${formatProductCode(product.ProductID)}`);
  });

  test('ảnh JPEG (.jpeg) → lưu với đuôi .jpg', async () => {
    const res = await postForm({}, { bytes: JPEG_BYTES, name: 'anh.jpeg', type: 'image/jpeg' });
    assert.equal(res.status, 201, res.text);
    assert.match(res.body.data.PathImage, uploadPathPattern('jpg'));
  });

  test('ảnh WebP → lưu với đuôi .webp', async () => {
    const res = await postForm({}, { bytes: WEBP_BYTES, name: 'anh.webp', type: 'image/webp' });
    assert.equal(res.status, 201, res.text);
    assert.match(res.body.data.PathImage, uploadPathPattern('webp'));
  });

  test('đuôi file lưu theo nội dung thật (PNG đặt tên .jpg → .png)', async () => {
    const res = await postForm({}, { bytes: PNG_BYTES, name: 'thuc-ra-la-png.jpg', type: 'image/jpeg' });
    assert.equal(res.status, 201, res.text);
    assert.match(res.body.data.PathImage, uploadPathPattern('png'));
  });

  test('tên file tiếng Việt, đuôi chữ hoa vẫn được nhận', async () => {
    const res = await postForm({}, { bytes: PNG_BYTES, name: 'ảnh sản phẩm.PNG', type: 'image/png' });
    assert.equal(res.status, 201, res.text);
  });

  test('mỗi lần upload tạo một file mới với tên khác nhau', async () => {
    const first = await createProductWithImage(http);
    const second = await createProductWithImage(http);
    assert.notEqual(first.PathImage, second.PathImage);
    assert.ok(fs.existsSync(uploadFilePath(app, first.PathImage)));
    assert.ok(fs.existsSync(uploadFilePath(app, second.PathImage)));
  });

  test('không gửi ảnh → PathImage null', async () => {
    const res = await postForm({});
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data.PathImage, null);
  });

  test('phần file rỗng không tên (ô chọn ảnh để trống của trình duyệt) được coi là không có ảnh', async () => {
    const files = listUploads(app);
    const { body, headers } = rawMultipart([
      ...Object.entries({ ProductName: 'Không chọn ảnh', ProductType: 'Phụ kiện', Quantity: '1', Unit: 'Cái', Price: '1' })
        .map(([name, value]) => ({ name, value })),
      { name: 'image', filename: '', type: 'application/octet-stream', value: '' },
    ]);
    const res = await http.post('/api/products', { body, headers });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data.PathImage, null);
    assert.deepEqual(listUploads(app), files);
  });

  test('multipart bỏ qua ProductID, CreateDate, UpdateDate', async () => {
    const res = await postForm({ ProductID: '77777', CreateDate: '2001-01-01T00:00:00.000Z', UpdateDate: '2001-01-01T00:00:00.000Z' });
    assert.equal(res.status, 201, res.text);
    assert.notEqual(res.body.data.ProductID, 77777);
    assert.notEqual(res.body.data.CreateDate, '2001-01-01T00:00:00.000Z');
  });

  test('multipart bỏ qua trường PathImage (chỉ JSON mới tham chiếu ảnh có sẵn)', async () => {
    const withImage = await createProductWithImage(http);
    const res = await postForm({ PathImage: withImage.PathImage });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data.PathImage, null);
  });

  test('lỗi trường dữ liệu trong multipart được báo theo trường', async () => {
    assertApiError(await postForm({ ProductName: '', Quantity: '-1', Price: 'abc' }), 400, 'VALIDATION_ERROR', {
      fields: ['ProductName', 'Quantity', 'Price'],
    });
  });

  test('file giả ảnh (văn bản đặt tên .png) → 400 field image, không ghi file', async () => {
    const files = listUploads(app);
    const before = countProducts(app);
    const res = await postForm({}, { bytes: Buffer.from('đây không phải ảnh'), name: 'gia.png', type: 'image/png' });
    assertApiError(res, 400, 'VALIDATION_ERROR', {
      details: [{ field: 'image', message: 'Nội dung file không phải ảnh PNG, JPEG hoặc WebP hợp lệ' }],
    });
    assert.deepEqual(listUploads(app), files);
    assert.equal(countProducts(app), before);
  });

  test('file giả ảnh + trường sai → mọi lỗi trả về cùng lúc', async () => {
    const res = await postForm({ ProductName: '', Price: 'abc' }, { bytes: Buffer.from('text'), name: 'gia.png', type: 'image/png' });
    assertApiError(res, 400, 'VALIDATION_ERROR', { fields: ['ProductName', 'Price', 'image'] });
  });

  test('trường sai + ảnh hợp lệ → 400, không để lại file ảnh mồ côi', async () => {
    const files = listUploads(app);
    const res = await postForm({ Price: '-1' }, png());
    assertApiError(res, 400, 'VALIDATION_ERROR', { fields: ['Price'] });
    assert.deepEqual(listUploads(app), files);
  });

  test('file .gif → 400 FILE_ERROR field image, không ghi file', async () => {
    const files = listUploads(app);
    const res = await postForm({}, { bytes: GIF_BYTES, name: 'anh.gif', type: 'image/gif' });
    assertApiError(res, 400, 'FILE_ERROR', {
      message: 'Ảnh phải là file PNG, JPEG hoặc WebP',
      details: [{ field: 'image', message: 'Ảnh phải là file PNG, JPEG hoặc WebP' }],
    });
    assert.deepEqual(listUploads(app), files);
  });

  test('kiểu MIME không phải ảnh → 400 FILE_ERROR', async () => {
    assertApiError(await postForm({}, { bytes: PNG_BYTES, name: 'anh.png', type: 'text/plain' }), 400, 'FILE_ERROR', {
      fields: ['image'],
    });
  });

  test('ảnh lớn hơn 5 MB → 413 FILE_TOO_LARGE field image, không ghi file', async () => {
    const files = listUploads(app);
    const before = countProducts(app);
    const big = Buffer.alloc(5 * MB + 1);
    PNG_BYTES.copy(big);
    const res = await postForm({}, { bytes: big, name: 'lon.png', type: 'image/png' });
    assertApiError(res, 413, 'FILE_TOO_LARGE', {
      message: 'Ảnh vượt quá dung lượng tối đa 5 MB',
      details: [{ field: 'image', message: 'Ảnh vượt quá dung lượng tối đa 5 MB' }],
    });
    assert.deepEqual(listUploads(app), files);
    assert.equal(countProducts(app), before);
  });

  test('ảnh đúng 5 MB được nhận', async () => {
    const exact = Buffer.alloc(5 * MB);
    PNG_BYTES.copy(exact);
    const res = await postForm({}, { bytes: exact, name: 'vua-du.png', type: 'image/png' });
    assert.equal(res.status, 201, res.text);
    assert.equal(fs.statSync(uploadFilePath(app, res.body.data.PathImage)).size, 5 * MB);
  });

  test('file ảnh rỗng → 400 "File ảnh rỗng"', async () => {
    assertApiError(await postForm({}, { bytes: Buffer.alloc(0), name: 'rong.png', type: 'image/png' }), 400, 'VALIDATION_ERROR', {
      details: [{ field: 'image', message: 'File ảnh rỗng' }],
    });
  });

  test('file gửi ở trường khác "image" → 400 FILE_ERROR', async () => {
    assertApiError(await postForm({}, { ...png(), field: 'photo' }), 400, 'FILE_ERROR', { fields: ['image'] });
  });

  test('gửi hai file ảnh → 400 FILE_ERROR, không ghi file', async () => {
    const files = listUploads(app);
    assertApiError(await postForm({}, [png('a.png'), png('b.png')]), 400, 'FILE_ERROR', { fields: ['image'] });
    assert.deepEqual(listUploads(app), files);
  });

  test('multipart hỏng (thiếu boundary hoặc bị cắt cụt) → 400 JSON', async () => {
    assertApiError(
      await http.post('/api/products', { body: 'abc', headers: { 'content-type': 'multipart/form-data' } }),
      400,
      'VALIDATION_ERROR',
    );
    assertApiError(
      await http.post('/api/products', {
        body: '--xyz\r\nContent-Disposition: form-data; name="ProductName"\r\n\r\nabc',
        headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
      }),
      400,
      'VALIDATION_ERROR',
    );
  });

  for (const [label, image, contentType] of [
    ['PNG', png(), 'image/png'],
    ['JPEG', { bytes: JPEG_BYTES, name: 'a.jpg', type: 'image/jpeg' }, 'image/jpeg'],
    ['WebP', { bytes: WEBP_BYTES, name: 'a.webp', type: 'image/webp' }, 'image/webp'],
  ]) {
    test(`ảnh ${label} đã upload được phục vụ tại PathImage với Content-Type ${contentType} và nosniff`, async () => {
      const product = await createProductWithImage(http, {}, image);
      const res = await http.get(product.PathImage);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), contentType);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(res.buffer.equals(image.bytes));
    });
  }
});

describe('GET /api/products/:id', () => {
  test('lấy theo ID số → 200 { data } đủ 10 trường', async () => {
    const product = await createProduct(http);
    const res = await http.get(`/api/products/${product.ProductID}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ['data']);
    assertProductShape(res.body.data);
    assert.deepEqual(res.body.data, product);
  });

  test('lấy theo mã SP000xxx (không phân biệt hoa/thường) giống lấy theo ID', async () => {
    const product = await createProduct(http);
    const code = formatProductCode(product.ProductID);
    for (const id of [code, code.toLowerCase()]) {
      assert.deepEqual((await http.get(`/api/products/${id}`)).body, { data: product }, id);
    }
  });

  test('ID không tồn tại → 404 NOT_FOUND với chi tiết ID', async () => {
    assertApiError(await http.get('/api/products/999999'), 404, 'NOT_FOUND', {
      message: 'Không tìm thấy sản phẩm SP999999',
      details: [{ id: 999999, message: 'Không tìm thấy sản phẩm SP999999' }],
    });
  });

  test('ID rất lớn nhưng hợp lệ → 404', async () => {
    assertApiError(await http.get('/api/products/999999999999999'), 404, 'NOT_FOUND');
  });

  for (const bad of ['abc', '0', '-1', '1.5', 'SP', 'SPabc', '9999999999999999', '%20', '1e3']) {
    test(`ID "${bad}" không hợp lệ → 400 (field id)`, async () => {
      assertApiError(await http.get(`/api/products/${bad}`), 400, 'VALIDATION_ERROR', {
        message: 'Mã sản phẩm không hợp lệ',
        details: [{ field: 'id', message: 'Mã sản phẩm không hợp lệ' }],
      });
    });
  }
});

describe('PUT /api/products/:id', () => {
  const putJson = (id, json) => http.put(`/api/products/${id}`, { json });
  const putForm = (id, fields, files) => http.put(`/api/products/${id}`, { form: productForm(fields, files) });

  test('cập nhật đầy đủ 6 trường → 200, thông báo kèm mã', async () => {
    const original = await createProduct(http);
    const changes = { ProductName: 'Tên mới', ProductType: 'Loại mới', Quantity: 3, Unit: 'Bộ', Price: 99000, Description: 'Mô tả mới' };
    const res = await putJson(original.ProductID, changes);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(Object.keys(res.body), ['data', 'message']);
    assert.equal(res.body.message, `Đã cập nhật sản phẩm ${formatProductCode(original.ProductID)}`);
    assertProductShape(res.body.data);
    for (const [field, value] of Object.entries(changes)) assert.equal(res.body.data[field], value, field);
    assert.deepEqual((await http.get(`/api/products/${original.ProductID}`)).body.data, res.body.data);
  });

  test('CreateDate giữ nguyên, UpdateDate được làm mới', async () => {
    const original = await createProduct(http);
    await sleep(15);
    const updated = (await putJson(original.ProductID, validProduct({ ProductName: 'Đổi tên' }))).body.data;
    assert.equal(updated.CreateDate, original.CreateDate);
    assert.ok(Date.parse(updated.UpdateDate) > Date.parse(original.UpdateDate));
  });

  test('bỏ qua ProductID, CreateDate, UpdateDate gửi lên khi sửa', async () => {
    const original = await createProduct(http);
    const res = await putJson(original.ProductID, validProduct({
      ProductID: 123456,
      CreateDate: '2000-01-01T00:00:00.000Z',
      UpdateDate: '2000-01-01T00:00:00.000Z',
    }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.ProductID, original.ProductID);
    assert.equal(res.body.data.CreateDate, original.CreateDate);
    assert.notEqual(res.body.data.UpdateDate, '2000-01-01T00:00:00.000Z');
  });

  test('sửa theo mã SP000xxx', async () => {
    const original = await createProduct(http);
    const res = await putJson(formatProductCode(original.ProductID), validProduct({ ProductName: 'Sửa theo mã' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.ProductName, 'Sửa theo mã');
  });

  test('JSON không có PathImage → giữ ảnh cũ', async () => {
    const original = await createProductWithImage(http);
    const res = await putJson(original.ProductID, validProduct({ ProductName: 'Sửa JSON' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.PathImage, original.PathImage);
  });

  test('multipart không chọn ảnh mới → giữ ảnh cũ (kể cả khi có trường PathImage rỗng)', async () => {
    const original = await createProductWithImage(http);
    const res = await putForm(original.ProductID, { ProductName: 'Sửa biểu mẫu' });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.PathImage, original.PathImage);
    const withEmptyField = await putForm(original.ProductID, { PathImage: '' });
    assert.equal(withEmptyField.body.data.PathImage, original.PathImage);
  });

  test('ảnh mới thay ảnh cũ; file ảnh cũ vẫn còn trên đĩa', async () => {
    const original = await createProductWithImage(http);
    const files = listUploads(app);
    const res = await putForm(original.ProductID, {}, { bytes: JPEG_BYTES, name: 'moi.jpg', type: 'image/jpeg' });
    assert.equal(res.status, 200, res.text);
    assert.match(res.body.data.PathImage, uploadPathPattern('jpg'));
    assert.notEqual(res.body.data.PathImage, original.PathImage);
    assert.ok(fs.existsSync(uploadFilePath(app, original.PathImage)), 'file ảnh cũ phải được giữ');
    assert.ok(fs.existsSync(uploadFilePath(app, res.body.data.PathImage)));
    assert.equal(listUploads(app).length, files.length + 1);
  });

  for (const flag of ['true', '1', 'on', 'TRUE']) {
    test(`removeImage=${flag} (multipart) → bỏ ảnh, file vẫn còn trên đĩa`, async () => {
      const original = await createProductWithImage(http);
      const res = await putForm(original.ProductID, { removeImage: flag });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.PathImage, null);
      assert.ok(fs.existsSync(uploadFilePath(app, original.PathImage)));
    });
  }

  test('removeImage=false (multipart) → giữ ảnh cũ', async () => {
    const original = await createProductWithImage(http);
    const res = await putForm(original.ProductID, { removeImage: 'false' });
    assert.equal(res.body.data.PathImage, original.PathImage);
  });

  test('removeImage: true (JSON) → bỏ ảnh', async () => {
    const original = await createProductWithImage(http);
    const res = await putJson(original.ProductID, validProduct({ removeImage: true }));
    assert.equal(res.body.data.PathImage, null);
  });

  test('ảnh mới được ưu tiên hơn removeImage', async () => {
    const original = await createProductWithImage(http);
    const res = await putForm(original.ProductID, { removeImage: 'true' }, { bytes: WEBP_BYTES, name: 'b.webp', type: 'image/webp' });
    assert.match(res.body.data.PathImage, uploadPathPattern('webp'));
  });

  test('JSON PathImage null → bỏ ảnh; PathImage tới ảnh khác có sẵn → đổi ảnh', async () => {
    const original = await createProductWithImage(http);
    const other = await createProductWithImage(http, {}, { bytes: JPEG_BYTES, name: 'khac.jpg', type: 'image/jpeg' });
    const removed = await putJson(original.ProductID, validProduct({ PathImage: null }));
    assert.equal(removed.body.data.PathImage, null);
    const switched = await putJson(original.ProductID, validProduct({ PathImage: other.PathImage }));
    assert.equal(switched.status, 200);
    assert.equal(switched.body.data.PathImage, other.PathImage);
  });

  test('JSON PathImage tới ảnh không tồn tại → 400, sản phẩm không đổi', async () => {
    const original = await createProductWithImage(http);
    const res = await putJson(original.ProductID, validProduct({ ProductName: 'Không được lưu', PathImage: '/uploads/khong-co.webp' }));
    assertApiError(res, 400, 'VALIDATION_ERROR', { details: [{ field: 'PathImage', message: 'Ảnh không tồn tại trong ứng dụng' }] });
    assert.deepEqual((await http.get(`/api/products/${original.ProductID}`)).body.data, original);
  });

  test('ảnh giả khi sửa → 400, không ghi file, ảnh cũ giữ nguyên', async () => {
    const original = await createProductWithImage(http);
    const files = listUploads(app);
    const res = await putForm(original.ProductID, {}, { bytes: Buffer.from('GIF89a'), name: 'x.png', type: 'image/png' });
    assertApiError(res, 400, 'VALIDATION_ERROR', { fields: ['image'] });
    assert.deepEqual(listUploads(app), files);
    assert.deepEqual((await http.get(`/api/products/${original.ProductID}`)).body.data, original);
  });

  test('cập nhật đầy đủ: thiếu trường bắt buộc → 400 liệt kê trường thiếu, dữ liệu không đổi', async () => {
    const original = await createProduct(http);
    assertApiError(await putJson(original.ProductID, { ProductName: 'Chỉ có tên' }), 400, 'VALIDATION_ERROR', {
      fields: ['ProductType', 'Quantity', 'Unit', 'Price'],
    });
    assert.deepEqual((await http.get(`/api/products/${original.ProductID}`)).body.data, original);
  });

  test('sản phẩm không tồn tại → 404 (kiểm tra trước khi kiểm tra dữ liệu)', async () => {
    assertApiError(await putJson(987654, {}), 404, 'NOT_FOUND', {
      details: [{ id: 987654, message: 'Không tìm thấy sản phẩm SP987654' }],
    });
  });

  test('sản phẩm không tồn tại + ảnh hợp lệ → 404, không ghi file', async () => {
    const files = listUploads(app);
    assertApiError(await putForm(987654, {}, png()), 404, 'NOT_FOUND');
    assert.deepEqual(listUploads(app), files);
  });

  test('ID không hợp lệ → 400 (field id)', async () => {
    assertApiError(await putJson('abc', validProduct()), 400, 'VALIDATION_ERROR', {
      details: [{ field: 'id', message: 'Mã sản phẩm không hợp lệ' }],
    });
  });
});

describe('DELETE /api/products/:id', () => {
  test('xóa → 200 { deleted: 1, ids }, sau đó GET → 404', async () => {
    const product = await createProduct(http);
    const res = await http.delete(`/api/products/${product.ProductID}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      data: { deleted: 1, ids: [product.ProductID] },
      message: `Đã xóa sản phẩm ${formatProductCode(product.ProductID)}`,
    });
    assertApiError(await http.get(`/api/products/${product.ProductID}`), 404, 'NOT_FOUND');
  });

  test('file ảnh được giữ lại sau khi xóa sản phẩm', async () => {
    const product = await createProductWithImage(http);
    assert.equal((await http.delete(`/api/products/${product.ProductID}`)).status, 200);
    assert.ok(fs.existsSync(uploadFilePath(app, product.PathImage)));
  });

  test('xóa theo mã SP000xxx', async () => {
    const product = await createProduct(http);
    const res = await http.delete(`/api/products/${formatProductCode(product.ProductID)}`);
    assert.deepEqual(res.body.data, { deleted: 1, ids: [product.ProductID] });
  });

  test('xóa lần thứ hai → 404 với chi tiết ID', async () => {
    const product = await createProduct(http);
    await http.delete(`/api/products/${product.ProductID}`);
    assertApiError(await http.delete(`/api/products/${product.ProductID}`), 404, 'NOT_FOUND', {
      details: [{ id: product.ProductID, message: `Không tìm thấy sản phẩm ${formatProductCode(product.ProductID)}` }],
    });
  });

  test('ID không hợp lệ → 400 (field id)', async () => {
    assertApiError(await http.delete('/api/products/xyz'), 400, 'VALIDATION_ERROR', { fields: ['id'] });
  });
});

describe('POST /api/products/bulk-delete', () => {
  const bulkDelete = (json) => http.post('/api/products/bulk-delete', { json });

  test('xóa nhiều → 200 { deleted, ids tăng dần }; bỏ trùng; nhận cả mã SP', async () => {
    const a = await createProduct(http);
    const b = await createProduct(http);
    const c = await createProduct(http);
    const before = countProducts(app);
    const res = await bulkDelete({ ids: [c.ProductID, formatProductCode(a.ProductID), a.ProductID, String(b.ProductID)] });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, {
      data: { deleted: 3, ids: [a.ProductID, b.ProductID, c.ProductID] },
      message: 'Đã xóa 3 sản phẩm',
    });
    assert.equal(countProducts(app), before - 3);
    for (const product of [a, b, c]) assertApiError(await http.get(`/api/products/${product.ProductID}`), 404, 'NOT_FOUND');
  });

  test('file ảnh của các sản phẩm bị xóa hàng loạt được giữ lại', async () => {
    const a = await createProductWithImage(http);
    const b = await createProductWithImage(http, {}, { bytes: WEBP_BYTES, name: 'b.webp', type: 'image/webp' });
    assert.equal((await bulkDelete({ ids: [a.ProductID, b.ProductID] })).status, 200);
    assert.ok(fs.existsSync(uploadFilePath(app, a.PathImage)));
    assert.ok(fs.existsSync(uploadFilePath(app, b.PathImage)));
  });

  test('xóa một sản phẩm qua bulk-delete', async () => {
    const a = await createProduct(http);
    const res = await bulkDelete({ ids: [a.ProductID] });
    assert.deepEqual(res.body, { data: { deleted: 1, ids: [a.ProductID] }, message: 'Đã xóa 1 sản phẩm' });
  });

  test('một ID không tồn tại → 404, không xóa sản phẩm nào', async () => {
    const a = await createProduct(http);
    const b = await createProduct(http);
    const before = countProducts(app);
    assertApiError(await bulkDelete({ ids: [a.ProductID, b.ProductID, 888888] }), 404, 'NOT_FOUND', {
      message: 'Không tìm thấy sản phẩm SP888888, chưa xóa sản phẩm nào',
      details: [{ id: 888888, message: 'Không tìm thấy sản phẩm SP888888' }],
    });
    assert.equal(countProducts(app), before);
    assert.equal((await http.get(`/api/products/${a.ProductID}`)).status, 200);
    assert.equal((await http.get(`/api/products/${b.ProductID}`)).status, 200);
  });

  test('nhiều ID không tồn tại → mỗi ID một dòng chi tiết', async () => {
    const a = await createProduct(http);
    assertApiError(await bulkDelete({ ids: [777778, a.ProductID, 777777] }), 404, 'NOT_FOUND', {
      message: 'Không tìm thấy 2 sản phẩm, chưa xóa sản phẩm nào',
      details: [
        { id: 777777, message: 'Không tìm thấy sản phẩm SP777777' },
        { id: 777778, message: 'Không tìm thấy sản phẩm SP777778' },
      ],
    });
  });

  for (const [label, json] of [
    ['mảng rỗng', { ids: [] }],
    ['không phải mảng', { ids: '1,2' }],
    ['phần tử không hợp lệ', { ids: [1, 'abc'] }],
    ['ID bằng 0', { ids: [0] }],
    ['ID thập phân', { ids: [1.5] }],
    ['ID boolean', { ids: [true] }],
    ['ID null', { ids: [null] }],
    ['hơn 1.000 ID', { ids: Array.from({ length: 1001 }, (_, index) => index + 1) }],
    ['thiếu ids', {}],
    ['thân là mảng', [1, 2]],
  ]) {
    test(`ids ${label} → 400 (field ids)`, async () => {
      assertApiError(await bulkDelete(json), 400, 'VALIDATION_ERROR', {
        message: 'Danh sách sản phẩm cần xử lý không hợp lệ',
        details: [{ field: 'ids', message: 'Danh sách sản phẩm cần xử lý không hợp lệ' }],
      });
    });
  }

  test('không có thân yêu cầu → 400', async () => {
    assertApiError(await http.post('/api/products/bulk-delete'), 400, 'VALIDATION_ERROR', { fields: ['ids'] });
  });
});

describe('POST /api/products/bulk-copy', () => {
  const bulkCopy = (json) => http.post('/api/products/bulk-copy', { json });
  const COPIED_FIELDS = ['PathImage', 'ProductType', 'Quantity', 'Unit', 'Price', 'Description'];

  test('sao chép một sản phẩm → 201, tên thêm " (bản sao)", ID và ngày mới, các trường khác giữ nguyên', async () => {
    const original = await createProduct(http, { ProductName: 'Nồi cơm điện', Description: 'Giữ ấm 12 giờ' });
    await sleep(10);
    const startedAt = Date.now();
    const res = await bulkCopy({ ids: [original.ProductID] });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.message, 'Đã sao chép 1 sản phẩm');
    assert.equal(res.body.data.length, 1);
    const [copy] = res.body.data;
    assertProductShape(copy);
    assert.equal(copy.ProductName, 'Nồi cơm điện (bản sao)');
    assert.ok(copy.ProductID > original.ProductID);
    assert.equal(copy.CreateDate, copy.UpdateDate);
    assert.ok(Date.parse(copy.CreateDate) >= startedAt);
    for (const field of COPIED_FIELDS) assert.equal(copy[field], original[field], field);
    assert.deepEqual((await http.get(`/api/products/${copy.ProductID}`)).body.data, copy);
  });

  test('bản gốc không bị thay đổi', async () => {
    const original = await createProduct(http);
    await bulkCopy({ ids: [original.ProductID] });
    assert.deepEqual((await http.get(`/api/products/${original.ProductID}`)).body.data, original);
  });

  test('sao chép nhiều: xử lý theo ProductID tăng dần, ID mới liên tiếp, cùng thời điểm tạo', async () => {
    const a = await createProduct(http, { ProductName: 'Gốc A' });
    const b = await createProduct(http, { ProductName: 'Gốc B' });
    const c = await createProduct(http, { ProductName: 'Gốc C' });
    const res = await bulkCopy({ ids: [c.ProductID, formatProductCode(a.ProductID), b.ProductID, a.ProductID] });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.message, 'Đã sao chép 3 sản phẩm');
    const copies = res.body.data;
    assert.deepEqual(copies.map((copy) => copy.ProductName), ['Gốc A (bản sao)', 'Gốc B (bản sao)', 'Gốc C (bản sao)']);
    assert.ok(copies[0].ProductID > c.ProductID);
    assert.deepEqual(copies.map((copy) => copy.ProductID), [copies[0].ProductID, copies[0].ProductID + 1, copies[0].ProductID + 2]);
    assert.equal(new Set(copies.map((copy) => copy.CreateDate)).size, 1);
    assert.ok(copies.every((copy) => copy.UpdateDate === copy.CreateDate));
  });

  test('bản sao dùng chung PathImage với bản gốc, không tạo file ảnh mới', async () => {
    const original = await createProductWithImage(http);
    const files = listUploads(app);
    const [copy] = (await bulkCopy({ ids: [original.ProductID] })).body.data;
    assert.equal(copy.PathImage, original.PathImage);
    assert.deepEqual(listUploads(app), files);
  });

  test('xóa bản gốc không làm mất ảnh của bản sao', async () => {
    const original = await createProductWithImage(http);
    const [copy] = (await bulkCopy({ ids: [original.ProductID] })).body.data;
    await http.delete(`/api/products/${original.ProductID}`);
    const res = await http.get(copy.PathImage);
    assert.equal(res.status, 200);
    assert.ok(res.buffer.equals(PNG_BYTES));
  });

  test('tên dài 200 ký tự: phần tên gốc được cắt để bản sao vẫn ≤ 200 ký tự', async () => {
    const original = await createProduct(http, { ProductName: 'Ư'.repeat(200) });
    const [copy] = (await bulkCopy({ ids: [original.ProductID] })).body.data;
    assert.equal(copy.ProductName, `${'Ư'.repeat(190)} (bản sao)`);
    assert.equal(copy.ProductName.length, 200);
  });

  test('sao chép bản sao thêm hậu tố lần nữa', async () => {
    const original = await createProduct(http, { ProductName: 'Áo thun' });
    const [copy] = (await bulkCopy({ ids: [original.ProductID] })).body.data;
    const [copyOfCopy] = (await bulkCopy({ ids: [copy.ProductID] })).body.data;
    assert.equal(copyOfCopy.ProductName, 'Áo thun (bản sao) (bản sao)');
  });

  test('có ID không tồn tại → 404, không tạo bản sao nào', async () => {
    const a = await createProduct(http);
    const before = countProducts(app);
    assertApiError(await bulkCopy({ ids: [a.ProductID, 666666, 666667] }), 404, 'NOT_FOUND', {
      message: 'Không tìm thấy 2 sản phẩm, chưa sao chép sản phẩm nào',
      details: [
        { id: 666666, message: 'Không tìm thấy sản phẩm SP666666' },
        { id: 666667, message: 'Không tìm thấy sản phẩm SP666667' },
      ],
    });
    assert.equal(countProducts(app), before);
  });

  test('sao chép một ID không tồn tại → 404', async () => {
    assertApiError(await bulkCopy({ ids: [555555] }), 404, 'NOT_FOUND', { message: 'Không tìm thấy sản phẩm SP555555' });
  });

  test('ids không hợp lệ → 400 (field ids)', async () => {
    for (const json of [{ ids: [] }, { ids: ['SPx'] }, {}]) {
      assertApiError(await bulkCopy(json), 400, 'VALIDATION_ERROR', { fields: ['ids'] });
    }
  });
});

describe('xóa/sao chép tối đa 1.000 sản phẩm', () => {
  test('bulk-copy rồi bulk-delete 1.000 ID trong một yêu cầu', async () => {
    const insert = app.db.prepare(
      `INSERT INTO Products (ProductName, PathImage, ProductType, Quantity, Unit, Price, Description, CreateDate, UpdateDate)
       VALUES (?, NULL, 'Hàng loạt', 1, 'Cái', 1, NULL, ?, ?) RETURNING ProductID`,
    );
    const now = new Date().toISOString();
    const ids = [];
    app.db.exec('BEGIN');
    for (let index = 1; index <= 1000; index += 1) ids.push(insert.get(`Hàng loạt ${index}`, now, now).ProductID);
    app.db.exec('COMMIT');

    const before = countProducts(app);
    const copied = await http.post('/api/products/bulk-copy', { json: { ids } });
    assert.equal(copied.status, 201, copied.text.slice(0, 300));
    assert.equal(copied.body.data.length, 1000);
    assert.equal(countProducts(app), before + 1000);

    const copyIds = copied.body.data.map((copy) => copy.ProductID);
    const deleted = await http.post('/api/products/bulk-delete', { json: { ids: [...ids, ...copyIds].slice(0, 1000) } });
    assert.equal(deleted.status, 200, deleted.text.slice(0, 300));
    assert.equal(deleted.body.data.deleted, 1000);
    assert.equal(countProducts(app), before);
  });
});
