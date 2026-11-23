// 0.8.4 S6 (M1), U6-2: the shortened exchange meets the stall escalation (T6a, Q5, Q6). A layer-1 stall passes the plan up; layer 2 reviews blind, its judges' own objections draw the shortened exchange, and the passed-up objection is ruled on (F8)
// and NOT debated. Offline, $0: the cache stub answers every stage by its label (the pattern of test/stall-escalation.test.js), so the judges object, post, reply and rule exactly when the script says. WRITTEN WITHOUT A RUN (overnight, no box).
// The exchange runs BEFORE the ruling in a pass (chain.js layerExchange, then ruleOnEscalation): the order is kept and pinned here, with its one consequence (the collision row: the later act counts, C&C's ruling).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import * as HESC from './held-prompts/held-escalation.js';
import * as HB084 from './held-prompts/held-084-b.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8')));
const RULING_WORDS = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection, ...DEMAND };   // 0.8.4 SG-1 (C&C 08 Nov 2026): the stall climb needs the rating demand; the objections below are rated 5 (holds the sign-off, never closes on an overrule: what the unrated ones did)
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const X = { relation: 'new', severity: 5, criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const LOW = 'raiser-alpha';
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures carried no relation. NEW: each carries relation 'new'; raiser-alpha's second raise of X (BASE, pass 2) carries `continues <id>`. WHY: relationRule is recorded (src/chain.js:5462); a `new` on a standing id mints #2 and the stall never fires.
const repeats = (lab, f) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const idX = objectionId(LOW, X);
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const rules = list => JSON.stringify({ rulings: list });
const BASE = { 'panel-1-raiser-alpha': objects(X), 'panel-2-raiser-alpha': objects(repeats(LOW, X)), 'revise-1': `${DRAFT}\n\nRevision 1.\n\nDECLINED: ${idX}: The limit is set in section two.` };

async function run({ held = { ...RULING_WORDS, ...PAIR }, answers = {} } = {}) {
  const served = []; const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(held);
  const script = { ...BASE, ...answers };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return script[label] === null ? null : { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = {
    name: 'fixture-short-exchange-sentup', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 6,
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat('mid-beta', 2), seat('mid-delta', 2), seat('top-gamma', 3)] },   // two layer-2 judges: the shortened exchange needs two heard
  };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-short-sentup', log: () => {}, config });
  return { result, served, prompts, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-short-sentup', chain: 'fixture-short-exchange-sentup', task: 't.md', result, config }))) };
}
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');
const both = (id, ruling = 'overrule') => ({ 'rule-3-mid-beta': rules([{ id, ruling, reason: 'Section two sets the limit.' }]), 'rule-3-mid-delta': rules([{ id, ruling: 'overrule', reason: 'Section two sets the limit.' }]) });

test('T6a: layer 2 with one sent-up objection ruled on under F8 and one new objection of a layer-2 judge: the shortened exchange has one round on the new objection only; the sent-up objection (and any adopted copy of it) gets no exchange outcome and exactly one F8 outcome', async () => {
  const Y = { relation: 'new', severity: 5, criterion: CRITERION, problem: 'The retry limit is unreasonable.', quote: 'The worker retries' };
  const idY = objectionId('mid-beta', Y);
  assert.notEqual(idY, objectionId('mid-beta', X), 'the premise: the layer-2 objection is not the adopted form of the sent-up one');
  const { served, report } = await run({ answers: {
    'panel-3-mid-beta': objects(Y),
    'ldebate-3-mid-delta': JSON.stringify({ posts: [{ on: idY, stance: 'support', text: 'It holds against the criteria.' }], new_objections: [] }),
    'lreply-3-mid-beta': `${JSON.stringify({ replies: [{ id: idY, action: 'keep', text: 'The posts do not change it.' }] })}\nsign-off: no`,
    ...both(idX),
  } });
  const row = (report.layer_debates || []).find(d => d.layer === 2 && d.pass === 3);
  assert.ok(row, 'a layer_debates row at layer 2 in pass 3');
  assert.deepEqual(row.objections.map(o => o.id), [idY], 'the round holds the layer-2 judge\'s own objection and nothing else');
  assert.equal(row.rounds.length, 1);
  // CHANGED (box run of 08 Nov 2026, found by reading): the scan covered EVERY layer_debates row, including a layer-1 row (`not_run: fewer_than_two_heard`, chain.js) that lists the layer-1 raiser's own idX; "a sent-up objection is not debated" is about the rows of the layers ABOVE layer 1.
  const everyId = (report.layer_debates || []).filter(d => d.layer >= 2).flatMap(d => d.objections.map(o => o.id));
  for (const forbidden of [idX, objectionId('mid-beta', X), objectionId('mid-delta', X)]) assert.equal(everyId.includes(forbidden), false, `${forbidden}: a sent-up objection (or its adopted form) is not debated`);
  assert.deepEqual(served.filter(l => /^(ldebate|lreply)-3-/.test(l)).sort(), ['ldebate-3-mid-delta', 'lreply-3-mid-beta'], 'the exchange calls of the pass: the other judge posts, the raiser replies once');
  assert.equal(report.escalations[0].outcome.filter(o => o.id === idX).length, 1, 'one F8 outcome for the sent-up objection');
  assert.equal(report.escalations[0].outcome.find(o => o.id === idX).result, 'overruled');
  assert.equal(row.signoffs[0].line, 'no', 'and the line the raiser ended with is in the record');
  assert.ok(served.indexOf('lreply-3-mid-beta') < served.indexOf('rule-3-mid-beta'), 'the exchange runs before the ruling in a pass (the order is pinned)');
});

test('Q6 (collision; C&C\'s ruling: the later act counts): a layer-2 judge that withdraws its own objection in the exchange and sustains a sent-up objection with the SAME id in the same pass holds it again: the sustain adopts it, layer 2 is made to object by it, and both acts are on the record', async () => {
  const Y2 = { relation: 'new', severity: 5, criterion: CRITERION, problem: 'Layer two sees no limit either.', quote: X.quote };
  const idY2 = objectionId('mid-beta', Y2);
  assert.equal(idY2, objectionId('mid-beta', X), 'the premise: its own objection has the id the adopted copy of the sent-up one gets (seat, criterion and quote)');
  const { report, prompts } = await run({ answers: {
    'panel-3-mid-beta': objects(Y2),
    'ldebate-3-mid-delta': JSON.stringify({ posts: [{ on: idY2, stance: 'support', text: 'It holds against the criteria.' }], new_objections: [] }),
    'lreply-3-mid-beta': JSON.stringify({ replies: [{ id: idY2, action: 'withdraw', text: 'The quoted passage settles it.', quote: 'retries failed requests' }] }),
    'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'It stands.' }]),
    'rule-3-mid-delta': rules([{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }]),
  } });
  const row = (report.layer_debates || []).find(d => d.layer === 2 && d.pass === 3);
  assert.equal(row.objections.find(o => o.id === idY2).outcome, 'withdrawn_argued', 'act 1, on the record: the exchange withdrew it');
  assert.deepEqual(row.cleared, ['mid-beta'], 'and the exchange row keeps that it cleared the judge, for its time');
  const out = report.escalations[0].outcome.find(o => o.id === idX);
  assert.equal(out.result, 'sustained');
  assert.deepEqual(out.adopted_as, [{ lab: 'mid-beta', seat: 'mid-beta', id: idY2, withdrawn_in_exchange: true }], 'act 2, on the record: the sustain took it over, and the entry says the seat had withdrawn it that pass');
  assert.ok(states(report).includes('3.2:objected'), `the layer\'s state is decided after the ruling, so the re-adoption reaches it: ${states(report)}`);
  assert.ok(states(report).includes('3.3:not_asked'), 'and layer 3 is not asked in that pass');
  const next = prompts.get('panel-4-mid-beta');
  assert.ok(next, 'the premise: the seat is asked again in pass 4');
  assert.equal(`${next.system}\n${next.user}`.includes('# Objections you withdrew in your layer\'s exchange'), false, 'the seat holds it again, so it is not listed to it as withdrawn ("These objections are not open")');
  assert.equal(validate(report), true, `the flag is declared in the schema: ${JSON.stringify((validate.errors || []).slice(0, 3))}`);
  const bad = JSON.parse(JSON.stringify(report));
  bad.escalations[0].outcome.find(o => o.id === idX).adopted_as[0].withdrawn_in_exchange = 'yes';
  assert.equal(validate(bad), false, 'and a value that is not a boolean is rejected (known-bad input)');
});

// REMOVED (0.8.4 apply, K7): 'PIN (held): without the pair a layer-2 judge's objection in a pass that ruled draws no exchange'. It ran `run({ held: RULING_WORDS, ... })` with no PAIR and expected no ldebate-3-/lreply-3- call. Job 12: actual ['ldebate-3-mid-delta', 'lreply-3-mid-beta'] (the exchange ran). shortExchangeRule and signoffLineRule (W5, W14) are recorded (src/roles.js), so a map without them falls through to the recorded words and the shortened exchange is on (src/stage-system.js:193 shortExchangeOn); the held-off state cannot be built without a HELD_OFF map, which is banned for 0.8.4 names. Sibling (same file): 'T6a' (the pair in force: the shortened exchange has one round on the new objection only, the sent-up objection gets none) and 'Q6' (the collision row).
