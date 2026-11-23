// 0.8.4, lane C, unit 2: the title for every seat. With the chain's persona switch on (src/judge-persona.js PERSONA_SWITCH) every named seat, judge and proposer, is told its seat's name is a title and changes nothing; the words are HELD
// (test/held-prompts/held-084-c.js seatTitleBlock) until the release re-record, so before it nothing is added and every prompt is byte-identical. The words are injected here with setHeldForTest and the prompts read with setPromptSpy.
// Propose and reply prompts are built through the helpers (src/stage-system.js proposerSystemFor, replySystemFor); src/chain.js sends them through those helpers since 0.8.4 H1-c (Builder B's hunk), so those two jobs are tested at the helper, at the
// estimator and through runChain. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { estimateChainRows } from '../src/cost.js';
import { lintChain } from '../src/chain-lint.js';
import { judgePersonaWarnings, judgePersonasRecord } from '../src/judge-persona.js';
import { readdirSync } from 'node:fs';
import * as R from '../src/roles.js';
import * as S from '../src/stage-system.js';
import * as PR from '../src/persona-record.js';
import { seatTitleBlock, seatVoiceBlock, SEAT_VOICE_LINES } from './held-prompts/held-084-c.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chainFile = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); setPromptSpy(null); });
const inject = () => setHeldForTest({ seatTitleBlock, seatVoiceBlock });
const ANCHOR = 'Reply with a single JSON object and nothing else:';
const SENTENCE = /The name is the title of your seat; it does not change/;

