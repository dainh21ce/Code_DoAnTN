## 🔧 Các tính năng chính

### 1. Giám sát nhiệt độ & độ ẩm
- Hiển thị real-time cho 2 tầng
- Biểu đồ theo thời gian
- Lưu trữ lịch sử

### 2. Điều khiển thiết bị
- Bật/tắt từ xa
- Trạng thái real-time
- Điều khiển cho 2 tầng độc lập

### 3. Báo cáo điện năng
- Tính toán tiêu thụ điện
- Ước tính chi phí
- Cấu hình công suất & giá điện

### 4. Thông tin thời tiết
- Dữ liệu từ OpenWeatherMap
- Cập nhật định kỳ
- Hiển thị chi tiết

### 5. Camera giám sát
- Đếm chim vào/ra
- Cảnh báo chim lạ
- Livestream (coming soon)

## 📱 Responsive Design

Giao diện tự động điều chỉnh cho:
- Desktop (> 1024px)
- Tablet (769px - 1024px)
- Mobile (< 768px)

## 🔌 API Backend

Hệ thống cần backend API với các endpoints:
- `/data` - Lấy dữ liệu cảm biến
- `/history/:floor` - Lấy lịch sử
- `/floor:floor/:device` - Điều khiển thiết bị
- `/energy-report` - Báo cáo điện năng
- `/export-excel` - Xuất Excel

## 📝 Lưu ý

- Cần kết nối internet để sử dụng Chart.js và API thời tiết
- Đảm bảo backend server đang chạy
- Cấu hình CORS trên server nếu cần

## 👨‍💻 Phát triển

Để phát triển thêm tính năng:
1. Tạo module mới trong thư mục `js/`
2. Import vào `main.js`
3. Khởi tạo trong `DOMContentLoaded`

## 📄 License

## 📞 Liên hệ

Email: dainh.21ce@vku.udn.vn