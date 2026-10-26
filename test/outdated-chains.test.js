// 0.8.3 (lane B, Muad 18 Okt 2026: "Your pick sounds good"): every retired chain lives in chains/outdated/, in the repository and not in the npm package. A run recorded on one, or a --chain that
// names one, can no longer find its file, so the errors say where it went. OUTDATED_0_8_2 / OUTDATED_0_8_3 (src/chain-name.js) are typed lists because chains/outdated/ is not in the npm
// package: this test keeps them equal to the folder in the repository. Offline, $0. (Replaces test/archived-chains.test.js of 0.8.2, which did the same for archive/chains/.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { OUTDATED_CHAINS, OUTDATED_0_8_2, OUTDATED_0_8_3, outdatedChainHint, outdatedAdviceChainHint } from '../src/chain-name.js';
import { admitChain } from '../src/send-path-refusals.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');

test('OUTDATED_CHAINS equals the files in chains/outdated/, none of them is also in chains/, and archive/chains/ is gone', () => {
  const outdated = readdirSync(join(root, 'chains', 'outdated')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
  assert.deepEqual([...OUTDATED_CHAINS].sort(), outdated);
  assert.equal(new Set(OUTDATED_CHAINS).size, OUTDATED_CHAINS.length, 'no name is in both lists');
  const shipped = new Set(readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)));
  assert.deepEqual(outdated.filter(n => shipped.has(n)), []);
  assert.equal(existsSync(join(root, 'archive', 'chains')) ? readdirSync(join(root, 'archive', 'chains')).length : 0, 0, 'archive/chains/ holds nothing any more');
});

test('no current doc or schema text still sends a reader to archive/chains/ (A-DRAFT, 0.8.3 lane B: the folder is gone; the old path in config/chain-schema.json and the README was false)', () => {
  for (const f of ['README.md', 'config/chain-schema.json', 'TROUBLESHOOTING.md', 'CONTRIBUTING.md', 'PERSONAS.md', 'docs/index.html', 'docs/skills.html']) {
    assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /archive\/chains/, `${f} still names the folder that no longer exists`);
  }
});

test('the hint names chains/outdated/ for a 0.8.2 name and a 0.8.3 name, and says nothing for a kept chain or an unknown name (the check can fail)', () => {
  const old = outdatedChainHint(OUTDATED_0_8_2[0]), neu = outdatedChainHint(OUTDATED_0_8_3[0]);
  assert.match(old, new RegExp(`chains/outdated/${OUTDATED_0_8_2[0]}\\.json`)); assert.match(old, /retired from the package \(0\.8\.2\)/);
  assert.match(neu, new RegExp(`chains/outdated/${OUTDATED_0_8_3[0]}\\.json`)); assert.match(neu, /retired from the package \(0\.8\.3\)/);
  assert.doesNotMatch(old + neu, /archive\/chains/, 'the old folder is not named');
  for (const kept of ['plan-mini-council', 'verify', 'mock', 'no-such-chain']) assert.equal(outdatedChainHint(kept), '', kept);
});

test('an advice chain that was retired says where it went and that the copy goes to COUNCIL_ADVICE_CHAINS_DIR (never a project chains/); admission refuses it by that sentence; a kept or unknown name keeps the old refusal', () => {
  const h = outdatedAdviceChainHint('advise-premium');
  assert.match(h, /chains\/outdated\/advise-premium\.json/); assert.match(h, /COUNCIL_ADVICE_CHAINS_DIR/); assert.doesNotMatch(h, /this project's chains\//);
  assert.match(admitChain('advise-premium', null), /^no advice chain "advise-premium" in the package\..*COUNCIL_ADVICE_CHAINS_DIR/);
  assert.equal(admitChain('no-such', null), '"no-such" is not an advise chain', 'an unknown name keeps the old sentence');
  assert.equal(outdatedAdviceChainHint('advise-single'), '');
});

test('CLI: --chain <retired name> says it was retired and where to copy it from; an unknown name gets no such hint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-outdated-'));
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a note app.\n');
    const run = chain => spawnSync(process.execPath, [cli, '--task', 'tasks/t.md', '--chain', chain, '--dry-run'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    for (const [name, since] of [['plan-debate', '0.8.2'], ['plan-daily-7', '0.8.3']]) {
      const a = run(name);
      assert.equal(a.status, 1, a.stdout + a.stderr);
      assert.match(a.stderr, new RegExp(`No such chain: "${name}"`));
      assert.match(a.stderr, new RegExp(`chains/outdated/${name}\\.json`)); assert.match(a.stderr, new RegExp(`retired from the package \\(${since.replaceAll('.', '\\.')}\\)`));
    }
    const b = run('no-such-chain');
    assert.equal(b.status, 1);
    assert.doesNotMatch(b.stderr, /chains\/outdated/);
    // the copy the hint asks for works: the file in the project's own chains/ is found before the package's
    mkdirSync(join(dir, 'chains')); writeFileSync(join(dir, 'chains', 'plan-daily-7.json'), JSON.stringify(JSON.parse(readFileSync(join(root, 'chains', 'outdated', 'plan-daily-7.json'), 'utf8'))));
    const c = run('plan-daily-7');
    assert.equal(c.status, 0, c.stdout + c.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a retired chain is not in the tarball and --chain does not look in chains/outdated/ for it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-outdated-pkg-'));
  try {
    const r = spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /^  plan-daily-7\s/m, 'doctor lists chains/ only');
    assert.match(r.stdout, /^  plan-mini-council\s/m);
    assert.ok(existsSync(join(root, 'chains', 'outdated', 'plan-daily-7.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// MCP `prepare_stage_prompt` on a paused run whose recorded chain was retired: it said "could not resolve this stage to a known stage kind" (no cause); it now says where the chain went (B-DRAFT).
function mcpCall(cwd, call) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    let buf = ''; const timer = setTimeout(() => { child.kill(); fail(new Error('timed out')); }, 60_000);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.stdin.end(); child.kill(); done(JSON.parse(m.result.content[0].text)); } } catch { /* not JSON-RPC */ } }
    });
    child.stdin.write([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'outdated-chains', version: '0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: call }].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}

test('MCP prepare_stage_prompt on a run recorded on a retired chain says where the chain went; on a kept chain it still builds the bundle', async () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-outdated-mcp-')); mkdirSync(join(work, 'tasks'), { recursive: true });
  try {
    writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    const p = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/t.md', '--max-usd', 'none'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8' });
    assert.equal(p.status, 3, `fixture: the run paused at its external stage: ${p.stdout}${p.stderr}`);
    const id = readdirSync(join(work, 'runs'))[0]; const meta = join(work, 'runs', id, 'run.json');
    const kept = await mcpCall(work, { name: 'prepare_stage_prompt', arguments: { run: id } });
    assert.ok(!kept.error, `control: a kept chain builds the bundle: ${JSON.stringify(kept).slice(0, 200)}`);
    const run = JSON.parse(readFileSync(meta, 'utf8')); writeFileSync(meta, JSON.stringify({ ...run, chain: 'plan-daily-7' }));
    const gone = await mcpCall(work, { name: 'prepare_stage_prompt', arguments: { run: id } });
    assert.match(String(gone.error), /no longer in the package/); assert.match(String(gone.error), /chains\/outdated\/plan-daily-7\.json/);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
