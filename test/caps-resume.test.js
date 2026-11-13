// Resuming and raising under the per-provider caps switch (0.8.4 DUALCAP unit 4c1; C&C's rulings of 1 Nov 2026). A resume takes its class from its RUN FOLDER:
// a caps run (run.json `caps`) resumes under the limits typed for it, each cap read back from the gate ledger; a run started with the switch off (run.json
// `maxUsd`) is refused when the switch is now on, and a caps run when it is now off (the mode flip, both ways), and so is a caps run whose set of caps in force
// changed; a folder that records no limit and is not a start still waiting for its typed limits is refused (its limits cannot be told). Earlier spend counts
// in the cap it billed through (superseded charges and unsettled reservations too). A run stopped at one cap asks a raise for THAT cap only, its floor is that
// cap's own counted spend; an early raise names its cap (`--raise-cap <id>`, the switch on only); the handler relays a raise per cap. With the switch off
// nothing changes. Offline, $0: the CLI from a temp folder, a minimal environment, mock and external seats only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGateAnswer, answerGate } from '../src/gate.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const BOTH = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const NOT_ARMED = /cannot yet hold a run to one spending cap per provider/;
const FLIP = /COUNCIL_SPEND_CAPS/;
const read = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
// The builder and the reviser bill anthropic, the critic openrouter; the criteria seat bills nothing (unit 1's fixture).
const TWO_CAPS = read(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json');
// The same chain with the builder answered by a session (as B3 pauses): the run pauses at `build` (exit 3); the reviser (anthropic) and the critic (openrouter) stay capped.
const PAUSE = { ...TWO_CAPS, name: 'two-caps-pause', seats: { ...TWO_CAPS.seats, builder: { provider: 'external', model: 'claude-code-session' } } };

function project() {
  const work = mkdtempSync(join(tmpdir(), 'thc-caps-resume-'));
  mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  mkdirSync(join(work, 'chains'));
  for (const c of [TWO_CAPS, PAUSE]) writeFileSync(join(work, 'chains', `${c.name}.json`), JSON.stringify(c, null, 2));
  const run = (args, env = BOTH) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...env }, encoding: 'utf8', timeout: 120_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { work, run };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const consumed = (d, cap) => ledger(d).filter(l => l.event === 'cap_consumed' && (cap === undefined || l.cap_name === cap));
const gatesOf = d => ledger(d).filter(l => l.event === 'gate_requested').map(l => l.gate);
const capOf = (d, id) => readGateAnswer(d, id).gate.cap;
const typeLimit = (d, id, total) => { const g = readGateAnswer(d, id).gate; const a = answerGate(d, id, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'tester', tty: true, typedCap: total }); assert.equal(a.ok, true, JSON.stringify(a)); };
const gateOfCap = (d, cap, operation = 'start') => gatesOf(d).find(id => capOf(d, id).cap_name === cap && capOf(d, id).operation === operation);
const answerBuild = d => writeFileSync(join(d, 'build.md'), '# Plan\n\nA short plan.\n');

// A caps run started and armed: both limits typed, then the --resume that arms. `chain` PAUSE stops at the session seat (exit 3); TWO_CAPS runs on.
function armed(chain, limits, id = '2026-11-01T13-00-00-000Z') {
  const p = project();
  const dir = join(p.work, 'runs', id);
  const s = p.run(['--task', 'tasks/x.md', '--chain', chain.name, '--run-id', id]);
  assert.equal(s.code, 21, s.out);
  for (const cap of ['anthropic', 'openrouter']) typeLimit(dir, gateOfCap(dir, cap), limits[cap]);
  const r = p.run(['--resume', dir]);
  return { ...p, dir, first: r };
}
// A run stopped at the openrouter cap: anthropic $1000, openrouter $0.01 (the first critique cannot fit), as test/caps-arming.test.js A5.
function stoppedAtOpenrouter() {
  const a = armed(TWO_CAPS, { anthropic: '1000', openrouter: '0.01' });
  assert.equal(a.first.code, 4, a.first.out);
  assert.equal(read(a.dir, 'STOPPED-budget.json').capName, 'openrouter');
  return a;
}

