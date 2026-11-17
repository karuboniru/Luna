import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

function wave() {
  const b = Buffer.alloc(44 + 8000);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(8000, 40);
  return b;
}

async function start(root, base) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BASE_PATH: base,
      LAM_DATA_DIR: path.join(root, 'data'), LAM_CACHE_DIR: path.join(root, 'cache'),
      LAM_MEDIA_DIR: path.join(root, 'media') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let failed;
  child.on('error', (err) => { failed = err; });
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  for (let i = 0; i < 200; i++) {
    if (failed) throw failed;
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) return { child, origin: match[0], url: match[0] + base };
    if (child.exitCode !== null) throw new Error(`Service exited: ${output}`);
    await delay(50);
  }
  child.kill('SIGKILL');
  throw new Error(`Service startup timed out: ${output}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const done = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5000);
  await done;
  clearTimeout(force);
}

for (const base of ['', '/apps/luna']) {
  test(`new library HTTP lifecycle at ${base || '/'}`, { timeout: 30000 }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-web-'));
    let service;
    t.after(async () => { if (service) await stop(service.child); await fs.rm(root, { recursive: true, force: true }); });
    const media = path.join(root, 'media', '音乐');
    await fs.mkdir(media, { recursive: true });
    const wav = wave();
    await fs.writeFile(path.join(media, '01 Test.wav'), wav);
    await fs.writeFile(path.join(media, '01 Test.lrc'), '[00:00.00]Hello NAS');
    // A small valid PNG also checks the HTTP image path without external fixtures.
    await fs.writeFile(path.join(media, 'cover.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=', 'base64'));
    service = await start(root, base);
    const api = async (route, body) => {
      const res = await fetch(service.url + route, body === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.ok(res.ok, `${route}: ${res.status} ${res.ok ? '' : await res.text()}`);
      return res.json();
    };
    const health = await api('/api/health');
    assert.equal(health.basePath, base);
    assert.equal(health.capabilities.nativeDialogs, false);
    assert.equal(health.capabilities.serverBrowser, true);
    for (const page of ['/', '/desktop-lyrics.html', '/desktop-lyrics-menu.html']) {
      const res = await fetch(service.url + page);
      assert.equal(res.status, 200);
      assert.ok((await res.text()).includes(`<base href="${base}/"`));
    }
    for (const asset of ['/app.js', '/styles.css', '/app-url.js', '/icon-32.png']) {
      const response = await fetch(service.url + asset);
      assert.equal(response.status, 200, asset);
      if (asset.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
    }
    if (base) {
      const redirect = await fetch(service.url + '?test=1', { redirect: 'manual' });
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.get('location'), base + '/?test=1');
      assert.equal((await fetch(service.origin + '/api/health')).status, 404);
    }
    assert.equal((await fetch(service.url + '/api/does-not-exist')).status, 404);
    const dirs = await api('/api/directories');
    assert.ok(dirs.directories.some((d) => d.path === media));
    await api('/api/libraries', { path: media, scan: true });
    let finished = false;
    for (let i = 0; i < 200; i++) {
      if (!(await api('/api/scan/status')).running) { finished = true; break; }
      await delay(30);
    }
    assert.ok(finished, 'scan completes');
    const { tracks } = await api('/api/tracks');
    assert.equal(tracks.length, 1);
    const track = tracks[0];
    assert.equal(track.stream_url, `${base}/api/stream/${track.id}`);
    const stream = await fetch(service.origin + track.stream_url, { headers: { Range: 'bytes=0-43' } });
    assert.equal(stream.status, 206);
    assert.equal(stream.headers.get('content-range'), `bytes 0-43/${wav.length}`);
    assert.deepEqual(Buffer.from(await stream.arrayBuffer()), wav.subarray(0, 44));
    assert.equal((await fetch(service.origin + track.stream_url, { headers: { Range: 'bytes=999999-' } })).status, 416);
    const lyrics = await api(`/api/tracks/${track.id}/lyrics`);
    assert.match(JSON.stringify(lyrics), /Hello NAS/);
    const { albums } = await api('/api/albums');
    assert.equal(albums.length, 1);
    const detail = await api(`/api/albums/${albums[0].id}`);
    assert.ok(detail.album.cover_url.startsWith(base + '/api/cover/'));
    assert.equal((await fetch(service.origin + detail.album.cover_url)).status, 200);
    const gallery = await api(`/api/albums/${albums[0].id}/images`);
    assert.ok(gallery.images[0].url.startsWith(base + '/api/'));
    assert.equal((await fetch(service.origin + gallery.images[0].url)).status, 200);
    await api(`/api/albums/${albums[0].id}/favorite`, { value: true });
    await api('/api/config', { appearance: { bgImage: 'data:image/png;base64,abcd' } });
    assert.equal((await fetch(service.url + '/api/backup/export?download=1')).status, 200);
    assert.equal((await fetch(service.url + '/api/dialog/folder', { method: 'POST' })).status, 409);
    await stop(service.child);
    service = await start(root, base);
    assert.equal((await api('/api/tracks')).tracks.length, 1);
    assert.equal((await api('/api/config')).config.appearance.bgImage, 'data:image/png;base64,abcd');
    assert.equal((await api(`/api/albums/${albums[0].id}`)).album.favorite, true);
  });
}
