function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

function requireCondition(condition, statusCode, message) {
  if (!condition) throw httpError(statusCode, message);
}

module.exports = { httpError, requireCondition };
