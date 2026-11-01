// Arming a START under the per-provider caps switch (0.8.4 DUALCAP unit 4b2; C&C's rulings of 1 Nov 2026). With the switch on and at least one cap in force, a main
// start runs under one limit a person types per cap: it never takes a run-wide figure (--max-usd, MAX_USD_PER_RUN: refused, Q1), and without a terminal it waits at
// exit 21 with one gate per cap, every pending gate listed at once. A chain with no cap in force (an all-free mock chain) keeps today's path (test/caps-switch-start.test.js
// W6). Before B3 two settings that cannot be read are refused under the switch: COUNCIL_MAX_USD_LIMIT and a cap's own ceiling, whatever the main limit says.
// Offline, $0: the CLI from a temp folder, a minimal environment, mock seats only (the two-cap fixture places them in two caps with no key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGateAnswer, answerGate } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import * as uncovered from '../src/uncovered.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const BOTH = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const NOT_ARMED = /cannot yet hold a run to one spending cap per provider/;
const RUN = '2026-11-01T12-00-00-000Z';
const read = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
// The builder and the reviser bill anthropic, the critic openrouter; the criteria seat bills nothing (unit 1's fixture).
const TWO_CAPS = read(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json');

function project(dotEnv = null) {
  const work = mkdtempSync(join(tmpdir(), 'thc-caps-arming-'));
  mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'chains', `${TWO_CAPS.name}.json`), JSON.stringify(TWO_CAPS, null, 2));
  if (dotEnv !== null) writeFileSync(join(work, '.env'), dotEnv);
  const run = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...extraEnv }, encoding: 'utf8', timeout: 120_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
  };
  return { work, run, runDir: join(work, 'runs', RUN) };
}
const START = ['--task', 'tasks/x.md', '--chain', TWO_CAPS.name, '--run-id', RUN];
const jsonOf = r => { try { return JSON.parse(r.stdout); } catch { assert.fail(`not one JSON document on stdout:\n${r.out}`); } };
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const spentNothing = d => { const files = readdirSync(d); return !files.some(n => n.endsWith('.usage.json') || n === 'spend-reservations.jsonl' || n.startsWith('STOPPED')); };

// Q1: a run-wide figure under the switch, with a cap in force. Each source is its own test, so a red run shows each one failing on its own.
test('A1 Q1 SWITCH ON, a cap in force: --max-usd is refused, exit 2, before anything is written; the sentence names the flag, never its value, and is not the not-armed line', () => {
  const { work, run } = project();
  const r = run([...START, '--max-usd', '1.25'], BOTH);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /--max-usd/);
  assert.equal(r.out.includes('1.25'), false, 'the value is never echoed');
  assert.match(r.out, /one spending limit (?:typed )?per (?:cap|provider)|per-provider|per provider/i, 'it says why: the switch holds the run to one limit per cap');
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.equal(existsSync(join(work, 'runs')), false, 'nothing was written');
});

test('A1b Q1 SWITCH ON, a cap in force: MAX_USD_PER_RUN in the environment is refused, exit 2, naming the setting and the environment, never the value; nothing is written', () => {
  const { work, run } = project();
  const r = run(START, { ...BOTH, MAX_USD_PER_RUN: '4.75' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /MAX_USD_PER_RUN/);
  assert.match(r.out, /environment/);
  assert.equal(r.out.includes('4.75'), false, 'the value is never echoed');
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.equal(existsSync(join(work, 'runs')), false, 'nothing was written');
});

test('A1c Q1 SWITCH ON, a cap in force: MAX_USD_PER_RUN in the project .env is refused, exit 2, naming the setting and the .env, never the value; nothing is written', () => {
  const { work, run } = project('MAX_USD_PER_RUN=4.75\n');
  const r = run(START, BOTH);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /MAX_USD_PER_RUN/);
  assert.match(r.out, /\.env/);
  assert.equal(r.out.includes('4.75'), false, 'the value is never echoed');
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.equal(existsSync(join(work, 'runs')), false, 'nothing was written');
});