// A chain with names on every kind of seat: two proposers (debate stage) and, in two layers, four judges with the exchange between them
const critic = (model, lab, layer, persona) => ({ provider: 'mock', model, lab, layer, ...(persona ? { persona } : {}) });
// CHANGED ACCEPTED (0.8.4, lane C rebased over M0). OLD: this config carried `layer_debate: { enabled: true }`, and e2's model was `mock-exch-support-keep`. NEW: the key is gone, and e2's model is `mock-exch-contest-keep`. WHY: M0 removed `layer_debate` (the exchange between the judges of the lowest layer is part of every layered run, and chain-lint refuses the key). Since M0 a layer-1 raiser is asked to reply only after a counted contest, and e2 only supported e1's objection; these tests need lreply-1-e1 (Moses answering the posts on his objection), so e2 contests it. e2's contest names no persona.
function fullConfig(switchCfg) {
  const base = chainFile('mock-debate');
  return {
    ...base, name: 'seat-title-test', maxRounds: 2, signoff: 'unanimous',
    ...(switchCfg ? { seat_personas: switchCfg } : {}),
    seats: { ...base.seats,
      proposers: base.seats.proposers.map((p, i) => ({ ...p, persona: ['Husayn', 'Abraham'][i] })),
      critics: [critic('mock-exch-support-keep', 'e1', 1, 'Moses'), critic('mock-exch-contest-keep', 'e2', 1, 'Noah')] },
  };
}
async function promptsOf(cfg) {
  const seen = [];
  setPromptSpy(p => seen.push({ label: p.label, system: p.system }));
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-seat-title', config: cfg, onStage: s => { if (PR.personaStampFor) Object.assign(s, PR.personaStampFor(s, cfg)); } });
  setPromptSpy(null);
  seen.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.system < b.system ? -1 : 1));   // seats run in parallel: the order of the calls is not part of what is compared
  return { r, seen, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-seat-title', chain: cfg.name, task: 't.md', result: r, config: cfg }))) };
}

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the held state ('the words are held': nothing added, every prompt byte-identical, row notes null). NEW: seatTitleBlock, seatVoiceBlock and SEAT_VOICE_LINES are recorded, so every held-state half is REMOVED (K7) beside the sibling that asserts the recorded state on the same path (named at each removal), and the 'plain' baseline of the estimate rows is the chain with the switch OFF (the person's own setting). WHY: the seat title and seat voice words recorded (src/roles.js, src/prompts/recorded-084-c.js).
// REMOVED (K7): 'NO INJECTION, NOTHING ADDED' (with the switch on, every prompt of a run is byte-identical to the switch off, the words being held). Sibling: 'JUDGES, injected' and 'DEBATE, injected' below, which assert the recorded title in the same prompts of the same run; the switch-off path stays pinned in 'seatPersonaText' (switch off: null).

test('seatPersonaText: null with the switch off, and for a seat with no name; the words for each job once injected; an unknown job is an error', () => {
  const cfg = fullConfig({ enabled: true, form: 'title' });
  const seat = cfg.seats.proposers[0];
  // REMOVED (K7): the held-state line (null with no words recorded). Sibling: the loop below, the recorded text for every job.
  inject();
  for (const job of ['judge', 'propose', 'debate', 'reply']) assert.equal(S.seatPersonaText(cfg, seat, job), seatTitleBlock({ name: 'Husayn', job }), job);
  assert.equal(S.seatPersonaText({ ...cfg, seat_personas: { enabled: false, form: 'title' } }, seat, 'propose'), null, 'switch off');
  assert.equal(S.seatPersonaText({ ...cfg, seat_personas: undefined }, seat, 'propose'), null, 'no switch');
  assert.equal(S.seatPersonaText(cfg, { provider: 'mock', model: 'm' }, 'propose'), null, 'a seat with no name gets no title');
  assert.throws(() => S.seatPersonaText(cfg, seat, 'nobody'), /not "nobody"/);
  assert.match(seatTitleBlock({ name: 'Moses', job: 'judge' }), /^You are judging as Moses\. The name is the title of your seat; it does not change what you check or how you rule\.$/, "plan C's W1 sentence, word for word");
});

test('JUDGES, injected: the verdict and both exchange prompts carry the title with the seat\'s own name, directly before the reply-format sentence, once; a seat with no name carries none', async () => {
  inject();
  const cfg = fullConfig({ enabled: true, form: 'title' });
  cfg.seats.critics[1] = critic('mock-exch-contest-keep', 'e2', 1);   // e2 has no name
  const { seen } = await promptsOf(cfg);
  const of = label => seen.find(p => p.label === label)?.system ?? '';
  for (const label of ['panel-1-e1', 'ldebate-1-e1', 'lreply-1-e1']) {
    const sys = of(label);
    assert.equal((sys.match(/The name is the title of your seat/g) || []).length, 1, label);
    assert.ok(sys.includes(`${seatTitleBlock({ name: 'Moses', job: 'judge' })}\n\n${ANCHOR}`), `${label}: the title sits directly before the reply format`);
    assert.doesNotMatch(sys, /Husayn|Abraham|Noah/, `${label}: only its own name`);
  }
  for (const label of ['panel-1-e2', 'ldebate-1-e2', 'lreply-1-e2']) assert.doesNotMatch(of(label), SENTENCE, `${label}: no name, no title`);
});

test('DEBATE, injected: a proposer\'s debate post carries its title before the reply format; the other proposer\'s its own', async () => {
  inject();
  const { seen } = await promptsOf(fullConfig({ enabled: true, form: 'title' }));
  const debates = seen.filter(p => /^debate-/.test(p.label));
  assert.equal(debates.length, 2);
  for (const [i, who] of ['Husayn', 'Abraham'].entries()) {
    const sys = debates.find(p => p.label.endsWith(['mock-a', 'mock-b'][i])).system;
    assert.ok(sys.includes(`${seatTitleBlock({ name: who, job: 'debate' })}\n\n${ANCHOR}`), who);
    assert.equal((sys.match(/The name is the title of your seat/g) || []).length, 1);
    assert.doesNotMatch(sys, new RegExp(['Husayn', 'Abraham'].filter(n => n !== who)[0]));
  }
});

test('PROPOSE and REPLY, injected, in a run (0.8.4 H1-c: src/chain.js sends them through the helpers): every propose- and reply- prompt carries its own proposer\'s title before the reply format, once, and not the other proposer\'s', async () => {
  inject();
  const { seen } = await promptsOf(fullConfig({ enabled: true, form: 'title' }));
  const nameOfSeat = { 'mock-a': 'Husayn', 'mock-b': 'Abraham' };
  for (const [prefix, job, least] of [['propose-', 'propose', 2], ['reply-', 'reply', 1]]) {
    const mine = seen.filter(p => p.label.startsWith(prefix));
    assert.ok(mine.length >= least, `precondition: ${least} or more ${prefix} prompts were sent (${mine.length})`);
    for (const p of mine) {
      const who = nameOfSeat[Object.keys(nameOfSeat).find(k => p.label.includes(k))];
      assert.ok(who, `${p.label}: a known proposer`);
      assert.ok(p.system.includes(`${seatTitleBlock({ name: who, job })}\n\n${ANCHOR}`), `${p.label}: ${who}'s title sits directly before the reply format`);
      assert.equal((p.system.match(/The name is the title of your seat/g) || []).length, 1, `${p.label}: once`);
      assert.doesNotMatch(p.system, new RegExp(Object.values(nameOfSeat).filter(n => n !== who)[0]), `${p.label}: not the other seat's name`);
    }
  }
});

test('PROPOSE and REPLY, at the helpers: the title sits before the reply format (and before the quote gloss on a reply); the helper is exactly the old text with no name', () => {
  const cfg = fullConfig({ enabled: true, form: 'title' });
  const seat = cfg.seats.proposers[0];
  // REMOVED (K7): the three held-state lines (the helpers return R.proposerSystem / R.replySystem with no words recorded). Sibling: the two injected assertions just below (the title before the reply format).
  inject();
  const p = S.proposerSystemFor(cfg, seat, false);
  assert.equal(p, R.proposerSystem(false).replace(ANCHOR, `${seatTitleBlock({ name: 'Husayn', job: 'propose' })}\n\n${ANCHOR}`));
  const r = S.replySystemFor(cfg, seat, true);
  assert.equal(r, R.replySystem(true).replace(ANCHOR, `${seatTitleBlock({ name: 'Husayn', job: 'reply' })}\n\n${ANCHOR}`));
  assert.equal(S.proposerSystemFor(cfg, { provider: 'mock', model: 'm' }, false), R.proposerSystem(false), 'no name, no title');
});

test('FORMS: title gives every named seat the title; voice gives every named seat the voice. With the words recorded, both get the voice', async () => {
  const withForm = form => ({ enabled: true, form });
  const proposerOf = r => r.seen.find(p => /^debate-/.test(p.label)).system;
  const judgeOf = r => r.seen.find(p => p.label === 'panel-1-e1').system;
  // REMOVED (K7): the 'not injected' half (a judge under voice keeps the recorded frame alone, a proposer gets nothing, byte-identical to the switch off). Sibling: the 'injected' half below (the held voice for a judge and for a proposer, before the reply format).
  inject();
  const j = await promptsOf(fullConfig(withForm('voice')));
  assert.ok(judgeOf(j).includes(`${seatVoiceBlock({ name: 'Moses', job: 'judge' })}\n\n${ANCHOR}`), 'a judge: the held voice');
  assert.ok(proposerOf(j).includes(`${seatVoiceBlock({ name: 'Husayn', job: 'debate' })}\n\n${ANCHOR}`), 'a proposer: the held voice, before the reply format');
  assert.doesNotMatch(proposerOf(j) + judgeOf(j), SENTENCE, 'a voice chain carries no title');
  const t = await promptsOf(fullConfig(withForm('title')));
  assert.match(judgeOf(t), SENTENCE); assert.doesNotMatch(judgeOf(t), /speak in the voice of/, 'a title chain carries no voice');
  // one rule for every name, alive or not: a judge named like a living person gets the same voice as any other (there is no key that gives a listed name only its name)
  const living = fullConfig({ enabled: true, form: 'voice' });
  assert.ok(judgeOf(await promptsOf(living)).includes(`${seatVoiceBlock({ name: 'Moses', job: 'judge' })}\n\n${ANCHOR}`));   // CHANGED ACCEPTED (lane C unit 5): the words are injected here and the table holds a line for Moses, so the voice is the frame plus that line, not the frame alone as with the empty table. This row builds the same config as the injected run above, so it repeats that assert (as the old row repeated the bare one)
  assert.doesNotMatch(judgeOf(await promptsOf(living)), /Your seat is named/);
});

test('THE METHOD FORM IS GONE (C&C, 4 Nov 2026: a third state for one role is what "everyone" excludes): the schema enum, the lint and the shape check all refuse form "method" and name the two forms that exist', () => {
  const cfg = fullConfig({ enabled: true, form: 'method' });
  const finds = lintChain(cfg);
  const refusal = finds.filter(f => /seat_personas\.form/.test(f.message));
  assert.equal(refusal.length, 1, JSON.stringify(finds.map(f => [f.kind, f.message.slice(0, 80)])));   // one finding, from the chain's shape check, which derives its list from PERSONA_FORMS
  assert.match(refusal[0].message, /"title" or "voice"/);
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);   // the chain schema is draft-07
  const base = chainFile('mock-unanimous');
  assert.equal(validate({ ...base, seat_personas: { enabled: true, form: 'title' } }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, seat_personas: { enabled: true, form: 'voice' } }), true);
  assert.equal(validate({ ...base, seat_personas: { enabled: true, form: 'method' } }), false);
});

