/**
 * Xuất file (export), file mẫu (template) và nhập file (import) cho cả 3 định dạng .xlsx, .json, .xml.
 */
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { IMPORTABLE_FIELDS, PRODUCT_FIELDS, formatNumberVi } from '../shared/productRules.js';
import {
  PNG_BYTES,
  assertApiError,
  allProducts,
  buildXlsx,
  countProducts,
  createClient,
  createProduct,
  createProductWithImage,
  fileForm,
  importRow,
  loadXlsx,
  parseXml,
  qs,
  rowValues,
  useTestApp,
  xmlProducts,
} from './helpers.js';

const app = useTestApp();
const http = createClient(app);

const MB = 1024 * 1024;
const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
};
const FORMATS = ['xlsx', 'json', 'xml'];
const ROUND_TRIP_TYPE = 'Khứ hồi';

/** Sản phẩm có ảnh thật trong uploads (dùng để kiểm tra PathImage khi xuất/nhập). */
let imageProduct;

before(async () => {
  imageProduct = await createProductWithImage(http, { ProductName: 'Sản phẩm có ảnh', ProductType: 'Có ảnh' });
  const roundTrip = [
    {
      ProductName: 'Bánh "Ngọt" & <Kẹo> \'đặc biệt\'',
      Description: 'Dòng 1\nDòng 2 & <b>đậm</b> ]]> hết',
      PathImage: imageProduct.PathImage,
      Quantity: 0,
      Price: 1_000_000_000_000,
    },
    { ProductName: '=SUM(A1:A2) không phải công thức', Description: null, Quantity: 1_000_000_000, Price: 0 },
    { ProductName: 'Điện thoại 😀 ỹ — “ngoặc kép”', Description: '  Mô tả có khoảng trắng  ', Unit: 'Chiếc' },
    { ProductName: '00123', Description: '1e5', Unit: '5' },
  ];
  for (const fixture of roundTrip) await createProduct(http, { ProductType: ROUND_TRIP_TYPE, ...fixture });
  for (let index = 1; index <= 12; index += 1) {
    await createProduct(http, { ProductName: `Hàng xuất file ${index}`, ProductType: 'Xuất file', Description: index % 2 ? null : 'Có mô tả' });
  }
});

const exportFile = (format, q) => http.get(`/api/products/export${qs({ format, q })}`);
const templateFile = (format) => http.get(`/api/products/template${qs({ format })}`);
const importForm = (form) => http.post('/api/products/import', { form });
const importBuffer = (buffer, name, options) => importForm(fileForm(buffer, name, options));
const importJson = (items, name = 'san-pham.json') => importBuffer(Buffer.from(JSON.stringify(items)), name);
const importXml = (text, name = 'san-pham.xml') => importBuffer(Buffer.from(text), name);
const getProduct = async (id) => (await http.get(`/api/products/${id}`)).body.data;
/** Các giá trị người dùng nhập được của một sản phẩm (bỏ ID và ngày). */
const editable = (product) => IMPORTABLE_FIELDS.map((field) => product[field]);
const sortedEditable = (products) => products.map((product) => JSON.stringify(editable(product))).sort();

/** Nhập file thành công và trả về các sản phẩm vừa tạo. */
async function expectImported(res, count) {
  assert.equal(res.status, 201, res.text.slice(0, 800));
  assert.equal(res.body.data.imported, count);
  assert.equal(res.body.message, `Đã nhập ${formatNumberVi(count)} sản phẩm`);
  const { ids } = res.body.data;
  assert.equal(ids.length, count);
  ids.forEach((id, index) => assert.equal(id, ids[0] + index, 'ID mới tăng liên tiếp'));
  const products = [];
  for (const id of ids) products.push(await getProduct(id));
  return products;
}

