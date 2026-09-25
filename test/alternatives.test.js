// test/alternatives.test.js
//
// Whole alternative architectures (2026-09-23, opt-in `alternatives: { enabled: true }`). Muad:
// "have the models argue over whole alternative architectures: I think this is a great idea".
// Before the skeleton, every proposer lab writes ONE whole architecture blind; the labs debate
// them in the anonymised post/reply format; the skeleton and builder get the board and the
// Decisions requirement. All offline, on mock seats. What is pinned here is the plumbing the
// stage must not break: additive output, stable labels for resume, the spend cap, lab identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, ExternalPause, BudgetExceeded, setCache, setBudget } from '../src/chain.js';
import { estimateChainRows } from '../src/cost.js';
import { lintChain } from '../src/chain-lint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const EXTERNAL = { provider: 'external', model: 'claude-code-session' };
const withAlternatives = (extra = {}) => ({ ...chain('mock-debate'), alternatives: { enabled: true }, ...extra });
const withProposers = (config, proposers) => ({ ...config, seats: { ...config.seats, proposers } });
const labels = r => r.stages.map(s => s.label);

async function run(config, { onStage } = {}) {
  return runChain({ config, request: 'A mock task.', log: () => {}, onStage });
}
async function pausedAt(config, opts) {
  try { await run(config, opts); } catch (err) { if (err instanceof ExternalPause) return err; throw err; }
  assert.fail('expected the run to pause at an external seat');
}

test('alternatives: every proposer lab writes one whole architecture, blind, before the skeleton', async () => {
  const r = await run(withAlternatives());
  const a = r.alternatives;
  assert.ok(a, 'the result must carry the alternatives record');
  assert.deepEqual(a.items.map(x => x.lab).sort(), ['mock-a', 'mock-b']);
  assert.deepEqual(a.items.map(x => x.id).sort(), ['MOCKA-ALT', 'MOCKB-ALT']);
  for (const x of a.items) {
    assert.match(x.name, /Architecture from mock-proposer-/);
    assert.ok(x.shape && x.key_tradeoffs && x.bad_at, 'each alternative carries shape, trade-offs and weakness');
  }
  const L = labels(r);
  for (const lab of ['mock-a', 'mock-b']) {
    for (const stage of [`alternative-${lab}`, `alt-debate-${lab}`, `alt-reply-${lab}`]) assert.ok(L.includes(stage), `missing stage ${stage}`);
  }
  // Order: criteria, then the whole alternatives stage, then skeleton and proposals.
  const last = Math.max(...L.map((l, i) => l.startsWith('alt') ? i : -1));
  assert.ok(last < L.indexOf('skeleton'), 'the alternatives stage must finish before the skeleton');
  assert.ok(L.indexOf('criteria') < L.indexOf('alternative-mock-a'));
});