test('THE RECORD: a titled row says the name its prompt carried', async () => {
  const cfg = fullConfig({ enabled: true, form: 'title' });
  // REMOVED (K7): the held half (with no words recorded the row says null). Sibling: the 'after' assertions just below (the row says the name its prompt carried).
  inject();
  const after = await promptsOf(cfg);
  const names = Object.fromEntries(after.report.stages.filter(s => /^(debate|panel)-/.test(s.label) && s.persona).map(s => [s.label, s.persona_name]));
  assert.equal(names['panel-1-e1'], 'Moses');
  assert.deepEqual(after.report.stages.filter(s => /^debate-/.test(s.label)).map(s => [s.persona, s.persona_name, s.persona_set_sha256]), [['Husayn', 'Husayn', null], ['Abraham', 'Abraham', null]]);
  // propose and reply rows: the helpers noted what they built (a titled proposer prompt)
  const seat = cfg.seats.proposers[0];
  S.proposerSystemFor(cfg, seat, false); S.replySystemFor(cfg, seat, false);
  for (const label of ['propose-mock-a', 'reply-mock-a']) assert.equal(PR.personaStampFor({ label, lab: 'mock-a', provider: 'mock', model: 'm' }, cfg).persona_name, 'Husayn', label);
});

test('THE RECORD names the CANARY reply\'s title (0.8.4 H1-c: src/chain.js sends the canary reply through replySystemFor): with the words recorded a canary-reply- row says the name its prompt carried', () => {
  const cfg = fullConfig({ enabled: true, form: 'title' });
  const seat = cfg.seats.proposers[0];
  const stamp = () => PR.personaStampFor({ label: 'canary-reply-mock-a', lab: 'mock-a', provider: 'mock', model: 'm' }, cfg);
  // REMOVED (K7): the held half (no words recorded: the row says null). Sibling: the assertion below (the row says the name its prompt carried).
  inject();
  S.replySystemFor(cfg, seat, false);
  assert.equal(stamp().persona_name, 'Husayn', 'the words recorded: the prompt carried the seat\'s name, so the row says it');
});