/** Gửi file nhập và kiểm tra bị từ chối mà không ghi sản phẩm nào. */
async function expectRejected(send, status, code, expected) {
  const before = countProducts(app);
  const res = await send();
  const error = assertApiError(res, status, code, expected);
  assert.equal(countProducts(app), before, 'không được nhập sản phẩm nào');
  return error;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe('GET /api/products/export', () => {
  for (const format of FORMATS) {
    test(`xuất ${format}: Content-Type, Content-Disposition "san-pham-YYYYMMDD-HHmmss.${format}" theo giờ Việt Nam, no-store`, async () => {
      const startedAt = Date.now();
      const res = await exportFile(format);
      const finishedAt = Date.now();
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), CONTENT_TYPES[format]);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const match = /^attachment; filename="san-pham-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.([a-z]+)"$/.exec(
        res.headers.get('content-disposition'),
      );
      assert.ok(match, res.headers.get('content-disposition'));
      assert.equal(match[7], format);
      const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
      const stampUtc = Date.UTC(year, month - 1, day, hour, minute, second) - 7 * 60 * 60 * 1000;
      assert.ok(stampUtc >= Math.floor(startedAt / 1000) * 1000 && stampUtc <= finishedAt, 'giờ trong tên file là giờ Việt Nam (UTC+7)');
    });
  }

  test('xuất JSON: mảng mọi sản phẩm (qua tất cả các trang), đủ 10 trường theo thứ tự, ProductID giảm dần', async () => {
    const res = await exportFile('json');
    const items = JSON.parse(res.text);
    const expected = allProducts(app);
    assert.ok(expected.length > 10, 'dữ liệu phải nhiều hơn một trang');
    assert.deepEqual(items, expected);
    for (const item of items) assert.deepEqual(Object.keys(item), [...PRODUCT_FIELDS]);
    assert.ok(items.some((item) => item.Description === null) && items.some((item) => item.PathImage === null));
    assert.ok(res.text.startsWith('[\n  {\n    "ProductID": '), 'JSON được định dạng dễ đọc');
  });

  test('xuất XML: <Products><Product> đủ 10 thẻ theo thứ tự, mọi sản phẩm, null → phần tử rỗng', async () => {
    const res = await exportFile('xml');
    assert.ok(res.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Products>'), res.text.slice(0, 80));
    const products = parseXml(res.text).Products.Product;
    const expected = allProducts(app);
    assert.equal(products.length, expected.length);
    products.forEach((product, index) => {
      assert.deepEqual(Object.keys(product), [...PRODUCT_FIELDS]);
      const row = expected[index];
      assert.deepEqual(product, Object.fromEntries(PRODUCT_FIELDS.map((field) => [field, row[field] === null ? '' : String(row[field])])));
    });
  });

  test('xuất XML: ký tự đặc biệt được escape', async () => {
    const { text } = await exportFile('xml', 'banh ngot');
    assert.ok(text.includes('&amp;') && text.includes('&lt;Kẹo&gt;'), text);
    assert.ok(!text.includes('<Kẹo>') && !text.includes('<b>đậm'), 'không có thẻ lạ chưa escape');
    assert.equal(parseXml(text).Products.Product[0].ProductName, 'Bánh "Ngọt" & <Kẹo> \'đặc biệt\'');
  });

  test('xuất Excel: sheet Products, dòng 1 = 10 tên trường (in đậm, cố định), mỗi sản phẩm một dòng', async () => {
    const res = await exportFile('xlsx');
    assert.ok(res.buffer.subarray(0, 4).equals(Buffer.from('PK\u0003\u0004')));
    const workbook = await loadXlsx(res.buffer);
    const sheet = workbook.getWorksheet('Products');
    assert.ok(sheet, 'phải có sheet "Products"');
    assert.deepEqual(rowValues(sheet, 1, 11), [...PRODUCT_FIELDS, null]);
    assert.equal(sheet.getRow(1).getCell(1).font?.bold, true);
    assert.equal(sheet.views?.[0]?.state, 'frozen');
    assert.equal(sheet.views[0].ySplit, 1);
    const expected = allProducts(app);
    assert.equal(sheet.actualRowCount, expected.length + 1);
    expected.forEach((product, index) => {
      assert.deepEqual(rowValues(sheet, index + 2, 10), PRODUCT_FIELDS.map((field) => product[field]), `dòng ${index + 2}`);
    });
  });

  test('xuất Excel: số là ô số, ngày là chuỗi ISO, trường trống là ô trống', async () => {
    const products = allProducts(app);
    const index = products.findIndex((product) => product.Description === null && product.PathImage === null);
    assert.ok(index >= 0);
    const sheet = (await loadXlsx((await exportFile('xlsx')).buffer)).getWorksheet('Products');
    const [id, , pathImage, , quantity, , price, description, createDate] = rowValues(sheet, index + 2, 10);
    assert.equal(id, products[index].ProductID);
    assert.equal(typeof id, 'number');
    assert.equal(typeof quantity, 'number');
    assert.equal(typeof price, 'number');
    assert.equal(pathImage, null);
    assert.equal(description, null);
    assert.equal(typeof createDate, 'string');
    assert.match(createDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  for (const format of FORMATS) {
    test(`xuất ${format} theo từ khóa q: chỉ các sản phẩm khớp, qua mọi trang`, async () => {
      const expected = (await http.get(`/api/products${qs({ q: 'khu hoi', pageSize: 15 })}`)).body.data;
      assert.ok(expected.length >= 4);
      const res = await exportFile(format, 'khu hoi');
      let exported;
      if (format === 'json') exported = JSON.parse(res.text);
      else if (format === 'xml') exported = parseXml(res.text).Products.Product;
      else {
        const sheet = (await loadXlsx(res.buffer)).getWorksheet('Products');
        exported = Array.from({ length: sheet.actualRowCount - 1 }, (_, index) =>
          Object.fromEntries(PRODUCT_FIELDS.map((field, column) => [field, rowValues(sheet, index + 2, 10)[column]])));
      }
      assert.deepEqual(exported.map((item) => Number(item.ProductID)), expected.map((product) => product.ProductID));
      assert.ok(exported.every((item) => item.ProductType === ROUND_TRIP_TYPE));
    });
  }

  test('không có kết quả: JSON [] / XML <Products> rỗng / Excel chỉ có dòng tiêu đề', async () => {
    const q = 'khongcosanphamnaokhop';
    assert.deepEqual(JSON.parse((await exportFile('json', q)).text), []);
    const xml = await exportFile('xml', q);
    assert.equal(xml.status, 200);
    assert.equal(parseXml(xml.text).Products, '');
    const sheet = (await loadXlsx((await exportFile('xlsx', q)).buffer)).getWorksheet('Products');
    assert.equal(sheet.actualRowCount, 1);
    assert.deepEqual(rowValues(sheet, 1, 10), [...PRODUCT_FIELDS]);
  });

  test('định dạng không phân biệt hoa/thường ("XLSX")', async () => {
    const res = await http.get('/api/products/export?format=XLSX');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), CONTENT_TYPES.xlsx);
  });

  for (const format of [undefined, '', 'csv', 'pdf', ['json', 'xml']]) {
    test(`format=${JSON.stringify(format)} → 400 (field format)`, async () => {
      assertApiError(await exportFile(format), 400, 'VALIDATION_ERROR', {
        message: 'Định dạng chỉ hỗ trợ xlsx, json hoặc xml',
        details: [{ field: 'format', message: 'Định dạng chỉ hỗ trợ xlsx, json hoặc xml' }],
      });
    });
  }

  test('q không hợp lệ khi xuất → 400 (field q)', async () => {
    assertApiError(await exportFile('json', 'x'.repeat(201)), 400, 'VALIDATION_ERROR', { fields: ['q'] });
    assertApiError(await http.get('/api/products/export?format=json&q=a&q=b'), 400, 'VALIDATION_ERROR', { fields: ['q'] });
  });
});

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

describe('GET /api/products/template', () => {
  /** Hai dòng mẫu đọc từ file mẫu JSON, dùng để so với các định dạng khác. */
  let templateRows;
  before(async () => {
    templateRows = JSON.parse((await templateFile('json')).text);
  });

  test('file mẫu JSON: mảng 2 sản phẩm tiếng Việt, 7 trường nhập được theo thứ tự, PathImage trống', () => {
    assert.equal(templateRows.length, 2);
    for (const row of templateRows) {
      assert.deepEqual(Object.keys(row), [...IMPORTABLE_FIELDS]);
      assert.equal(row.PathImage, '');
      assert.match(row.ProductName, /[ăâđêôơưàáảãạ-ỹ]/i);
      assert.ok(Number.isInteger(row.Quantity) && Number.isInteger(row.Price));
    }
  });

  for (const format of FORMATS) {
    test(`file mẫu ${format}: tên "mau-nhap-san-pham.${format}", đúng Content-Type`, async () => {
      const res = await templateFile(format);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), CONTENT_TYPES[format]);
      assert.equal(res.headers.get('content-disposition'), `attachment; filename="mau-nhap-san-pham.${format}"`);
    });
  }

  test('file mẫu XML: <Products> với 2 <Product>, 7 thẻ theo thứ tự, cùng dữ liệu mẫu', async () => {
    const products = parseXml((await templateFile('xml')).text).Products.Product;
    assert.equal(products.length, 2);
    products.forEach((product, index) => {
      assert.deepEqual(Object.keys(product), [...IMPORTABLE_FIELDS]);
      assert.deepEqual(product, Object.fromEntries(IMPORTABLE_FIELDS.map((field) => [field, String(templateRows[index][field])])));
    });
  });

  test('file mẫu Excel: sheet Products, tiêu đề 7 trường, 2 dòng mẫu, ô PathImage trống', async () => {
    const workbook = await loadXlsx((await templateFile('xlsx')).buffer);
    const sheet = workbook.getWorksheet('Products');
    assert.ok(sheet);
    assert.deepEqual(rowValues(sheet, 1, 8), [...IMPORTABLE_FIELDS, null]);
    assert.equal(sheet.actualRowCount, 3);
    for (const [index, row] of templateRows.entries()) {
      assert.deepEqual(rowValues(sheet, index + 2, 7), IMPORTABLE_FIELDS.map((field) => (row[field] === '' ? null : row[field])));
    }
    const help = workbook.getWorksheet('HuongDan');
    if (help) assert.match(String(help.getCell('A1').value), /Hướng dẫn/);
  });

  for (const format of FORMATS) {
    test(`nhập lại file mẫu ${format} → 201, thêm đúng 2 sản phẩm mẫu`, async () => {
      const template = await templateFile(format);
      const products = await expectImported(await importBuffer(template.buffer, `mau.${format}`), 2);
      products.forEach((product, index) => {
        const row = templateRows[index];
        assert.deepEqual(editable(product), IMPORTABLE_FIELDS.map((field) => (row[field] === '' ? null : row[field])));
      });
    });
  }

  for (const format of [undefined, 'pdf', 'csv']) {
    test(`file mẫu format=${JSON.stringify(format)} → 400 (field format)`, async () => {
      assertApiError(await templateFile(format), 400, 'VALIDATION_ERROR', { fields: ['format'] });
    });
  }
});

