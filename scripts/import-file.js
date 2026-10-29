const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, pool } = require('../src/db');
const { importExcelBuffer } = require('../src/excel-import');

async function main() {
  const filePath = process.argv.slice(2).find((argument) => argument !== '--');
  if (!filePath) throw new Error('用法：pnpm run import:file -- "C:\\path\\库存更新记录.xlsx"');

  const resolved = path.resolve(filePath);
  await initDatabase();
  const result = await importExcelBuffer({
    buffer: fs.readFileSync(resolved),
    fileName: path.basename(resolved),
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
