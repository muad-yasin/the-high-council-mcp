// The personal-data gate WARNS by default (0.8.3; owner 18 Okt 2026 via the caps session: "Warn by default sounds very good and very user friendly."). Before: no --pii-gate flag = the gate never ran. Now: every run scans its input
// before the first provider call and prints what it finds; the run goes on. `--pii-gate hard-stop` or the setting COUNCIL_PII_GATE=hard-stop (environment, project .env, the Desktop field) refuses instead. Real CLI runs on mock
// chains, $0. Fixtures are assembled at runtime (an email address in a task file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { piiModeSetting } from '../src/pii-mode.js';
import { envFileRefuses } from '../src/env-file.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const EMAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');   // not a reserved placeholder host (those are skipped by the gate)
function workspace(taskText, envText = '') {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pii-default-'));
  writeFileSync(join(dir, '.env'), envText); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), taskText);
  return dir;
}
const council = (dir, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, ...env } });
const runJson = dir => JSON.parse(readFileSync(join(dir, 'runs', readdirSync(join(dir, 'runs'))[0], 'run.json'), 'utf8'));

test('PW-1: no flag, an email in the task: the run STOPS (exit 11, no run folder, nothing sent), the stop screen names the finding and `--allow-pii email`, never the value; `--allow-pii email` goes on and run.json records it; `--pii-gate warn` goes on with the warn line', () => {
  // CHANGED ACCEPTED (owner 18 Okt 2026 16:45, "The warning has to stop the plan from running, unless the user explicitly chooses to continue"). OLD: no flag, an email: the PII-GATE (warn) line, the run went on (exit 0), run.json recorded mode warn. NEW: the default is the stop. WHY: the owner's rule; the way on is the person's act.
  const dir = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md']);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /PII-GATE \(hard-stop\): \[the task file and --context documents\] line 1, col \d+: email \(value not shown\)/);
  assert.match(r.stderr, /PII-GATE: stopped - 1 match\(es\) found in the task file and --context documents\. Nothing was started, sent or spent\./);
  assert.match(r.stderr, /To send it anyway, run the same command again and add:  --allow-pii email\n/);
  assert.equal(r.stderr.includes(EMAIL), false, 'the matched value is never printed');
  assert.equal(existsSync(join(dir, 'runs')), false, 'a stopped start makes no run folder');
  const allowed = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--allow-pii', 'email']);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  assert.deepEqual(runJson(dir).piiGate, { mode: 'hard-stop', allow: ['email'] });
  const warned = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  const w = council(warned, ['--chain', 'mock', '--task', 'tasks/x.md', '--pii-gate', 'warn']);
  assert.equal(w.status, 0, w.stdout + w.stderr); assert.match(w.stderr, /PII-GATE \(warn\): \[the task file and --context documents\]/);
  assert.deepEqual(runJson(warned).piiGate, { mode: 'warn', allow: [] });
});

test('PW-2 (clean input): nothing is printed, the exit code and the answer shape do not change', () => {
  const dir = workspace('Plan a small app that keeps a list of notes.\n');
  const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /PII/);
  assert.ok(existsSync(join(dir, 'runs', readdirSync(join(dir, 'runs'))[0], 'report.json')));
});

test('PW-3: the default and COUNCIL_PII_GATE=hard-stop both stop a run with an email before anything is sent (exit 11); an explicit --pii-gate warn beats the setting', () => {
  // CHANGED ACCEPTED (owner 18 Okt 2026). OLD: only the setting hard-stop refused; the default warned. NEW: the default stops too, and the stop screen's first words are "PII-GATE: stopped" (OLD: "refusing to run"). WHY: the owner's rule above.
  const dir = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  for (const env of [{}, { COUNCIL_PII_GATE: 'hard-stop' }]) {
    const refused = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md'], env);
    assert.equal(refused.status, 11, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /PII-GATE: stopped/);
    for (const part of ['jane', 'mail-corp']) assert.equal(refused.stderr.includes(part), false, `the stop display names the finding, not the value (${part})`);
  }
  const flagged = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--pii-gate', 'warn'], { COUNCIL_PII_GATE: 'hard-stop' });
  assert.equal(flagged.status, 0, flagged.stdout + flagged.stderr);
  const env = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md'], { COUNCIL_PII_GATE: 'warn' });
  assert.equal(env.status, 0, 'the user\'s own shell environment may set a standing warn: ' + env.stderr);
});

