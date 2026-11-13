// B3 prep, JUDGE 4b (his word 1 Nov 2026: "handler too"), changed at M1 S19 (c) (copy N23, W38; his 31 Okt words "Handler session or layer-3 have permission to change severity tags"): the handler session changes ONE objection's rating, from the NEXT pass on, as its OWN act. There is no gate and no answer from the
// person: `council retag-add` (src/gate-relay-cli.js) appends the act to retags.jsonl in the run folder (src/handler-retags.js), the next resume applies it at the very top of its pass and records it in report.json (`handler_retags`, `severity.retags` by "handler"). A gate of the removed kind `retag` in an old ledger is named at resume and sets nothing.
// Offline, $0: the real CLI with mock critics, and runChain with a scripted cache.
// M1 (S19): there is no severity switch any more. Ratings are kept on every layered unanimous chain; the rating DEMAND is the held word `ratingDemand` (test/helpers/rating-demand.js). Every CLI child below carries the demand through a preload (test/helpers/rating-demand-preload.js); the in-process runs set it with scenarioWith. The LATER commit that removes the re-tag gate deletes this file except T (rewritten).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as RL from '../src/rulings.js';
import * as G from '../src/gate.js';
const HR = await import('../src/handler-retags.js').catch(() => ({}));   // guarded, so a tree without the module fails the rows that use it and not the whole file (the red-tree method)
import * as R from '../src/roles.js';
import * as SS from '../src/stage-system.js';
import { objectionId, baseObjectionId } from '../src/objection-ids.js';
import { scenario, idOf } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';
import { runThroughChecks, answer } from './helpers/build-check.js';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { reportJsonShape } from '../src/report-shape.js';

afterEach(() => setHeldForTest(null));
// The layered scenario with the rating demand in force (true) or held (false). The held map is set HERE, right before the run, so it holds whatever the shared helper does with its own `severity` option (the option is passed along for a helper that still reads it; the helper must not clear held overrides before the run).
const scenarioWith = (demand, opts) => { setHeldForTest(demand ? DEMAND : NO_DEMAND); return scenario({ ...opts }); };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const d16 = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const gateFolder = () => { const d = join(mkdtempSync(join(tmpdir(), 'b3-rtg-')), 'run-1'); mkdirSync(d); return d; };
const now = () => T0;
const ASK = { pass: 3, id: 'O-4b7ee5be', severity: 2, reason: 'It does not change what is built.' };
const shownSha = (d, id) => G.readGateAnswer(d, id, { now }).gate.sha256;

// CHANGED ACCEPTED (0.8.4 S19 (c)). OLD: 'H1 pure': a re-tag's GATE TEXT round-trips (retagGateText / parseRetagGateText) and anything else is not a re-tag; a re-tag applies at its own pass only. NEW: the gate text is gone; what stays is the second half (a re-tag applies at its own pass only). WHY: the re-tag gate is removed (the handler's re-tag is its own act, FEATURE_SPECS N23/W38). RED BEFORE: none for the kept assertion (green by design); the removed half is covered by the H2 test of the file.
test('H1 pure: a re-tag applies at its own pass only', () => {
  assert.deepEqual(RL.retagsAtPass([{ pass: 2, id: 'a' }, { pass: 3, id: 'b' }, { pass: 3, id: 'c' }], 3).map(r => r.id), ['b', 'c']);
  assert.equal(RL.retagGateText, undefined, 'the gate text is gone');
  assert.equal(G.RETAG_KIND, undefined); assert.equal(G.requestRetag, undefined); assert.equal(G.retagsOf, undefined);
});

// CHANGED ACCEPTED (0.8.4 S19 (c)). OLD: 'H2 gate': a re-tag asked for as a session gate (requestRetag), relayed only with his words, in force from its pass; pending and declined ones are not; invalid and duplicate asks refused; the rulings reader never sees it. NEW: the same tests of the ACT: invalid asks are refused and write nothing, a valid one is appended with its actor and time, one per objection per pass whatever the value, the whitespace of the reason is collapsed, the rulings reader never sees it. WHY: no gate, no relay, no clock: the act is the handler session's own. RED BEFORE (tree before (c)): src/handler-retags.js exists untracked there only through the test's import, so every call fails.
test('H2 file: a re-tag is appended to retags.jsonl by the handler session; invalid and duplicate asks are refused and write nothing; the rulings reader never sees it', () => {
  const d = gateFolder();
  const bad = x => HR.addHandlerRetag(d, { ...ASK, ...x }, { now }).code;
  assert.deepEqual([bad({ severity: 11 }), bad({ id: 'nope' }), bad({ reason: '  ' }), bad({ severity: 2.55 }), bad({ pass: 0 })], Array(5).fill('retag_invalid'));
  assert.equal(existsSync(join(d, HR.RETAGS_FILE)), false, 'a refused ask writes nothing');
  const made = HR.addHandlerRetag(d, ASK, { now });
  assert.deepEqual(made, { ok: true, retag: { pass: 3, id: 'O-4b7ee5be', severity: 2, reason: 'It does not change what is built.', actor: 'handler', at: new Date(T0).toISOString() } });
  assert.equal(HR.addHandlerRetag(d, { ...ASK, severity: 9 }, { now }).code, 'retag_duplicate', 'one per objection per pass, whatever the value');
  assert.equal(HR.addHandlerRetag(d, { ...ASK, id: 'O-aaaaaaaa', reason: '  It does\nnot  change it.  ' }, { now }).retag.reason, 'It does not change it.');
  const got = HR.handlerRetagsOf(d);
  assert.deepEqual([got.ok, got.unreadable, got.retags.map(r => [r.pass, r.id, r.severity, r.actor])], [true, [], [[3, 'O-4b7ee5be', 2, 'handler'], [3, 'O-aaaaaaaa', 2, 'handler']]]);
  assert.equal(readFileSync(join(d, HR.RETAGS_FILE), 'utf8').split('\n').filter(Boolean).length, 2, 'one line per act');
  assert.deepEqual(G.rulingsOf(d, { now }), { ok: true, rulings: [], pending: [], unreadable: [], unreadableInfo: [] }, 'the rulings reader sees nothing');
});

