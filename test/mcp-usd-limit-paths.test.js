// WHICH .env the money limit is read from (13 Oct 2026, Haiku job 8, C&C's fix): src/cli.js applies `[cwd/.env, package/.env].find(exists)`; the direct MCP entry read only `<work>/.env`, so in the documented from-source setup
// (`cp .env.example .env` in the clone, an MCP client starting `node /clone/src/mcp/server.js` in a project folder with no .env) a COUNCIL_MAX_USD_LIMIT in the clone's .env set NO limit and start_run max_usd 50 ran at 50.
// ONE function, envFilePathFor(folder, pkg) in src/env-file.js, now picks the file for the CLI (its cwd) and for the server (its WORK folder), and the two-file conflict compares against the file the CLI really applied.
// Every row asserts the VALUE used (a refusal naming the limit), through a real "clone": src/ is COPIED to a temp folder (so the package folder is that folder and can hold its own .env) and everything else is linked to this checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['src', '.git', '.env', 'runs', 'Review', 'test', 'tasks']);

// A clone: src copied for real (module paths resolve through links, so the package folder must be THIS folder), the other top-level entries linked.
function clone(dotenv) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-clone-'));
  cpSync(join(repo, 'src'), join(dir, 'src'), { recursive: true });
  for (const e of readdirSync(repo)) if (!SKIP.has(e)) symlinkSync(join(repo, e), join(dir, e));
  if (dotenv !== undefined) writeFileSync(join(dir, '.env'), dotenv);
  return dir;
}
function folder(dotenv) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-proj-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'A test task.');
  if (dotenv !== undefined) writeFileSync(join(dir, '.env'), dotenv);
  return dir;
}
// Starts the entry, asks start_run (max_usd) once, returns { exit, stderr, answer }.
function ask({ entry, cwd, env = {}, maxUsd = 50 }) { // maxUsd null: the tool call names none (undefined would take the default 50)
  return new Promise(done => {
    const child = spawn(process.execPath, entry, { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys(), ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = ''; child.stderr.on('data', d => { err += d; });
    let buf = ''; let answer = null; let exit = null;
    const finish = () => { clearTimeout(timer); try { child.kill(); } catch { /* gone */ } done({ exit, stderr: err, answer }); };
    const timer = setTimeout(finish, 30_000);
    child.on('exit', (code) => { exit = code; setTimeout(finish, 50); });
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { answer = m?.result?.content?.[0]?.text ?? JSON.stringify(m); finish(); } } catch { /* not JSON-RPC */ }
      }
    });
    const rows = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'paths', version: '0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/t.md', ...(maxUsd === null ? {} : { max_usd: maxUsd }) } } }];
    child.stdin.write(rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const refusedAt = (r, limit) => typeof r.answer === 'string' && r.answer.includes(`COUNCIL_MAX_USD_LIMIT of $${limit}`);

test('1a: the DIRECT entry (`node <clone>/src/mcp/server.js`) in a project folder with NO .env reads the limit from the clone\'s .env: start_run max_usd 50 is refused above $1 (it ran at 50)', async () => {
  const pkg = clone('COUNCIL_MAX_USD_LIMIT=1\n'); const project = folder();
  const r = await ask({ entry: [join(pkg, 'src/mcp/server.js')], cwd: project });
  assert.ok(refusedAt(r, 1), `refused against the clone's limit: ${JSON.stringify(r).slice(0, 400)}`);
  const none = await ask({ entry: [join(pkg, 'src/mcp/server.js')], cwd: project, maxUsd: 'none' });
  assert.ok(none.answer?.includes('COUNCIL_MAX_USD_LIMIT to $1'), `and "none" is refused: ${JSON.stringify(none).slice(0, 300)}`);
});

test('1b: what `npm run mcp` runs (the package folder as the cwd) with COUNCIL_WORKDIR=W and no .env in W: the clone\'s .env limit still holds', async () => {
  const pkg = clone('COUNCIL_MAX_USD_LIMIT=1\n'); const w = folder();
  const r = await ask({ entry: [join(pkg, 'src/mcp/server.js')], cwd: pkg, env: { COUNCIL_WORKDIR: w } });
  assert.ok(refusedAt(r, 1), JSON.stringify(r).slice(0, 400));
});

test('2: `council --mcp` with COUNCIL_WORKDIR=W, no .env in the cwd, the clone\'s .env at 100 and W/.env at 1: refused at start (exit 2), naming both files (the CLI applied the clone\'s file)', async () => {
  const pkg = clone('COUNCIL_MAX_USD_LIMIT=100\n'); const w = folder('COUNCIL_MAX_USD_LIMIT=1\n'); const project = folder();
  const r = await ask({ entry: [join(pkg, 'src/cli.js'), '--mcp'], cwd: project, env: { COUNCIL_WORKDIR: w } });
  assert.equal(r.exit, 2, JSON.stringify(r).slice(0, 400));
  assert.ok(r.stderr.includes(`${join(pkg, '.env')} and ${join(w, '.env')} both set COUNCIL_MAX_USD_LIMIT, to different values`), r.stderr);
});

test('CONTROL: the same layout with the SAME value in both files starts, and the limit (100) is the value used (max_usd 500 is refused above $100)', async () => {
  const pkg = clone('COUNCIL_MAX_USD_LIMIT=100\n'); const w = folder('COUNCIL_MAX_USD_LIMIT=100\n'); const project = folder();
  const r = await ask({ entry: [join(pkg, 'src/cli.js'), '--mcp'], cwd: project, env: { COUNCIL_WORKDIR: w }, maxUsd: 500 });
  assert.ok(refusedAt(r, 100), JSON.stringify(r).slice(0, 400));
});

// Haiku A13 F5, the same root: the HOST sets the limit (10), the PACKAGE .env sets the per-run default (1), the work folder has no .env. The direct entry read no per-run default from the package file, so with a limit set it passed an explicit
// `--max-usd 7` (min(limit, 7)) and that flag beats the child's own MAX_USD_PER_RUN: the run got $7 where the file says $1. Asserted by the VALUE the run was started with (run.json maxUsd).
test('4: the host sets COUNCIL_MAX_USD_LIMIT=10, the package .env sets MAX_USD_PER_RUN=1, no .env in the work folder: the run starts at $1 (it got $7)', async () => {
  const pkg = clone('MAX_USD_PER_RUN=1\n'); const project = folder();
  const r = await ask({ entry: [join(pkg, 'src/mcp/server.js')], cwd: project, env: { COUNCIL_MAX_USD_LIMIT: '10' }, maxUsd: null });
  const started = JSON.parse(r.answer ?? 'null');
  assert.equal(started?.started, true, JSON.stringify(r).slice(0, 300));
  let meta = null;
  for (let i = 0; i < 200 && !meta; i++) { const p = join(project, 'runs', started.run, 'run.json'); if (existsSync(p)) { try { meta = JSON.parse(readFileSync(p, 'utf8')); } catch { /* mid-write */ } } if (!meta) await new Promise(res => setTimeout(res, 50)); }
  assert.equal(meta?.maxUsd, 1, `the per-run default of the package's .env is the value used: ${JSON.stringify(meta?.maxUsd)}`);
});
