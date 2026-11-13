// Who decides what happens to an old advice folder (0.8.1 plan M5 Work 1 and 4, decided rules 5a and 5d, audit A4; review D1): a folder an advice call left is judged by ITS OWN FILES, never by a chain looked up
// by name, because the chain lookup reads the project's chains/ and a project could shadow the name. Mock-only, $0.
// 0.8.4 (the add-on removal, wave 2): the advice add-on is removed. This file's tests of the add-on's authority rules are removed with the code they drove: the sensitivity floor (src/advice-tier.js), the chain loader
// (src/send-profiles.js: the package's chains/ or the operator's folder, never the project's), --advice-adopt running the operator's chain, and the .env check of the operator's advice settings (nothing reads
// COUNCIL_ADVICE_* now). What stays, and is rewritten below, is review D1: an old advice folder is never resumed through a project chain that shadows its name, over MCP (resume_run) or the CLI (--resume).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A project that tries to decide for itself: its own chains/advise-standard.json, a plain planning chain (the mock chain, renamed; no `advise` block) with a builder seat, so a chain lookup that ran would
// find a chain that can really run the folder's brief; and a policy.json that still holds advice_sensitivity_floor (accepted and ignored since 0.8.4).
function hostileProject() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-authority-'));
  mkdirSync(join(dir, 'chains'));
  const plain = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'advise-standard.json'), JSON.stringify({ ...plain, name: 'advise-standard' }));
  writeFileSync(join(dir, 'policy.json'), JSON.stringify({ advice_sensitivity_floor: 'public' }));
  return dir;
}

function session(cwd, { env = {} } = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys(), ...env } });
  const pending = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'authority', version: '0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); return m.result; },
    async close() { child.stdin.end(); await Promise.race([new Promise(r => child.on('exit', r)), sleep(3000)]); child.kill(); },
  };
}

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the CLI half checked a bad COUNCIL_ADVICE_CHAINS_DIR ("inside the working folder"), a chain only the project has ("no advice chain \"project-only\"") and, with the operator folder set to the fixture folder, the advice sentence; resume_run was checked with the shadow. NEW: resume_run and --resume refuse the old advice folder on the folder's own files BEFORE any chain is looked up (REM-w21, REM-w8): with the shadowing project chain advise-standard, with a chain name no folder holds, and with a chain only the project has; no COUNCIL_ADVICE_CHAINS_DIR is set or read. WHY: the operator folder and the "advice chain" lookup left with src/send-profiles.js; the refusal is the same on every path (Q3 rows: resume_run refusal, --resume refusal, the shadowing row).
test('review D1: an old advice folder is never resumed through a project chain that shadows its name, nor when its chain is gone (resume_run and --resume); Q3 rows: resume_run and --resume refuse an advice folder', async () => {
  const dir = hostileProject();
  // A started advice run that stopped without a report; its project shadow chain is NOT marked as advice (so a chain lookup would misread it).
  const id = '2026-10-03T03-00-00-001Z';
  const run = join(dir, 'runs', id);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'advice-brief.md'), '# A brief\n');
  // zero-spend-ok: the test asserts a resume of an ADVICE folder is refused / never offered; nothing is started, no approval exists, and both children get malformed provider keys (never filled from .env, never sent)
  writeFileSync(join(run, 'run.json'), JSON.stringify({ chain: 'advise-standard', task: join(run, 'advice-brief.md'), cwd: dir, maxUsd: 1 }));
  writeFileSync(join(run, 'advise-log.json'), JSON.stringify({ schema: 'advise-log/1', run: id, ts: Date.now(), origin: 'tool', quoted: { ceiling_usd: 1 } }));
  const s = session(dir);
  try {
    const r = await s.call('resume_run', { run: id });
    assert.match(r.content[0].text, /this is an advice run, which is not resumed over MCP/);
    assert.equal(existsSync(join(run, 'build.md')), false);
  } finally { await s.close(); }
  // The CLI's --resume: refused on the folder's own files, exit 2, REM-w21 whole, with the shadow chain present ...
  const env = { PATH: process.env.PATH, HOME: dir, ...malformedProviderKeys() };
  const sentence = `--resume: ${id} is an advice call, which is not continued, whatever ended it. Nothing was sent and nothing was spent.`;
  const shadowed = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
  assert.equal(shadowed.status, 2, shadowed.stderr); assert.ok(shadowed.stderr.includes(sentence), shadowed.stderr);
  assert.equal(existsSync(join(run, 'build.md')), false);
  // ... with a chain no folder holds (the refusal comes before the lookup: not the unknown-chain exit 1) ...
  writeFileSync(join(run, 'run.json'), JSON.stringify({ chain: 'advise-single', task: join(run, 'advice-brief.md'), cwd: dir, maxUsd: 1 }));
  const gone = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
  assert.equal(gone.status, 2, gone.stderr); assert.ok(gone.stderr.includes(sentence), gone.stderr);
  // ... and with a chain only the project has
  writeFileSync(join(dir, 'chains', 'project-only.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8')), name: 'project-only' }));
  writeFileSync(join(run, 'run.json'), JSON.stringify({ chain: 'project-only', task: join(run, 'advice-brief.md'), cwd: dir, maxUsd: 1 }));
  const projectOnly = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
  assert.equal(projectOnly.status, 2, projectOnly.stderr); assert.ok(projectOnly.stderr.includes(sentence), projectOnly.stderr);
  assert.equal(existsSync(join(run, 'build.md')), false);
});
