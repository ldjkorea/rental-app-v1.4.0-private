const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function worker() {
  const events = {}; const deleted = []; const stored = {body: 'offline'};
  const context = {URL, Set, Promise, encodeURIComponent,
    self: {registration: {scope: 'https://example.test/rental-app/'}, addEventListener: (name, handler) => events[name] = handler},
    caches: {keys: async () => ['rental-v3', 'other-app', 'rental-foundation-v2', 'rental-foundation-v3'], delete: async key => deleted.push(key),
      open: async () => ({match: async () => stored, addAll: async () => {}})},
    fetch: () => { throw new Error('should use cache'); }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), context);
  return {events, deleted, stored};
}
test('service worker ignores cloud reads, POSTs and unrelated static files', () => {
  const {events} = worker();
  for (const request of [{method: 'POST', url: 'https://example.test/rental-app/index.html'},
    {method: 'GET', url: 'https://script.google.com/exec'}, {method: 'GET', url: 'https://example.test/private.json'}]) {
    events.fetch({request, respondWith: () => assert.fail('must not intercept')});
  }
});
test('service worker returns cached application files for offline use', async () => {
  const {events, stored} = worker(); let result;
  events.fetch({request: {method: 'GET', url: 'https://example.test/rental-app/assets/app.js'}, respondWith: p => result = p});
  assert.equal(await result, stored);
});
test('service worker serves the cached app for query-string routes', async () => {
  const {events, stored} = worker(); let result;
  events.fetch({request: {method: 'GET', url: 'https://example.test/rental-app/?demo=1'}, respondWith: p => result = p});
  assert.equal(await result, stored);
});
test('service worker removes only older rental app caches', async () => {
  const {events, deleted} = worker(); let done;
  events.activate({waitUntil: p => done = p}); await done;
  assert.deepEqual(deleted, ['rental-v3', 'rental-foundation-v2', 'rental-foundation-v3']);
});
