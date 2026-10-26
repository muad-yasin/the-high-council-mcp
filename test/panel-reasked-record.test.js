// 0.8.3 reasked fix (C&C gate note 1, 14 Oct 2026; defect found at 38f3314): panelVerdicts[].reasked says whether a re-ask CALL was made for the seat that round. It used to be copied from "the seat was unheard on its first ask", so a seat
// that was unheard but never re-asked (another judge of the round objected, so there was nothing left to decide) was recorded as asked again. $0, offline: every reply comes from a label-keyed cache; the chain is the shipped shape (unlayered,
// signoff_table.required on, so a sign-off without a table is an abstention with INCOMPLETE_TABLE).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';

afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); });

const criterion = 'The plan defines a retry limit.';
const failure = { criterion, problem: 'No retry limit is specified.', fix: 'Specify one.' };
const DRAFT = 'The worker retries failed requests.';
const signoff = JSON.stringify({ meets: true, criteria: [{ criterion, verdict: 'MET', evidence: 'The draft sets a retry limit.' }], failures: [], verdict_line: 'ok' });
const objects = JSON.stringify({ meets: false, criteria: [{ criterion, verdict: 'FAILED', evidence: 'No limit appears.' }], failures: [failure], verdict_line: 'no' });
const NO_TABLE = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok' }); // a sign-off without its per-criterion table
const UNREADABLE = 'I could not finish my review';

async function run(replies) {
  const served = [];
  setBudget(null);
  setPromptSpy(() => {});
  setCache({ get(label) {
    served.push(label);
    return { text: label.startsWith('panel-') ? (replies(label) ?? signoff) : DRAFT, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = lab => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000 });
  const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-reasked', log: () => {}, config: {
    name: 'fixture-reasked', criteria: [criterion], maxRounds: 1, signoff: 'unanimous', signoff_table: { required: true },
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('la'), seat('lb')] },
  } });
  const row = lab => r.panelVerdicts.find(v => v.round === 1 && v.lab === lab);
  return { r, served, row };
}

test('reasked: a seat unheard for an incomplete table that is NEVER re-asked (la objected, nothing left to decide) is recorded reasked false', async () => {
  const { served, row } = await run(label => (label === 'panel-1-la' ? objects : label === 'panel-1-lb' ? NO_TABLE : undefined));
  assert.equal(served.some(l => /^panel-1-lb-reask/.test(l)), false, 'fixture: lb really was not re-asked (else this test shows nothing)');
  assert.equal(row('lb').verdict, 'unheard');
  assert.equal(row('lb').reason_code, 'INCOMPLETE_TABLE');
  assert.equal(row('lb').reasked, false);
});

test('reasked: an unreadable first reply that is never re-asked is recorded reasked false', async () => {
  const { served, row } = await run(label => (label === 'panel-1-la' ? objects : label === 'panel-1-lb' ? UNREADABLE : undefined));
  assert.equal(served.some(l => /^panel-1-lb-reask/.test(l)), false, 'fixture: no re-ask call');
  assert.equal(row('lb').reasked, false);
});

test('reasked: a seat that WAS re-asked is recorded reasked true, whether the re-ask is heard or still unreadable; a seat heard at once is false', async () => {
  const heard = await run(label => (label === 'panel-1-lb' ? UNREADABLE : undefined));
  assert.ok(heard.served.includes('panel-1-lb-reask1'), 'fixture: the re-ask call was made');
  assert.equal(heard.row('lb').verdict, 'signed_off');
  assert.equal(heard.row('lb').reasked, true);
  assert.equal(heard.row('la').reasked, false, 'la was heard at once');
  const lost = await run(label => (/^panel-1-lb/.test(label) ? UNREADABLE : undefined));
  assert.ok(lost.served.includes('panel-1-lb-reask1') && lost.served.includes('panel-1-lb-reask2'), 'fixture: both re-asks were made');
  assert.equal(lost.row('lb').verdict, 'unheard');
  assert.equal(lost.row('lb').reasked, true);
});