// CHANGED ACCEPTED (0.8.4 S19 (c)). OLD: 'H3 gate': a re-tag the person asked for (no --relayed) cannot be answered by the session; a text changed after the ask is unreadable (listed, never dropped). NEW: a line of retags.jsonl that cannot be read, or a second re-tag of one objection for one pass, is LISTED unreadable (never dropped), and addHandlerRetag refuses to write beside it. WHY: the same promise (a re-tag is never dropped silently) for the new record.
test('H3 file: a line that cannot be read is listed, never dropped, and nothing is written beside it', () => {
  const d = gateFolder();
  assert.equal(HR.addHandlerRetag(d, ASK, { now }).ok, true);
  writeFileSync(join(d, HR.RETAGS_FILE), `${readFileSync(join(d, HR.RETAGS_FILE), 'utf8')}not json\n{"pass":3,"id":"O-4b7ee5be","severity":9,"reason":"again","actor":"handler","at":"2026-11-01T12:00:00.000Z"}\n{"pass":2,"id":"O-1","severity":1,"reason":"x","actor":"person","at":"t"}\n`);
  const got = HR.handlerRetagsOf(d);
  assert.deepEqual(got.unreadable.map(u => u.line), [2, 3, 4]);
  assert.equal(got.retags.length, 1, 'the readable line still reads');
  assert.equal(HR.addHandlerRetag(d, { ...ASK, id: 'O-bbbbbbbb' }, { now }).code, 'retag_file_unreadable');
});

// CHANGED ACCEPTED (0.8.4 S19 (c)). OLD: none (the gate kind `retag` was read by retagsOf). NEW: a ledger that still carries gates of the removed kind (a test fixture, or a folder from a development build; the kind never shipped in 0.8.3) is NOT dropped silently: gatesOfKind(…, 'retag') names each (answered or still waiting), the handler reader applies nothing for them, the generic gate list still shows them and the person can still answer or decline them (the answer sets nothing). WHY: G4 of C&C's answers to the judge-state table: "what a gate-ledger reader does with an entry of the removed kind (test fixtures may carry one); never dropped silently".
test('H4 removed kind: a ledger with an approved and a pending gate of kind `retag` is named by the reader, applies nothing, is still listed and can still be answered or declined', () => {
  const d = gateFolder();
  writeFileSync(join(d, 'retag-3-O-4b7ee5be-aaaaaaaa.md'), 'Re-tag from pass 3\nobjection: O-4b7ee5be\nnew severity: 2\nreason: x\n');
  writeFileSync(join(d, 'retag-4-O-4b7ee5be-bbbbbbbb.md'), 'Re-tag from pass 4\nobjection: O-4b7ee5be\nnew severity: 3\nreason: y\n');
  assert.equal(G.requestGate(d, { kind: 'retag', textPath: 'retag-3-O-4b7ee5be-aaaaaaaa.md', expiresAt: T0 + 3600e3 }, { now }).ok, true);
  assert.equal(G.requestGate(d, { kind: 'retag', textPath: 'retag-4-O-4b7ee5be-bbbbbbbb.md', expiresAt: T0 + 3600e3 }, { now }).ok, true);
  assert.equal(G.answerGate(d, 'g1', { channel: 'cli', shownSha256: shownSha(d, 'g1'), decision: 'approved', actor: 'tester', tty: true }, { now }).ok, true);
  assert.deepEqual(G.gatesOfKind(d, 'retag', { now }), [{ gate: 'g1', status: 'approved' }, { gate: 'g2', status: 'pending' }], 'the reader names each gate of the removed kind');
  assert.deepEqual(G.gatesOfKind(d, 'ruling', { now }), [], 'and only that kind');
  assert.deepEqual(HR.handlerRetagsOf(d).retags, [], 'the removed kind sets nothing');
  assert.deepEqual(G.listGates(d, { now }).map(g => [g.id, g.status]), [['g1', 'approved'], ['g2', 'pending']], 'the generic gate list still shows them');
  assert.equal(G.answerGate(d, 'g2', { channel: 'cli', shownSha256: shownSha(d, 'g2'), decision: 'declined', actor: 'tester', tty: true }, { now }).ok, true, 'and the person can still decline one');
});

