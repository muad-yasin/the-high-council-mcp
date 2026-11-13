// 0.8.4 cache part (b)1, the cache-shaped prompt order of a judge call (src/cache-order.js): rows 1-4, 10 and 12 of the pass walk, through the real run on a mock chain with the prompt spy. Offline, $0.
// WHEN IT IS LIVE: the chain's prompt_cache switch is on AND the lead-in (held name judgeKindLeadIn) is recorded (here: installed through setHeldForTest from test/held-prompts/held-084-cache-order.js) AND the seat is not a session seat.
// WHAT IT DOES: a judge's system text is the Council welcome (and the seat's persona block); the first user block H is the same for every call of the seat in one pass; the instructions that used to be the system text stand under H
// (and under the excerpt block, when there is one) behind the lead-in. Not live: every byte as before. No import of the new module at load time (a dynamic import below), so a tree without it still loads this file.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy, criticPromptFor, setRepairPauses, ExternalPause } from '../src/chain.js';
import { makeStageCache, writeSideStage } from '../src/stage-cache.js';
import { setAsideOriginal } from '../src/near-json.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHeldForTest } from '../src/held-roles.js';
import * as R from '../src/roles.js';
import * as HC from './held-prompts/held-084-cache-order.js';
import * as HA from './held-prompts/held-084-a.js';
import * as HD from './held-prompts/held-084-d27.js';
import * as FR from './helpers/final-read-chain.js';
import * as H from './held-prompts/held.js';
import { readChainFile } from './helpers/chain-file.js';
import { buildExcerptEntry } from '../src/excerpt-record.js';

const Order = await import('../src/cache-order.js').catch(() => ({}));
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); setRepairPauses(false); });

const LEAD = { ...HC };   // the whole batch of the order, as the apply will record it
const UNRECORDED = Object.fromEntries(Object.keys(HC).map(n => [n, undefined]));   // hides the batch whether or not src/roles.js records it
const LEAD_ONLY = { ...UNRECORDED, judgeKindLeadIn: HC.judgeKindLeadIn };   // the lead-ins recorded, the rewordings not   // hides the name whether or not src/roles.js records it (it will, at the release apply)
const SEATS = ['j1a', 'j1b', 'j2', 'j3'];
// a three-layer mock chain with the layer-1 exchange (two judges that contest and support), so panel, post and answer calls all exist
const exchangeChain = (extra = {}) => FR.chainOf([
  FR.critic('mock-exch-contest-keep', 'j1a', 1), FR.critic('mock-exch-support-withdraw', 'j1b', 1),
  FR.critic('mock-exch-support-keep', 'j2', 2), FR.critic('mock-exch-support-keep', 'j3', 3),
], { maxRounds: 2, answer_back: { enabled: true }, ...extra });
async function go(config, { held = null, excerpts = null } = {}) {
  setHeldForTest(held);
  const spied = [];
  setPromptSpy(p => spied.push(p));
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-cache-order', config, ...(excerpts ? { excerpts } : {}) });
  setPromptSpy(null); setHeldForTest(null);
  return { r, spied };
}
const judgeCalls = spied => spied.filter(p => /^(panel|ldebate|lreply|critique)-/.test(p.label));
const finalReads = spied => spied.filter(p => p.label.startsWith('final-read-'));
const seatOf = label => SEATS.find(s => new RegExp(`-${s}(-|$)`).test(label));
const passOf = label => /^(?:panel|ldebate|lreply|critique)-(\d+)-/.exec(label)?.[1];
const kindOf = label => (label.startsWith('ldebate-') ? 'post' : label.startsWith('lreply-') ? 'answer' : 'panel');
const WELCOME = R.COUNCIL_INTRO;
// The draft boundary (bade9744: where the chain's prompt_cache is on, the plan's start and end lines are always sent, whatever the order's state): the sentence and the start line in front of the draft and the end line behind the head,
// read from src/roles.js as the tip sends them. `stripBoundary` takes those two pieces out of a call's user text, once each, when BOTH are there; every other call and every other byte stays, so any further difference still fails.
const BOUNDARY_HEAD = () => `${R.draftBoundarySentence()}\n\n${R.draftStartLine()}\n\n`;
const BOUNDARY_TAIL = () => `\n\n${R.DRAFT_END_MARKER}`;
const stripBoundary = spied => {
  // Where the boundary words are not exported (a tree before they were recorded) nothing is stripped and nothing is carried: the presence assert of the row then fails at its target message, instead of the helper throwing before the row reaches it.
  if (typeof R.draftBoundarySentence !== 'function' || typeof R.draftStartLine !== 'function' || typeof R.DRAFT_END_MARKER !== 'string') return { calls: spied.map(({ label, system, user }) => ({ label, system, user })), carried: 0 };
  let carried = 0;
  const calls = spied.map(({ label, system, user }) => {
    const h = BOUNDARY_HEAD(), t = BOUNDARY_TAIL();
    if (user.split(h).length - 1 === 1 && user.split(t).length - 1 === 1) { carried++; return { label, system, user: user.replace(h, '').replace(t, '') }; }
    return { label, system, user };
  });
  return { calls, carried };
};
const BOUNDARY_CALLS = 6;   // the calls of exchangeChain() that carry the boundary pieces, as printed: the six panel calls (panel-1-j1a, panel-1-j1b, panel-2-j1a, panel-2-j1b, panel-2-j2, panel-2-j3) of 13 calls; the other 7 (criteria, build, the exchange calls, revise) are byte-identical to the switch-off run

// CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, row R10). OLD: the cache-on run with the lead-in unrecorded sent exactly the switch-off bytes. NEW: it sends the switch-off bytes plus exactly the draft boundary's two pieces (the sentence and start line in front of the draft, the end line behind the head) in the 6 panel calls of the run; no other byte differs. WHY: bade9744 sends the boundary whenever caching is on, and dc60423a recorded the boundary's words (draftBoundarySentence, draftStartLine), so the boundary needs no lead-in; the order itself stays off here (every system text is equal).
test('NOT LIVE, byte for byte: the switch on with the lead-in unrecorded sends what the switch-off chain sends plus the draft boundary, and the lead-in recorded with the switch off sends exactly what the switch-off chain sends (system and user of every call)', async () => {
  const bytes = spied => spied.map(({ label, system, user }) => ({ label, system, user }));
  const off = await go(exchangeChain(), { held: UNRECORDED });
  assert.deepEqual(bytes((await go(exchangeChain(), { held: UNRECORDED })).spied), bytes(off.spied), 'premise: two runs of the same chain send the same prompts (else the rows below compare noise)');
  const onUnrecorded = await go(exchangeChain({ prompt_cache: { enabled: true } }), { held: UNRECORDED });
  const offRecorded = await go(exchangeChain(), { held: LEAD });
  assert.equal(onUnrecorded.spied.length, off.spied.length, 'premise: the same calls were made (switch on, unrecorded)');
  assert.equal(offRecorded.spied.length, off.spied.length, 'premise: the same calls were made (switch off, recorded)');
  assert.ok(judgeCalls(off.spied).some(p => p.label.startsWith('ldebate-')) && judgeCalls(off.spied).some(p => p.label.startsWith('lreply-')), 'premise: the exchange ran');
  const stripped = stripBoundary(onUnrecorded.spied);
  assert.equal(stripped.carried, BOUNDARY_CALLS, 'the switch on, the lead-in unrecorded: the draft boundary is sent in the panel calls (the target: it is absent where its words are not recorded)');
  assert.deepEqual(stripped.calls, bytes(off.spied), 'the switch on, the lead-in unrecorded: the switch-off bytes plus exactly the draft boundary');
  assert.deepEqual(bytes(offRecorded.spied), bytes(off.spied), 'the lead-in recorded, the switch off');
});

test('R1: with the order live a seat sends ONE system text in every call kind, round, pass and re-ask: the Council welcome and nothing else', async () => {
  const { spied } = await go(exchangeChain({ prompt_cache: { enabled: true } }), { held: LEAD });
  const calls = judgeCalls(spied);
  for (const kind of ['panel', 'post', 'answer']) assert.ok(calls.some(p => kindOf(p.label) === kind), `premise: a ${kind} call was made`);
  assert.ok(calls.some(p => /-x[2-9]-/.test(p.label)), 'premise: the exchange ran past round 1');
  const seen = [...new Set(calls.map(p => seatOf(p.label)))];
  assert.ok(seen.length >= 2 && !seen.includes(undefined), `premise: calls of at least two known seats (${seen})`);
  for (const seat of seen) {
    const systems = new Set(calls.filter(p => seatOf(p.label) === seat).map(p => p.system));
    assert.deepEqual([...systems], [WELCOME], `${seat}: one system text, the welcome`);
  }
});

test('FINAL READ: it gets the order too (the welcome, its head, the panel lead-in) and carries no marker field of its own', async () => {
  const { spied } = await go(FR.neverHeardChain('co', { prompt_cache: { enabled: true } }), { held: LEAD });
  const fr = finalReads(spied);
  assert.ok(fr.length >= 2, `premise: the final read was asked (${fr.map(p => p.label)})`);
  for (const p of fr) {
    assert.equal(p.system, WELCOME, `${p.label}: the welcome alone`);
    assert.equal(typeof p.cacheHead, 'string', `${p.label}: names its head`);
    assert.ok(p.user.startsWith(`${p.cacheHead}\n\n${HC.judgeKindLeadIn({ kind: 'panel' })}\n\n`), `${p.label}: head, then the panel lead-in`);
    assert.ok(!('cacheTtl' in p), `${p.label}: no mark (this change marks nothing)`);
  }
});

