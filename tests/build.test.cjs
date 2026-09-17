const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {build} = require('../scripts/build.cjs');

test('single HTML is deterministic, current and contains every source in order', () => {
  const html = build();
  assert.equal(html, build());
  assert.equal(html, fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
  for (const file of ['styles.css', 'workspace.css', 'mobile.css'])
    assert.ok(html.includes(fs.readFileSync(path.join(__dirname, '../assets', file), 'utf8')));
  let previous = html.indexOf('<div class="toast"');
  for (const file of ['core.js', 'billing.js', 'app.js', 'enhancements.js']) {
    const position = html.indexOf('<script data-source="assets/' + file + '">');
    assert.ok(position > previous, file + ' must run after DOM and preceding module');
    previous = position;
  }
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+rel="stylesheet"|@import/);
  assert.doesNotMatch(html, /<link[^>]+href="(?!data:)/);
  assert.match(html, /href="data:image\/svg\+xml;base64,/);
});