test('A1d Q1 SWITCH ON: a BLANK or a host-placeholder MAX_USD_PER_RUN (a Desktop field left empty) counts as unset: not refused, the start waits at exit 21 for the typed limits', () => {
  for (const blank of ['', '   ', '${user_config.max_usd}']) {
    const { run, runDir } = project();
    const r = run(START, { ...BOTH, MAX_USD_PER_RUN: blank });
    assert.equal(r.code, 21, `${JSON.stringify(blank)}\n${r.out}`);
    assert.doesNotMatch(r.out, /is refused/, JSON.stringify(blank));
    assert.ok(spentNothing(runDir), JSON.stringify(blank));
  }
});

test('A2 Q1b a DRY RUN under the switch reports the run-wide figure as a start refusal (max_usd_refused, exit 2), in its text and its JSON; exit 0; nothing is written', () => {
  const { work, run } = project();
  const text = run([...START, '--dry-run'], { ...BOTH, MAX_USD_PER_RUN: '2' });
  assert.equal(text.code, 0, text.out);
  assert.match(text.out, /A real start would be refused/);
  assert.match(text.out, /MAX_USD_PER_RUN/);
  const json = run([...START, '--dry-run', '--json'], { ...BOTH, MAX_USD_PER_RUN: '2' });
  assert.equal(json.code, 0, json.out);
  assert.deepEqual((jsonOf(json).startRefusals ?? []).map(x => `${x.code}:${x.exit}`), ['max_usd_refused:2']);
  assert.equal(existsSync(join(work, 'runs')), false, 'no dry run wrote anything');
});

test('A3 SWITCH ON, a start the caps cover, without a terminal and with nothing typed and no ceiling: exit 21 with ONE gate per cap (sorted, each naming its cap and its own screen), every pending gate listed at once; nothing spent; run.json carries no limit (no maxUsd: the $7 default is never a cap limit; no caps yet)', () => {
  const { run, runDir } = project();
  const r = run(START, BOTH);
  assert.equal(r.code, 21, r.out);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.deepEqual(ledger(runDir).map(l => l.event), ['gate_requested', 'gate_requested'], 'one gate per cap, both asked before the exit');
  const gates = ['g1', 'g2'].map(id => readGateAnswer(runDir, id));
  assert.deepEqual(gates.map(g => g.status), ['pending', 'pending']);
  assert.deepEqual(gates.map(g => g.gate.cap.cap_name), ['anthropic', 'openrouter'], 'one per cap in force, in sorted order');
  for (const [i, [id, cap]] of [['g1', 'anthropic'], ['g2', 'openrouter']].entries()) {
    assert.match(r.out, new RegExp(`gate answer \\S+ ${id}\\b`), `${id} is listed`);
    assert.match(r.out, new RegExp(cap), `${cap} is named`);
    const screen = readFileSync(join(runDir, gates[i].gate.text), 'utf8');
    assert.match(screen.split('\n')[0], new RegExp(`^${cap.toUpperCase()} spending limit \\(cap ${i + 1} of 2: anthropic, openrouter\\)$`), `${id}'s own screen opens with its cap (milestone 2)`);
    assert.match(screen, new RegExp(`(Calls through ${cap}, by the dry run's count: about \\$|No priced call goes through ${cap})`), `${id}'s screen shows that cap's own estimate`);
  }
  assert.equal(readdirSync(runDir).filter(n => /^cap-screen-\d+\.md$/.test(n)).length, 2, `one screen per cap: ${readdirSync(runDir)}`);
  assert.ok(spentNothing(runDir), `nothing spent, reserved or stopped: ${readdirSync(runDir)}`);
  const meta = read(runDir, 'run.json');
  assert.equal(Object.hasOwn(meta, 'maxUsd'), false, 'no run-wide limit nobody typed');
  assert.equal(Object.hasOwn(meta, 'caps'), false, 'no cap limit before every cap is typed');
});

