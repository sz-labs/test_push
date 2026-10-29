const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { createSessionAuth } = require('../src/session-auth');

function fixture(store) {
  const app = express();
  const sessions = createSessionAuth({
    auth: { sessionSecret: 'test-session-secret-with-at-least-32-characters', sessionHours: 12, production: false },
    store,
  });
  app.use(sessions.middleware);
  app.post('/login', (request, response, next) => {
    request.session.regenerate((error) => {
      if (error) return next(error);
      request.session.userId = 42;
      request.session.save((error) => {
        if (error) return next(error);
        response.json({ accessToken: sessions.issueToken(request) });
      });
    });
  });
  app.get('/session', (request, response) => {
    response.status(request.session.userId ? 200 : 401).json({ authenticated: Boolean(request.session.userId) });
  });
  app.post('/logout', (request, response, next) => {
    request.session.destroy((error) => error ? next(error) : response.sendStatus(204));
  });
  return app;
}

async function serve(app, t) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('bearer session survives a different server instance and logout revokes it', async (t) => {
  const store = new session.MemoryStore();
  const first = await serve(fixture(store), t);
  const second = await serve(fixture(store), t);
  const login = await fetch(first + '/login', { method: 'POST' });
  const token = (await login.json()).accessToken;
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(second + '/session', { headers })).status, 200);
  assert.equal((await fetch(second + '/logout', { method: 'POST', headers })).status, 204);
  assert.equal((await fetch(first + '/session', { headers })).status, 401);
});

test('forged bearer token and malformed authorization cannot reuse a valid cookie', async (t) => {
  const base = await serve(fixture(new session.MemoryStore()), t);
  const login = await fetch(base + '/login', { method: 'POST' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const token = (await login.json()).accessToken;
  const forged = token.slice(0, -1) + (token.endsWith('x') ? 'y' : 'x');
  assert.equal((await fetch(base + '/session', { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
  assert.equal((await fetch(base + '/session', { headers: { Authorization: 'Bearer invalid', Cookie: cookie } })).status, 401);
});

test('missing signing secret fails closed', () => {
  assert.throws(() => createSessionAuth({ auth: { sessionSecret: '', sessionHours: 12 }, store: new session.MemoryStore() }));
});
