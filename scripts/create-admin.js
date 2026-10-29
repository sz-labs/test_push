const { initDatabase, pool } = require('../src/db');

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== '--');
  const username = String(args[0] || '').trim();
  const password = String(args[1] || '');

  if (!username || username.length > 100) {
    throw new Error('管理员用户名不能为空且不能超过 100 个字符。');
  }
  if (!password || password.length > 255) {
    throw new Error('管理员密码不能为空且不能超过 255 个字符。');
  }

  await initDatabase();
  const [admins] = await pool.query(
    "SELECT id, username FROM dashboard_users WHERE role = 'admin' LIMIT 1"
  );
  if (admins.length) {
    throw new Error(`管理员已存在：${admins[0].username}`);
  }

  await pool.execute(
    `INSERT INTO dashboard_users (username, password, role, is_active)
     VALUES (?, ?, 'admin', 1)`,
    [username, password]
  );
  console.log(`管理员已创建：${username}`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