test('R1 a caps run paused at a session seat resumes under ON under the limits typed for it: no new gate, no second consumption, the run finishes; report.json caps', () => {
  const a = armed(PAUSE, { anthropic: '1000', openrouter: '1000' });
  assert.equal(a.first.code, 3, a.first.out);
  assert.deepEqual(read(a.dir, 'run.json').caps, { anthropic: { maxUsd: 1000 }, openrouter: { maxUsd: 1000 } });
  const gates = gatesOf(a.dir).length;
  answerBuild(a.dir);
  const r = a.run(['--resume', a.dir]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.equal(gatesOf(a.dir).length, gates, 'no new gate: each cap continues under its typed limit');
  assert.deepEqual(consumed(a.dir).map(l => l.cap_name).sort(), ['anthropic', 'openrouter'], 'one consumption per cap, from the start');
  const report = read(a.dir, 'report.json');
  assert.equal(report.caps.anthropic.maxUsd, 1000);
  assert.equal(report.caps.openrouter.maxUsd, 1000);
});

// Earlier spend counts in the cap it billed through. invoke() gates a call inside a run on its EXPECTED size (the chain's estimate block), so the first critique's gate
// figure is about $1.3 (the 4b2 probe's stop file: gateStageUsd 1.318); an openrouter limit of $2.05 holds it alone, but not with $2 more already in that cap.
function pausedWith(plant, openrouter = '2.05') {
  const a = armed(PAUSE, { anthropic: '1000', openrouter });
  assert.equal(a.first.code, 3, a.first.out);
  plant(a.dir);
  answerBuild(a.dir);
  const r = a.run(['--resume', a.dir]);
  return { ...a, r };
}
test('R2a a superseded charge recorded against the openrouter cap counts in that cap on the resume: the first critique no longer fits, the run stops at openrouter with that $2 in its spend', () => {
  const { dir, r } = pausedWith(d => { mkdirSync(join(d, 'superseded'), { recursive: true }); writeFileSync(join(d, 'superseded', 'critique-0.charge-1.usage.json'), JSON.stringify({ provider: 'mock', model: 'mock-priced', usage: { input: 0, output: 0 }, usd: 2, reason: 'test', capName: 'openrouter' })); });
  assert.equal(r.code, 4, r.out);
  const st = read(dir, 'STOPPED-budget.json');
  assert.equal(st.capName, 'openrouter');
  assert.ok(Math.abs(st.capSpentUsd - 2) < 1e-9, `capSpentUsd ${st.capSpentUsd}`);
});
test('R2b an unsettled reservation recorded against the openrouter cap counts in that cap on the resume (at its worst case): the run stops at openrouter with that $2 in its spend', () => {
  const { dir, r } = pausedWith(d => writeFileSync(join(d, 'spend-reservations.jsonl'), `${JSON.stringify({ schema: 'spend-reservations/1', event: 'reserved', id: 'r-old-1', label: 'critique-0', seat: 'mock/mock-priced', usd: 2, at: '2026-11-01T00:00:00.000Z', capName: 'openrouter' })}\n`));
  assert.equal(r.code, 4, r.out);
  const st = read(dir, 'STOPPED-budget.json');
  assert.equal(st.capName, 'openrouter');
  assert.ok(Math.abs(st.capSpentUsd - 2) < 1e-9, `capSpentUsd ${st.capSpentUsd}`);
});

test('R3 a run stopped at the openrouter cap: --resume waits at exit 21 for a RAISE of that cap only (anthropic continues), its screen names the cap; a higher total typed, the run finishes; run.json and report.json carry the new limit', () => {
  const a = stoppedAtOpenrouter();
  const md = readFileSync(join(a.dir, 'STOPPED-budget.md'), 'utf8');
  assert.doesNotMatch(md, /cannot yet continue/, 'the stop says how to continue (4c1)');
  assert.match(md, /--resume /);
  assert.match(md, /openrouter/);
  const before = gatesOf(a.dir);
  const w = a.run(['--resume', a.dir]);
  assert.equal(w.code, 21, w.out);
  const fresh = gatesOf(a.dir).filter(g => !before.includes(g));
  assert.equal(fresh.length, 1, `one new gate: ${fresh}`);
  const cap = capOf(a.dir, fresh[0]);
  assert.deepEqual([cap.cap_name, cap.operation], ['openrouter', 'raise']);
  assert.match(w.out, new RegExp(`gate answer \\S+ ${fresh[0]}\\b`));
  assert.match(w.out, /openrouter/);
  assert.match(readFileSync(join(a.dir, readGateAnswer(a.dir, fresh[0]).gate.text), 'utf8'), /openrouter/);
  typeLimit(a.dir, fresh[0], '1000');
  const r = a.run(['--resume', a.dir]);
  assert.equal(r.code, 0, r.out);
  assert.equal(consumed(a.dir, 'openrouter').length, 2, 'the start and the raise');
  assert.equal(consumed(a.dir, 'anthropic').length, 1, 'anthropic was not asked again');
  assert.equal(read(a.dir, 'run.json').caps.openrouter.maxUsd, 1000);
  assert.equal(read(a.dir, 'report.json').caps.openrouter.maxUsd, 1000);
});

test('R4 the handler relays a raise per cap (C2: `--raise-cap --relayed` on a run stopped at a cap; --relayed is never read as the cap): the wait names relay-answer for that cap\'s gate; relay-answer records it; the run continues; report.json\'s relayed row names the cap', () => {
  const a = stoppedAtOpenrouter();
  const before = gatesOf(a.dir);
  const w = a.run(['--resume', a.dir, '--raise-cap', '--relayed']);
  assert.equal(w.code, 21, w.out);
  const g = gatesOf(a.dir).filter(x => !before.includes(x));
  assert.equal(g.length, 1, `${g}`);
  assert.deepEqual([capOf(a.dir, g[0]).cap_name, capOf(a.dir, g[0]).operation], ['openrouter', 'raise']);
  assert.match(w.out, new RegExp(`relay-answer \\S+ ${g[0]}\\b`));
  assert.match(w.out, /openrouter/);
  const rel = a.run(['relay-answer', a.dir, g[0], '--total', '1000', '--person-words', 'raise the openrouter cap to 1000 dollars']);
  assert.equal(rel.code, 0, rel.out);
  const r = a.run(['--resume', a.dir, '--raise-cap', '--relayed']);
  assert.equal(r.code, 0, r.out);
  assert.equal(read(a.dir, 'run.json').caps.openrouter.maxUsd, 1000);
  const row = (read(a.dir, 'report.json').relayed ?? []).find(x => x.gate === g[0]);
  assert.ok(row, 'the relayed answer is on the report');
  assert.equal(row.cap_name, 'openrouter');
});

test('R4b a raise gate the PERSON asked for (a plain --resume first) stays theirs: a later `--raise-cap --relayed` reuses it, and the wait names `gate answer` for it, never relay-answer (which refuses a gate the person asked for)', () => {
  const a = stoppedAtOpenrouter();
  const before = gatesOf(a.dir);
  assert.equal(a.run(['--resume', a.dir]).code, 21);
  const g = gatesOf(a.dir).filter(x => !before.includes(x));
  assert.equal(g.length, 1);
  const w = a.run(['--resume', a.dir, '--raise-cap', '--relayed']);
  assert.equal(w.code, 21, w.out);
  assert.deepEqual(gatesOf(a.dir).filter(x => !before.includes(x)), g, 'the same pending gate, reused');
  assert.match(w.out, new RegExp(`gate answer \\S+ ${g[0]}\\b`));
  assert.doesNotMatch(w.out, new RegExp(`relay-answer \\S+ ${g[0]}\\b`));
});

test('R7 the hint after a cap stop is no trap (the 30 Okt rule: cap raises are relayed): STOPPED-budget.md and the run\'s output name `--raise-cap <cap> --relayed` FIRST, the person\'s plain --resume after it; the printed relayed command, run as printed, asks a raise gate the SESSION requested, so relay-answer can answer it', () => {
  const a = stoppedAtOpenrouter();
  const md = readFileSync(join(a.dir, 'STOPPED-budget.md'), 'utf8');
  const relayedAt = md.search(/^ +council --resume runs\/\S+ --raise-cap openrouter --relayed$/m);
  const bareAt = md.search(/^ +council --resume runs\/\S+$/m);
  assert.ok(relayedAt !== -1, `the stop file names the relayed raise of the cap it stopped at:\n${md}`);
  assert.ok(bareAt > relayedAt, `the person's plain --resume comes after the relayed form:\n${md}`);
  const resumeLine = a.first.out.split('\n').findIndex(l => /^ +resume: +council --resume runs\/\S+ --raise-cap openrouter --relayed\b/.test(l));
  const orLine = a.first.out.split('\n').findIndex(l => /^ +or: +council --resume runs\/\S+ +\(/.test(l));
  assert.ok(resumeLine !== -1 && orLine > resumeLine, `the output's resume line is the relayed form, the plain --resume after it:\n${a.first.out}`);
  // Run the printed command exactly as printed (cwd = the project folder, so runs/<id> resolves).
  const printed = md.slice(relayedAt).split('\n')[0].trim().split(/\s+/).slice(1);
  const before = gatesOf(a.dir);
  const w = a.run(printed);
  assert.equal(w.code, 21, w.out);
  const g = gatesOf(a.dir).filter(x => !before.includes(x));
  assert.equal(g.length, 1, `${g}`);
  assert.deepEqual([capOf(a.dir, g[0]).cap_name, capOf(a.dir, g[0]).operation], ['openrouter', 'raise']);
  assert.match(w.out, new RegExp(`relay-answer \\S+ ${g[0]}\\b`));
  assert.equal(ledger(a.dir).find(l => l.event === 'gate_requested' && l.gate === g[0])?.requested_by, 'session', 'the gate is the session\'s to relay (gate.js refuses a relay for a gate the person asked for)');
});

test('R4c the same with the switch OFF (C&C, 1 Nov: the relayed wait is not shipped, so the instruction is fixed in both modes): a paid run stopped at its one limit, a plain --resume asks the person\'s raise gate, `--resume --raise-cap --relayed` reuses it and names `gate answer` for it, never relay-answer', () => {
  // A paid seat behind a loopback address that is never called: the typed limit of $0.001 is below the criteria call's projection, so the run stops before it sends.
  const p = project();
  const base = read(root, 'chains', 'mock-debate.json');
  writeFileSync(join(p.work, 'chains', 'paid-off.json'), JSON.stringify({ ...base, name: 'paid-off', seats: { ...base.seats, criteria: { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 500, baseUrl: 'http://127.0.0.1:9' } } }));
  const off = { OPENROUTER_API_KEY: `sk-or-v1-${'e'.repeat(40)}`, COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' };
  const id = '2026-11-01T13-00-07-000Z'; const dir = join(p.work, 'runs', id);
  assert.equal(p.run(['--task', 'tasks/x.md', '--chain', 'paid-off', '--run-id', id], off).code, 21);
  typeLimit(dir, 'g1', '0.001');
  const stop = p.run(['--resume', dir], off);
  assert.equal(stop.code, 4, stop.out);
  const before = gatesOf(dir);
  assert.equal(p.run(['--resume', dir], off).code, 21);
  const g = gatesOf(dir).filter(x => !before.includes(x));
  assert.equal(g.length, 1);
  const w = p.run(['--resume', dir, '--raise-cap', '--relayed'], off);
  assert.equal(w.code, 21, w.out);
  assert.deepEqual(gatesOf(dir).filter(x => !before.includes(x)), g, 'the same pending gate, reused');
  assert.match(w.out, new RegExp(`gate answer \\S+ ${g[0]}\\b`));
  assert.doesNotMatch(w.out, new RegExp(`relay-answer \\S+ ${g[0]}\\b`));
});

test('R5 an EARLY raise names its cap (`--raise-cap openrouter` on a caps run paused at a session seat): exit 21 with a raise gate for openrouter only; the total typed, the next --raise-cap openrouter resume continues under it', () => {
  const a = armed(PAUSE, { anthropic: '1000', openrouter: '1000' });
  assert.equal(a.first.code, 3, a.first.out);
  const before = gatesOf(a.dir);
  const w = a.run(['--resume', a.dir, '--raise-cap', 'openrouter']);
  assert.equal(w.code, 21, w.out);
  const g = gatesOf(a.dir).filter(x => !before.includes(x));
  assert.equal(g.length, 1, `${g}`);
  assert.deepEqual([capOf(a.dir, g[0]).cap_name, capOf(a.dir, g[0]).operation], ['openrouter', 'raise']);
  typeLimit(a.dir, g[0], '2000');
  answerBuild(a.dir);
  const r = a.run(['--resume', a.dir, '--raise-cap', 'openrouter']);
  assert.equal(r.code, 0, r.out);
  assert.equal(read(a.dir, 'run.json').caps.openrouter.maxUsd, 2000);
  assert.equal(read(a.dir, 'run.json').caps.anthropic.maxUsd, 1000);
});

test('R5b a bare --raise-cap under the caps with no stop file is refused, exit 2, naming the run\'s caps ("name the cap"); nothing is asked', () => {
  const a = armed(PAUSE, { anthropic: '1000', openrouter: '1000' });
  assert.equal(a.first.code, 3, a.first.out);
  const before = gatesOf(a.dir);
  const r = a.run(['--resume', a.dir, '--raise-cap']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /anthropic, openrouter/);
  assert.match(r.out, /--raise-cap <|name the cap|--raise-cap anthropic|--raise-cap openrouter/);
  assert.deepEqual(gatesOf(a.dir), before);
});

test('R5c (C3) an id that is not one of the run\'s caps is refused, exit 2, the sentence names the run\'s caps; nothing is asked', () => {
  const a = armed(PAUSE, { anthropic: '1000', openrouter: '1000' });
  assert.equal(a.first.code, 3, a.first.out);
  const before = gatesOf(a.dir);
  for (const id of ['openai', 'nonsense']) {
    const r = a.run(['--resume', a.dir, '--raise-cap', id]);
    assert.equal(r.code, 2, `${id}\n${r.out}`);
    assert.match(r.out, /anthropic, openrouter/, id);
    assert.match(r.out, new RegExp(`--raise-cap ${id}|"${id}"|${id} is not`), `${id}: the refusal names the id it was given`);
  }
  assert.deepEqual(gatesOf(a.dir), before);
});

test('R5d (C4) stopped at openrouter, `--raise-cap anthropic`: BOTH gates at the one exit 21, the openrouter raise the stop requires and the anthropic raise he named, each naming its cap', () => {
  const a = stoppedAtOpenrouter();
  const before = gatesOf(a.dir);
  const w = a.run(['--resume', a.dir, '--raise-cap', 'anthropic']);
  assert.equal(w.code, 21, w.out);
  const g = gatesOf(a.dir).filter(x => !before.includes(x));
  assert.deepEqual(g.map(x => [capOf(a.dir, x).cap_name, capOf(a.dir, x).operation]).sort(), [['anthropic', 'raise'], ['openrouter', 'raise']]);
  for (const x of g) assert.match(w.out, new RegExp(`gate answer \\S+ ${x}\\b`));
});

test('R6 the raise floor is the STOPPED cap\'s own counted spend, not the run\'s: a total above the cap\'s spend but below the run\'s is accepted; one at the cap\'s spend is refused (the gate is set aside with its note)', () => {
  // Deterministic figures: a $2 charge recorded against openrouter (R2a's mechanism) and an openrouter limit of $2.05, which no critique can fit on top of it (its
  // output alone is 8000 tokens at the fixture's $1000 per million, $8). The run stops at openrouter with exactly $2 in that cap and the criteria seat's cost on top
  // in the run total.
  const { dir, r, run } = pausedWith(d => { mkdirSync(join(d, 'superseded'), { recursive: true }); writeFileSync(join(d, 'superseded', 'critique-0.charge-1.usage.json'), JSON.stringify({ provider: 'mock', model: 'mock-priced', usage: { input: 0, output: 0 }, usd: 2, reason: 'test', capName: 'openrouter' })); }, '2.05');
  assert.equal(r.code, 4, r.out);
  const st = read(dir, 'STOPPED-budget.json');
  assert.equal(st.capName, 'openrouter');
  assert.ok(Math.abs(st.capSpentUsd - 2) < 1e-9 && st.spentUsd > st.capSpentUsd + 0.001, JSON.stringify(st));
  const between = (Math.ceil(((st.capSpentUsd + st.spentUsd) / 2) * 1e4) / 1e4).toFixed(4);
  const before = gatesOf(dir);
  assert.equal(run(['--resume', dir]).code, 21);
  const g = gatesOf(dir).filter(x => !before.includes(x));
  assert.equal(g.length, 1);
  typeLimit(dir, g[0], between);
  const r1 = run(['--resume', dir]);
  assert.doesNotMatch(r1.out, /not above what the run has already counted/, `a total of ${between} is above the cap's spend ${st.capSpentUsd} (run total ${st.spentUsd})`);
  assert.equal(consumed(dir, 'openrouter').length, 2, `the raise to ${between} was consumed`);
  assert.equal(r1.code, 4, 'and the run stops again at its new openrouter limit');
  const before2 = gatesOf(dir);
  assert.equal(run(['--resume', dir]).code, 21);
  const g2 = gatesOf(dir).filter(x => !before2.includes(x));
  typeLimit(dir, g2[0], '2');
  const r2 = run(['--resume', dir]);
  assert.match(r2.out, /not above what the run has already counted/, 'a total AT the cap\'s spend is refused');
  assert.equal(consumed(dir, 'openrouter').length, 2, 'not consumed');
});

test('R5e (C1) OFF byte for byte: with the switch off, `--raise-cap openrouter` is still a stray word, refused exactly as before', () => {
  const p = project();
  const id = '2026-11-01T13-00-09-000Z';
  const s = p.run(['--task', 'tasks/x.md', '--chain', PAUSE.name, '--run-id', id, '--max-usd', '1000'], {});
  assert.equal(s.code, 3, s.out);
  const r = p.run(['--resume', join(p.work, 'runs', id), '--raise-cap', 'openrouter'], {});
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /openrouter/);
  assert.doesNotMatch(r.out, FLIP);
});

test('M1 the MODE FLIP, ON to OFF: a caps run resumed with the switch off is refused, exit 2, naming COUNCIL_SPEND_CAPS; run.json and the ledger are untouched', () => {
  const a = armed(PAUSE, { anthropic: '1000', openrouter: '1000' });
  assert.equal(a.first.code, 3, a.first.out);
  const meta = readFileSync(join(a.dir, 'run.json'), 'utf8');
  const led = readFileSync(join(a.dir, LEDGER_FILE), 'utf8');
  answerBuild(a.dir);
  const r = a.run(['--resume', a.dir], {});
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, FLIP);
  assert.equal(readFileSync(join(a.dir, 'run.json'), 'utf8'), meta);
  assert.equal(readFileSync(join(a.dir, LEDGER_FILE), 'utf8'), led);
});

test('M2 the MODE FLIP, OFF to ON: a run started with the switch off (one limit, run.json maxUsd) resumed with it on is refused with the flip sentence, not the not-armed line; nothing is written', () => {
  const p = project();
  const id = '2026-11-01T13-00-08-000Z';
  const dir = join(p.work, 'runs', id);
  const s = p.run(['--task', 'tasks/x.md', '--chain', PAUSE.name, '--run-id', id, '--max-usd', '1000'], {});
  assert.equal(s.code, 3, s.out);
  const before = readdirSync(dir).sort();
  answerBuild(dir);
  const r = p.run(['--resume', dir]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, FLIP);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.deepEqual(readdirSync(dir).filter(n => n !== 'build.md').sort(), before);
});

test('M3 a caps run whose set of caps in force changed after it started (the chain now has a seat billing a third cap) is refused, exit 2, naming both sets; nothing is asked', () => {
  const a = armed(PAUSE, { anthropic: '1000', openrouter: '1000' });
  assert.equal(a.first.code, 3, a.first.out);
  const chainPath = join(a.work, 'chains', `${PAUSE.name}.json`);
  const edited = { ...PAUSE, seats: { ...PAUSE.seats, critics: [...PAUSE.seats.critics, { provider: 'mock', model: 'mock-priced', maxTokens: 8000, lab: 'mock-b', mockBills: 'openai' }] } };
  writeFileSync(chainPath, JSON.stringify(edited, null, 2));
  const before = gatesOf(a.dir);
  answerBuild(a.dir);
  const r = a.run(['--resume', a.dir], { COUNCIL_SPEND_CAPS: 'openrouter,anthropic,openai' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /anthropic, openrouter/);
  assert.match(r.out, /anthropic, openai, openrouter/);
  assert.deepEqual(gatesOf(a.dir), before);
});
