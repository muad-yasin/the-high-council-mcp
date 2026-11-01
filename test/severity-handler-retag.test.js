// B3 prep, JUDGE 4b (his word 1 Nov 2026: "handler too"): the handler session relays the person's change of ONE objection's rating, from a fixed pass on. A gate of kind `retag`, mirrored on `ruling` (src/gate.js, src/gate-relay-cli.js,
// src/rulings.js): asked for at a revise pause (`council retag-add`), answered with his words (`council relay-answer`), applied at the very top of its pass, recorded in report.json (`owner_retags`, `severity.retags` by "handler").
// Offline, $0: the real CLI with mock critics, and runChain with a scripted cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as RL from '../src/rulings.js';
import * as G from '../src/gate.js';
import * as R from '../src/roles.js';
import * as SS from '../src/stage-system.js';
import { objectionId } from '../src/objection-ids.js';
import { scenario, idOf } from './helpers/layer-two-run.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.parse('2026-11-01T12:00:00.000Z');
const d16 = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const gateFolder = () => { const d = join(mkdtempSync(join(tmpdir(), 'b3-rtg-')), 'run-1'); mkdirSync(d); return d; };
const now = () => T0;
const ASK = { pass: 3, id: 'O-4b7ee5be', severity: 2, reason: 'It does not change what is built.', relayed: true };

test('H1 pure: a re-tag\'s gate text round-trips; anything else is not a re-tag; a re-tag applies at its own pass only', () => {
  const body = RL.retagGateText({ pass: 3, id: 'O-4b7ee5be', severity: 2.5, reason: '  It does\nnot change what is built.  ' });
  assert.equal(body, 'Re-tag from pass 3\nobjection: O-4b7ee5be\nnew severity: 2.5\nreason: It does not change what is built.\n');
  assert.deepEqual(RL.parseRetagGateText(Buffer.from(body)), { pass: 3, id: 'O-4b7ee5be', severity: 2.5, reason: 'It does not change what is built.' });
  for (const bad of ['', 'Re-tag from pass 0\nobjection: O-1\nnew severity: 2\nreason: x\n', 'Re-tag from pass 3\nobjection: X-1\nnew severity: 2\nreason: x\n', 'Re-tag from pass 3\nobjection: O-1\nnew severity: 11\nreason: x\n', 'Re-tag from pass 3\nobjection: O-1\nnew severity: 2\nreason: \n', 'Re-tag from pass 3\nobjection: O-1\nnew severity: 2.55\nreason: x\n', 'Re-tag from pass 3\nobjection: O-1\nnew severity: 2\nreason: x']) assert.equal(RL.parseRetagGateText(Buffer.from(bad)), null, JSON.stringify(bad));
  assert.deepEqual(RL.retagsAtPass([{ pass: 2, id: 'a' }, { pass: 3, id: 'b' }, { pass: 3, id: 'c' }], 3).map(r => r.id), ['b', 'c']);
});

test('H2 gate: a re-tag is asked for as a session gate, relayed only with his words, then stays in force from its pass whatever the clock says; pending and declined ones are not; invalid and duplicate asks are refused and write nothing; the rulings reader never sees it', () => {
  const d = gateFolder();
  assert.equal(G.requestRetag(d, { ...ASK, severity: 11 }, { now }).code, 'retag_invalid');
  assert.equal(G.requestRetag(d, { ...ASK, id: 'nope' }, { now }).code, 'retag_invalid');
  assert.equal(G.requestRetag(d, { ...ASK, reason: '  ' }, { now }).code, 'retag_invalid');
  assert.equal(G.requestRetag(d, { ...ASK, severity: 2.55 }, { now }).code, 'retag_invalid');
  const made = G.requestRetag(d, ASK, { now });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(G.requestRetag(d, { ...ASK, severity: 9 }, { now }).code, 'retag_duplicate', 'one per objection per pass, whatever the value');
  assert.deepEqual(G.retagsOf(d, { now }).pending.map(r => [r.gate, r.pass, r.id, r.severity]), [['g1', 3, 'O-4b7ee5be', 2]]);
  assert.deepEqual(G.rulingsOf(d, { now }), { ok: true, rulings: [], pending: [], unreadable: [], unreadableInfo: [] }, 'the rulings reader skips a re-tag gate: it is not parsed as a withdrawal');
  const g = G.readGateAnswer(d, 'g1', { now }).gate;
  assert.equal(g.kind, 'retag');
  assert.equal(G.answerGateAsRelay(d, 'g1', { shownSha256: g.sha256, reason: 'relayed', personWords: '' }, { now }).code, 'person_words_required');
  assert.equal(G.answerGateAsRelay(d, 'g1', { shownSha256: g.sha256, reason: 'relayed', personWords: 'Yes, lower it.' }, { now }).ok, true);
  const later = () => T0 + 5 * 24 * 3600e3;
  const after = G.retagsOf(d, { now: later });
  assert.deepEqual(after.pending, []);
  assert.deepEqual(after.retags.map(r => ({ gate: r.gate, pass: r.pass, id: r.id, severity: r.severity, reason: r.reason, channel: r.channel, actor: r.actor, person_words: r.person_words })), [{ gate: 'g1', pass: 3, id: 'O-4b7ee5be', severity: 2, reason: 'It does not change what is built.', channel: 'session', actor: 'main-session', person_words: 'Yes, lower it.' }]);
  assert.deepEqual(G.relayedAnswersOf(d).map(r => [r.gate, r.kind, r.person_words]), [['g1', 'retag', 'Yes, lower it.']]);
  // the session declines a request it asked for itself, with no words; it is listed as declined
  const d2 = gateFolder(); G.requestRetag(d2, ASK, { now });
  assert.equal(G.declineOwnRequest(d2, 'g1', { reason: 'withdrawn by the handler session' }, { now }).ok, true);
  assert.deepEqual(G.retagsOf(d2, { now }).retags, []);
  assert.deepEqual(G.declinedBySessionOf(d2).map(r => [r.gate, r.kind]), [['g1', 'retag']]);
});

