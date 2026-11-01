// The start and resume refusals of the per-provider caps switch (0.8.4 DUALCAP unit 3b; C&C's rulings of 1 Nov 2026). With the switch on, a start or a resume is no
// longer refused at the top: it runs the main path's own checks and then, before anything is written and in this order, meets: a seat that is not mock carrying
// mockBills (refused WHATEVER the switch says; the chain lint answers that one first on every CLI line, see the note before C5), seats no enabled cap covers (exit 5), a cap in force without a ceiling of its own
// while COUNCIL_MAX_USD_LIMIT is set (option B, exit 2), and last the not-armed refusal that stands until the caps are armed. A resume takes the class of its RUN
// FOLDER, never of the --resume flag (C&C): a tree member's run (run.json's tree lineage) is refused as a tree, exit 19; an advice folder as an advice call, exit 2;
// a plain run's resume (B3 resumes after every external seat) meets the not-armed line and nothing earlier. A dry run reports each refusal, in its text and in the
// JSON field `startRefusals` (absent when there is none), exits 0 and calls nothing (Q1b). Offline, $0: the CLI from a temp folder, a minimal environment, mock and
// external seats only. The new exports (src/caps.js, src/uncovered.js) are read through namespace imports, so on the code before the change each pure test fails by assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as caps from '../src/caps.js';
import * as uncovered from '../src/uncovered.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const BOTH = { COUNCIL_SPEND_CAPS: 'openrouter,anthropic' };
const NOT_ARMED = /cannot yet hold a run to one spending cap per provider/;
const CLASS = /a known limit of this version/;
const NOTE = /a real run of this command would be refused/;
const RUN = '2026-11-01T00-00-00-000Z';
const read = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
const MOCK = read(root, 'chains', 'mock.json');
// Mock seats placed in two caps (unit 1's fixture): the builder and the reviser bill anthropic, the critics openrouter.
const TWO_CAPS = read(root, 'test', 'fixtures', 'caps', 'mock-bills-two-caps.json');
// A seat that is not mock carrying mockBills: an external seat (P3: the run-time refusal, which the chain lint pre-empts on every CLI line).
const EXT_BILLS = { ...MOCK, name: 'ext-bills', seats: { ...MOCK.seats, builder: { provider: 'external', model: 'claude-code-session', mockBills: 'openrouter' } } };
// A plain layered run that pauses at an external seat, as B3 does: the shipped mock-layered chain with its builder answered by a session.
const LAYERED = read(root, 'chains', 'mock-layered.json');
const LAYERED_PAUSE = { ...LAYERED, name: 'layered-pause', seats: { ...LAYERED.seats, builder: { provider: 'external', model: 'claude-code-session' } } };

function project(chains = []) {
  const work = mkdtempSync(join(tmpdir(), 'thc-caps-start-'));
  mkdirSync(join(work, 'tasks'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  mkdirSync(join(work, 'chains'));
  for (const c of chains) writeFileSync(join(work, 'chains', `${c.name}.json`), JSON.stringify(c, null, 2));
  const run = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: work, env: { PATH: process.env.PATH, HOME: work, ...extraEnv }, encoding: 'utf8', timeout: 120_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
  };
  return { work, run };
}
const start = (chain, ...extra) => ['--task', 'tasks/x.md', '--chain', chain, '--max-usd', '1', ...extra];
const listing = dir => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : null);
const jsonOf = r => { try { return JSON.parse(r.stdout); } catch { assert.fail(`not one JSON document on stdout:\n${r.out}`); } };
// A tree member's run folder as the sitting leaves it: run.json carries the member's lineage (test/helpers/tree-fixture.js syntheticRun writes the same field).
function memberRun(work) {
  const dir = join(work, 'runs', RUN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'mock', task: join(work, 'tasks', 'x.md'), maxUsd: 1, tree: { treeId: '2026-10-08T11-00-00-000Z', node: 'R/M1', generation: 1 } }));
  return dir;
}
// An advice call's folder (src/stop-files.js isAdviceFolder: advice.meta.json), its chain named in run.json.
function adviceRun(work, chain) {
  const dir = join(work, 'runs', RUN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain }));
  writeFileSync(join(dir, 'advice.meta.json'), JSON.stringify({ schema: 'advice-meta/1', chain }));
  return dir;
}