// ---- the whole verb through the real CLI ----
const writer = { provider: 'external', model: 'claude-code-session' };
// CHANGED ACCEPTED (0.8.4 S19) for C1-C4 and the C2 cases: OLD: the chain file carried the severity switch key and the CLI children ran with no held override. NEW: no such key (the CLI refuses it at load: severity-switch-removed) and every child starts with test/helpers/rating-demand-preload.js, so the layered chain runs with the rating demand in force. WHY: the switch is removed; ratings are kept on a layered unanimous chain and the demand is a held word, which a child process only has through a preload. RED ON OLD SRC: the old src keeps no ratings without the switch, so retag-add refuses (no severity switch) and C1, C3, C4 and the first two refused() cases fail.
const cliChain = (over = {}) => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, answer_back: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
    { provider: 'mock', model: 'mock-critic-script-x-sev5-j1', lab: 'l1a', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-o-j1b', lab: 'l1b', layer: 1 },
    { provider: 'mock', model: 'mock-critic-script-o-j2', lab: 'l2a', layer: 2 }, { provider: 'mock', model: 'mock-critic-script-o-j2b', lab: 'l2b', layer: 2 },
    { provider: 'mock', model: 'mock-critic-script-o-j3', lab: 'l3a', layer: 3 }, { provider: 'mock', model: 'mock-critic-script-o-j3b', lab: 'l3b', layer: 3 }] }, ...over,
});
const project = chain => {
  const dir = mkdtempSync(join(tmpdir(), 'b3rtag-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(chain)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, ['--import', join(root, 'test', 'helpers', 'rating-demand-preload.js'), join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  // 0.8.4 S4 (C&C's Q-m migration): the same command with the rating demand AND the build-check wording in force; a run that waits at the build check is answered good_to_build by a test-only handler and resumed (test/helpers/build-check.js)
  const runChecked = args => runThroughChecks(a => spawnSync(process.execPath, ['--import', join(root, 'test', 'helpers', 'build-check-preload.js'), join(root, 'src', 'cli.js'), ...a], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } }), args, runDir);
  return { dir, run, runChecked, runDir, answer: (n, t) => writeFileSync(join(runDir(), `${n}.md`), t), files: () => readdirSync(runDir()), done: () => rmSync(dir, { recursive: true, force: true }) };
};
const plan = n => `# Plan v${n}\n\n1. Boil.\n\nAssumptions: tea${'.'.repeat(n)}\n`;
const atRevise1 = p => {
  assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3); p.answer('build', plan(1));
  assert.equal(p.run(['--resume', p.runDir()]).status, 3); assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-1.md')));
  return objectionId('l1a', JSON.parse(readFileSync(join(p.runDir(), 'panel-1-l1a.md'), 'utf8')).failures[0]);
};
const ADD = (p, id, extra = []) => p.run(['retag-add', p.runDir(), '--retag-objection', id, '--retag-severity', '2', '--retag-reason', 'It does not change what is built.', ...extra]);

