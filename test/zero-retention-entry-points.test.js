// 0.8.4 the optional zero-retention setting, WIRING (Builder B): the command line. Offline, $0: every command here is a dry run or a refusal before anything is sent; the keys are dummies; the working folders are the test's own.
// WHAT IS PINNED, by test: ZE-1 a value that is not on or off (the flag, the bare flag, the shell variable) exits 2 before anything is started, a dry run too, naming where the value came from. ZE-2 with the setting off (the default) nothing changes: no zero-retention
// line, no `zeroRetention` field in the JSON, the project's .env cannot turn it on. ZE-3 on, with only an OpenRouter key: the dry run says which seats the setting reaches (text and JSON); with an Anthropic key the Claude seats are called straight to the lab and the line
// says the setting does not reach them. ZE-4 on, with a seat no host can serve (Fable through OpenRouter in plan-the-high-council; the Qwen models of the China chain): the dry run reports the refusal as a line (and in `startRefusals`) and exits 0, a real start exits 5
// before anything is sent, naming every way on (the setting off; for Claude seats also the direct route); off is never refused. ZE-5 a typed off beats the shell variable. NO RED OF THEIR OWN: no function argument; on the tree before this unit each fails at its first
// assertion about the command's answer (the flag is refused as unknown, exit 2, with another sentence), a red at an assertion and not an import error. ZE-6 the MCP tools (dry_run, start_run, resume_run take zero_retention and refuse a bad value before a run id is taken or a child is
// spawned, and a start for a seat the table cannot serve); ZE-7 the library (price reports, run and resume refuse a bad value before a run is made); ZE-8 the tree (the flag is refused by name, the environment decides, a dry run reports and a start is refused with exit 5);
// ZE-9 the doctor says a refused value; the project's .env is refused by env-file.js (test/env-file-zero-retention.test.js). The decision itself is test/zero-retention.test.js ZR-7; a resume of an existing run (the record, a typed change) is the unit-end real-verb probe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Api from '../src/api.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// read when a test needs it, and asserted: a tree without the shipped list fails each test at this assertion, not the whole file at load (the red tree's first run showed a load-time ENOENT hiding every test of the file)
const shippedList = () => { const f = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'zdr-hosts.json'); assert.ok(existsSync(f), 'src/zdr-hosts.json exists'); return JSON.parse(readFileSync(f, 'utf8')); };
const cli = join(root, 'src', 'cli.js');
const WAIT_MS = 40000;
const NOTHING = /Nothing was started and nothing was spent\./;
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const BASE = malformedProviderKeys();
const KEYS = { anthropic: { ...BASE, ANTHROPIC_API_KEY: 'sk-test-dummy-key', OPENROUTER_API_KEY: '' }, openrouter: { ...BASE, ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: 'sk-or-test-dummy-key' }, both: { ...BASE, ANTHROPIC_API_KEY: 'sk-test-dummy-key', OPENROUTER_API_KEY: 'sk-or-test-dummy-key' } };
function work(envFile = '# no keys here\n') {
  const dir = mkdtempSync(join(tmpdir(), 'thc-zr-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n'); writeFileSync(join(dir, '.env'), envFile);
  // a refreshed list dated TODAY, identical to the shipped one (narrow-only, so it adds nothing): the rows below price with the setting on and must not expire with the shipped table's date (only ZR-6 expires); the clock is read here, in the test
  writeFileSync(join(dir, 'zdr-hosts.user.json'), JSON.stringify({ ...shippedList(), asOf: new Date().toISOString().slice(0, 10) }));
  writeFileSync(join(dir, 'chains', 'plain-mock.json'), JSON.stringify({ name: 'plain-mock', description: 'a mock chain', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }));
  return dir;
}
const run = (dir, args, env = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: dir, ...env } });
const noRuns = dir => !(existsSync(join(dir, 'runs')) && readdirSync(join(dir, 'runs')).length > 0);
const MINI = 'plan-mini-council', HIGH = 'plan-the-high-council', CHINA = 'plan-china-high-council';
const base = (chain, ...more) => ['--chain', chain, '--task', 'tasks/x.md', ...more];
const LINE_OR = /^Zero retention is on: \d+ seats? go(?:es)? through OpenRouter, and each call names only the hosts that OpenRouter's list of \d{4}-\d{2}-\d{2}( \(refreshed in this folder\))? gives for its model as zero-retention hosts\./m;