test('R2/R4: every judge call of one seat in one pass starts with the SAME first user block H (the spy names it as the call\'s head), and the lead-in of its kind follows H', async () => {
  const { spied } = await go(exchangeChain({ prompt_cache: { enabled: true } }), { held: LEAD });
  const calls = judgeCalls(spied);
  const groups = new Map();
  for (const p of calls) groups.set(`${seatOf(p.label)}|${passOf(p.label)}`, [...(groups.get(`${seatOf(p.label)}|${passOf(p.label)}`) ?? []), p]);
  assert.ok([...groups.values()].some(g => new Set(g.map(p => kindOf(p.label))).size === 3), 'premise: a group holds the panel, the post and the answer');
  for (const [key, group] of groups) {
    assert.deepEqual(group.filter(p => typeof p.cacheHead !== 'string' || p.cacheHead === '').map(p => p.label), [], `${key}: every call names its head`);
    assert.equal(new Set(group.map(p => p.cacheHead)).size, 1, `${key}: one head for every call of the group`);
    for (const p of group) {
      assert.ok(p.user.startsWith(p.cacheHead), `${p.label}: the head is the start of the prompt`);
      assert.ok(p.user.startsWith(`${p.cacheHead}\n\n${HC.judgeKindLeadIn({ kind: kindOf(p.label) })}\n\n`), `${p.label}: the lead-in of its kind follows the head`);
    }
  }
});

test('MOVED, NOT REWRITTEN: for every judge call the instructions the switch-off run sent as the system text are, word for word, in the user text right behind the lead-in, and the system text is the welcome', async () => {
  const off = await go(exchangeChain());
  const on = await go(exchangeChain({ prompt_cache: { enabled: true } }), { held: LEAD });
  const offBy = new Map(judgeCalls(off.spied).map(p => [p.label, p]));
  const onCalls = judgeCalls(on.spied);
  assert.ok(new Set(onCalls.map(p => kindOf(p.label))).size === 3, 'premise: panel, post and answer calls were made');
  assert.deepEqual(onCalls.filter(p => !offBy.has(p.label)).map(p => p.label), [], 'premise: the same judge calls were made');
  for (const p of onCalls) {
    const old = offBy.get(p.label);
    assert.ok(old.system.startsWith(`${WELCOME}\n\n`), `${p.label}: premise: the old system text opened with the welcome`);
    const instructions = old.system.slice(WELCOME.length + 2);
    assert.equal(p.system, WELCOME, `${p.label}: the system text is the welcome`);
    assert.ok(p.user.includes(`${HC.judgeKindLeadIn({ kind: kindOf(p.label) })}\n\n${instructions}`), `${p.label}: the old instructions stand right behind the lead-in`);
  }
});

test('R3: the excerpt block stands directly under H and above the lead-in, never above the plan', async () => {
  const entry = buildExcerptEntry(1, {
    request_kind: 'session_read', requested_by: null, objection_id: null, why: 'To write the answer.', source_kind: 'repository_file', path: 'src/f1.js', lines: '1-2', text: 'EXCERPT-1-line one\nEXCERPT-1-line two',
    file_sha256: null, edited: false, pasted_by: null, advisor: null, advisor_said: null, answered_stage: 'panel-1-j1a', scans: { key_shape: 'clear', personal_data: 'not_scanned' },
    approval: { status: 'not_required', actor: null, channel: null, at: '2026-11-09T05:00:00.000Z', reason: null },
  });
  const { spied } = await go(exchangeChain({ prompt_cache: { enabled: true } }), { held: { ...LEAD, excerptsBlock: HA.excerptsBlock }, excerpts: [entry] });
  const shown = judgeCalls(spied).filter(p => p.user.includes('EXCERPT-1-line one'));
  assert.ok(shown.length > 0, 'premise: later judge calls carry the excerpt block');
  const groups = new Map();
  for (const p of shown) groups.set(`${seatOf(p.label)}|${passOf(p.label)}`, [...(groups.get(`${seatOf(p.label)}|${passOf(p.label)}`) ?? []), p]);
  const several = [...groups.values()].filter(g => new Set(g.map(p => kindOf(p.label))).size >= 2);
  assert.ok(several.length > 0, 'premise: a seat made calls of two kinds in one pass after the block was recorded');
  for (const g of several) {
    const through = p => p.user.slice(0, p.user.indexOf('EXCERPT-1-line two') + 'EXCERPT-1-line two'.length);
    assert.equal(new Set(g.map(through)).size, 1, `${g[0].label}: the bytes from the start of the user text through the excerpt block are equal across the kinds of one seat in one pass`);
  }
  for (const p of shown) {
    assert.equal(typeof p.cacheHead, 'string', `${p.label}: names its head`);
    const at = p.user.indexOf('EXCERPT-1-line one');
    assert.ok(at >= p.cacheHead.length, `${p.label}: the block is below the head`);
    assert.ok(at < p.user.indexOf('# Instructions for this call'), `${p.label}: the block is above the lead-in`);
    assert.ok(p.user.startsWith(p.cacheHead), `${p.label}: the head is still the start`);
  }
});