// CHANGED ACCEPTED (0.8.4 S19 (c)). OLD (C1): retag-add ASKED for a re-tag as gate g1 and the run would not go on while it waited; relay-answer needed his words; pass 2 then applied it; report.json listed owner_retags (gate, channel, person_words), severity.retags with the gate, and `relayed`. NEW: retag-add RECORDS the handler session's own act in retags.jsonl; the run goes on at once; no gate, no relay-answer, no person's words; report.json lists handler_retags (pass, id, severity, reason, actor handler, at) and severity.retags by "handler" with no gate; `--relayed` is refused. WHY: the re-tag gate is removed (N23, W38; his 31 Okt words; C&C's answers G3/G4). RED BEFORE (c): retag-add writes a gate (stdout says "waits for his answer") and the resume holds.
test('C1: the whole verb: retag-add records the handler session\'s own act for the NEXT pass; the run goes on at once (no gate, no answer); pass 2 applies it at its top, layer 1 signs off, and report.json lists the re-tag and the change by "handler"', () => {
  const p = project(cliChain());
  try {
    const id = atRevise1(p);
    p.answer('revise-1', plan(2));
    const relayed = ADD(p, id, ['--relayed']);
    assert.equal(relayed.status, 2); assert.match(relayed.stderr, /retag-add: --relayed does nothing here: a re-tag is the handler session's own act and needs no answer from the person\. Nothing was written\./);
    assert.equal(existsSync(join(p.runDir(), 'retags.jsonl')), false);
    const add = ADD(p, id);
    assert.equal(add.status, 0, add.stdout + add.stderr);
    assert.match(add.stdout, new RegExp(`retag-add: the handler session's re-tag of ${id} to 2 is recorded for pass 2\\. The run applies it at the top of that pass when it goes on \\(council --resume .*\\)\\. It cannot be taken back\\.`));
    assert.equal(existsSync(join(p.runDir(), 'gates')) && readdirSync(join(p.runDir(), 'gates')).length > 0, false, 'no gate was written');
    // CHANGED ACCEPTED (0.8.4 S4, C&C's Q-m migration; OLD/NEW/WHY): OLD: this resume ran to the end and exited 0. NEW: with the build-check wording in force the sign-off is an agreement point, the run waits at build-check-1, a test-only handler answers good_to_build, and the resumed run ends agreed (exit 0, the same). WHY: the handler's build check follows layer 3's sign-off (CA4); every other assertion of the row is unchanged.
    const go = p.runChecked(['--resume', p.runDir()]);
    assert.equal(go.status, 0, go.stdout + go.stderr);
    assert.match(go.stdout, new RegExp(`handler re-tag: ${id} \\(l1a\\) was 5, now 2\\.`));
    const rep = JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
    assert.deepEqual(rep.handler_retags.map(r => ({ pass: r.pass, id: r.id, severity: r.severity, reason: r.reason, actor: r.actor, at: typeof r.at })), [{ pass: 2, id, severity: 2, reason: 'It does not change what is built.', actor: 'handler', at: 'string' }]);
    assert.equal(rep.owner_retags, undefined, 'the old name is gone');
    assert.deepEqual(rep.severity.retags.map(r => [r.id, r.from, r.to, r.applied_to, r.by, r.pass, r.gate]), [[id, 5, 2, 2, 'handler', 2, undefined]]);
    assert.equal(rep.relayed, undefined, 'nothing was relayed: no person was asked');
    assert.equal(rep.layers.find(l => l.round === 2 && l.layer === 1).state, 'signed_off');
  } finally { p.done(); }
});

// CHANGED ACCEPTED (0.8.4 S19 (c)). OLD (C4): the re-tag to 4.5 was asked with --relayed and approved with relay-answer before the resume. NEW: it is recorded by retag-add alone; every assertion after that is the old one. WHY: no gate. RED BEFORE (c): retag-add writes a gate that the first resume refuses (exit 2).
test('C4: a plain resume after the re-tag was recorded replays every stage at $0 and sets nothing aside (the re-tag to 4.5 still holds, so pass 2 pauses at revise-2); the handler\'s own prompt of pass 2 shows the new rating and the pause already on disk is untouched', () => {
  const p = project(cliChain());
  try {
    const id = atRevise1(p);
    p.answer('revise-1', plan(2));
    assert.equal(p.run(['retag-add', p.runDir(), '--retag-objection', id, '--retag-severity', '4.5', '--retag-reason', 'Closer to a settle than a fix.']).status, 0);
    const first = p.run(['--resume', p.runDir()]);
    assert.equal(first.status, 3, first.stdout + first.stderr);
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-2.md')));
    const again = p.run(['--resume', p.runDir()]);
    assert.equal(again.status, 3, again.stdout + again.stderr);
    assert.match(again.stdout, /panel-1-l1a: .* - from disk/);
    assert.match(again.stdout, /panel-2-l1a: .* - from disk/);
    assert.equal(existsSync(join(p.runDir(), 'superseded')), false, 'nothing went stale');
    assert.match(readFileSync(join(p.runDir(), 'NEEDS-revise-2.md'), 'utf8'), /Severity: 4\.5/, 'the handler\'s own prompt for pass 2 shows the rating in force');
    assert.match(readFileSync(join(p.runDir(), 'NEEDS-revise-1.md'), 'utf8'), /Severity: 5\n/, 'the prompt of the pause that was already on disk still shows the rating it was written with');
    assert.doesNotMatch(readFileSync(join(p.runDir(), 'NEEDS-revise-1.md'), 'utf8'), /Severity: 4\.5/);
  } finally { p.done(); }
});

const refused = (name, make, message) => test(`C2: retag-add is refused and writes nothing: ${name}`, () => {
  const { p, id, args } = make();
  try {
    const r = ADD(p, args?.id ?? id, args?.extra ?? []);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    assert.equal(existsSync(join(p.runDir(), 'retags.jsonl')), false, 'no re-tag was written');
    assert.equal(existsSync(join(p.runDir(), 'gates')) && readdirSync(join(p.runDir(), 'gates')).length > 0, false, 'and no gate');
  } finally { p.done(); }
});
// CHANGED ACCEPTED (0.8.4 S19): OLD: a layered chain with the switch key left out. NEW: a chain that keeps no ratings = a unanimous chain whose critics have no layer (overseer keys dropped, maxRounds set), refused at the build pause (retag-add checks the ratings before the pause), with the new message. WHY: on a layered unanimous chain ratings are kept whatever the demand; what a chain without layers lacks is the ledger. (S19 (c): the same three refusals, now asserting that retags.jsonl was not written either.)
const unrated = () => { const base = cliChain(); return cliChain({ maxOverseerRounds: undefined, layerRevisions: undefined, maxRounds: 3, seats: { ...base.seats, critics: base.seats.critics.map(({ layer, ...s }) => s) } }); };
refused('the chain keeps no ratings (no critic has a layer)', () => { const p = project(unrated()); assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3); return { p, id: 'O-aaaaaaaa' }; }, /this run's chain keeps no ratings/);
refused('the run is not at a revise pause', () => { const p = project(cliChain()); assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3); return { p, id: 'O-aaaaaaaa' }; }, /waits for an answer to build|not at a revise pause/);
refused('the objection id is not an id', () => { const p = project(cliChain()); atRevise1(p); p.answer('revise-1', plan(2)); return { p, args: { id: 'nope' } }; }, /a re-tag needs a pass number, an objection id/);

