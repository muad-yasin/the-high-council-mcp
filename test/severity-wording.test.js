// B3 prep, JUDGE lane, unit V: the severity WORDING (A-DRAFT, all of it; the person's yes comes once, at the wording review). With the chain switch `severity` on, the verdict prompt asks for a severity on every objection (a grading rule and a reply-format
// field), the exchange post prompt asks for one on a new objection, and a verdict that carried no readable severity gets ONE re-ask with a note, whatever the other judges did. The code carries the NOT-TOLD reading (anchors by consequence only, no sentence
// saying what a band does, no example number); the told reading and the example number live in the review packet. Three texts are exported UNWIRED (the accept stance and its two scoped sentences, the layer-3 re-tag field with its ledger suffix, the sweep
// prompt) and their bytes are pinned here, so their units wire them unchanged. Switch OFF = today's bytes: the PIN digests in test/fixtures/severity-wording-pins.json were taken on the merged tip BEFORE roles.js was touched.
// The mocks cannot show that a real model fills the field: they emit tags from the model string, so these tests prove what the prompt CARRIES, not compliance.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { lintSeverityChain } from '../src/severity.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import * as S from '../src/stage-system.js';
import { normaliseCritique, runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); });
const sha = t => createHash('sha256').update(t).digest('hex').slice(0, 16);

// ---- the verbatim texts (K3: new text; K2 brief 37 in the packet). Written here, not derived from the code under test.
const ANCHORS = [
  '- 9 to 10: whoever builds from this plan would build the wrong thing, or cannot proceed without a decision the plan does not make.',
  '- 7 to 8.9: whoever builds from this plan can proceed but must guess at something that matters, or will likely redo work.',
  '- 4 to 6.9: whoever builds from this plan can proceed, but part of what they build could come out wrong or incomplete.',
  '- below 4: whoever builds from this plan builds the same thing whether or not this is fixed.',
].join('\n');
// unit S: the told sentence, verbatim (the maintainer picked the "told" reading; C&C's wording, 1 Nov 2026)
const TOLD = 'In this review a rating of 4 or above holds up the sign-off until the raiser withdraws the objection or layer 3 lowers its rating below 4, in the range 7 to 10 and in the range 4 to 6.9 alike. A rating below 4 does not hold up the sign-off.';
const TOLD_PLAIN = 'In this review a rating of 4 or above holds up the sign-off until the raiser withdraws the objection, in the range 7 to 10 and in the range 4 to 6.9 alike. A rating below 4 does not hold up the sign-off.';
const RULE = `Every objection in "failures" carries a severity: a number from 1 to 10, with at most one decimal place. Rate what the problem would do to the result, not how sure you are of it:\n${ANCHORS}\n${TOLD_PLAIN}\nEvery criterion you mark FAILED must appear in "failures" with its severity; a FAILED criterion with no entry, or an entry with no severity, makes your reply unreadable.`;
const FIELD = ',\n      "severity": <a number from 1 to 10, with at most one decimal place>';
const POST_SENTENCE = `Give each new objection a severity from 1 to 10, with at most one decimal place, rated by what the problem would do to the result:\n${ANCHORS}\n${TOLD_PLAIN}`;
const POST_FIELD_OLD = '{ "criterion": "<the criterion it breaks>", "quote": "<the passage, copied exactly, or omit>", "problem": "<what is wrong>" }';
const POST_FIELD_NEW = '{ "criterion": "<the criterion it breaks>", "quote": "<the passage, copied exactly, or omit>", "problem": "<what is wrong>", "severity": <a number from 1 to 10, with at most one decimal place> }';
const REASK = (n, criterion) => `Your last reply could not be read: objection ${n} (${criterion}) has no severity, or its severity is not a number from 1 to 10 with at most one decimal place. Answer again with the JSON object the system prompt describes, and give every objection in "failures" a severity.`;
const REASK_ROW = criterion => `Your last reply could not be read: you marked the criterion (${criterion}) FAILED in your table but gave no entry for it in "failures". Answer again with the JSON object the system prompt describes, with an entry in "failures", and a severity on it, for every criterion you mark FAILED.`;
const REASK_NONE = 'Your last reply could not be read: it says the draft does not meet the criteria but names no objection. Answer again with the JSON object the system prompt describes, with every objection in "failures" and a severity on each.';
const ANCHOR = 'Reply with a single JSON object and nothing else:';

