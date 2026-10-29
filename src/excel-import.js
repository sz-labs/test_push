const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { pool } = require('./db');

const FIELD_ALIASES = {
  skuCode: ['sku编号', 'sku编码', 'sku', '商品sku', '商品编号'],
  skuName: ['sku名称', '商品名称', '产品名称', '名称'],
  accountName: ['账号', '操作账号', '操作人'],
  occurredAt: ['时间', '变动时间', '操作时间', '日期'],
  shelfLocation: ['货架位', '货架位置', '库位'],
  previousStock: ['原库存', '变动前库存', '原数量'],
  changeAmount: ['变动', '变动量', '库存变动', '数量变动'],
  newStock: ['新库存', '变动后库存', '现库存'],
  warehouse: ['仓库', '仓库名称'],
  previousCost: ['原成本价', '变动前成本价'],
  transactionCost: ['出入库价', '出入库价格', '变动价格'],
  currentCost: ['现成本价', '当前成本价', '变动后成本价'],
  changeType: ['类型', '变动类型', '业务类型'],
  documentNumber: ['单据号', '单号', '业务单号'],
};

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[：:()（）_-]/g, '')
    .toLowerCase();
}

function findField(header) {
  const normalized = normalizeHeader(header);
  return Object.entries(FIELD_ALIASES).find(([, aliases]) =>
    aliases.some((alias) => normalizeHeader(alias) === normalized)
  )?.[0];
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value)
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/[＋]/g, '+')
    .replace(/[－−]/g, '-');
  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const result = Number(match[0]);
  return Number.isFinite(result) ? result : null;
}

function formatDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateParts(
      value.getFullYear(), value.getMonth() + 1, value.getDate(),
      value.getHours(), value.getMinutes(), value.getSeconds()
    );
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return formatDateParts(parsed.y, parsed.m, parsed.d, parsed.H, parsed.M, parsed.S);
  }

  const text = String(value).trim();
  const englishDate = text.match(
    /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (englishDate) {
    const months = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const month = months[englishDate[2].slice(0, 3).toLowerCase()];
    if (month) {
      return formatDateParts(
        Number(englishDate[3]), month, Number(englishDate[1]),
        Number(englishDate[4] || 0), Number(englishDate[5] || 0), Number(englishDate[6] || 0)
      );
    }
  }

  const numericDate = text.match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (numericDate) {
    return formatDateParts(
      Number(numericDate[1]), Number(numericDate[2]), Number(numericDate[3]),
      Number(numericDate[4] || 0), Number(numericDate[5] || 0), Number(numericDate[6] || 0)
    );
  }

  return null;
}