test('PW-4: a project .env can NOT set COUNCIL_PII_GATE: the name is refused there (reported once) and the run still stops', () => {
  // CHANGED ACCEPTED (owner 19 Okt 2026, "it can only come from the user"). OLD: a project .env may set it because it could only tighten, and the reader did not refuse the name. NEW: with a stop default nothing is left to tighten, and `warn` in a project-writable file would silently remove the stop, so the name joins NEVER_FROM_ENV_FILE. WHY: a standing warn is allowed only where the user sets it.
  assert.equal(envFileRefuses('COUNCIL_PII_GATE'), true);
  const dir = workspace(`Plan a small app. Contact: ${EMAIL}\n`, 'COUNCIL_PII_GATE=warn\n');
  const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md']);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.equal((r.stderr.match(/COUNCIL_PII_GATE/g) ?? []).length >= 1, true, 'the refusal of the name is reported');
  assert.equal(existsSync(join(dir, 'runs')), false);
});

test('PW-5: a setting that is neither warn nor hard-stop REFUSES the run (exit 2, one sentence naming the setting and the accepted values, nothing written), whatever else is typed', () => {
  // CHANGED ACCEPTED (C&C ruling 18 Okt 2026). OLD: the value was named once and ignored, the default (warn) was used, exit 0. NEW: exit 2 before anything is written. WHY: the setting can only tighten, so a typo such as `hardstop` must not silently loosen it (a fail-open on a policy path).
  const dir = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  for (const bad of ['loud', 'hardstop', 'hard_stop']) {
    const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md'], { COUNCIL_PII_GATE: bad });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`COUNCIL_PII_GATE: "${bad}" is not a mode\\. Set it to hard-stop \\(the default\\) or warn, or remove it\\. Nothing was started and nothing was spent\\.`));
    assert.equal(existsSync(join(dir, 'runs')), false, 'no run folder');
  }
  const flagged = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--pii-gate', 'warn'], { COUNCIL_PII_GATE: 'hardstop' });
  assert.equal(flagged.status, 2, 'a typed flag does not hide the typo: ' + flagged.stderr);
  const env = workspace(`Plan a small app. Contact: ${EMAIL}\n`, 'COUNCIL_PII_GATE=hardstop\n');
  // CHANGED (owner 19 Okt 2026): the name is no longer read from a project .env at all, so the typo there is not even seen and the run stops at its email (exit 11); OLD: exit 2.
  assert.equal(council(env, ['--chain', 'mock', '--task', 'tasks/x.md']).status, 11, 'a project .env does not carry the setting: the default stop applies');
  // a resume of a run that started under a good setting refuses when the setting has since become a typo (a non-member run reads the setting on every sitting)
  const ext = workspace('Plan a small app.\n');
  const first = council(ext, ['--chain', 'mock-external', '--task', 'tasks/x.md'], { COUNCIL_PII_GATE: 'hard-stop' });
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const again = council(ext, ['--resume', join(ext, 'runs', readdirSync(join(ext, 'runs'))[0])], { COUNCIL_PII_GATE: 'hardstop' });
  assert.equal(again.status, 2, again.stdout + again.stderr); assert.match(again.stderr, /is not a mode/);
});