// CHANGED ACCEPTED (0.8.4 S19 (c)). OLD (C3): the relay of a re-tag refused once its pass has a stage on disk; a duplicate ask refused; ruling-withdraw --relayed declined the session's own waiting request; a late relay-answer failed. NEW: a duplicate re-tag (same objection, same pass) is refused; once the pass has a stage on disk retag-add is refused; a line of retags.jsonl that cannot be read stops the resume (exit 2, naming the line); a gate of the removed kind in the ledger is NAMED at the resume and sets nothing. WHY: no gate: there is nothing to relay or withdraw. RED BEFORE (c): the duplicate message and the retags.jsonl refusal do not exist.
test('C3: a duplicate re-tag is refused; a line that cannot be read stops the resume and names the line; a gate of the removed kind is named at the resume and sets nothing; once its pass has a stage on disk retag-add is refused', () => {
  const p = project(cliChain());
  try {
    const id = atRevise1(p); p.answer('revise-1', plan(2));
    assert.equal(ADD(p, id).status, 0);
    const dup = ADD(p, id);
    assert.equal(dup.status, 2); assert.match(dup.stderr, /already recorded for pass 2/);
    const path = join(p.runDir(), 'retags.jsonl');
    const good = readFileSync(path, 'utf8');
    writeFileSync(path, `${good}not json\n`);
    const stopped = p.run(['--resume', p.runDir()]);
    assert.equal(stopped.status, 2, stopped.stdout + stopped.stderr);
    assert.match(stopped.stderr, /retags\.jsonl in this run folder cannot be read \(line 2: it is not a re-tag line\), and a re-tag is never dropped silently\./);
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false, 'nothing ran');
    writeFileSync(path, good);
    writeFileSync(join(p.runDir(), 'retag-9-O-1-cccccccc.md'), 'Re-tag from pass 9\nobjection: O-1\nnew severity: 3\nreason: old\n');
    assert.equal(G.requestGate(p.runDir(), { kind: 'retag', textPath: 'retag-9-O-1-cccccccc.md', expiresAt: Date.now() + 3600e3 }).ok, true);
    // CHANGED ACCEPTED (0.8.4 S4, C&C's Q-m migration; OLD/NEW/WHY): OLD: this resume ran to the end and exited 0. NEW: with the build-check wording in force the sign-off is an agreement point, the run waits at build-check-1, a test-only handler answers good_to_build, and the resumed run ends agreed (exit 0, the same). WHY: the handler's build check follows layer 3's sign-off (CA4); every other assertion of the row is unchanged.
    const go = p.runChecked(['--resume', p.runDir()]);
    assert.equal(go.status, 0, go.stdout + go.stderr);
    assert.match(go.stderr, /Gate g1 in this run's approval record is of the kind "retag", which no longer exists: a re-tag is the handler session's own act now \(council retag-add\), so this gate sets nothing and nothing waits for it\. Going on\./);
    assert.match(go.stdout, new RegExp(`handler re-tag: ${id} \\(l1a\\) was 5, now 2\\.`));
    const late = ADD(p, id);
    assert.equal(late.status, 2); assert.match(late.stderr, /not at a revise pause|already has a stage on disk/);
  } finally { p.done(); }
});

// ---- the chain applies it ----
// CHANGED ACCEPTED (0.8.4 S19): OLD: scenario with its severity option true (the switch in the config). NEW: `scenarioWith(true, ...)` = the same layered scenario with the rating demand injected; the point and every assertion are unchanged. WHY: switch removed. RED ON OLD SRC: the old src keeps no ledger without the switch, so `severityRun` is undefined.
test('R1 run (a stated pass carries the objection): pass 2\'s handler re-tag of a 5 to 2 is applied at the top of the pass; layer 1 then signs off with the objection swept; without the re-tag the same run is stopped at the layer bound; a re-tag of an unknown objection or of one already at that rating applies nothing and is recorded as refused', async () => {
  const mk = (id, severity, extra = {}) => ({ gate: 'g1', pass: 2, id, severity, reason: 'It does not change what is built.', channel: 'session', actor: 'main-session', person_words: 'yes', at: 'x', ...extra });
  const logs = [];
  const done = await scenarioWith(true, { answerBack: true, ladder: false, l1Severity: 5, extra: { maxRounds: 3 }, runExtra: { retags: [mk(idOf(5), 2)], log: m => logs.push(m) } });
  assert.equal(done.result.passed, true);
  assert.deepEqual(done.result.severityRun.retags.map(r => [r.id, r.from, r.to, r.applied_to, r.by, r.pass, r.gate]), [[idOf(5), 5, 2, 2, 'handler', 2, 'g1']]);
  assert.ok(logs.some(l => /handler re-tag: .* was 5, now 2\./.test(l)));
  // CHANGED ACCEPTED TEST (0.8.4, C&C ruling 12 Nov 2026). OLD: without the re-tag the same run is stopped at the layer bound (assert.rejects /layer_bound/). NEW: without the re-tag the run is NOT stopped: with the layer-1 go-up line recorded and the ledger on, the plan goes up at layer 1's bound (src/chain.js layer1BoundGoUp), so the control asserts the recorded fields in which the run differs from the one WITH the re-tag (box job 53, printed): passed false, one escalation row (trigger layer1_bound, pass 9, to layer 2), the objection still open in severityRun.open; WITH the re-tag (above) the run has passed true, no escalation and the objection swept. WHY: the premise of the old control (a layer_bound stop) is gone under the recorded state; the control can still fail (a re-tag that did not apply would make the first run escalate like this one).
  assert.deepEqual((done.result.escalations ?? []).map(e => e.trigger), [], 'with the re-tag: no escalation');
  assert.deepEqual(done.result.severityRun.open.map(o => o.id ?? o), [], 'with the re-tag: the objection is swept, not open');
  const without = await scenarioWith(true, { answerBack: true, ladder: false, l1Severity: 5, extra: { maxRounds: 3 } });
  assert.equal(without.result.passed, false, 'without the re-tag the run does not end agreed');
  assert.deepEqual(without.result.escalations.map(e => [e.trigger, e.to_layer]), [['layer1_bound', 2]], 'without the re-tag the plan goes up at layer 1\'s bound');
  assert.deepEqual(without.result.severityRun.open.map(o => o.id ?? o), [idOf(5)], 'without the re-tag the objection is still open');
  assert.deepEqual(without.result.severityRun.retags, [], 'no re-tag was applied');
  const odd = await scenarioWith(true, { answerBack: true, ladder: false, l1Severity: 5, extra: { maxRounds: 3 }, runExtra: { retags: [mk('O-deadbeef', 2, { gate: 'g2' }), mk(idOf(5), 5, { gate: 'g3' }), mk(idOf(5), 2, { gate: 'g4' })] } });
  assert.deepEqual(odd.result.severityRun.retags.map(r => [r.gate, r.from, r.to]), [['g4', 5, 2]]);
  assert.deepEqual(odd.result.severityRun.retags_refused.map(r => [r.id, r.why, r.by, r.gate]), [['O-deadbeef', 'id_unknown', 'handler', 'g2'], [idOf(5), 'no_change', 'handler', 'g3']]);
});