test('H is the verdict prompts\' head in every kind: with the draft boundary and the criteria checks on, the exchange posts carry the boundary lines and the checks block exactly as the panel does (the answer site builds its head from the same variable)', async () => {
  const config = exchangeChain({ prompt_cache: { enabled: true }, draft_end_marker: { enabled: true }, criteria_kinds: { enabled: true } });
  config.seats.criteria = { provider: 'mock', model: 'mock-criteria' };
  const { spied } = await go(config, { held: { ...LEAD, draftStartLine: HD.draftStartLine, draftBoundarySentence: HD.draftBoundarySentence } });
  const calls = judgeCalls(spied);
  const panel = calls.find(p => p.label.startsWith('panel-1-j1b'));
  assert.equal(typeof panel?.cacheHead, 'string', 'premise: the panel call names its head');
  assert.ok(panel.cacheHead.includes(HC.draftEndLineNeutral()) && panel.cacheHead.includes('# How the checkable criteria are settled') && panel.cacheHead.includes(HD.draftStartLine()), 'premise: the panel head carries the boundary (kind-neutral lines) and the checks block');
  assert.ok(panel.cacheHead.includes(`# Draft under review\n\n${HC.draftBoundarySentenceNeutral()}\n\n${HD.draftStartLine()}`), 'the neutral sentence stands under the heading, in front of the start line');
  assert.ok(!panel.cacheHead.includes('you grade'), 'no "you grade" in H: a post or an answer grades no draft');
  const posts = calls.filter(q => q.label.startsWith('ldebate-1'));
  assert.ok(posts.length >= 2, 'premise: the layer-1 judges posted');
  for (const p of posts) assert.equal(p.cacheHead, panel.cacheHead, `${p.label}: the exchange head is the panel's head`);
});

test('the first-mode critic gets the order too (kind panel); its round is a group of its own', async () => {
  const config = FR.chainOf([FR.critic('mock-critic-a', 'j1a', undefined), FR.critic('mock-critic-bare-met', 'j1b', undefined)], { signoff: 'first', maxRounds: 2, prompt_cache: { enabled: true } });
  for (const c of config.seats.critics) delete c.layer;
  const { spied } = await go(config, { held: LEAD });
  const crit = spied.filter(p => p.label.startsWith('critique-'));
  assert.ok(crit.length > 0, 'premise: the first-mode critic was asked');
  for (const p of crit) {
    assert.equal(p.system, WELCOME, `${p.label}: the welcome alone`);
    assert.ok(p.user.startsWith(`${p.cacheHead}\n\n${HC.judgeKindLeadIn({ kind: 'panel' })}\n\n`), `${p.label}: head, then the panel lead-in`);
  }
});

test('PERSONA: the seat\'s persona block is written once, at the end of the welcome, the same in every call kind; the user text carries none', async () => {
  const persona = 'Aristotle';
  const config = exchangeChain({ prompt_cache: { enabled: true }, seat_personas: { enabled: true, form: 'voice' } });
  config.seats.critics[1].persona = persona;   // j1b: it posts and it answers (a raiser is asked to answer after a contest, and j1a contests j1b's objection)
  const { spied } = await go(config, { held: { ...LEAD, seatVoiceBlock: undefined, seatTitleBlock: undefined } });
  const block = R.judgePersonaBlock({ name: persona, form: 'voice' });
  const mine = judgeCalls(spied).filter(p => seatOf(p.label) === 'j1b');
  assert.equal(new Set(mine.map(p => kindOf(p.label))).size, 3, 'premise: the persona seat made calls of every kind');
  for (const p of mine) {
    assert.equal(p.system, `${WELCOME}\n\n${block}`, `${p.label}: the welcome, then the block`);
    assert.ok(!p.user.includes(block), `${p.label}: the block is not in the user text`);
  }
  for (const p of judgeCalls(spied).filter(q => seatOf(q.label) !== 'j1b')) assert.equal(p.system, WELCOME, `${p.label}: a seat without a persona sends the welcome alone`);
});

