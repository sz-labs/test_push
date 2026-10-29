const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('./src/config');
const { initDatabase } = require('./src/db');
const { createAuthService } = require('./src/auth');
const { createDashboardRouter } = require('./src/dashboard-routes');
const { createUploadRouter } = require('./src/upload-routes');

const app = express();
const auth = createAuthService(config.security.adminPassword);
const allowedOrigins = new Set(config.security.allowedOrigins);

function clientIp(request) {
  const scfRuntime = process.env.SCF_RUNTIME || process.env.TENCENTCLOUD_RUNENV;
  const supplied = scfRuntime ? request.get('x-scf-remote-addr') : '';
  return supplied || request.socket.remoteAddress || 'unknown';
}

app.disable('x-powered-by');
app.use((request, response, next) => {
  const origin = request.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  }
  response.set('X-Content-Type-Options', 'nosniff');
  response.set('Cache-Control', 'no-store');
  if (request.method === 'OPTIONS') {
    response.sendStatus(!origin || allowedOrigins.has(origin) ? 204 : 403);
    return;
  }
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(createDashboardRouter());
app.use(createUploadRouter({ auth, clientIp }));
app.use('/icons', express.static(path.join(__dirname, 'node_modules', 'lucide-static', 'icons')));
app.use(express.static(path.join(__dirname, 'public')));

app.use((error, _request, response, _next) => {
  const validationError = /只支持|未找到|缺少|无法识别|请选择|表头|Excel|文件|工作表/.test(error.message || '');
  const status = Number(error.statusCode) || (error instanceof multer.MulterError || validationError ? 400 : 500);
  if (status >= 500) console.error('[inventory-api]', error.code || error.name || 'SERVER_ERROR');
  response.status(status).json({
    message: status >= 500 && !error.expose
      ? '服务器处理失败，请稍后重试。'
      : (error.message || '请求处理失败。'),
  });
});

async function start() {
  await initDatabase();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.server.port, config.server.host, (error) => {
      if (error) return reject(error);
      console.log(`库存看板已启动：http://${config.server.host}:${config.server.port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('启动失败：', error.code || error.name || 'SERVER_ERROR');
    process.exitCode = 1;
  });
}

module.exports = { app, start };
