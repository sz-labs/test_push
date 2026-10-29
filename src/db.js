const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool(config.mysql);

async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
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

    await connection.query(`
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

    await connection.query(`
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
  } finally {
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
