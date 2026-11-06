import {
  DEFAULT_SORT,
  LOW_STOCK_THRESHOLD,
  PRODUCT_FIELDS,
  SORT_FIELDS,
  SORT_ORDERS,
  TEXT_SORT_FIELDS,
} from '../../shared/productRules.js';
import { withTransaction } from '../db/database.js';

const SELECT_COLUMNS = PRODUCT_FIELDS.join(', ');
/** Cột được ghi khi thêm mới (ProductID do SQLite tự tăng). */
const INSERT_FIELDS = PRODUCT_FIELDS.filter((field) => field !== 'ProductID');
/** Cột được ghi khi cập nhật (CreateDate giữ nguyên). */
const UPDATE_FIELDS = INSERT_FIELDS.filter((field) => field !== 'CreateDate');
const OPTIONAL_TEXT_FIELDS = new Set(['PathImage', 'Description']);

/**
 * Các biểu thức được so khớp khi tìm kiếm: mã hiển thị (SP000001), tên, mô tả, loại.
 * Cả dữ liệu lẫn từ khóa đều đi qua vn_norm, nên "dien thoai" khớp "Điện thoại".
 */
const SEARCH_EXPRESSIONS = [
  "vn_norm('SP' || printf('%06d', ProductID))",
  'vn_norm(ProductName)',
  'vn_norm(Description)',
  'vn_norm(ProductType)',
];

/** Số tham số "?" tối đa trong một câu IN (...); danh sách dài hơn được chia nhỏ. */
const ID_CHUNK_SIZE = 500;

/**
 * Thoát ký tự đặc biệt của LIKE (\, %, _) để từ khóa được so khớp theo nghĩa đen (ESCAPE '\').
 * @param {string} text
 * @returns {string}
 */
export function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, '\\$&');
}

/**
 * Ngưỡng "sắp hết hàng" lấy từ shared rules (hằng số của ứng dụng, không phải dữ liệu người dùng) nên được viết
 * thẳng vào SQL; kiểm tra là số nguyên để chắc chắn chỉ có chữ số đi vào câu lệnh.
 */
const LOW_STOCK = Number(LOW_STOCK_THRESHOLD);
if (!Number.isSafeInteger(LOW_STOCK) || LOW_STOCK < 1) {
  throw new TypeError('LOW_STOCK_THRESHOLD phải là số nguyên dương');
}
const LOW_STOCK_CONDITION = `Quantity > 0 AND Quantity < ${LOW_STOCK}`;

/** Điều kiện của từng tình trạng kho: out = 0, low = 1 … ngưỡng - 1, in = từ ngưỡng trở lên. */
const STOCK_CONDITIONS = Object.freeze({
  out: 'Quantity = 0',
  low: LOW_STOCK_CONDITION,
  in: `Quantity >= ${LOW_STOCK}`,
});

/**
 * Mệnh đề ORDER BY cho mọi cặp (cột, chiều) hợp lệ, dựng sẵn từ danh sách cột cho phép (SORT_FIELDS):
 * tên cột trong SQL không bao giờ lấy trực tiếp từ dữ liệu người dùng.
 * - Cột chữ: theo chuỗi đã bỏ dấu (vn_norm) để "Áo" đứng cạnh "Ao", rồi theo chuỗi gốc, cuối cùng theo ProductID.
 * - Cột khác: theo giá trị cột rồi ProductID (thứ tự luôn xác định, phân trang không trùng/sót dòng).
 */
const ORDER_BY_CLAUSES = new Map(
  SORT_FIELDS.flatMap((field) =>
    SORT_ORDERS.map((order) => {
      let keys;
      if (field === 'ProductID') keys = [field];
      else if (TEXT_SORT_FIELDS.includes(field)) keys = [`vn_norm(${field})`, field, 'ProductID'];
      else keys = [field, 'ProductID'];
      const direction = ` ${order.toUpperCase()}`;
      return [`${field}:${order}`, ` ORDER BY ${keys.map((key) => key + direction).join(', ')}`];
    }),
  ),
);

/**
 * Mệnh đề ORDER BY theo cột/chiều đã được service kiểm tra; thiếu thì dùng mặc định (ProductID giảm dần).
 * @param {string} [sort] một giá trị của SORT_FIELDS
 * @param {string} [order] 'asc' | 'desc'
 */
function buildOrderBy(sort = DEFAULT_SORT.sort, order = DEFAULT_SORT.order) {
  const clause = ORDER_BY_CLAUSES.get(`${sort}:${order}`);
  if (!clause) throw new TypeError(`Cách sắp xếp không được hỗ trợ: ${sort} ${order}`);
  return clause;
}

/**
 * Điều kiện WHERE dùng chung cho đếm, trang, xuất file và thống kê (các điều kiện nối bằng AND):
 * - tokens: mỗi từ khóa phải xuất hiện ở ít nhất một trường (mã, tên, mô tả, loại);
 * - type: loại sản phẩm khớp chính xác sau khi chuẩn hóa hai phía (không phân biệt hoa/thường, dấu; không khớp một phần);
 * - stock: tình trạng kho ('in' | 'low' | 'out').
 * Luôn dùng tham số ràng buộc (:t0, :t1, :type, …), không nối chuỗi người dùng vào SQL.
 * @param {{ tokens?: string[], type?: string, stock?: string }} [filter]
 * @returns {{ where: string, params: Record<string, string|number> }}
 */