// ---- the unwired texts
const RETAG = 'You may change the severity of an objection shown in the ledger if you judge it wrong. Add "retags": [{ "id": "<objection id>", "severity": <a number from 1 to 10, with at most one decimal place>, "reason": "<why, one or two sentences>" }]. A reason is required. Leave "retags" out when you change nothing.';

// =========================================================================================================================================================================================
// The 24 non-persona digests were taken on the merged tip before roles.js was touched by unit V; the 25 persona-variant digests were RE-TAKEN on 1 Nov 2026 after the name-ban sentence was removed from every persona block on his word (P2), and again after his catch sentence was removed from every persona block (P3, 1 Nov 2026: "That sentence was for your understanding of how THC works, not as a wording to throw into the judges prompts."), so they pin the persona block as it is now.
test('PIN, switch off: every criticSystem / layer-exchange / persona variant is byte-identical to the merged tip before this unit (digests taken before roles.js was touched)', () => {
  const want = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'severity-wording-pins.json'), 'utf8'));
  const got = {};
  const freedoms = { none: undefined, criteriaKinds: { criteriaKinds: true }, fenced: { fencedSource: true }, notFenced: { fencedSource: false }, selfReview: { selfReview: true }, blockingQuestions: { blocking_questions: true }, pass: { pass: true }, bqPass: { blocking_questions: true, pass: true }, fencedKinds: { fencedSource: true, criteriaKinds: true } };
  for (const open of [false, true]) for (const [k, f] of Object.entries(freedoms)) got[`criticSystem open=${open} ${k}`] = sha(f === undefined ? R.criticSystem(open) : R.criticSystem(open, f));
  for (const again of [false, true]) { got[`layerDebateSystem again=${again}`] = sha(R.layerDebateSystem(again)); got[`layerReplySystem again=${again}`] = sha(R.layerReplySystem(again)); }
  got.LAYER_DEBATE_SYSTEM = sha(R.LAYER_DEBATE_SYSTEM); got.LAYER_REPLY_SYSTEM = sha(R.LAYER_REPLY_SYSTEM);
  const mk = (persona, form, name_only) => ({ cfg: { signoff: 'unanimous', judge_personas: { enabled: true, form, ...(name_only ? { name_only } : {}) } }, seat: { provider: 'mock', model: 'm', lab: 'a', layer: 3, persona } });
  for (const [persona, form, no] of [['Melchizedek', 'voice'], ['Melchizedek', 'method'], ['Moses', 'method'], ['Livia', 'voice', ['livia']], ['Livia', 'method', ['livia']]]) {
    const { cfg, seat } = mk(persona, form, no); const tag = `${persona} ${form}${no ? ' name_only' : ''}`;
    got[`criticPromptFor persona ${tag}`] = sha(S.criticPromptFor(seat, false, { fencedSource: false }, cfg));
    got[`layerDebateSystemFor persona ${tag} r1`] = sha(S.layerDebateSystemFor(cfg, seat, false)); got[`layerDebateSystemFor persona ${tag} r2`] = sha(S.layerDebateSystemFor(cfg, seat, true));
    got[`layerReplySystemFor persona ${tag} r1`] = sha(S.layerReplySystemFor(cfg, seat, false)); got[`layerReplySystemFor persona ${tag} r2`] = sha(S.layerReplySystemFor(cfg, seat, true));
  }
  assert.deepEqual(got, want);
  assert.equal(Object.keys(got).length, 49);
});

