// B3-only run controls, part (d), fix-ups after the review (31 Okt 2026): the dispute prompts carry the rulings, the way out of a ruling (decline a request the session asked for; withdraw an approved ruling from the next pass, the record keeping
// both), the decimal comma, and no stray text file. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulingsInForce, withdrawalGateText, parseWithdrawalGateText } from '../src/rulings.js';
import { requestRuling, requestWithdrawal, rulingsOf, answerGateAsRelay, answerGate, readGateAnswer, declineOwnRequest, figuresIn } from '../src/gate.js';
import { runChain, setPromptSpy, setCache } from '../src/chain.js';
import { promptHashOf } from '../src/cache-integrity.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.parse('2026-10-30T12:00:00.000Z');
const folder = () => { const d = join(mkdtempSync(join(tmpdir(), 'b3-fix-')), 'run-1'); mkdirSync(d); return d; };
const now = () => T0;
const MARK = /# Rulings by the person who owns this request/;

// ---- D1, D2: the dispute prompts ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B3's chain has `dispute.enabled`, so the reviser reads disputeUser at the end of a run that stops with open objections; the raising seats read disputeReviewUser only when `dispute.review` is on (it is NOT on in B3's chain).
const chain = suffix => ({
  name: 'rulfix', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 2 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, dispute: { enabled: true, stall_rounds: 2, review: true },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [{ provider: 'mock', model: `mock-critic-script-xxxxxx-df1${suffix}`, lab: 'l1', layer: 1 }, { provider: 'mock', model: `mock-critic-script-xo-df2${suffix}`, lab: 'l2', layer: 2 }, { provider: 'mock', model: `mock-critic-script-o-df3${suffix}`, lab: 'l3', layer: 3 }] },
});
async function promptsOf(rulings, suffix) {
  const seen = new Map();
  setCache(null);
  setPromptSpy(p => { seen.set(p.label, { user: p.user, hash: promptHashOf(p.system, p.user) }); });
  try { await runChain({ request: 'Plan a tea.', config: chain(suffix), rulings, log: () => {} }); } finally { setPromptSpy(null); }
  return seen;
}
const RULING = { gate: 'g1', pass: 2, text: 'Replace E5 by the amended R19.', channel: 'session', actor: 'main-session', person_words: 'Yes, that is what I want.', at: '2026-10-30T12:00:00.000Z' };

test('D1: the reviser\'s dispute prompt carries the rulings in force at the last pass that ran; a ruling dated after that pass (none can be) and no ruling leave it byte for byte what it was', async () => {
  const none = await promptsOf([], 'a');
  const withIt = await promptsOf([RULING], 'b');
  const late = await promptsOf([{ ...RULING, pass: 9 }], 'c');
  assert.ok(none.has('dispute'), `the run did not reach the dispute stage: ${[...none.keys()]}`);
  assert.match(withIt.get('dispute').user, MARK, 'the dispute prompt carries the ruling');
  assert.doesNotMatch(none.get('dispute').user, MARK);
  const same = x => x.replace(/df([123])[a-z]/g, 'df$1_');   // the scripted judges carry the run's suffix in their model names, which the objections they raise repeat
  assert.equal(same(late.get('dispute').user), same(none.get('dispute').user), 'a ruling for a pass that never ran changes nothing (a guard: no red)');
});

test('D2: the raising seats\' dispute-review prompt carries the rulings too (wired although B3\'s chain does not turn the review on: not reached in B3)', async () => {
  const none = await promptsOf([], 'd');
  const withIt = await promptsOf([RULING], 'e');
  assert.ok(none.has('dispute-review-l1'), `no dispute review ran: ${[...none.keys()]}`);
  assert.match(withIt.get('dispute-review-l1').user, MARK);
  assert.doesNotMatch(none.get('dispute-review-l1').user, MARK);
});

