const express = require('express');
const { pool, pingDatabase } = require('./db');

function createDashboardRouter() {
  const router = express.Router();

  router.get('/api/health', async (_request, response, next) => {
    try {
      await pingDatabase();
      response.json({ ok: true, database: 'connected', schema: 'ready' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/dashboard', async (_request, response, next) => {
    try {
      const [summaryRows] = await pool.query(`
        SELECT COUNT(*) AS total_records, COUNT(DISTINCT sku_code) AS unique_skus,
          COALESCE(SUM(CASE WHEN change_amount > 0 THEN change_amount ELSE 0 END), 0) AS inbound_qty,
          COALESCE(ABS(SUM(CASE WHEN change_amount < 0 THEN change_amount ELSE 0 END)), 0) AS outbound_qty,
          MAX(occurred_at) AS latest_event_at
        FROM inventory_updates
      `);
      const [stockRows] = await pool.query(`
        SELECT COALESCE(SUM(current_row.new_stock), 0) AS current_stock
        FROM inventory_updates current_row
        WHERE NOT EXISTS (
          SELECT 1 FROM inventory_updates newer
          WHERE newer.sku_code = current_row.sku_code
            AND COALESCE(newer.warehouse, '') = COALESCE(current_row.warehouse, '')
            AND (
              COALESCE(newer.occurred_at, '1000-01-01 00:00:00')
                > COALESCE(current_row.occurred_at, '1000-01-01 00:00:00')
              OR (
                COALESCE(newer.occurred_at, '1000-01-01 00:00:00')
                  = COALESCE(current_row.occurred_at, '1000-01-01 00:00:00')
                AND newer.id > current_row.id
              )
            )
        )
      `);
      const [dailyRows] = await pool.query(`
        SELECT DATE(occurred_at) AS day,
          COALESCE(SUM(CASE WHEN change_amount > 0 THEN change_amount ELSE 0 END), 0) AS inbound,
          COALESCE(ABS(SUM(CASE WHEN change_amount < 0 THEN change_amount ELSE 0 END)), 0) AS outbound,
          COUNT(*) AS records
        FROM inventory_updates
        WHERE occurred_at IS NOT NULL
          AND occurred_at >= DATE_SUB((SELECT MAX(occurred_at) FROM inventory_updates), INTERVAL 29 DAY)
        GROUP BY DATE(occurred_at) ORDER BY day ASC
      `);
      const [typeRows] = await pool.query(`
        SELECT COALESCE(NULLIF(change_type, ''), '未分类') AS name, COUNT(*) AS count
        FROM inventory_updates
        GROUP BY COALESCE(NULLIF(change_type, ''), '未分类')
        ORDER BY count DESC LIMIT 8
      `);
      const [warehouseRows] = await pool.query(`
        SELECT DISTINCT warehouse FROM inventory_updates
        WHERE warehouse IS NOT NULL AND warehouse <> '' ORDER BY warehouse
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

  router.get('/api/records', async (request, response, next) => {
    try {
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(request.query.pageSize) || 20));
      const where = [];
      const params = [];
      if (request.query.q) {
        const keyword = `%${String(request.query.q).trim().slice(0, 200)}%`;
        where.push('(sku_code LIKE ? OR sku_name LIKE ? OR document_number LIKE ?)');
        params.push(keyword, keyword, keyword);
      }
      if (request.query.warehouse) {
        where.push('warehouse = ?');
        params.push(String(request.query.warehouse).slice(0, 255));
      }
      if (request.query.type) {
        where.push('change_type = ?');
        params.push(String(request.query.type).slice(0, 255));
      }
      if (request.query.direction === 'in') where.push('change_amount > 0');
      if (request.query.direction === 'out') where.push('change_amount < 0');
      if (/^\d{4}-\d{2}-\d{2}$/.test(request.query.dateFrom || '')) {
        where.push('occurred_at >= ?');
        params.push(`${request.query.dateFrom} 00:00:00`);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(request.query.dateTo || '')) {
        where.push('occurred_at <= ?');
        params.push(`${request.query.dateTo} 23:59:59`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM inventory_updates ${whereSql}`,
        params
      );
      const offset = (page - 1) * pageSize;
      const [rows] = await pool.query(
        `SELECT id, sku_code, sku_name, account_name, occurred_at, shelf_location,
          previous_stock, change_amount, new_stock, warehouse, previous_cost,
          transaction_cost, current_cost, change_type, document_number
         FROM inventory_updates ${whereSql}
         ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
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

  router.get('/api/imports', async (_request, response, next) => {
    try {
      const [rows] = await pool.query(`
        SELECT id, file_name, sheet_name, total_rows, inserted_rows,
          duplicate_rows, error_rows, status, error_message, imported_at
        FROM inventory_import_batches
        ORDER BY imported_at DESC, id DESC LIMIT 30
      `);
      response.json({ rows });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