test('A7 SWITCH ON, an unreadable COUNCIL_MAX_USD_LIMIT refuses the start with its own sentence, exit 2, never echoing the value, whatever the chain (it used to read as absent and skip option B); nothing is written', () => {
  const { work, run } = project();
  const r = run(START, { ...BOTH, COUNCIL_MAX_USD_LIMIT: 'abc' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /COUNCIL_MAX_USD_LIMIT\b(?!_)/);
  assert.equal(/\babc\b/.test(r.out), false, 'the value is never echoed');
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.equal(existsSync(join(work, 'runs')), false, 'nothing was written');
});

test('A8 a cap\'s own ceiling that cannot be read refuses the start WHATEVER COUNCIL_MAX_USD_LIMIT says (unset here): the start refusal cap_ceiling_unreadable, exit 2, in the pure list and through the CLI; nothing is written', () => {
  const bad = { usd: null, unreadable: 'COUNCIL_MAX_USD_LIMIT_ANTHROPIC is set but is not a positive number of dollars.' };
  const list = uncovered.capsStartRefusals(TWO_CAPS, ['anthropic', 'openrouter'], { limitUsd: null, ceilingOf: id => (id === 'anthropic' ? bad : { usd: null, unreadable: null }) });
  assert.deepEqual(list.map(x => `${x.code}:${x.exit}`), ['cap_ceiling_unreadable:2']);
  const { work, run } = project();
  const r = run(START, { ...BOTH, COUNCIL_MAX_USD_LIMIT_ANTHROPIC: 'abc' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /COUNCIL_MAX_USD_LIMIT_ANTHROPIC/);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.equal(existsSync(join(work, 'runs')), false, 'nothing was written');
});

// ---- The pending start (C&C, 1 Nov 2026: YES). The printed next step after exit 21 is a plain --resume (cli.js, the typed-limit wait), so a --resume under the switch
// of a folder that holds ONLY what a start waiting at exit 21 writes (and what `council gate answer` adds: the ledger and gates/) continues the start: it asks
// for every cap still open, and arms once each is typed. Anything else in the folder (a stage file, a usage file, a reservation, a stop file, `caps` in run.json)
// is a run that started (since 4c1 classified by test/caps-resume.test.js's rules). The allowlist below is what the code writes before the wait (read from cli.js on 74d9710f);
// A3's listing checks it against the real folder.
const PENDING_FILES = new Set(['run.json', 'gate-ledger.jsonl', 'gates']);
const PENDING_OPTIONAL = /^(?:\.council\.lock|gate-ledger\.lock|cap-screen-\d+\.md|cap-scope-\d+\.json|gates[/\\]g\d+\.json)$/;
const typeLimit = (d, id, total) => { const g = readGateAnswer(d, id).gate; const a = answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: total }); assert.equal(a.ok, true, JSON.stringify(a)); };
const capOfGate = (d, id) => readGateAnswer(d, id).gate.cap.cap_name;
function waiting(env = BOTH) {
  const p = project();
  const r = p.run(START, env);
  assert.equal(r.code, 21, r.out);
  const ids = { [capOfGate(p.runDir, 'g1')]: 'g1', [capOfGate(p.runDir, 'g2')]: 'g2' };
  return { ...p, ids };
}
const resume = p => p.run(['--resume', p.runDir], BOTH);
const consumed = d => ledger(d).filter(l => l.event === 'cap_consumed');

test('A3b the folder a start leaves at exit 21 holds only the pending-start allowlist (what the class is keyed on): run.json, the gate ledger, gates/ with one file per gate, the screens, their scope files and the locks', () => {
  const { runDir } = waiting();
  const entries = readdirSync(runDir, { recursive: true }).map(String).sort();
  for (const f of PENDING_FILES) assert.ok(entries.includes(f), `${f} is there: ${entries}`);
  for (const f of entries) assert.ok(PENDING_FILES.has(f) || PENDING_OPTIONAL.test(f), `${f} is not in the allowlist: ${entries}`);
});