// ---- W3: a withdrawal takes effect from its pass --------------------------------------------------------------------------------------------------------------------------------------------------------------
test('W3: a ruling withdrawn from pass 3 is carried by the prompts of pass 2 and by none from pass 3 on; every prompt before pass 2 is untouched; the helper is pure', async () => {
  const w = { ...RULING, withdrawn: { gate: 'g2', from_pass: 3 } };
  assert.deepEqual([1, 2, 3, 4].map(r => rulingsInForce([w], r).length), [0, 1, 0, 0]);
  assert.deepEqual([1, 2, 3].map(r => rulingsInForce([RULING], r).length), [0, 1, 1]);
  const none = await promptsOf([], 'f');
  const kept = await promptsOf([RULING], 'g');
  const out = await promptsOf([w], 'h');
  const pass = l => Number((/^(?:panel|revise|ldebate|lreply|rule)-(\d+)/.exec(l) || [])[1]);
  const labels = [...none.keys()].filter(l => /^(panel|revise)-/.test(l));
  assert.ok(labels.some(l => pass(l) === 2) && labels.some(l => pass(l) >= 3), `the run did not reach pass 3: ${labels}`);
  for (const l of labels) {
    if (pass(l) === 2) assert.match(out.get(l).user, MARK, `${l} (before the withdrawal) still carries the ruling`);
    else if (pass(l) >= 3) { assert.doesNotMatch(out.get(l).user, MARK, `${l} (from the withdrawal on) does not`); assert.match(kept.get(l).user, MARK); }
    else assert.equal(out.get(l).hash, none.get(l).hash, `${l} is byte for byte what it was`);
  }
  assert.equal(parseWithdrawalGateText(withdrawalGateText('g1', 3)).pass, 3);
  assert.equal(parseWithdrawalGateText('Withdraw ruling g1 from pass 3 and more\n'), null);
});

// ---- the library: the way out ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('W1: the session declines a ruling and a withdrawal it asked for (no person words, only its reason); the ruling it declines is no ruling; a cap raise is not its to decline here', () => {
  const d = folder();
  requestRuling(d, { pass: 2, text: 'Use black tea.', relayed: true }, { now });
  assert.deepEqual(rulingsOf(d, { now }).pending.map(r => [r.gate, r.kind, r.pass]), [['g1', 'ruling', 2]]);
  const res = declineOwnRequest(d, 'g1', { reason: 'withdrawn by the session' }, { now });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(readGateAnswer(d, 'g1', { now }).status, 'declined');
  const after = rulingsOf(d, { now });
  assert.deepEqual([after.rulings.length, after.pending.length, after.unreadable.length], [0, 0, 0]);
  assert.equal(declineOwnRequest(d, 'g1', { reason: 'again' }, { now }).code, 'gate_not_pending');
});

test('W2: a gate a person asked for is declined only by the person; at a terminal the person\'s own decline (library, channel cli) clears it', () => {
  const d = folder();
  requestRuling(d, { pass: 2, text: 'Use black tea.' }, { now });   // no relay: asked as the person's gate
  const refused = declineOwnRequest(d, 'g1', { reason: 'mine' }, { now });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'gate_not_session_requested');
  assert.equal(rulingsOf(d, { now }).pending.length, 1, 'nothing was recorded');
  const g = readGateAnswer(d, 'g1', { now }).gate;
  assert.equal(answerGate(d, 'g1', { channel: 'cli', shownSha256: g.sha256, decision: 'declined', actor: 'person', tty: true }, { now }).ok, true);
  assert.equal(rulingsOf(d, { now }).pending.length, 0);
});

