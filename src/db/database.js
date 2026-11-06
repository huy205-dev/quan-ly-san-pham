import { DatabaseSync } from 'node:sqlite';
import { normalizeSearchText } from '../../shared/productRules.js';

/** Đúng 10 cột của đề bài, không thêm cột phụ (mã SP000001 và chuỗi tìm kiếm đều tính khi truy vấn). */
const SCHEMA_SQL = `
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
`;

/**
 * Mở (hoặc tạo) database SQLite, đăng ký hàm SQL vn_norm và tạo bảng Products nếu chưa có.
 * vn_norm(x) dùng đúng normalizeSearchText của shared rules, nên chuỗi tìm kiếm và dữ liệu
 * được chuẩn hóa (bỏ dấu, đ → d, chữ thường) theo cùng một quy tắc.
 * @param {string} dbPath đường dẫn file hoặc ':memory:'
 * @returns {DatabaseSync}
 */
export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.function('vn_norm', { deterministic: true }, (value) => normalizeSearchText(value));
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA_SQL);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * Chạy fn trong một giao dịch BEGIN IMMEDIATE … COMMIT; lỗi → ROLLBACK rồi ném lại.
 * DatabaseSync chạy đồng bộ nên fn phải là hàm đồng bộ (không await bên trong giao dịch).
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    // Luôn thử ROLLBACK. Nếu SQLite đã tự rollback (ví dụ khi đầy đĩa), lệnh này báo
    // "no transaction is active" và được bỏ qua. Không dùng db.isTransaction vì thuộc tính đó
    // chỉ có từ Node 24, trong khi package.json cho phép chạy từ Node 22.13.
    try {
      db.exec('ROLLBACK');
    } catch {
      // Không còn giao dịch nào đang mở.
    }
    throw err;
  }
}