test('ZE-1: a value that is not on or off, the bare flag and a bad shell variable exit 2 before anything is started (a dry run too), naming where the value came from', () => {
  const dir = work();
  for (const dry of [['--dry-run'], []]) {
    const viaFlag = run(dir, base(MINI, ...dry, '--zero-retention', 'maybe'), KEYS.anthropic);
    assert.equal(viaFlag.status, 2, `${dry.join('')}: ${viaFlag.stderr.slice(0, 300)}`); assert.match(viaFlag.stderr, /^--zero-retention: "maybe" is not a zero-retention setting\. Use on or off\. Nothing was started and nothing was spent\.$/m);
    const viaEnv = run(dir, base(MINI, ...dry), { ...KEYS.anthropic, COUNCIL_ZERO_RETENTION: 'maybe' });
    assert.equal(viaEnv.status, 2, `${dry.join('')}: ${viaEnv.stderr.slice(0, 300)}`); assert.match(viaEnv.stderr, /^COUNCIL_ZERO_RETENTION: "maybe" is not a zero-retention setting\. Use on or off\./m); assert.match(viaEnv.stderr, NOTHING);
  }
  const bare = run(dir, base('plain-mock', '--dry-run', '--zero-retention'), KEYS.anthropic);
  assert.equal(bare.status, 2); assert.match(bare.stderr, /--zero-retention needs a value: on or off\./); assert.match(bare.stderr, NOTHING);
  assert.ok(noRuns(dir), 'no refusal made a run folder');
});

test('ZE-2: with the setting off, which is the default, nothing changes; the project\'s .env cannot turn it on', () => {
  const dir = work('COUNCIL_ZERO_RETENTION=on\n');
  for (const keys of [KEYS.anthropic, KEYS.openrouter]) {
    const text = run(dir, base(MINI, '--dry-run'), keys);
    assert.equal(text.status, 0, text.stderr.slice(0, 300)); assert.doesNotMatch(text.stdout, /Zero retention/);
    assert.equal('zeroRetention' in JSON.parse(run(dir, base(MINI, '--dry-run', '--json'), keys).stdout), false, 'no field when off');
  }
  const off = run(dir, base(MINI, '--dry-run', '--zero-retention', 'off'), KEYS.openrouter);
  assert.equal(off.status, 0); assert.doesNotMatch(off.stdout, /Zero retention/);
});

test('ZE-3: on, the dry run says which seats the setting reaches, in text and in the JSON; with an Anthropic key the Claude seats are called straight to the lab and the setting does not reach them', () => {
  const dir = work();
  const viaOr = run(dir, base(MINI, '--dry-run', '--zero-retention', 'on'), KEYS.openrouter);
  assert.equal(viaOr.status, 0, viaOr.stderr.slice(0, 300)); assert.match(viaOr.stdout, LINE_OR); assert.doesNotMatch(viaOr.stdout, /called straight to the lab/, 'every seat goes through OpenRouter with only an OpenRouter key');
  const json = JSON.parse(run(dir, base(MINI, '--dry-run', '--json', '--zero-retention', 'on'), KEYS.openrouter).stdout);
  assert.equal(json.zeroRetention.on, true); assert.ok(json.zeroRetention.covered >= 9 && json.zeroRetention.notCovered === 0, JSON.stringify(json.zeroRetention));      // plan-mini-council seats 9 OpenRouter seats and 2 Claude seats (counted from its file); with only an OpenRouter key the Claude seats are routed too, so none is called straight to a lab assert.match(json.zeroRetention.lines[0], /^Zero retention is on: /); assert.equal(json.zeroRetention.stops, undefined, 'no seat is refused');
  assert.equal(json.startRefusals, undefined, 'and no start refusal');
  const direct = run(dir, base(MINI, '--dry-run', '--zero-retention', 'on'), KEYS.anthropic);
  assert.equal(direct.status, 0, direct.stderr.slice(0, 300)); assert.match(direct.stdout, /2 seats are called straight to the lab, and this setting does not reach them\./, 'the two Claude seats of plan-mini-council');
  const viaEnv = run(dir, base(MINI, '--dry-run'), { ...KEYS.openrouter, COUNCIL_ZERO_RETENTION: 'on' });
  assert.match(viaEnv.stdout, LINE_OR, 'the shell variable switches it on');
});