test('PW-6: a resume keeps the mode the run started under (the saved mode beats a changed setting)', () => {
  const dir = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  const first = council(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md', '--pii-gate', 'warn']);
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const again = council(dir, ['--resume', runDir], { COUNCIL_PII_GATE: 'hard-stop' });
  assert.notEqual(again.status, 11, 'the saved warn stands: ' + again.stdout + again.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).piiGate.mode, 'warn');
});

test('PW-7 (the reader): unset, blank and an unresolved Desktop placeholder are the default; warn and hard-stop (any case) are read; anything else is a refusal with the strict mode, control characters removed and cut', () => {
  // CHANGED ACCEPTED (owner 18 Okt 2026). OLD: unset/blank/placeholder read as warn. NEW: they read as hard-stop (the default stops). WHY: PW-1.
  assert.deepEqual(piiModeSetting({}), { mode: 'hard-stop', refusal: null });
  for (const v of ['', '   ', '${user_config.pii_gate}']) assert.deepEqual(piiModeSetting({ COUNCIL_PII_GATE: v }), { mode: 'hard-stop', refusal: null }, JSON.stringify(v));
  assert.deepEqual(piiModeSetting({ COUNCIL_PII_GATE: ' Hard-Stop ' }), { mode: 'hard-stop', refusal: null });
  assert.deepEqual(piiModeSetting({ COUNCIL_PII_GATE: 'WARN' }), { mode: 'warn', refusal: null });
  // CHANGED ACCEPTED (C&C ruling 18 Okt 2026). OLD: an unusable value returned { mode: 'warn', ignored: <value> }. NEW: { mode: 'hard-stop', refusal: <sentence> } (strict, so a caller that forgets to check does not loosen the gate; never an absent mode, which a tree record reads as OFF).
  for (const v of ['hardstop', 'hard_stop', 'loud', 'off']) { const r = piiModeSetting({ COUNCIL_PII_GATE: v }); assert.equal(r.mode, 'hard-stop', v); assert.match(r.refusal, new RegExp(`"${v}" is not a mode`)); }
  const odd = piiModeSetting({ COUNCIL_PII_GATE: `x\u001b[31m${'y'.repeat(100)}` });
  assert.equal(odd.mode, 'hard-stop'); assert.doesNotMatch(odd.refusal, /\u001b/); assert.ok(odd.refusal.length < 220, 'the shown value is cut');
});

test('PW-8 (Desktop): the mcpb manifest wires COUNCIL_PII_GATE to a pii_gate field that defaults to hard-stop and is not a secret', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'mcpb', 'manifest.json'), 'utf8'));
  assert.equal(manifest.server.mcp_config.env.COUNCIL_PII_GATE, '${user_config.pii_gate}');
  const uc = manifest.user_config.pii_gate;
  assert.deepEqual([uc.type, uc.default, uc.required, uc.sensitive], ['string', 'hard-stop', false, undefined]);
});

test('PW-9 (MCP): start_run with an email in the task STOPS (started:false, exit 11, the stop text and the terminal command for the person, no run folder, no value); start_run has no pii_gate argument any more', async () => {
  const dir = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  mkdirSync(join(dir, 'chains'));
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...malformedProviderKeys() } });   // nothing real can be reached from this clone's shell
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch { /* not json */ } } });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => no(new Error(`no reply to ${method}`)), 30000); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pii-default-test', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    // CHANGED ACCEPTED (owner 18/19 Okt 2026). OLD: the run went on and the warning was in run.log; the tool took pii_gate. NEW: a client that cannot ask gets the stop and the command for the person; the agent has no argument that continues. WHY: "unless the user explicitly chooses to continue" and "a standing warn only from the user".
    const tools = await rpc('tools/list', {});
    const schema = tools.result.tools.find(t => t.name === 'start_run').inputSchema;
    assert.equal('pii_gate' in schema.properties, false, 'start_run has no pii_gate argument');
    const m = await rpc('tools/call', { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/x.md', pii_gate: 'warn' } });
    const answer = JSON.parse(m.result.content[0].text);
    assert.equal(answer.started, false, JSON.stringify(answer)); assert.equal(answer.exitCode, 11);
    assert.equal(answer.pii_stop, true); assert.deepEqual(answer.types_found, ['email']); assert.equal(answer.paid_started, false);
    assert.match(answer.next, /--allow-pii email/); assert.match(answer.logTail, /PII-GATE: stopped/);
    for (const part of ['jane', 'mail-corp']) assert.equal(JSON.stringify(answer).includes(part), false, `the answer carries no part of the address (${part})`);
    assert.equal(existsSync(join(dir, 'runs')) && readdirSync(join(dir, 'runs')).length > 0, false, 'no run folder');
  } finally { child.stdin.end(); child.kill(); }
});

