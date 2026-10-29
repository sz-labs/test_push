const crypto = require('node:crypto');
const { pool } = require('./db');
const config = require('./config');
const { httpError } = require('./http-errors');

function clientKey(request) {
  const cloud = process.env.SCF_RUNTIME || process.env.TENCENTCLOUD_RUNENV;
  const address = (cloud && request.get('x-scf-remote-addr')) || request.socket.remoteAddress || 'unknown';
  return crypto.createHmac('sha256', config.auth.sessionSecret).update(address).digest('hex');
}

async function check(key) {
  const [[row]] = await pool.execute(
    `SELECT locked_until > UTC_TIMESTAMP(3) AS locked,
      TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), locked_until) AS retry_after
     FROM dashboard_login_attempts WHERE client_key = ?`, [key]
  );
  if (row && Number(row.locked)) {
    const error = httpError(429, '登录失败次数过多，请十五分钟后重试。');
    error.retryAfter = Math.max(1, Number(row.retry_after));
    throw error;
  }
}

async function record(key, valid) {
  if (valid) {
    await pool.execute('DELETE FROM dashboard_login_attempts WHERE client_key = ?', [key]);
    return;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM dashboard_login_attempts WHERE started_at < UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE LIMIT 100');
    await connection.execute(
      `INSERT IGNORE INTO dashboard_login_attempts (client_key, failures, started_at)
       VALUES (?, 0, UTC_TIMESTAMP(3))`, [key]
    );
    await connection.execute(
      `UPDATE dashboard_login_attempts SET
         locked_until = CASE WHEN failures + 1 >= 5 THEN UTC_TIMESTAMP(3) + INTERVAL 15 MINUTE ELSE NULL END,
         failures = failures + 1
       WHERE client_key = ?`, [key]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { clientKey, check, record };