test('alternatives: the debate is between labs - no lab posts on its own, posts map back to real ids', async () => {
  const r = await run(withAlternatives());
  const { items, posts, replies } = r.alternatives;
  assert.ok(posts.length >= 2);
  for (const p of posts) {
    const target = items.find(x => x.id === p.on);
    assert.ok(target, `post names an unknown alternative ${p.on} - the anonymised id was not mapped back`);
    assert.notEqual(target.lab, p.by, 'a lab may not post on its own alternative');
    assert.ok(['support', 'object', 'merge'].includes(p.stance));
  }
  // Each author answered: the mock amends, and the amendment lands on the item.
  assert.equal(replies.length, 2);
  for (const x of items) {
    assert.equal(x.amended, true);
    assert.match(x.shape, /amended/);
  }
  assert.match(r.alternatives.board, /## MOCKA-ALT \(mock-a\) - AMENDED/);
  assert.match(r.alternatives.board, /mock-b - object: Quote: "one service per concern"/);
});

test('alternatives: a withdrawal is recorded, and the board says so', async () => {
  const base = withAlternatives();
  const r = await run(withProposers(base, [
    { provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' },
    { provider: 'mock', model: 'mock-alt-withdraw', lab: 'mock-b' },
  ]));
  const b = r.alternatives.items.find(x => x.lab === 'mock-b');
  assert.equal(b.withdrawn, true);
  assert.match(r.alternatives.board, /## MOCKB-ALT \(mock-b\) - WITHDRAWN by mock-b/);
});

test('alternatives: a lab with nothing readable is retried once, then recorded as a dropout; one survivor skips the debate', async () => {
  const base = withAlternatives();
  const r = await run(withProposers(base, [
    { provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' },
    { provider: 'mock', model: 'mock-alt-empty', lab: 'mock-b' },
  ]));
  const L = labels(r);
  assert.ok(L.includes('alternative-mock-b-retry'), 'the retry goes through invoke() under its own label');
  assert.deepEqual(r.alternatives.dropouts.map(d => d.lab), ['mock-b']);
  assert.equal(r.alternatives.items.length, 1);
  assert.ok(!L.some(l => l.startsWith('alt-debate-')), 'one architecture has nobody to argue with');
  assert.ok(r.alternatives.board, 'a single alternative still reaches the skeleton and builder');
});

test('alternatives: absent, the run is byte-for-byte the old shape - no field, no stage', async () => {
  const r = await run(chain('mock-debate'));
  assert.equal('alternatives' in r, false, 'report.json is a public contract: no new field on chains that do not opt in');
  assert.ok(!labels(r).some(l => l.startsWith('alt')));
  const off = await run({ ...chain('mock-debate'), alternatives: { enabled: false } });
  assert.equal('alternatives' in off, false);
});

test('alternatives: the skeleton is handed the board and told to name the architecture it builds on', async () => {
  const c = withAlternatives();
  const p = await pausedAt({ ...c, seats: { ...c.seats, skeleton: EXTERNAL } });
  assert.equal(p.label, 'skeleton');
  assert.match(p.user, /# Whole alternative architectures, with their debate board/);
  assert.match(p.user, /name the one\(s\) at the top of the skeleton by id/);
  assert.match(p.user, /MOCKA-ALT/);
  assert.match(p.user, /MOCKB-ALT/);
});

test('alternatives: the builder must record every alternative in the "Decisions" section', async () => {
  const c = withAlternatives();
  const p = await pausedAt({ ...c, seats: { ...c.seats, builder: EXTERNAL } });
  assert.equal(p.label, 'build');
  assert.match(p.user, /"Decisions" section must record this as its architecture decision/);
  assert.match(p.user, /Every alternative id below appears in that record/);
  assert.match(p.user, /MOCKA-ALT[\s\S]*MOCKB-ALT/);
  assert.match(p.system, /section titled "Decisions"/, 'alternatives switch decision records on');
  // Without the stage the builder prompt carries no alternatives section at all.
  const q = await pausedAt({ ...chain('mock-debate'), seats: { ...chain('mock-debate').seats, builder: EXTERNAL } });
  assert.ok(!q.user.includes('Whole alternative architectures'));
});

test('alternatives: resume mid-stage - finished siblings replay from disk, the paused lab resumes, the run moves on', async () => {
  const base = withAlternatives();
  const config = withProposers(base, [
    { provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' },
    { provider: 'external', model: 'claude-code-session', lab: 'ext' },
  ]);
  const disk = new Map();
  const onStage = s => disk.set(s.label, { text: s.text, usage: s.usage, usd: s.usd, provider: s.provider, model: s.model });
  try {
    setCache(null);
    const first = await pausedAt(config, { onStage });
    assert.equal(first.label, 'alternative-ext');
    assert.ok(disk.has('alternative-mock-a'), 'the sibling finished and was recorded before the pause (settleAll)');

    // A human answers the paused stage; the reply is written under the same stable label.
    disk.set('alternative-ext', { text: JSON.stringify({ name: 'External architecture', shape: 'a single process', key_tradeoffs: 'simple', bad_at: 'scale' }), usage: { input: 0, output: 0 }, usd: 0 });
    setCache({ get: l => disk.get(l) || null });
    const replayed = [];
    const second = await pausedAt(config, { onStage: s => { if (s.cached) replayed.push(s.label); } });
    assert.ok(replayed.includes('alternative-mock-a'), 'the finished sibling must replay from disk, not be paid for again');
    assert.ok(replayed.includes('alternative-ext'));
    assert.equal(second.label, 'alt-debate-ext', 'the run resumed past the stage it paused in and reached the next one');
    assert.match(second.user, /External architecture/, 'the resumed alternative is in the debate');
  } finally {
    setCache(null);
  }
});

test('alternatives: every call goes through invoke(), so the per-run spend cap stops the stage', async () => {
  const priced = { provider: 'mock', model: 'mock-priced', maxTokens: 8000 };
  const config = {
    name: 'mock-alt-budget', maxRounds: 1, alternatives: { enabled: true },
    estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
    seats: {
      criteria: { ...priced, maxTokens: 100 }, builder: priced, reviser: priced,
      critics: [{ ...priced, lab: 'mock-a' }, { ...priced, lab: 'mock-b' }],
    },
  };
  try {
    setBudget(1);
    await assert.rejects(run(config), err => err instanceof BudgetExceeded && /^alternative-mock-/.test(err.label));
  } finally {
    setBudget(null);
  }
});

test('alternatives: the dry run prices the stage and feeds its board into skeleton and build', () => {
  const base = chain('mock-debate');
  const without = estimateChainRows(base);
  const withAlt = estimateChainRows({ ...base, alternatives: { enabled: true, maxTokens: 2000 } });
  const L = withAlt.map(r => r.label);
  for (const lab of ['mock-a', 'mock-b']) {
    for (const stage of [`alternative-${lab}`, `alt-debate-${lab}`, `alt-reply-${lab}`]) assert.ok(L.includes(stage), `dry run is missing ${stage}`);
  }
  assert.equal(withAlt.find(r => r.label === 'alternative-mock-a').output, 2000, 'output is the stage cap');
  const inOf = (rows, l) => rows.find(r => r.label === l).input;
  assert.ok(inOf(withAlt, 'skeleton') > inOf(without, 'skeleton'));
  assert.ok(inOf(withAlt, 'build') > inOf(without, 'build'));
  assert.equal(without.length + 6, withAlt.length, 'exactly the six new rows, nothing else moves');
});

test('alternatives: a chain that enables the stage still lints clean', () => {
  assert.deepEqual(lintChain(chain('mock-debate')), [], 'precondition: the base chain lints clean');
  assert.deepEqual(lintChain(withAlternatives()), []);
});

test('alternatives: the stage contract knows the new labels, so an external seat gets a real contract', async () => {
  const { stageKindOf, stageKindsFor, buildStageContract, isStructuredStage } = await import('../src/stage-contract.js');
  assert.equal(stageKindOf('alternative-glm5.3'), 'alternative');
  assert.equal(stageKindOf('alternative-glm5.3-retry'), 'alternative');
  assert.equal(stageKindOf('alt-debate-glm5.3'), 'alt-debate');
  assert.equal(stageKindOf('alt-reply-glm5.3'), 'alt-reply');
  assert.equal(stageKindOf('debate-glm5.3'), 'debate', 'the proposal debate keeps its own kind');
  const kinds = stageKindsFor(withAlternatives());
  assert.deepEqual(kinds.slice(kinds.indexOf('criteria'), kinds.indexOf('skeleton')), ['criteria', 'alternative', 'alt-debate', 'alt-reply']);
  assert.ok(!stageKindsFor(chain('mock-debate')).includes('alternative'));
  for (const k of ['alternative', 'alt-debate', 'alt-reply']) {
    assert.ok(isStructuredStage(k));
    assert.ok(buildStageContract(withAlternatives(), k).return_instructions.startsWith('Return JSON'));
  }
});

// ---------------------------------------------------------------------------
// Through the real CLI: report.json's additive `alternatives` field, the BOARD.md section, and a
// resume from a run folder paused in the middle of the stage.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const cli = join(root, 'src', 'cli.js');
function cliDir(config) {
  const dir = mkdtempSync(join(tmpdir(), 'alternatives-cli-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(dir, 'chains', `${config.name}.json`), JSON.stringify(config, null, 2));
  return dir;
}
function cliRun(args, dir) {
  try {
    return { code: 0, out: execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('CLI: report.json gets an additive alternatives field and BOARD.md an "Alternative architectures" section', () => {
  const dir = cliDir({ ...withAlternatives(), name: 'test-alt' });
  const r = cliRun(['--chain', 'test-alt', '--task', 'tasks/x.md'], dir);
  assert.equal(r.code, 0, r.out);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.deepEqual(report.alternatives.items.map(x => x.id).sort(), ['MOCKA-ALT', 'MOCKB-ALT']);
  assert.ok(Array.isArray(report.alternatives.posts) && Array.isArray(report.alternatives.replies) && Array.isArray(report.alternatives.dropouts));
  assert.equal('board' in report.alternatives, false, 'the rendered text lives in BOARD.md; the JSON stays structured');
  assert.ok(report.debate, 'the proposal debate is still there, untouched');
  const board = readFileSync(join(runDir, 'BOARD.md'), 'utf8');
  assert.match(board, /^## Alternative architectures/m);
  assert.match(board, /^## Proposals/m);
  assert.ok(board.indexOf('## Alternative architectures') < board.indexOf('## Proposals'));
  assert.ok(existsSync(join(runDir, 'alternative-mock-a.md')), 'each stage is saved under its stable label');
});

test('CLI: a chain without the stage writes the same report shape and board as before', () => {
  const dir = cliDir({ ...chain('mock-debate'), name: 'test-no-alt' });
  const r = cliRun(['--chain', 'test-no-alt', '--task', 'tasks/x.md'], dir);
  assert.equal(r.code, 0, r.out);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal('alternatives' in report, false);
  const board = readFileSync(join(runDir, 'BOARD.md'), 'utf8');
  assert.ok(!board.includes('## Alternative architectures'));
  assert.ok(!board.includes('## Proposals'), 'no new heading on a board without alternatives');
});

test('CLI: --resume from a run paused mid-stage continues from the paused lab', () => {
  const base = withAlternatives();
  const config = withProposers({ ...base, name: 'test-alt-ext' }, [
    { provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' },
    { provider: 'external', model: 'claude-code-session', lab: 'ext' },
  ]);
  const dir = cliDir(config);
  const first = cliRun(['--chain', 'test-alt-ext', '--task', 'tasks/x.md'], dir);
  assert.equal(first.code, 3, `expected an external pause (exit 3):\n${first.out}`);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  assert.ok(existsSync(join(runDir, 'NEEDS-alternative-ext.md')));
  assert.ok(existsSync(join(runDir, 'alternative-mock-a.md')), 'the finished sibling is on disk before the pause');
  writeFileSync(join(runDir, 'alternative-ext.md'), JSON.stringify({ name: 'External architecture', shape: 'a single process', key_tradeoffs: 'simple', bad_at: 'scale' }));
  const second = cliRun(['--resume', `runs/${id}`], dir);
  assert.equal(second.code, 3, second.out);
  assert.match(second.out, /alternative-mock-a: .*from disk/, 'the finished sibling replays, it is not paid for twice');
  assert.ok(existsSync(join(runDir, 'NEEDS-alt-debate-ext.md')), 'the run moved on to the debate round');
});

// Pre-release audit 2026-09-23 (Alternatives #1, DecisionRecords #1): the stage used a fixed
// 3000-token cap, below these rosters' thinking spend, and retried at the same cap, so a
// reasoning seat's alternative came back cut off twice and was dropped as "unreadable".
test('alternatives: a seat keeps its own maxTokens - no hidden 3000 cap cuts a reasoning seat off', async () => {
  const r = await run(withProposers(withAlternatives(), [
    { provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' },
    { provider: 'mock', model: 'mock-alt-cut-then-fits', lab: 'mock-b', maxTokens: 36000 },
  ]));
  assert.deepEqual(r.alternatives.dropouts, [], 'a seat with a 36k cap must not be cut off at 3000');
  assert.ok(!labels(r).includes('alternative-mock-b-retry'), 'no retry needed at the seat\'s own cap');
});

test('alternatives: a cut-off alternative is retried with a BIGGER cap, not the same one', async () => {
  const r = await run(withProposers(withAlternatives(), [
    { provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' },
    { provider: 'mock', model: 'mock-alt-cut-then-fits', lab: 'mock-b', maxTokens: 2000 },
  ]));
  assert.ok(labels(r).includes('alternative-mock-b-retry'));
  assert.deepEqual(r.alternatives.dropouts, [], 'the bigger-cap retry recovers the architecture');
  assert.equal(r.alternatives.items.length, 2);
});

test('alternatives: a lab still cut off after the retry drops out labelled as truncation, not "unreadable"', async () => {
  const r = await run(withProposers(withAlternatives(), [
    { provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' },
    { provider: 'mock', model: 'mock-alt-cut', lab: 'mock-b', maxTokens: 2000 },
  ]));
  const d = r.alternatives.dropouts.find(x => x.lab === 'mock-b');
  assert.ok(d, 'mock-b drops out');
  assert.equal(d.reason_code, 'REPLY_TRUNCATED', 'same spelling as signoff[] and panelVerdicts[] (brief 03 fix 3)');
  assert.equal(d.reasonCode, 'REPLY_TRUNCATED', 'the old spelling stays as a deprecated alias');
  assert.match(d.reason, /cut off|truncat/);
  assert.doesNotMatch(d.reason, /readable/);
});

test('alternatives: the shipped plan-7 chains set no stage cap (seat caps apply) and stay identical apart from rosters', () => {
  const p = chain('plan-premium-7'), o = chain('plan-open-7');
  assert.equal(p.alternatives.maxTokens, undefined);
  assert.deepEqual(p.alternatives, o.alternatives);
});