test('P1: the lines that meet the start refusals instead of the top one: a main start or resume that is no refused class; every other line that may spend keeps the top refusal (fail closed)', () => {
  assert.equal(typeof caps.capsDeferredStart, 'function');
  for (const argv of [['--task', 'tasks/x.md', '--chain', 'mock'], ['--chain', 'mock', '--task', 'tasks/x.md', '--max-usd', '1'], ['--resume', 'runs/x'], ['--resume', 'runs/x', '--max-usd', '2']]) {
    assert.equal(caps.capsDeferredStart(argv), true, argv.join(' '));
  }
  for (const argv of [['--rematch', 'runs/x'], ['--replay', 'runs/x'], ['--advice-adopt', 'runs/x'], ['--task', 'tasks/x.md', '--rematch', 'runs/x'], ['--tree-node', 'n.json', '--task', 'tasks/x.md'],
    ['tree', 'start', '--task', 'tasks/x.md'], ['tree', 'resume', 'x'], ['handoff', '--from-run', 'runs/x'], ['digest', 'runs/x'], ['--chain', 'mock'], ['frobnicate']]) {
    assert.equal(caps.capsDeferredStart(argv), false, argv.join(' '));
  }
});

test('P2: a cap\'s own ceiling, COUNCIL_MAX_USD_LIMIT_<ID>: unset, a plain number of dollars, or unreadable (a placeholder or anything else), the sentence naming the setting', () => {
  assert.equal(typeof caps.readCapCeiling, 'function');
  assert.deepEqual(caps.readCapCeiling('openrouter', {}), { usd: null, unreadable: null });
  assert.deepEqual(caps.readCapCeiling('openrouter', { COUNCIL_MAX_USD_LIMIT_OPENROUTER: '' }), { usd: null, unreadable: null });
  assert.deepEqual(caps.readCapCeiling('openrouter', { COUNCIL_MAX_USD_LIMIT_OPENROUTER: '3.50' }), { usd: 3.5, unreadable: null });
  for (const raw of ['abc', '0', '-1', '1e2', '${user_config.anthropic_ceiling}']) {
    const r = caps.readCapCeiling('anthropic', { COUNCIL_MAX_USD_LIMIT_ANTHROPIC: raw });
    assert.equal(r.usd, null, raw);
    assert.match(r.unreadable ?? '', /^COUNCIL_MAX_USD_LIMIT_ANTHROPIC /, raw);
    assert.equal(r.unreadable.includes(raw), false, `${raw}: the value is never echoed`);
  }
});

test('P3: a chain\'s start refusals, in order: mockBills on a seat that is not mock (whatever the switch says), seats no enabled cap covers (exit 5), option B (a cap in force without its own ceiling while the main limit is set; an unreadable one too); none when the caps cover the chain', () => {
  assert.equal(typeof uncovered.capsStartRefusals, 'function');
  const none = { limitUsd: null, ceilingOf: () => ({ usd: null, unreadable: null }) };
  const codes = list => list.map(r => `${r.code}:${r.exit}`);
  assert.deepEqual(codes(uncovered.capsStartRefusals(EXT_BILLS, [], none)), ['mock_bills_on_real_seat:2'], 'switch off: the mockBills refusal stands');
  assert.deepEqual(uncovered.capsStartRefusals(TWO_CAPS, [], none), [], 'switch off: nothing else');
  const notCovered = uncovered.capsStartRefusals(TWO_CAPS, ['openrouter'], none);
  assert.deepEqual(codes(notCovered), ['uncovered_seats:5']);
  assert.match(notCovered[0].sentence, /anthropic/);
  assert.match(notCovered[0].sentence, /builder, reviser/);
  assert.match(notCovered[0].sentence, /COUNCIL_SPEND_CAPS/);
  const ceilings = map => ({ limitUsd: 5, ceilingOf: id => map[id] ?? { usd: null, unreadable: null } });
  const missing = uncovered.capsStartRefusals(TWO_CAPS, ['anthropic', 'openrouter'], ceilings({ openrouter: { usd: 3, unreadable: null } }));
  assert.deepEqual(codes(missing), ['cap_ceiling_missing:2']);
  assert.match(missing[0].sentence, /COUNCIL_MAX_USD_LIMIT_ANTHROPIC/);
  assert.doesNotMatch(missing[0].sentence, /COUNCIL_MAX_USD_LIMIT_OPENROUTER/);
  const bad = 'COUNCIL_MAX_USD_LIMIT_ANTHROPIC is set but is not a positive number of dollars.';
  const unreadable = uncovered.capsStartRefusals(TWO_CAPS, ['anthropic', 'openrouter'], ceilings({ openrouter: { usd: 3, unreadable: null }, anthropic: { usd: null, unreadable: bad } }));
  assert.deepEqual(codes(unreadable), ['cap_ceiling_unreadable:2']);
  assert.match(unreadable[0].sentence, /COUNCIL_MAX_USD_LIMIT_ANTHROPIC/);
  assert.deepEqual(uncovered.capsStartRefusals(TWO_CAPS, ['anthropic', 'openrouter'], none), [], 'no main limit: option B asks nothing');
  assert.deepEqual(uncovered.capsStartRefusals(TWO_CAPS, ['anthropic', 'openrouter'], ceilings({ openrouter: { usd: 3, unreadable: null }, anthropic: { usd: 2, unreadable: null } })), []);
  assert.deepEqual(uncovered.capsStartRefusals(MOCK, ['anthropic', 'openrouter'], ceilings({})), [], 'seats that bill nothing: no cap in force, nothing to ask');
});