// CHANGED ACCEPTED (0.8.4 S19): OLD: scenario with its severity option false, a layered chain with no switch: no severity record, log "no severity switch". NEW: the same point on a chain that keeps no ratings, now a chain whose critics have no layer (critics [['la'],['lb'],['lc']], overseer keys neutralised, maxRounds 2): log "keeps no ratings", no severity record. The untested claim "the report still lists the approval" is dropped from the title. WHY: a layered unanimous chain always keeps the record, so the old fixture cannot express "no ratings"; its held case is R2b. RED ON OLD SRC: the old log text says "no severity switch".
test('R2: on a chain that keeps no ratings (no critic has a layer) a handler re-tag changes nothing (it is logged as not applied) and the run carries no severity record', async () => {
  const logs = [];
  const off = await scenarioWith(false, { answerBack: true, ladder: false, l1Severity: 5, critics: [['la'], ['lb'], ['lc']], extra: { maxOverseerRounds: undefined, layerRevisions: undefined, maxRounds: 2 }, runExtra: { retags: [{ gate: 'g1', pass: 2, id: idOf(5), severity: 2, reason: 'r' }], log: m => logs.push(m) } }).catch(e => e);
  assert.ok(logs.some(l => /handler re-tag: 1 for this pass, not applied: this chain keeps no ratings/.test(l)));
  assert.ok(off.result || off.stop, 'the run ended by its own limits, not by a crash');
  assert.equal((off.result ?? off.partial)?.severityRun, undefined, 'a chain that keeps no ratings carries no severity record');
});

// CHANGED ACCEPTED (0.8.4 S19): NEW test beside R2. OLD: none (the old R2 covered only the switch-off log). NEW: on a LAYERED unanimous chain with the rating demand held (NO_DEMAND) nothing is rated (the volunteered tag is dropped), so the handler re-tag finds no objection: the log says it changed nothing and the severity record, which a layered chain always keeps, lists it as refused (id_unknown). WHY: the held path of the re-tag, which replaces the old "switch off" path on a layered chain. RED ON OLD SRC: the old src keeps no record without the switch, so `severityRun` is undefined.
test('R2b: on a layered chain with the rating demand held nothing is rated, so a handler re-tag finds no objection: it changes nothing, the log says so, and the severity record lists it as refused (id_unknown)', async () => {
  const logs = [];
  const off = await scenarioWith(false, { answerBack: true, ladder: false, l1Severity: 5, extra: { maxRounds: 2 }, runExtra: { retags: [{ gate: 'g1', pass: 2, id: idOf(5), severity: 2, reason: 'r' }], log: m => logs.push(m) } }).catch(e => e);
  assert.ok(logs.some(l => /handler re-tag: 1 of 1 for this pass changed nothing/.test(l)));
  // layer 1 keeps objecting (an unrated objection holds and nothing releases it), so the run ends at its layer bound; the stop carries the partial record
  const sev = off instanceof Error ? off.partial?.severityRun : off.result.severityRun;
  assert.ok(sev, 'the severity record exists on a layered unanimous chain even while nothing is rated');
  assert.deepEqual(sev.retags, []);
  assert.deepEqual(sev.retags_refused.map(r => [r.id, r.why, r.by, r.gate]), [[idOf(5), 'id_unknown', 'handler', 'g1']]);
});

