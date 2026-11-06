# Quản lý sản phẩm bằng Node.js

Ứng dụng web quản lý danh sách sản phẩm (bảng `Products`) với giao diện tiếng Việt dạng bảng quản trị.
Express phục vụ **cả giao diện và API** tại <http://localhost:3000>, khởi động bằng **một lệnh** (`npm start`).

## Mục lục

1. [Giới thiệu và công nghệ](#1-giới-thiệu-và-công-nghệ)
2. [Yêu cầu môi trường](#2-yêu-cầu-môi-trường)
3. [Cài đặt và chạy](#3-cài-đặt-và-chạy)
4. [Cấu trúc thư mục và kiến trúc](#4-cấu-trúc-thư-mục-và-kiến-trúc)
5. [Bảng Products](#5-bảng-products)
6. [11 chức năng và quy tắc tương tác](#6-11-chức-năng-và-quy-tắc-tương-tác)
7. [Phím tắt](#7-phím-tắt)
8. [API](#8-api)
9. [Nhập/xuất dữ liệu (Import/Export)](#9-nhậpxuất-dữ-liệu-importexport)
10. [Ảnh sản phẩm](#10-ảnh-sản-phẩm)
11. [Kiểm thử tự động và ghi chú phụ thuộc](#11-kiểm-thử-tự-động-và-ghi-chú-phụ-thuộc)

---

## 1. Giới thiệu và công nghệ

Luồng xử lý: **HTML/CSS/JavaScript thuần (trình duyệt) → Express API → SQLite qua module tích hợp `node:sqlite`**.

| Thành phần | Công nghệ | Phiên bản |
|---|---|---|
| Giao diện | HTML, CSS viết trực tiếp, JavaScript thuần dạng ES module (không framework, không CDN, không ảnh thiết kế; biểu tượng là SVG nội tuyến) | — |
| Máy chủ web + API | [Express](https://expressjs.com/) | 5.3.0 |
| Nhận file upload (ảnh, file nhập) | [Multer](https://github.com/expressjs/multer) (dùng busboy 1.6.0) | 2.5.0 |
| Đọc/ghi Excel `.xlsx` | [ExcelJS](https://github.com/exceljs/exceljs) | 4.4.0 |
| Đọc/ghi XML | [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) | 5.12.0 |
| JSON | `JSON.parse` / `JSON.stringify` có sẵn của JavaScript | — |
| Cơ sở dữ liệu | SQLite qua `node:sqlite` (`DatabaseSync`) tích hợp trong Node.js | theo Node.js |
| Kiểm thử | `node:test` tích hợp trong Node.js | theo Node.js |

`package.json` khai báo các phụ thuộc theo dạng `^x.y.z`; `package-lock.json` ghim đúng các phiên bản trong bảng trên,
nên `npm install` cài lại đúng các phiên bản này. Ngoài 4 thư viện trên, mọi thứ khác dùng module có sẵn của Node.js
(`node:sqlite`, `node:crypto`, `node:fs`, `node:path`, `node:test`…).

---

## 2. Yêu cầu môi trường

| Mục | Giá trị |
|---|---|
| Phiên bản Node.js đã dùng để chạy và kiểm tra bài | **Node.js 24.14.0** (npm 11.9.0), Windows 11 |
| Phiên bản tối thiểu khai báo trong `package.json` (`engines`) | `>=22.13.0` (xem lưu ý bên dưới) |
| Trình duyệt | Trình duyệt hiện đại hỗ trợ ES module và phần tử `<dialog>` |
| Mạng | Chỉ cần khi chạy `npm install`; ứng dụng chạy hoàn toàn cục bộ |

**Về `node:sqlite` trong Node.js 24.14.0.** Module này vẫn ở trạng thái **thử nghiệm (Experimental)** trong phiên bản
này: khi được nạp, Node.js in cảnh báo
`ExperimentalWarning: SQLite is an experimental feature and might change at any time`.
Cả ba script trong `package.json` đều chạy `node --disable-warning=ExperimentalWarning …` để ẩn cảnh báo đó.
Cảnh báo chỉ mang tính thông báo, không ảnh hưởng hoạt động. Không cần cờ `--experimental-sqlite`.

**Vì sao `engines` là `>=22.13.0`.** Từ Node.js 22.13.0, `node:sqlite` dùng được mà không cần cờ
`--experimental-sqlite`, và có hàm `DatabaseSync#function()` — ứng dụng dùng hàm này để đăng ký hàm SQL `vn_norm`
phục vụ tìm kiếm tiếng Việt không phân biệt hoa/thường và dấu (mục 5).

> **Lưu ý:** bài chỉ được chạy và kiểm thử trên **Node.js 24.14.0**; nên dùng đúng phiên bản này (hoặc Node.js 24
> mới hơn). Code không dùng API nào chỉ có từ Node 24: ví dụ `withTransaction` trong `src/db/database.js` luôn thử
> `ROLLBACK` khi giao dịch lỗi, thay vì dựa vào thuộc tính `db.isTransaction` (chỉ có từ Node 24.0.0).

Kiểm tra phiên bản đang cài:

```bash
node --version   # v24.14.0
npm --version    # 11.9.0
```

---

## 3. Cài đặt và chạy

### 3.1. Chạy nhanh

```bash
cd quan-ly-san-pham
npm install
npm start
```

Khi thấy dòng `Ứng dụng đang chạy tại http://localhost:3000`, mở trình duyệt tại **<http://localhost:3000>**.
Dừng máy chủ bằng `Ctrl+C` (máy chủ in `Đang tắt máy chủ…`, đóng kết nối HTTP và đóng database rồi thoát).

### 3.2. Các script npm

| Lệnh | Câu lệnh thực tế | Mục đích |
|---|---|---|
| `npm start` | `node --disable-warning=ExperimentalWarning src/server.js` | Chạy ứng dụng (giao diện + API) |
| `npm run dev` | `node --disable-warning=ExperimentalWarning --watch src/server.js` | Như `npm start` nhưng tự khởi động lại khi file mã nguồn phía server (và các module nó import, gồm `shared/productRules.js`) thay đổi. Sửa file trong `public/` chỉ cần tải lại trang. |
| `npm test` | `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 "test/**/*.test.js"` | Chạy kiểm thử tự động (mục 11) |

### 3.3. Biến môi trường

Đọc trong `src/config.js`. Tất cả đều không bắt buộc.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng HTTP. Giá trị không phải số (hoặc `0`) → dùng `3000`. |
| `DB_PATH` | `<thư mục dự án>/data/products.db` | Đường dẫn file SQLite. Thư mục chứa file được tự tạo nếu chưa có. |
| `UPLOAD_DIR` | `<thư mục dự án>/uploads` | Thư mục lưu ảnh upload (được tự tạo nếu chưa có). |
| `SEED_SAMPLE_DATA` | bật | Đặt `0`, `false` hoặc `no` (không phân biệt hoa/thường) để **không** tạo dữ liệu mẫu khi database mới. |

Đường dẫn mặc định được tính từ vị trí mã nguồn nên không phụ thuộc thư mục đang đứng khi chạy lệnh; nếu tự đặt
`DB_PATH`/`UPLOAD_DIR` bằng đường dẫn tương đối thì đường dẫn đó tính theo thư mục hiện hành.

Ví dụ đổi cổng:

```bash
# Git Bash / macOS / Linux
PORT=3001 npm start
```

```powershell
# Windows PowerShell
$env:PORT = "3001"; npm start
# Bỏ biến sau khi dùng xong
Remove-Item Env:PORT
```

Nếu cổng đã bị chiếm, máy chủ báo
`Cổng 3000 đang được một chương trình khác sử dụng. Hãy tắt chương trình đó hoặc chạy với cổng khác, ví dụ: PORT=3001 npm start`
và thoát với mã 1.

### 3.4. Dữ liệu mẫu và làm lại từ đầu

- **Lần chạy đầu tiên** (file `data/products.db` chưa tồn tại), ứng dụng tạo bảng `Products` và thêm **32 sản phẩm
  mẫu** thuộc 8 loại (Điện thoại, Laptop, Phụ kiện, Thiết bị gia dụng, Thực phẩm, Đồ uống, Văn phòng phẩm, Thời trang),
  không có ảnh, mô tả có dấu tiếng Việt (để thử tìm không dấu, ví dụ `dien thoai`). Ngày tạo/cập nhật được rải trong
  khoảng 3,5 ngày trước thời điểm chạy lần đầu. Dữ liệu mẫu được thêm trong một giao dịch.
- Các lần chạy sau **không** thêm dữ liệu mẫu nữa (chỉ thêm khi database vừa được tạo mới).
- `SEED_SAMPLE_DATA` chỉ có tác dụng khi database mới; tắt nó với một database đã có không xóa dữ liệu.

**Làm lại từ đầu** (dừng máy chủ trước, vì Windows khóa file database đang mở):

```powershell
# PowerShell — xóa database rồi chạy lại: tạo lại 32 sản phẩm mẫu
Remove-Item .\data\products.db
npm start

# Bắt đầu với database rỗng (không có dữ liệu mẫu)
Remove-Item .\data\products.db
$env:SEED_SAMPLE_DATA = "0"; npm start

# (Tùy chọn) xóa luôn ảnh đã upload, giữ lại .gitkeep
Get-ChildItem .\uploads\* -Exclude .gitkeep | Remove-Item
```

```bash
# Git Bash / macOS / Linux
rm data/products.db && npm start
rm data/products.db && SEED_SAMPLE_DATA=0 npm start
find uploads -type f ! -name .gitkeep -delete   # tùy chọn
```

Nếu chỉ xóa ảnh mà giữ database, các sản phẩm đang trỏ tới ảnh đó sẽ hiển thị ô “Không tải được ảnh”.
`.gitignore` đã bỏ qua `node_modules/`, `data/*.db*` và nội dung `uploads/` (trừ `.gitkeep`).

---

## 4. Cấu trúc thư mục và kiến trúc

### 4.1. Cây thư mục

```text
quan-ly-san-pham/
├── package.json                 # script start/dev/test, engines, 4 phụ thuộc
├── package-lock.json            # ghim phiên bản thư viện
├── .gitignore
├── README.md
├── shared/
│   └── productRules.js          # quy tắc dữ liệu DÙNG CHUNG cho frontend và backend
├── src/                         # backend (Express)
│   ├── server.js                # điểm vào: createApp() → listen; tắt máy chủ an toàn (SIGINT/SIGTERM)
│   ├── app.js                   # createApp(): mở DB, seed, nối phụ thuộc, middleware, phục vụ file tĩnh
│   ├── config.js                # PORT, DB_PATH, UPLOAD_DIR, SEED_SAMPLE_DATA, các thư mục
│   ├── routes/
│   │   └── productRoutes.js     # URL/phương thức → middleware → hàm controller
│   ├── controllers/
│   │   ├── productController.js       # danh sách, chi tiết, thêm, sửa, xóa, xóa nhiều, sao chép
│   │   └── importExportController.js  # nhập file, xuất file, file mẫu (ghi header tải về)
│   ├── services/
│   │   ├── productService.js          # nghiệp vụ, kiểm tra dữ liệu, phân trang, giao dịch
│   │   ├── imageService.js            # kiểm tra magic bytes, ghi ảnh tên ngẫu nhiên, kiểm tra PathImage
│   │   └── importExportService.js     # đọc/ghi xlsx, json, xml; kiểm tra toàn bộ file trước khi ghi
│   ├── repositories/
│   │   └── productRepository.js       # nơi DUY NHẤT chứa câu lệnh SQL
│   ├── db/
│   │   ├── database.js          # mở DB, tạo bảng, hàm SQL vn_norm, withTransaction
│   │   └── seed.js              # 32 sản phẩm mẫu
│   ├── middlewares/
│   │   ├── upload.js            # Multer: ảnh (trường "image", 5 MB), file nhập (trường "file", 10 MB)
│   │   └── errorHandler.js      # 404 API, 404 trang, chuyển mọi lỗi thành JSON { error: … }
│   └── utils/
│       ├── errors.js            # AppError + mã lỗi + hàm tạo lỗi
│       └── time.js              # nowUtcIso(), formatVietnamTimestamp() (tên file xuất)
├── public/                      # frontend (Express phục vụ tại /)
│   ├── index.html               # bố cục trang, các <dialog>, biểu tượng SVG
│   ├── css/styles.css           # toàn bộ giao diện (nền sáng, bảng quản trị)
│   └── js/
│       ├── main.js              # trạng thái danh sách + actions registry (nút và phím tắt gọi chung)
│       ├── api.js               # MỌI lệnh fetch tới API, ApiError, tải file
│       ├── table.js             # bảng, chọn dòng, phân trang, trạng thái đang tải/rỗng/lỗi
│       ├── form.js              # biểu mẫu thêm/sửa trong hộp thoại, ảnh xem trước, lỗi theo trường
│       ├── shortcuts.js         # bảng định nghĩa phím tắt, bộ xử lý keydown, bảng hướng dẫn
│       ├── detail.js            # hộp thoại xem chi tiết (chỉ đọc)
│       ├── dialogs.js           # ngăn xếp hộp thoại/menu, hộp xác nhận, toast, trạng thái bận
│       ├── columns.js           # ẩn/hiện cột, lưu localStorage
│       ├── importExport.js      # hộp thoại nhập file, xuất file, tải file mẫu
│       ├── filters.js           # thanh lọc theo loại và tình trạng kho
│       ├── stats.js             # thẻ thống kê (tổng sản phẩm, tồn kho, giá trị, sắp hết, hết hàng)
│       └── format.js            # định dạng ngày giờ Việt Nam, tiền, số; tạo phần tử DOM an toàn
├── data/                        # chứa products.db (tạo khi chạy lần đầu)
├── uploads/                     # ảnh đã upload (phục vụ tại /uploads/…)
└── test/                        # kiểm thử tự động (node:test), xem mục 11
    ├── helpers.js               # khởi động ứng dụng thử, client HTTP, dữ liệu ảnh/file mẫu
    ├── productRules.test.js     # module dùng chung
    ├── listSearch.test.js       # phân trang, tìm kiếm
    ├── products.test.js         # thêm/xem/sửa/xóa, ảnh, xóa nhiều, sao chép
    ├── importExport.test.js     # xuất file, file mẫu, nhập file 3 định dạng
    ├── sortFilter.test.js       # sắp xếp, lọc theo loại/tình trạng kho, thống kê, /types
    ├── app.test.js              # file tĩnh, header bảo mật, envelope lỗi, database, tiện ích thời gian
    ├── seed.test.js             # dữ liệu mẫu, createApp với file database
    └── server.test.js           # chạy src/server.js thật (npm start)
```

### 4.2. Các lớp backend: route → controller → service → repository

```text
Trình duyệt ──HTTP──► route ──► (middleware Multer) ──► controller ──► service ──► repository ──► SQLite
                                                                         │
                                                              shared/productRules.js
```

| Lớp | File | Trách nhiệm | Không được làm |
|---|---|---|---|
| Route | `src/routes/productRoutes.js` | Nối URL + phương thức → middleware upload → hàm controller. Các đường dẫn cố định (`/export`, `/template`, `/bulk-delete`, `/bulk-copy`, `/import`) khai báo trước các route `/:id`. | Logic |
| Controller | `src/controllers/*.js` | Đọc `req` (params, query, body, file), gọi **một** hàm service, ghi phản hồi (status, JSON, header tải file). | SQL, quy tắc nghiệp vụ |
| Service | `src/services/*.js` | Quy tắc nghiệp vụ, kiểm tra dữ liệu bằng module dùng chung, xử lý ảnh, giao dịch, nhập/xuất file. | Dùng `req`/`res` |
| Repository | `src/repositories/productRepository.js` | Toàn bộ SQL (luôn dùng tham số ràng buộc), đổi dòng SQLite thành object đúng 10 trường. | Quy tắc nghiệp vụ |

`src/app.js` nối phụ thuộc tường minh, không dùng singleton toàn cục:
`db → repository → imageService → productService → importExportService → controllers → router`.
`createApp({ dbPath, uploadsDir, seedSampleData })` trả về `{ app, db, close }`, nhận được `dbPath: ':memory:'`
(dùng cho kiểm thử).

Thứ tự middleware: header bảo mật cho mọi phản hồi (`X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
`Content-Security-Policy` chỉ cho phép tài nguyên cùng nguồn) → `/api`: `Cache-Control: no-store` + `express.json`
(tối đa 1 MB) → router `/api/products` → 404 JSON cho `/api/*` không tồn tại → file tĩnh `/shared`, `/uploads`
(không liệt kê thư mục), `/` (thư mục `public/`) → 404 văn bản → bộ xử lý lỗi cuối cùng.

### 4.3. Module dùng chung `shared/productRules.js`

Một file JavaScript chuẩn, không phụ thuộc thư viện, chạy được ở **cả hai phía**:
backend import theo đường dẫn tương đối, trình duyệt import từ `/shared/productRules.js` (Express phục vụ thư mục `shared/`).

| Nhóm | Thành phần |
|---|---|
| Danh sách trường | `PRODUCT_FIELDS` (10 trường), `EDITABLE_FIELDS` (6), `SERVER_MANAGED_FIELDS`, `IMPORTABLE_FIELDS` (7), `REQUIRED_IMPORT_FIELDS` (5), `FIELD_LABELS` |
| Giới hạn, hằng số | `LIMITS`, `PAGE_SIZES` (10, 15), `DEFAULT_PAGE_SIZE`, `COPY_SUFFIX` (` (bản sao)`), `IMAGE_RULES`, `IMPORT_RULES`, `EXPORT_FORMATS` |
| Kiểm tra dữ liệu | `validateProductInput`, `normalizeImageReference`, `checkImageFileMeta`, `checkImportFileMeta`, `detectImportFormat`, `parseProductId` |
| Tìm kiếm | `normalizeSearchText`, `buildSearchTokens` |
| Định dạng | `formatProductCode` (1 → `SP000001`), `formatNumberVi` (1000000 → `1.000.000`), `buildCopyName` |

### 4.4. Các module frontend

| Module | Vai trò |
|---|---|
| `api.js` | Hàm `request()` duy nhất dùng `fetch`; lỗi API (`{ error: … }`) và lỗi mạng (`Không kết nối được máy chủ. Vui lòng thử lại.`) thành `ApiError`. Các hàm: `listProducts`, `getProduct`, `createProduct`, `updateProduct`, `deleteProduct`, `bulkDelete`, `bulkCopy`, `importProducts`, `downloadExport`, `downloadTemplate` (tải file qua `fetch` → blob nên lỗi hiện thành thông báo, không mở trang JSON). |
| `table.js` | Dựng bảng, ô chọn từng dòng và “Chọn tất cả”, thanh phân trang, trạng thái đang tải/rỗng/lỗi, áp dụng ẩn/hiện cột. |
| `form.js` | Biểu mẫu thêm/sửa: kiểm tra bằng `validateProductInput` + `checkImageFileMeta`, lỗi dưới từng trường, ảnh xem trước, “Bỏ ảnh”. |
| `shortcuts.js` | Bảng định nghĩa phím tắt duy nhất, dùng cho bộ xử lý phím, gợi ý trên nút và bảng hướng dẫn. |
| `main.js` | Trạng thái (trang, số dòng, từ khóa) và **actions registry** — nút và phím tắt gọi cùng một hàm. Chống hiển thị phản hồi cũ khi chuyển trang/gõ nhanh. |
| `detail.js` | Hộp thoại xem chi tiết chỉ đọc. |
| `dialogs.js` | Ngăn xếp hộp thoại/menu (một đường đóng duy nhất), hộp xác nhận, toast, thanh tiến trình, cờ “đang bận” chặn hai thao tác ghi cùng lúc. |
| `columns.js` | Menu ẩn/hiện cột và lưu lựa chọn vào `localStorage`. |
| `importExport.js` | Hộp thoại nhập file (chọn hoặc kéo thả), danh sách lỗi theo dòng/trường, xuất file, tải file mẫu. |
| `format.js` | Ngày giờ theo giờ Việt Nam, tiền `1.250.000 ₫`, số, nhãn `SP000001 – Tên`, tạo phần tử DOM qua `textContent` (không chèn dữ liệu người dùng bằng `innerHTML`). |

---

## 5. Bảng Products

### 5.1. Lược đồ

```sql
CREATE TABLE IF NOT EXISTS Products (
  ProductID   INTEGER PRIMARY KEY AUTOINCREMENT,
  ProductName TEXT    NOT NULL,
  PathImage   TEXT,
  ProductType TEXT    NOT NULL,
  Quantity    INTEGER NOT NULL DEFAULT 0 CHECK (Quantity >= 0),
  Unit        TEXT    NOT NULL,
  Price       INTEGER NOT NULL DEFAULT 0 CHECK (Price >= 0),
  Description TEXT,
  CreateDate  TEXT    NOT NULL,
  UpdateDate  TEXT    NOT NULL
);
```

Đúng 10 cột của đề bài, không có cột phụ: mã hiển thị `SP000001` và chuỗi tìm kiếm không dấu đều được tính khi truy vấn.

### 5.2. Các trường, quy tắc và giới hạn

| Trường | Kiểu SQLite | Nhãn giao diện | Quy tắc | Giới hạn |
|---|---|---|---|---|
| `ProductID` | INTEGER, tự tăng | Mã sản phẩm | Server sinh. Hiển thị `SP` + 6 chữ số (`SP000001`; từ 7 chữ số trở lên hiển thị đủ, ví dụ `SP1234567`). API nhận `12` hoặc `SP000012` (không phân biệt hoa/thường). | Số nguyên dương |
| `ProductName` | TEXT NOT NULL | Tên sản phẩm | Bắt buộc | ≤ 200 ký tự |
| `PathImage` | TEXT, có thể NULL | Ảnh | Có thể để trống. Biểu mẫu: upload ảnh (mục 10). API JSON và file nhập: chỉ tham chiếu ảnh đã có, dạng `/uploads/<tên-file>`. | ≤ 255 ký tự |
| `ProductType` | TEXT NOT NULL | Loại sản phẩm | Bắt buộc | ≤ 100 ký tự |
| `Quantity` | INTEGER NOT NULL, `CHECK >= 0` | Số lượng | Số nguyên không âm, bắt buộc | 0 … 1.000.000.000 |
| `Unit` | TEXT NOT NULL | Đơn vị tính | Bắt buộc | ≤ 50 ký tự |
| `Price` | INTEGER NOT NULL, `CHECK >= 0` | Giá (VNĐ) | Số nguyên không âm, đơn vị VNĐ, bắt buộc; hiển thị `1.250.000 ₫` | 0 … 1.000.000.000.000 |
| `Description` | TEXT, có thể NULL | Mô tả | Có thể để trống (rỗng lưu thành NULL) | ≤ 2.000 ký tự |
| `CreateDate` | TEXT NOT NULL | Ngày tạo | Server đặt khi thêm/sao chép/nhập; không sửa qua biểu mẫu hay API | — |
| `UpdateDate` | TEXT NOT NULL | Ngày cập nhật | Bằng `CreateDate` khi tạo; server cập nhật mỗi lần sửa | — |

Chi tiết quy tắc của `validateProductInput`:

- Chuỗi: nhận string hoặc số; chuẩn hóa Unicode NFC và cắt khoảng trắng hai đầu; độ dài tính theo `String.length`
  (giống thuộc tính `maxlength` của HTML).
- Số nguyên: nhận số nguyên hoặc chuỗi chỉ gồm chữ số (cho phép khoảng trắng hai đầu); số âm, số thập phân, chữ → lỗi.
- `ProductID`, `CreateDate`, `UpdateDate` và các trường lạ gửi lên bị bỏ qua.
- Ví dụ thông báo: `Tên sản phẩm là bắt buộc`, `Tên sản phẩm tối đa 200 ký tự`, `Số lượng phải là số nguyên không âm`,
  `Giá không được vượt quá 1.000.000.000.000`.

### 5.3. Ngày giờ: lưu UTC, hiển thị giờ Việt Nam

- Lưu dạng chuỗi **ISO 8601 theo UTC** từ `new Date().toISOString()`, ví dụ `2026-11-04T12:04:00.123Z`.
  API, file JSON/XML/Excel xuất ra giữ nguyên dạng này.
- Giao diện hiển thị `dd/MM/yyyy HH:mm:ss` theo múi giờ `Asia/Ho_Chi_Minh` (GMT+7), ví dụ
  `2026-11-04T12:04:00.123Z` → `04/11/2026 19:04:00`. Hộp thoại chi tiết ghi thêm “(giờ Việt Nam, GMT+7)” và
  hiện giá trị UTC gốc khi rê chuột.
- Tên file xuất dùng giờ Việt Nam: `san-pham-YYYYMMDD-HHmmss.<đuôi>`.

### 5.4. Kiểm tra dữ liệu ở cả frontend và backend bằng cùng một module

| Nơi kiểm tra | Hàm dùng chung |
|---|---|
| Biểu mẫu thêm/sửa (`public/js/form.js`) trước khi gửi | `validateProductInput`, `checkImageFileMeta`; thuộc tính `maxlength`, `min`, `max` của ô nhập cũng lấy từ `LIMITS` |
| Hộp thoại nhập file (`public/js/importExport.js`) trước khi gửi | `checkImportFileMeta` |
| API thêm/sửa (`src/services/productService.js`) | `validateProductInput`, `normalizeImageReference`; `checkImageFileMeta` (trong Multer và `imageService`) + kiểm tra magic bytes |
| Nhập file (`src/services/importExportService.js`), từng dòng | `validateProductInput`, `normalizeImageReference`, `checkImportFileMeta` |

Vì dùng chung một module, thông báo lỗi ở hai phía giống hệt nhau. Lỗi do server trả về (`details[].field`) được
hiển thị lại đúng dưới ô tương ứng của biểu mẫu.

### 5.5. Tìm kiếm tiếng Việt không phân biệt hoa/thường và dấu

- `normalizeSearchText`: tách dấu (NFD) rồi bỏ dấu, `đ/Đ → d`, chữ thường, gộp khoảng trắng.
  Hàm này được đăng ký làm hàm SQL `vn_norm`, nên dữ liệu và từ khóa được chuẩn hóa bằng cùng một quy tắc.
- Từ khóa được tách thành tối đa 10 từ (không trùng). Một sản phẩm khớp khi **mỗi** từ xuất hiện (dạng chuỗi con)
  trong ít nhất một trong: mã `SPxxxxxx`, tên, mô tả, loại.
- Ví dụ: `dien thoai` tìm được “Điện thoại …”; `sp000012` tìm được sản phẩm có mã SP000012; ký tự `%` và `_`
  được hiểu theo nghĩa đen. Từ khóa tối đa 200 ký tự.

---

## 6. 11 chức năng và quy tắc tương tác

### 6.1. Các chức năng

| # | Chức năng | Thao tác trên giao diện | API |
|---|---|---|---|
| 1 | **Bảng phân trang** | Mặc định 10 dòng/trang; ô “Số dòng/trang” chọn 10 hoặc 15. Chân bảng: `Hiển thị 11–20 trên tổng 45 sản phẩm`, nút trang đầu/trước/số trang (rút gọn bằng “…”)/sau/cuối và `Trang x/y`. Sản phẩm mới nhất (ID lớn nhất) đứng đầu. Cột: ô chọn · Mã · Tên sản phẩm · Ảnh (ảnh nhỏ 40×40; chưa có ảnh thì hiện ô chữ cái đầu của tên, tô màu theo loại) · Loại · Số lượng · Đơn vị · Giá · Mô tả (cắt ngắn, rê chuột xem đủ) · Ngày tạo · Ngày cập nhật · Thao tác (Xem, Sửa, Sao chép, Xóa). | `GET /api/products` |
| 2 | **Thêm mới** | Nút **Thêm mới** hoặc `Alt+N` → hộp thoại biểu mẫu. Các trường có dấu `*` là bắt buộc; Loại và Đơn vị tính có danh sách gợi ý. Ảnh: **Chọn ảnh…** → xem trước ngay, **Bỏ ảnh** để bỏ. Lỗi hiện dưới từng trường và con trỏ nhảy tới trường lỗi đầu tiên. **Lưu** (hoặc `Enter`, `Alt+S`) → nút đổi thành “Đang lưu…”. Sau khi lưu: về trang 1, dòng mới được làm nổi bật. | `POST /api/products` |
| 3 | **Cập nhật** | Chọn đúng 1 dòng → **Sửa** / `Alt+U`, hoặc nút Sửa trên dòng, hoặc nút **Sửa** trong hộp chi tiết. Dữ liệu mới nhất được tải lại từ server rồi điền vào biểu mẫu; Mã, Ngày tạo, Ngày cập nhật hiển thị chỉ đọc. Không chọn ảnh mới thì **giữ ảnh cũ**; **Bỏ ảnh** gỡ ảnh khỏi sản phẩm; **Dùng lại ảnh hiện tại** hoàn tác. Nếu sản phẩm đã bị xóa ở nơi khác: báo lỗi, đóng hộp thoại và tải lại bảng. | `GET /api/products/:id`, `PUT /api/products/:id` |
| 4 | **Xem chi tiết** | Chọn đúng 1 dòng → **Xem** / `Alt+V`, hoặc nút Xem trên dòng. Hộp thoại chỉ đọc hiển thị **đủ 10 trường** kèm nhãn (mã `SP000001` và ProductID gốc, giá đã định dạng, ngày theo giờ Việt Nam, giá trị trống hiện “—”) và ảnh lớn hoặc “Không có ảnh”. Nút **Sửa** và **Đóng**. | `GET /api/products/:id` |
| 5 | **Xóa một/nhiều** | Nút Xóa trên dòng (xóa dòng đó) hoặc chọn các dòng → **Xóa** / `Alt+X`. Luôn mở hộp **Xác nhận xóa**: `Bạn có chắc muốn xóa N sản phẩm?`, liệt kê tối đa 5 dòng `SP000001 – Tên` và `… và K sản phẩm khác`; nút **Hủy** được focus sẵn, nút **Xóa** màu đỏ. | 1 sản phẩm: `DELETE /api/products/:id`; nhiều: `POST /api/products/bulk-delete` |
| 6 | **Tìm kiếm** | Ô tìm kiếm (`Alt+Q`): theo mã, tên, mô tả, loại; không phân biệt hoa/thường và dấu. Tự tìm sau khi ngừng gõ 350 ms; `Enter` hoặc nút **Tìm kiếm** tìm ngay; nút × xóa từ khóa. Không có kết quả: `Không tìm thấy sản phẩm phù hợp với "…"`. | `GET /api/products?q=…` |
| 7 | **Sao chép một** | Nút Sao chép trên dòng, hoặc chọn 1 dòng → **Sao chép** / `Alt+C` (không cần xác nhận). Bản sao có ID mới, `CreateDate = UpdateDate =` thời điểm sao chép, tên thêm hậu tố ` (bản sao)` (tên gốc được cắt bớt nếu vượt 200 ký tự), dùng chung đường dẫn ảnh. Sau đó về trang 1, bản sao được làm nổi bật. | `POST /api/products/bulk-copy` với `{ "ids": [id] }` |
| 8 | **Sao chép nhiều** | Chọn nhiều dòng → **Sao chép** / `Alt+C`. Tất cả bản sao được tạo trong **một giao dịch database**, theo thứ tự ProductID tăng dần của bản gốc, cùng một thời điểm tạo. Thông báo `Đã sao chép N sản phẩm`. | `POST /api/products/bulk-copy` |
| 9 | **Nhập/xuất file** | **Nhập file** → hộp thoại (chọn hoặc kéo thả file `.xlsx`/`.json`/`.xml`, xem quy định, tải file mẫu) → **Nhập** (“Đang nhập…”); lỗi được liệt kê theo dòng và trường. **Xuất file ▾** → Excel/JSON/XML: xuất toàn bộ kết quả của từ khóa, bộ lọc và thứ tự sắp xếp đang áp dụng (mọi trang). **File mẫu ▾** → Excel/JSON/XML. Chi tiết ở mục 9. | `POST /import`, `GET /export`, `GET /template` |
| 10 | **Ẩn/hiện cột** | Nút **Ẩn/hiện cột** → mỗi cột dữ liệu (10 cột) một ô chọn, áp dụng ngay (không tải lại dữ liệu). Cột ô chọn và cột Thao tác luôn hiển thị; phải giữ ít nhất một cột dữ liệu (“Cần giữ lại ít nhất một cột dữ liệu.”). **Khôi phục mặc định** hiện lại đủ 10 cột. Lựa chọn lưu trong `localStorage`, khóa **`qlsp.visibleColumns.v1`** (mảng JSON tên trường); dữ liệu hỏng hoặc trình duyệt chặn `localStorage` → dùng mặc định. Không ảnh hưởng tới file xuất. | — |
| 11 | **Phím tắt** | Xem mục 7. Nút **Phím tắt** (hoặc `Alt+H`) mở bảng hướng dẫn được dựng từ cùng bảng định nghĩa phím tắt. | — |

**Trạng thái xử lý:** lớp phủ “Đang tải dữ liệu…” trên bảng, thanh tiến trình khi đang gọi API, nút chuyển sang
“Đang lưu…”, “Đang xóa…”, “Đang sao chép…”, “Đang nhập…”, “Đang xuất…” và bị vô hiệu hóa; thông báo (toast) thành công,
cảnh báo, lỗi (tự ẩn sau khoảng 4 giây, lỗi khoảng 7 giây, có nút đóng). Chỉ một thao tác ghi dữ liệu chạy tại một
thời điểm; thao tác thứ hai bị từ chối với thông báo chờ.

### 6.2. Quy tắc tương tác

- **“Chọn tất cả” chỉ chọn các dòng của trang hiện tại** (ô ở tiêu đề hiển thị trạng thái chọn một phần khi chỉ một số
  dòng được chọn). Bấm vào vùng trống của một dòng cũng chọn/bỏ chọn dòng đó.
- **Chuyển trang, đổi số dòng/trang hoặc đổi từ khóa tìm kiếm sẽ bỏ chọn** tất cả. Tải lại đúng trang đang xem
  (ví dụ sau khi sửa) giữ lại các dòng đã chọn còn tồn tại. Dòng thông tin `Đã chọn N sản phẩm` luôn hiển thị;
  liên kết **Bỏ chọn** xuất hiện khi có dòng được chọn.
- **Sửa và Xem chi tiết yêu cầu đúng một dòng**: nút trên thanh công cụ bị vô hiệu hóa khi số dòng chọn khác 1;
  dùng phím tắt khi chọn 0 hoặc từ 2 dòng thì hiện cảnh báo `Vui lòng chọn đúng một sản phẩm để sửa` /
  `Vui lòng chọn đúng một sản phẩm để xem chi tiết`.
- **Xóa và Sao chép nhận một hoặc nhiều dòng**; không chọn dòng nào thì nút bị vô hiệu hóa, phím tắt báo
  `Vui lòng chọn ít nhất một sản phẩm`.
- Nút trên từng dòng luôn tác động lên chính dòng đó, không phụ thuộc các ô đã chọn.
- **Xóa nhiều và sao chép nhiều là “tất cả hoặc không”**: server nạp và kiểm tra mọi ID trong **một giao dịch**
  (`BEGIN IMMEDIATE … COMMIT`); chỉ cần một ID không tồn tại thì trả 404 liệt kê các ID thiếu, giao dịch bị hủy và
  không sản phẩm nào bị xóa/tạo (ví dụ `Không tìm thấy 2 sản phẩm, chưa xóa sản phẩm nào`). Giao diện hiện thông báo
  của server và tải lại bảng.
- **Sau khi xóa hết trang cuối, tự về trang hợp lệ gần nhất**: giao diện tải lại đúng số trang đang xem; nếu số trang đó
  vượt tổng số trang, server trả về trang cuối hợp lệ (`pagination.page`) và giao diện dùng đúng trang này.
- **Bản sao dùng chung đường dẫn ảnh** với bản gốc (không nhân bản file). Vì vậy **xóa hoặc đổi ảnh của sản phẩm không
  bao giờ xóa file ảnh** trên đĩa, để bản sao không bị mất ảnh.

### 6.3. Tính năng bổ sung (ngoài 11 chức năng của đề)

Bảng `Products` vẫn giữ đúng 10 trường; các tính năng dưới đây chỉ tính toán khi truy vấn.

| Tính năng | Thao tác | API |
|---|---|---|
| **Sắp xếp theo cột** | Bấm tiêu đề cột Mã, Tên sản phẩm, Loại, Số lượng, Đơn vị, Giá, Ngày tạo, Ngày cập nhật: lần đầu sắp tăng dần, bấm lại để đảo chiều (mũi tên ▲/▼, `aria-sort`). Mặc định: Mã giảm dần (mới nhất trước). Cột chữ sắp theo chuỗi đã bỏ dấu (“Áo” đứng cạnh “Ao”). Đổi cách sắp xếp → về trang 1 và bỏ chọn. | `sort`, `order` |
| **Lọc theo loại** | Ô “Tất cả loại” liệt kê các loại đang có kèm số sản phẩm, ví dụ `Laptop (4)`; các cách viết chỉ khác hoa/thường hoặc dấu được gộp làm một. Danh sách tự cập nhật sau khi thêm/sửa/xóa/sao chép/nhập. | `type`, `GET /api/products/types` |
| **Lọc theo tình trạng kho** | Ô “Tất cả tình trạng”: **Còn hàng** (số lượng ≥ 10), **Sắp hết hàng** (1–9), **Hết hàng** (0). Nút **Bỏ lọc** xóa cả hai bộ lọc (giữ từ khóa). Bộ lọc kết hợp với tìm kiếm; đổi bộ lọc → về trang 1 và bỏ chọn. | `stock` |
| **Thẻ thống kê** | Phía trên bảng: Tổng sản phẩm, Tổng tồn kho, Giá trị tồn kho (Σ giá × số lượng), Sắp hết hàng, Hết hàng — tính trên **toàn bộ** kết quả đang lọc (nhãn “Toàn bộ kho” / “Theo bộ lọc hiện tại”). Bấm thẻ **Sắp hết hàng** hoặc **Hết hàng** để lọc nhanh, bấm lại để bỏ lọc. | `summary` trong phản hồi danh sách |
| **Cảnh báo tồn kho** | Cột Số lượng có nhãn đỏ `Hết hàng` (0) hoặc vàng `Sắp hết` (1–9); hộp chi tiết hiện tình trạng kho cạnh số lượng. | — |
| **Giao diện** | Cột ô chọn, Mã, Tên cố định bên trái khi cuộn ngang bảng (cột Thao tác cố định bên phải); mỗi loại sản phẩm một màu nhãn riêng; sản phẩm chưa có ảnh hiện ô chữ cái đầu tô cùng màu với loại. | — |
| **Xuất file theo bộ lọc** | **Xuất file ▾** dùng đúng từ khóa, bộ lọc và thứ tự sắp xếp đang áp dụng. | `GET /export?…&type=&stock=&sort=&order=` |

---

## 7. Phím tắt

| Phím | Hành động | Hàm trong actions registry (cũng là hàm của nút tương ứng) |
|---|---|---|
| `Alt+N` | Thêm sản phẩm mới | `actions.add()` — nút **Thêm mới** |
| `Alt+S` | Lưu biểu mẫu đang mở | `actions.save()` — nút **Lưu** |
| `Alt+U` | Sửa sản phẩm đang chọn (đúng 1) | `actions.edit()` — nút **Sửa** |
| `Alt+V` | Xem chi tiết sản phẩm đang chọn (đúng 1) | `actions.view()` — nút **Xem** |
| `Alt+X` | Xóa sản phẩm đang chọn (luôn hỏi xác nhận) | `actions.remove()` — nút **Xóa** |
| `Alt+C` | Sao chép sản phẩm đang chọn | `actions.copy()` — nút **Sao chép** |
| `Alt+Q` | Đến ô tìm kiếm | `actions.focusSearch()` |
| `Alt+H` | Mở bảng hướng dẫn phím tắt | `actions.help()` — nút **Phím tắt** |
| `Esc` | Đóng hộp thoại/menu đang mở | `actions.closeTop()` — cùng hàm đóng với nút Đóng/Hủy |

Quy tắc:

- Phím tắt và nút giao diện **gọi chung một hàm** trong actions registry (`public/js/main.js`), không có logic trùng lặp.
  Bảng hướng dẫn, gợi ý phím trên nút và bộ xử lý phím đều đọc cùng một bảng định nghĩa trong `public/js/shortcuts.js`.
- Phím được nhận theo vị trí phím vật lý (`KeyboardEvent.code`) kèm `Alt`, không kèm `Ctrl`/`Meta`, nên không phụ thuộc
  bố cục bàn phím hay bộ gõ tiếng Việt. Phím được xử lý thì hành vi mặc định của trình duyệt bị chặn; giữ phím không lặp
  lại thao tác.
- **Khi đang nhập liệu** (con trỏ trong ô nhập văn bản/số, `textarea`, danh sách `select` hoặc vùng `contenteditable`;
  không tính checkbox, radio, nút bấm, ô chọn file, `range`, `color`): **chỉ `Alt+S` và `Esc` được xử lý**, các phím
  khác đi tiếp bình thường.
- **Khi đang mở hộp thoại** (biểu mẫu, chi tiết, xác nhận xóa, nhập file, hướng dẫn): chỉ `Alt+S` và `Esc` được xử lý.
  `Alt+S` chỉ có tác dụng khi biểu mẫu sản phẩm là lớp trên cùng; bấm lần hai trong lúc đang lưu bị bỏ qua.
  Các menu bật lên (Xuất file, File mẫu, Ẩn/hiện cột) không tính là hộp thoại: phím tắt vẫn chạy và menu được đóng trước.
- **`Esc`** đóng lớp trên cùng (menu hoặc hộp thoại) bằng đúng hàm đóng của nút Đóng/Hủy; trong lúc đang lưu, đang
  nhập hoặc đang xóa thì hộp thoại không đóng. Không có gì đang mở mà con trỏ ở ô tìm kiếm thì `Esc` rời khỏi ô tìm kiếm.
- **`Alt+X` không bao giờ xóa trực tiếp**: nó chỉ mở hộp **Xác nhận xóa** (nút **Hủy** được focus sẵn); việc xóa chỉ
  diễn ra khi bấm nút **Xóa** trong hộp đó.
- Bảng hướng dẫn ghi chú: *“Khi đang nhập liệu, chỉ Alt+S (lưu) và Esc (đóng) hoạt động. Phím xóa luôn yêu cầu xác nhận.”*

---

## 8. API

Địa chỉ gốc: `http://localhost:3000/api/products`. Mọi phản hồi của `/api/*` là JSON (trừ xuất file/file mẫu) và có
`Cache-Control: no-store`. Thân JSON gửi lên tối đa 1 MB và cần header `Content-Type: application/json`.

### 8.1. Bảng endpoint

| Phương thức | Đường dẫn | Tham số / thân yêu cầu | Thành công |
|---|---|---|---|
| GET | `/api/products?page=1&pageSize=10&q=...` | `page`: số nguyên ≥ 1, mặc định 1 (vượt tổng số trang → trả trang cuối); `pageSize`: `10` hoặc `15`, mặc định 10; `q`: từ khóa ≤ 200 ký tự, chỉ một giá trị. Tùy chọn: `sort` ∈ `ProductID`, `ProductName`, `ProductType`, `Quantity`, `Unit`, `Price`, `CreateDate`, `UpdateDate` (mặc định `ProductID`); `order` = `asc`/`desc` (mặc định `desc`); `type` = đúng một loại (không phân biệt hoa/thường, dấu); `stock` = `in` (≥ 10) / `low` (1–9) / `out` (0). Giá trị sai → 400 kèm tên tham số | 200 `{ data: Product[], pagination: { page, pageSize, total, totalPages }, q, filters: { type, stock, sort, order }, summary: { totalProducts, totalQuantity, totalValue, lowStock, outOfStock } }` |
| GET | `/api/products/types` | — | 200 `{ data: [ { type: "Laptop", count: 4 }, … ] }` (các loại đang có, gộp cách viết khác hoa/thường hoặc dấu, xếp theo chữ cái) |
| GET | `/api/products/:id` | `:id` = `12` hoặc `SP000012` | 200 `{ data: Product }` |
| POST | `/api/products` | `multipart/form-data`: `ProductName`, `ProductType`, `Quantity`, `Unit`, `Price`, `Description` + file `image` (tùy chọn); **hoặc** JSON cùng các trường + `PathImage` (tùy chọn, tham chiếu ảnh đã có) | 201 `{ data: Product, message: "Đã thêm sản phẩm SP000033" }` |
| PUT | `/api/products/:id` | Như POST, phải gửi đủ các trường bắt buộc. Ảnh: có file `image` → thay ảnh; `removeImage` = `true`/`1`/`on` → bỏ ảnh; JSON có khóa `PathImage` → đặt theo giá trị đó (`null`/`""` = không ảnh); không có các trường trên → **giữ ảnh cũ** | 200 `{ data: Product, message: "Đã cập nhật sản phẩm SP000033" }` |
| DELETE | `/api/products/:id` | — | 200 `{ data: { deleted: 1, ids: [33] }, message: "Đã xóa sản phẩm SP000033" }` |
| POST | `/api/products/bulk-delete` | JSON `{ "ids": [...] }`: 1–1.000 phần tử, mỗi phần tử là ID hoặc mã `SPxxxxxx`; trùng lặp tự loại bỏ | 200 `{ data: { deleted: n, ids: [...] }, message: "Đã xóa n sản phẩm" }` |
| POST | `/api/products/bulk-copy` | JSON `{ "ids": [...] }` (dùng cho cả sao chép một và nhiều), quy tắc `ids` như trên | 201 `{ data: Product[] (các bản sao, ID tăng dần), message: "Đã sao chép n sản phẩm" }` |
| POST | `/api/products/import` | `multipart/form-data`, file trong trường `file` (`.xlsx`, `.json`, `.xml`, ≤ 10 MB) | 201 `{ data: { imported: n, ids: [...] }, message: "Đã nhập n sản phẩm" }` |
| GET | `/api/products/export?format=xlsx\|json\|xml&q=...` | `format` bắt buộc; `q`, `type`, `stock`, `sort`, `order` như danh sách | 200, file `san-pham-YYYYMMDD-HHmmss.<đuôi>` (giờ Việt Nam) |
| GET | `/api/products/template?format=xlsx\|json\|xml` | `format` bắt buộc | 200, file `mau-nhap-san-pham.<đuôi>` |

Trong yêu cầu multipart, trường `PathImage` bị bỏ qua (ảnh chỉ đi qua file `image`); trường `ProductID`, `CreateDate`,
`UpdateDate` và trường lạ luôn bị bỏ qua. `Content-Type` của file tải về: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`application/json; charset=utf-8`, `application/xml; charset=utf-8`, kèm `Content-Disposition: attachment; filename="…"`.

Ngoài API: `/` (giao diện), `/shared/productRules.js` (module dùng chung), `/uploads/<tên-file>` (ảnh).

### 8.2. Ví dụ curl

Các ví dụ viết theo cú pháp Bash (Git Bash, macOS, Linux). Xem [ghi chú cho Windows PowerShell](#83-ghi-chú-khi-dùng-curl-trên-windows) bên dưới.

```bash
# Danh sách: trang 1, 10 dòng, tìm "dien thoai" (không dấu)
curl "http://localhost:3000/api/products?page=1&pageSize=10&q=dien%20thoai"

# Chi tiết (ID hoặc mã)
curl http://localhost:3000/api/products/SP000001

# Thêm mới kèm ảnh (multipart/form-data)
curl -X POST http://localhost:3000/api/products \
  -F "ProductName=Bút bi Thiên Long" \
  -F "ProductType=Văn phòng phẩm" \
  -F "Quantity=120" \
  -F "Unit=Hộp" \
  -F "Price=45000" \
  -F "Description=Mực xanh, ngòi 0,5 mm" \
  -F "image=@anh-but-bi.png;type=image/png"

# Thêm mới bằng JSON, tham chiếu một ảnh đã có trong ứng dụng
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -d '{"ProductName":"Bàn phím cơ","ProductType":"Phụ kiện","Quantity":5,"Unit":"Cái","Price":890000,"PathImage":"/uploads/46cd686e-9056-452d-b785-283eead78236.png"}'

# Sửa, GIỮ ảnh cũ: không gửi file image và không gửi removeImage
curl -X PUT http://localhost:3000/api/products/33 \
  -F "ProductName=Bút bi Thiên Long TL-027" \
  -F "ProductType=Văn phòng phẩm" \
  -F "Quantity=100" \
  -F "Unit=Hộp" \
  -F "Price=47000" \
  -F "Description=Mực xanh, hộp 20 cây"

# Sửa và bỏ ảnh khỏi sản phẩm (file ảnh vẫn giữ trên đĩa)
curl -X PUT http://localhost:3000/api/products/33 \
  -F "ProductName=Bút bi Thiên Long TL-027" -F "ProductType=Văn phòng phẩm" \
  -F "Quantity=100" -F "Unit=Hộp" -F "Price=47000" -F "removeImage=true"

# Xóa một
curl -X DELETE http://localhost:3000/api/products/33

# Xóa nhiều (một giao dịch)
curl -X POST http://localhost:3000/api/products/bulk-delete \
  -H "Content-Type: application/json" \
  -d '{"ids":[31,32,"SP000030"]}'

# Sao chép một hoặc nhiều (một giao dịch)
curl -X POST http://localhost:3000/api/products/bulk-copy \
  -H "Content-Type: application/json" \
  -d '{"ids":[1,2,3]}'

# Nhập file
curl -X POST http://localhost:3000/api/products/import -F "file=@mau-nhap-san-pham.xlsx"

# Xuất toàn bộ kết quả tìm "laptop" ra Excel (-OJ: lưu theo tên file server gửi)
curl -OJ "http://localhost:3000/api/products/export?format=xlsx&q=laptop"

# Tải file mẫu JSON
curl -OJ "http://localhost:3000/api/products/template?format=json"
```

### 8.3. Ghi chú khi dùng curl trên Windows

- Trong Windows PowerShell 5.1, `curl` là bí danh của `Invoke-WebRequest`; hãy gõ **`curl.exe`**, viết lệnh trên một dòng
  (hoặc nối dòng bằng dấu `` ` `` thay cho `\`).
- PowerShell 5.1 làm mất dấu `"` bên trong đối số truyền cho chương trình ngoài, nên `-d '{"ids":[1]}'` tới server thành
  JSON hỏng. Hãy lưu JSON vào file (UTF-8) rồi gửi bằng `--data-binary`:

  ```powershell
  Set-Content -Path ids.json -Value '{"ids":[31,32]}' -Encoding ascii
  curl.exe -X POST http://localhost:3000/api/products/bulk-delete -H "Content-Type: application/json" --data-binary "@ids.json"
  ```

- Nếu chữ tiếng Việt gõ trực tiếp trên dòng lệnh bị lỗi mã hóa (đã gặp với `curl` của Git Bash trên Windows), hãy dùng
  `curl.exe` trong PowerShell hoặc đặt dữ liệu vào file UTF-8 và gửi bằng `--data-binary @file.json`.

### 8.4. Ví dụ phản hồi

Danh sách (`GET /api/products?page=1&pageSize=10&q=dien%20thoai`, rút gọn còn 1 phần tử):

```json
{
  "data": [
    {
      "ProductID": 25,
      "ProductName": "Điện thoại OPPO Reno11 F 5G",
      "PathImage": null,
      "ProductType": "Điện thoại",
      "Quantity": 18,
      "Unit": "Chiếc",
      "Price": 8990000,
      "Description": "Thiết kế mỏng nhẹ, kháng nước IP65",
      "CreateDate": "2026-11-03T17:09:42.000Z",
      "UpdateDate": "2026-11-03T17:09:42.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 10, "total": 4, "totalPages": 1 },
  "q": "dien thoai",
  "filters": { "type": "", "stock": "", "sort": "ProductID", "order": "desc" },
  "summary": { "totalProducts": 4, "totalQuantity": 95, "totalValue": 834550000, "lowStock": 0, "outOfStock": 0 }
}
```

Thêm mới kèm ảnh (201):

```json
{
  "data": {
    "ProductID": 33,
    "ProductName": "Bút bi Thiên Long",
    "PathImage": "/uploads/46cd686e-9056-452d-b785-283eead78236.png",
    "ProductType": "Văn phòng phẩm",
    "Quantity": 120,
    "Unit": "Hộp",
    "Price": 45000,
    "Description": "Mực xanh, ngòi 0,5 mm",
    "CreateDate": "2026-11-04T13:57:56.750Z",
    "UpdateDate": "2026-11-04T13:57:56.750Z"
  },
  "message": "Đã thêm sản phẩm SP000033"
}
```

Mỗi sản phẩm luôn có đúng 10 trường theo thứ tự trên; `PathImage`/`Description` là `null` khi trống. Mã `SP000033`
không phải một trường của API mà được tính khi hiển thị.

### 8.5. Định dạng lỗi

Mọi lỗi của `/api/*` có dạng `{ "error": { "code", "message", "details" } }`; `details` luôn là mảng (có thể rỗng).
Lỗi nhập file có thêm `format`.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dữ liệu không hợp lệ",
    "details": [
      { "field": "ProductName", "message": "Tên sản phẩm là bắt buộc" },
      { "field": "Quantity", "message": "Số lượng phải là số nguyên không âm" },
      { "field": "Price", "message": "Giá phải là số nguyên không âm" }
    ]
  }
}
```

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Không tìm thấy 2 sản phẩm, chưa xóa sản phẩm nào",
    "details": [
      { "id": 999, "message": "Không tìm thấy sản phẩm SP000999" },
      { "id": 1000, "message": "Không tìm thấy sản phẩm SP001000" }
    ]
  }
}
```

Lỗi tham số chỉ có một chi tiết thì `message` chính là thông báo của chi tiết đó (ví dụ
`Số dòng mỗi trang chỉ được là 10 hoặc 15`, `Mã sản phẩm không hợp lệ`, `Định dạng chỉ hỗ trợ xlsx, json hoặc xml`).

### 8.6. Bảng mã lỗi

| `code` | HTTP | Khi nào |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Tham số sai (`page`, `pageSize`, `q`, `format`, `id`, `ids`); dữ liệu sản phẩm sai (mỗi trường một chi tiết); `PathImage` không hợp lệ/không tồn tại; nội dung file ảnh không phải PNG/JPEG/WebP thật hoặc file ảnh rỗng; thân JSON hỏng (`Dữ liệu JSON gửi lên không hợp lệ`); multipart sai định dạng hoặc vượt giới hạn trường biểu mẫu. Mã này cũng đi kèm 415 khi thân JSON không mã hóa UTF-8 hoặc dùng kiểu nén không hỗ trợ. |
| `NOT_FOUND` | 404 | Sản phẩm không tồn tại (mỗi ID thiếu một chi tiết `{ id, message }`); đường dẫn `/api/*` không tồn tại (`Không tìm thấy API GET /api/…`). |
| `FILE_ERROR` | 400 | Không có file; ảnh sai đuôi/kiểu MIME (`Ảnh phải là file PNG, JPEG hoặc WebP`); gửi file vào trường khác `image`/`file` hoặc nhiều hơn một file; file nhập sai đuôi, rỗng, hỏng, không phải UTF-8 (json/xml), JSON/XML sai cú pháp, XML có DTD/ENTITY hoặc thực thể/mã ký tự không hợp lệ, thiếu sheet `Products` hoặc phần tử gốc `<Products>`, tiêu đề cột thiếu/trùng/lạ, cột có dữ liệu nhưng không có tiêu đề, file không có sản phẩm nào, quá 1.000 sản phẩm, file Excel quá lớn khi giải nén. |
| `FILE_TOO_LARGE` | 413 | Ảnh > 5 MB (`details: [{ field: "image", … }]`), file nhập > 10 MB (`details: [{ field: "file", … }]`), thân JSON > 1 MB. |
| `IMPORT_VALIDATION_ERROR` | 400 | Lỗi theo dòng/trường trong file nhập (kể cả ô công thức). Có thêm `format`; `details: [{ row, field, message }]` (`field` là `null` nếu lỗi cả dòng). Không sản phẩm nào được ghi. |
| `INTERNAL_ERROR` | 500 | Lỗi không lường trước: thông báo chung `Đã xảy ra lỗi không mong muốn trên máy chủ. Vui lòng thử lại sau.`, chi tiết chỉ ghi log phía server, không gửi stack trace. |

Yêu cầu không thuộc `/api` mà không tìm thấy trả 404 dạng văn bản `Không tìm thấy trang hoặc tệp yêu cầu`.

---

## 9. Nhập/xuất dữ liệu (Import/Export)

### 9.1. Quy tắc chung khi nhập

| Quy tắc | Chi tiết |
|---|---|
| Định dạng | Xác định theo đuôi file: `.xlsx`, `.json`, `.xml`; sau đó kiểm tra nội dung thật đúng định dạng đó |
| Dung lượng | Tối đa **10 MB** |
| Số sản phẩm | **1 … 1.000** sản phẩm mỗi file (0 → `File không có sản phẩm nào`; quá → `File có 1.001 sản phẩm, vượt quá giới hạn 1.000 sản phẩm`) |
| Trường đọc được | `ProductName`, `PathImage`, `ProductType`, `Quantity`, `Unit`, `Price`, `Description`; bắt buộc: `ProductName`, `ProductType`, `Quantity`, `Unit`, `Price` |
| Tên trường | So khớp không phân biệt hoa/thường, bỏ khoảng trắng hai đầu. `ProductID`, `CreateDate`, `UpdateDate` được chấp nhận (để nhập lại file đã xuất) nhưng **bị bỏ qua**; tên trường khác → lỗi |
| Chỉ thêm mới | Không bao giờ cập nhật sản phẩm có sẵn; **ID và ngày được server sinh lại** (`CreateDate = UpdateDate =` thời điểm nhập) |
| PathImage | Để trống hoặc **chỉ tham chiếu ảnh đã có** trong ứng dụng, dạng `/uploads/ten-file.png` (hoặc `uploads/ten-file.png`); file nhập không chứa dữ liệu ảnh. Ảnh không tồn tại → `Ảnh không tồn tại trong ứng dụng` |
| Kiểm tra trước khi ghi | Đọc và kiểm tra **toàn bộ** file (cấu trúc, rồi từng dòng bằng `validateProductInput` + kiểm tra `PathImage`). Chỉ cần một lỗi → 400 `IMPORT_VALIDATION_ERROR` với thông báo `File có k lỗi, chưa nhập sản phẩm nào` và danh sách mọi lỗi; **không nhập một phần**. Hợp lệ hết → thêm tất cả trong **một giao dịch** |

**Đánh số dòng trong thông báo lỗi** (`details[].row`):

| Định dạng | `row` là | Giao diện hiển thị |
|---|---|---|
| Excel | Số dòng thật trong sheet (dòng tiêu đề = 1, sản phẩm đầu tiên = 2; dòng trống bị bỏ qua nhưng số dòng vẫn theo sheet) | `Dòng 3 – Giá (VNĐ): Giá phải là số nguyên không âm` |
| JSON | Vị trí phần tử trong mảng, đếm từ 1 | `Sản phẩm thứ 2 – Tên sản phẩm: Tên sản phẩm là bắt buộc` |
| XML | Vị trí phần tử `<Product>`, đếm từ 1 | `Sản phẩm thứ 1 – …` |

Lỗi được sắp theo dòng rồi theo thứ tự trường; giao diện liệt kê tối đa 500 dòng lỗi. Ví dụ phản hồi:

```json
{
  "error": {
    "code": "IMPORT_VALIDATION_ERROR",
    "message": "File có 5 lỗi, chưa nhập sản phẩm nào",
    "details": [
      { "row": 1, "field": "Price", "message": "Giá phải là số nguyên không âm" },
      { "row": 2, "field": "ProductName", "message": "Tên sản phẩm là bắt buộc" },
      { "row": 2, "field": "PathImage", "message": "Ảnh không tồn tại trong ứng dụng" },
      { "row": 2, "field": "Quantity", "message": "Số lượng phải là số nguyên không âm" },
      { "row": 2, "field": "Color", "message": "Trường không hợp lệ" }
    ],
    "format": "json"
  }
}
```

### 9.2. Excel (`.xlsx`, ExcelJS)

- Chỉ đọc sheet tên **`Products`** (không phân biệt hoa/thường); các sheet khác bị bỏ qua. Không có → `Không tìm thấy sheet "Products" trong file Excel`.
- **Dòng 1 là tiêu đề, mỗi ô là tên một trường**; dữ liệu từ dòng 2. Thiếu cột bắt buộc, cột trùng, cột lạ hoặc cột có
  dữ liệu mà không có tiêu đề → `FILE_ERROR` liệt kê các cột đó.
- Giá trị ô: số, chuỗi (kể cả rich text, hyperlink lấy phần chữ), ô trống. Ô ngày, đúng/sai, mã lỗi Excel →
  `Kiểu dữ liệu của ô C3 không được hỗ trợ`.
- **Từ chối ô chứa công thức**: `Ô C3 chứa công thức; chỉ chấp nhận giá trị nhập trực tiếp` — cả file bị từ chối.
- File phải là ZIP hợp lệ; tổng dung lượng giải nén khai báo quá 50 MB bị từ chối.

| ProductName | PathImage | ProductType | Quantity | Unit | Price | Description |
|---|---|---|---|---|---|---|
| Bút bi Thiên Long TL-027 | | Văn phòng phẩm | 120 | Hộp | 45000 | Mực xanh, ngòi 0,5 mm, hộp 20 cây |

### 9.3. JSON

- Văn bản UTF-8 (cho phép BOM); cấp ngoài cùng **phải là một mảng** sản phẩm (`File JSON phải là một mảng sản phẩm`).
- Mỗi phần tử là một object; giá trị là chuỗi, số hoặc `null`. Khóa lạ → `Trường không hợp lệ`; hai khóa trùng tên
  (khác hoa/thường) → `Trường bị lặp`.

```json
[
  {
    "ProductName": "Bút bi Thiên Long TL-027",
    "PathImage": "",
    "ProductType": "Văn phòng phẩm",
    "Quantity": 120,
    "Unit": "Hộp",
    "Price": 45000,
    "Description": "Mực xanh, ngòi 0,5 mm, hộp 20 cây"
  }
]
```

### 9.4. XML (fast-xml-parser)

- Văn bản UTF-8. **Từ chối mọi `<!DOCTYPE` hoặc `<!ENTITY`** trước khi phân tích:
  `File XML chứa DTD/ENTITY, không được phép nhập`. Chỉ nhận 5 thực thể chuẩn (`&lt;` `&gt;` `&amp;` `&quot;` `&apos;`)
  và mã ký tự hợp lệ (`&#272;`, `&#x1EC7;`); thực thể khác (ví dụ `&nbsp;`) hoặc mã ký tự không hợp lệ (`&#0;`) →
  `FILE_ERROR` `File XML không hợp lệ (dòng n): …`. Nội dung trong `<![CDATA[…]]>` là văn bản thường.
- Cấu trúc **`<Products><Product>…</Product></Products>`**: đúng một phần tử gốc `<Products>`, bên trong chỉ có `<Product>`.
  Mỗi thẻ con của `<Product>` là một trường; thẻ rỗng (`<Description/>`) là giá trị trống; thuộc tính bị bỏ qua.
  Thẻ lặp → `Trường bị lặp`; thẻ lồng thẻ → `Giá trị không hợp lệ`; thẻ lạ → `Trường không hợp lệ`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Products>
  <Product>
    <ProductName>Bút bi Thiên Long TL-027</ProductName>
    <PathImage></PathImage>
    <ProductType>Văn phòng phẩm</ProductType>
    <Quantity>120</Quantity>
    <Unit>Hộp</Unit>
    <Price>45000</Price>
    <Description>Mực xanh, ngòi 0,5 mm, hộp 20 cây</Description>
  </Product>
</Products>
```

### 9.5. File mẫu

`GET /api/products/template?format=xlsx|json|xml` (menu **File mẫu ▾** hoặc các nút trong hộp thoại nhập) trả về
`mau-nhap-san-pham.xlsx` / `.json` / `.xml` gồm 7 trường nhập được (đúng thứ tự trên) và **2 sản phẩm mẫu** có
`PathImage` để trống. File Excel có thêm sheet **`HuongDan`** ghi hướng dẫn ngắn (khi nhập chỉ sheet `Products` được đọc).
Các file mẫu nhập lại được ngay.

### 9.6. Xuất file

- `GET /api/products/export?format=…&q=…&type=…&stock=…&sort=…&order=…` (menu **Xuất file ▾**) xuất **toàn bộ** sản
  phẩm khớp từ khóa và bộ lọc đang áp dụng, qua tất cả các trang, theo đúng thứ tự sắp xếp đang chọn (mặc định
  ProductID giảm dần).
- Luôn xuất **đủ 10 trường** theo thứ tự `ProductID, ProductName, PathImage, ProductType, Quantity, Unit, Price,
  Description, CreateDate, UpdateDate`, **độc lập với cấu hình ẩn/hiện cột** trên giao diện.
- Excel: sheet `Products`, dòng 1 là tên trường (in đậm, cố định khi cuộn), số lưu dạng số, ngày dạng chuỗi ISO UTC,
  giá trị trống là ô trống. JSON: mảng object 10 trường (trống = `null`). XML: `<?xml …?>` + `<Products><Product>…</Product></Products>`,
  có thụt lề, ký tự đặc biệt được escape, trống = thẻ rỗng.
- File xuất ra có thể nhập lại (các trường ID/ngày bị bỏ qua và được sinh mới).

---

## 10. Ảnh sản phẩm

| Quy tắc | Chi tiết |
|---|---|
| Định dạng | **PNG, JPEG, WebP** — đuôi `.png`, `.jpg`, `.jpeg`, `.webp`; kiểu MIME `image/png`, `image/jpeg`, `image/webp` (MIME trống hoặc `application/octet-stream` cũng được nhận vì nội dung sẽ được kiểm tra) |
| Dung lượng | **≤ 5 MB** (Multer `limits.fileSize`; vượt → 413 `Ảnh vượt quá dung lượng tối đa 5 MB`); file rỗng bị từ chối |
| Số lượng | Một file trong trường `image` của yêu cầu multipart |
| Nhận file | Multer `memoryStorage`: file nằm trong bộ nhớ, **chưa ghi gì ra đĩa** cho tới khi toàn bộ dữ liệu hợp lệ |
| Kiểm tra nội dung | Theo **magic bytes**, không tin đuôi file hay MIME do trình duyệt gửi: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `RIFF????WEBP`. Sai → `Nội dung file không phải ảnh PNG, JPEG hoặc WebP hợp lệ` |
| Tên file | **Ngẫu nhiên**: `crypto.randomUUID()` + đuôi theo định dạng thật (`.png`/`.jpg`/`.webp`), ghi với cờ `wx` (không ghi đè) |
| Nơi lưu | Thư mục **`uploads/`** (hoặc `UPLOAD_DIR`); `PathImage = "/uploads/<uuid>.<đuôi>"`, phục vụ tĩnh tại `/uploads/…` (không liệt kê thư mục) |
| Lỗi khi ghi DB | Nếu ghi database thất bại sau khi đã ghi ảnh, file vừa ghi bị xóa ngay (không để file mồ côi của yêu cầu bị từ chối) |

Kiểm tra đuôi/MIME/dung lượng chạy ở cả trình duyệt (`checkImageFileMeta` trong `form.js`) và server (Multer `fileFilter`
và `imageService`); kiểm tra magic bytes chỉ ở server.

**Giữ file ảnh khi xóa sản phẩm.** Bản sao dùng chung đường dẫn ảnh với bản gốc, nên khi xóa sản phẩm, thay ảnh mới
hoặc bỏ ảnh, ứng dụng **không xóa** file ảnh cũ trên đĩa — nếu xóa, bản sao sẽ mất ảnh. Hệ quả là `uploads/` có thể còn
file không được sản phẩm nào dùng; có thể xóa thủ công khi làm lại dữ liệu từ đầu (mục 3.4).

Tham chiếu ảnh qua JSON/file nhập (`PathImage`): chỉ nhận `/uploads/<tên>` hoặc `uploads/<tên>` với tên file hợp lệ
(chữ, số, `_`, `-`, đuôi ảnh; không thư mục con, không URL, không data URI), dài ≤ 255 ký tự và file phải tồn tại.

---

## 11. Kiểm thử tự động và ghi chú phụ thuộc

### 11.1. Chạy kiểm thử

```bash
npm test
```

Lệnh chạy `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 "test/**/*.test.js"` bằng trình chạy
kiểm thử tích hợp `node:test` và `node:assert` (không cần thư viện kiểm thử ngoài), lần lượt từng file `*.test.js`
trong thư mục `test/`. Trên Node.js 24.14.0, toàn bộ kiểm thử chạy xong trong vài giây.

Kiểm thử **không đụng tới dữ liệu thật** trong `data/` và `uploads/`: phần lớn các file tự tạo một ứng dụng riêng bằng
`createApp()` với database `:memory:`, thư mục ảnh tạm trong thư mục tạm của hệ điều hành (tiền tố `qlsp-`, tự xóa khi
xong) và lắng nghe một cổng ngẫu nhiên trên `127.0.0.1`; các kiểm thử về file database và về `src/server.js` dùng
`DB_PATH`/`UPLOAD_DIR` trong thư mục tạm và một cổng còn trống. Vì vậy có thể chạy `npm test` cả khi ứng dụng đang mở ở
cổng 3000. Các yêu cầu được gửi qua HTTP thật (`fetch`, `FormData`), tức là đi qua đủ route → controller → service →
repository.

| File | Nội dung kiểm tra |
|---|---|
| `test/productRules.test.js` | Module dùng chung: hằng số và giới hạn, `formatNumberVi`, `formatProductCode`, `parseProductId`, chuẩn hóa/tách từ khóa tìm kiếm, `buildCopyName`, `validateProductInput`, `normalizeImageReference`, `checkImageFileMeta`, `detectImportFormat`/`checkImportFileMeta` |
| `test/listSearch.test.js` | Phân trang (mặc định 10, chọn 15, trang vượt quá → trang cuối, tham số sai → 400); tìm kiếm theo tên, loại, mô tả, mã; không phân biệt dấu và hoa/thường, `đ` → `d`, nhiều từ (AND), ký tự `%`, `_`, `\` theo nghĩa đen, giới hạn 200 ký tự; xóa hết trang cuối → về trang hợp lệ gần nhất |
| `test/products.test.js` | Thêm bằng JSON và multipart kèm ảnh PNG/JPEG/WebP (magic bytes, tên ngẫu nhiên, ảnh giả bị từ chối, giới hạn 5 MB); xem chi tiết; sửa (giữ ảnh cũ, thay ảnh, bỏ ảnh); xóa một; xóa nhiều và sao chép nhiều theo giao dịch (thiếu một ID → không thay đổi gì); bản sao dùng chung ảnh và ảnh được giữ khi xóa bản gốc; xử lý 1.000 ID trong một yêu cầu |
| `test/importExport.test.js` | Xuất 3 định dạng (header, tên file giờ Việt Nam, đủ 10 trường, mọi trang, theo từ khóa); file mẫu và nhập lại file mẫu; nhập thành công (ID/ngày sinh lại, chỉ thêm mới); xuất rồi nhập lại giữ nguyên dữ liệu; lỗi file (sai đuôi, rỗng, > 10 MB, nội dung không khớp đuôi, zip bomb); XML có DTD/ENTITY hoặc thực thể lạ; JSON sai; ô công thức Excel, thiếu sheet/cột; đánh số dòng trong thông báo lỗi; PathImage không tồn tại; giới hạn 1.000 sản phẩm |
| `test/sortFilter.test.js` | Sắp xếp theo từng cột tăng/giảm (thứ tự tiếng Việt bỏ dấu, ProductID phân định khi bằng nhau); tham số `sort`/`order`/`type`/`stock` sai hoặc lặp → 400; lọc loại chính xác, không phân biệt dấu/hoa thường; ranh giới tình trạng kho 0/1/9/10; kết hợp với tìm kiếm và phân trang; giá trị `summary` (kể cả kết quả rỗng và Σ giá × số lượng rất lớn); `/types`; xuất file theo bộ lọc và thứ tự |
| `test/app.test.js` | Phục vụ giao diện và file tĩnh, chặn truy cập ngoài thư mục, header bảo mật, `Cache-Control: no-store`; định dạng lỗi `{ error: { code, message, details } }` cho 400/404/413/500; bảng `Products` đúng 10 cột, `CHECK`, `AUTOINCREMENT`, giao dịch rollback, hàm `vn_norm`; tiện ích thời gian |
| `test/seed.test.js` | 32 sản phẩm mẫu hợp lệ, 8 loại, không ảnh; chỉ thêm khi database mới; `seedSampleData = false`; tự tạo thư mục; dữ liệu bền vững giữa các lần mở |
| `test/server.test.js` | Chạy `src/server.js` thật: một lệnh phục vụ giao diện + API, `SEED_SAMPLE_DATA=false`, `Ctrl+C` (SIGINT) thoát mã 0, cổng bận → thông báo tiếng Việt và thoát mã 1 |

Kết quả mong đợi: mọi kiểm thử đều `pass`, dòng tổng kết có `fail 0`.

### 11.2. Ghi chú về `npm audit`

`npm audit` báo **9 cảnh báo mức moderate**, đều đến từ **phụ thuộc gián tiếp của ExcelJS 4.4.0**:

- `minimatch` (qua `archiver` → `archiver-utils`/`readdir-glob` → `glob`): nguy cơ từ chối dịch vụ khi so khớp mẫu
  glob do kẻ tấn công kiểm soát. `archiver` chỉ được ExcelJS dùng trong bộ ghi dạng stream (`WorkbookWriter`); ứng dụng
  đọc/ghi Excel bằng `workbook.xlsx.load()` / `writeBuffer()` và không đưa mẫu glob nào vào thư viện.
- `uuid`: thiếu kiểm tra biên khi truyền tham số `buf` cho v3/v5/v6. ExcelJS chỉ gọi `uuid.v4()` không có `buf`; tên
  file ảnh của ứng dụng dùng `crypto.randomUUID()` của Node.js.

Các cảnh báo này không ảnh hưởng cách dùng trong bài. **Không chạy `npm audit fix --force`**: lệnh đó hạ ExcelJS xuống
3.4.0 (thay đổi không tương thích).
