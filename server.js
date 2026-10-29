const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('./src/config');
const { pool, initDatabase, pingDatabase, assertSingleAdmin } = require('./src/db');
const { importExcelBuffer } = require('./src/excel-import');
const { createSessionAuth } = require('./src/session-auth');
const loginLimits = require('./src/login-limits');
const importSessions = require('./src/import-sessions');

const app = express();
const publicDirectory = path.join(__dirname, 'public');
const sessionStore = new MySQLStore({
  createDatabaseTable: false, clearExpired: false, endConnectionOnClose: false,
  expiration: config.auth.sessionHours * 60 * 60 * 1000,
  schema: { tableName: 'dashboard_sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
}, pool);
const sessions = createSessionAuth({ auth: config.auth, store: sessionStore });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = /\.(xlsx|xls)$/i.test(file.originalname);
    callback(allowed ? null : new Error('只支持 .xlsx 或 .xls 文件'), allowed);
  },
});

app.disable('x-powered-by');
app.use((request, response, next) => {
  const origin = request.get('origin');
  const allowed = !origin || config.allowedOrigins.includes(origin);
  if (origin && allowed) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  }
  response.set('Cache-Control', 'no-store');
  response.set('X-Content-Type-Options', 'nosniff');
  if (request.method === 'OPTIONS') return response.sendStatus(allowed ? 204 : 403);
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(sessions.middleware);
app.use('/icons', express.static(path.join(__dirname, 'node_modules', 'lucide-static', 'icons')));

function rejectUnauthenticated(request, response) {
  if (request.path.startsWith('/api/')) {
    response.status(401).json({ message: '登录已失效，请重新登录。' });
    return;
  }
  response.redirect('/login');
}

async function requireAuth(request, response, next) {
  if (!request.session?.authenticated || !request.session.userId) {
    rejectUnauthenticated(request, response);
    return;
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, username, role, is_active
       FROM dashboard_users
       WHERE id = ?
       LIMIT 1`,
      [request.session.userId]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      request.session.destroy(() => rejectUnauthenticated(request, response));
      return;
    }

    request.user = user;
    request.session.username = user.username;
    request.session.role = user.role;
    response.set('Cache-Control', 'no-store');
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') {
    response.status(403).json({ message: '只有管理员可以执行此操作。' });
    return;
  }
  next();
}

app.get(['/login', '/login.html'], (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (request.session?.authenticated) {
    response.redirect('/');
    return;
  }
  response.sendFile('login.html', { root: publicDirectory });
});
app.get('/login.css', (_request, response) => {
  response.sendFile('login.css', { root: publicDirectory });
});
app.get('/login.js', (_request, response) => {
  response.sendFile('login.js', { root: publicDirectory });
});
app.get(['/api.js', '/config.js'], (request, response) => {
  response.sendFile(path.basename(request.path), { root: publicDirectory });
});
app.get('/api/health', async (_request, response) => {
  try {
    await pingDatabase();
    response.json({ ok: true, database: 'connected', schema: 'ready' });
  } catch {
    response.status(503).json({ ok: false, code: 'DATABASE_UNAVAILABLE' });
  }
});

app.post('/api/auth/login', async (request, response, next) => {
  const attemptKey = loginLimits.clientKey(request);
  await loginLimits.check(attemptKey);

  const username = String(request.body?.username || '').trim().slice(0, 100);
  const password = String(request.body?.password || '').slice(0, 255);

  let user;
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, password, role, is_active
       FROM dashboard_users
       WHERE username = ?
       LIMIT 1`,
      [username]
    );
    user = rows[0];
  } catch (error) {
    next(error);
    return;
  }
  const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
  const validCredentials = Boolean(user && user.is_active &&
    crypto.timingSafeEqual(digest(password), digest(user.password)));

  if (!validCredentials) {
    await loginLimits.record(attemptKey, false);
    response.status(401).json({ message: '用户名或密码错误。' });
    return;
  }

  await loginLimits.record(attemptKey, true);
  try {
    await pool.execute('UPDATE dashboard_users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  } catch (error) {
    next(error);
    return;
  }
  request.session.regenerate((error) => {
    if (error) {
      next(error);
      return;
    }
    request.session.authenticated = true;
    request.session.userId = user.id;
    request.session.username = user.username;
    request.session.role = user.role;
    request.session.save((saveError) => {
      if (saveError) {
        next(saveError);
        return;
      }
      response.json({ username: user.username, role: user.role,
        accessToken: sessions.issueToken(request), expiresIn: config.auth.sessionHours * 60 * 60 });
    });
  });
});

app.post('/api/auth/logout', requireAuth, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }
    response.clearCookie('inventory.sid');
    response.status(204).end();
  });
});

app.get('/api/auth/session', requireAuth, (request, response) => {
  response.json({
    id: request.user.id,
    username: request.user.username,
    role: request.user.role,
  });
});

app.use(express.static(publicDirectory));
app.use(requireAuth);