// CHANGED ACCEPTED (0.8.4 S19): OLD: cfg carried the switch key; the no-handler case left it out. NEW: cfg says `signoff: 'unanimous'` (the layered critics make it a chain that keeps ratings), the no-ratings cases are `signoff: 'first'` and an unlayered panel, the prompt checks run with the demand injected, and a last block proves the held state tells no judge anything about a rating. WHY: switch removed; severityHandlerPossible reads ratingsRecorded, the prompts read the demand. RED ON OLD SRC: the old severityHandlerPossible needs the switch, so the first `true` assertion fails.
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the two typed handler variants read "It is released only when its raiser withdraws it, or when ...". NEW: "Its hold is released only when its raiser withdraws it, or when ...". WHY: src/prompts/recorded-083.js toldWith (apply f60ebad2).
test('T: the told sentence has four variants, one per way a 4 or above can be released besides the raiser\'s own withdrawal, and "or the handler" is said only where the chain has a reviser the handler session can pause (provider external) and the chain keeps ratings', () => {
  assert.equal(R.severityTold(true, false), R.SEVERITY_TOLD);
  assert.equal(R.severityTold(false, false), R.SEVERITY_TOLD_PLAIN);
  assert.equal(d16(R.SEVERITY_TOLD_HANDLER), d16('An objection rated 4 or above holds up the sign-off, and every rating from 4 up holds it up in the same way; the band only describes the impact. Its hold is released only when its raiser withdraws it, or when the handler (the session that relays the person\'s decisions) lowers its rating below 4. No count of reviewers settles it. An objection rated below 4 does not hold up the sign-off; it is still recorded.'));
  assert.equal(d16(R.SEVERITY_TOLD_BOTH), d16('An objection rated 4 or above holds up the sign-off, and every rating from 4 up holds it up in the same way; the band only describes the impact. Its hold is released only when its raiser withdraws it, or when the top layer or the handler (the session that relays the person\'s decisions) lowers its rating below 4. No count of reviewers settles it. An objection rated below 4 does not hold up the sign-off; it is still recorded.'));
  assert.equal(new Set([R.severityTold(true, true), R.severityTold(true, false), R.severityTold(false, true), R.severityTold(false, false)]).size, 4);
  const cfg = (reviser, over = {}) => ({ signoff: 'unanimous', answer_back: { enabled: true }, seats: { reviser, builder: reviser, critics: [1, 1, 2, 2, 3, 3].map((layer, i) => ({ provider: 'mock', model: 'm', lab: `c${i}`, layer })) }, ...over });
  assert.equal(SS.severityHandlerPossible(cfg({ provider: 'external', model: 'x' })), true);
  assert.equal(SS.severityHandlerPossible(cfg({ provider: 'mock', model: 'x' })), false);
  assert.equal(SS.severityHandlerPossible(cfg({ provider: 'external', model: 'x' }, { signoff: 'first' })), false);   // a chain that keeps no ratings (not unanimous)
  assert.equal(SS.severityHandlerPossible(cfg({ provider: 'external', model: 'x' }, { seats: { reviser: { provider: 'external', model: 'x' }, critics: [{ provider: 'mock', model: 'm', lab: 'c0' }, { provider: 'mock', model: 'm', lab: 'c1' }] } })), false);   // nor is a panel with no layers
  setHeldForTest(DEMAND);   // the rating demand in force: the prompts below carry the told sentence
  const seat = { provider: 'mock', model: 'm', lab: 'c0', layer: 1 };
  const verdict = c => SS.criticPromptFor(seat, false, undefined, c);
  const post = c => SS.layerDebateSystemFor(c, seat, false);
  const both = cfg({ provider: 'external', model: 'x' }); const ledgerOnly = cfg({ provider: 'mock', model: 'x' });
  const handlerOnly = cfg({ provider: 'external', model: 'x' }, { answer_back: undefined });
  for (const f of [verdict, post]) {
    assert.ok(f(both).includes(R.SEVERITY_TOLD_BOTH));
    assert.ok(f(ledgerOnly).includes(R.SEVERITY_TOLD) && !f(ledgerOnly).includes(R.SEVERITY_TOLD_HANDLER) && !f(ledgerOnly).includes(R.SEVERITY_TOLD_BOTH));
    assert.ok(f(handlerOnly).includes(R.SEVERITY_TOLD_HANDLER));
  }
  setHeldForTest(NO_DEMAND);   // held: the chain keeps ratings but no prompt tells a judge about one, in any of the four variants
  for (const f of [verdict, post]) for (const c of [both, ledgerOnly, handlerOnly]) for (const t of [R.SEVERITY_TOLD, R.SEVERITY_TOLD_PLAIN, R.SEVERITY_TOLD_HANDLER, R.SEVERITY_TOLD_BOTH]) assert.ok(!f(c).includes(t));
});