test('W7: an approved ruling is withdrawn through a gate of its own kind: the ruling stays in the record with the withdrawal beside it; only an approved ruling can be withdrawn, once', () => {
  const d = folder();
  requestRuling(d, { pass: 2, text: 'Use black tea.', relayed: true }, { now });
  assert.equal(requestWithdrawal(d, { gate: 'g1', pass: 3, relayed: true }, { now }).code, 'withdrawal_not_a_ruling', 'a waiting ruling is declined, not withdrawn');
  const g1 = readGateAnswer(d, 'g1', { now }).gate;
  assert.equal(answerGateAsRelay(d, 'g1', { shownSha256: g1.sha256, reason: 'x', personWords: 'yes, black tea' }, { now }).ok, true);
  assert.equal(requestWithdrawal(d, { gate: 'g9', pass: 3, relayed: true }, { now }).code, 'withdrawal_not_a_ruling');
  const asked = requestWithdrawal(d, { gate: 'g1', pass: 3, relayed: true }, { now });
  assert.equal(asked.ok, true, JSON.stringify(asked));
  assert.equal(requestWithdrawal(d, { gate: 'g1', pass: 3, relayed: true }, { now }).code, 'withdrawal_duplicate');
  assert.deepEqual(rulingsOf(d, { now }).pending.map(r => [r.gate, r.kind, r.target, r.pass]), [['g2', 'ruling_withdrawal', 'g1', 3]]);
  const g2 = readGateAnswer(d, 'g2', { now }).gate;
  assert.equal(g2.kind, 'ruling_withdrawal');
  assert.equal(answerGateAsRelay(d, 'g2', { shownSha256: g2.sha256, reason: 'x', personWords: '' }, { now }).code, 'person_words_required');
  assert.equal(answerGateAsRelay(d, 'g2', { shownSha256: g2.sha256, reason: 'x', personWords: 'yes, drop it' }, { now }).ok, true);
  const after = rulingsOf(d, { now });
  assert.deepEqual([after.pending.length, after.unreadable.length], [0, 0]);
  assert.equal(after.rulings.length, 1, 'the ruling is still in the record');
  assert.deepEqual({ gate: after.rulings[0].gate, text: after.rulings[0].text, from: after.rulings[0].withdrawn.from_pass, by: after.rulings[0].withdrawn.gate, words: after.rulings[0].withdrawn.person_words }, { gate: 'g1', text: 'Use black tea.', from: 3, by: 'g2', words: 'yes, drop it' });
  assert.equal(requestWithdrawal(d, { gate: 'g1', pass: 3, relayed: true }, { now }).code, 'withdrawal_duplicate', 'already withdrawn');
});

// ---- F1, S1 -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
test('F1: the figures in his words: a thousand-grouped number is read as such; a number with a decimal comma yields no figure (it would read as 1250); the dot stays a decimal point', () => {
  assert.deepEqual(figuresIn('Raise it to $1,000.'), [1000]);
  assert.deepEqual(figuresIn('12,345,678.5 is too much'), [12345678.5]);
  assert.deepEqual(figuresIn('Yes, 12,50 dollars'), [], 'no figure is read from 12,50: neither 12.5, nor 1250, nor 12 and 50');
  assert.deepEqual(figuresIn('1,5 and 1,0000 and 1.000,50 and 1.000.000'), [], 'every ambiguous token yields nothing, not even a part of it');
  assert.deepEqual(figuresIn('make it 12.5, or 30'), [12.5, 30]);
});

test('S1: a ruling request that requestGate refuses leaves no text file behind', () => {
  const d = folder();
  let t = T0;
  const stepping = () => { t += 3 * 24 * 3600e3; return t; };   // the expiry it computes is already past when requestGate reads the clock again
  const res = requestRuling(d, { pass: 2, text: 'Use black tea.', relayed: true }, { now: stepping });
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.deepEqual(readdirSync(d).filter(f => f.startsWith('ruling-')), []);
});

// ---- the verbs, through the real CLI -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const writer = { provider: 'external', model: 'claude-code-session' };
const cliChain = l3 => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
    { provider: 'mock', model: 'mock-critic-script-x-w1', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-x-w2', lab: 'l2', layer: 2 }, { provider: 'mock', model: `mock-critic-script-${l3}-w3`, lab: 'l3', layer: 3 }] },
});
const project = (l3 = 'x') => {
  const dir = mkdtempSync(join(tmpdir(), 'b3fix-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(cliChain(l3)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir, answer: (n, t) => writeFileSync(join(runDir(), `${n}.md`), t), files: () => readdirSync(runDir()), done: () => rmSync(dir, { recursive: true, force: true }) };
};
const plan = n => `# Plan v${n}\n\n1. Boil.\n\nAssumptions: tea${'.'.repeat(n)}\n`;
const atRevise1 = p => { assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']).status, 3); p.answer('build', plan(1)); assert.equal(p.run(['--resume', p.runDir()]).status, 3); assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-1.md'))); };
const ruleAt2 = p => { atRevise1(p); p.answer('revise-1', plan(2)); assert.equal(p.run(['ruling-add', p.runDir(), '--ruling', 'Use black tea.', '--relayed']).status, 0); };

