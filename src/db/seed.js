import { createProductRepository } from '../repositories/productRepository.js';

/**
 * Dữ liệu mẫu cho lần chạy đầu tiên: 32 sản phẩm thuộc 8 loại (xếp xen kẽ để trang đầu có nhiều loại),
 * mô tả có dấu tiếng Việt để thử tìm kiếm không phân biệt dấu (ví dụ "dien thoai" → "Điện thoại").
 * Không có ảnh (PathImage = NULL).
 */
const SAMPLE_PRODUCTS = [
  { ProductName: 'Điện thoại Samsung Galaxy A55 5G', ProductType: 'Điện thoại', Quantity: 25, Unit: 'Chiếc', Price: 9490000, Description: 'Màn hình Super AMOLED 6,6 inch, pin 5.000 mAh, bảo hành chính hãng 12 tháng' },
  { ProductName: 'Laptop Dell Inspiron 15 3530', ProductType: 'Laptop', Quantity: 8, Unit: 'Chiếc', Price: 15490000, Description: 'Core i5 thế hệ 13, RAM 8 GB, SSD 512 GB, màn hình 15,6 inch' },
  { ProductName: 'Tai nghe Bluetooth Sony WH-CH520', ProductType: 'Phụ kiện', Quantity: 30, Unit: 'Cái', Price: 1190000, Description: 'Pin 50 giờ, kết nối đa điểm, có micro đàm thoại' },
  { ProductName: 'Nồi cơm điện Sharp 1,8 lít', ProductType: 'Thiết bị gia dụng', Quantity: 20, Unit: 'Cái', Price: 1150000, Description: 'Lòng nồi chống dính, giữ ấm đến 12 giờ' },
  { ProductName: 'Gạo ST25 Sóc Trăng', ProductType: 'Thực phẩm', Quantity: 250, Unit: 'Kg', Price: 38000, Description: 'Gạo thơm dẻo, hạt dài, đóng bao 5 kg hoặc 10 kg' },
  { ProductName: 'Nước khoáng Lavie 500 ml', ProductType: 'Đồ uống', Quantity: 50, Unit: 'Thùng', Price: 95000, Description: 'Thùng 24 chai' },
  { ProductName: 'Giấy in Double A A4 70 gsm', ProductType: 'Văn phòng phẩm', Quantity: 200, Unit: 'Ram', Price: 85000, Description: 'Ram 500 tờ, giấy trắng mịn, ít kẹt giấy' },
  { ProductName: 'Áo thun cotton nam cổ tròn', ProductType: 'Thời trang', Quantity: 90, Unit: 'Cái', Price: 159000, Description: 'Chất liệu 100% cotton, thấm hút mồ hôi tốt' },
  { ProductName: 'Điện thoại iPhone 15 128GB', ProductType: 'Điện thoại', Quantity: 12, Unit: 'Chiếc', Price: 19990000, Description: 'Chip A16 Bionic, camera chính 48 MP, hàng chính hãng VN/A' },
  { ProductName: 'Laptop ASUS Vivobook 14 OLED', ProductType: 'Laptop', Quantity: 10, Unit: 'Chiếc', Price: 16990000, Description: 'Màn hình OLED 14 inch, trọng lượng 1,4 kg' },
  { ProductName: 'Chuột không dây Logitech M331 Silent', ProductType: 'Phụ kiện', Quantity: 55, Unit: 'Cái', Price: 389000, Description: 'Giảm tiếng ồn khi nhấp chuột, pin dùng đến 24 tháng' },
  { ProductName: 'Quạt đứng Panasonic F-308NHP', ProductType: 'Thiết bị gia dụng', Quantity: 14, Unit: 'Cái', Price: 1790000, Description: 'Ba tốc độ gió, hẹn giờ tắt, vận hành êm' },
  { ProductName: 'Cà phê rang xay Trung Nguyên 500 g', ProductType: 'Thực phẩm', Quantity: 35, Unit: 'Gói', Price: 125000, Description: 'Hương vị đậm đà, phù hợp pha phin' },
  { ProductName: 'Trà xanh Không Độ 455 ml', ProductType: 'Đồ uống', Quantity: 100, Unit: 'Chai', Price: 10000, Description: null },
  { ProductName: 'Bút bi Thiên Long TL-027', ProductType: 'Văn phòng phẩm', Quantity: 120, Unit: 'Hộp', Price: 45000, Description: 'Mực xanh, ngòi 0,5 mm, hộp 20 cây' },
  { ProductName: "Giày thể thao Biti's Hunter Street", ProductType: 'Thời trang', Quantity: 22, Unit: 'Đôi', Price: 890000, Description: 'Đế cao su êm chân, thoáng khí' },
  { ProductName: 'Điện thoại Xiaomi Redmi Note 13', ProductType: 'Điện thoại', Quantity: 40, Unit: 'Chiếc', Price: 4890000, Description: 'Sạc nhanh 33 W, màn hình 120 Hz, hai SIM hai sóng' },
  { ProductName: 'Laptop Lenovo ThinkPad E14 Gen 5', ProductType: 'Laptop', Quantity: 0, Unit: 'Chiếc', Price: 21500000, Description: 'Bàn phím chống tràn, phù hợp dân văn phòng; tạm hết hàng' },
  { ProductName: 'Sạc dự phòng Anker PowerCore 10.000 mAh', ProductType: 'Phụ kiện', Quantity: 42, Unit: 'Cái', Price: 650000, Description: 'Hỗ trợ sạc nhanh PD 20 W' },
  { ProductName: 'Máy xay sinh tố Philips HR2221', ProductType: 'Thiết bị gia dụng', Quantity: 9, Unit: 'Cái', Price: 990000, Description: 'Cối nhựa 1,5 lít, lưỡi dao thép không gỉ' },
  { ProductName: 'Mì Hảo Hảo tôm chua cay', ProductType: 'Thực phẩm', Quantity: 80, Unit: 'Thùng', Price: 115000, Description: 'Thùng 30 gói, mỗi gói 75 g' },
  { ProductName: 'Sữa tươi tiệt trùng Vinamilk 1 lít', ProductType: 'Đồ uống', Quantity: 45, Unit: 'Hộp', Price: 36000, Description: 'Sữa tươi không đường, giàu canxi' },
  { ProductName: 'Sổ tay bìa da A5', ProductType: 'Văn phòng phẩm', Quantity: 40, Unit: 'Cái', Price: 65000, Description: 'Giấy kẻ ngang, 200 trang' },
  { ProductName: 'Nón lá Huế', ProductType: 'Thời trang', Quantity: 35, Unit: 'Cái', Price: 75000, Description: 'Hàng thủ công truyền thống, quà tặng du lịch' },
  { ProductName: 'Điện thoại OPPO Reno11 F 5G', ProductType: 'Điện thoại', Quantity: 18, Unit: 'Chiếc', Price: 8990000, Description: 'Thiết kế mỏng nhẹ, kháng nước IP65' },
  { ProductName: 'MacBook Air M2 13 inch', ProductType: 'Laptop', Quantity: 6, Unit: 'Chiếc', Price: 24990000, Description: 'Chip Apple M2, thời lượng pin đến 18 giờ' },
  { ProductName: 'Ốp lưng silicon iPhone 15', ProductType: 'Phụ kiện', Quantity: 120, Unit: 'Cái', Price: 150000, Description: null },
  { ProductName: 'Bộ nồi inox Sunhouse 5 đáy', ProductType: 'Thiết bị gia dụng', Quantity: 7, Unit: 'Bộ', Price: 1450000, Description: 'Gồm 3 nồi, dùng được trên bếp từ' },
  { ProductName: 'Hạt điều rang muối Bình Phước', ProductType: 'Thực phẩm', Quantity: 25, Unit: 'Hộp', Price: 210000, Description: 'Hộp 500 g, hạt to đều, giòn thơm' },
  { ProductName: 'Nước cam ép Twister 1 lít', ProductType: 'Đồ uống', Quantity: 30, Unit: 'Chai', Price: 32000, Description: 'Bổ sung vitamin C' },
  { ProductName: 'Bàn phím cơ AKKO 3087 v2', ProductType: 'Phụ kiện', Quantity: 15, Unit: 'Cái', Price: 1290000, Description: 'Switch Jelly Pink, đèn nền trắng, cổng USB-C' },
  { ProductName: 'Bộ cáp sạc đa năng Ugreen 3 trong 1', ProductType: 'Phụ kiện', Quantity: 64, Unit: 'Bộ', Price: 185000, Description: 'Đầu Lightning, USB-C và Micro USB' },
];

