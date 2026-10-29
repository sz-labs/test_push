const express = require('express');
const multer = require('multer');
const { importExcelBuffer } = require('./excel-import');
const { requireCondition } = require('./auth');
const importSessions = require('./import-sessions');

function createUploadRouter({ auth, clientIp }) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: importSessions.MAX_FILE_BYTES },
    fileFilter: (_request, file, callback) => {
      const allowed = /\.(xlsx|xls)$/i.test(file.originalname);
      callback(
        allowed ? null : Object.assign(new Error('只支持 .xlsx 或 .xls 文件。'), { statusCode: 400 }),
        allowed
      );
    },
  });
  const requireAdmin = (request, _response, next) => {
    try {
      auth.require(request.get('authorization'));
      next();
    } catch (error) {
      next(error);
    }
  };

  router.post('/api/session', async (request, response, next) => {
    try {
      requireCondition(
        typeof request.body?.password === 'string' && request.body.password.length > 0 &&
          request.body.password.length <= 1024,
        400,
        '请填写管理口令。'
      );
      const valid = auth.matches(request.body.password);
      await importSessions.recordLogin(auth.clientKey(clientIp(request)), valid);
      requireCondition(valid, 401, '管理口令不正确。');
      response.json(auth.issue());
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/imports', requireAdmin, upload.single('file'), async (request, response, next) => {
    try {
      requireCondition(request.file, 400, '请选择 Excel 文件。');
      const result = await importExcelBuffer({
        buffer: request.file.buffer,
        fileName: Buffer.from(request.file.originalname, 'latin1').toString('utf8'),
      });
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/import-sessions', requireAdmin, async (request, response, next) => {
    try {
      response.status(201).json(await importSessions.createSession(request.body));
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/import-sessions/:id', requireAdmin, async (request, response, next) => {
    try {
      response.json(await importSessions.status(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/api/import-sessions/:id/chunks/:index',
    requireAdmin,
    express.raw({ type: 'application/octet-stream', limit: `${importSessions.CHUNK_BYTES}b` }),
    async (request, response, next) => {
      try {
        response.json(await importSessions.putChunk(
          request.params.id,
          Number(request.params.index),
          request.body
        ));
      } catch (error) {
        next(error);
      }
    }
  );

  router.post('/api/import-sessions/:id/complete', requireAdmin, async (request, response, next) => {
    try {
      response.json(await importSessions.completeSession(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/import-sessions/:id', requireAdmin, async (request, response, next) => {
    try {
      response.json(await importSessions.cancelSession(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createUploadRouter };