test('WHICH SEATS: the one predicate. On with the switch and the lead-in, for a model seat; off for a session (external) seat, with the switch off, and with the lead-in unrecorded', () => {
  assert.equal(typeof Order.cacheOrderSeat, 'function', 'src/cache-order.js exports cacheOrderSeat');
  const on = { prompt_cache: { enabled: true } };
  setHeldForTest(LEAD);
  assert.equal(Order.cacheOrderSeat(on, { provider: 'anthropic', model: 'claude-haiku-5-5' }), true);
  assert.equal(Order.cacheOrderSeat(on, { provider: 'mock', model: 'm' }), true);
  assert.equal(Order.cacheOrderSeat(on, { provider: 'external', model: 'claude-code-session' }), false, 'a session seat keeps today\'s order');
  assert.equal(Order.cacheOrderSeat({}, { provider: 'anthropic', model: 'x' }), false, 'switch off');
  assert.equal(Order.cacheOrderSeat({ prompt_cache: { enabled: false } }, { provider: 'anthropic', model: 'x' }), false);
  setHeldForTest(UNRECORDED);
  assert.equal(Order.cacheOrderSeat(on, { provider: 'anthropic', model: 'x' }), false, 'lead-in unrecorded');
  assert.equal(Order.cacheOrderOn(on), false);
});

test('A LAYOUT PROBLEM STOPS THE RUN BEFORE ANY CALL: a lead-in that renders empty is refused at the start (no judge is asked), and a text that does not open with the welcome is control flow, never a judge\'s silence', async () => {
  setHeldForTest({ ...LEAD, judgeKindLeadIn: () => '' });   // the whole batch is recorded (the gate needs every word), the lead-in alone renders empty
  const spied = [];
  setPromptSpy(p => spied.push(p));
  await assert.rejects(() => runChain({ request: 'A mock task.', log: () => {}, runId: 'r-cache-order-empty', config: exchangeChain({ prompt_cache: { enabled: true } }) }), /lead-in of the call kind panel is empty/);
  assert.equal(spied.length, 0, 'nothing was sent');
  setHeldForTest(LEAD);
  const seat = { provider: 'mock', model: 'm' };
  const err = (() => { try { Order.judgePrompt({ config: { prompt_cache: { enabled: true } }, seat, kind: 'panel', compose: () => 'You are a reviewer.', user: 'H', head: 'H' }); } catch (e) { return e; } return null; })();
  assert.ok(err && err.controlFlow === true && /Council welcome/.test(err.message), String(err?.message));
  const off = Order.judgePrompt({ config: {}, seat, kind: 'panel', compose: () => 'SYSTEM', user: 'USER', head: 'U' });
  assert.deepEqual(off, { system: 'SYSTEM', user: 'USER' }, 'not live: the very same pair');
});

// CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, row R11). OLD: the cache-on run with only the lead-ins recorded sent exactly the switch-off bytes. NEW: it sends the switch-off bytes plus exactly the draft boundary's two pieces, as in the first row of this file. WHY: bade9744 and dc60423a, as there; the order stays off (the predicate below still says so).
test('NEVER LIVE WHILE A RECORDED SENTENCE IS UNTRUE UNDER IT: the lead-ins recorded without the phrase for the re-ask notes keep the order off (the switch-off bytes plus the draft boundary only), and the predicate says so', async () => {
  const bytes = spied => spied.map(({ label, system, user }) => ({ label, system, user }));
  const off = await go(exchangeChain(), { held: UNRECORDED });
  const leadOnly = await go(exchangeChain({ prompt_cache: { enabled: true } }), { held: LEAD_ONLY });
  assert.ok(judgeCalls(off.spied).length > 0 && leadOnly.spied.length === off.spied.length, 'premise: the same calls were made');
  const stripped = stripBoundary(leadOnly.spied);
  assert.equal(stripped.carried, BOUNDARY_CALLS, 'lead-in only: the draft boundary is sent in the panel calls (the target: it is absent where its words are not recorded)');
  assert.deepEqual(stripped.calls, bytes(off.spied), 'the switch-off bytes plus exactly the draft boundary: the order is off');
  setHeldForTest(LEAD_ONLY);
  assert.equal(Order.cacheOrderOn({ prompt_cache: { enabled: true } }), false);
  assert.equal(Order.cacheOrderSeat({ prompt_cache: { enabled: true } }, { provider: 'mock', model: 'm' }), false);
  setHeldForTest(LEAD);
  assert.equal(Order.cacheOrderOn({ prompt_cache: { enabled: true } }), true);
  assert.deepEqual([...(Order.ORDER_WORDS ?? [])].sort(), Object.keys(HC).sort(), 'the batch that makes the order live');
});