test('THE ESTIMATE grows with the title: every row of a named seat that sends the sentence (propose, debate, reply, panel, exchange) prices more than the same chain with the switch off, and no other row moves', () => {
  const cfg = fullConfig({ enabled: true, form: 'title' });
  const plain = Object.fromEntries(estimateChainRows(fullConfig(null)).map(r => [r.label, r.input]));   // the baseline is the chain with the switch OFF (the person's own setting)
  inject();
  const titled = Object.fromEntries(estimateChainRows(cfg).map(r => [r.label, r.input]));
  const grew = Object.keys(plain).filter(l => titled[l] > plain[l]);
  for (const prefix of ['propose-', 'debate-', 'reply-', 'panel-']) assert.ok(grew.some(l => l.startsWith(prefix)), `${prefix} rows grow`);
  for (const prefix of ['ldebate-', 'lreply-']) for (const l of Object.keys(plain).filter(x => x.startsWith(prefix))) assert.ok(titled[l] > plain[l], `${l} grows`);   // the exchange rows exist only for a chain with a second layer
  assert.deepEqual(Object.keys(plain).filter(l => titled[l] < plain[l]), [], 'no row shrinks');
  for (const l of Object.keys(plain)) if (!/^(propose|debate|reply|panel|critique|ldebate|lreply|final-read)-/.test(l)) assert.equal(titled[l], plain[l], `${l} does not move`);

  // the exchange prompts of a layer (priced by systemTextsFor, as test/judge-persona.test.js prices them): both rounds' longest text grows by the title and its two newlines
  const e1 = cfg.seats.critics[0];
  const longest = (label, c = cfg) => Math.max(...S.systemTextsFor(label, c, e1).map(t => t.length));
  const block = seatTitleBlock({ name: 'Moses', job: 'judge' }).length + 2;
  const off = fullConfig(null);
  const before = { debate: longest('ldebate-L1-e1', off), reply: longest('lreply-L1-e1', off) };
  inject();
  assert.equal(longest('ldebate-L1-e1'), before.debate + block);
  assert.equal(longest('lreply-L1-e1'), before.reply + block);
});

test('THE ESTIMATE prices the CANARY reply with the title (0.8.4 H1-c: src/chain.js sends the canary reply through replySystemFor): a chain with the canary on has a canary-reply- row, it grows once the words are injected, and its longest text is the reply- rows\' longest', () => {
  const cfg = { ...fullConfig({ enabled: true, form: 'title' }), canary: { enabled: true, sampleRate: 1 } };
  const rowsOf = c => Object.fromEntries(estimateChainRows(c).map(r => [r.label, r.input]));
  const plain = rowsOf({ ...fullConfig(null), canary: { enabled: true, sampleRate: 1 } });   // the baseline is the same chain with the switch OFF
  inject();
  const titled = rowsOf(cfg);
  const canary = Object.keys(plain).filter(l => l.startsWith('canary-reply-'));
  assert.equal(canary.length, 1, 'precondition: the canary-on chain prices one canary-reply- row');
  assert.ok(titled[canary[0]] > plain[canary[0]], `${canary[0]} grows with the title`);
  const sameSeatReply = canary[0].replace(/^canary-/, '');
  assert.ok(sameSeatReply in plain, `precondition: the same seat's ${sameSeatReply} row exists`);
  assert.equal(titled[canary[0]] - plain[canary[0]], titled[sameSeatReply] - plain[sameSeatReply], 'by the same amount as the same seat\'s reply- row (the same helper prices both)');
});