// Each refusal is its own test, so a red run shows each one failing on its own.
const LIMITS = { COUNCIL_MAX_USD_LIMIT: '5', COUNCIL_MAX_USD_LIMIT_OPENROUTER: '3' };

test('C1 SWITCH ON, a real start with seats no enabled cap covers: exit 5, the seats and their roles named, before the not-armed line; nothing is written', () => {
  const { work, run } = project([TWO_CAPS]);
  const r = run(start(TWO_CAPS.name), { COUNCIL_SPEND_CAPS: 'openrouter' });
  assert.equal(r.code, 5, r.out);
  assert.match(r.out, /anthropic/);
  assert.match(r.out, /builder, reviser/);
  assert.doesNotMatch(r.out, NOT_ARMED, 'its own refusal comes before the not-armed one');
  assert.equal(existsSync(join(work, 'runs')), false, 'nothing was written');
});

test('C2 SWITCH ON, option B: COUNCIL_MAX_USD_LIMIT set and a cap in force without its own ceiling (missing, then unreadable) refuses the start, exit 2, naming that setting; nothing is written', () => {
  const { work, run } = project([TWO_CAPS]);
  for (const env of [{ ...BOTH, ...LIMITS }, { ...BOTH, ...LIMITS, COUNCIL_MAX_USD_LIMIT_ANTHROPIC: 'abc' }]) {
    const r = run(start(TWO_CAPS.name), env);
    assert.equal(r.code, 2, `${JSON.stringify(env)}\n${r.out}`);
    assert.match(r.out, /COUNCIL_MAX_USD_LIMIT_ANTHROPIC/, JSON.stringify(env));
    assert.doesNotMatch(r.out, /COUNCIL_MAX_USD_LIMIT_OPENROUTER/, `${JSON.stringify(env)}: only the missing one is named`);
    assert.doesNotMatch(r.out, NOT_ARMED, JSON.stringify(env));
  }
  assert.equal(existsSync(join(work, 'runs')), false, 'nothing was written');
});

test('C3 SWITCH ON, a start the caps cover still meets the not-armed line, until the caps are armed: the two-cap chain (no main limit; every ceiling set) and a plain mock chain; nothing is written', () => {
  const { work, run } = project([TWO_CAPS]);
  for (const [chain, env] of [[TWO_CAPS.name, BOTH], [TWO_CAPS.name, { ...BOTH, ...LIMITS, COUNCIL_MAX_USD_LIMIT_ANTHROPIC: '2' }], ['mock', BOTH]]) {
    const r = run(start(chain), env);
    assert.equal(r.code, 2, `${chain} ${JSON.stringify(env)}\n${r.out}`);
    assert.match(r.out, NOT_ARMED, `${chain} ${JSON.stringify(env)}`);
  }
  assert.equal(existsSync(join(work, 'runs')), false, 'nothing was written');
});

// No CLI test of the mockBills refusal: on every main-path line (a start, a resume, a dry run) the chain lint answers first (src/cli.js exitOnLint, run on resume
// too since the 2026-09-23 audit; chain-lint `invalid-mock-bills`, read on the rerouted roster the run uses), exit 1, whatever the switch says. The run-time
// refusal behind it is pinned where it lives (P3: capsStartRefusals, switch off and on); C1, C2 and C9 drive the list it belongs to through the CLI.

test('C5 SWITCH ON, a plain layered run paused at an external seat (as B3 pauses) resumes into the not-armed line and nothing earlier: the class comes from the run folder, never from the --resume flag; a folder that is no run meets the resume\'s own refusal; nothing is written', () => {
  const { work, run } = project([LAYERED_PAUSE]);
  const paused = run(start(LAYERED_PAUSE.name, '--run-id', RUN));   // switch OFF: the run pauses at the session seat
  assert.equal(paused.code, 3, paused.out);
  const dir = join(work, 'runs', RUN);
  const before = listing(dir);
  const resumed = run(['--resume', `runs/${RUN}`], BOTH);
  assert.equal(resumed.code, 2, resumed.out);
  assert.match(resumed.out, NOT_ARMED);
  assert.doesNotMatch(resumed.out, CLASS, 'a plain run\'s resume is no refused class');
  assert.deepEqual(listing(dir), before, 'the paused run folder is untouched');
  const nothing = run(['--resume', 'runs/no-such-run'], BOTH);   // before 3b the top not-armed refusal answered this line
  assert.equal(nothing.code, 2, nothing.out);
  assert.match(nothing.out, /has no readable run\.json/);
  assert.doesNotMatch(nothing.out, NOT_ARMED);
  assert.deepEqual(readdirSync(join(work, 'runs')), [RUN]);
});

