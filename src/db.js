const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.mysql);

async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('inventory_dashboard_accounts_v1', 15) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('数据库结构初始化锁获取失败。');
    const [tables] = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    const existing = new Set(tables.map((row) => row.TABLE_NAME));
    if (!existing.has('inventory_import_batches')) await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_import_batches (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        file_name VARCHAR(255) NOT NULL,
        sheet_name VARCHAR(255) NULL,
        file_hash CHAR(64) NULL,
        total_rows INT UNSIGNED NOT NULL DEFAULT 0,
        inserted_rows INT UNSIGNED NOT NULL DEFAULT 0,
        duplicate_rows INT UNSIGNED NOT NULL DEFAULT 0,
        error_rows INT UNSIGNED NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'processing',
        error_message TEXT NULL,
        imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_batches_imported_at (imported_at),
        KEY idx_batches_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    if (!existing.has('dashboard_users')) await connection.query(`
      CREATE TABLE IF NOT EXISTS dashboard_users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_login_at DATETIME NULL,
        admin_guard TINYINT GENERATED ALWAYS AS (
          CASE WHEN role = 'admin' THEN 1 ELSE NULL END
        ) STORED,
        PRIMARY KEY (id),
        UNIQUE KEY uq_dashboard_username (username),
        UNIQUE KEY uq_single_dashboard_admin (admin_guard),
        KEY idx_dashboard_users_active (is_active),
        KEY idx_dashboard_users_created_by (created_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    if (!existing.has('inventory_updates')) await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_updates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        batch_id BIGINT UNSIGNED NOT NULL,
        source_row_number INT UNSIGNED NOT NULL,
        sku_code VARCHAR(191) NOT NULL,
        sku_name VARCHAR(500) NULL,
        account_name VARCHAR(255) NULL,
        occurred_at DATETIME NULL,
        shelf_location VARCHAR(255) NULL,
        previous_stock DECIMAL(20,4) NULL,
        change_amount DECIMAL(20,4) NULL,
        new_stock DECIMAL(20,4) NULL,
        warehouse VARCHAR(255) NULL,
        previous_cost DECIMAL(20,4) NULL,
        transaction_cost DECIMAL(20,4) NULL,
        current_cost DECIMAL(20,4) NULL,
        change_type VARCHAR(255) NULL,
        document_number VARCHAR(255) NULL,
        dedupe_hash CHAR(64) NOT NULL,
        raw_data LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_inventory_dedupe_hash (dedupe_hash),
        KEY idx_inventory_occurred_at (occurred_at),
        KEY idx_inventory_sku (sku_code),
        KEY idx_inventory_warehouse (warehouse),
        KEY idx_inventory_type (change_type),
        KEY idx_inventory_document (document_number),
        KEY idx_inventory_latest (sku_code, warehouse, occurred_at, batch_id, source_row_number),
        KEY idx_inventory_batch (batch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!existing.has('dashboard_sessions')) await connection.query(`
      CREATE TABLE IF NOT EXISTS dashboard_sessions (
        session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        expires INT UNSIGNED NOT NULL,
        data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
        PRIMARY KEY (session_id), KEY ix_dashboard_session_expiry (expires)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `);
    if (!existing.has('dashboard_login_attempts')) await connection.query(`
      CREATE TABLE IF NOT EXISTS dashboard_login_attempts (
        client_key CHAR(64) NOT NULL, failures INT UNSIGNED NOT NULL DEFAULT 0,
        started_at DATETIME(3) NOT NULL, locked_until DATETIME(3) NULL,
        PRIMARY KEY (client_key), KEY ix_dashboard_login_window (started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    if (!existing.has('dashboard_import_sessions')) await connection.query(`
      CREATE TABLE IF NOT EXISTS dashboard_import_sessions (
        id CHAR(36) NOT NULL, owner_id BIGINT UNSIGNED NOT NULL,
        filename VARCHAR(255) NOT NULL, file_size INT UNSIGNED NOT NULL,
        sha256 CHAR(64) NOT NULL, chunk_count SMALLINT UNSIGNED NOT NULL,
        upload_id VARCHAR(36) NULL, created_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id), KEY ix_dashboard_import_owner (owner_id), KEY ix_dashboard_import_expiry (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    if (!existing.has('dashboard_import_chunks')) await connection.query(`
      CREATE TABLE IF NOT EXISTS dashboard_import_chunks (
        session_id CHAR(36) NOT NULL, chunk_index SMALLINT UNSIGNED NOT NULL,
        sha256 CHAR(64) NOT NULL, body MEDIUMBLOB NOT NULL,
        PRIMARY KEY (session_id, chunk_index)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    if (!existing.has('dashboard_schema_migrations')) await connection.query(`
      CREATE TABLE IF NOT EXISTS dashboard_schema_migrations (
        version VARCHAR(64) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const required = {
      dashboard_users: ['id', 'username', 'password', 'role', 'is_active'],
      inventory_updates: ['id', 'batch_id', 'source_row_number', 'sku_code', 'dedupe_hash'],
      dashboard_sessions: ['session_id', 'expires', 'data'],
      dashboard_import_sessions: ['id', 'owner_id', 'upload_id', 'expires_at'],
    };
    for (const [table, names] of Object.entries(required)) {
      const [columns] = await connection.execute(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]
      );
      const present = new Set(columns.map((row) => row.COLUMN_NAME));
      if (names.some((name) => !present.has(name))) throw new Error('数据库结构与应用不兼容。');
    }
    await connection.query('DELETE FROM dashboard_sessions WHERE expires < UNIX_TIMESTAMP() LIMIT 1000');
    await connection.execute("INSERT IGNORE INTO dashboard_schema_migrations (version) VALUES ('accounts-pages-1')");
  } finally {
    await connection.query("SELECT RELEASE_LOCK('inventory_dashboard_accounts_v1')").catch(() => {});
    connection.release();
  }
}

async function pingDatabase() {
  const [rows] = await pool.query('SELECT VERSION() AS version, NOW() AS server_time');
  return rows[0];
}

async function assertSingleAdmin() {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS admin_count FROM dashboard_users WHERE role = 'admin'"
  );
  if (Number(rows[0].admin_count) !== 1) {
    throw new Error('系统必须且只能有一个管理员。请先运行 auth:create-admin 初始化管理员。');
  }
}

module.exports = { pool, initDatabase, pingDatabase, assertSingleAdmin };