// ---------------------------------------------------------------------------
// Import thành công
// ---------------------------------------------------------------------------

describe('POST /api/products/import — nhập thành công', () => {
  const FILE_ROWS = [
    { ProductID: 1, ProductName: 'Nhập thứ nhất', PathImage: '', ProductType: 'Nhập', Quantity: 3, Unit: 'Cái', Price: 1500,
      Description: 'Mô tả 1', CreateDate: '2000-01-01T00:00:00.000Z', UpdateDate: '2000-01-01T00:00:00.000Z' },
    { ProductID: 2, ProductName: 'Nhập thứ hai', PathImage: '', ProductType: 'Nhập', Quantity: 0, Unit: 'Hộp', Price: 0,
      Description: '', CreateDate: '2000-01-01T00:00:00.000Z', UpdateDate: '2000-01-01T00:00:00.000Z' },
  ];

  /** Kiểm tra sản phẩm nhập: giá trị đúng; ID và ngày do server sinh (bỏ qua giá trị trong file). */
  function assertServerGenerated(products, startedAt) {
    const maxExistingId = Math.max(...FILE_ROWS.map((row) => row.ProductID));
    products.forEach((product, index) => {
      const row = FILE_ROWS[index];
      assert.deepEqual(editable(product), [row.ProductName, null, row.ProductType, row.Quantity, row.Unit, row.Price, row.Description || null]);
      assert.ok(product.ProductID > maxExistingId);
      assert.equal(product.CreateDate, product.UpdateDate);
      assert.ok(Date.parse(product.CreateDate) >= startedAt, 'ngày nhập là thời điểm hiện tại');
    });
    assert.equal(products[0].CreateDate, products[1].CreateDate, 'cùng thời điểm cho cả lô');
  }

  test('JSON → 201 { imported, ids }, ID và ngày do server sinh lại', async () => {
    const startedAt = Date.now();
    assertServerGenerated(await expectImported(await importJson(FILE_ROWS), 2), startedAt);
  });

  test('XML → 201, ID và ngày do server sinh lại', async () => {
    const startedAt = Date.now();
    assertServerGenerated(await expectImported(await importXml(xmlProducts(FILE_ROWS)), 2), startedAt);
  });

  test('Excel → 201, ID và ngày do server sinh lại', async () => {
    const startedAt = Date.now();
    const xlsx = await buildXlsx({ Products: [PRODUCT_FIELDS, ...FILE_ROWS.map((row) => PRODUCT_FIELDS.map((field) => row[field]))] });
    assertServerGenerated(await expectImported(await importBuffer(xlsx, 'san-pham.xlsx'), 2), startedAt);
  });

  test('Excel: tên sheet và tiêu đề cột không phân biệt hoa/thường, bỏ khoảng trắng; sheet khác bị bỏ qua', async () => {
    const xlsx = await buildXlsx({
      'Ghi chú': [['ProductName'], ['không được đọc']],
      ' PRODUCTS ': [
        IMPORTABLE_FIELDS.map((field, index) => (index % 2 ? ` ${field.toUpperCase()} ` : field.toLowerCase())),
        importRow({ ProductName: 'Tiêu đề hoa thường' }),
      ],
    });
    const [product] = await expectImported(await importBuffer(xlsx, 'HOA-THUONG.XLSX'), 1);
    assert.equal(product.ProductName, 'Tiêu đề hoa thường');
  });

  test('JSON: khóa không phân biệt hoa/thường, bỏ khoảng trắng; BOM UTF-8 được chấp nhận', async () => {
    const items = [{ ' PRODUCTNAME ': 'Khóa hoa thường', producttype: 'Loại', QuAnTiTy: '4', unit: 'Cái', PRICE: 10, description: null, productid: 5 }];
    const res = await importBuffer(Buffer.from(`\uFEFF${JSON.stringify(items)}`), 'bom.json');
    const [product] = await expectImported(res, 1);
    assert.deepEqual(editable(product), ['Khóa hoa thường', null, 'Loại', 4, 'Cái', 10, null]);
  });

  test('XML: thẻ không phân biệt hoa/thường; BOM; tham chiếu ký tự số và CDATA được giải mã', async () => {
    const xml = '\uFEFF<?xml version="1.0" encoding="UTF-8"?><Products><Product>'
      + '<productname>&#272;i&#7879;n tho&#x1ea1;i &amp; ph&#7909; ki&#7879;n &lt;3&gt;</productname>'
      + '<PRODUCTTYPE> Điện thoại </PRODUCTTYPE><QUANTITY>2</QUANTITY><Unit>Chiếc</Unit><price> 100 </price>'
      + '<Description><![CDATA[<b>CDATA</b> & thô]]></Description><ProductID>5</ProductID><CreateDate>x</CreateDate>'
      + '</Product></Products>';
    const [product] = await expectImported(await importXml(xml), 1);
    assert.deepEqual(editable(product), ['Điện thoại & phụ kiện <3>', null, 'Điện thoại', 2, 'Chiếc', 100, '<b>CDATA</b> & thô']);
  });

  test('XML: phần tử rỗng (<Description/>) là giá trị trống', async () => {
    const xml = '<Products><Product><ProductName>Rỗng</ProductName><PathImage/><ProductType>Loại</ProductType>'
      + '<Quantity>1</Quantity><Unit>Cái</Unit><Price>1</Price><Description/></Product></Products>';
    const [product] = await expectImported(await importXml(xml), 1);
    assert.equal(product.Description, null);
    assert.equal(product.PathImage, null);
  });

  for (const format of FORMATS) {
    test(`PathImage trong file ${format} tham chiếu ảnh đã có trong ứng dụng → được giữ`, async () => {
      const row = { ProductName: `Ảnh từ ${format}`, PathImage: imageProduct.PathImage.slice(1), ProductType: 'Loại', Quantity: 1, Unit: 'Cái', Price: 1 };
      let res;
      if (format === 'json') res = await importJson([row]);
      else if (format === 'xml') res = await importXml(xmlProducts([row]));
      else res = await importBuffer(await buildXlsx({ Products: [IMPORTABLE_FIELDS, importRow(row)] }), 'anh.xlsx');
      const [product] = await expectImported(res, 1);
      assert.equal(product.PathImage, imageProduct.PathImage);
    });
  }

  test('Excel: dòng trống (kể cả dòng chỉ có khoảng trắng) được bỏ qua', async () => {
    const xlsx = await buildXlsx({
      Products: [IMPORTABLE_FIELDS, importRow({ ProductName: 'Dòng 2' }), null, importRow({ ProductName: 'Dòng 4' }), ['  ', null, ' '], importRow({ ProductName: 'Dòng 6' })],
    });
    const products = await expectImported(await importBuffer(xlsx, 'dong-trong.xlsx'), 3);
    assert.deepEqual(products.map((product) => product.ProductName), ['Dòng 2', 'Dòng 4', 'Dòng 6']);
  });

  test('Excel: rich text, hyperlink, số dạng chữ; ô ngày trong cột bị bỏ qua (CreateDate) không gây lỗi', async () => {
    const xlsx = await buildXlsx({
      Products: [
        [...IMPORTABLE_FIELDS, 'CreateDate'],
        importRow({
          ProductName: { richText: [{ text: 'Bánh ' }, { font: { bold: true }, text: 'mì' }] },
          Description: { text: 'Xem chi tiết', hyperlink: 'https://example.com' },
          Quantity: ' 12 ',
          Price: '3000',
        }).concat([new Date('2026-01-01T00:00:00Z')]),
      ],
    });
    const [product] = await expectImported(await importBuffer(xlsx, 'kieu-o.xlsx'), 1);
    assert.deepEqual(editable(product), ['Bánh mì', null, 'Thực phẩm', 12, 'Kg', 3000, 'Xem chi tiết']);
  });

  test('nhập chỉ thêm mới: sản phẩm có sẵn trùng ProductID không bị sửa', async () => {
    const existing = await createProduct(http, { ProductName: 'Đã có sẵn' });
    const res = await importJson([{ ...existing, ProductName: 'Không được ghi đè', Price: 1 }]);
    const [imported] = await expectImported(res, 1);
    assert.notEqual(imported.ProductID, existing.ProductID);
    assert.deepEqual(await getProduct(existing.ProductID), existing);
  });
});