test('H3 gate: a re-tag the person asked for (no --relayed) cannot be answered by the session; a text changed after the ask is unreadable (listed, never dropped)', () => {
  const d = gateFolder();
  assert.equal(G.requestRetag(d, { ...ASK, relayed: false }, { now }).ok, true);
  const g = G.readGateAnswer(d, 'g1', { now }).gate;
  assert.equal(G.answerGateAsRelay(d, 'g1', { shownSha256: g.sha256, reason: 'relayed', personWords: 'Yes' }, { now }).ok, false);
  const d2 = gateFolder(); G.requestRetag(d2, ASK, { now });
  const file = readdirSync(d2).find(f => /^retag-/.test(f));
  writeFileSync(join(d2, file), 'Re-tag from pass 3\nobjection: O-4b7ee5be\nnew severity: 1\nreason: tampered\n');
  const st = G.retagsOf(d2, { now });
  assert.deepEqual(st.unreadable, ['g1']);
  assert.deepEqual(st.retags, []);
});

// ---- the whole verb through the real CLI ----
const writer = { provider: 'external', model: 'claude-code-session' };
const cliChain = (over = {}) => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, severity: { enabled: true }, answer_back: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
    { provider: 'mock', model: 'mock-critic-script-x-sev5-j1', lab: 'l1a', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-o-j1b', lab: 'l1b', layer: 1 },
    { provider: 'mock', model: 'mock-critic-script-o-j2', lab: 'l2a', layer: 2 }, { provider: 'mock', model: 'mock-critic-script-o-j2b', lab: 'l2b', layer: 2 },
    { provider: 'mock', model: 'mock-critic-script-o-j3', lab: 'l3a', layer: 3 }, { provider: 'mock', model: 'mock-critic-script-o-j3b', lab: 'l3b', layer: 3 }] }, ...over,
});
const project = chain => {
  const dir = mkdtempSync(join(tmpdir(), 'b3rtag-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(chain)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir, answer: (n, t) => writeFileSync(join(runDir(), `${n}.md`), t), files: () => readdirSync(runDir()), done: () => rmSync(dir, { recursive: true, force: true }) };
};
const plan = n => `# Plan v${n}\n\n1. Boil.\n\nAssumptions: tea${'.'.repeat(n)}\n`;
const atRevise1 = p => {
  assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3); p.answer('build', plan(1));
  assert.equal(p.run(['--resume', p.runDir()]).status, 3); assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-1.md')));
  return objectionId('l1a', JSON.parse(readFileSync(join(p.runDir(), 'panel-1-l1a.md'), 'utf8')).failures[0]);
};
const ADD = (p, id, extra = []) => p.run(['retag-add', p.runDir(), '--retag-objection', id, '--retag-severity', '2', '--retag-reason', 'It does not change what is built.', ...extra]);

test('C1: the whole verb: retag-add asks for a re-tag for the NEXT pass; the run will not go on while it waits; the relay needs his words; pass 2 applies it at its top, layer 1 signs off, and report.json lists the re-tag, the relay and the change by "handler"', () => {
  const p = project(cliChain());
  try {
    const id = atRevise1(p);
    p.answer('revise-1', plan(2));
    const add = ADD(p, id, ['--relayed']);
    assert.equal(add.status, 0, add.stdout + add.stderr);
    assert.match(add.stdout, new RegExp(`retag-add: a re-tag of ${id} to 2 for pass 2 waits for his answer as gate g1\\. The run will not go on until it is answered or has expired\\.`));
    assert.match(add.stdout, /council relay-answer .* g1 --person-words "<his answer, as he typed it in this window>"/);
    const held = p.run(['--resume', p.runDir()]);
    assert.equal(held.status, 2);
    assert.match(held.stderr, new RegExp(`A re-tag of ${id} for pass 2 waits for the person's answer \\(gate g1\\): the pass would run without it`));
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false);
    const none = p.run(['relay-answer', p.runDir(), 'g1']);
    assert.equal(none.status, 1); assert.match(none.stderr, /None were given\. Nothing was recorded\./);
    const ok = p.run(['relay-answer', p.runDir(), 'g1', '--person-words', 'Yes, lower it.']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const go = p.run(['--resume', p.runDir()]);
    assert.equal(go.status, 0, go.stdout + go.stderr);
    assert.match(go.stdout, new RegExp(`handler re-tag: ${id} \\(l1a\\) was 5, now 2\\.`));
    const rep = JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
    assert.deepEqual(rep.owner_retags.map(r => ({ gate: r.gate, pass: r.pass, id: r.id, severity: r.severity, channel: r.channel, person_words: r.person_words })), [{ gate: 'g1', pass: 2, id, severity: 2, channel: 'session', person_words: 'Yes, lower it.' }]);
    assert.deepEqual(rep.severity.retags.map(r => [r.id, r.from, r.to, r.applied_to, r.by, r.pass, r.gate]), [[id, 5, 2, 2, 'handler', 2, 'g1']]);
    assert.deepEqual(rep.relayed.map(r => [r.gate, r.kind, r.person_words]), [['g1', 'retag', 'Yes, lower it.']]);
    assert.equal(rep.layers.find(l => l.round === 2 && l.layer === 1).state, 'signed_off');
  } finally { p.done(); }
});

test('C4: a plain resume after the re-tag was approved replays every stage at $0 and sets nothing aside (the re-tag to 4.5 still holds, so pass 2 pauses at revise-2); the handler\'s own prompt of pass 2 shows the new rating and the pause already on disk is untouched', () => {
  const p = project(cliChain());
  try {
    const id = atRevise1(p);
    p.answer('revise-1', plan(2));
    assert.equal(p.run(['retag-add', p.runDir(), '--retag-objection', id, '--retag-severity', '4.5', '--retag-reason', 'Closer to a settle than a fix.', '--relayed']).status, 0);
    assert.equal(p.run(['relay-answer', p.runDir(), 'g1', '--person-words', 'ok']).status, 0);
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
    const r = ADD(p, args?.id ?? id, args?.extra ?? ['--relayed']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    assert.equal(existsSync(join(p.runDir(), 'gates')) && readdirSync(join(p.runDir(), 'gates')).length > 0, false, 'no gate was written');
  } finally { p.done(); }
});
refused('the chain has no severity switch', () => { const p = project(cliChain({ severity: undefined })); const id = atRevise1(p); return { p, id }; }, /this run's chain has no severity switch/);
refused('the run is not at a revise pause', () => { const p = project(cliChain()); assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md']).status, 3); return { p, id: 'O-aaaaaaaa' }; }, /waits for an answer to build|not at a revise pause/);
refused('the objection id is not an id', () => { const p = project(cliChain()); atRevise1(p); p.answer('revise-1', plan(2)); return { p, args: { id: 'nope' } }; }, /a re-tag needs a pass number, an objection id/);

test('C3: the relay of a re-tag is refused once its pass has a stage on disk; a duplicate ask is refused; the session declines its own waiting request with ruling-withdraw', () => {
  const p = project(cliChain());
  try {
    const id = atRevise1(p); p.answer('revise-1', plan(2));
    assert.equal(ADD(p, id, ['--relayed']).status, 0);
    const dup = ADD(p, id, ['--relayed']);
    assert.equal(dup.status, 2); assert.match(dup.stderr, /already recorded or waiting for pass 2/);
    const dec = p.run(['ruling-withdraw', p.runDir(), 'g1', '--relayed']);
    assert.equal(dec.status, 0, dec.stdout + dec.stderr);
    assert.match(dec.stdout, /gate g1 is declined/);
    assert.notEqual(p.run(['--resume', p.runDir()]).status, 2, 'a declined re-tag holds nothing back');
    const late = p.run(['relay-answer', p.runDir(), 'g1', '--person-words', 'yes']);
    assert.notEqual(late.status, 0);
  } finally { p.done(); }
});

// ---- the chain applies it ----
test('R1 run (a stated pass carries the objection): pass 2\'s handler re-tag of a 5 to 2 is applied at the top of the pass; layer 1 then signs off with the objection swept; without the re-tag the same run is stopped at the layer bound; a re-tag of an unknown objection or of one already at that rating applies nothing and is recorded as refused', async () => {
  const mk = (id, severity, extra = {}) => ({ gate: 'g1', pass: 2, id, severity, reason: 'It does not change what is built.', channel: 'session', actor: 'main-session', person_words: 'yes', at: 'x', ...extra });
  const logs = [];
  const done = await scenario({ severity: true, answerBack: true, ladder: false, l1Severity: 5, extra: { maxRounds: 3 }, runExtra: { retags: [mk(idOf(5), 2)], log: m => logs.push(m) } });
  assert.equal(done.result.passed, true);
  assert.deepEqual(done.result.severityRun.retags.map(r => [r.id, r.from, r.to, r.applied_to, r.by, r.pass, r.gate]), [[idOf(5), 5, 2, 2, 'handler', 2, 'g1']]);
  assert.ok(logs.some(l => /handler re-tag: .* was 5, now 2\./.test(l)));
  await assert.rejects(() => scenario({ severity: true, answerBack: true, ladder: false, l1Severity: 5, extra: { maxRounds: 3 } }), /layer_bound/);
  const odd = await scenario({ severity: true, answerBack: true, ladder: false, l1Severity: 5, extra: { maxRounds: 3 }, runExtra: { retags: [mk('O-deadbeef', 2, { gate: 'g2' }), mk(idOf(5), 5, { gate: 'g3' }), mk(idOf(5), 2, { gate: 'g4' })] } });
  assert.deepEqual(odd.result.severityRun.retags.map(r => [r.gate, r.from, r.to]), [['g4', 5, 2]]);
  assert.deepEqual(odd.result.severityRun.retags_refused.map(r => [r.id, r.why, r.by, r.gate]), [['O-deadbeef', 'id_unknown', 'handler', 'g2'], [idOf(5), 'no_change', 'handler', 'g3']]);
});

test('R2: with the severity switch off a handler re-tag changes nothing (it is logged as not applied) and the report still lists the approval', async () => {
  const logs = [];
  const off = await scenario({ severity: false, answerBack: true, ladder: false, l1Severity: 5, extra: { maxRounds: 2 }, runExtra: { retags: [{ gate: 'g1', pass: 2, id: idOf(5), severity: 2, reason: 'r' }], log: m => logs.push(m) } }).catch(e => e);
  assert.ok(logs.some(l => /handler re-tag: 1 for this pass, not applied: this chain has no severity switch\./.test(l)));
  assert.equal(off.result?.severityRun, undefined);
});

test('T: the told sentence has four variants, one per way a 4 or above can be released besides the raiser\'s own withdrawal, and "or the handler" is said only where the chain has a reviser the handler session can pause (provider external) and the severity switch', () => {
  assert.equal(R.severityTold(true, false), R.SEVERITY_TOLD);
  assert.equal(R.severityTold(false, false), R.SEVERITY_TOLD_PLAIN);
  assert.equal(d16(R.SEVERITY_TOLD_HANDLER), d16('An objection rated 4 or above holds up the sign-off, and every rating from 4 up holds it up in the same way; the band only describes the impact. It is released only when its raiser withdraws it, or when the handler (the session that relays the person\'s decisions) lowers its rating below 4. No count of reviewers settles it. An objection rated below 4 does not hold up the sign-off; it is still recorded.'));
  assert.equal(d16(R.SEVERITY_TOLD_BOTH), d16('An objection rated 4 or above holds up the sign-off, and every rating from 4 up holds it up in the same way; the band only describes the impact. It is released only when its raiser withdraws it, or when the top layer or the handler (the session that relays the person\'s decisions) lowers its rating below 4. No count of reviewers settles it. An objection rated below 4 does not hold up the sign-off; it is still recorded.'));
  assert.equal(new Set([R.severityTold(true, true), R.severityTold(true, false), R.severityTold(false, true), R.severityTold(false, false)]).size, 4);
  const cfg = (reviser, over = {}) => ({ severity: { enabled: true }, answer_back: { enabled: true }, seats: { reviser, builder: reviser, critics: [1, 1, 2, 2, 3, 3].map((layer, i) => ({ provider: 'mock', model: 'm', lab: `c${i}`, layer })) }, ...over });
  assert.equal(SS.severityHandlerPossible(cfg({ provider: 'external', model: 'x' })), true);
  assert.equal(SS.severityHandlerPossible(cfg({ provider: 'mock', model: 'x' })), false);
  assert.equal(SS.severityHandlerPossible(cfg({ provider: 'external', model: 'x' }, { severity: undefined })), false);
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
});
