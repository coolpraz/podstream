'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normalizeTemplate } = require('../src/templates');

test('normalizeTemplate applies defaults to a minimal template', () => {
  const t = normalizeTemplate({ id: 'My App', image: 'localhost/foo:latest' });
  assert.strictEqual(t.id, 'my-app');
  assert.strictEqual(t.name, 'my-app');
  assert.strictEqual(t.displayPort, 5901);
  assert.strictEqual(t.termUser, 'user');
  assert.strictEqual(t.cockpit, false);
  assert.deepStrictEqual(t.env, {});
});

test('normalizeTemplate keeps provided fields and coerces types', () => {
  const t = normalizeTemplate({
    id: 'kali-full',
    name: 'Kali Linux',
    image: 'localhost/kali:latest',
    displayPort: '5902',
    termUser: 'kali',
    cockpit: 1,
    env: { FOO: 'bar' },
  });
  assert.strictEqual(t.displayPort, 5902);
  assert.strictEqual(t.termUser, 'kali');
  assert.strictEqual(t.cockpit, true);
  assert.deepStrictEqual(t.env, { FOO: 'bar' });
});

test('normalizeTemplate sanitizes ids to [a-z0-9-]', () => {
  assert.strictEqual(normalizeTemplate({ id: 'Parrot OS/HTB!', image: 'x' }).id, 'parrot-os-htb');
  assert.strictEqual(normalizeTemplate({ id: '--weird--', image: 'x' }).id, 'weird');
});

test('normalizeTemplate rejects missing image and empty ids', () => {
  assert.throws(() => normalizeTemplate({ id: 'x' }), /needs at least "id" and "image"/);
  assert.throws(() => normalizeTemplate({ image: 'x' }), /needs at least "id" and "image"/);
  assert.throws(() => normalizeTemplate({ id: '---', image: 'x' }), /empty after sanitizing/);
});