test('RE-ASK NOTES: with the order live a re-asked judge is told to answer with the JSON object the instructions for this call describe (the user message holds them), not the system prompt; without the order the recorded words stand', async () => {
  const base = readChainFile(new URL('..', import.meta.url).pathname, 'mock-unanimous');
  const chain = extra => ({ ...base, maxRounds: 2, signoff_table: { required: true }, ...extra, seats: { ...base.seats, critics: [{ provider: 'mock', model: 'mock-critic-table-after-note', lab: 'la' }, { provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'lb' }] } });
  const reaskOf = async (config, held) => (await go(config, { held })).spied.find(p => p.label === 'panel-1-la-reask1');
  const live = await reaskOf(chain({ prompt_cache: { enabled: true } }), { ...LEAD, criticReaskNote: H.criticReaskNote });
  const off = await reaskOf(chain({}), { criticReaskNote: H.criticReaskNote });
  assert.ok(live && off, 'premise: the judge was re-asked in both runs');
  assert.match(off.user, /the complete JSON object the system prompt describes/, 'not live: the recorded words stand');
  assert.match(live.user, /the complete JSON object the instructions for this call describe/);
  assert.doesNotMatch(live.user, /the system prompt describes/);
});

test('GATE: the order is live only with EVERY word of the batch recorded: hiding any one word of the batch keeps it off', () => {
  const on = { prompt_cache: { enabled: true } };
  setHeldForTest(LEAD);
  assert.equal(Order.cacheOrderOn(on), true);
  assert.deepEqual([...(Order.ORDER_WORDS ?? [])].sort(), Object.keys(HC).sort(), 'the gate names exactly the drafted batch');
  for (const name of Object.keys(HC)) {
    setHeldForTest({ ...LEAD, [name]: undefined });
    assert.equal(Order.cacheOrderOn(on), false, `without ${name}`);
  }
});

test('EXCERPT SENTENCES: with the order live the judge-side sentences say the excerpts are marked as such ABOVE (the block stands above the instructions); with it off they say below, as recorded', () => {
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 1 };
  for (const fenced of [false, true]) {
    const sys = config => criticPromptFor(seat, false, { fencedSource: fenced, excerptsMayBeShown: true }, config);
    setHeldForTest({ ...HA, ...LEAD });
    const live = sys({ prompt_cache: { enabled: true } });
    const off = sys({});
    assert.ok(live.includes('marked as such above') && !live.includes('marked as such below'), `fenced ${fenced}: live`);
    assert.ok(off.includes('marked as such below') && !off.includes('marked as such above'), `fenced ${fenced}: off`);
  }
});

test('EXCERPT SENTENCES FOLLOW THEIR ORIGINALS: with the order batch recorded and the lane A sentences they reword NOT recorded, the judge system text is the very text the switch-off chain sends (the order rewords a sentence, it adds none)', () => {
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 1 };
  for (const fenced of [false, true]) for (const mayShow of [false, true]) {
    const sys = config => criticPromptFor(seat, false, { fencedSource: fenced, excerptsMayBeShown: mayShow }, config);
    const LANE_A_HIDDEN = { criticOnlySourceSentence: undefined, criticExcerptOnlyRule: undefined };   // hides the sentences whether or not src/roles.js records them
    setHeldForTest({ ...LEAD, ...LANE_A_HIDDEN });
    const live = sys({ prompt_cache: { enabled: true } });
    setHeldForTest({ ...UNRECORDED, ...LANE_A_HIDDEN });
    const off = sys({});
    assert.equal(live, off, `fenced ${fenced}, may show ${mayShow}: the same text, byte for byte`);
    assert.ok(!live.includes('marked as such above'), 'no excerpt sentence from the order alone');
  }
  // THE MIRROR CASE: the lane A sentences recorded, a variant of the order NOT recorded: the order is then off (the seven-word gate), so the seat gets the original sentences, never nothing
  for (const hidden of ['criticOnlySourceSentenceOrder', 'criticExcerptOnlyRuleOrder']) for (const fenced of [false, true]) {
    const sys = config => criticPromptFor(seat, false, { fencedSource: fenced, excerptsMayBeShown: true }, config);
    setHeldForTest({ ...HA, ...LEAD, [hidden]: undefined });
    const live = sys({ prompt_cache: { enabled: true } });
    setHeldForTest({ ...HA, ...UNRECORDED });
    const off = sys({});
    assert.equal(live, off, `${hidden} hidden, fenced ${fenced}: the original sentences stand, as with the switch off`);
    assert.ok(off.includes('marked as such below'), 'premise: the original sentences are in the text');
  }
});