function makeJsonSafe(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  let selected = null;

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, defval: null, raw: true, blankrows: false,
    });
    const headerIndex = matrix.slice(0, 20).findIndex((row) =>
      row.some((cell) => findField(cell) === 'skuCode')
    );
    if (headerIndex >= 0) {
      selected = { sheetName, matrix, headerIndex };
      break;
    }
  }

  if (!selected) throw new Error('未找到“SKU编号”列，请确认上传的是库存更新记录 Excel。');

  const headers = selected.matrix[selected.headerIndex].map((header, index) =>
    cleanText(header) || `未命名列${index + 1}`
  );
  const fieldColumns = {};
  headers.forEach((header, index) => {
    const field = findField(header);
    if (field && fieldColumns[field] === undefined) fieldColumns[field] = index;
  });

  const missingRequired = ['skuCode', 'changeAmount', 'newStock'].filter(
    (field) => fieldColumns[field] === undefined
  );
  if (missingRequired.length) throw new Error('表头缺少必需列：SKU编号、变动、新库存。');

  const records = [];
  const errors = [];
  const dataRows = selected.matrix.slice(selected.headerIndex + 1);

  dataRows.forEach((row, offset) => {
    if (!row.some((cell) => cleanText(cell) !== null)) return;

    const rowNumber = selected.headerIndex + offset + 2;
    const get = (field) => {
      const index = fieldColumns[field];
      return index === undefined ? null : row[index];
    };
    const rawData = Object.fromEntries(
      headers.map((header, index) => [header, makeJsonSafe(row[index])])
    );
    const record = {
      rowNumber,
      skuCode: cleanText(get('skuCode')),
      skuName: cleanText(get('skuName')),
      accountName: cleanText(get('accountName')),
      occurredAt: parseDate(get('occurredAt')),
      shelfLocation: cleanText(get('shelfLocation')),
      previousStock: parseNumber(get('previousStock')),
      changeAmount: parseNumber(get('changeAmount')),
      newStock: parseNumber(get('newStock')),
      warehouse: cleanText(get('warehouse')),
      previousCost: parseNumber(get('previousCost')),
      transactionCost: parseNumber(get('transactionCost')),
      currentCost: parseNumber(get('currentCost')),
      changeType: cleanText(get('changeType')),
      documentNumber: cleanText(get('documentNumber')),
      rawData,
    };

    const rowIssues = [];
    if (!record.skuCode) rowIssues.push('SKU编号为空');
    if (record.changeAmount === null) rowIssues.push('变动量无法识别');
    if (record.newStock === null) rowIssues.push('新库存无法识别');
    if (rowIssues.length) {
      errors.push({ rowNumber, message: rowIssues.join('，') });
      return;
    }

    const canonical = [
      record.skuCode, record.skuName, record.accountName, record.occurredAt,
      record.shelfLocation, record.previousStock, record.changeAmount, record.newStock,
      record.warehouse, record.previousCost, record.transactionCost, record.currentCost,
      record.changeType, record.documentNumber,
    ];
    record.dedupeHash = crypto.createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex');
    records.push(record);
  });

  return {
    sheetName: selected.sheetName,
    totalRows: records.length + errors.length,
    records,
    errors,
  };
}

async function importExcelBuffer({ buffer, fileName }) {
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const parsed = parseWorkbook(buffer);
  const [batchResult] = await pool.execute(
    `INSERT INTO inventory_import_batches
      (file_name, sheet_name, file_hash, total_rows, error_rows, status)
     VALUES (?, ?, ?, ?, ?, 'processing')`,
    [fileName, parsed.sheetName, fileHash, parsed.totalRows, parsed.errors.length]
  );
  const batchId = batchResult.insertId;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    let insertedRows = 0;

    for (let index = 0; index < parsed.records.length; index += 500) {
      const chunk = parsed.records.slice(index, index + 500);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values = chunk.flatMap((record) => [
        batchId, record.rowNumber, record.skuCode, record.skuName, record.accountName,
        record.occurredAt, record.shelfLocation, record.previousStock, record.changeAmount,
        record.newStock, record.warehouse, record.previousCost, record.transactionCost,
        record.currentCost, record.changeType, record.documentNumber, record.dedupeHash,
        JSON.stringify(record.rawData),
      ]);
      const [result] = await connection.query(
        `INSERT IGNORE INTO inventory_updates (
          batch_id, source_row_number, sku_code, sku_name, account_name, occurred_at,
          shelf_location, previous_stock, change_amount, new_stock, warehouse,
          previous_cost, transaction_cost, current_cost, change_type,
          document_number, dedupe_hash, raw_data
        ) VALUES ${placeholders}`,
        values
      );
      insertedRows += result.affectedRows;
    }

    const duplicateRows = parsed.records.length - insertedRows;
    await connection.execute(
      `UPDATE inventory_import_batches
       SET inserted_rows = ?, duplicate_rows = ?, status = 'completed'
       WHERE id = ?`,
      [insertedRows, duplicateRows, batchId]
    );
    await connection.commit();

    return {
      batchId, fileName, sheetName: parsed.sheetName, totalRows: parsed.totalRows,
      insertedRows, duplicateRows, errorRows: parsed.errors.length,
      errors: parsed.errors.slice(0, 20),
    };
  } catch (error) {
    await connection.rollback();
    await pool.execute(
      `UPDATE inventory_import_batches
       SET status = 'failed', error_message = ? WHERE id = ?`,
      [String(error.message || error).slice(0, 2000), batchId]
    );
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { importExcelBuffer, parseWorkbook };