test('A4 the pending start continues: both limits typed (gate answer, the cli channel), --resume arms one bucket per cap and the run finishes: run.json caps, never maxUsd; each usage file names the cap it billed through; report.json caps with each cap\'s spend = the sum of its usage files, maxUsd null; one consumption per cap', () => {
  const p = waiting();
  typeLimit(p.runDir, p.ids.anthropic, '1000');
  typeLimit(p.runDir, p.ids.openrouter, '1000');
  const r = resume(p);
  assert.equal(r.code, 0, r.out);
  const meta = read(p.runDir, 'run.json');
  assert.deepEqual(meta.caps, { anthropic: { maxUsd: 1000 }, openrouter: { maxUsd: 1000 } });
  assert.equal(Object.hasOwn(meta, 'maxUsd'), false, 'no run-wide limit under the switch');
  const usage = readdirSync(p.runDir).filter(n => n.endsWith('.usage.json')).map(n => ({ label: n.slice(0, -'.usage.json'.length), ...read(p.runDir, n) }));
  const byLabel = Object.fromEntries(usage.map(u => [u.label, u]));
  assert.equal(Object.hasOwn(byLabel.criteria, 'capName'), false, 'the criteria seat bills nothing: no cap');
  assert.equal(byLabel.build.capName, 'anthropic');
  assert.ok(usage.some(u => u.label.startsWith('critique-')), `a critique ran: ${Object.keys(byLabel)}`);
  for (const u of usage.filter(x => x.label.startsWith('critique-'))) assert.equal(u.capName, 'openrouter', u.label);
  const report = read(p.runDir, 'report.json');
  assert.equal(report.maxUsd, null);
  for (const id of ['anthropic', 'openrouter']) {
    const sum = usage.filter(u => u.capName === id).reduce((n, u) => n + u.usd, 0);
    assert.equal(report.caps[id].maxUsd, 1000, id);
    assert.ok(Math.abs(report.caps[id].spentUsd - sum) < 1e-9, `${id}: report ${report.caps[id].spentUsd} vs usage files ${sum}`);
    assert.ok(sum > 0, `${id}: something was spent through it`);
  }
  assert.deepEqual(consumed(p.runDir).map(l => l.cap_name).sort(), ['anthropic', 'openrouter']);
});

test('A5 a stop at ONE cap: openrouter typed at $0.01, the first critique cannot fit: exit 4; STOPPED-budget.json names the cap, its limit and what was spent through it (0), and the run total apart; the .md names the cap', () => {
  const p = waiting();
  typeLimit(p.runDir, p.ids.anthropic, '1000');
  typeLimit(p.runDir, p.ids.openrouter, '0.01');
  const r = resume(p);
  assert.equal(r.code, 4, r.out);
  const st = read(p.runDir, 'STOPPED-budget.json');
  assert.equal(st.capName, 'openrouter');
  assert.equal(st.capUsd, 0.01);
  assert.equal(st.capSpentUsd, 0, 'nothing had gone through openrouter before the first critique');
  assert.equal(Object.hasOwn(st, 'capAssumedUsd'), false, 'omitted when nothing was assumed');
  assert.ok(st.spentUsd > 0, 'the run total holds the criteria seat and the build');
  assert.match(readFileSync(join(p.runDir, 'STOPPED-budget.md'), 'utf8'), /the openrouter spend cap/);
});