function buildFilter({ tokens = [], type = '', stock = '' } = {}) {
  const params = {};
  const conditions = tokens.map((token, index) => {
    const name = `t${index}`;
    params[name] = `%${escapeLike(token)}%`;
    const matches = SEARCH_EXPRESSIONS.map((expression) => `${expression} LIKE :${name} ESCAPE '\\'`);
    return `(${matches.join(' OR ')})`;
  });
  if (type) {
    params.type = type;
    conditions.push('vn_norm(ProductType) = vn_norm(:type)');
  }
  if (stock) {
    if (!Object.hasOwn(STOCK_CONDITIONS, stock)) throw new TypeError(`Tình trạng kho không được hỗ trợ: ${stock}`);
    conditions.push(`(${STOCK_CONDITIONS[stock]})`);
  }
  return { where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * Thống kê trong một câu truy vấn tổng hợp. TOTAL() trả về số thực (0.0 khi rỗng) nên không bị lỗi tràn số
 * nguyên như SUM() khi Giá × Số lượng rất lớn; giá trị được ép CAST AS REAL trước khi nhân vì cùng lý do.
 */
const SUMMARY_COLUMNS = `COUNT(*) AS totalProducts,
  TOTAL(Quantity) AS totalQuantity,
  TOTAL(CAST(Price AS REAL) * Quantity) AS totalValue,
  SUM(${LOW_STOCK_CONDITION}) AS lowStock,
  SUM(Quantity = 0) AS outOfStock`;

/** SUM() trả về NULL khi không có dòng nào → luôn đổi về số (0), không bao giờ null. */
function toSummary(row) {
  return {
    totalProducts: Number(row.totalProducts ?? 0),
    totalQuantity: Number(row.totalQuantity ?? 0),
    totalValue: Number(row.totalValue ?? 0),
    lowStock: Number(row.lowStock ?? 0),
    outOfStock: Number(row.outOfStock ?? 0),
  };
}

/** Dòng của node:sqlite là object không có prototype → đổi thành object thường đúng 10 khóa theo thứ tự. */
function toProduct(row) {
  if (!row) return null;
  const product = {};
  for (const field of PRODUCT_FIELDS) {
    const value = row[field] ?? null;
    product[field] = value === '' && OPTIONAL_TEXT_FIELDS.has(field) ? null : value;
  }
  return product;
}

/** Lấy đúng các khóa cần ràng buộc (node:sqlite báo lỗi với khóa thừa và tự gán NULL cho khóa thiếu). */
function pickParams(source, fields) {
  const params = {};
  for (const field of fields) params[field] = source[field] ?? null;
  return params;
}

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

const placeholders = (count) => Array.from({ length: count }, () => '?').join(', ');

/**
 * Repository bảng Products: nơi duy nhất chứa SQL. Mọi hàm đều đồng bộ (DatabaseSync).
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createProductRepository(db) {
  const statementCache = new Map();
  /**
   * Câu lệnh danh sách chỉ có một số hữu hạn biến thể (số từ khóa ≤ 10 × có/không lọc loại × 4 tình trạng kho
   * × 16 cách sắp xếp) nên được cache lại; giá trị người dùng luôn nằm trong tham số ràng buộc.
   */
  const prepareCached = (sql) => {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statementCache.set(sql, statement);
    }
    return statement;
  };

  const findByIdStatement = db.prepare(`SELECT ${SELECT_COLUMNS} FROM Products WHERE ProductID = ?`);
  const insertStatement = db.prepare(
    `INSERT INTO Products (${INSERT_FIELDS.join(', ')})
     VALUES (${INSERT_FIELDS.map((field) => `:${field}`).join(', ')})
     RETURNING ${SELECT_COLUMNS}`,
  );
  const updateStatement = db.prepare(
    `UPDATE Products SET ${UPDATE_FIELDS.map((field) => `${field} = :${field}`).join(', ')}
     WHERE ProductID = :ProductID
     RETURNING ${SELECT_COLUMNS}`,
  );
  const deleteByIdStatement = db.prepare('DELETE FROM Products WHERE ProductID = ?');
  // Gộp các cách viết chỉ khác hoa/thường hoặc dấu ("Laptop"/"laptop") thành một mục, đúng như bộ lọc
  // type (so khớp bằng vn_norm), để số đếm trong danh sách luôn bằng số dòng khi lọc theo loại đó.
  // Tên hiển thị của nhóm: cách viết được dùng nhiều nhất; bằng nhau thì lấy cách viết của sản phẩm mới nhất.
  const listTypesStatement = db.prepare(
    `SELECT type, total AS count FROM (
       SELECT ProductType AS type,
              vn_norm(ProductType) AS sortKey,
              SUM(COUNT(*)) OVER (PARTITION BY vn_norm(ProductType)) AS total,
              ROW_NUMBER() OVER (PARTITION BY vn_norm(ProductType)
                                 ORDER BY COUNT(*) DESC, MAX(ProductID) DESC) AS rank
       FROM Products
       GROUP BY ProductType
     )
     WHERE rank = 1
     ORDER BY sortKey, type`,
  );

  return {
    /**
     * Đếm sản phẩm khớp bộ lọc (từ khóa, loại, tình trạng kho).
     * @param {{ tokens?: string[], type?: string, stock?: string }} [filter]
     * @returns {number}
     */
    count(filter = {}) {
      const { where, params } = buildFilter(filter);
      const row = prepareCached(`SELECT COUNT(*) AS total FROM Products${where}`).get(params);
      return Number(row.total);
    },

    /**
     * Một trang sản phẩm khớp bộ lọc, theo cách sắp xếp yêu cầu (mặc định ProductID giảm dần, mới nhất trước).
     * @param {{ tokens?: string[], type?: string, stock?: string, sort?: string, order?: string,
     *           limit: number, offset: number }} options
     */
    findPage({ sort, order, limit, offset, ...filter }) {
      const { where, params } = buildFilter(filter);
      const sql = `SELECT ${SELECT_COLUMNS} FROM Products${where}${buildOrderBy(sort, order)} LIMIT :limit OFFSET :offset`;
      return prepareCached(sql).all({ ...params, limit, offset }).map(toProduct);
    },

    /**
     * Toàn bộ sản phẩm khớp bộ lọc (dùng cho export), theo cách sắp xếp yêu cầu (mặc định ProductID giảm dần).
     * @param {{ tokens?: string[], type?: string, stock?: string, sort?: string, order?: string }} [options]
     */
    findAll({ sort, order, ...filter } = {}) {
      const { where, params } = buildFilter(filter);
      return prepareCached(`SELECT ${SELECT_COLUMNS} FROM Products${where}${buildOrderBy(sort, order)}`)
        .all(params)
        .map(toProduct);
    },

    /**
     * Thống kê mọi sản phẩm khớp bộ lọc (không chỉ một trang) trong MỘT câu truy vấn tổng hợp.
     * @param {{ tokens?: string[], type?: string, stock?: string }} [filter]
     * @returns {{ totalProducts: number, totalQuantity: number, totalValue: number, lowStock: number, outOfStock: number }}
     */
    summarize(filter = {}) {
      const { where, params } = buildFilter(filter);
      return toSummary(prepareCached(`SELECT ${SUMMARY_COLUMNS} FROM Products${where}`).get(params));
    },

    /**
     * Các loại sản phẩm đang có (giá trị ProductType phân biệt) kèm số sản phẩm của từng loại,
     * xếp theo chuỗi đã bỏ dấu rồi theo chuỗi gốc.
     * @returns {Array<{ type: string, count: number }>}
     */
    listTypes() {
      return listTypesStatement.all().map((row) => ({ type: row.type, count: Number(row.count) }));
    },

    /** @param {number} id */
    findById(id) {
      return toProduct(findByIdStatement.get(id));
    },

    /**
     * Các sản phẩm có ID trong danh sách (thứ tự bất kỳ; ID không tồn tại bị bỏ qua).
     * @param {number[]} ids
     */
    findByIds(ids) {
      return chunk(ids, ID_CHUNK_SIZE).flatMap((part) =>
        db
          .prepare(`SELECT ${SELECT_COLUMNS} FROM Products WHERE ProductID IN (${placeholders(part.length)})`)
          .all(...part)
          .map(toProduct),
      );
    },

    /**
     * Thêm sản phẩm; fields gồm mọi cột trừ ProductID.
     * @param {Record<string, unknown>} fields
     */
    insert(fields) {
      return toProduct(insertStatement.get(pickParams(fields, INSERT_FIELDS)));
    },

    /**
     * Cập nhật sản phẩm (mọi cột trừ ProductID, CreateDate).
     * @param {number} id
     * @param {Record<string, unknown>} fields
     * @returns {object|null} sản phẩm sau khi sửa, hoặc null nếu không tồn tại
     */
    update(id, fields) {
      return toProduct(updateStatement.get({ ...pickParams(fields, UPDATE_FIELDS), ProductID: id }));
    },

    /**
     * @param {number} id
     * @returns {number} số dòng đã xóa (0 hoặc 1)
     */
    deleteById(id) {
      return Number(deleteByIdStatement.run(id).changes);
    },

    /**
     * @param {number[]} ids
     * @returns {number} số dòng đã xóa
     */
    deleteByIds(ids) {
      return chunk(ids, ID_CHUNK_SIZE).reduce(
        (total, part) =>
          total +
          Number(db.prepare(`DELETE FROM Products WHERE ProductID IN (${placeholders(part.length)})`).run(...part).changes),
        0,
      );
    },

    /**
     * Chạy fn (đồng bộ) trong một giao dịch: toàn bộ thành công hoặc hủy toàn bộ.
     * @template T
     * @param {() => T} fn
     * @returns {T}
     */
    transaction(fn) {
      return withTransaction(db, fn);
    },
  };
}
