const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

process.env.MYSQL_CONFIG_YAML = JSON.stringify({
  mysql: { host: '127.0.0.1', database: 'test', username: 'test', password: 'test' },
});

const { parseWorkbook } = require('../src/excel-import');
const { pool } = require('../src/db');

test('inventory workbook aliases are parsed into normalized records', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['SKU编号', 'SKU名称', '变动', '新库存', '时间'],
    ['SKU-1', '测试商品', 3, 8, '2026-10-29 10:00:00'],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '库存');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const parsed = parseWorkbook(buffer);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].skuCode, 'SKU-1');
  assert.equal(parsed.records[0].changeAmount, 3);
  assert.equal(parsed.records[0].newStock, 8);
});

test.after(() => pool.end());