// ---------------------------------------------------------------------------
// Xuất rồi nhập lại (round trip)
// ---------------------------------------------------------------------------

describe('xuất rồi nhập lại', () => {
  for (const format of FORMATS) {
    test(`${format}: dữ liệu giữ nguyên (ký tự đặc biệt, tiếng Việt, xuống dòng, null, ảnh, số lớn), ID và ngày mới`, async () => {
      const originals = (await http.get(`/api/products${qs({ q: 'khu hoi', pageSize: 15 })}`)).body.data;
      assert.equal(originals.length, 4);
      const startedAt = Date.now();
      const exported = await exportFile(format, 'khu hoi');
      const imported = await expectImported(await importBuffer(exported.buffer, `khu-hoi.${format}`), originals.length);
      assert.deepEqual(sortedEditable(imported), sortedEditable(originals));
      const maxOriginalId = Math.max(...originals.map((product) => product.ProductID));
      for (const product of imported) {
        assert.ok(product.ProductID > maxOriginalId);
        assert.equal(product.CreateDate, product.UpdateDate);
        assert.ok(Date.parse(product.CreateDate) >= startedAt);
      }
      // Dọn bản nhập để lần xuất theo q tiếp theo chỉ có 4 bản gốc.
      const cleanup = await http.post('/api/products/bulk-delete', { json: { ids: imported.map((product) => product.ProductID) } });
      assert.equal(cleanup.status, 200);
    });
  }

  for (const format of FORMATS) {
    test(`${format}: xuất toàn bộ (mọi trang) rồi nhập lại → số sản phẩm tăng gấp đôi, dữ liệu giống hệt`, async () => {
      const before = allProducts(app);
      assert.ok(before.length > 10);
      const exported = await exportFile(format);
      const imported = await expectImported(await importBuffer(exported.buffer, `tat-ca.${format}`), before.length);
      assert.deepEqual(sortedEditable(imported), sortedEditable(before));
      assert.equal(countProducts(app), before.length * 2);
    });
  }
});

// ---------------------------------------------------------------------------
// Import bị từ chối: không ghi gì
// ---------------------------------------------------------------------------

