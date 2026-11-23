// test/advice-tools.test.js
//
// What is left of the advice add-on's end-to-end tests (thc-research brief 29), offline, $0, no keys.
// 0.8.4 (the add-on removal, wave 2): council_quote and council_advise are not registered any more, and nothing in THC starts an advice call (the CLI's --advice-adopt is an unknown option now). The 40-odd tests
// that drove the two tools over stdio (the quote and the masking, the guards and their refusals, the approval channels, the hold and run_status, a client's cancel and the STOP races, the spawn-hold seam,
// the record) and the test of the CLI's adopt path are removed with the code; what they reached that stays is listed in the result table's COVERAGE LEFT BEHIND.
// What stays here is what a person or a client can still hit over MCP: the two tools are gone from the tool list, start_run meets a chain with an `advise` block (REM-w22, refused), resume_run meets an old
// advice folder (REM-w8, refused on the folder's own files, even when a project chain of the same name would be a plan chain), and list_chains no longer marks a chain as "tools only".
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const fixtureDir = join(root, 'test', 'fixtures', 'advice-chains');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One stdio session, kept open: calls by id. The server gets malformed provider keys first (no MCP-server test can reach a paid provider), then the test's own env.
class Session {
  constructor(cwd, { env = {} } = {}) {
    this.pending = new Map(); this.nextId = 10; this.buf = '';
    this.child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys(), ...env } });
    this.exited = new Promise(r => this.child.on('exit', r));
    this.child.stdout.on('data', d => {
      this.buf += d; let nl;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== undefined && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      }
    });
    this.ready = this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'advice-test', version: '0' } })
      .then(() => this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  }
  rpc(method, params, id = this.nextId++) {
    const p = new Promise(r => this.pending.set(id, r));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return p;
  }
  async call(name, args) { await this.ready; const m = await this.rpc('tools/call', { name, arguments: args }); return m.result ?? m; }
  async tools() { await this.ready; const m = await this.rpc('tools/list', {}); return m.result.tools.map(t => t.name); }
  async close() {
    try { this.child.stdin.end(); } catch { /* gone */ }
    await Promise.race([this.exited, sleep(3000)]); this.child.kill();
    let ended = false; await Promise.race([this.exited.then(() => { ended = true; }), sleep(10_000)]);
    if (!ended) { this.child.kill('SIGKILL'); console.error(`close: the MCP server (pid ${this.child.pid}) was still running 10 s after it was told to stop; killed`); }
  }
}

const workdir = () => mkdtempSync(join(tmpdir(), 'thc-advice-'));
const textOf = r => r.content.map(c => c.text).join('\n');
// A project's own copy of the one advice chain that is left as a fixture (mock seats only): the MCP server finds a chain by name in the working folder's chains/.
function projectAdviceChain(dir, name) {
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'chains', `${name}.json`), readFileSync(join(fixtureDir, `${name}.json`), 'utf8'));
}
// An old advice run folder as a person's disk can still hold one: the brief, run.json and advise-log.json (the files that make it an advice folder). No chain of that name needs to exist.
function oldAdviceFolder(dir, id, chain = 'a-chain-that-no-longer-exists') {
  const run = join(dir, 'runs', id);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'advice-brief.md'), '# A brief\n\nShould we?\n');
  writeFileSync(join(run, 'run.json'), JSON.stringify({ chain, task: join(run, 'advice-brief.md'), cwd: dir, maxUsd: 1 }));
  writeFileSync(join(run, 'advise-log.json'), JSON.stringify({ schema: 'advise-log/1', run: id, ts: Date.now(), origin: 'tool', quoted: { ceiling_usd: 1 } }));
  return run;
}

