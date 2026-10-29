const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const projectRoot = path.resolve(__dirname, '..');

function loadConfig() {
  const mysqlConfigPath = path.resolve(
    process.env.MYSQL_CONFIG_PATH || path.join(projectRoot, 'mysql.yaml')
  );
  const authConfigPath = path.resolve(
    process.env.AUTH_CONFIG_PATH || path.join(projectRoot, 'auth.yaml')
  );

  if (!process.env.MYSQL_CONFIG_YAML && !fs.existsSync(mysqlConfigPath)) {
    throw new Error('找不到数据库配置。');
  }
  if (!process.env.AUTH_SESSION_SECRET && !fs.existsSync(authConfigPath)) {
    throw new Error('找不到登录配置。');
  }

  const mysqlConfig = yaml.load(process.env.MYSQL_CONFIG_YAML || fs.readFileSync(mysqlConfigPath, 'utf8')) || {};
  const authConfig = process.env.AUTH_SESSION_SECRET
    ? { auth: { session_secret: process.env.AUTH_SESSION_SECRET, session_hours: process.env.AUTH_SESSION_HOURS } }
    : yaml.load(fs.readFileSync(authConfigPath, 'utf8')) || {};
  const mysql = mysqlConfig.mysql || {};
  const auth = authConfig.auth || {};
  const missingMysql = ['host', 'database', 'username'].filter((key) => !mysql[key]);
  const missingAuth = ['session_secret'].filter((key) => !auth[key]);

  if (missingMysql.length) {
    throw new Error(`mysql.yaml 缺少配置：${missingMysql.join(', ')}`);
  }
  if (missingAuth.length) {
    throw new Error(`auth.yaml 缺少配置：${missingAuth.join(', ')}`);
  }
  if (String(auth.session_secret).length < 32) {
    throw new Error('auth.yaml 的 session_secret 至少需要 32 个字符。');
  }

  let ssl;
  if (mysql.ssl?.enabled) {
    ssl = {};
    if (mysql.ssl.ca_file) {
      const caPath = path.resolve(projectRoot, mysql.ssl.ca_file);
      ssl.ca = fs.readFileSync(caPath, 'utf8');
    }
  }

  return {
    projectRoot,
    server: {
      host: process.env.HOST || '127.0.0.1',
      port: Number(process.env.PORT || 3100),
    },
    auth: {
      sessionSecret: String(auth.session_secret),
      sessionHours: Math.max(1, Number(auth.session_hours || 12)),
      production: process.env.NODE_ENV === 'production',
    },
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:3100,http://localhost:3100')
      .split(',').map((value) => value.trim()).filter(Boolean),
    mysql: {
      host: mysql.host,
      port: Number(mysql.port || 3306),
      database: mysql.database,
      user: mysql.username,
      password: mysql.password || '',
      charset: mysql.charset || 'utf8mb4',
      connectTimeout: Number(mysql.connect_timeout_ms || 10000),
      connectionLimit: Number(mysql.pool_size || 5),
      waitForConnections: true,
      queueLimit: 0,
      timezone: '+08:00',
      dateStrings: true,
      decimalNumbers: true,
      ssl,
    },
  };
}

module.exports = loadConfig();