// NEW (0.8.4, Muad 11 Nov 2026: the handling session's lowering below 4 holds, even when the judge answers on the objection again; C&C's one new row for the REOPEN case, probe 22 part B as its red). The C1 chain run in process with l1a fed from the stage cache: pass 1 raises one objection (5); the handler lowers it to 2 at pass 2; at pass 2 l1a writes the SAME failure again, declared `reopens <id>` at 5, with a sustain answer. Muad's rule: the objection keeps its id, the judge's text stays on the record, layer 1 does not hold on it, and nothing mints a #r2. RED BEFORE (0ef1289c, probe 22 part B): the id became <id>#r2 at the seat's own rating 5, pass 2 was refused or held at layer 1. NOT asserted here: probe 21's prompt hash 68c4adc46686 (measured on the other rig, the `continues` mock; the change touches no prompt builder).
test('R-b: the judge declares `reopens` on an objection the handler lowered below 4: it keeps its id (no #r2), is asked once, does not hold layer 1, and its failure text and relation stay on the signoff row', async () => {
  const writerSeat = { provider: 'external', model: 'claude-code-session' };
  const chain = {
    name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, answer_back: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writerSeat, reviser: writerSeat, critics: [
      { provider: 'external', model: 'claude-code-session', lab: 'l1a', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-o-j1b', lab: 'l1b', layer: 1 },
      { provider: 'mock', model: 'mock-critic-script-o-j2', lab: 'l2a', layer: 2 }, { provider: 'mock', model: 'mock-critic-script-o-j2b', lab: 'l2b', layer: 2 },
      { provider: 'mock', model: 'mock-critic-script-o-j3', lab: 'l3a', layer: 3 }, { provider: 'mock', model: 'mock-critic-script-o-j3b', lab: 'l3b', layer: 3 }] },
  };
  const CR2 = 'It states the assumptions it was written under.';
  const FAIL = { criterion: CR2, problem: 'No assumptions section.', fix: 'Add one.', severity: 5 };
  const idX = baseObjectionId('l1a', FAIL);
  const reply = (relation, answers) => JSON.stringify({ meets: false, criteria: [{ criterion: 'The deliverable is the artifact itself, not a plan for one.', verdict: 'MET', evidence: 'ok' }, { criterion: CR2, verdict: 'FAILED', evidence: 'No assumptions section.' }, { criterion: 'It adds no scope the request did not ask for.', verdict: 'MET', evidence: 'ok' }], failures: [{ ...FAIL, relation }], ...(answers ? { answers } : {}), verdict_line: 'no' });
  const texts = { build: plan(1), 'revise-1': plan(2), 'revise-2': plan(3), 'revise-3': plan(4), 'panel-1-l1a': reply('new'), 'panel-2-l1a': reply(`reopens ${idX}`, [{ id: idX, status: 'sustained', evidence: 'Still no assumptions section.' }]) };
  const okReply = JSON.stringify({ meets: true, criteria: [{ criterion: 'The deliverable is the artifact itself, not a plan for one.', verdict: 'MET', evidence: 'ok' }, { criterion: CR2, verdict: 'MET', evidence: 'ok' }, { criterion: 'It adds no scope the request did not ask for.', verdict: 'MET', evidence: 'ok' }], failures: [], verdict_line: 'yes' });
  texts['build-check-1'] = answer('good_to_build', `${idX}: The build can do it.`);   // the build check is in force in process too (its wording is recorded): layer 3's sign-off waits at build-check-1, answered here as a test-only handler
  for (const n of [3, 4, 5]) texts[`panel-${n}-l1a`] = okReply;   // a later ask of the external seat is answered with a sign-off, so a pause there can never hide the assertion below it
  const spied = []; const logs = [];
  try {
    setHeldForTest(DEMAND); setBudget(null); setPromptSpy(p => spied.push({ label: p.label, user: String(p.user ?? '') }));
    setCache({ invalidate() {}, get: label => texts[label] ? { text: texts[label], provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 0 }, usd: 0 } : null });
    const retag = { gate: 'g1', pass: 2, id: idX, severity: 2, reason: 'It does not change what is built.', channel: 'session', actor: 'main-session', person_words: 'yes', at: 'x' };
    let result = null; let end = null;
    try { result = await runChain({ request: 'A plan.', log: l => logs.push(String(l)), runId: 'r-rb', config: chain, retags: [retag] }); } catch (e) { end = String(e?.message ?? e).slice(0, 300); }
    const labels = spied.map(p => p.label);
    const ctx = `end: ${end ?? '(finished)'}; l1a asks: ${labels.filter(l => /-l1a/.test(l)).join(', ')}; log: ${logs.filter(l => /l1a|re-tag|COUNCIL-E004/.test(l)).slice(0, 5).join(' | ')}`;
    assert.deepEqual(labels.filter(l => /^panel-2-l1a/.test(l)), ['panel-2-l1a'], `l1a is asked once at pass 2 (no -reask, no -solo). ${ctx}`);
    assert.equal(spied.some(p => p.user.includes(`${idX}#`)) || logs.some(l => l.includes(`${idX}#`)), false, `no #-suffixed id: the objection keeps its id. ${ctx}`);
    assert.ok(labels.includes('panel-2-l2a'), `layer 1 did not hold pass 2 on the lowered objection (layer 2 was asked at pass 2). ${ctx}`);
    assert.ok(result, `the run finished. ${ctx}`);
    const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-rb', chain: 'lad', task: 't.md', result, config: chain })));
    const rows = (report.signoff || []).filter(r => r.lab === 'l1a');
    assert.ok(rows.length >= 1, 'premise: l1a has a signoff row');
    for (const r of rows) {
      const mine = (r.objections || []).filter(o => o.id === idX);
      assert.equal(mine.length, 1, `exactly one failure row under the old id on each of l1a's signoff rows (${JSON.stringify((r.objections || []).map(o => o.id))})`);
      assert.deepEqual([mine[0].problem, mine[0].relation], ['No assumptions section.', `reopens ${idX}`], 'the judge\'s failure text and its declared relation stay on the record');
      assert.equal((r.objections || []).some(o => String(o.id).startsWith(`${idX}#`)), false, 'no #r2 row');
    }
  } finally { setPromptSpy(null); setHeldForTest(null); setCache(null); setBudget(null); }
});