// Trees (C&C ruling 18 Okt 2026): the tree record learns the mode at start (the flag, else COUNCIL_PII_GATE, else warn) and every member reads the record, never the environment.
import { PassThrough } from 'node:stream';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import { readTreeRecord } from '../src/tree-record.js';
import { treePiiModeFrom } from '../src/tree-pii-mode.js';
import { installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';
function treeWork(task) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pii-tree-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), task);
  installSplitRoot(dir); writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  return dir;
}
async function treeStart(dir, extra = [], env = {}) {
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let err = ''; stderr.on('data', d => { err += d; }); stdout.on('data', () => {});
  const seen = [];
  // src/tree-start.js reads no environment variable: src/cli.js reads COUNCIL_PII_GATE and hands the reading over as `piiSetting` (the test does the same with the value it wants)
  const code = await treeCommand(['start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5', ...extra], { work: dir, stdin, stdout, stderr, piiSetting: piiModeSetting(env), handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: { startRun: async o => { seen.push(o); return { exitCode: 0 }; } } }) } });
  return { code, seen, err };
}
const treeRec = dir => readTreeRecord(join(dir, 'runs', readdirSync(join(dir, 'runs'))[0])).tree;

test('PW-10 (trees): with no flag and no setting the tree records hard-stop; the setting warn (the user\'s own environment) records warn; a typed flag beats the setting; an email in the root task is then refused by the default tree (exit 11, nothing written)', async () => {
  // CHANGED ACCEPTED (owner 18 Okt 2026). OLD: no flag, no setting recorded warn; the setting hard-stop recorded hard-stop. NEW: the default records hard-stop; warn only by the typed flag or the user's own setting. WHY: PW-1.
  const a = treeWork('Plan a tiny change.\n');
  assert.equal((await treeStart(a)).code, 0); assert.deepEqual(treePiiModeFrom(treeRec(a)), { status: 'on', mode: 'hard-stop' });
  const b = treeWork('Plan a tiny change.\n');
  const rb = await treeStart(b, [], { COUNCIL_PII_GATE: 'warn' });
  assert.equal(rb.code, 0, rb.err); assert.deepEqual(treePiiModeFrom(treeRec(b)), { status: 'on', mode: 'warn' }); assert.equal(rb.seen[0].piiGate, 'warn', 'the root run is launched with the recorded mode');
  const c = treeWork('Plan a tiny change.\n');
  assert.equal((await treeStart(c, ['--pii-gate', 'warn'], { COUNCIL_PII_GATE: 'hard-stop' })).code, 0); assert.deepEqual(treePiiModeFrom(treeRec(c)), { status: 'on', mode: 'warn' });
  const d = treeWork(`Plan a change. Contact ${EMAIL}.\n`);
  const rd = await treeStart(d, []);
  assert.equal(rd.code, 11, rd.err); assert.equal(existsSync(join(d, 'runs')), false);
});