describe('POST /api/products/import — lỗi file', () => {
  test('không có file → 400 FILE_ERROR', async () => {
    const error = await expectRejected(() => importForm(new FormData()), 400, 'FILE_ERROR', {
      message: 'Vui lòng chọn file cần nhập (.xlsx, .json hoặc .xml)',
      details: [{ field: 'file', message: 'Vui lòng chọn file cần nhập (.xlsx, .json hoặc .xml)' }],
    });
    assert.equal('format' in error, false);
  });

  test('gửi JSON thay vì multipart → 400 FILE_ERROR', async () => {
    await expectRejected(() => http.post('/api/products/import', { json: [{ ProductName: 'x' }] }), 400, 'FILE_ERROR');
  });

  for (const name of ['san-pham.csv', 'san-pham.xls', 'san-pham.txt', 'san-pham']) {
    test(`file "${name}" → 400 FILE_ERROR (chỉ nhận .xlsx, .json, .xml)`, async () => {
      await expectRejected(() => importBuffer(Buffer.from('ProductName\nA'), name, { type: 'text/csv' }), 400, 'FILE_ERROR', {
        message: 'Chỉ hỗ trợ file .xlsx, .json hoặc .xml',
        details: [{ field: 'file', message: 'Chỉ hỗ trợ file .xlsx, .json hoặc .xml' }],
      });
    });
  }

  test('file gửi ở trường khác "file" → 400 FILE_ERROR', async () => {
    await expectRejected(() => importForm(fileForm(Buffer.from('[]'), 'a.json', { field: 'upload' })), 400, 'FILE_ERROR', {
      fields: ['file'],
    });
  });

  test('gửi hai file → 400 FILE_ERROR', async () => {
    const form = fileForm(Buffer.from(JSON.stringify([{ ProductName: 'a' }])), 'a.json');
    form.append('file', new Blob(['[]']), 'b.json');
    await expectRejected(() => importForm(form), 400, 'FILE_ERROR', { fields: ['file'] });
  });

  test('file rỗng → 400 FILE_ERROR "File nhập rỗng"', async () => {
    await expectRejected(() => importBuffer(Buffer.alloc(0), 'rong.json'), 400, 'FILE_ERROR', { message: 'File nhập rỗng' });
  });

  test('file lớn hơn 10 MB → 413 FILE_TOO_LARGE (field file)', async () => {
    await expectRejected(() => importBuffer(Buffer.alloc(10 * MB + 1, 0x20), 'lon.json'), 413, 'FILE_TOO_LARGE', {
      message: 'File nhập vượt quá dung lượng tối đa 10 MB',
      details: [{ field: 'file', message: 'File nhập vượt quá dung lượng tối đa 10 MB' }],
    });
  });

  test('file đúng 10 MB không bị chặn bởi giới hạn dung lượng (được đọc nội dung)', async () => {
    await expectRejected(() => importBuffer(Buffer.alloc(10 * MB, 0x20), 'vua-du.json'), 400, 'FILE_ERROR', {
      message: /^File JSON không hợp lệ: /,
    });
  });

  for (const [format, send] of [
    ['json', () => importJson([])],
    ['xml (<Products/>)', () => importXml('<?xml version="1.0"?><Products/>')],
    ['xml (<Products></Products>)', () => importXml('<Products>   </Products>')],
    ['xlsx (chỉ có tiêu đề)', async () => importBuffer(await buildXlsx({ Products: [IMPORTABLE_FIELDS] }), 'a.xlsx')],
  ]) {
    test(`${format} không có sản phẩm nào → 400 FILE_ERROR`, async () => {
      await expectRejected(send, 400, 'FILE_ERROR', { message: 'File không có sản phẩm nào' });
    });
  }

  for (const [label, buffer, name, message] of [
    ['nội dung JSON đặt tên .xlsx', Buffer.from('[{"ProductName":"a"}]'), 'a.xlsx', /^File Excel không hợp lệ/],
    ['ảnh PNG đặt tên .xlsx', PNG_BYTES, 'anh.xlsx', /^File Excel không hợp lệ/],
    ['nội dung XML đặt tên .json', Buffer.from('<Products><Product/></Products>'), 'a.json', /^File JSON không hợp lệ: /],
    ['nội dung JSON đặt tên .xml', Buffer.from('[{"ProductName":"a"}]'), 'a.xml', /^File XML không hợp lệ/],
    ['ZIP hỏng đặt tên .xlsx', Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(100)]), 'hong.xlsx', /Excel/],
  ]) {
    test(`nội dung không khớp đuôi file: ${label} → 400 FILE_ERROR`, async () => {
      await expectRejected(() => importBuffer(buffer, name), 400, 'FILE_ERROR', { message });
    });
  }

  for (const target of ['json', 'xml']) {
    test(`file Excel thật đặt tên .${target} → 400 FILE_ERROR`, async () => {
      const xlsx = await buildXlsx({ Products: [IMPORTABLE_FIELDS, importRow()] });
      await expectRejected(() => importBuffer(xlsx, `that-ra-la-excel.${target}`), 400, 'FILE_ERROR');
    });
  }

  test('Excel khai báo dung lượng giải nén quá lớn (zip bomb) → 400 FILE_ERROR', async () => {
    const bomb = await buildXlsx({ Products: [IMPORTABLE_FIELDS, importRow()] });
    const eocd = bomb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const centralDirectory = bomb.readUInt32LE(eocd + 16);
    bomb.writeUInt32LE(60 * MB, centralDirectory + 24);
    await expectRejected(() => importBuffer(bomb, 'bomb.xlsx'), 400, 'FILE_ERROR', { message: /quá lớn/ });
  });
});

