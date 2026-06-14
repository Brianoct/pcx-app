const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EVENT_TYPES,
  TIME_OFF_TYPES,
  isTimeOffType,
  normalizeEventType,
  normalizeStatus,
  normalizeVisibility
} = require('../lib/calendar');

test('every event type carries label, color and category', () => {
  for (const [key, meta] of Object.entries(EVENT_TYPES)) {
    assert.ok(meta.label, `${key} missing label`);
    assert.match(meta.color, /^#[0-9a-fA-F]{6}$/, `${key} bad color`);
    assert.ok(['time_off', 'work'].includes(meta.category), `${key} bad category`);
  }
});

test('time-off types are exactly vacation/partial_day/sick', () => {
  assert.deepEqual([...TIME_OFF_TYPES].sort(), ['partial_day', 'sick', 'vacation']);
  assert.equal(isTimeOffType('vacation'), true);
  assert.equal(isTimeOffType('marketing'), false);
});

test('normalizeEventType resolves canonical keys and legacy aliases', () => {
  assert.equal(normalizeEventType('vacation'), 'vacation');
  assert.equal(normalizeEventType('VACACIONES'), 'vacation');
  assert.equal(normalizeEventType('sick_leave'), 'sick');
  assert.equal(normalizeEventType('early_leave'), 'partial_day');
  assert.equal(normalizeEventType('Promoción'), 'marketing');
  assert.equal(normalizeEventType('reunion'), 'meeting');
  assert.equal(normalizeEventType('nonsense'), null);
});

test('normalizeVisibility defaults to team and recognizes personal', () => {
  assert.equal(normalizeVisibility(undefined), 'team');
  assert.equal(normalizeVisibility('team'), 'team');
  assert.equal(normalizeVisibility('personal'), 'personal');
  assert.equal(normalizeVisibility('privado'), 'personal');
});

test('normalizeStatus maps spanish and english labels', () => {
  assert.equal(normalizeStatus('approved'), 'approved');
  assert.equal(normalizeStatus('aprobado'), 'approved');
  assert.equal(normalizeStatus('confirmado'), 'confirmed');
  assert.equal(normalizeStatus('whatever'), null);
});
