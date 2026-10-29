const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const projectRoot = path.resolve(__dirname, '..');

function loadConfig() {
  const configPath = path.resolve(
    process.env.MYSQL_CONFIG_PATH || path.join(projectRoot, 'mysql.yaml')
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(`找不到数据库配置文件：${configPath}`);
  }

  const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
  const mysql = parsed.mysql || {};
  const required = ['host', 'database', 'username'];
  const missing = required.filter((key) => !mysql[key]);

  if (missing.length) {
    throw new Error(`mysql.yaml 缺少配置：${missing.join(', ')}`);
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