test('C6 SWITCH ON, a tree member\'s run folder (run.json\'s tree lineage) is refused as a tree on --resume: the tree sentence, exit 19 (what the sitting reads as tree_refused); the folder is untouched', () => {
  const { work, run } = project();
  const dir = memberRun(work);
  const before = listing(dir);
  const r = run(['--resume', `runs/${RUN}`], BOTH);
  assert.equal(r.code, 19, r.out);
  assert.match(r.out, /recursive-council tree/);
  assert.match(r.out, CLASS);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.deepEqual(listing(dir), before);
});

test('C7 SWITCH ON, an advice folder on --resume: its chain says resumeAfterStop false, so its own refusal answers (switch or not), exit 2, before any not-armed line; the folder is untouched', () => {
  const { work, run } = project();
  const dir = adviceRun(work, 'mock-advise-single');
  const before = listing(dir);
  const r = run(['--resume', `runs/${RUN}`], BOTH);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /is an advice call, which is not continued/);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.deepEqual(listing(dir), before);
});

test('C8 SWITCH ON, an advice folder whose chain says resumeAfterStop true (the lint refuses that chain; a start does not lint) is still an advice call: the advice sentence, exit 2; the folder is untouched', () => {
  const dirs = mkdtempSync(join(tmpdir(), 'thc-caps-advice-chains-'));
  writeFileSync(join(dirs, 'mock-advise-resumable.json'), JSON.stringify({ ...read(root, 'chains', 'mock-advise-single.json'), name: 'mock-advise-resumable', resumeAfterStop: true }, null, 2));
  const { work, run } = project();
  const dir = adviceRun(work, 'mock-advise-resumable');
  const before = listing(dir);
  const r = run(['--resume', `runs/${RUN}`], { ...BOTH, COUNCIL_ADVICE_CHAINS_DIR: dirs });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /the advice add-on cannot run with a spending cap per provider/);
  assert.doesNotMatch(r.out, NOT_ARMED);
  assert.deepEqual(listing(dir), before);
});

test('C9 a DRY RUN of a start reports its start refusals and calls nothing (Q1b): a text line, and the JSON field startRefusals, absent when there is none; exit 0; nothing is written', () => {
  const { work, run } = project([TWO_CAPS]);
  const text = run(start(TWO_CAPS.name, '--dry-run'), { COUNCIL_SPEND_CAPS: 'openrouter' });
  assert.equal(text.code, 0, text.out);
  assert.match(text.out, /A real start would be refused/);
  assert.match(text.out, /anthropic/);
  for (const [chain, env, want] of [
    [TWO_CAPS.name, { COUNCIL_SPEND_CAPS: 'openrouter' }, ['uncovered_seats:5']],
    [TWO_CAPS.name, { ...BOTH, ...LIMITS }, ['cap_ceiling_missing:2']],
  ]) {
    const r = run(start(chain, '--dry-run', '--json'), env);
    assert.equal(r.code, 0, `${chain} ${JSON.stringify(env)}\n${r.out}`);
    assert.deepEqual((jsonOf(r).startRefusals ?? []).map(x => `${x.code}:${x.exit}`), want, `${chain} ${JSON.stringify(env)}`);
  }
  const clean = run(start('mock', '--dry-run', '--json'));
  assert.equal(clean.code, 0, clean.out);
  assert.equal('startRefusals' in jsonOf(clean), false, 'absent when there is none: a dry run without a refusal prints what it printed before');
  assert.equal(existsSync(join(work, 'runs')), false, 'no dry run wrote anything');
});

test('C10 SWITCH ON, a DRY RUN of a tree member\'s resume prints the note and goes on (Q1b), and its JSON carries the refusal (tree_refused, exit 19); exit 0; the folder is untouched', () => {
  const { work, run } = project();
  const dir = memberRun(work);
  const before = listing(dir);
  const dry = run(['--resume', `runs/${RUN}`, '--dry-run'], BOTH);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, NOTE);
  assert.match(dry.out, /recursive-council tree/);
  const json = run(['--resume', `runs/${RUN}`, '--dry-run', '--json'], BOTH);
  assert.equal(json.code, 0, json.out);
  assert.deepEqual((jsonOf(json).startRefusals ?? []).map(x => `${x.code}:${x.exit}`), ['tree_refused:19']);
  assert.deepEqual(listing(dir), before, 'the member\'s folder is untouched');
});