test('the verdict prompt with severity on: the grading rule sits before the freedoms rules and the reply format, the field sits inside the failures object, the reply-format sentence is still once; off, no trace', () => {
  const on = R.criticSystem(false, { severity: true });
  assert.ok(on.includes(RULE), 'the rule, verbatim');
  assert.ok(on.includes(`"fix": "<the smallest change that would fix it>"${FIELD} }`), 'the field after the fix field (no quote field in this variant)');
  assert.equal(on.split(ANCHOR).length, 2);
  assert.ok(on.indexOf(RULE) < on.indexOf(ANCHOR));
  const withFreedoms = R.criticSystem(false, { severity: true, blocking_questions: true, pass: true });
  assert.ok(withFreedoms.indexOf(RULE) < withFreedoms.indexOf('blocking_question') && withFreedoms.indexOf(RULE) < withFreedoms.indexOf(ANCHOR), 'the severity rule comes before the freedoms rules');
  const fenced = R.criticSystem(false, { severity: true, fencedSource: true });
  assert.ok(fenced.includes(`"quote": "<required when this objection claims something about the repository`) && fenced.indexOf('"quote"') < fenced.indexOf('"severity"'), 'the severity field follows the quote field');
  assert.doesNotMatch(R.criticSystem(false), /severity/i); assert.doesNotMatch(R.criticSystem(false, { severity: false }), /severity/i);
  // the persona block (frozen packet) still sits directly before the reply format, after the severity rule
  const cfg = { signoff: 'unanimous', severity: { enabled: true }, judge_personas: { enabled: true, form: 'method' } };
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 3, persona: 'Moses' };
  const p = S.criticPromptFor(seat, false, undefined, cfg);
  assert.ok(p.indexOf(RULE) < p.indexOf('You are judging as Moses.') && p.indexOf('You are judging as Moses.') < p.indexOf(ANCHOR) && p.endsWith('}'), 'rules, severity, persona, reply format');
});

test('the switch lives in the CHAIN only: criticPromptFor derives the flag from config.severity, never from a user\'s freedoms; the dry run prices the switch-on text; the final read asks too', () => {
  const critic = { provider: 'mock', model: 'mock-critic-a', lab: 'a', layer: 1 };
  const on = { signoff: 'unanimous', severity: { enabled: true }, seats: { critics: [critic] } };
  const off = { signoff: 'unanimous', seats: { critics: [critic] } };
  assert.ok(S.criticPromptFor(critic, false, undefined, on).includes(RULE));
  assert.equal(S.criticPromptFor(critic, false, { severity: true }, off), S.criticPromptFor(critic, false, undefined, off), 'a user\'s freedoms.severity without the switch asks for nothing');
  assert.equal(S.criticPromptFor(critic, false, { severity: true }, off), R.criticSystem(false));
  for (const label of ['panel-L1-a', 'critique-L1-a', 'final-read-L3-a']) {
    const onTexts = S.systemTextsFor(label, on, critic); const offTexts = S.systemTextsFor(label, off, critic);
    assert.ok(onTexts.every(t => t.includes(RULE)), `${label}: every priced variant carries the rule`);
    assert.ok(Math.max(...onTexts.map(t => t.length)) - Math.max(...offTexts.map(t => t.length)) >= RULE.length, `${label}: priced longer`);
  }
  assert.ok(S.finalReadSystemFor(critic, on).includes(RULE), 'the final read asks for a tag under the switch');
  assert.equal(S.finalReadSystemFor(critic, off).includes('severity'), false);
});

test('the exchange post prompt with severity on: the new-objection field and the rated sentence, in both rounds, persona-aware; off = the constants', () => {
  for (const again of [false, true]) {
    const t = R.layerDebateSystem(again, { severity: true });
    assert.ok(t.includes(POST_FIELD_NEW) && !t.includes(POST_FIELD_OLD), 'field');
    assert.ok(t.includes(POST_SENTENCE), 'sentence');
    assert.ok(t.indexOf(POST_SENTENCE) < t.indexOf(ANCHOR));
    assert.equal(t.split(ANCHOR).length, 2);
    if (again) assert.ok(t.endsWith(R.LAYER_DEBATE_AGAIN));
    assert.equal(R.layerDebateSystem(again, { severity: false }), R.layerDebateSystem(again));
  }
  const seat = { provider: 'mock', model: 'm', lab: 'a', layer: 1, persona: 'Noah' };
  const cfg = { signoff: 'unanimous', severity: { enabled: true }, judge_personas: { enabled: true, form: 'voice' } };
  const t = S.layerDebateSystemFor(cfg, seat, false);
  assert.ok(t.indexOf(POST_SENTENCE) < t.indexOf('voice of Noah') && t.indexOf('voice of Noah') < t.indexOf(ANCHOR), 'rated sentence, persona block, reply format');
  assert.equal(S.layerDebateSystemFor({ signoff: 'unanimous' }, seat, false), R.layerDebateSystem(false));
  assert.equal(S.layerReplySystemFor(cfg, { ...seat, persona: undefined }, false), R.layerReplySystem(false), 'the answer prompt has no severity field');
});

