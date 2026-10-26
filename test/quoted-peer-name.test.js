// CR-6A-004 (25 Okt 2026): when a judge withdraws an objection by quoting a peer of its layer, the record's `quoted_ref` and the overseer ledger line "(quoting ...)" named the peer by its internal SEAT KEY (`la-l2` for a model repeated on a second layer),
// against the rule that a key is never shown (src/seat-key.js). Now the record shows the lab (`quoted_layer` beside it says which layer), and the ledger line names the peer like every other seat in text a model reads: the lab plus " (layer N)".
// In-process, cache-fed replies, offline, $0. Layer 1 = la; layer 2 = la again (the same model: key la-l2) and lb; layer 3 = lc. lb objects in round 1, is silent in round 2 and withdraws on a re-ask by quoting la-l2's MET row; lc objects in round 2, so a round 3 shows lc the ledger.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const EV = 'Section two sets the retry limit to five attempts.';
const meets = (ev, extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: ev }], failures: [], verdict_line: 'ok', ...extra });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const EV_A = 'Section one lists the retry limit as a number.';   // what the layer-1 seat of the same model writes: a quote of EV can only be the layer-2 seat's
const Y = { criterion: CRITERION, problem: 'Nobody owns the retry limit.', fix: 'Name an owner.' };
const Z = { criterion: CRITERION, problem: 'The limit has no unit.', fix: 'Give it a unit.' };
const idY = objectionId('lb', Y);

async function scenario() {
  setHeldForTest({ criticStatedPassNote: H.criticStatedPassNote, otherReviewersBlock: H.otherReviewersBlock, overseerLedgerSection: H.overseerLedgerSection, ledgerOverflowExit: H.ledgerOverflowExit });
  const hashes = new Map(); const prompts = [];
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.push({ label: p.label, text: `${p.system}\n${p.user}` }); });
  const reply = label => (/^panel-\d-la$/.test(label) ? meets(EV_A)
    : label === 'panel-1-la-l2' ? meets(EV)
    : label === 'panel-1-lb' ? objects(Y)
      : label === 'panel-2-lc' ? objects(Z)
        : label === 'panel-2-lb' ? JSON.stringify({ pass: true, pass_reason: 'I would rather not judge this round.' })
          : label === 'panel-2-lb-reask1' ? meets('Checked it again.', { answers: [{ id: idY, status: 'withdrawn', evidence: `\`${EV}\`` }] })
            : undefined);
  setCache({ invalidate() {}, get(label) {
    const text = label.startsWith('panel-') ? (reply(label) ?? meets(EV)) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-qp', criteria: [CRITERION], maxRounds: 4, signoff: 'unanimous', answer_back: { enabled: true }, freedoms: { pass: true },
    seats: { builder: { provider: 'mock', model: 'mock-review-fixture', lab: 'writer', maxTokens: 3000 }, reviser: { provider: 'mock', model: 'mock-review-fixture', lab: 'writer', maxTokens: 3000 }, critics: [seat('la', 1), seat('la', 2), seat('lb', 2), seat('lc', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-qp', log: () => {}, config });
  return { result, prompts, config };
}

test('QP-1a (CR-6A-004, the record): a quoted peer on a repeated-model layer is recorded by its lab, with its layer beside it, never by its seat key', async () => {
  const { result, config } = await scenario();
  const quoting = result.answerBackReplies.filter(r => r.quoted_from === 'reviewer');
  assert.equal(quoting.length, 1, `precondition: lb withdrew by quoting its peer (${JSON.stringify(result.answerBackReplies.map(r => [r.round, r.lab, r.effect]))})`);
  assert.equal(quoting[0].quoted_ref, 'la', 'the record names the LAB');
  assert.equal(quoting[0].quoted_layer, 2, 'and the layer beside it');
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-qp', chain: 'fixture-qp', task: 't.md', result, config })));
  assert.ok(report.answer_back_replies.every(r => r.quoted_ref === undefined || !/-l\d/.test(r.quoted_ref)), 'no seat key in report.json quoted_ref');
});

test('QP-1b (CR-6A-004, the ledger a model reads): the top layer\'s ledger names the quoted peer as the lab plus " (layer 2)", never the seat key', async () => {
  const { prompts } = await scenario();
  const ledgerPrompts = prompts.filter(p => p.text.includes('# The objection ledger') && /quoting/.test(p.text));
  assert.ok(ledgerPrompts.length >= 1, `precondition: a later round showed the ledger with the quoting line (${prompts.filter(p => p.text.includes('# The objection ledger')).map(p => p.label)})`);
  for (const p of ledgerPrompts) {
    assert.match(p.text, /\(quoting la \(layer 2\)\)/, `${p.label}: the quoted peer is the lab plus its layer`);
    assert.doesNotMatch(p.text, /\bla-l\d\b/, `${p.label}: no seat key`);
  }
});