// NEW (0.8.4 add-on removal, wave 2): the two tools are gone from the server. The number of tools listed is derived from the source (every `server.tool(` or `server.registerTool(` of src/mcp/server.js and src/mcp/contract.js: 23 now), as test/landing-page.test.js derives the figure the README types.
test('the MCP server lists no council_quote and no council_advise, lists exactly the tools its source registers, and a call to either is an unknown tool', async () => {
  const dir = workdir(); const s = new Session(dir);
  try {
    const names = await s.tools();
    const registered = ['server.js', 'contract.js'].reduce((n, f) => n + (readFileSync(join(root, 'src', 'mcp', f), 'utf8').match(/\bserver\.(tool|registerTool)\(/g) || []).length, 0);
    assert.equal(names.length, registered, names.join(', '));
    assert.equal(names.includes('council_quote'), false);
    assert.equal(names.includes('council_advise'), false);
    const r = await s.call('council_quote', { mode: 'council' });
    assert.ok(r.isError === true || r.error, JSON.stringify(r).slice(0, 300));
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD (wave 1): start_run answered "mock-advise-standard is an advice chain, which start_run does not start. Nothing was sent or spent." (REM-w7), and resume_run was driven with a folder whose chain was missing. NEW: start_run answers REM-w22 (the "advise" block sentence) for the fixture chain mock-advise-quick, and resume_run is driven twice, also with a SHADOWING project chain advise-standard (a plain planning chain with no advise block) beside the old folder. WHY: the chain-based refusal reads the chain file's `advise` block, and REM-w21/w31 say the folder refusals are made on the folder's own files before any chain is looked up (Q3 rows: resume_run refusal; the shadowing row).
test('start_run refuses a chain with an "advise" block (REM-w22); resume_run refuses an old advice folder (REM-w8), even one whose chain no longer exists or is shadowed by a plain project chain: nothing starts, nothing is spent, and neither sentence names a removed tool', async () => {
  const dir = workdir(); const s = new Session(dir);
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), '# A brief\n\nShould we?\n');
    projectAdviceChain(dir, 'mock-advise-quick');
    const r = await s.call('start_run', { chain: 'mock-advise-quick', task: 'tasks/t.md' });
    const body = JSON.parse(textOf(r));
    assert.equal(body.started, false);
    assert.equal(body.error, 'mock-advise-quick has an "advise" block: the advice add-on was removed in 0.8.4, so this chain cannot run. Nothing was sent or spent.');
    assert.doesNotMatch(body.error, /council_quote|council_advise/);
    assert.equal(existsSync(join(dir, 'runs')), false);
    const REFUSAL = 'this is an advice run, which is not resumed over MCP (a resume would spend with no new preview or approval). An advice call is never continued. Nothing was spent.';
    // (1) the folder names a chain that does not exist
    const id = '2026-10-03T05-00-00-001Z';
    const run = oldAdviceFolder(dir, id);
    const res = JSON.parse(textOf(await s.call('resume_run', { run: id })));
    assert.equal(res.resumed, false);
    assert.equal(res.error, REFUSAL);
    assert.doesNotMatch(res.error, /council_quote|council_advise/);
    assert.equal(existsSync(join(run, 'build.md')), false);
    // (2) the SHADOW: a project chains/advise-standard.json that is a plain planning chain, so a lookup by name would find a chain that could really run the folder's brief
    const plain = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
    writeFileSync(join(dir, 'chains', 'advise-standard.json'), JSON.stringify({ ...plain, name: 'advise-standard' }));
    const id2 = '2026-10-03T05-01-00-001Z';
    const run2 = oldAdviceFolder(dir, id2, 'advise-standard');
    const res2 = JSON.parse(textOf(await s.call('resume_run', { run: id2 })));
    assert.equal(res2.resumed, false);
    assert.equal(res2.error, REFUSAL);
    assert.equal(existsSync(join(run2, 'build.md')), false);
    assert.equal(existsSync(join(run2, 'deliverable.md')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: "list_chains still marks a chain with the advise switch as tools-only" (advice_tools_only: true on a project's copy of an advice chain). NEW: no chain carries advice_tools_only, an advise-block chain included. WHY: list_chains no longer has the key (WORDING: `advice_tools_only` in list_chains is gone); the chain is still listed.
test('list_chains has no advice_tools_only key on any chain, a project copy of the advise-block fixture included', async () => {
  const dir = workdir(); const s = new Session(dir);
  try {
    projectAdviceChain(dir, 'mock-advise-quick');
    const chains = JSON.parse(textOf(await s.call('list_chains', {})));
    assert.ok(chains.find(c => c.name === 'mock'), 'the shipped mock chain is listed');
    assert.equal(chains.some(c => 'advice_tools_only' in c), false);
    assert.equal(chains.some(c => c.name === 'advise-standard' || /^mock-advise-(standard|deep)$/.test(c.name)), false, 'the package ships no advice chain any more');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// Q3 ROW (price_raise): an old advice folder has no resume and no price to raise; the refusal is made on the folder's own files and writes nothing (no pricing.user.json, nothing in the folder). NEW (0.8.4 add-on removal, wave 2): no other file drives price_raise on an advice folder.
test('Q3: price_raise on an old advice folder is refused with its sentence, even when a plain project chain of the folder\'s name exists; nothing is written', async () => {
  const dir = workdir(); const s = new Session(dir);
  try {
    mkdirSync(join(dir, 'chains'), { recursive: true });
    writeFileSync(join(dir, 'chains', 'advise-standard.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8')), name: 'advise-standard' }));
    const id = '2026-10-03T05-02-00-001Z';
    const run = oldAdviceFolder(dir, id, 'advise-standard');
    for (const step of ['quote', 'confirm']) {
      const r = JSON.parse(textOf(await s.call('price_raise', { run: id, step, ...(step === 'confirm' ? { shown: 'a'.repeat(64), reason: 'yes' } : {}) })));
      assert.equal(r.refusal, 'this is an advice run, which has no resume and no price to raise here. Nothing was written.', step);
    }
    assert.equal(existsSync(join(dir, 'pricing.user.json')), false, 'no price row was written');
    assert.equal(existsSync(join(run, 'build.md')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});
