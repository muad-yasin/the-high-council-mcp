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
import { OUTDATED_CHAINS, OUTDATED_0_8_2, OUTDATED_0_8_3, REMOVED_ADVICE_CHAINS, outdatedChainHint } from '../src/chain-name.js';

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
  for (const f of ['README.md', 'KNOWN-LIMITS.md', 'AI-README.md', 'config/chain-schema.json', 'TROUBLESHOOTING.md', 'CONTRIBUTING.md', 'PERSONAS.md', 'docs/index.html', 'docs/skills.html']) {
    assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /archive\/chains/, `${f} still names the folder that no longer exists`);
  }
});

test('the hint names chains/outdated/ for a 0.8.2 name and a 0.8.3 name, and says nothing for a kept chain or an unknown name (the check can fail)', () => {
  const old = outdatedChainHint(OUTDATED_0_8_2[0]), neu = outdatedChainHint(OUTDATED_0_8_3[0]);
  assert.match(old, new RegExp(`chains/outdated/${OUTDATED_0_8_2[0]}\\.json`)); assert.match(old, /retired from the package \(0\.8\.2\)/);
  assert.match(neu, new RegExp(`chains/outdated/${OUTDATED_0_8_3[0]}\\.json`)); assert.match(neu, /retired from the package \(0\.8\.3\)/);
  assert.doesNotMatch(old + neu, /archive\/chains/, 'the old folder is not named');
  for (const kept of ['plan-mini-council', 'plan-medium-council', 'mock', 'no-such-chain']) assert.equal(outdatedChainHint(kept), '', kept);
  // 0.8.4 (seats and retirements unit, Muad 10 Nov 2026): these four moved to chains/outdated/; a --chain that names one says so and where the file is.
  for (const gone of ['verify', 'plan-mini-council-sol-session', 'plan-default-opro-council', 'plan-china-mini-council']) {
    assert.ok(OUTDATED_CHAINS.includes(gone), `${gone} is listed`);
    assert.match(outdatedChainHint(gone), new RegExp(`"${gone}" was retired from the package \\(0\\.8\\.4\\).*chains/outdated/${gone}\\.json`), gone);
  }
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD 'an advice chain that was retired says where it went and that the copy goes to COUNCIL_ADVICE_CHAINS_DIR': advise-premium and advise-single named chains/outdated/<name>.json and a copy step ("retired from the package (0.8.3|0.8.4)"), and admission refused them by that sentence. NEW each of the eight names in REMOVED_ADVICE_CHAINS gets ONE sentence, that the chain "was removed in 0.8.4 with the advice add-on. Its file is no longer in the repository; the git history keeps it.", with no file and no copy step; admission refuses it by that sentence; a name that is not one of the eight keeps the old refusal. WHY the eight advise-* files in chains/outdated/ are deleted with the add-on, so a hint naming a file that does not exist would be false. (Refs: REM-w1, Muad's Q9.)
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD (wave 1): the test also asserted outdatedAdviceChainHint(name) equals the sentence, that admitChain(name, null) from src/send-path-refusals.js starts with `no advice chain "<name>" in the package.` plus the sentence, and that admitChain('no-such', null) is '"no-such" is not an advise chain'. NEW: the hint is asserted through outdatedChainHint alone, and a new row shows that no advise-* or mock-advise-* file is in chains/ or chains/outdated/. WHY: outdatedAdviceChainHint (src/chain-name.js) and src/send-path-refusals.js (admitChain) left with the advice add-on; the sentence of REM-w1 is unchanged and is also asserted on the real verb in the CLI test below.
test('a removed advice chain says it was removed in 0.8.4 with the advice add-on and names no file; no advise chain file is left in chains/ or chains/outdated/', () => {
  assert.equal(REMOVED_ADVICE_CHAINS.length, 8);
  for (const name of REMOVED_ADVICE_CHAINS) {
    const sentence = ` "${name}" was removed in 0.8.4 with the advice add-on. Its file is no longer in the repository; the git history keeps it.`;
    assert.equal(outdatedChainHint(name), sentence, name);
    assert.doesNotMatch(sentence, /chains\/outdated|COUNCIL_ADVICE_CHAINS_DIR/);
    assert.equal(OUTDATED_CHAINS.includes(name), false, `${name} is not an outdated chain any more`);
    assert.equal(existsSync(join(root, 'chains', 'outdated', `${name}.json`)), false, `${name}.json is not in the repository`);
    assert.equal(existsSync(join(root, 'chains', `${name}.json`)), false, `${name}.json is not shipped`);
  }
  for (const dir of ['chains', join('chains', 'outdated')]) {
    assert.deepEqual(readdirSync(join(root, dir)).filter(f => /^(mock-)?advise-/.test(f)), [], `${dir} holds no advise chain file`);
  }
  assert.equal(outdatedChainHint('no-such'), '');
  // a kept or still-retired non-advice name is unaffected by the removal
  assert.match(outdatedChainHint('plan-daily-7'), /chains\/outdated\/plan-daily-7\.json/);
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
    // NEW (0.8.4 add-on removal; REM-w1, Q9): a removed advice chain gets the removed-chain sentence on the real verb, and no file is named.
    const gone = run('advise-single');
    assert.equal(gone.status, 1, gone.stdout + gone.stderr);
    assert.match(gone.stderr, /No such chain: "advise-single"/);
    assert.match(gone.stderr, /"advise-single" was removed in 0\.8\.4 with the advice add-on\. Its file is no longer in the repository; the git history keeps it\./);
    assert.doesNotMatch(gone.stderr, /chains\/outdated\/advise-single/);
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
