const session = require('express-session');
const signature = require('cookie-signature');

const cookieName = 'inventory.sid';

function createSessionAuth({ auth, store }) {
  if (typeof auth.sessionSecret !== 'string' || auth.sessionSecret.length < 32) {
    throw new Error('会话密钥未正确配置。');
  }
  const handleSession = session({
    name: cookieName,
    secret: auth.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: auth.production,
    cookie: { httpOnly: true, sameSite: 'strict', secure: auth.production,
      maxAge: auth.sessionHours * 60 * 60 * 1000 },
  });
  return {
    middleware(request, response, next) {
      const authorization = request.get('authorization');
      if (authorization) {
        const token = authorization.match(/^Bearer ([A-Za-z0-9_-]{16,128}\.[A-Za-z0-9+/=]{20,128})$/)?.[1];
        const cookies = String(request.headers.cookie || '').split(';')
          .filter((value) => value.trim() && !value.trim().startsWith(cookieName + '='));
        if (token) cookies.push(`${cookieName}=${encodeURIComponent('s:' + token)}`);
        request.headers.cookie = cookies.join('; ');
      }
      handleSession(request, response, next);
    },
    issueToken(request) {
      return signature.sign(request.sessionID, auth.sessionSecret);
    },
  };
}

module.exports = { createSessionAuth };
