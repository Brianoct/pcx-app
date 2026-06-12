const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canAccessPanel,
  getDefaultPanelAccessForRole,
  normalizeRole,
  sanitizePanelAccess
} = require('../lib/rbac');

test('normalizeRole strips accents and case', () => {
  assert.equal(normalizeRole('Almacén Líder'), 'almacen lider');
  assert.equal(normalizeRole('ADMIN'), 'admin');
  assert.equal(normalizeRole('  Ventas  '), 'ventas');
});

test('default role access: admin gets admin panel, ventas does not', () => {
  const admin = getDefaultPanelAccessForRole('Admin');
  const ventas = getDefaultPanelAccessForRole('Ventas');
  assert.equal(admin.admin, true);
  assert.equal(ventas.admin, false);
  assert.equal(ventas.cotizar, true);
  assert.equal(ventas.historial_individual, true);
  assert.equal(ventas.historial_global, false);
});

test('role defaults are accent/case-insensitive', () => {
  const a = getDefaultPanelAccessForRole('Almacen Lider');
  const b = getDefaultPanelAccessForRole('almacén líder');
  assert.deepEqual(a, b);
  assert.equal(a.pedidos_global, true);
});

test('canAccessPanel honours explicit overrides over role defaults', () => {
  assert.equal(canAccessPanel({ cotizar: false }, 'Ventas', 'cotizar'), false);
  assert.equal(canAccessPanel({ admin: true }, 'Ventas', 'admin'), true);
  assert.equal(canAccessPanel(null, 'Ventas', 'cotizar'), true);
});

test('sanitizePanelAccess drops unknown keys and coerces booleans', () => {
  const out = sanitizePanelAccess({ cotizar: 1, bogus_key: true, admin: 0 }, 'Ventas');
  assert.equal(out.cotizar, true);
  assert.equal(out.admin, false);
  assert.equal('bogus_key' in out, false);
});