test('THE ESTIMATOR LEAVES NO NOTE: pricing a chain (the dry run builds the propose- and reply- prompts through the helpers) does not make a row say its prompt carried a name it did not; the rows of prompts the run really sends still do', async () => {
  const cfg = fullConfig({ enabled: true, form: 'title' });
  inject();
  estimateChainRows(cfg);   // before the run, as src/cli.js does
  const { report } = await promptsOf(cfg);
  const row = prefix => report.stages.find(s => s.label.startsWith(prefix) && s.persona);
  assert.equal(row('debate-')?.persona_name, 'Husayn', 'a prompt the run sent carries the name and the row says so');
  assert.equal(row('panel-')?.persona_name, 'Moses');
  // CHANGED ACCEPTED (0.8.4 H1-c, Builder B's hunk in src/chain.js; lane C's file). OLD: propose- and reply- rows said persona_name null, because chain.js sent the old builder (R.proposerSystem, R.replySystem) and the prompt carried no title. NEW: chain.js sends both through the helpers (proposerSystemFor, replySystemFor), so the prompt a run really sends carries the seat's title and its row says the name. WHY: lane C's decision is a title for every seat and the estimate prices one; a run that sent none contradicted both. The test still proves what its name says: the estimator's own builds leave no note (the rows say what the RUN sent).
  const nameOfSeat = { 'mock-a': 'Husayn', 'mock-b': 'Abraham' };
  for (const prefix of ['propose-', 'reply-']) { assert.ok(row(prefix), `precondition: a ${prefix} row names the seat`); assert.equal(row(prefix).persona_name, nameOfSeat[Object.keys(nameOfSeat).find(k => row(prefix).label.includes(k))], `${prefix}: its prompt carried the seat's title (chain.js sends the helper's text), so the row says the name`); }
});

test('THE REPORT SHOWS EVERY NAMED SEAT: seat_personas.seats lists the judges and the proposers (layer null) and validates against the published schema', async () => {
  const cfg = fullConfig({ enabled: true, form: 'title' });
  const { report } = await promptsOf(cfg);
  assert.deepEqual(report.seat_personas.seats.map(s => [s.seat, s.kind, s.layer, s.persona]), [['e1', 'judge', 1, 'Moses'], ['e2', 'judge', 1, 'Noah'], ['mock-a', 'proposer', null, 'Husayn'], ['mock-b', 'proposer', null, 'Abraham']]);
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  assert.ok(ajv.compile(schema)(report), JSON.stringify(ajv.errors));
});

// ---- the lint: one switch, one form for the chain (the owner: "everyone has a title or everyone has the full voice") ----
const kindsOf = cfg => lintChain(cfg).map(f => f.kind);
// every persona finding of the seat rules, by prefix: a kind that a build removes (the staging guard of unit 2) must still show on a tree that has it, so the 'accepted' tests below can fail there
const seatKinds = cfg => kindsOf(cfg).filter(k => /^(seat-persona-|judge-persona)/.test(k));

test('LINT: a bare persona on a proposer is accepted under the title form; beside role.persona it is refused (with the switch off too); role.lens beside persona is fine', () => {
  assert.deepEqual(seatKinds(fullConfig({ enabled: true, form: 'title' })), []);
  const withRole = (role, sw) => { const c = fullConfig(sw); c.seats.proposers[0] = { ...c.seats.proposers[0], role }; return c; };
  assert.deepEqual(seatKinds(withRole({ persona: 'noah' }, { enabled: true, form: 'title' })).sort(), ['seat-persona-voice-under-title', 'seat-persona-with-role-persona']);
  assert.deepEqual(seatKinds(withRole({ persona: 'noah' }, null)), ['seat-persona-with-role-persona'], 'refused whether or not the switch is on');
  assert.deepEqual(seatKinds(withRole({ lens: 'skeptic' }, { enabled: true, form: 'title' })), [], 'a lens beside a title is legitimate');
});

test('LINT: under the form title a role.persona voice on ANY proposer is refused chain-wide', () => {
  const c = fullConfig({ enabled: true, form: 'title' });
  const other = { ...c.seats.proposers[1] }; delete other.persona; other.role = { persona: 'noah' };   // the second proposer is a voice seat, the first a title seat
  c.seats.proposers[1] = other;
  assert.deepEqual(seatKinds(c), ['seat-persona-voice-under-title']);
});

test('LINT: under the form voice a named proposer is ACCEPTED now (its voice is built; the staging guard that refused it is removed in the unit that builds it)', () => {
  assert.deepEqual(seatKinds(fullConfig({ enabled: true, form: 'voice' })), []);
  assert.deepEqual(seatKinds(fullConfig({ enabled: true, form: 'title' })), []);
});

