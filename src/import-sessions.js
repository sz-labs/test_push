const crypto = require('node:crypto');
const { pool } = require('./db');
const { importExcelBuffer } = require('./excel-import');
const { httpError, requireCondition } = require('./http-errors');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function batchResult(row, duplicateFile = false) {
  return {
    batchId: Number(row.id),
    fileName: row.file_name,
    sheetName: row.sheet_name,
    totalRows: Number(row.total_rows),
    insertedRows: Number(row.inserted_rows),
    duplicateRows: Number(row.duplicate_rows),
    errorRows: Number(row.error_rows),
    completed: true,
    duplicateFile,
  };
}

async function inTransaction(connection, action) {
  await connection.beginTransaction();
  try {
    const result = await action();
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

function validateCreateInput(input) {
  requireCondition(
    input && typeof input.fileName === 'string' &&
      [...input.fileName].length <= 255 && /\.(xlsx|xls)$/i.test(input.fileName) &&
      !/[\\/\x00]/.test(input.fileName),
    400,
    '请选择文件名不超过 255 字符的 Excel 文件。'
  );
  requireCondition(
    Number.isInteger(input.size) && input.size > 0 && input.size <= MAX_FILE_BYTES,
    400,
    '文件最大支持 20MB。'
  );
  requireCondition(
    typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.sha256),
    400,
    '文件摘要不正确。'
  );
}

async function createSession(input, ownerId) {
  validateCreateInput(input);
  const id = crypto.randomUUID();
  await pool.query('DELETE FROM dashboard_import_sessions WHERE expires_at <= UTC_TIMESTAMP(3) LIMIT 10');
  await pool.query('DELETE FROM dashboard_import_chunks WHERE session_id NOT IN (SELECT id FROM dashboard_import_sessions) LIMIT 100');
  await pool.execute(
    `INSERT INTO dashboard_import_sessions
      (id, owner_id, filename, file_size, sha256, chunk_count, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 24 HOUR)`,
    [id, ownerId, input.fileName, input.size, input.sha256, Math.ceil(input.size / CHUNK_BYTES)]
  );
  return { id, received: [], chunkBytes: CHUNK_BYTES };
}

async function readSession(connection, id, ownerId, lock = false) {
  requireCondition(UUID_PATTERN.test(id), 400, '上传会话编号不正确。');
  const [[session]] = await connection.execute(
    `SELECT *, expires_at > UTC_TIMESTAMP(3) AS active
     FROM dashboard_import_sessions WHERE id = ? AND owner_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id, ownerId]
  );
  requireCondition(session && Number(session.active) === 1, 410, '上传会话已过期或已取消。');
  return session;
}

async function status(id, ownerId) {
  const connection = await pool.getConnection();
  try {
    const session = await readSession(connection, id, ownerId);
    if (session.upload_id) return { id, completed: true, batchId: Number(session.upload_id) };
    const [chunks] = await connection.execute(
      'SELECT chunk_index FROM dashboard_import_chunks WHERE session_id = ? ORDER BY chunk_index', [id]
    );
    return { id, fileName: session.filename, size: session.file_size, sha256: session.sha256,
      chunkBytes: CHUNK_BYTES, received: chunks.map((row) => row.chunk_index) };
  } finally {
    connection.release();
  }
}

async function putChunk(id, index, body, ownerId) {
  requireCondition(Number.isInteger(index) && index >= 0 && index < 100, 400, '分块序号不正确。');
  requireCondition(Buffer.isBuffer(body), 400, '分块内容格式不正确。');
  const connection = await pool.getConnection();
  try {
    return await inTransaction(connection, async () => {
      const session = await readSession(connection, id, ownerId, true);
      requireCondition(!session.upload_id, 409, '这份文件已经完成导入。');
      requireCondition(index < session.chunk_count, 400, '分块序号不正确。');
      const expected = Math.min(CHUNK_BYTES, session.file_size - index * CHUNK_BYTES);
      requireCondition(body.length === expected, 400, '分块大小与文件信息不一致。');
      const sha256 = digest(body);
      const [[existing]] = await connection.execute(
        'SELECT sha256 FROM dashboard_import_chunks WHERE session_id = ? AND chunk_index = ?', [id, index]
      );
      if (existing) requireCondition(existing.sha256 === sha256, 409, '同一序号的分块内容不一致。');
      else await connection.execute(
        'INSERT INTO dashboard_import_chunks (session_id, chunk_index, sha256, body) VALUES (?, ?, ?, ?)',
        [id, index, sha256, body]
      );
      return { index, received: true };
    });
  } finally {
    connection.release();
  }
}

async function completeSession(id, ownerId) {
  requireCondition(UUID_PATTERN.test(id), 400, '上传会话编号不正确。');
  const lockConnection = await pool.getConnection();
  let lockName;
  try {
    const initial = await readSession(lockConnection, id, ownerId);
    lockName = `inventory_file_${initial.sha256.slice(0, 40)}`;
    const [[lock]] = await lockConnection.execute('SELECT GET_LOCK(?, 15) AS acquired', [lockName]);
    requireCondition(Number(lock.acquired) === 1, 409, '另一项导入正在处理，请稍后重试。');
    const session = await readSession(lockConnection, id, ownerId);
    if (session.upload_id) {
      const [[saved]] = await lockConnection.execute(
        'SELECT * FROM inventory_import_batches WHERE id = ?', [session.upload_id]
      );
      requireCondition(saved, 404, '已完成的导入批次不存在。');
      return batchResult(saved, true);
    }
    const [[existing]] = await lockConnection.execute(
      `SELECT * FROM inventory_import_batches
       WHERE file_hash = ? AND status = 'completed'
       ORDER BY id DESC LIMIT 1`,
      [session.sha256]
    );
    if (existing) {
      await inTransaction(lockConnection, async () => {
        await lockConnection.execute(
          'UPDATE dashboard_import_sessions SET upload_id = ? WHERE id = ?',
          [String(existing.id), id]
        );
        await lockConnection.execute(
          'DELETE FROM dashboard_import_chunks WHERE session_id = ?', [id]
        );
      });
      return batchResult(existing, true);
    }
    const [chunks] = await lockConnection.execute(
      'SELECT chunk_index, body FROM dashboard_import_chunks WHERE session_id = ? ORDER BY chunk_index', [id]
    );
    requireCondition(
      chunks.length === session.chunk_count && chunks.every((chunk, index) => chunk.chunk_index === index),
      409,
      '文件尚未传完整。'
    );
    const buffer = Buffer.concat(chunks.map((chunk) => chunk.body));
    requireCondition(buffer.length === session.file_size && digest(buffer) === session.sha256,
      422, '文件大小或 SHA-256 校验失败。');
    const result = await importExcelBuffer({ buffer, fileName: session.filename });
    await inTransaction(lockConnection, async () => {
      await lockConnection.execute('UPDATE dashboard_import_sessions SET upload_id = ? WHERE id = ?',
        [String(result.batchId), id]);
      await lockConnection.execute('DELETE FROM dashboard_import_chunks WHERE session_id = ?', [id]);
    });
    return { ...result, completed: true };
  } finally {
    if (lockName) await lockConnection.execute('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    lockConnection.release();
  }
}

async function cancelSession(id, ownerId) {
  requireCondition(UUID_PATTERN.test(id), 400, '上传会话编号不正确。');
  const connection = await pool.getConnection();
  try {
    await inTransaction(connection, async () => {
      await readSession(connection, id, ownerId, true);
      await connection.execute('DELETE FROM dashboard_import_chunks WHERE session_id = ?', [id]);
      await connection.execute('DELETE FROM dashboard_import_sessions WHERE id = ? AND owner_id = ?', [id, ownerId]);
    });
  } finally {
    connection.release();
  }
  return { cancelled: true };
}

module.exports = { MAX_FILE_BYTES, CHUNK_BYTES, createSession, status,
  putChunk, completeSession, cancelSession, httpError };
