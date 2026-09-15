// test/binary-packaging.test.js
//
// The packaged binaries (npm run build:bin / build:appimage) can only be proven by building them
// and running scripts/smoke-binary.mjs, which needs network and ~80 MB per target - not a unit
// test. What can be checked offline is the configuration those builds depend on, because each of
// these broke a real build once: a file the code reads that pkg never bundled, and an MCP tool
// that spawned `node src/cli.js`, which does not exist inside a binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const read = p => readFileSync(join(root, p), 'utf8');

test('every JSON file the code reads next to itself is bundled as a pkg asset', () => {
  // pkg follows imports, not readFileSync. Derive the files read via join(here, '<name>.json')
  // from the source instead of listing them by hand.
  const srcFiles = readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js'));
  const readJson = new Set();
  for (const f of srcFiles) {
    for (const m of read(join('src', f)).matchAll(/join\(here, '([\w.-]+\.json)'\)/g)) readJson.add(join('src', dirname(f), m[1]).replace(/\\/g, '/'));
  }
  assert.ok(readJson.has('src/pricing.json'), 'expected at least src/pricing.json to be found');
  for (const file of readJson) assert.ok(pkg.pkg.assets.includes(file), `${file} is read at runtime but not in package.json pkg.assets`);
  assert.ok(pkg.pkg.assets.includes('chains/**/*.json'), 'the bundled chains must be pkg assets (list_chains, demo, doctor read them)');
});

test('build tooling is pinned and never shipped to npm users', () => {
  assert.match(pkg.devDependencies['@yao-pkg/pkg'], /^\d+\.\d+\.\d+$/, 'pkg must be an exact version');
  assert.ok(!pkg.dependencies['@yao-pkg/pkg'], 'pkg is a build tool, not a runtime dependency');
  assert.ok(!pkg.files.some(f => /^(dist|scripts)\b/.test(f)), 'dist/ and scripts/ are not part of the npm tarball');
  assert.match(read('.gitignore'), /^dist\/$/m, 'built binaries are never committed');
  assert.match(read('scripts/build-appimage.sh'), /^TOOL_SHA256=[0-9a-f]{64}$/m, 'appimagetool must be checksum-pinned');
});

test('the MCP server never starts the CLI as `node src/cli.js` directly - inside a binary there is no such file', () => {
  const server = read('src/mcp/server.js');
  assert.doesNotMatch(server, /(spawn|execFileSync|execFile)\(\s*'node'/, 'use cliCommand(), which re-invokes the binary when packaged');
  const uses = [...server.matchAll(/\.\.\.cliCommand\(/g)].length;
  const withEnv = [...server.matchAll(/\.\.\.cliCommand\([^)]*\)\)?,\s*\{[^}]*env: cliEnv/g)].length;
  assert.ok(uses >= 3, 'dry_run, start_run and resume all go through cliCommand()');
  assert.equal(withEnv, uses, 'every cliCommand() spawn passes env: cliEnv, or a packaged child starts as plain node');
});

test('no dynamic import() anywhere in src/ - a packaged binary cannot run one', () => {
  // pkg only bundles what static imports reach, and even a built-in like `await import('node:fs')`
  // throws "A dynamic import callback was not specified" inside the binary. This broke --mcp in the
  // prototype and start_run/resume_run in the first real build.
  const offenders = readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js'))
    .filter(f => /(^|[^\w.])import\(\s*['"`]/m.test(read(join('src', f)).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')));
  assert.deepEqual(offenders, []);
});

test('the build workflow smoke-tests every artifact it uploads', () => {
  const wf = read('.github/workflows/release-binaries.yml');
  const uploaded = [...wf.matchAll(/^\s+(dist\/\S+)$/gm)].map(m => m[1]);
  assert.equal(uploaded.length, 3);
  for (const artifact of uploaded) assert.match(wf, new RegExp(`smoke:bin -- ${artifact.replace(/\./g, '\\.')}\\b`), `${artifact} is uploaded without a smoke test`);
  for (const script of ['build:bin', 'build:appimage', 'smoke:bin']) assert.ok(pkg.scripts[script], `package.json has no ${script} script`);
  assert.ok(existsSync(join(root, 'scripts', 'smoke-binary.mjs')));
});
