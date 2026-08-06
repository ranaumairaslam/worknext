const test = require('node:test');
const assert = require('node:assert/strict');

const companyRoutes = require('../src/modules/companies/company.routes');
const authRoutes = require('../src/modules/auth/auth.routes');

function hasRoute(router, pathName) {
  return router.stack.some((layer) => layer.route && layer.route.path === pathName);
}

test('company router exposes the core admin workflow endpoints', () => {
  assert.equal(hasRoute(companyRoutes, '/dashboard'), true, 'dashboard route should be exposed');
  assert.equal(hasRoute(companyRoutes, '/profile'), true, 'profile route should be exposed');
  assert.equal(hasRoute(companyRoutes, '/logout'), true, 'logout route should be exposed');
  assert.equal(hasRoute(companyRoutes, '/meetings'), true, 'meetings route should be exposed');
  assert.equal(hasRoute(companyRoutes, '/notifications'), true, 'notifications route should be exposed');
  assert.equal(hasRoute(companyRoutes, '/performance'), true, 'performance route should be exposed');
});

test('auth router exposes the login endpoint', () => {
  assert.equal(hasRoute(authRoutes, '/login'), true, 'login route should be exposed');
});
