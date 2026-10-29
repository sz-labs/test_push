const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.mysql);

async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('inventory_dashboard_schema_v2', 10) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('数据库结构初始化锁获取超时。');
    const [existingRows] = await connection.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    );
    const existing = new Set(existingRows.map((row) => row.TABLE_NAME));
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
        KEY idx_inventory_latest (sku_code, warehouse, occurred_at, id),
        KEY idx_inventory_batch (batch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!existing.has('pages_inventory_import_sessions')) await connection.query(`
      CREATE TABLE IF NOT EXISTS pages_inventory_import_sessions (
        id CHAR(36) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        file_size INT UNSIGNED NOT NULL,
        sha256 CHAR(64) NOT NULL,
        chunk_count SMALLINT UNSIGNED NOT NULL,
        upload_id VARCHAR(36) NULL,
        created_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY ix_inventory_import_expiry (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!existing.has('pages_inventory_import_chunks')) await connection.query(`
      CREATE TABLE IF NOT EXISTS pages_inventory_import_chunks (
        session_id CHAR(36) NOT NULL,
        chunk_index SMALLINT UNSIGNED NOT NULL,
        sha256 CHAR(64) NOT NULL,
        body MEDIUMBLOB NOT NULL,
        PRIMARY KEY (session_id, chunk_index),
        KEY ix_inventory_chunk_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!existing.has('pages_inventory_auth_limits')) await connection.query(`
      CREATE TABLE IF NOT EXISTS pages_inventory_auth_limits (
        client_key CHAR(64) NOT NULL,
        failures TINYINT UNSIGNED NOT NULL DEFAULT 0,
        window_start DATETIME(3) NOT NULL,
        PRIMARY KEY (client_key),
        KEY ix_inventory_auth_window (window_start)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const requirements = {
      inventory_import_batches: ['id', 'file_name', 'file_hash', 'status'],
      inventory_updates: ['id', 'batch_id', 'sku_code', 'dedupe_hash'],
      pages_inventory_import_sessions: ['id', 'sha256', 'upload_id', 'expires_at'],
      pages_inventory_import_chunks: ['session_id', 'chunk_index', 'body'],
      pages_inventory_auth_limits: ['client_key', 'failures', 'window_start'],
    };
    for (const [table, required] of Object.entries(requirements)) {
      const [columns] = await connection.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
      );
      const present = new Set(columns.map((column) => column.COLUMN_NAME));
      if (required.some((column) => !present.has(column))) {
        throw new Error(`数据库表 ${table} 与应用要求不兼容。`);
      }
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('inventory_dashboard_schema_v2')").catch(() => {});
    connection.release();
  }
}

async function pingDatabase() {
  const [rows] = await pool.query('SELECT VERSION() AS version, NOW() AS server_time');
  return rows[0];
}

module.exports = { pool, initDatabase, pingDatabase };