test('W4: a resume refused for a waiting ruling or withdrawal names the way out (both commands); the run goes on once the session has declined its own request', () => {
  const p = project();
  try {
    ruleAt2(p);
    const held = p.run(['--resume', p.runDir()]);
    assert.equal(held.status, 2);
    assert.match(held.stderr, /A ruling for pass 2 waits for his answer \(gate g1\)/);
    assert.match(held.stderr, new RegExp(`council ruling-withdraw ${p.runDir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} g1 --relayed`));
    assert.match(held.stderr, /council gate answer .* g1 --decline/);
    assert.match(held.stderr, /Nothing was run and nothing was spent\./);
    const bare = p.run(['ruling-withdraw', p.runDir(), 'g1']);   // not relayed: only the terminal command is printed
    assert.equal(bare.status, 2); assert.match(bare.stderr, /council gate answer .* g1 --decline/);
    assert.equal(readGateAnswer(p.runDir(), 'g1').status, 'pending', 'nothing was written');
    const out = p.run(['ruling-withdraw', p.runDir(), 'g1', '--relayed']);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /ruling-withdraw: gate g1 is declined; it set no ruling and the run can go on\./);
    const go = p.run(['--resume', p.runDir()]);
    assert.equal(go.status, 3, go.stdout + go.stderr);
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-2.md')));
    assert.doesNotMatch(readFileSync(join(p.runDir(), 'NEEDS-revise-2.md'), 'utf8'), MARK, 'a declined ruling is no ruling');
  } finally { p.done(); }
});