test('LINT: names are checked and unique across judges AND proposers; the switch needs at least one named seat of either kind', () => {
  const dup = fullConfig({ enabled: true, form: 'title' });
  dup.seats.proposers[0] = { ...dup.seats.proposers[0], persona: 'moses' };   // the same name as judge e1, other case
  assert.deepEqual(seatKinds(dup), ['judge-persona-duplicate']);
  const none = fullConfig({ enabled: true, form: 'title' });
  none.seats.proposers = none.seats.proposers.map(({ persona, ...p }) => p); none.seats.critics = none.seats.critics.map(({ persona, ...c }) => c);
  assert.deepEqual(seatKinds(none), ['judge-personas-no-persona']);
  const bad = fullConfig({ enabled: true, form: 'title' }); bad.seats.proposers[0] = { ...bad.seats.proposers[0], persona: 'No#pe' };
  assert.deepEqual(seatKinds(bad), ['judge-persona-name']);
});

test('LINT: the warning for a persona with the switch off names proposers too; it is silent when the switch is on', () => {
  const off = fullConfig(null);
  const w = judgePersonaWarnings(off);
  assert.equal(w.length, 1);
  for (const n of ['Husayn', 'Abraham', 'Moses', 'Noah']) assert.match(w[0].message, new RegExp(n));
  assert.deepEqual(judgePersonaWarnings(fullConfig({ enabled: true, form: 'title' })), []);
});

// CHANGED ACCEPTED TEST (0.8.4, the plan-the-high-council chain, lane C #32). OLD bar: no top-level chain carries the persona switch or a bare persona. NEW bar: the same for every chain EXCEPT
// chains/plan-the-high-council.json, exempt BY FILE NAME, which must carry the switch in the form title and a persona on all 15 of its seats, and must lint clean (the whole lint, not only the persona
// rules, so the exemption cannot hide a later break). WHY: the owner (1 Nov 2026: "only the new plan-the-high-council should get the seat personas"; the heading of 4 Nov 2026: a title for every seat).
// CHANGED ACCEPTED TEST AGAIN (0.8.4 seats unit, Muad 05 Nov 2026 14:25: "the names are enabled for every chain; the voices for plan-the-high-council"; the seat picks of 10 Nov 2026 00:42 to 02:47: "proposer names as on the flagship"). OLD bar: only plan-the-high-council carries the switch and a persona on every seat. NEW bar: the seven shipped planning chains each carry the switch in the form title and a persona on every proposer and judge seat (15 on the flagship and its twin, 11 on the others), and lint clean; every other shipped chain (the mock chains, local-ollama, the advice chains) carries neither. WHY: the owner's heading names the names for every chain; the voices stay a flagship matter and no chain switches them on here.
const PERSONA_CHAINS = { 'plan-the-high-council.json': 15, 'plan-high-council.json': 15, 'plan-medium-council.json': 11, 'plan-mini-council.json': 11, 'plan-china-high-council.json': 11, 'plan-china-medium-council.json': 11, 'plan-claude-council.json': 11 };   // CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:23, the claude seat picks): OLD bar: six persona chains. NEW bar: seven; plan-claude-council carries the switch and a persona on its 11 seats (Noah, Husayn, Abraham; Matthew, Van Gogh, Herbert; Plato, da Vinci, Moses; Melchizedek, Karpathy). WHY: the count moves with the thing it counts. (older note: plan-claude-council joins when its seats are re-seated (the last step of the seats unit)
test('NO SHIPPED CHAIN trips any of these rules (every top-level chain under chains/ is linted; the seven planning chains carry the switch (the flagship in the form voice, the others in the form title) and a persona on every seat and lint clean; no other chain carries the switch or a bare persona)', () => {
  const dir = join(root, 'chains');
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 20);
  for (const f of Object.keys(PERSONA_CHAINS)) assert.ok(files.includes(f), f);
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    assert.deepEqual(seatKinds(cfg), [], f);
    const seats = ['proposers', 'critics'].flatMap(slot => cfg.seats?.[slot] || []);
    if (f in PERSONA_CHAINS) {
      // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: every persona chain carries the switch in the form title. NEW: the flagship plan-the-high-council carries the form voice ("the names are enabled for every chain; the voices for plan-the-high-council", the heading this test already quotes); the other six keep the form title. WHY: chains/plan-the-high-council.json "form": "voice" (commit aa28d72a; its description row in f60ebad2).
      assert.deepEqual(cfg.seat_personas, { enabled: true, form: f === 'plan-the-high-council.json' ? 'voice' : 'title' }, `${f}: the switch`);
      assert.equal(seats.length, PERSONA_CHAINS[f], `${f}: the seat count`);
      assert.equal(seats.filter(s => typeof s.persona === 'string' && s.persona.length > 0).length, PERSONA_CHAINS[f], `${f}: a persona on every seat`);
      assert.deepEqual(lintChain(cfg, join(dir, f)), [], `${f} must lint clean`);
      continue;
    }
    assert.equal(cfg.seat_personas, undefined, `${f} carries the switch`);
    for (const s of seats) assert.equal('persona' in s, false, `${f}: a bare persona on a seat`);
  }
});

