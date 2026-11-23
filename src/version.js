// The harness's own version, read from its package.json so `council --version` and the MCP
// server's serverInfo can't drift from the release again (the server said 0.3.0 while the
// package said 0.7.5; pre-release audit 2026-09-23, Packaging L1 / VersionConsistency #3).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached;
function pkgJson() {
  if (cached === undefined) {
    try {
      cached = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
    } catch {
      cached = {};
    }
  }
  return cached;
}
export function harnessVersion() {
  return pkgJson().version || 'unknown';
}
// The code that is running (0.8.4): sha256 over the package's own source, so two runs of "the same version" built from different trees can be told apart. The file set is the one package.json `files` ships, read from
// that manifest in code (so it moves with it): every .js, .mjs and .json file under each listed folder, minus the `!` exclusions (src/http-server.js, chains/outdated/), as relative path then content, in path order. A clone and an
// npm install of the same release therefore give the same stamp. A packaged binary (`process.pkg`) never gets a stamp: its snapshot holds only the files the packager found. Anything else that cannot be read as that whole set (an unreadable file or manifest, a glob this reader does
// not understand, a listed folder that is missing) gives null and the stamp is left OUT: never a partial hash and never a guess. `root` is for tests; the default is the package this file sits in, hashed once per process.
const STAMP_FILE = /\.(?:js|mjs|json)$/;
let codeStamp;
export function codeSha256({ root, packaged = process.pkg !== undefined } = {}) {
  if (packaged) return null;   // a packaged binary (@yao-pkg/pkg sets process.pkg) holds a snapshot of only the files its analysis found, and `..` may even be a real clone: the stamp would not be the code that runs
  const explicit = root !== undefined;
  if (!explicit && codeStamp !== undefined) return codeStamp;
  const base = explicit ? root : join(dirname(fileURLToPath(import.meta.url)), '..');
  let out = null;
  try {
    const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
    if (!Array.isArray(manifest.files)) throw new Error('no files list');
    const posix = x => x.split(sep).join('/');
    const clean = x => String(x).replace(/\/+$/, '');
    if (manifest.files.some(x => /[*?[\]{}]/.test(x))) throw new Error('a glob in files');
    const dirs = manifest.files.filter(x => typeof x === 'string' && !x.startsWith('!') && x.endsWith('/')).map(clean);
    const skip = new Set(manifest.files.filter(x => typeof x === 'string' && x.startsWith('!')).map(x => clean(x.slice(1))));
    if (!dirs.length) throw new Error('no folders');
    const files = [];
    const walk = dir => { for (const name of readdirSync(dir).sort()) { const p = join(dir, name); const rel = posix(relative(base, p)); if (name === 'node_modules' || skip.has(rel)) continue; const st = statSync(p); if (st.isDirectory()) walk(p); else if (STAMP_FILE.test(name)) files.push(rel); } };
    for (const d of dirs) { if (!statSync(join(base, d)).isDirectory()) throw new Error(`no ${d}/`); walk(join(base, d)); }
    if (!files.length) throw new Error('no files');
    const h = createHash('sha256');
    for (const f of files.sort()) { h.update(`${f}\0`); h.update(readFileSync(join(base, f))); h.update('\0'); }
    out = h.digest('hex');
  } catch { out = null; }
  if (!explicit) codeStamp = out;
  return out;
}
// report.json's `producer` (0.7.7, brief 03 fix 6): which package, at which version, wrote the file. 0.8.4 adds the code stamp (absent where it cannot be computed) and, from run.json, one entry per sitting of the run.
export function harnessProducer({ sittings = null, root, packaged } = {}) {
  const code = codeSha256({ ...(root === undefined ? {} : { root }), ...(packaged === undefined ? {} : { packaged }) });
  return {
    name: pkgJson().name || 'the-high-council', version: harnessVersion(),
    ...(code ? { code_sha256: code } : {}),
    ...(Array.isArray(sittings) && sittings.length ? { sittings } : {}),
  };
}
/** One sitting of a run, for run.json's `sittings[]`: when it started, which process, which version, and the code stamp when there is one. */
export function sittingEntry() {
  const code = codeSha256();
  return { at: new Date().toISOString(), pid: process.pid, version: harnessVersion(), ...(code ? { code_sha256: code } : {}) };
}