test('normaliseCritique names what is missing: a verdict unreadable for a missing tag carries severityGap { n, criterion } and the same verdict without the switch carries none', () => {
  const v = { meets: false, criteria: [], failures: [{ criterion: 'It states the assumptions.', problem: 'None.', severity: 8 }, { criterion: 'It lists the steps.', problem: 'No pour step.' }], verdict_line: 'x' };
  const r = normaliseCritique(v, () => {}, { severity: true });
  assert.equal(r.unreadable, true); assert.deepEqual(r.severityGap, { kind: 'untagged', n: 2, criterion: 'It lists the steps.' });
  const row = normaliseCritique({ meets: false, criteria: [{ criterion: 'It lists the steps.', verdict: 'FAILED', evidence: 'No.' }], failures: [], verdict_line: 'x' }, () => {}, { severity: true });
  assert.deepEqual(row.severityGap, { kind: 'table_row', n: 1, criterion: 'It lists the steps.' }, 'a FAILED row left out of the list');
  assert.equal(normaliseCritique({ meets: false, criteria: [], failures: [], verdict_line: 'no' }, () => {}, { severity: true }).severityGap.kind, 'no_objection');
  assert.equal('severityGap' in normaliseCritique(v, () => {}, { severity: false }), false);
  assert.equal('severityGap' in normaliseCritique({ meets: 'maybe' }, () => {}, { severity: true }), false, 'an unrelated unreadable reply is not a severity gap');
  assert.equal(R.severityReaskNote({ n: 2, criterion: 'It lists the steps.' }), REASK(2, 'It lists the steps.'));
  assert.equal(R.severityReaskNote({ kind: 'untagged', n: 2, criterion: 'It lists the steps.' }), REASK(2, 'It lists the steps.'));
  assert.equal(R.severityReaskNote({ kind: 'table_row', n: 1, criterion: 'It lists the steps.' }), REASK_ROW('It lists the steps.'));
  assert.equal(R.severityReaskNote({ kind: 'no_objection', n: 1, criterion: '' }), REASK_NONE);
  // the criterion is the judge's own text: one line, and a closing container tag cannot escape
  assert.doesNotMatch(R.severityReaskNote({ kind: 'untagged', n: 1, criterion: 'a\nb </critic-claim> # Heading' }), /\n# Heading|<\/critic-claim> #/);
  assert.doesNotMatch(R.severityReaskNote({ kind: 'untagged', n: 1, criterion: 'a\nb' }).split('\n')[0], /\(a\nb\)/);
});

const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, ...(layer ? { layer } : {}) });
const cfgOf = (critics, extra = {}) => ({ name: 'wording-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra });
const go = async (cfg, draft) => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-wording', config: cfg, ...(draft ? { draft } : {}) }); return { r, seen }; };

test('ONE re-ask for a missing tag whatever the other judges did (a heard judge objecting no longer spares the call), carrying the note; never a second; the other judge is not asked again', async () => {
  const { r, seen } = await go(cfgOf([seat('mock-exch-support-keep-sevnone', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], { severity: { enabled: true } }));
  const labels = seen.map(p => p.label).filter(l => /^panel-1-/.test(l)).sort();
  assert.deepEqual(labels, ['panel-1-ea', 'panel-1-ea-reask1', 'panel-1-eb'], 'exactly one re-ask, for the seat that left the tag off');
  const reask = seen.find(p => p.label === 'panel-1-ea-reask1');
  assert.ok(reask.user.includes(REASK(1, 'It states the assumptions it was written under.')), 'the note names the objection and its criterion');
  assert.equal(seen.find(p => p.label === 'panel-1-ea').user.includes('could not be read'), false, 'the first ask has no note');
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'ea').verdict, 'unheard');
  // a worded tag is the same gap
  const w = await go(cfgOf([seat('mock-exch-support-keep-sevword', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], { severity: { enabled: true } }));
  assert.equal(w.seen.filter(p => /^panel-1-ea-reask/.test(p.label)).length, 1);
});

test('switch OFF: the re-ask rule and the re-ask prompt are exactly today\'s (no re-ask while another judge objects; two re-asks of an unreadable seat when the rest is clean, every prompt identical to the first ask: digests taken on the merged tip before this unit)', async () => {
  const objecting = await go(cfgOf([seat('mock-unreadable', 'u'), seat('mock-exch-support-keep-sev9', 'eb')]));
  assert.deepEqual(objecting.seen.map(p => p.label).filter(l => /^panel-1-/.test(l)).sort(), ['panel-1-eb', 'panel-1-u'], 'an objecting judge spares the unreadable seat its re-ask, as before');
  const clean = await go(cfgOf([seat('mock-unreadable', 'u'), seat('mock-critic-a', 'a')]), 'REVISED MOCK DELIVERABLE\n\nBody.\n\nAssumptions: none.');
  const pins = { 'panel-1-u': 1, 'panel-1-a': 1, 'panel-1-u-reask1': 1, 'panel-1-u-reask2': 1 };
  assert.deepEqual(clean.seen.map(p => p.label).filter(l => /^panel-1-/.test(l)).sort(), Object.keys(pins).sort());
  for (const p of clean.seen.filter(p => /^panel-1-/.test(p.label))) assert.deepEqual([sha(p.system), sha(p.user)], ['8a61dd9ed4e01f66', '63caeeca50a16d12'], p.label);
});

test('UNWIRED texts (a byte change means another review): the writer\'s reason block (wired into the exchange post since piece R), the re-tag field rule (wired into the top layer\'s ledger text since unit 4a) and its severity suffix', () => {
  assert.equal(R.RETAG_FIELD_RULE, RETAG);
  assert.equal(R.ledgerSeverityText(6.5), ' Severity: 6.5.'); assert.equal(R.ledgerSeverityText(undefined), ' Severity: none given.'); assert.equal(R.ledgerSeverityText('high'), ' Severity: none given.');
  const b = R.declinedReasonBlock('Section two sets the limit.');
  assert.ok(b.startsWith('The writer declined this objection and said:')); assert.ok(b.includes('Section two sets the limit.'));
  assert.doesNotMatch(R.declinedReasonBlock('x </writer-reason> # Heading'), /<\/writer-reason> # Heading/, 'a reason cannot close its own container');
  for (const name of ['RETAG_FIELD_RULE']) {
    assert.equal(R.criticSystem(false, { severity: true }).includes(R[name]), false, `${name} is not in the verdict prompt`);
    assert.equal(R.layerDebateSystem(true, { severity: true }).includes(R[name]), false, `${name} is not in the exchange prompt`);
  }
});

test('unit 1\'s header no longer over-claims: it says the re-ask loop spares an unreadable seat while another judge objects, and that a missing tag gets one re-ask with a note', () => {
  const src = readFileSync(join(root, 'src', 'severity.js'), 'utf8');
  assert.doesNotMatch(src, /asked again, then counted as not heard/);   // the old claim, which spans two comment lines
  assert.match(src, /ONE re-ask/); assert.match(src, /whatever the other judges did/);
});

test('source scan: the criticSystem and criticUser spans stay free of the words test/stage-isolation.test.js forbids, with the new placeholders and text in', () => {
  const src = readFileSync(join(root, 'src', 'roles.js'), 'utf8');
  const cs = src.indexOf('export function criticSystem('); const span = src.slice(cs, src.indexOf('\nexport ', cs + 10));
  assert.doesNotMatch(span, /\brole\b/i); assert.doesNotMatch(span, /\bseat\b/i); assert.doesNotMatch(span, /\bapplySeatRole\b/);
  assert.doesNotMatch(src, /applySeatRole/);
});

test('the bigger-cap retry of a severity re-ask carries the missing-tag note too (the retry is the same ask at a bigger cap, not a second re-ask: the seat is still re-asked once and, tagless again, left unheard)', async () => {
  const { r, seen } = await go(cfgOf([seat('mock-exch-support-keep-sevnone-cutreask-t1', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], { severity: { enabled: true } }));
  assert.deepEqual(seen.map(p => p.label).filter(l => /^panel-1-ea/.test(l)).sort(), ['panel-1-ea', 'panel-1-ea-reask1', 'panel-1-ea-reask1-retry'], 'one re-ask and its cut-off retry, no second re-ask');
  const note = REASK(1, 'It states the assumptions it was written under.');
  assert.ok(seen.find(p => p.label === 'panel-1-ea-reask1').user.includes(note), 'the re-ask carries the note');
  assert.ok(seen.find(p => p.label === 'panel-1-ea-reask1-retry').user.includes(note), 'the retry of the re-ask carries it too');
  assert.equal(seen.find(p => p.label === 'panel-1-ea').user.includes('could not be read'), false);
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'ea').verdict, 'unheard');
});

// ---- unit S: the told sentence, and the removal of the accept-stance texts (the count rule was withdrawn on the maintainer's word, 1 Nov 2026)

const sha16 = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const VARIANT_DIGESTS = {
  "told_ledger": "e5a304c489a7dfc9",
  "told_plain": "bbd8855d4dcd4598",
  "verdict_ledger": "5d1bc648f91e091d",
  "verdict_plain": "608137a10e578103",
  "post_r1_ledger": "617c3d7725962a09",
  "post_r1_plain": "91ca453b339f41a9",
  "post_r2_ledger": "86f47193b4a27f9e",
  "post_r2_plain": "e85bc74ad9b8c3ed"
};

test('S: the told sentence has TWO variants (tree truth is per chain): with a ledger for the top layer it names layer 3 lowering a rating, without one it stops at the raiser withdrawing; both reach the verdict prompt and the exchange post prompt after the anchors, neither with the switch off; neither names a closing round, a handler or a climb', () => {
  assert.equal(R.SEVERITY_TOLD, TOLD); assert.equal(R.SEVERITY_TOLD_PLAIN, TOLD_PLAIN);
  for (const [ledger, told] of [[true, TOLD], [false, TOLD_PLAIN]]) {
    const opts = { severity: true, ...(ledger ? { severityLedger: true } : {}) };
    assert.ok(R.criticSystem(false, opts).includes(`${R.SEVERITY_ANCHORS}\n${told}\nEvery criterion you mark FAILED`), `verdict prompt (ledger ${ledger}): directly after the anchors, before the FAILED rule`);
    for (const again of [false, true]) assert.ok(R.layerDebateSystem(again, opts).includes(`${R.SEVERITY_ANCHORS}\n${told}`), `exchange post prompt (ledger ${ledger}, round ${again ? '2+' : '1'})`);
    assert.doesNotMatch(told, /closing|handler|climb|layer above|go up/i, 'it describes only what the code does today');
  }
  assert.doesNotMatch(TOLD_PLAIN, /layer 3/, 'no ledger, no re-tag: the plain variant does not say it');
  assert.equal(R.criticSystem(false).includes('In this review a rating of 4'), false, 'switch off: not in the verdict prompt');
  for (const again of [false, true]) assert.equal(R.layerDebateSystem(again).includes('In this review a rating of 4'), false, 'switch off: not in the exchange prompt');
});

test('S: the variant is chosen PER CHAIN by whether the top layer can be shown a ledger (a layered chain with answer_back and two or more layers): B3\'s shape and a two-layer chain say it; an unlayered panel, one layer, or a layered chain without answer_back stop at the withdrawal; the exchange post and the final read follow the same chain rule', () => {
  const critic = (lab, layer) => ({ provider: 'mock', model: 'm', lab, ...(layer === undefined ? {} : { layer }) });
  const cfg = (critics, extra = {}) => ({ signoff: 'unanimous', severity: { enabled: true }, answer_back: { enabled: true }, seats: { critics }, ...extra });
  const says = c => S.criticPromptFor(c.seats.critics[0], false, undefined, c).includes(TOLD);
  const plain = c => S.criticPromptFor(c.seats.critics[0], false, undefined, c).includes(TOLD_PLAIN) && !S.criticPromptFor(c.seats.critics[0], false, undefined, c).includes('layer 3 lowers');
  assert.equal(S.severityLedgerPossible(cfg([critic('a', 1), critic('b', 2), critic('c', 3)])), true);
  assert.equal(says(cfg([critic('a', 1), critic('b', 2), critic('c', 3)])), true, 'three layers with answer_back (B3)');
  assert.equal(says(cfg([critic('a', 1), critic('b', 2)])), true, 'two layers with answer_back');
  assert.equal(plain(cfg([critic('a', 1), critic('b', 1)])), true, 'one layer');
  assert.equal(plain(cfg([critic('a'), critic('b')])), true, 'an unlayered panel');
  assert.equal(plain(cfg([critic('a', 1), critic('b', 2), critic('c', 3)], { answer_back: undefined })), true, 'a layered chain without answer_back: no ledger');
  const b3 = cfg([critic('a', 1), critic('b', 2), critic('c', 3)]); const one = cfg([critic('a', 1), critic('b', 1)]);
  assert.ok(S.layerDebateSystemFor(b3, b3.seats.critics[0], false).includes(TOLD) && S.layerDebateSystemFor(one, one.seats.critics[0], false).includes(TOLD_PLAIN), 'the exchange post follows the chain');
  assert.ok(S.finalReadSystemFor(b3.seats.critics[2], b3).includes(TOLD) && S.finalReadSystemFor(one.seats.critics[0], one).includes(TOLD_PLAIN), 'the final read follows the chain');
});

test('S: one digest pin per variant (the told sentences, the verdict prompt and the four exchange post prompts, with and without a ledger)', () => {
  const got = {
    told_ledger: sha16(R.SEVERITY_TOLD), told_plain: sha16(R.SEVERITY_TOLD_PLAIN),
    verdict_ledger: sha16(R.criticSystem(false, { severity: true, severityLedger: true })), verdict_plain: sha16(R.criticSystem(false, { severity: true })),
    post_r1_ledger: sha16(R.layerDebateSystem(false, { severity: true, severityLedger: true })), post_r1_plain: sha16(R.layerDebateSystem(false, { severity: true })),
    post_r2_ledger: sha16(R.layerDebateSystem(true, { severity: true, severityLedger: true })), post_r2_plain: sha16(R.layerDebateSystem(true, { severity: true })),
  };
  assert.deepEqual(got, VARIANT_DIGESTS);
});

test('the one-seat-layer lint says why in true words: a layer with one seat runs no exchange, so nobody could debate an objection there; it names no Council count', () => {
  const lone = lintSeverityChain({ signoff: 'unanimous', severity: { enabled: true }, seats: { critics: [{ layer: 1 }, { layer: 1 }, { layer: 2 }] } }, 'chain.json').find(x => x.kind === 'severity-one-seat-layer');
  assert.ok(lone, 'layer 2 has one seat');
  assert.match(lone.message, /runs no exchange/); assert.match(lone.message, /withdrew it/); assert.doesNotMatch(lone.message, /more than half|Council/i);
});

test('S: the accept-stance texts and the head-count helpers are gone (the count rule was withdrawn): no export, no sentence in any prompt, no council path in the contract', async () => {
  for (const name of ['LAYER_DEBATE_ACCEPT_STANCE', 'LAYER_DEBATE_COUNT_SCOPED', 'LAYER_REPLY_COUNT_SCOPED']) assert.equal(R[name], undefined, name);
  const Sev = await import('../src/severity.js');
  for (const name of ['COUNCIL_ACCEPT', 'councilAccepts']) assert.equal(Sev[name], undefined, name);
  for (const t of [R.criticSystem(false, { severity: true }), R.layerDebateSystem(false, { severity: true }), R.layerDebateSystem(true, { severity: true }), R.layerReplySystem?.(false, { severity: true }) ?? '']) {
    assert.doesNotMatch(t, /- accept: the writer declined|if more than half of the other reviewers|Council accepts/i);
  }
  // settleStateOf keeps every route that exists: the raiser's exchange withdrawal, an answered withdrawal with a quote from the draft, and nothing else settles
  assert.equal(Sev.settleStateOf({ exchange: 'withdrawn' }), 'withdrawn');
  assert.equal(Sev.settleStateOf({ answer: { effect: 'withdrawn', quoted: true } }), 'fixed');
  assert.equal(Sev.settleVerdict(8, 'council_accepted'), 'open', 'the removed state settles nothing');
  assert.equal(Sev.settleVerdict(5, 'council_accepted'), 'open');
  const src = readFileSync(join(root, 'src', 'severity.js'), 'utf8'); assert.doesNotMatch(src, /dissent/i);
});
