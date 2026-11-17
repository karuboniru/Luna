import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appUrl } from '../public/app-url.js';

const origin = 'https://luna.example';

test('app URL: root mount resolves root-relative resources at the origin root', () => {
  assert.equal(appUrl('/api/foo', `${origin}/`), `${origin}/api/foo`);
  assert.equal(appUrl('api/foo', `${origin}/`), `${origin}/api/foo`);
});

test('app URL: subpath mount prefixes root-relative resources once', () => {
  const base = `${origin}/luna/`;
  assert.equal(appUrl('/api/foo', base), `${origin}/luna/api/foo`);
  assert.equal(appUrl('/luna/api/foo', base), `${origin}/luna/api/foo`);
  assert.equal(appUrl('api/foo', base), `${origin}/luna/api/foo`);
});

test('app URL: query strings and fragments survive resolution', () => {
  const base = `${origin}/luna/`;
  assert.equal(appUrl('/api/foo?x=1&y=two#result', base), `${origin}/luna/api/foo?x=1&y=two#result`);
  assert.equal(appUrl('/luna/api/foo?x=1#result', base), `${origin}/luna/api/foo?x=1#result`);
  assert.equal(appUrl('?mode=compact#list', base), `${origin}/luna/?mode=compact#list`);
});

test('app URL: external, data, and blob URLs are preserved', () => {
  assert.equal(appUrl('https://cdn.example/image.png?size=2', `${origin}/luna/`), 'https://cdn.example/image.png?size=2');
  assert.equal(appUrl('data:image/png;base64,abc123', `${origin}/luna/`), 'data:image/png;base64,abc123');
  assert.equal(appUrl('blob:https://luna.example/asset-id', `${origin}/luna/`), 'blob:https://luna.example/asset-id');
});

test('app URL: empty string remains empty', () => {
  assert.equal(appUrl('', `${origin}/luna/`), '');
});

test('app URL: static assets, media, and downloads share the same mount', () => {
  const base = `${origin}/luna/`;
  for (const resource of ['styles.css', 'icon.png', 'api/cover/hash', 'api/stream/42', 'api/backup/export?download=1']) {
    assert.equal(appUrl(`/${resource}`, base), `${base}${resource}`);
    assert.equal(appUrl(`/luna/${resource}`, base), `${base}${resource}`);
  }
  assert.equal(appUrl('/api/directories?path=%2Fmedia%2F%E9%9F%B3%E4%B9%90', base),
    `${base}api/directories?path=%2Fmedia%2F%E9%9F%B3%E4%B9%90`);
});

test('app URL: prefix matching observes path segment boundaries', () => {
  const base = `${origin}/luna/`;
  assert.equal(appUrl('/luna-other/file', base), `${base}luna-other/file`);
  assert.equal(appUrl('/luna', base), `${origin}/luna`);
});