const HOUR_MS = 60 * 60 * 1000;
/** Khoảng cách giữa hai lần tạo liên tiếp: 32 sản phẩm trải đều trong khoảng 3,5 ngày gần đây. */
const CREATE_STEP_MS = 2.6 * HOUR_MS;
/** Một số sản phẩm được "sửa" sau khi tạo để UpdateDate khác CreateDate. */
const UPDATE_OFFSETS_MS = [0, 0.25 * HOUR_MS, 1.5 * HOUR_MS, 26 * HOUR_MS];

const toIsoSeconds = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString();

/**
 * Thêm dữ liệu mẫu trong một giao dịch. Chỉ gọi khi database vừa được tạo mới.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} [now] mốc thời gian (ms) để tính ngày tạo/cập nhật
 * @returns {number} số sản phẩm đã thêm
 */
export function seedSampleData(db, now = Date.now()) {
  const repository = createProductRepository(db);
  repository.transaction(() => {
    SAMPLE_PRODUCTS.forEach((product, index) => {
      const created = now - (SAMPLE_PRODUCTS.length - index) * CREATE_STEP_MS;
      const updated = Math.min(now, created + UPDATE_OFFSETS_MS[index % UPDATE_OFFSETS_MS.length]);
      repository.insert({
        ...product,
        PathImage: null,
        CreateDate: toIsoSeconds(created),
        UpdateDate: toIsoSeconds(updated),
      });
    });
  });
  return SAMPLE_PRODUCTS.length;
}
