/**
 * Điểm khởi động src/server.js (lệnh `npm start`): chạy bằng một lệnh, phục vụ cả giao diện lẫn API,
 * đọc cấu hình từ biến môi trường, báo lỗi rõ ràng khi cổng đang bận.
 * Mỗi tiến trình con dùng database và thư mục uploads tạm, không đụng tới data/ và uploads/ của dự án.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempDir } from './helpers.js';

const SERVER_ENTRY = fileURLToPath(new URL('../src/server.js', import.meta.url));
const tempDir = makeTempDir();
const children = new Set();

after(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Một cổng TCP đang trống (mở rồi đóng ngay một server tạm). */
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * Windows không gửi được SIGINT/SIGTERM thật cho tiến trình con, nên bản bọc này nạp src/server.js rồi tự
 * phát sự kiện SIGINT khi nhận được một dòng từ stdin (cùng đường xử lý như khi người dùng nhấn Ctrl+C).
 */
const SIGINT_ON_STDIN_WRAPPER =
  "process.stdin.once('data', () => process.emit('SIGINT'));\n" +
  `await import(${JSON.stringify(pathToFileURL(SERVER_ENTRY).href)});`;

/** Chạy src/server.js trong tiến trình con với biến môi trường riêng. */
function runServer(name, env, { sigintOnStdin = false } = {}) {
  const dir = path.join(tempDir, name);
  const args = sigintOnStdin ? ['--input-type=module', '-e', SIGINT_ON_STDIN_WRAPPER] : [SERVER_ENTRY];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], {
    env: { ...process.env, DB_PATH: path.join(dir, 'data', 'products.db'), UPLOAD_DIR: path.join(dir, 'uploads'), ...env },
    stdio: [sigintOnStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output.stderr += chunk; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));

  /** Chờ tới khi stdout khớp pattern (hoặc tiến trình thoát / quá thời gian). */
  function waitForOutput(pattern, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Hết thời gian chờ. stdout: ${output.stdout} stderr: ${output.stderr}`)), timeoutMs);
      const check = () => {
        const match = pattern.exec(output.stdout);
        if (match) finish(null, match);
      };
      const onExit = (code) => finish(new Error(`Tiến trình thoát (mã ${code}). stderr: ${output.stderr}`));
      function finish(err, match) {
        clearTimeout(timer);
        child.stdout.off('data', check);
        child.off('exit', onExit);
        if (err) reject(err);
        else resolve(match);
      }
      child.stdout.on('data', check);
      child.once('exit', onExit);
      check();
    });
  }

  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }

  return { child, dir, output, exited, waitForOutput, stop };
}

describe('src/server.js (npm start)', () => {
  test('một lệnh chạy cả giao diện và API, in địa chỉ truy cập, tạo database + dữ liệu mẫu', async () => {
    const port = await freePort();
    const server = runServer('mac-dinh', { PORT: String(port), SEED_SAMPLE_DATA: '' });
    try {
      const [, printedPort] = await server.waitForOutput(/Ứng dụng đang chạy tại http:\/\/localhost:(\d+)/);
      assert.equal(Number(printedPort), port);

      const page = await fetch(`http://localhost:${port}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type'), /^text\/html/);
      await page.arrayBuffer();

      const api = await fetch(`http://localhost:${port}/api/products`);
      assert.equal(api.status, 200);
      assert.equal((await api.json()).pagination.total, 32);

      assert.ok(fs.existsSync(path.join(server.dir, 'data', 'products.db')), 'file database được tạo theo DB_PATH');
      assert.ok(fs.statSync(path.join(server.dir, 'uploads')).isDirectory(), 'thư mục ảnh được tạo theo UPLOAD_DIR');
    } finally {
      await server.stop();
    }
  });

  test('SEED_SAMPLE_DATA=false → database mới không có dữ liệu mẫu', async () => {
    const port = await freePort();
    const server = runServer('khong-mau', { PORT: String(port), SEED_SAMPLE_DATA: 'false' });
    try {
      await server.waitForOutput(/Ứng dụng đang chạy tại/);
      const api = await fetch(`http://localhost:${port}/api/products`);
      assert.equal((await api.json()).pagination.total, 0);
    } finally {
      await server.stop();
    }
  });

  test('Ctrl+C (SIGINT) → tắt máy chủ và thoát với mã 0, kể cả khi còn kết nối keep-alive', async () => {
    const port = await freePort();
    const server = runServer('tat-may', { PORT: String(port), SEED_SAMPLE_DATA: 'false' }, { sigintOnStdin: true });
    await server.waitForOutput(/Ứng dụng đang chạy tại/);
    const res = await fetch(`http://localhost:${port}/api/products`, { headers: { connection: 'keep-alive' } });
    assert.equal(res.status, 200);
    await res.arrayBuffer();

    server.child.stdin.end('dừng\n');
    assert.equal(await server.exited, 0);
    assert.match(server.output.stdout, /Đang tắt máy chủ…/);
  });

  test('cổng đang bận → thông báo tiếng Việt rõ ràng và thoát với mã 1', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, resolve));
    const { port } = blocker.address();
    try {
      const server = runServer('cong-ban', { PORT: String(port), SEED_SAMPLE_DATA: 'false' });
      assert.equal(await server.exited, 1);
      assert.match(server.output.stderr, new RegExp(`Cổng ${port} đang được một chương trình khác sử dụng`));
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});
