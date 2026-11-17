import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-nas-scan-'));
process.env.LAM_DATA_DIR = path.join(temp, 'data');
process.env.LAM_CACHE_DIR = path.join(temp, 'cache');
process.env.LUNA_DLSITE_INDEX = path.join(temp, 'missing-index.sqlite3');
const store = await import('../server/db.mjs');
const scanner = await import('../server/scanner.mjs');
const { virtualPath } = await import('../server/zip-reader.mjs');
after(() => { store.closeDb(); fs.rmSync(temp, { recursive: true, force: true }); });

function audio(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const wav = Buffer.alloc(44 + 160);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(160, 40);
  fs.writeFileSync(file, wav);
}
async function scan(lib) {
  assert.equal(scanner.startScan({ libraryIds: [lib.id] }).started, true);
  await scanner.waitForScan();
}
const denied = () => Object.assign(new Error('synthetic NAS read failure'), { code: 'EACCES' });

test('Native absolute release roots survive an actual disk scan', async () => {
  const root = path.join(temp, 'ASMR');
  const release = path.join(root, '[RJ123456]作品');
  const file = path.join(release, '01.wav');
  audio(file);
  const lib = store.addLibrary(root);
  await scan(lib);
  assert.ok(store.findVoiceAlbum(release));
  assert.ok(store.findTrackByPath(file));
  assert.equal(scanner.scanState.incompleteLibraries, 0);
  assert.ok(Number.isFinite(scanner.scanState.processed));
});

test('Conventional folder covers accept mixed filename case on Linux', async () => {
  const root = path.join(temp, 'folder-cover');
  const file = path.join(root, 'Album', '01.wav');
  audio(file);
  fs.writeFileSync(path.join(path.dirname(file), 'Cover.JPG'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const lib = store.addLibrary(root);
  await scan(lib);
  const album = store.getAlbumById(store.findTrackByPath(file).album_id);
  assert.equal(album.cover_source, 'folder');
  assert.ok(album.cover_file);
});

test('A failed subtree read preserves tracks and archives until the next complete scan', async () => {
  const root = path.join(temp, 'music');
  const unreadable = path.join(root, 'retained');
  const file = path.join(unreadable, '01.wav');
  const removed = path.join(root, 'removed', '02.wav');
  audio(file); audio(removed);
  const lib = store.addLibrary(root);
  await scan(lib);
  const archiveId = store.upsertArchive({ path: path.join(root, 'removed.zip'), libraryId: lib.id });
  const lastScan = store.getLibrary(lib.id).last_scan_at;
  fs.unlinkSync(removed);
  const original = fsp.readdir;
  fsp.readdir = async (dir, ...args) => { if (dir === unreadable) throw denied(); return original(dir, ...args); };
  try { await scan(lib); } finally { fsp.readdir = original; }
  assert.equal(scanner.scanState.incompleteLibraries, 1);
  assert.equal(scanner.lastScanReport().incompleteLibraries, 1);
  assert.equal(scanner.scanState.removed, 0);
  assert.equal(store.getLibrary(lib.id).last_scan_at, lastScan);
  assert.ok(store.findTrackByPath(file));
  assert.ok(store.findTrackByPath(removed));
  assert.ok(store.getArchiveById(archiveId));
  await scan(lib);
  assert.equal(scanner.scanState.incompleteLibraries, 0);
  assert.ok(store.findTrackByPath(file));
  assert.equal(store.findTrackByPath(removed), null);
  assert.equal(store.getArchiveById(archiveId), null);
});

test('A file stat failure also prevents deletion of unseen tracks', async () => {
  const root = path.join(temp, 'stat-failure');
  const file = path.join(root, 'Album', '01.wav');
  const removed = path.join(root, 'Album', '02.wav');
  audio(file); audio(removed);
  const lib = store.addLibrary(root);
  await scan(lib);
  fs.unlinkSync(removed);
  const original = fsp.stat;
  fsp.stat = async (target, ...args) => { if (target === file) throw denied(); return original(target, ...args); };
  try { await scan(lib); } finally { fsp.stat = original; }
  assert.equal(scanner.scanState.incompleteLibraries, 1);
  assert.ok(store.findTrackByPath(file));
  assert.ok(store.findTrackByPath(removed));
});

test('An unreadable release aborts a manual rescan before removing existing tracks', async () => {
  const root = path.join(temp, 'manual', '[RJ234567]作品');
  const file = path.join(root, 'main', '01.wav');
  const removed = path.join(root, '02.wav');
  audio(file); audio(removed);
  const lib = store.addLibrary(path.dirname(root));
  await scan(lib);
  fs.unlinkSync(removed);
  const original = fs.readdirSync;
  fs.readdirSync = (dir, ...args) => { if (dir === path.dirname(file)) throw denied(); return original(dir, ...args); };
  try {
    await assert.rejects(scanner.rescanReleaseRoot({ releaseRoot: root, libraryId: lib.id }), /synthetic NAS/);
  } finally { fs.readdirSync = original; }
  assert.ok(store.findTrackByPath(file));
  assert.ok(store.findTrackByPath(removed));
});

test('An inaccessible library root retains its last successful index', async () => {
  const root = path.join(temp, 'disconnected');
  const file = path.join(root, '01.wav');
  audio(file);
  const lib = store.addLibrary(root);
  await scan(lib);
  const original = fsp.stat;
  fsp.stat = async (target, ...args) => { if (target === root) throw denied(); return original(target, ...args); };
  try { await scan(lib); } finally { fsp.stat = original; }
  assert.equal(scanner.scanState.incompleteLibraries, 1);
  assert.ok(store.findTrackByPath(file));
});

test('An audio read failure keeps the previous file record instead of a fallback update', async () => {
  const root = path.join(temp, 'audio-read');
  const file = path.join(root, '01.wav');
  const removed = path.join(root, '02.wav');
  audio(file); audio(removed);
  const lib = store.addLibrary(root);
  await scan(lib);
  const previous = store.findTrackByPath(file);
  fs.appendFileSync(file, 'x');
  fs.unlinkSync(removed);
  const original = fsp.open;
  fsp.open = async (target, ...args) => { if (target === file) throw denied(); return original(target, ...args); };
  syncBuiltinESMExports();
  try { await scan(lib); } finally { fsp.open = original; syncBuiltinESMExports(); }
  assert.equal(scanner.scanState.incompleteLibraries, 1);
  assert.equal(store.findTrackByPath(file).size, previous.size);
  assert.ok(store.findTrackByPath(removed));
});

test('An archive parse failure preserves its old member index and track records', async () => {
  const root = path.join(temp, 'archive-failure');
  fs.mkdirSync(root);
  const archive = path.join(root, 'work.zip');
  fs.writeFileSync(archive, 'temporarily unreadable ZIP');
  const lib = store.addLibrary(root);
  const id = store.upsertArchive({ path: archive, libraryId: lib.id }, [{ name: '01.wav', kind: 'audio', size: 204 }]);
  const file = virtualPath(archive, '01.wav');
  store.upsertTrack({ path: file, dir: archive, filename: '01.wav', libraryId: lib.id, albumKey: file,
    archiveId: id, sourceKind: 'archive_member', memberPath: '01.wav' });
  await scan(lib);
  assert.equal(scanner.scanState.incompleteLibraries, 1);
  assert.ok(store.findTrackByPath(file));
  assert.equal(store.countArchiveMembers(id), 1);
  await assert.rejects(scanner.rescanReleaseRoot({ releaseRoot: archive, libraryId: lib.id }));
  assert.ok(store.findTrackByPath(file));
});