test('PW-11 (tree start): a non-key PII shape in the root task STOPS `council tree start` itself (exit 11, no folder, value never printed, one line for the one finding); with --pii-gate warn it goes on and says so once', () => {
  // CHANGED ACCEPTED (owner 18 Okt 2026). OLD: exit 0 and a warn line. NEW: the default stop; the warn line only under the typed flag. WHY: PW-1.
  const dir = treeWork(`Plan a tiny change. Contact ${EMAIL}.\n`);
  const argv = ['tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5'];
  const r = spawnSync(process.execPath, [cli, ...argv], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /PII-GATE \(hard-stop\): \[the task file and --context documents\] line 1, col \d+: email \(value not shown\)/);
  assert.equal((r.stderr.match(/PII-GATE \(hard-stop\)/g) ?? []).length, 1, 'one line for the one finding');
  assert.equal((r.stdout + r.stderr).includes(EMAIL), false, 'the matched value is never printed'); assert.equal(existsSync(join(dir, 'runs')), false);
  const w = spawnSync(process.execPath, [cli, ...argv, '--pii-gate', 'warn'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  assert.equal(w.status, 0, w.stdout + w.stderr); assert.equal((w.stderr.match(/PII-GATE \(warn\)/g) ?? []).length, 1);
});

test('PW-12 (one line per finding): a credential-shaped string the key scan refuses is NOT also warned about (normal run and tree start); with --allow-secret-shaped the key scan does not refuse and the warning stands; a refused start makes no run folder', () => {
  const SECRET = `sk_${'live_'}${'abcd'.repeat(6)}`;
  const dir = workspace(`Plan a tiny change.\nThe key is ${SECRET}\n`);
  const refused = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md']);
  assert.equal(refused.status, 11, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /OUTBOUND KEY SCAN: refusing to run/); assert.doesNotMatch(refused.stderr, /PII-GATE/); assert.equal(existsSync(join(dir, 'runs')), false);
  const allowed = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--allow-secret-shaped']);
  // CHANGED ACCEPTED (owner 19 Okt 2026, one act, one flag). OLD: with --allow-secret-shaped the key scan did not refuse and the PII gate warned (one PII-GATE (warn) line naming the secret). NEW: the same flag also covers the lines the key scan flags, so the default stop does not ask a second time and prints no PII-GATE line for them (a `secret` shape the key scan does not cover still stops). WHY: under a stop default the OLD behaviour would stop the same text twice.
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr); assert.doesNotMatch(allowed.stderr, /PII-GATE/, 'no second stop, no PII line for the text the key scan covers'); assert.doesNotMatch(allowed.stderr, /OUTBOUND KEY SCAN/);
  const logged = readFileSync(join(dir, 'runs', readdirSync(join(dir, 'runs'))[0], 'run.log'), 'utf8'); for (const part of ['sk_live', 'abcd']) assert.equal(logged.includes(part), false, `run.log carries no part of the value (${part})`);   // NOT plain `sk_`: the pattern NAME printed with the line is `Stripe (sk_/rk_/pk_ live/test)`; `sk_live` and the body are the value's own start and body
  const tdir = treeWork(`Plan a tiny change.\nThe key is ${SECRET}\n`);
  const t = spawnSync(process.execPath, [cli, 'tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5'], { cwd: tdir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tdir }, timeout: 120_000 });
  assert.equal(t.status, 11, t.stderr); assert.match(t.stderr, /OUTBOUND KEY SCAN/); assert.doesNotMatch(t.stderr, /PII-GATE/); assert.equal(existsSync(join(tdir, 'runs')), false);
  const hard = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--pii-gate', 'hard-stop']);
  // CHANGED ACCEPTED (owner 19 Okt 2026). OLD: under hard-stop the PII gate refused a key-shaped string first (two stops for one text if the person then allowed it). NEW: the key scan's own screen is the one stop in both modes. WHY: one stop, the right one.
  assert.equal(hard.status, 11); assert.match(hard.stderr, /OUTBOUND KEY SCAN: refusing to run/, 'the key scan is the one stop in the default mode too'); assert.doesNotMatch(hard.stderr, /PII-GATE/);
});