test('W5: the whole withdrawal through the CLI: pass 2 carries the ruling; withdrawn from pass 3 (his words relayed) the pass-3 prompt does not, pass 2\'s stages replay at $0 unchanged, and report.json keeps the ruling with its withdrawal', () => {
  const p = project('o');
  try {
    ruleAt2(p);
    assert.equal(p.run(['relay-answer', p.runDir(), 'g1', '--person-words', 'Yes, black tea.']).status, 0);
    const first = p.run(['--resume', p.runDir()]);
    assert.equal(first.status, 3, first.stdout + first.stderr);
    const need2 = readFileSync(join(p.runDir(), 'NEEDS-revise-2.md'), 'utf8');
    assert.match(need2, MARK);
    p.answer('revise-2', plan(3));
    const ask = p.run(['ruling-withdraw', p.runDir(), 'g1', '--relayed']);
    assert.equal(ask.status, 0, ask.stdout + ask.stderr);
    assert.match(ask.stdout, /the withdrawal of ruling g1 from pass 3 waits for his answer as gate g2\./);
    const waits = p.run(['--resume', p.runDir()]);
    assert.equal(waits.status, 2);
    assert.match(waits.stderr, /The withdrawal of ruling g1 from pass 3 waits for his answer \(gate g2\)/);
    const dup = p.run(['ruling-withdraw', p.runDir(), 'g1', '--relayed']);
    assert.equal(dup.status, 2); assert.match(dup.stderr, /already withdrawn, or a withdrawal of it is waiting/);
    const none = p.run(['relay-answer', p.runDir(), 'g2']);
    assert.equal(none.status, 1);
    const ok = p.run(['relay-answer', p.runDir(), 'g2', '--person-words', 'Drop the black tea ruling.']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const go = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(go.status, 22, go.stdout + go.stderr);
    assert.match(go.stdout, /panel-2-l1: .* - from disk/, 'pass 2 replays: it was asked with the ruling and still is');
    assert.equal(existsSync(join(p.runDir(), 'superseded')), false);
    assert.equal(readFileSync(join(p.runDir(), 'NEEDS-revise-2.md'), 'utf8'), need2, 'the prompt of the pass that carried the ruling is untouched');
    const rep = JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
    assert.equal(rep.owner_rulings.length, 1, 'the withdrawal is not a ruling row');
    assert.deepEqual({ gate: rep.owner_rulings[0].gate, pass: rep.owner_rulings[0].pass, text: rep.owner_rulings[0].text, from: rep.owner_rulings[0].withdrawn.from_pass, by: rep.owner_rulings[0].withdrawn.gate, words: rep.owner_rulings[0].withdrawn.person_words }, { gate: 'g1', pass: 2, text: 'Use black tea.', from: 3, by: 'g2', words: 'Drop the black tea ruling.' });
    assert.deepEqual(rep.relayed.map(r => [r.gate, r.kind]), [['g1', 'ruling'], ['g2', 'ruling_withdrawal']]);
  } finally { p.done(); }
});

test('W6: ruling-withdraw is refused and writes nothing: a gate that is not a ruling, a pass with a stage on disk, a pause not answered yet; and the relay of a withdrawal is refused once its pass has a stage', () => {
  const p = project();
  try {
    ruleAt2(p);
    assert.equal(p.run(['relay-answer', p.runDir(), 'g1', '--person-words', 'ok']).status, 0);
    const pending = p.run(['ruling-withdraw', p.runDir(), 'g9', '--relayed']);
    assert.equal(pending.status, 2); assert.match(pending.stderr, /ruling-withdraw: this run has no gate g9\. Nothing was written\./);
    assert.equal(p.run(['--resume', p.runDir()]).status, 3);
    const unanswered = p.run(['ruling-withdraw', p.runDir(), 'g1', '--relayed']);
    assert.equal(unanswered.status, 2); assert.match(unanswered.stderr, /ruling-withdraw: the run waits for an answer to revise-2; give that first\. Nothing was written\./);
    p.answer('revise-2', plan(3));
    writeFileSync(join(p.runDir(), 'panel-3-l1.md'), 'x');
    const staged = p.run(['ruling-withdraw', p.runDir(), 'g1', '--relayed']);
    assert.equal(staged.status, 2); assert.match(staged.stderr, /ruling-withdraw: pass 3 already has a stage on disk \(panel-3-l1\.md\), so a withdrawal from it would change what that stage was asked\. Nothing was written\./);
    assert.equal(readFileSync(join(p.runDir(), 'gate-ledger.jsonl'), 'utf8').split('\n').filter(l => l.includes('gate_requested')).length, 1, 'only the ruling was ever asked for');
    rmSync(join(p.runDir(), 'panel-3-l1.md'));
    assert.equal(p.run(['ruling-withdraw', p.runDir(), 'g1', '--relayed']).status, 0);
    writeFileSync(join(p.runDir(), 'ldebate-3-l1.md'), 'x');
    const late = p.run(['relay-answer', p.runDir(), 'g2', '--person-words', 'yes']);
    assert.equal(late.status, 1);
    assert.match(late.stderr, /pass 3 already has a stage on disk \(ldebate-3-l1\.md\), so a withdrawal for it would change what that stage was asked\. Nothing was recorded\./);
  } finally { p.done(); }
});

test('W8: an approved ruling whose text file was changed is refused at resume with the file and the sha256 the gate was approved for named; restoring exactly those bytes lets the run go on', () => {
  const p = project();
  try {
    ruleAt2(p);
    assert.equal(p.run(['relay-answer', p.runDir(), 'g1', '--person-words', 'ok']).status, 0);
    const file = readdirSync(p.runDir()).find(f => /^ruling-2-/.test(f));
    const sha = JSON.parse(readFileSync(join(p.runDir(), 'gates', 'g1.json'), 'utf8')).sha256;
    const original = readFileSync(join(p.runDir(), file), 'utf8');
    writeFileSync(join(p.runDir(), file), original.replace('black', 'green'));
    const r = p.run(['--resume', p.runDir()]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`Its text file ${file.replace(/\./g, '\\.')} must hold exactly the bytes the gate was asked for \\(sha256 ${sha}\\)`));
    assert.match(r.stderr, /Nothing was run and nothing was spent\./);
    writeFileSync(join(p.runDir(), file), original);   // restoring exactly those bytes is the way out
    assert.equal(p.run(['--resume', p.runDir()]).status, 3);
  } finally { p.done(); }
});

