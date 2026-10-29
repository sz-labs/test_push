const crypto = require('node:crypto');

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

function requireCondition(condition, statusCode, message) {
  if (!condition) throw httpError(statusCode, message);
}

function createAuthService(password) {
  function configured() {
    requireCondition(
      typeof password === 'string' && password.length >= 16,
      503,
      '服务端尚未配置管理口令。'
    );
  }

  function hash(value) {
    return crypto.createHash('sha256').update(String(value)).digest();
  }

  function sign(payload) {
    return crypto.createHmac('sha256', password).update(payload).digest('hex');
  }

  return {
    enabled: Boolean(password),
    matches(candidate) {
      configured();
      return crypto.timingSafeEqual(hash(candidate), hash(password));
    },
    issue() {
      configured();
      const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
      const payload = `${expiresAt}.${crypto.randomBytes(16).toString('hex')}`;
      return { accessToken: `${payload}.${sign(payload)}`, expiresIn: 8 * 60 * 60 };
    },
    require(authorization) {
      if (!password) return;
      configured();
      const token = String(authorization || '').match(/^Bearer (.+)$/i)?.[1] || '';
      const match = token.match(/^(\d{1,12})\.([a-f0-9]{32})\.([a-f0-9]{64})$/);
      const payload = match ? `${match[1]}.${match[2]}` : '';
      const expected = payload ? sign(payload) : '';
      const validSignature = Boolean(
        match && expected.length === match[3].length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(match[3]))
      );
      requireCondition(
        validSignature && Number(match[1]) > Date.now() / 1000,
        401,
        '请先以管理员身份登录。'
      );
    },
    clientKey(ipAddress) {
      configured();
      return crypto.createHmac('sha256', password).update(ipAddress || 'unknown').digest('hex');
    },
  };
}

module.exports = { createAuthService, httpError, requireCondition };
