import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { pathIdentity } from '../server/path-identity.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-nas-paths-'));
process.env.LAM_DATA_DIR = path.join(temp, 'data');
delete process.env.LUNA_DLSITE_INDEX;
const store = await import('../server/db.mjs');
const assets = await import('../server/assets.mjs');
const dlsite = await import('../server/dlsite.mjs');
const { albumKeyOf, PERSIST_SEP } = await import('../server/config.mjs');
after(() => { store.closeDb(); fs.rmSync(temp, { recursive: true, force: true }); });

function addTrack(file, libraryId = null) {
  store.upsertTrack({ path: file, dir: path.dirname(file), libraryId, filename: path.basename(file), albumKey: file });
}

test('Windows path identity still folds case; POSIX preserves it', () => {
  assert.equal(pathIdentity('C:\\Music', { platform: 'win32' }), 'c:\\music');
  assert.equal(pathIdentity('/media/Music', { platform: 'linux' }), '/media/Music');
});

test('POSIX library lookup, asset imports, exclusions and removal distinguish case', { skip: process.platform === 'win32' }, () => {
  const upper = path.join(temp, 'Music');
  const lower = path.join(temp, 'music');
  const first = store.addLibrary(upper, 'Upper');
  const result = assets.importUserAssets({ version: 1, libraries: [{ path: lower, displayName: 'Lower' }] });
  assert.equal(result.libraries, 1);
  const second = store.findLibraryByPath(lower);
  assert.notEqual(first.id, second.id);
  assert.equal(store.findLibraryByPath(upper).display_name, 'Upper');
  const a = path.join(upper, '01.wav');
  const b = path.join(lower, '01.wav');
  addTrack(a, first.id);
  addTrack(b, second.id);
  assert.deepEqual(store.trackPathsUnder(upper), [a]);
  assert.notEqual(store.voiceAlbumKey(upper), store.voiceAlbumKey(lower));
  assert.notEqual(albumKeyOf({ dir: upper }), albumKeyOf({ dir: lower }));
  store.addExclusion({ albumKey: `voice${PERSIST_SEP}${upper}`, rootPath: upper });
  const excluded = store.exclusionIndex();
  assert.equal(excluded.byPath(upper), true);
  assert.equal(excluded.byPath(lower), false);
  assert.equal(excluded.byKey(`voice${PERSIST_SEP}${lower}`), false);
  store.removeLibrary(first.id);
  assert.equal(store.findTrackByPath(a), null);
  assert.ok(store.findTrackByPath(b));
});

test('Archive prefix lookup treats wildcard characters literally and observes path boundaries', () => {
  const root = path.join(temp, 'Album_100%🎵');
  const match = path.join(root, 'work.zip');
  const unrelated = path.join(temp, 'AlbumX100abc', 'work.zip');
  const adjacent = `${root}-other${path.sep}work.zip`;
  for (const file of [match, unrelated, adjacent]) store.upsertArchive({ path: file });
  assert.deepEqual(store.archivesUnder(root).map((a) => a.path), [match]);
  assert.deepEqual(store.archivesUnder(`${root}${path.sep}`).map((a) => a.path), [match]);
  if (process.platform !== 'win32') assert.deepEqual(store.archivesUnder(root.toLowerCase()), []);
});

test('DLsite lowercase directory remains a distinct Linux fallback candidate', { skip: process.platform === 'win32' }, () => {
  const lower = path.join(process.env.LAM_DATA_DIR, 'dlsite', dlsite.INDEX_FILE_NAME);
  fs.mkdirSync(path.dirname(lower), { recursive: true });
  fs.writeFileSync(lower, 'fixture');
  assert.ok(dlsite.indexCandidates().includes(lower));
  assert.equal(dlsite.resolveIndexPath(), lower);
});