test('ZE-4: on, a seat no host can serve: the dry run reports the refusal as a line and exits 0, a real start exits 5 before anything is sent and names every way on; off is never refused', () => {
  const dir = work();
  // Fable through OpenRouter (the flagship's top layer) has no zero-retention host: both ways on are named
  const dry = run(dir, base(HIGH, '--dry-run', '--zero-retention', 'on'), KEYS.openrouter);
  assert.equal(dry.status, 0, dry.stderr.slice(0, 300)); assert.match(dry.stdout, /^ {2}Zero retention is on, but this program has no host it may send .*anthropic\/claude-fable-5\.2 \(\d+ seats?, not on that list\).* to \(OpenRouter's list of \d{4}-\d{2}-\d{2}\)\. Nothing was started and nothing was spent\. To run anyway, switch it off with --zero-retention off, or send the Claude seats straight to Anthropic with --claude-route anthropic/m);
  const json = JSON.parse(run(dir, base(HIGH, '--dry-run', '--json', '--zero-retention', 'on'), KEYS.openrouter).stdout);
  assert.ok(json.zeroRetention.stops.some(s => s.model === 'anthropic/claude-fable-5.2' && s.why === 'not_listed'), JSON.stringify(json.zeroRetention.stops)); assert.deepEqual(json.startRefusals.map(r => [r.code, r.exit]), [['zero_retention_refused', 5]]);
  const start = run(dir, base(HIGH, '--zero-retention', 'on'), KEYS.openrouter);
  assert.equal(start.status, 5, start.stdout + start.stderr); assert.match(start.stderr, /^Zero retention is on, but this program has no host it may send .*anthropic\/claude-fable-5\.2/m); assert.match(start.stderr, NOTHING); assert.match(start.stderr, /--zero-retention off, or send the Claude seats straight to Anthropic with --claude-route anthropic/);
  assert.ok(noRuns(dir), 'nothing was started');
  // the Qwen models of the China chain: the only way on is switching it off (no Claude seat, no Anthropic way named)
  const china = run(dir, base(CHINA, '--zero-retention', 'on'), KEYS.openrouter);
  assert.equal(china.status, 5, china.stdout + china.stderr); assert.match(china.stderr, /qwen\/qwen3\.8-flash \(\d+ seats?, not on that list\)/); assert.match(china.stderr, /switch it off with --zero-retention off\.$/m); assert.doesNotMatch(china.stderr, /claude-route/);
  // off is never refused (the dry run, the same chain, prices as it always did)
  const off = run(dir, base(HIGH, '--dry-run', '--zero-retention', 'off'), KEYS.openrouter);
  assert.equal(off.status, 0); assert.doesNotMatch(off.stdout + off.stderr, /Zero retention/);
  assert.ok(noRuns(dir));
});

test('ZE-5: a typed off beats the shell variable', () => {
  const dir = work();
  const r = run(dir, base(HIGH, '--dry-run', '--zero-retention', 'off'), { ...KEYS.openrouter, COUNCIL_ZERO_RETENTION: 'on' });
  assert.equal(r.status, 0); assert.doesNotMatch(r.stdout + r.stderr, /Zero retention/);
  const on = run(dir, base(HIGH, '--dry-run'), { ...KEYS.openrouter, COUNCIL_ZERO_RETENTION: 'on' });
  assert.match(on.stdout, /Zero retention is on, but this program has no host/, 'the variable alone switches it on');
});

function session(dir, env) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env } });
  const waiting = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.id !== undefined && !m.method && waiting.has(m.id)) waiting.get(m.id)(m); } });
  const rpc = (method, params) => new Promise((ok, no) => { const id = ++n; const t = setTimeout(() => { waiting.delete(id); no(new Error(`no reply to ${method} in ${WAIT_MS} ms`)); }, WAIT_MS); waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'zero-retention-test', version: '1.0' } }).then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async tools() { await ready; return (await rpc('tools/list', {})).result.tools; },
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); try { return JSON.parse(m.result.content[0].text); } catch { return m.result ?? m; } },
    close: () => new Promise(done => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000); child.once('exit', () => { clearTimeout(t); done(); }); child.stdin.end(); child.kill(); }),
  };
}