test('REPAIR PAUSE: a judge whose reply is almost JSON pauses for a repair; with the order live the repair request still shows the reply format (the call\'s instructions block, exactly as the user message carries it), at the first pause AND when a resume before the repair pauses again, while the pause is held to the prompt that was sent', async () => {
  const FP = 'fingerprint-cache-order';
  const chain = () => ({ name: 'cache-order-repair', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], prompt_cache: { enabled: true }, seats: { critics: [{ provider: 'mock', model: 'mock-near-json', lab: 'nj' }, { provider: 'mock', model: 'mock-critic-a', lab: 'ok' }], handoff: { provider: 'external', model: 'x', lab: 'ext' } } });   // the external handoff seat is never reached (config.handoff is off) but makes excerpts possible in the run (excerptsMayBeShownFor), so the reworded excerpt sentence applies to the call
  const dirs = { off: mkdtempSync(join(tmpdir(), 'cache-order-repair-off-')), live: mkdtempSync(join(tmpdir(), 'cache-order-repair-live-')) };
  const sent = [];
  const pauseOf = async (dir, held) => {
    setHeldForTest(held); setRepairPauses(true); setCache(makeStageCache({ dir, fingerprint: FP })); setPromptSpy(p => sent.push(p));
    try { await runChain({ request: 'Req.', config: chain(), draft: 'REVISED MOCK DELIVERABLE', log: () => {}, onStage: st => writeSideStage(dir, st, { fingerprint: FP }) }); } catch (e) { return e; } finally { setCache(null); setRepairPauses(false); setHeldForTest(null); setPromptSpy(null); }
    return null;
  };
  const off = await pauseOf(dirs.off, { ...UNRECORDED, ...HA });
  const live = await pauseOf(dirs.live, { ...HA, ...LEAD });
  assert.ok(off instanceof ExternalPause && off.repair && live instanceof ExternalPause && live.repair, 'premise: both runs paused for a repair');
  assert.equal(off.label, live.label, 'premise: the same stage');
  assert.deepEqual(Object.keys(off.repair).sort(), ['original', 'refusal'], 'not live: the pause carries what it always carried, nothing extra (so the repair request is byte for byte today\'s)');
  assert.equal(live.system, WELCOME, 'the call was sent the welcome as its system text');
  assert.notEqual(live.system, off.system);
  assert.ok(off.system.includes('marked as such below'), 'premise: without the order the excerpt sentence says below');
  assert.ok(live.repair.shownSystem.includes('marked as such above') && !live.repair.shownSystem.includes('marked as such below'), 'the repair request is given the instructions block, with the order\'s reworded excerpt sentence');
  const sentLive = sent.filter(p => p.label === live.label).at(-1);
  assert.ok(sentLive && sentLive.system === WELCOME && sentLive.user.includes(live.repair.shownSystem), 'and that block occurs byte for byte in the prompt the spy recorded for the call, as the heading says');
  assert.equal(live.promptHash === off.promptHash, false, 'the pause is held to what was really sent');
  setAsideOriginal({ runDir: dirs.live, label: live.label, promptHash: live.promptHash, fingerprint: FP });   // what the CLI does at the pause
  const again = await pauseOf(dirs.live, { ...HA, ...LEAD });   // a resume before anyone repaired it
  assert.ok(again instanceof ExternalPause && again.repair, 'pauses again');
  assert.equal(again.system, WELCOME);
  assert.equal(again.repair.shownSystem, live.repair.shownSystem, 'the second pause carries it too');
  assert.ok(sentLive.user.includes(again.repair.shownSystem), 'and it too occurs byte for byte in the prompt that was sent');
});

test('RE-ASK NOTES: only the harness\'s own sentence is reworded: a criterion of the judge\'s that contains the old phrase is left as it is', () => {
  const on = { prompt_cache: { enabled: true } };
  const note = c => `Your last reply could not be read: you marked the criterion (${c}) FAILED in "criteria" but gave no entry for it in "failures". Answer again with the JSON object the system prompt describes, with an entry in "failures".`;
  setHeldForTest(LEAD);
  const out = Order.orderNote(on, { provider: 'mock', model: 'm' }, note('the system prompt describes it'));
  assert.ok(out.includes('(the system prompt describes it)'), 'the quoted criterion is untouched');
  assert.ok(out.includes('Answer again with the JSON object the instructions for this call describe, with an entry'), 'the harness sentence is reworded');
  assert.equal(Order.orderNote(on, { provider: 'external', model: 'm' }, note('x')), note('x'), 'a session seat: the very same text');
  assert.equal(Order.orderNote({}, { provider: 'mock', model: 'm' }, note('x')), note('x'), 'switch off: the very same text');
});

test('REPAIR PAUSE, a reworded sentence: the instructions block handed to the repair request carries the order\'s own rewordings and occurs byte for byte in the user text of the call (judgePrompt level: a mock-only chain cannot show excerpts, so the pause level above has none)', () => {
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 1 };
  const config = { prompt_cache: { enabled: true } };
  setHeldForTest({ ...HA, ...LEAD });
  const compose = () => criticPromptFor(seat, false, { fencedSource: false, excerptsMayBeShown: true }, config);
  const head = R.criticUserHead({ request: 'Req.', criteria: ['It exists.'], draft: 'D' });
  const laid = Order.judgePrompt({ config, seat, kind: 'panel', compose, user: `${head}\n\nrest of the call`, head });
  assert.equal(laid.laid, true);
  assert.ok(laid.shownSystem.includes('marked as such above') && !laid.shownSystem.includes('marked as such below'), 'the reworded sentence applies');
  assert.ok(laid.user.includes(laid.shownSystem), 'byte for byte in the user text');
  assert.equal(laid.system, WELCOME);
  assert.equal(laid.shownSystem, compose().slice(WELCOME.length + 2), 'it is the system text the call composes, less the welcome (no persona here)');
});

