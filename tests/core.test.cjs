const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/core.js');
const fixture = () => ({...core.empty(), tenants: [{id: 't1', name: '테스트', unit: '201', rent: '1000000'}]});
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value), data};
}
test('legacy backups receive independent defaults for absent collections', () => {
  const value = core.validateData({tenants: [], bills: {}});
  assert.deepEqual(value, core.empty());
  assert.deepEqual(value.floorOperations, {5: {leaseStatus: '공실(정리중)'}});
  assert.equal(value.tenants.length, 0);
});
test('optional floor operations preserve empty-floor status without fake tenants', () => {
  const value = core.validateData({tenants: [], bills: {}, floorOperations: {5: {leaseStatus: '공실(정리중)'}}});
  assert.deepEqual(value.floorOperations, {5: {leaseStatus: '공실(정리중)'}});
  assert.deepEqual(value.tenants, []);
  assert.throws(() => core.validateData({tenants: [], bills: {}, floorOperations: {6: {leaseStatus: '공실(정리중)'}}}));
  assert.throws(() => core.validateData({tenants: [], bills: {}, floorOperations: {5: {leaseStatus: '추정 상태'}}}));
});
test('reads legacy browser keys without rewriting them', () => {
  const data = fixture(); const s = storage({tenants: JSON.stringify(data.tenants)});
  assert.deepEqual(core.load(s).data.tenants, data.tenants);
  assert.equal(s.data.size, 1);
});
test('damaged JSON is retained and loading produces a recoverable error', () => {
  const s = storage({bills: '{broken'});
  assert.ok(core.load(s).error);
  assert.equal(s.getItem('bills'), '{broken');
});
test('malformed current snapshot never falls back to stale legacy data', () => {
  const s = storage({[core.STATE_KEY]: '{bad', tenants: JSON.stringify(fixture().tenants)});
  assert.ok(core.load(s).error);
});
test('all collections persist in a single atomic storage operation', () => {
  let writes = 0; const s = storage(); const original = s.setItem;
  s.setItem = (...args) => { writes++; original(...args); };
  core.persist(s, fixture()); assert.equal(writes, 1);
  assert.deepEqual(core.load(s).data, fixture());
});
test('quota failures preserve the prior snapshot', () => {
  const s = storage(); core.persist(s, fixture());
  const before = s.getItem(core.STATE_KEY);
  s.setItem = () => { throw new Error('quota'); };
  assert.throws(() => core.persist(s, core.empty()), /quota/);
  assert.equal(s.getItem(core.STATE_KEY), before);
});
test('an empty reset snapshot takes precedence over retained legacy keys', () => {
  const s = storage({tenants: JSON.stringify(fixture().tenants), otherApp: 'keep'});
  core.persist(s, core.empty());
  assert.equal(core.load(s).data.tenants.length, 0);
  assert.equal(s.getItem('otherApp'), 'keep');
});
test('backup retains source data, reason and version', () => {
  const s = storage(); core.backup(s, fixture(), '삭제 전');
  const saved = JSON.parse(s.getItem(core.BACKUP_KEY));
  assert.equal(saved.reason, '삭제 전'); assert.equal(saved.schemaVersion, 1);
  assert.deepEqual(core.validateData(saved), fixture());
});
test('zero ratio is valid and numeric strings are normalized', () => {
  const value = fixture(); value.waterRatio = {r2: 0, r3: '10', r4: 5};
  assert.deepEqual(core.validateData(value).waterRatio, {r2: 0, r3: 10, r4: 5});
});
test('zero total and negative ratios are rejected', () => {
  for (const ratio of [{r2: 0, r3: 0, r4: 0}, {r2: -1, r3: 10, r4: 5}]) {
    assert.throws(() => core.validateData({...fixture(), waterRatio: ratio}));
  }
});
test('duplicate and inline-code IDs are rejected before rendering', () => {
  const data = fixture(); data.tenants.push({...data.tenants[0]});
  assert.throws(() => core.validateData(data));
  data.tenants = [{...data.tenants[0], id: "x');alert(1)//"}];
  assert.throws(() => core.validateData(data));
  data.tenants[0].id = '__proto__';
  assert.throws(() => core.validateData(data));
});
test('prototype keys and unsupported backup versions are rejected', () => {
  assert.throws(() => core.validateData(JSON.parse('{"tenants":[],"bills":{},"__proto__":{}}')));
  assert.throws(() => core.validateData({...fixture(), schemaVersion: 99}));
});
test('nested malformed bills, expenses and meter records are rejected', () => {
  for (const part of [{bills: {'2026-09': []}}, {expenses: {'2026-09': {}}},
    {bills: {'2026-99': {}}}, {bills: {'2026-09': {t1: {water: -1}}}}])
    assert.throws(() => core.validateData({...fixture(), ...part}));
});
test('HTML escaping covers both text and quoted attributes', () => {
  assert.equal(core.escapeHtml('<img onerror="x"> & \'text\''), '&lt;img onerror=&quot;x&quot;&gt; &amp; &#39;text&#39;');
});
test('meter dates respect month lengths and leap years', () => {
  assert.equal(core.validMeterDate('02/29', 2024), true);
  for (const date of ['02/29', '04/31', '13/01', '00/10', '9/0', 'x']) assert.equal(core.validMeterDate(date, 2026), false);
});
