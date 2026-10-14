'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { groupImageRows } = require('../src/images');

const PODMAN_IMAGES_OUTPUT = [
  'aaa111bbb222\tdocker.io/library/alpine:latest\t5 MB\t2 weeks ago',
  'aaa111bbb222\tquay.io/podstream/alpine:latest\t5 MB\t2 weeks ago',
  'ccc333ddd444\tlocalhost/podstream-kali-full:latest\t18.5 GB\t3 days ago',
  'eee555fff666\t<none>:<none>\t7.57 GB\t4 days ago',
].join('\n');

test('groupImageRows merges tags of the same image into one record', () => {
  const rows = groupImageRows(PODMAN_IMAGES_OUTPUT, ['localhost/podstream-kali-full:latest']);
  assert.strictEqual(rows.length, 3);

  const alpine = rows.find((r) => r.id === 'aaa111bbb222');
  assert.strictEqual(alpine.ref, 'docker.io/library/alpine:latest');
  assert.strictEqual(alpine.refs.length, 2);
  assert.ok(alpine.refs.includes('quay.io/podstream/alpine:latest'));
  assert.strictEqual(alpine.dangling, false);
  assert.strictEqual(alpine.usedByApp, false);
});

test('groupImageRows flags app images', () => {
  const rows = groupImageRows(PODMAN_IMAGES_OUTPUT, ['localhost/podstream-kali-full:latest']);
  const kali = rows.find((r) => r.id === 'ccc333ddd444');
  assert.strictEqual(kali.usedByApp, true);
});

test('groupImageRows marks untagged images as dangling and ids them as ref', () => {
  const rows = groupImageRows(PODMAN_IMAGES_OUTPUT, []);
  const dangling = rows.find((r) => r.dangling);
  assert.strictEqual(dangling.ref, '<none>:<none>');
  assert.strictEqual(dangling.id, 'eee555fff666');
  assert.strictEqual(dangling.usedByApp, false);
});

test('groupImageRows ignores blank lines', () => {
  assert.strictEqual(groupImageRows('', []).length, 0);
  assert.strictEqual(groupImageRows('\n\n', []).length, 0);
});