// FIX 1 (Helper B's review of the order, 10 Nov 2026; C&C's GO of (b)2): the kind-neutral boundary sentence stands under the REAL heading by construction. The old code found `# Draft under review\n\n<sentence>\n\n` by a text search of the assembled head, whose first
// match is the request's when a request quotes a rendered prompt: the request was edited and the real sentence stayed "The draft you grade ..." for a post and an answer. RED on the tree before the fix: the request comes out changed (assertion 1) and the real
// sentence is still the recorded one (assertion 3). The call site hands over the arguments its head is built from (`headArgs`); judgePrompt builds the neutral head from them and refuses arguments that do not build the head it was given.
test('FIX 1: a request that holds the heading and the recorded boundary sentence is sent byte for byte; H carries the neutral sentence once, directly under the real heading and before the start line', async () => {
  const { boundedDraft } = await import('../src/draft-bounds.js');
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 1 };
  const config = { prompt_cache: { enabled: true }, draft_end_marker: { enabled: true } };
  setHeldForTest({ ...HA, ...HD, ...LEAD });
  const S = HD.draftBoundarySentence(), SN = HC.draftBoundarySentenceNeutral(), START = HD.draftStartLine(), END = HC.draftEndLineNeutral();
  const request = `Here is a rendered prompt I was shown, for your information:\n\n# Draft under review\n\n${S}\n\nThat is all of the quote.`;
  const cu = { request, criteria: ['It exists.'], draft: boundedDraft('The plan.', true), checks: '', endMarker: true };
  const head = R.criticUserHead(cu);
  const compose = () => criticPromptFor(seat, false, { fencedSource: false, excerptsMayBeShown: true }, config);
  for (const kind of ['panel', 'post', 'answer']) {
    const laid = Order.judgePrompt({ config, seat, kind, compose, user: `${head}\n\nrest of the call`, head, endMarker: true, headArgs: cu });
    assert.equal(laid.laid, true);
    assert.ok(laid.head.startsWith(`# Original request\n\n${request}\n\n# Acceptance criteria\n\n1. It exists.\n\n# Draft under review\n\n`), `${kind}: the request is sent byte for byte, the quoted sentence included`);
    assert.equal(laid.head.split(SN).length - 1, 1, `${kind}: the neutral sentence stands once`);
    assert.ok(laid.head.includes(`# Draft under review\n\n${SN}\n\n${START}\n\nThe plan.\n\n${END}`), `${kind}: under the real heading, before the start line, the neutral end line last`);
    assert.equal(laid.head.split(S).length - 1, 1, `${kind}: the recorded sentence stays only where the request quoted it`);
  }
});

test('FIX 1: arguments that do not build the named head are refused, and a call with the boundary on that hands over no arguments is refused (a call-site error, nothing sent)', async () => {
  const { boundedDraft } = await import('../src/draft-bounds.js');
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 1 };
  const config = { prompt_cache: { enabled: true }, draft_end_marker: { enabled: true } };
  setHeldForTest({ ...HA, ...HD, ...LEAD });
  const cu = { request: 'R.', criteria: ['It exists.'], draft: boundedDraft('The plan.', true), checks: '', endMarker: true };
  const head = R.criticUserHead(cu);
  const compose = () => criticPromptFor(seat, false, { fencedSource: false, excerptsMayBeShown: true }, config);
  const base = { config, seat, kind: 'panel', compose, user: `${head}\n\nrest`, head, endMarker: true };
  assert.throws(() => Order.judgePrompt({ ...base, headArgs: { ...cu, request: 'Another request.' } }), err => err.controlFlow === true && /do not build the head that was named/.test(err.message));
  assert.throws(() => Order.judgePrompt({ ...base }), err => err.controlFlow === true && /did not hand over the arguments of its head/.test(err.message));
  assert.equal(Order.judgePrompt({ ...base, headArgs: cu }).laid, true, 'the right arguments are accepted');
  assert.equal(Order.judgePrompt({ ...base, endMarker: false, headArgs: undefined, head: R.criticUserHead({ ...cu, draft: 'The plan.', endMarker: false }), user: `${R.criticUserHead({ ...cu, draft: 'The plan.', endMarker: false })}\n\nrest` }).laid, true, 'boundary off: no arguments needed');
});
