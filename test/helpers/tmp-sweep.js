// ROADMAP 47 (0.8.3 M5g): tests leave their temp folders in the temp dir (one full suite added ~800 folders / ~37 MB on a RAM-backed /tmp). Loaded with `node --test --import ./test/helpers/tmp-sweep.js` (the
// package's `npm test` does): every folder THIS process makes with mkdtempSync / mkdtemp / fs.promises.mkdtemp under the temp dir is removed when the process exits. Precise on purpose: only folders this process
// created are removed (never by name pattern, so two test files running side by side cannot touch each other's), and a folder a test removed itself is simply gone. Not a test file.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, dirname, sep } from 'node:path';

const root = resolve(tmpdir()) + sep;
const made = new Set();
const note = p => { try { const abs = resolve(String(p)); if (abs.startsWith(root) && abs !== root) made.add(abs); } catch { /* never let bookkeeping break a test */ } return p; };

const sync = fs.mkdtempSync; fs.mkdtempSync = function mkdtempSync(...a) { return note(sync.apply(this, a)); };
const cb = fs.mkdtemp; fs.mkdtemp = function mkdtemp(prefix, opts, done) {
  const wrap = f => (err, p) => { if (!err) note(p); f(err, p); };
  if (typeof opts === 'function') return cb.call(this, prefix, wrap(opts)); return cb.call(this, prefix, opts, wrap(done));
};
const prom = fs.promises.mkdtemp; fs.promises.mkdtemp = async function mkdtemp(...a) { return note(await prom.apply(this, a)); };

// mkdir (M5g ruling, 11 Oct: tests build `<mkdtemp folder>-chains` siblings with mkdirSync, which the mkdtemp hooks never saw): a folder is recorded ONLY when THIS call created it and it sits directly under the temp dir.
// Non-recursive: a call that returns did create it (an existing folder throws EEXIST). Recursive: the call returns the FIRST path it created (undefined when everything existed), never a guessed one. A deeper first-created path
// (the temp dir's own subfolder already existed) is not ours to remove and is left alone.
const tmpRoot = resolve(tmpdir());
const noteMade = (p, first) => { try { const abs = first === undefined || first === null ? null : resolve(String(first)); if (abs && dirname(abs) === tmpRoot) made.add(abs); } catch { /* never let bookkeeping break a test */ } };
const recursive = o => o !== null && typeof o === 'object' && o.recursive === true;
const mkSync = fs.mkdirSync; fs.mkdirSync = function mkdirSync(path, opts) { const r = mkSync.apply(this, arguments); noteMade(path, recursive(opts) ? r : path); return r; };
const mkCb = fs.mkdir; fs.mkdir = function mkdir(path, opts, done) {
  const cb = typeof opts === 'function' ? opts : done; const o = typeof opts === 'function' ? undefined : opts;
  const wrap = (err, first) => { if (!err) noteMade(path, recursive(o) ? first : path); return cb(err, first); };
  return typeof cb === 'function' ? mkCb.call(this, path, ...(typeof opts === 'function' ? [wrap] : [opts, wrap])) : mkCb.apply(this, arguments);
};
const mkProm = fs.promises.mkdir; fs.promises.mkdir = async function mkdir(path, opts) { const r = await mkProm.apply(this, arguments); noteMade(path, recursive(opts) ? r : path); return r; };
syncBuiltinESMExports();

process.on('exit', () => { for (const dir of made) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } } });
