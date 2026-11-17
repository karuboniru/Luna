import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBasePath, prefixResponseUrls, renderHtml } from '../server/web-host.mjs';

test('base path normalizes root/trailing slash and rejects ambiguous URL prefixes', () => {
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeBasePath('/apps/luna/'), '/apps/luna');
  for (const value of ['luna', '//luna', '/a/../b', '/a?b', '/a#b', '/a//b', '/a%20b']) {
    assert.throws(() => normalizeBasePath(value));
  }
});

test('response URL prefixing preserves metadata and already-prefixed URLs', () => {
  const input = { title: '/api/my album', cover_url: '/api/cover/abc', tracks: [
    { stream_url: '/api/stream/1', path: '/api/music/1.wav' },
  ], images: [{ url: '/api/albums/1/image?p=a' }], url: '/luna/api/cover/abc' };
  const output = prefixResponseUrls(input, '/luna');
  assert.equal(output.title, input.title);
  assert.equal(output.cover_url, '/luna/api/cover/abc');
  assert.equal(output.tracks[0].stream_url, '/luna/api/stream/1');
  assert.equal(output.tracks[0].path, input.tracks[0].path);
  assert.equal(output.images[0].url, '/luna/api/albums/1/image?p=a');
  assert.equal(output.url, input.url);
  assert.equal(input.cover_url, '/api/cover/abc');
  assert.match(renderHtml('<html><head></head></html>', '/apps/luna'), /<base href="\/apps\/luna\/"/);
});
