import { createApp } from './app.js';
import { config } from './config.js';

/** Thời gian chờ tối đa để các kết nối đang mở kết thúc khi tắt máy chủ. */
const SHUTDOWN_TIMEOUT_MS = 5000;

const { app, close } = createApp();
const server = app.listen(config.port);

server.on('listening', () => {
  console.log(`Ứng dụng đang chạy tại http://localhost:${server.address().port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Cổng ${config.port} đang được một chương trình khác sử dụng. ` +
        'Hãy tắt chương trình đó hoặc chạy với cổng khác, ví dụ: PORT=3001 npm start',
    );
  } else {
    console.error('Không khởi động được máy chủ:', err);
  }
  close();
  process.exit(1);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Đang tắt máy chủ…');
  server.close(() => {
    close();
    process.exit(0);
  });
  server.closeIdleConnections();
  // Kết nối còn treo quá lâu thì đóng cưỡng bức để tiến trình thoát được.
  setTimeout(() => {
    server.closeAllConnections();
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