test('A9 a PARTIAL answer never arms: one cap typed, the other open: --resume waits at exit 21 again, listing only the open gate; nothing is spent; run.json carries no caps. Then the third sitting (the path B3 walks): the second cap typed, --resume arms both, one limit read back from the sitting before and one consumed now', () => {
  const p = waiting();
  typeLimit(p.runDir, p.ids.anthropic, '1000');
  const r = resume(p);
  assert.equal(r.code, 21, r.out);
  assert.match(r.out, new RegExp(`gate answer \\S+ ${p.ids.openrouter}\\b`));
  assert.doesNotMatch(r.out, new RegExp(`gate answer \\S+ ${p.ids.anthropic}\\b`), 'the typed cap is not asked again');
  assert.ok(spentNothing(p.runDir), `${readdirSync(p.runDir)}`);
  assert.equal(Object.hasOwn(read(p.runDir, 'run.json'), 'caps'), false);
  typeLimit(p.runDir, p.ids.openrouter, '1000');
  const third = resume(p);
  assert.equal(third.code, 0, third.out);
  assert.deepEqual(consumed(p.runDir).map(l => l.cap_name).sort(), ['anthropic', 'openrouter'], 'one consumption per cap, across the two sittings');
  assert.deepEqual(read(p.runDir, 'run.json').caps, { anthropic: { maxUsd: 1000 }, openrouter: { maxUsd: 1000 } });
});

// Each artifact that means "the run started" is its own test. Since 4c1 such a folder (it records no limit it can show: neither maxUsd, nor caps backed by one
// consumption per cap in the ledger, yet it holds more than a waiting start writes) is refused because its limits cannot be told (the not-armed line went with 4c1). On the code before 4b2 they failed at their setup;
// their red as exclusions is a known-bad tree whose pending-start check admits every folder.
const UNTOLD = /so what it may spend cannot be known and it was not continued\./;
function excluded(plant) {
  const p = waiting();
  typeLimit(p.runDir, p.ids.anthropic, '1000');
  typeLimit(p.runDir, p.ids.openrouter, '1000');
  plant(p.runDir);
  const r = resume(p);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, UNTOLD);
  assert.deepEqual(consumed(p.runDir), [], 'no limit was consumed');
  assert.equal(readdirSync(p.runDir).some(n => n.endsWith('.usage.json') && n !== 'criteria.usage.json'), false, 'nothing ran');
}
test('A10a a stage file in the folder: not a pending start, refused (its limits cannot be told)', () => excluded(d => writeFileSync(join(d, 'criteria.md'), 'Criteria.\n')));
test('A10b a usage file in the folder: not a pending start, refused (its limits cannot be told)', () => excluded(d => writeFileSync(join(d, 'criteria.usage.json'), JSON.stringify({ provider: 'mock', model: 'mock-priced', usd: 0 }))));
test('A10c a reservation file in the folder: not a pending start, refused (its limits cannot be told)', () => excluded(d => writeFileSync(join(d, 'spend-reservations.jsonl'), '')));
test('A10d a stop file in the folder: not a pending start, refused (its limits cannot be told)', () => excluded(d => writeFileSync(join(d, 'STOPPED-budget.json'), JSON.stringify({ capUsd: 1, spentUsd: 0 }))));
test('A10e caps in run.json with no limit consumed for them (a caps run is run.json caps AND one consumption per cap: the ledger is the authority, run.json a copy): refused (its limits cannot be told)', () => excluded(d => { const m = read(d, 'run.json'); writeFileSync(join(d, 'run.json'), JSON.stringify({ ...m, caps: { anthropic: { maxUsd: 1000 }, openrouter: { maxUsd: 1000 } } })); }));

test('A1e ON-ONLY (C&C): with the switch OFF a blank MAX_USD_PER_RUN is refused exactly as before (E102 is the owner\'s decision): the CLI\'s "0 is refused (from MAX_USD_PER_RUN)", exit 2', () => {
  const { work, run } = project();
  const r = run(['--task', 'tasks/x.md', '--chain', 'mock'], { MAX_USD_PER_RUN: '' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /--max-usd: 0 is refused \(from MAX_USD_PER_RUN\)/);
  assert.equal(existsSync(join(work, 'runs')), false);
});
