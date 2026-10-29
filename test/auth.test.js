const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService } = require('../src/auth');

test('admin session tokens are signed and accepted', () => {
  const auth = createAuthService('a-secure-test-password');
  assert.equal(auth.matches('a-secure-test-password'), true);
  assert.equal(auth.matches('wrong-password'), false);
  const session = auth.issue();
  assert.equal(session.expiresIn, 8 * 60 * 60);
  assert.doesNotThrow(() => auth.require(`Bearer ${session.accessToken}`));
  assert.throws(() => auth.require('Bearer invalid'), /管理员身份/);
});

test('local mode permits writes when no admin password is configured', () => {
  const auth = createAuthService('');
  assert.doesNotThrow(() => auth.require(''));
});
