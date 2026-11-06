/**
 * Kiểm thử module quy tắc dùng chung shared/productRules.js (chạy được ở cả trình duyệt và Node.js).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import {
  COPY_SUFFIX,
  DEFAULT_PAGE_SIZE,
  EDITABLE_FIELDS,
  EXPORT_FORMATS,
  FIELD_LABELS,
  IMAGE_RULES,
  IMPORTABLE_FIELDS,
  IMPORT_RULES,
  LIMITS,
  PAGE_SIZES,
  PRODUCT_FIELDS,
  REQUIRED_IMPORT_FIELDS,
  SERVER_MANAGED_FIELDS,
  buildCopyName,
  buildSearchTokens,
  checkImageFileMeta,
  checkImportFileMeta,
  detectImportFormat,
  formatNumberVi,
  formatProductCode,
  normalizeImageReference,
  normalizeSearchText,
  parseProductId,
  validateProductInput,
} from '../shared/productRules.js';

const MB = 1024 * 1024;

describe('hằng số', () => {
  test('PRODUCT_FIELDS có đúng 10 trường theo thứ tự đề bài', () => {
    assert.deepEqual(PRODUCT_FIELDS, [
      'ProductID',
      'ProductName',
      'PathImage',
      'ProductType',
      'Quantity',
      'Unit',
      'Price',
      'Description',
      'CreateDate',
      'UpdateDate',
    ]);
  });

  test('nhóm trường: sửa được, server quản lý, nhập được, bắt buộc khi nhập', () => {
    assert.deepEqual(EDITABLE_FIELDS, ['ProductName', 'ProductType', 'Quantity', 'Unit', 'Price', 'Description']);
    assert.deepEqual(SERVER_MANAGED_FIELDS, ['ProductID', 'CreateDate', 'UpdateDate']);
    assert.deepEqual(IMPORTABLE_FIELDS, ['ProductName', 'PathImage', 'ProductType', 'Quantity', 'Unit', 'Price', 'Description']);
    assert.deepEqual(REQUIRED_IMPORT_FIELDS, ['ProductName', 'ProductType', 'Quantity', 'Unit', 'Price']);
  });

  test('mỗi trường có nhãn tiếng Việt', () => {
    assert.deepEqual(Object.keys(FIELD_LABELS), [...PRODUCT_FIELDS]);
    assert.equal(FIELD_LABELS.Price, 'Giá (VNĐ)');
  });

  test('phân trang 10 (mặc định) hoặc 15 dòng', () => {
    assert.deepEqual(PAGE_SIZES, [10, 15]);
    assert.equal(DEFAULT_PAGE_SIZE, 10);
  });

  test('giới hạn ảnh 5 MB PNG/JPEG/WebP, file nhập 10 MB và 1.000 sản phẩm, 3 định dạng', () => {
    assert.equal(IMAGE_RULES.maxBytes, 5 * MB);
    assert.deepEqual(IMAGE_RULES.mimeTypes, ['image/png', 'image/jpeg', 'image/webp']);
    assert.equal(IMPORT_RULES.maxBytes, 10 * MB);
    assert.equal(IMPORT_RULES.maxProducts, 1000);
    assert.deepEqual(IMPORT_RULES.formats, ['xlsx', 'json', 'xml']);
    assert.deepEqual(EXPORT_FORMATS, ['xlsx', 'json', 'xml']);
    assert.equal(LIMITS.searchMax, 200);
    assert.equal(LIMITS.bulkIdsMax, 1000);
  });

  test('các hằng số bị đóng băng (không sửa được lúc chạy)', () => {
    for (const value of [PRODUCT_FIELDS, EDITABLE_FIELDS, IMPORTABLE_FIELDS, LIMITS, PAGE_SIZES, IMAGE_RULES, IMPORT_RULES]) {
      assert.ok(Object.isFrozen(value));
    }
  });

  test('hậu tố bản sao là " (bản sao)"', () => {
    assert.equal(COPY_SUFFIX, ' (bản sao)');
  });

  test('module không import gì (dùng được trực tiếp trong trình duyệt)', () => {
    const source = fs.readFileSync(new URL('../shared/productRules.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(source, /\brequire\(/);
  });
});

describe('formatNumberVi', () => {
  test('nhóm hàng nghìn bằng dấu chấm', () => {
    assert.equal(formatNumberVi(0), '0');
    assert.equal(formatNumberVi(999), '999');
    assert.equal(formatNumberVi(1000), '1.000');
    assert.equal(formatNumberVi(1250000), '1.250.000');
    assert.equal(formatNumberVi(1_000_000_000_000), '1.000.000.000.000');
    assert.equal(formatNumberVi(-1500), '-1.500');
    assert.equal(formatNumberVi('2500'), '2.500');
  });

  test('bỏ phần thập phân; giá trị không phải số → chuỗi rỗng', () => {
    assert.equal(formatNumberVi(1234.99), '1.234');
    assert.equal(formatNumberVi(Number.NaN), '');
    assert.equal(formatNumberVi(Number.POSITIVE_INFINITY), '');
    assert.equal(formatNumberVi('abc'), '');
  });
});

describe('formatProductCode', () => {
  test('ProductID → mã SP000001 (đệm 6 chữ số)', () => {
    assert.equal(formatProductCode(1), 'SP000001');
    assert.equal(formatProductCode(12), 'SP000012');
    assert.equal(formatProductCode(999999), 'SP999999');
    assert.equal(formatProductCode(1234567), 'SP1234567');
    assert.equal(formatProductCode('31'), 'SP000031');
  });

  test('ID không hợp lệ → chuỗi rỗng', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 'abc', '', null, undefined, {}]) {
      assert.equal(formatProductCode(bad), '', `formatProductCode(${String(bad)})`);
    }
  });
});

describe('parseProductId', () => {
  test('nhận số nguyên dương, chuỗi chữ số và mã SP (không phân biệt hoa/thường)', () => {
    assert.equal(parseProductId(12), 12);
    assert.equal(parseProductId('12'), 12);
    assert.equal(parseProductId(' 12 '), 12);
    assert.equal(parseProductId('SP000012'), 12);
    assert.equal(parseProductId('sp000012'), 12);
    assert.equal(parseProductId('Sp12'), 12);
    assert.equal(parseProductId('999999999999999'), 999999999999999);
  });

  test('từ chối giá trị không phải ID hợp lệ', () => {
    const bad = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '0', 'SP0', 'SP', '', '  ',
      'abc', '1e3', '12a', '-1', '1.0', 'SP-1', '9999999999999999', null, undefined, true, {}, [], [1]];
    for (const value of bad) {
      assert.equal(parseProductId(value), null, `parseProductId(${JSON.stringify(value)})`);
    }
  });
});

describe('normalizeSearchText / buildSearchTokens', () => {
  test('bỏ dấu tiếng Việt, đ → d, chữ thường', () => {
    assert.equal(normalizeSearchText('Điện Thoại'), 'dien thoai');
    assert.equal(normalizeSearchText('ĐỒNG HỒ'), 'dong ho');
    assert.equal(normalizeSearchText('Nước khoáng Lavie'), 'nuoc khoang lavie');
    assert.equal(normalizeSearchText('Trà xanh Không Độ'), 'tra xanh khong do');
    assert.equal(normalizeSearchText('ỹ ữ ặ ơ ư ă â ê ô'), 'y u a o u a a e o');
  });

  test('chuỗi dạng NFC và NFD cho cùng kết quả', () => {
    const text = 'Cà phê sữa đá';
    assert.equal(normalizeSearchText(text.normalize('NFD')), normalizeSearchText(text.normalize('NFC')));
    assert.equal(normalizeSearchText(text.normalize('NFD')), 'ca phe sua da');
  });

  test('gộp khoảng trắng, cắt hai đầu; null/undefined → ""', () => {
    assert.equal(normalizeSearchText('  a \t\n  b  '), 'a b');
    assert.equal(normalizeSearchText(null), '');
    assert.equal(normalizeSearchText(undefined), '');
    assert.equal(normalizeSearchText(123), '123');
  });

  test('tách từ khóa đã chuẩn hóa, bỏ trùng, tối đa 10 từ', () => {
    assert.deepEqual(buildSearchTokens('  Điện   THOẠI '), ['dien', 'thoai']);
    assert.deepEqual(buildSearchTokens('a A á à'), ['a']);
    assert.equal(buildSearchTokens('1 2 3 4 5 6 7 8 9 10 11 12').length, 10);
    assert.deepEqual(buildSearchTokens(''), []);
    assert.deepEqual(buildSearchTokens('   '), []);
    assert.deepEqual(buildSearchTokens(null), []);
  });
});

describe('buildCopyName', () => {
  test('thêm hậu tố " (bản sao)"', () => {
    assert.equal(buildCopyName('Bút bi'), 'Bút bi (bản sao)');
    assert.equal(buildCopyName('  Bút bi  '), 'Bút bi (bản sao)');
    assert.equal(buildCopyName('Bút bi (bản sao)'), 'Bút bi (bản sao) (bản sao)');
  });

  test('cắt tên gốc để tên bản sao không vượt quá 200 ký tự', () => {
    const copy = buildCopyName('a'.repeat(200));
    assert.equal(copy.length, 200);
    assert.equal(copy, `${'a'.repeat(190)} (bản sao)`);
    // khoảng trắng ở điểm cắt được bỏ để không có hai dấu cách liền nhau
    assert.equal(buildCopyName(`${'b'.repeat(189)} ccccc`), `${'b'.repeat(189)} (bản sao)`);
    for (let length = 0; length <= 250; length += 7) {
      assert.ok(buildCopyName('x'.repeat(length)).length <= LIMITS.productNameMax);
    }
  });
});

describe('validateProductInput', () => {
  const valid = { ProductName: 'Bút bi', ProductType: 'Văn phòng phẩm', Quantity: 10, Unit: 'Hộp', Price: 45000, Description: 'Mực xanh' };

  test('dữ liệu hợp lệ → không lỗi, giá trị đã chuẩn hóa', () => {
    const { value, errors } = validateProductInput({ ...valid, ProductName: '  Bút bi  ', Quantity: ' 010 ', Price: '45000' });
    assert.deepEqual(errors, []);
    assert.deepEqual(value, { ...valid, Quantity: 10, Price: 45000 });
  });

  test('chỉ trả về 6 trường sửa được, bỏ qua ProductID/PathImage/ngày/trường lạ', () => {
    const { value, errors } = validateProductInput({
      ...valid,
      ProductID: 5,
      PathImage: '/uploads/a.png',
      CreateDate: 'x',
      UpdateDate: 'y',
      Foo: 'bar',
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(Object.keys(value), [...EDITABLE_FIELDS]);
  });

  test('Mô tả rỗng hoặc chỉ khoảng trắng → null (không bắt buộc)', () => {
    assert.equal(validateProductInput({ ...valid, Description: '   ' }).value.Description, null);
    assert.equal(validateProductInput({ ...valid, Description: undefined }).value.Description, null);
    assert.deepEqual(validateProductInput({ ...valid, Description: null }).errors, []);
  });

  test('thiếu toàn bộ trường bắt buộc → 5 lỗi theo thứ tự trường', () => {
    for (const input of [{}, undefined, null, 'x']) {
      assert.deepEqual(validateProductInput(input).errors, [
        { field: 'ProductName', message: 'Tên sản phẩm là bắt buộc' },
        { field: 'ProductType', message: 'Loại sản phẩm là bắt buộc' },
        { field: 'Quantity', message: 'Số lượng là bắt buộc' },
        { field: 'Unit', message: 'Đơn vị tính là bắt buộc' },
        { field: 'Price', message: 'Giá là bắt buộc' },
      ]);
    }
  });

  test('chuỗi chỉ có khoảng trắng coi như bỏ trống', () => {
    const { errors } = validateProductInput({ ...valid, ProductName: '   ', Unit: '\t', Quantity: '  ' });
    assert.deepEqual(errors.map((error) => error.field), ['ProductName', 'Quantity', 'Unit']);
  });

  test('độ dài tối đa: tên 200, loại 100, đơn vị 50, mô tả 2.000 ký tự', () => {
    const atLimit = validateProductInput({
      ...valid,
      ProductName: 'n'.repeat(200),
      ProductType: 't'.repeat(100),
      Unit: 'u'.repeat(50),
      Description: 'd'.repeat(2000),
    });
    assert.deepEqual(atLimit.errors, []);
    const overLimit = validateProductInput({
      ...valid,
      ProductName: 'n'.repeat(201),
      ProductType: 't'.repeat(101),
      Unit: 'u'.repeat(51),
      Description: 'd'.repeat(2001),
    });
    assert.deepEqual(overLimit.errors, [
      { field: 'ProductName', message: 'Tên sản phẩm tối đa 200 ký tự' },
      { field: 'ProductType', message: 'Loại sản phẩm tối đa 100 ký tự' },
      { field: 'Unit', message: 'Đơn vị tính tối đa 50 ký tự' },
      { field: 'Description', message: 'Mô tả tối đa 2.000 ký tự' },
    ]);
  });

  test('số lượng/giá: số nguyên không âm (số hoặc chuỗi chữ số)', () => {
    for (const ok of [0, 7, '7', ' 7 ', '0007', -0]) {
      const { value, errors } = validateProductInput({ ...valid, Quantity: ok, Price: ok });
      assert.deepEqual(errors, [], `giá trị ${JSON.stringify(ok)}`);
      assert.equal(value.Quantity, Math.abs(Number(ok)));
      assert.equal(value.Price, Math.abs(Number(ok)));
    }
    for (const bad of [-1, 1.5, '1.5', '-1', '1e3', '1.000', 'mười', true, [], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { errors } = validateProductInput({ ...valid, Quantity: bad, Price: bad });
      assert.deepEqual(errors, [
        { field: 'Quantity', message: 'Số lượng phải là số nguyên không âm' },
        { field: 'Price', message: 'Giá phải là số nguyên không âm' },
      ], `giá trị ${JSON.stringify(bad)}`);
    }
  });

  test('-0 được đổi thành 0', () => {
    assert.ok(Object.is(validateProductInput({ ...valid, Quantity: -0 }).value.Quantity, 0));
  });

  test('số lượng tối đa 1.000.000.000, giá tối đa 1.000.000.000.000', () => {
    assert.deepEqual(validateProductInput({ ...valid, Quantity: 1_000_000_000, Price: 1_000_000_000_000 }).errors, []);
    assert.deepEqual(validateProductInput({ ...valid, Quantity: 1_000_000_001, Price: '1000000000001' }).errors, [
      { field: 'Quantity', message: 'Số lượng không được vượt quá 1.000.000.000' },
      { field: 'Price', message: 'Giá không được vượt quá 1.000.000.000.000' },
    ]);
  });

  test('trường văn bản nhận số; object/mảng/boolean → "không hợp lệ"', () => {
    assert.equal(validateProductInput({ ...valid, Unit: 5 }).value.Unit, '5');
    const { errors } = validateProductInput({ ...valid, ProductName: { a: 1 }, ProductType: ['x'], Description: false });
    assert.deepEqual(errors, [
      { field: 'ProductName', message: 'Tên sản phẩm không hợp lệ' },
      { field: 'ProductType', message: 'Loại sản phẩm không hợp lệ' },
      { field: 'Description', message: 'Mô tả không hợp lệ' },
    ]);
  });

  test('văn bản được chuẩn hóa Unicode NFC', () => {
    const { value } = validateProductInput({ ...valid, ProductName: 'Cà phê sữa'.normalize('NFD') });
    assert.equal(value.ProductName, 'Cà phê sữa'.normalize('NFC'));
  });
});

describe('normalizeImageReference', () => {
  test('không có ảnh: null, undefined, chuỗi rỗng', () => {
    for (const empty of [null, undefined, '', '   ']) {
      assert.deepEqual(normalizeImageReference(empty), { ok: true, value: null });
    }
  });

  test('chuẩn hóa về "/uploads/<tên-file>"', () => {
    assert.deepEqual(normalizeImageReference('/uploads/abc.png'), { ok: true, value: '/uploads/abc.png' });
    assert.deepEqual(normalizeImageReference(' uploads/abc.PNG '), { ok: true, value: '/uploads/abc.PNG' });
    for (const name of ['3f0c2a1e-1b2c-4d5e-8f90-a1b2c3d4e5f6.jpg', 'a.jpeg', 'a_b-c.webp']) {
      assert.deepEqual(normalizeImageReference(`/uploads/${name}`), { ok: true, value: `/uploads/${name}` });
    }
  });

  test('từ chối URL, data URI, đường dẫn tuyệt đối, thư mục con, thoát thư mục, sai đuôi', () => {
    const bad = [
      'http://evil.example/a.png',
      '//evil.example/uploads/a.png',
      'data:image/png;base64,AAAA',
      '../a.png',
      '/uploads/../a.png',
      '/uploads/..%2Fa.png',
      '/uploads/sub/a.png',
      '/uploads/a\\b.png',
      'C:\\uploads\\a.png',
      '/etc/passwd',
      '/uploads/a.gif',
      '/uploads/a.png.exe',
      '/uploads/.hidden.png',
      '/uploads/',
      '/uploads/a.png?x=1',
      `/uploads/${'a'.repeat(300)}.png`,
    ];
    for (const value of bad) {
      const result = normalizeImageReference(value);
      assert.equal(result.ok, false, JSON.stringify(value));
      assert.equal(result.message, 'Đường dẫn ảnh chỉ được tham chiếu ảnh đã có trong ứng dụng, dạng /uploads/ten-file.png');
    }
  });

  test('giá trị không phải chuỗi → "Đường dẫn ảnh không hợp lệ"', () => {
    for (const value of [12, true, {}, ['/uploads/a.png']]) {
      assert.deepEqual(normalizeImageReference(value), { ok: false, message: 'Đường dẫn ảnh không hợp lệ' });
    }
  });
});

describe('checkImageFileMeta', () => {
  test('nhận PNG/JPEG/WebP từ File của trình duyệt và file của Multer', () => {
    assert.equal(checkImageFileMeta({ name: 'a.png', type: 'image/png', size: 10 }), null);
    assert.equal(checkImageFileMeta({ name: 'a.JPG', type: 'image/jpeg', size: 10 }), null);
    assert.equal(checkImageFileMeta({ name: 'a.jpeg', type: 'image/jpeg', size: 10 }), null);
    assert.equal(checkImageFileMeta({ originalname: 'ảnh.webp', mimetype: 'image/webp', size: 10 }), null);
    assert.equal(checkImageFileMeta({ originalname: 'a.png', mimetype: 'application/octet-stream' }), null);
    assert.equal(checkImageFileMeta({ name: 'a.png', type: '' }), null);
    assert.equal(checkImageFileMeta(null), null);
  });

  test('sai đuôi hoặc sai kiểu MIME → "Ảnh phải là file PNG, JPEG hoặc WebP"', () => {
    for (const file of [
      { name: 'a.gif', type: 'image/gif' },
      { name: 'a.png', type: 'text/plain' },
      { name: 'a.svg', type: 'image/svg+xml' },
      { name: 'png', type: 'image/png' },
      { originalname: 'a.png.exe', mimetype: 'image/png' },
    ]) {
      assert.equal(checkImageFileMeta(file), 'Ảnh phải là file PNG, JPEG hoặc WebP', JSON.stringify(file));
    }
  });

  test('tối đa 5 MB; file rỗng bị từ chối', () => {
    assert.equal(checkImageFileMeta({ name: 'a.png', type: 'image/png', size: 5 * MB }), null);
    assert.equal(checkImageFileMeta({ name: 'a.png', type: 'image/png', size: 5 * MB + 1 }), 'Ảnh vượt quá dung lượng tối đa 5 MB');
    assert.equal(checkImageFileMeta({ name: 'a.png', type: 'image/png', size: 0 }), 'File ảnh rỗng');
  });
});

describe('detectImportFormat / checkImportFileMeta', () => {
  test('định dạng theo đuôi file (không phân biệt hoa/thường)', () => {
    assert.equal(detectImportFormat('san-pham.xlsx'), 'xlsx');
    assert.equal(detectImportFormat('SAN-PHAM.XLSX'), 'xlsx');
    assert.equal(detectImportFormat('a.json'), 'json');
    assert.equal(detectImportFormat('a.b.xml'), 'xml');
    for (const name of ['a.csv', 'a.xls', 'a.txt', 'xlsx', '', null, undefined]) {
      assert.equal(detectImportFormat(name), null, String(name));
    }
  });

  test('kiểm tra sơ bộ file nhập: có file, đúng đuôi, ≤ 10 MB, không rỗng', () => {
    assert.equal(checkImportFileMeta(null), 'Vui lòng chọn file cần nhập');
    assert.equal(checkImportFileMeta({ name: 'a.csv', size: 10 }), 'Chỉ hỗ trợ file .xlsx, .json hoặc .xml');
    assert.equal(checkImportFileMeta({ originalname: 'a.json', size: 10 * MB + 1 }), 'File nhập vượt quá dung lượng tối đa 10 MB');
    assert.equal(checkImportFileMeta({ name: 'a.xml', size: 0 }), 'File nhập rỗng');
    assert.equal(checkImportFileMeta({ name: 'a.xlsx', size: 10 * MB }), null);
    assert.equal(checkImportFileMeta({ originalname: 'a.json' }), null);
  });
});