test('PW-13 (tree start): a setting that is neither warn nor hard-stop refuses `council tree start` (exit 2, no runs folder, no tree record), with a typed --pii-gate too, through the real CLI', () => {
  const dir = treeWork('Plan a tiny change.\n');
  for (const extra of [[], ['--pii-gate', 'warn']]) {
    const t = spawnSync(process.execPath, [cli, 'tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5', ...extra], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, COUNCIL_PII_GATE: 'hardstop' }, timeout: 120_000 });
    assert.equal(t.status, 2, t.stderr); assert.match(t.stderr, /COUNCIL_PII_GATE: "hardstop" is not a mode/); assert.equal(existsSync(join(dir, 'runs')), false);
  }
  const fine = spawnSync(process.execPath, [cli, 'tree', 'status', 'nothing-here'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, COUNCIL_PII_GATE: 'hardstop' }, timeout: 120_000 });
  assert.doesNotMatch(fine.stderr, /is not a mode/, 'only `start` reads the setting');
});

test('PW-14 (MCP): start_run with a bad COUNCIL_PII_GATE answers started:false with exit code 2 and the sentence in the log tail; no run folder', async () => {
  const dir = workspace(`Plan a small app. Contact: ${EMAIL}\n`);
  mkdirSync(join(dir, 'chains'));
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_PII_GATE: 'hardstop', ...malformedProviderKeys() } });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch { /* not json */ } } });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => no(new Error(`no reply to ${method}`)), 30000); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pii-default-test', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const answer = JSON.parse((await rpc('tools/call', { name: 'start_run', arguments: { chain: 'mock', task: 'tasks/x.md' } })).result.content[0].text);
    assert.equal(answer.started, false, JSON.stringify(answer)); assert.equal(answer.exitCode, 2); assert.match(answer.logTail, /COUNCIL_PII_GATE: "hardstop" is not a mode/);
    assert.equal(existsSync(join(dir, 'runs')) && readdirSync(join(dir, 'runs')).length > 0, false, 'no run folder');
  } finally { child.stdin.end(); child.kill(); }
});

test('PW-15 (dry run, fix-up 4): `council --dry-run` with a bad COUNCIL_PII_GATE refuses (exit 2, the same sentence, nothing priced or written); a good or unset value prices as before; a dry run that names a tree lineage (--tree-node, a member) is not refused by this check', () => {
  const dir = workspace('Plan a small app.\n');
  const bad = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--dry-run'], { COUNCIL_PII_GATE: 'hardstop' });
  assert.equal(bad.status, 2, bad.stdout + bad.stderr); assert.match(bad.stderr, /COUNCIL_PII_GATE: "hardstop" is not a mode/); assert.doesNotMatch(bad.stdout, /Chain:/); assert.equal(existsSync(join(dir, 'runs')), false);
  for (const env of [{}, { COUNCIL_PII_GATE: 'hard-stop' }]) assert.equal(council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--dry-run'], env).status, 0);
  const member = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--dry-run', '--tree-node', 'no-such-lineage.json'], { COUNCIL_PII_GATE: 'hardstop' });
  assert.doesNotMatch(member.stderr, /is not a mode/, 'a member never reads the setting');
});

test('PW-16 (MCP dry_run): the dry_run tool with a bad COUNCIL_PII_GATE does not price; the answer to the agent carries the sentence', async () => {
  const dir = workspace('Plan a small app.\n');
  mkdirSync(join(dir, 'chains'));
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_PII_GATE: 'hardstop', ...malformedProviderKeys() } });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch { /* not json */ } } });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => no(new Error(`no reply to ${method}`)), 30000); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pii-default-test', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const m = await rpc('tools/call', { name: 'dry_run', arguments: { chain: 'mock' } });
    const said = JSON.stringify(m); assert.match(said, /is not a mode/, said.slice(0, 400)); assert.doesNotMatch(said, /Chain: mock/);
  } finally { child.stdin.end(); child.kill(); }
});