test('ZE-6: the MCP tools take zero_retention and refuse a bad value (a dry run too) and, for a start, a seat the table cannot serve, before a run id is taken or a child is spawned', async () => {
  const dir = work(); const s = session(dir, KEYS.openrouter);
  try {
    for (const name of ['dry_run', 'start_run', 'resume_run']) assert.ok((await s.tools()).find(t => t.name === name).inputSchema.properties.zero_retention, `${name} lists zero_retention`);
    const dry = await s.call('dry_run', { chain: MINI, zero_retention: 'maybe' });
    assert.match(dry.error ?? '', /^the zero_retention argument: "maybe" is not a zero-retention setting\. Use on or off\./); assert.match(dry.error ?? '', NOTHING);
    const start = await s.call('start_run', { chain: HIGH, task: 'tasks/x.md', zero_retention: 'maybe' });
    assert.equal(start.started, false); assert.match(start.error ?? '', /is not a zero-retention setting/);
    const refused = await s.call('start_run', { chain: HIGH, task: 'tasks/x.md', zero_retention: 'on' });
    assert.equal(refused.started, false); assert.match(refused.error ?? '', /^Zero retention is on, but this program has no host it may send .*anthropic\/claude-fable-5\.2/); assert.match(refused.error ?? '', /switch it off with the zero_retention argument set to "off", or send the Claude seats straight to Anthropic with --claude-route anthropic/);
    assert.ok(noRuns(dir), 'no run id was taken');
    const priced = await s.call('dry_run', { chain: HIGH, zero_retention: 'on' });
    assert.ok(typeof priced === 'string' || priced.error === undefined, 'a dry run is not refused for a seat the table cannot serve: it reports it'); assert.match(typeof priced === 'string' ? priced : JSON.stringify(priced), /Zero retention is on, but this program has no host it may send/);
  } finally { await s.close(); }
});

test('ZE-7: the library: price reports the setting and what a start would be refused with, a bad value throws, run refuses a bad value before a run is made', async () => {
  const dir = work();
  const off = Api.price({ chain: HIGH, cwd: dir, env: KEYS.openrouter });
  assert.equal(off.zeroRetention, undefined, 'off: no field');
  const on = Api.price({ chain: HIGH, cwd: dir, env: KEYS.openrouter, zeroRetention: 'on' });
  assert.equal(on.zeroRetention.on, true); assert.ok(on.zeroRetention.stops.some(x => x.model === 'anthropic/claude-fable-5.2' && x.why === 'not_listed')); assert.match(on.zeroRetention.refusal, /^Zero retention is on, but this program has no host it may send .* the zeroRetention option set to "off"/);
  const fine = Api.price({ chain: MINI, cwd: dir, env: KEYS.openrouter, zeroRetention: 'on' });
  assert.equal(fine.zeroRetention.refusal, null); assert.deepEqual(fine.zeroRetention.stops, []); assert.match(fine.zeroRetention.lines[0], /^Zero retention is on: /);
  // price() reads the environment run() hands the CLI: the process environment with `env` added, a key set to undefined removed
  const had = process.env.COUNCIL_ZERO_RETENTION; process.env.COUNCIL_ZERO_RETENTION = 'on';
  try {
    assert.equal(Api.price({ chain: MINI, cwd: dir, env: KEYS.openrouter }).zeroRetention?.on, true, 'the shell variable reaches a price that is given an env for its keys');
    assert.equal(Api.price({ chain: MINI, cwd: dir, env: { ...KEYS.openrouter, COUNCIL_ZERO_RETENTION: undefined } }).zeroRetention, undefined, 'a variable set to undefined in env is removed, as run() removes it');
  } finally { if (had === undefined) delete process.env.COUNCIL_ZERO_RETENTION; else process.env.COUNCIL_ZERO_RETENTION = had; }
  assert.throws(() => Api.price({ chain: MINI, cwd: dir, env: KEYS.openrouter, zeroRetention: 'maybe' }), /the zeroRetention option: "maybe" is not a zero-retention setting/);
  const ran = await Api.run({ chain: MINI, task: 'tasks/x.md', cwd: dir, zeroRetention: 'maybe', env: KEYS.openrouter }).catch(e => e);
  assert.ok(ran && /--zero-retention: "maybe" is not a zero-retention setting/.test(`${ran.message ?? ''} ${ran.outputTail ?? ''} ${ran.stderr ?? ''}`), `run refuses: ${JSON.stringify(ran).slice(0, 300)}`);
  assert.ok(noRuns(dir), 'no run folder was made');
});