test('X1: a request the session declined itself is findable in report.json (declined_requests), not in relayed[] (it carries no words of the person) and not in owner_rulings (it set nothing)', () => {
  const p = project('o');
  try {
    ruleAt2(p);
    assert.equal(p.run(['ruling-withdraw', p.runDir(), 'g1', '--relayed']).status, 0);
    const go = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(go.status, 22, go.stdout + go.stderr);
    const rep = JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
    assert.deepEqual(rep.declined_requests.map(r => [r.gate, r.kind, r.actor]), [['g1', 'ruling', 'main-session']]);
    assert.match(rep.declined_requests[0].reason, /withdrawn by the handler session, which asked for it/);
    assert.equal(rep.relayed, undefined);
    assert.equal(rep.owner_rulings, undefined);
  } finally { p.done(); }
});

// ---- D3: the conflict decider ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// In B3 the decider is the handler's own session: its prompt is written to NEEDS-conflict-N.md before NEEDS-revise-N of the same pass. A fixture with a mock decider seat shows the same prompt through the spy.
const CRITERION = 'The plan defines a retry limit.';
const fail = (quote, problem) => ({ criterion: CRITERION, problem, quote });
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const X = fail('retries failed requests', 'No limit on retries.');
const Y = fail('The worker', 'No owner is named.');
const SWING = { 'panel-1-la': objects(X), 'panel-2-la': meets(), 'panel-2-lb': objects(Y), 'panel-3-la': objects(X), 'panel-4-la': meets(), 'panel-4-lb': meets(), 'panel-4-lc': meets() };   // pass 3: la raises X AGAIN (the swing)
async function conflictPrompt(rulings) {
  const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p.user); });
  setCache({ invalidate() {}, get(label) {
    const text = label in SWING ? SWING[label] : label === 'conflict-3' ? JSON.stringify({ rulings: [{ conflict: 1, prevail: 'neither', reason: 'ok', ask_person: false }] }) : label.startsWith('revise-') ? `The worker retries failed requests.\n\nRevision ${label.slice(7)}.` : 'The worker retries failed requests.';
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-decider', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 2 }, seats: { builder, reviser: builder, critics: [seat('la', 1), seat('lb', 2), seat('lc', 3)], decider: { provider: 'mock', model: 'mock-decider', lab: 'dec' } } };
  try { await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-d3', log: () => {}, config, rulings }); } finally { setPromptSpy(null); setCache(null); }
  return prompts;
}
test('D3: the conflict decider\'s prompt carries the rulings in force at its pass, after the plan and the conflicts; a ruling dated at a later pass leaves it byte for byte what it was', async () => {
  const none = await conflictPrompt([]);
  const withIt = await conflictPrompt([{ ...RULING, pass: 2 }]);
  const later = await conflictPrompt([{ ...RULING, pass: 4 }]);
  assert.ok(none.has('conflict-3'), `the swing did not reach the decider: ${[...none.keys()]}`);
  assert.match(withIt.get('conflict-3'), MARK, 'the decider reads the ruling');
  assert.ok(withIt.get('conflict-3').indexOf('# The conflicts') < withIt.get('conflict-3').indexOf('# Rulings by the person'), 'after the plan and the conflicts');
  assert.equal(later.get('conflict-3'), none.get('conflict-3'), 'a ruling for a later pass changes nothing (a guard: no red)');
});