test('THE OWN-NAME FLAG belongs to the judge: a proposer that shares its lab with a judge (mock chains do) does not take over the judge\'s name in the detector, so a judge that writes its own name is still own: true; kind tells a proposer from an unlayered judge', () => {
  const cfg = { signoff: 'unanimous', seat_personas: { enabled: true, form: 'title' },
    seats: { critics: [{ provider: 'mock', model: 'm', lab: 'mock-a', persona: 'Moses' }], proposers: [{ provider: 'mock', model: 'p', lab: 'mock-a', persona: 'Husayn' }] } };
  const result = { layerDebates: [{ pass: 1, objections: [{ id: 'o1', raised_by: 'mock-a', problem: 'Moses finds the limit missing, and Husayn agrees.', posts: [], replies: [] }] }] };
  const rec = judgePersonasRecord(cfg, result);
  assert.deepEqual(rec.seats.map(s => [s.seat, s.kind, s.layer, s.persona]), [['mock-a', 'judge', null, 'Moses'], ['mock-a', 'proposer', null, 'Husayn']]);
  assert.deepEqual(rec.names_in_text.map(r => [r.name, r.own]), [['Moses', true], ['Husayn', false]]);
});

// ---- unit 3: the full voice (form "voice"), experimental, off in every shipped chain ----
// HIS WORDS, typed here verbatim (the recorded frame, test/judge-persona.test.js K1): the held voice block's frame must be byte-identical to them. The expected text is not built from the code under test.
const FRAME = name => `You have a seat in THE HIGH COUNCIL, and you speak in the voice of ${name}. The Council will debate on the Software Engineering behind this debate's build plan, and together with the other seats, you will help to improve it, with manners and in harmony. Thank you very much in advance, dear Council member. :)`;
const TEST_LINES = { Husayn: 'TEST-LINE-FOR-HUSAYN.', Moses: 'TEST-LINE-FOR-MOSES.' };   // test data only: stand-ins for the table, never a line of a person

// CHANGED ACCEPTED TEST (0.8.4, lane C unit 5). OLD: SEAT_VOICE_LINES was empty (asserted), and Moses and Husayn were among the names that get the frame alone. NEW: the table holds the fifteen settled lines (test/seat-voice-lines.test.js
// pins each one), so the frame-alone names here are names that are not in the table. WHY: the lines are unit 5's; the frame itself is still pinned for every job and any name, which is what this test is for.
test('VOICE FRAME: the held block\'s frame is byte-identical to the recorded one (his words), for every job and any name; a name with no line in SEAT_VOICE_LINES gets the frame alone', () => {
  for (const name of ['Nobody', 'Somebody Else']) assert.ok(!Object.keys(SEAT_VOICE_LINES).some(k => k.toLowerCase() === name.toLowerCase()), `precondition: ${name} has no line`);
  for (const job of ['judge', 'propose', 'debate', 'reply']) for (const name of ['Nobody', 'Somebody Else']) assert.equal(seatVoiceBlock({ name, job }), FRAME(name), `${job} ${name}`);
  assert.equal(R.judgePersonaBlock({ name: 'Moses', form: 'voice' }), FRAME('Moses'), 'and the recorded judge block is that frame');
  assert.throws(() => seatVoiceBlock({ name: 'Moses', job: 'nobody' }), /"nobody"/);
});

test('VOICE TABLE: a name matches a line ignoring case and nothing else; a name that contains another name, or is contained in one, gets the frame alone', () => {
  const block = a => seatVoiceBlock(a, { Noah: 'TEST-LINE.' });
  assert.equal(block({ name: 'Noah', job: 'judge' }), `${FRAME('Noah')} TEST-LINE.`);
  assert.equal(block({ name: 'nOaH', job: 'reply' }), `${FRAME('nOaH')} TEST-LINE.`);
  for (const name of ['Noahs', 'Noah-2', 'Ann Noah', 'No', 'Noa', ' Noah']) assert.equal(block({ name, job: 'judge' }), FRAME(name), name);
});