test('ZE-8: the tree takes the environment only: the flag is refused by name, a bad value refuses the tree, a dry run reports a seat the table cannot serve, a start is refused with exit 5 before any record is written', () => {
  const dir = work();
  const flagged = run(dir, ['tree', 'start', ...base(HIGH), '--dry-run', '--zero-retention', 'on'], KEYS.openrouter);
  assert.equal(flagged.status, 2, flagged.stdout + flagged.stderr); assert.match(flagged.stderr, /--zero-retention: not an option of `council tree start`/); assert.match(flagged.stderr, /COUNCIL_ZERO_RETENTION/);
  const bad = run(dir, ['tree', 'start', ...base(HIGH), '--dry-run'], { ...KEYS.openrouter, COUNCIL_ZERO_RETENTION: 'maybe' });
  assert.equal(bad.status, 2, bad.stdout + bad.stderr); assert.match(bad.stderr, /COUNCIL_ZERO_RETENTION: "maybe" is not a zero-retention setting/); assert.match(bad.stderr, NOTHING);
  const dry = run(dir, ['tree', 'start', ...base(HIGH), '--dry-run'], { ...KEYS.openrouter, COUNCIL_ZERO_RETENTION: 'on' });
  assert.equal(dry.status, 0, dry.stdout + dry.stderr); assert.match(dry.stdout, /Zero retention is on, but this program has no host it may send .*anthropic\/claude-fable-5\.2.*COUNCIL_ZERO_RETENTION=off/);
  const fine = run(dir, ['tree', 'start', ...base(MINI), '--dry-run'], { ...KEYS.openrouter, COUNCIL_ZERO_RETENTION: 'on' });
  assert.equal(fine.status, 0, fine.stdout + fine.stderr); assert.equal((fine.stdout.match(/^Zero retention is on: /gm) ?? []).length, 1, 'said once for one chain'); assert.doesNotMatch(fine.stdout, /has no host it may send/);
  const before = JSON.stringify(readdirSync(dir, { recursive: true }).sort());
  const start = run(dir, ['tree', 'start', ...base(HIGH), '--max-usd', '5'], { ...KEYS.openrouter, COUNCIL_ZERO_RETENTION: 'on' });
  assert.equal(start.status, 5, start.stdout + start.stderr); assert.match(start.stderr, /^tree start: Zero retention is on, but this program has no host it may send/m); assert.equal(JSON.stringify(readdirSync(dir, { recursive: true }).sort()), before, 'nothing was written');
});

test('ZE-9: the doctor says a refused value once', () => {
  const dir = work();
  const bad = run(dir, ['doctor'], { ...KEYS.anthropic, COUNCIL_ZERO_RETENTION: 'maybe' });
  assert.match(bad.stdout, /COUNCIL_ZERO_RETENTION: "maybe" is not a zero-retention setting\. Use on or off\. Every run refuses to start until it is fixed\./);
  assert.doesNotMatch(run(dir, ['doctor'], KEYS.anthropic).stdout, /zero-retention setting/);
});