describe('POST /api/products/import — XML bị từ chối', () => {
  const DTD_MESSAGE = 'File XML chứa DTD/ENTITY, không được phép nhập';
  const PRODUCT = '<Product><ProductName>a</ProductName><ProductType>b</ProductType><Quantity>1</Quantity><Unit>c</Unit><Price>1</Price></Product>';

  for (const [label, xml] of [
    ['<!DOCTYPE>', `<?xml version="1.0"?><!DOCTYPE Products [<!ELEMENT Products ANY>]><Products>${PRODUCT}</Products>`],
    ['<!ENTITY> (XXE đọc file hệ thống)',
      `<?xml version="1.0"?><!DOCTYPE Products [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]><Products><Product><ProductName>&xxe;</ProductName></Product></Products>`],
    ['<!ENTITY> không kèm DOCTYPE', `<!ENTITY a "b"><Products>${PRODUCT}</Products>`],
    ['"billion laughs"', '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><Products><Product><ProductName>&lol2;</ProductName></Product></Products>'],
    ['<!doctype> chữ thường', `<!doctype Products><Products>${PRODUCT}</Products>`],
  ]) {
    test(`XML có ${label} → 400 FILE_ERROR`, async () => {
      await expectRejected(() => importXml(xml), 400, 'FILE_ERROR', { message: DTD_MESSAGE });
    });
  }

  for (const [label, reference, namedInMessage] of [
    ['thực thể HTML chưa khai báo', '&nbsp;', true],
    ['thực thể viết hoa (XML phân biệt hoa/thường)', '&AMP;', true],
    ['mã ký tự không hợp lệ trong XML', '&#0;', true],
    ['mã ký tự quá giới hạn Unicode', '&#x110000;', true],
    ['mã ký tự thập lục phân viết "X" hoa', '&#X41;', false],
  ]) {
    test(`XML có ${label} (${reference}) → 400 FILE_ERROR chỉ rõ dòng, không nhập nguyên văn`, async () => {
      const xml = `<Products>\n  <Product>\n    <ProductName>Áo${reference}thun</ProductName><ProductType>b</ProductType><Quantity>1</Quantity><Unit>c</Unit><Price>1</Price>\n  </Product>\n</Products>`;
      const escaped = reference.replace(/[#&;]/g, '\\$&');
      await expectRejected(() => importXml(xml), 400, 'FILE_ERROR', {
        message: new RegExp(`^File XML không hợp lệ \\(dòng 3\\): ${namedInMessage ? `.*${escaped}` : ''}`),
      });
    });
  }

  test('"&nbsp;" nằm trong CDATA là văn bản thường → vẫn nhập được', async () => {
    const xml = `<Products><Product><ProductName><![CDATA[Áo &nbsp; thun]]></ProductName><ProductType>b</ProductType><Quantity>1</Quantity><Unit>c</Unit><Price>1</Price></Product></Products>`;
    const [product] = await expectImported(await importXml(xml), 1);
    assert.equal(product.ProductName, 'Áo &nbsp; thun');
  });

  test('XML sai cú pháp → 400 FILE_ERROR có số dòng', async () => {
    await expectRejected(() => importXml('<Products>\n<Product><ProductName>a</Product>\n</Products>'), 400, 'FILE_ERROR', {
      message: /^File XML không hợp lệ \(dòng \d+\): /,
    });
  });

  for (const [label, xml, message] of [
    ['phần tử gốc không phải <Products>', `<Items>${PRODUCT}</Items>`, 'File XML phải có đúng một phần tử gốc <Products>'],
    ['hai phần tử gốc', `<Products>${PRODUCT}</Products><Products>${PRODUCT}</Products>`, undefined],
    ['<Products> chứa phần tử khác <Product>', `<Products>${PRODUCT}<Other/></Products>`, 'Phần tử <Products> chỉ được chứa các phần tử <Product>'],
    ['<Products> chứa văn bản', '<Products>abc</Products>', 'Phần tử <Products> chỉ được chứa các phần tử <Product>'],
  ]) {
    test(`XML ${label} → 400 FILE_ERROR`, async () => {
      await expectRejected(() => importXml(xml), 400, 'FILE_ERROR', message === undefined ? {} : { message });
    });
  }

  test('XML không phải UTF-8 → 400 FILE_ERROR', async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`<Products>${PRODUCT}</Products>`, 'utf16le')]);
    await expectRejected(() => importBuffer(utf16, 'utf16.xml'), 400, 'FILE_ERROR', { message: 'File XML phải là văn bản mã hóa UTF-8' });
  });

  test('lỗi theo từng <Product> (số thứ tự từ 1) và từng trường; không nhập sản phẩm nào', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Products>
  ${PRODUCT}
  <Product><ProductName>Lặp</ProductName><ProductType>Loại</ProductType><Quantity>1</Quantity><Unit>Cái</Unit><Price>1</Price><Price>2</Price></Product>
  <Product><ProductName>Lạ</ProductName><Foo>x</Foo><ProductType><b>lồng</b></ProductType><Quantity>1</Quantity><Unit>Cái</Unit><Price>1</Price></Product>
  <Product><ProductName>Sai số</ProductName><ProductType>Loại</ProductType><Quantity>-3</Quantity><Unit>Cái</Unit><Price>1.5</Price><PathImage>/uploads/khong-co.png</PathImage></Product>
  <Product/>
  <Product>chữ</Product>
</Products>`;
    const details = [
      { row: 2, field: 'Price', message: 'Trường bị lặp' },
      { row: 3, field: 'ProductType', message: 'Giá trị không hợp lệ' },
      { row: 3, field: 'Foo', message: 'Trường không hợp lệ' },
      { row: 4, field: 'PathImage', message: 'Ảnh không tồn tại trong ứng dụng' },
      { row: 4, field: 'Quantity', message: 'Số lượng phải là số nguyên không âm' },
      { row: 4, field: 'Price', message: 'Giá phải là số nguyên không âm' },
      { row: 5, field: 'ProductName', message: 'Tên sản phẩm là bắt buộc' },
      { row: 5, field: 'ProductType', message: 'Loại sản phẩm là bắt buộc' },
      { row: 5, field: 'Quantity', message: 'Số lượng là bắt buộc' },
      { row: 5, field: 'Unit', message: 'Đơn vị tính là bắt buộc' },
      { row: 5, field: 'Price', message: 'Giá là bắt buộc' },
      { row: 6, field: null, message: 'Phần tử <Product> phải chứa các trường sản phẩm' },
    ];
    const error = await expectRejected(() => importXml(xml), 400, 'IMPORT_VALIDATION_ERROR', {
      message: `File có ${details.length} lỗi, chưa nhập sản phẩm nào`,
      details,
    });
    assert.equal(error.format, 'xml');
  });

  test('thẻ không thuộc 10 trường → lỗi tại dòng đó (không phải lỗi file)', async () => {
    const xml = `<Products>${PRODUCT}<Product><ProductName>a</ProductName><ProductType>b</ProductType><Quantity>1</Quantity><Unit>c</Unit><Price>1</Price><MauSac>Đỏ</MauSac></Product></Products>`;
    await expectRejected(() => importXml(xml), 400, 'IMPORT_VALIDATION_ERROR', {
      details: [{ row: 2, field: 'MauSac', message: 'Trường không hợp lệ' }],
    });
  });
});

describe('POST /api/products/import — JSON bị từ chối', () => {
  test('JSON sai cú pháp → 400 FILE_ERROR', async () => {
    await expectRejected(() => importBuffer(Buffer.from('[{"ProductName": }]'), 'a.json'), 400, 'FILE_ERROR', {
      message: /^File JSON không hợp lệ: /,
    });
  });

  for (const content of ['{"ProductName":"a"}', 'null', '"chuoi"', '42']) {
    test(`JSON không phải mảng (${content}) → 400 FILE_ERROR`, async () => {
      await expectRejected(() => importBuffer(Buffer.from(content), 'a.json'), 400, 'FILE_ERROR', {
        message: 'File JSON phải là một mảng sản phẩm',
      });
    });
  }

  test('JSON không phải UTF-8 → 400 FILE_ERROR', async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('[{"ProductName":"á"}]', 'utf16le')]);
    await expectRejected(() => importBuffer(utf16, 'utf16.json'), 400, 'FILE_ERROR', { message: 'File JSON phải là văn bản mã hóa UTF-8' });
  });

  test('lỗi theo từng phần tử (số thứ tự từ 1) và từng trường; không nhập sản phẩm nào', async () => {
    const items = [
      { ProductName: 'Hợp lệ', ProductType: 'Loại', Quantity: 1, Unit: 'Cái', Price: 10 },
      { ProductName: 'Giá âm', ProductType: 'Loại', Quantity: 1, Unit: 'Cái', Price: -1 },
      5,
      { ProductName: 'Lạ', Foo: 1, ProductType: 'Loại', Quantity: true, Unit: ['x'], Price: '12', productname: 'trùng' },
      { ProductName: 'Ảnh thiếu', ProductType: 'Loại', Quantity: '7', Unit: 'Cái', Price: 1, PathImage: 'uploads/khong-co.png' },
      null,
    ];
    const details = [
      { row: 2, field: 'Price', message: 'Giá phải là số nguyên không âm' },
      { row: 3, field: null, message: 'Phần tử phải là một đối tượng sản phẩm' },
      { row: 4, field: 'ProductName', message: 'Trường bị lặp' },
      { row: 4, field: 'Quantity', message: 'Giá trị phải là chuỗi, số hoặc null' },
      { row: 4, field: 'Unit', message: 'Giá trị phải là chuỗi, số hoặc null' },
      { row: 4, field: 'Foo', message: 'Trường không hợp lệ' },
      { row: 5, field: 'PathImage', message: 'Ảnh không tồn tại trong ứng dụng' },
      { row: 6, field: null, message: 'Phần tử phải là một đối tượng sản phẩm' },
    ];
    const error = await expectRejected(() => importJson(items), 400, 'IMPORT_VALIDATION_ERROR', {
      message: `File có ${details.length} lỗi, chưa nhập sản phẩm nào`,
      details,
    });
    assert.equal(error.format, 'json');
  });

  test('khóa không thuộc 10 trường → lỗi tại phần tử đó (không phải lỗi file)', async () => {
    const items = [
      { ProductName: 'a', ProductType: 'b', Quantity: 1, Unit: 'c', Price: 1 },
      { ProductName: 'a', ProductType: 'b', Quantity: 1, Unit: 'c', Price: 1, MauSac: 'Đỏ' },
    ];
    await expectRejected(() => importJson(items), 400, 'IMPORT_VALIDATION_ERROR', {
      details: [{ row: 2, field: 'MauSac', message: 'Trường không hợp lệ' }],
    });
  });
});

describe('POST /api/products/import — Excel bị từ chối', () => {
  const importXlsx = async (sheets) => importBuffer(await buildXlsx(sheets), 'san-pham.xlsx');

  test('ô chứa công thức → 400 IMPORT_VALIDATION_ERROR chỉ rõ dòng, trường và ô', async () => {
    const error = await expectRejected(
      () => importXlsx({ Products: [IMPORTABLE_FIELDS, importRow({ Quantity: { formula: 'A1*2' } }), importRow()] }),
      400,
      'IMPORT_VALIDATION_ERROR',
      {
        message: 'File có 1 lỗi, chưa nhập sản phẩm nào',
        details: [{ row: 2, field: 'Quantity', message: 'Ô D2 chứa công thức; chỉ chấp nhận giá trị nhập trực tiếp' }],
      },
    );
    assert.equal(error.format, 'xlsx');
  });

  test('công thức có sẵn kết quả (trông như giá trị thường) vẫn bị từ chối', async () => {
    await expectRejected(
      () => importXlsx({ Products: [IMPORTABLE_FIELDS, importRow({ Price: { formula: 'D2*1000', result: 10000 } })] }),
      400,
      'IMPORT_VALIDATION_ERROR',
      { details: [{ row: 2, field: 'Price', message: 'Ô F2 chứa công thức; chỉ chấp nhận giá trị nhập trực tiếp' }] },
    );
  });

  test('công thức dùng chung (shared formula) → lỗi ở từng ô', async () => {
    const rows = [
      IMPORTABLE_FIELDS,
      importRow({ Price: { formula: 'D2*2', result: 20, shareType: 'shared', ref: 'F2:F3' } }),
      importRow({ Price: { sharedFormula: 'F2', result: 20 } }),
    ];
    await expectRejected(() => importXlsx({ Products: rows }), 400, 'IMPORT_VALIDATION_ERROR', {
      details: [
        { row: 2, field: 'Price', message: 'Ô F2 chứa công thức; chỉ chấp nhận giá trị nhập trực tiếp' },
        { row: 3, field: 'Price', message: 'Ô F3 chứa công thức; chỉ chấp nhận giá trị nhập trực tiếp' },
      ],
    });
  });

  test('công thức ở dòng tiêu đề → lỗi dòng 1', async () => {
    const header = [{ formula: '"Product"&"Name"', result: 'ProductName' }, ...IMPORTABLE_FIELDS.slice(1)];
    await expectRejected(() => importXlsx({ Products: [header, importRow()] }), 400, 'IMPORT_VALIDATION_ERROR', {
      details: [{ row: 1, field: null, message: 'Ô A1 chứa công thức; chỉ chấp nhận giá trị nhập trực tiếp' }],
    });
  });

  test('công thức trong cột bị bỏ qua (ProductID) vẫn bị từ chối', async () => {
    await expectRejected(
      () => importXlsx({ Products: [[...IMPORTABLE_FIELDS, 'ProductID'], [...importRow(), { formula: 'ROW()' }]] }),
      400,
      'IMPORT_VALIDATION_ERROR',
      { details: [{ row: 2, field: 'ProductID', message: 'Ô H2 chứa công thức; chỉ chấp nhận giá trị nhập trực tiếp' }] },
    );
  });

  test('không có sheet "Products" → 400 FILE_ERROR', async () => {
    await expectRejected(() => importXlsx({ SanPham: [IMPORTABLE_FIELDS, importRow()] }), 400, 'FILE_ERROR', {
      message: 'Không tìm thấy sheet "Products" trong file Excel',
    });
  });

  test('thiếu cột bắt buộc → 400 FILE_ERROR liệt kê các cột thiếu', async () => {
    const header = IMPORTABLE_FIELDS.filter((field) => field !== 'Unit' && field !== 'Price');
    const error = await expectRejected(() => importXlsx({ Products: [header, ['a', null, 'b', 1, 'c']] }), 400, 'FILE_ERROR', {
      message: /thiếu cột bắt buộc Unit, Price/,
    });
    assert.deepEqual(error.details, [
      { field: 'Unit', message: 'Thiếu cột bắt buộc' },
      { field: 'Price', message: 'Thiếu cột bắt buộc' },
    ]);
  });

  test('cột không thuộc 10 trường → 400 FILE_ERROR', async () => {
    const error = await expectRejected(
      () => importXlsx({ Products: [[...IMPORTABLE_FIELDS, 'MauSac'], [...importRow(), 'Đỏ']] }),
      400,
      'FILE_ERROR',
      { message: /cột không hợp lệ MauSac/ },
    );
    assert.deepEqual(error.details, [{ field: 'MauSac', message: 'Cột không hợp lệ' }]);
  });

  test('cột bị trùng (không phân biệt hoa/thường) → 400 FILE_ERROR', async () => {
    await expectRejected(
      () => importXlsx({ Products: [[...IMPORTABLE_FIELDS, 'productname'], [...importRow(), 'x']] }),
      400,
      'FILE_ERROR',
      { message: /cột bị trùng productname/ },
    );
  });

  test('dữ liệu nằm dưới ô tiêu đề trống → 400 FILE_ERROR', async () => {
    await expectRejected(
      () => importXlsx({ Products: [[...IMPORTABLE_FIELDS, null], [...importRow(), 'dữ liệu mồ côi']] }),
      400,
      'FILE_ERROR',
      { message: 'Cột H có dữ liệu nhưng không có tiêu đề ở dòng 1' },
    );
  });

  test('dòng 1 trống (không có tiêu đề) → 400 FILE_ERROR', async () => {
    await expectRejected(() => importXlsx({ Products: [null, importRow()] }), 400, 'FILE_ERROR', {
      message: 'Sheet "Products" chưa có dòng tiêu đề: dòng 1 phải chứa tên các trường',
    });
  });

  test('lỗi theo số dòng thật của sheet (tính cả dòng trống bị bỏ qua) và từng trường', async () => {
    const rows = [
      IMPORTABLE_FIELDS, // dòng 1
      importRow({ ProductName: 'Dòng 2 hợp lệ' }),
      importRow({ ProductName: 'Dòng 3 giá âm', Price: -5 }),
      null, // dòng 4 trống
      importRow({ ProductName: null, Quantity: 'abc' }),
      ['   ', null, '  '], // dòng 6 chỉ có khoảng trắng
      importRow({ ProductName: 'Dòng 7 sai kiểu ô', Price: new Date('2026-01-01T00:00:00Z'), Unit: true }),
      importRow({ ProductName: 'Dòng 8 ảnh thiếu', PathImage: '/uploads/khong-co.png' }),
    ];
    const details = [
      { row: 3, field: 'Price', message: 'Giá phải là số nguyên không âm' },
      { row: 5, field: 'ProductName', message: 'Tên sản phẩm là bắt buộc' },
      { row: 5, field: 'Quantity', message: 'Số lượng phải là số nguyên không âm' },
      { row: 7, field: 'Unit', message: 'Kiểu dữ liệu của ô E7 không được hỗ trợ' },
      { row: 7, field: 'Price', message: 'Kiểu dữ liệu của ô F7 không được hỗ trợ' },
      { row: 8, field: 'PathImage', message: 'Ảnh không tồn tại trong ứng dụng' },
    ];
    const error = await expectRejected(() => importXlsx({ Products: rows }), 400, 'IMPORT_VALIDATION_ERROR', {
      message: `File có ${details.length} lỗi, chưa nhập sản phẩm nào`,
      details,
    });
    assert.equal(error.format, 'xlsx');
  });
});

describe('POST /api/products/import — PathImage tới ảnh không tồn tại', () => {
  const row = { ProductName: 'Ảnh không có', PathImage: '/uploads/00000000-0000-0000-0000-000000000000.png', ProductType: 'Loại', Quantity: 1, Unit: 'Cái', Price: 1 };
  for (const [format, send, rowNumber] of [
    ['json', () => importJson([row]), 1],
    ['xml', () => importXml(xmlProducts([row])), 1],
    ['xlsx', async () => importBuffer(await buildXlsx({ Products: [IMPORTABLE_FIELDS, importRow(row)] }), 'a.xlsx'), 2],
  ]) {
    test(`${format} → 400 IMPORT_VALIDATION_ERROR tại dòng ${rowNumber}, field PathImage`, async () => {
      const error = await expectRejected(send, 400, 'IMPORT_VALIDATION_ERROR', {
        details: [{ row: rowNumber, field: 'PathImage', message: 'Ảnh không tồn tại trong ứng dụng' }],
      });
      assert.equal(error.format, format);
    });
  }

  test('PathImage dạng URL ngoài hoặc thoát thư mục → lỗi tại dòng đó', async () => {
    const items = ['http://evil.example/a.png', '../package.json'].map((PathImage) => ({ ...row, PathImage }));
    await expectRejected(() => importJson(items), 400, 'IMPORT_VALIDATION_ERROR', {
      details: [1, 2].map((rowNumber) => ({
        row: rowNumber,
        field: 'PathImage',
        message: 'Đường dẫn ảnh chỉ được tham chiếu ảnh đã có trong ứng dụng, dạng /uploads/ten-file.png',
      })),
    });
  });
});

// ---------------------------------------------------------------------------
// Giới hạn 1.000 sản phẩm (ứng dụng riêng để không ảnh hưởng dữ liệu ở trên)
// ---------------------------------------------------------------------------

describe('giới hạn 1.000 sản phẩm mỗi file', () => {
  const own = useTestApp();
  const ownHttp = createClient(own);
  const many = (count) => Array.from({ length: count }, (_, index) => ({
    ProductName: `Hàng loạt ${index + 1}`,
    ProductType: 'Loại',
    Quantity: index,
    Unit: 'Cái',
    Price: index * 10,
  }));
  const files = {
    json: async (count) => Buffer.from(JSON.stringify(many(count))),
    xml: async (count) => Buffer.from(xmlProducts(many(count))),
    xlsx: async (count) => buildXlsx({ Products: [IMPORTABLE_FIELDS, ...many(count).map((item) => importRow(item))] }),
  };
  const send = async (format, count) => ownHttp.post('/api/products/import', { form: fileForm(await files[format](count), `nhieu.${format}`) });

  for (const format of FORMATS) {
    test(`${format}: 1.001 sản phẩm → 400 FILE_ERROR, không nhập gì`, async () => {
      const before = countProducts(own);
      assertApiError(await send(format, 1001), 400, 'FILE_ERROR', {
        message: 'File có 1.001 sản phẩm, vượt quá giới hạn 1.000 sản phẩm',
      });
      assert.equal(countProducts(own), before);
    });
  }

  for (const format of FORMATS) {
    test(`${format}: đúng 1.000 sản phẩm → 201`, async () => {
      const before = countProducts(own);
      const res = await send(format, 1000);
      assert.equal(res.status, 201, res.text.slice(0, 500));
      assert.deepEqual(Object.keys(res.body), ['data', 'message']);
      assert.equal(res.body.data.imported, 1000);
      assert.equal(res.body.message, 'Đã nhập 1.000 sản phẩm');
      assert.equal(countProducts(own), before + 1000);
    });
  }
});