app.get('/api/users', requireAdmin, async (_request, response, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, username, role, is_active, created_at, updated_at, last_login_at
      FROM dashboard_users
      ORDER BY role = 'admin' DESC, created_at ASC, id ASC
    `);
    response.json({ rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users', requireAdmin, async (request, response, next) => {
  const username = String(request.body?.username || '').trim();
  const password = String(request.body?.password || '');

  if (!username || username.length > 100) {
    response.status(400).json({ message: '用户名不能为空且不能超过 100 个字符。' });
    return;
  }
  if (!password || password.length > 255) {
    response.status(400).json({ message: '密码不能为空且不能超过 255 个字符。' });
    return;
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO dashboard_users
        (username, password, role, is_active, created_by)
       VALUES (?, ?, 'user', 1, ?)`,
      [username, password, request.user.id]
    );
    response.status(201).json({
      id: result.insertId,
      username,
      role: 'user',
      is_active: 1,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      response.status(409).json({ message: '该用户名已存在。' });
      return;
    }
    next(error);
  }
});

app.patch('/api/users/:id/status', requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  const isActive = request.body?.isActive;
  if (!Number.isSafeInteger(userId) || userId <= 0 || typeof isActive !== 'boolean') {
    response.status(400).json({ message: '用户状态参数无效。' });
    return;
  }

  try {
    const [result] = await pool.execute(
      `UPDATE dashboard_users
       SET is_active = ?
       WHERE id = ? AND role = 'user'`,
      [isActive ? 1 : 0, userId]
    );
    if (!result.affectedRows) {
      response.status(404).json({ message: '普通用户不存在或不能修改管理员状态。' });
      return;
    }
    response.json({ id: userId, is_active: isActive ? 1 : 0 });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/users/:id/password', requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  const password = String(request.body?.password || '');
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    response.status(400).json({ message: '用户参数无效。' });
    return;
  }
  if (!password || password.length > 255) {
    response.status(400).json({ message: '密码不能为空且不能超过 255 个字符。' });
    return;
  }

  try {
    const [result] = await pool.execute(
      'UPDATE dashboard_users SET password = ? WHERE id = ?',
      [password, userId]
    );
    if (!result.affectedRows) {
      response.status(404).json({ message: '用户不存在。' });
      return;
    }
    response.json({ id: userId });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/users/:id', requireAdmin, async (request, response, next) => {
  const userId = Number(request.params.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    response.status(400).json({ message: '用户参数无效。' });
    return;
  }

  try {
    const [result] = await pool.execute(
      "DELETE FROM dashboard_users WHERE id = ? AND role = 'user'",
      [userId]
    );
    if (!result.affectedRows) {
      response.status(404).json({ message: '普通用户不存在或不能删除管理员。' });
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard', async (_request, response, next) => {
  try {
    const [summaryRows] = await pool.query(`
      SELECT
        COUNT(*) AS total_records,
        COUNT(DISTINCT sku_code) AS unique_skus,
        COALESCE(SUM(CASE WHEN change_amount > 0 THEN change_amount ELSE 0 END), 0) AS inbound_qty,
        COALESCE(ABS(SUM(CASE WHEN change_amount < 0 THEN change_amount ELSE 0 END)), 0) AS outbound_qty,
        MAX(occurred_at) AS latest_event_at
      FROM inventory_updates
    `);
    const [stockRows] = await pool.query(`
      SELECT COALESCE(SUM(current_row.new_stock), 0) AS current_stock
      FROM inventory_updates current_row
      WHERE NOT EXISTS (
        SELECT 1
        FROM inventory_updates newer
        WHERE newer.sku_code = current_row.sku_code
          AND COALESCE(newer.warehouse, '') = COALESCE(current_row.warehouse, '')
          AND (
            COALESCE(newer.occurred_at, '1000-01-01 00:00:00')
              > COALESCE(current_row.occurred_at, '1000-01-01 00:00:00')
            OR (
              COALESCE(newer.occurred_at, '1000-01-01 00:00:00')
                = COALESCE(current_row.occurred_at, '1000-01-01 00:00:00')
              AND (
                newer.batch_id > current_row.batch_id
                OR (
                  newer.batch_id = current_row.batch_id
                  AND newer.source_row_number < current_row.source_row_number
                )
              )
            )
          )
      )
    `);
    const [dailyRows] = await pool.query(`
      SELECT
        DATE(occurred_at) AS day,
        COALESCE(SUM(CASE WHEN change_amount > 0 THEN change_amount ELSE 0 END), 0) AS inbound,
        COALESCE(ABS(SUM(CASE WHEN change_amount < 0 THEN change_amount ELSE 0 END)), 0) AS outbound,
        COUNT(*) AS records
      FROM inventory_updates
      WHERE occurred_at IS NOT NULL
        AND occurred_at >= DATE_SUB((SELECT MAX(occurred_at) FROM inventory_updates), INTERVAL 29 DAY)
      GROUP BY DATE(occurred_at)
      ORDER BY day ASC
    `);
    const [typeRows] = await pool.query(`
      SELECT COALESCE(NULLIF(change_type, ''), '未分类') AS name, COUNT(*) AS count
      FROM inventory_updates
      GROUP BY COALESCE(NULLIF(change_type, ''), '未分类')
      ORDER BY count DESC
      LIMIT 8
    `);
    const [warehouseRows] = await pool.query(`
      SELECT DISTINCT warehouse
      FROM inventory_updates
      WHERE warehouse IS NOT NULL AND warehouse <> ''
      ORDER BY warehouse
    `);

    response.json({
      summary: { ...summaryRows[0], current_stock: stockRows[0].current_stock },
      daily: dailyRows,
      types: typeRows,
      warehouses: warehouseRows.map((row) => row.warehouse),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/records', async (request, response, next) => {
  try {
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(request.query.pageSize) || 20));
    const where = [];
    const params = [];

    if (request.query.q) {
      const keyword = `%${String(request.query.q).trim()}%`;
      where.push('(sku_code LIKE ? OR sku_name LIKE ? OR document_number LIKE ?)');
      params.push(keyword, keyword, keyword);
    }
    if (request.query.warehouse) {
      where.push('warehouse = ?');
      params.push(request.query.warehouse);
    }
    if (request.query.type) {
      where.push('change_type = ?');
      params.push(request.query.type);
    }
    if (request.query.direction === 'in') where.push('change_amount > 0');
    if (request.query.direction === 'out') where.push('change_amount < 0');
    if (request.query.dateFrom) {
      where.push('occurred_at >= ?');
      params.push(`${request.query.dateFrom} 00:00:00`);
    }
    if (request.query.dateTo) {
      where.push('occurred_at <= ?');
      params.push(`${request.query.dateTo} 23:59:59`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM inventory_updates ${whereSql}`,
      params
    );
    const offset = (page - 1) * pageSize;
    const [rows] = await pool.execute(
      `SELECT
        id, sku_code, sku_name, account_name, occurred_at, shelf_location,
        previous_stock, change_amount, new_stock, warehouse, previous_cost,
        transaction_cost, current_cost, change_type, document_number
       FROM inventory_updates
       ${whereSql}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    response.json({
      rows,
      page,
      pageSize,
      total: countRows[0].total,
      totalPages: Math.max(1, Math.ceil(countRows[0].total / pageSize)),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/imports', async (_request, response, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        id, file_name, sheet_name, total_rows, inserted_rows,
        duplicate_rows, error_rows, status, error_message, imported_at
      FROM inventory_import_batches
      ORDER BY imported_at DESC, id DESC
      LIMIT 30
    `);
    response.json({ rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/imports', upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ message: '请选择 Excel 文件。' });
    const result = await importExcelBuffer({
      buffer: request.file.buffer,
      fileName: Buffer.from(request.file.originalname, 'latin1').toString('utf8'),
    });
    return response.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/import-sessions', async (request, response) => {
  response.status(201).json(await importSessions.createSession(request.body, request.user.id));
});
app.get('/api/import-sessions/:id', async (request, response) => {
  response.json(await importSessions.status(request.params.id, request.user.id));
});
app.put('/api/import-sessions/:id/chunks/:index', express.raw({ type: 'application/octet-stream', limit: '1mb' }), async (request, response) => {
  response.json(await importSessions.putChunk(request.params.id, Number(request.params.index), request.body, request.user.id));
});
app.post('/api/import-sessions/:id/complete', async (request, response) => {
  response.json(await importSessions.completeSession(request.params.id, request.user.id));
});
app.delete('/api/import-sessions/:id', async (request, response) => {
  response.json(await importSessions.cancelSession(request.params.id, request.user.id));
});

app.use((error, _request, response, _next) => {
  const isUploadError = error instanceof multer.MulterError;
  const status = error.statusCode || (isUploadError || /只支持|未找到|缺少|无法识别/.test(error.message)
    ? 400
    : 500);
  if (status >= 500) console.error('[inventory-api]', error.code || error.name || 'SERVER_ERROR');
  if (error.retryAfter) response.set('Retry-After', String(error.retryAfter));
  response.status(status).json({
    message: isUploadError && error.code === 'LIMIT_FILE_SIZE'
      ? '文件不能超过 20MB。'
      : status >= 500 && !error.expose ? '服务器处理失败，请稍后重试。' : error.message || '请求处理失败。',
  });
});

async function start() {
  await initDatabase();
  await assertSingleAdmin();
  await sessionStore.onReady();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.server.port, config.server.host, (error) => {
      if (error) {
        reject(error);
        return;
      }
      console.log(`库存看板已启动：http://${config.server.host}:${config.server.port}`);
      resolve(server);
    });
  });
}

if (require.main === module) start().catch((error) => {
  console.error('启动失败：', error.code || error.name || 'SERVER_ERROR');
  process.exitCode = 1;
});

module.exports = { app, start, sessionStore };