test('VOICE, injected with a test table: every named seat gets its frame and, when it has one, its line; the line comes after the frame and before the reply format, once', async () => {
  setHeldForTest({ seatVoiceBlock: a => seatVoiceBlock(a, TEST_LINES) });
  const r = await promptsOf(fullConfig({ enabled: true, form: 'voice' }));
  const of = label => r.seen.find(p => p.label === label)?.system ?? '';
  const deb = r.seen.filter(p => /^debate-/.test(p.label)).map(p => p.system);
  assert.ok(deb.some(sys => sys.includes(`${FRAME('Husayn')} TEST-LINE-FOR-HUSAYN.\n\n${ANCHOR}`)), 'the proposer with a line');
  assert.ok(deb.some(sys => sys.includes(`${FRAME('Abraham')}\n\n${ANCHOR}`)), 'the proposer without one: the frame alone');
  for (const label of ['panel-1-e1', 'ldebate-1-e1', 'lreply-1-e1']) assert.ok(of(label).includes(`${FRAME('Moses')} TEST-LINE-FOR-MOSES.\n\n${ANCHOR}`), label);
  assert.ok(of('panel-1-e2').includes(`${FRAME('Noah')}\n\n${ANCHOR}`), 'a judge without a line');
  for (const sys of [...deb, of('panel-1-e1')]) assert.equal((sys.match(/you speak in the voice of/g) || []).length, 1, 'the voice once');
});

test('VOICE, the record and the estimate: a voice row says the name its prompt carried (no set hash); the rows that send the voice price it', async () => {
  const cfg = fullConfig({ enabled: true, form: 'voice' });
  // REMOVED (K7): the held half (a proposer under voice, no words recorded: persona_name null). Sibling: the 'after' assertions just below (the name its prompt carried).
  inject();
  const after = await promptsOf(cfg);
  assert.deepEqual(after.report.stages.filter(s => /^debate-/.test(s.label)).map(s => [s.persona, s.persona_name, s.persona_set_sha256]), [['Husayn', 'Husayn', null], ['Abraham', 'Abraham', null]]);
  assert.equal(after.report.stages.find(s => s.label === 'panel-1-e1').persona_name, 'Moses');
  const plain = Object.fromEntries(estimateChainRows(fullConfig(null)).map(r => [r.label, r.input]));   // the baseline is the chain with the switch OFF
  inject();
  const voiced = Object.fromEntries(estimateChainRows(cfg).map(r => [r.label, r.input]));
  for (const prefix of ['propose-', 'debate-', 'reply-']) assert.ok(Object.keys(plain).filter(l => l.startsWith(prefix)).every(l => voiced[l] > plain[l]), `${prefix} rows grow with the voice`);
});

test('LINT, voice: a role.persona on a proposer is refused (a second voice route)', () => {
  const c = fullConfig({ enabled: true, form: 'voice' });
  const withRole = JSON.parse(JSON.stringify(c)); delete withRole.seats.proposers[0].persona; withRole.seats.proposers[0].role = { persona: 'noah' };
  assert.deepEqual(seatKinds(withRole), ['seat-persona-role-under-voice']);
});

// NAME_ONLY IS GONE (the 4 Nov 2026 heading "one rule for every name, alive or not"). One test per removal, so each has its own red: assertions appended to one test cannot fail separately.
test('NAME_ONLY IS GONE, the shape check: the key is refused with the existing sentence in either form', () => {
  for (const form of ['title', 'voice']) {
    const finds = lintChain(fullConfig({ enabled: true, form, name_only: ['Moses'] }));
    const refusal = finds.filter(f => /name_only/.test(f.message));
    assert.equal(refusal.length, 1, `${form}: ${JSON.stringify(finds.map(f => [f.kind, f.message.slice(0, 80)]))}`);
    assert.match(refusal[0].message, /not a recognized key/, form);
  }
});

test('NAME_ONLY IS GONE, the title guard (seat-persona-name-only-with-title): a title chain with name_only raises no seat-persona finding of its own', () => {
  assert.deepEqual(seatKinds(fullConfig({ enabled: true, form: 'title', name_only: ['Moses'] })), []);
});

test('NAME_ONLY IS GONE, the proposer guard (seat-persona-name-only-proposer): a proposer\'s name in name_only under voice raises no seat-persona finding of its own', () => {
  assert.deepEqual(seatKinds(fullConfig({ enabled: true, form: 'voice', name_only: ['husayn'] })), []);
});

test('NAME_ONLY IS GONE, the unmatched finding (judge-persona-name-only-unmatched): a name no seat carries raises no persona finding of its own', () => {
  assert.deepEqual(seatKinds(fullConfig({ enabled: true, form: 'voice', name_only: ['Nobody'] })), []);
});

test('NAME_ONLY IS GONE, the schema refuses the key and the record has no field for it', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = chainFile('mock-unanimous');
  assert.equal(validate({ ...base, seat_personas: { enabled: true, form: 'voice' } }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, seat_personas: { enabled: true, form: 'voice', name_only: ['Livia'] } }), false);
  assert.equal('name_only' in (judgePersonasRecord(fullConfig({ enabled: true, form: 'voice' }), { layerDebates: [] }) ?? {}), false, 'the report section has no name_only field');
});
