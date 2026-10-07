// Wiring item (2a), the door: a judge re-asked because its sign-off table was refused is told what the table lacked - an API seat too - and its reply to that is accepted. The sentence is held
// (src/held-roles.js, drafted in test/held-prompts/held.js); until the re-record an API seat's re-ask is the same prompt as before. $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as H from './held-prompts/held.js';
import * as R from '../src/roles.js';
const RECORDED = Object.keys(H).some(n => n in R);
const BEFORE = { skip: RECORDED && 'the sentences are recorded in src/roles.js: this test describes the state before the re-record' };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
afterEach(() => { setHeldForTest(null); setPromptSpy(null); });

const tableChain = (model, extra = {}) => {
  const base = chain('mock-unanimous');
  return { ...base, maxRounds: 2, signoff_table: { required: true }, ...extra, seats: { ...base.seats, critics: [{ provider: 'mock', model, lab: 'la' }, { provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'lb' }] } };
};
const go = async (model, extra) => {
  const seen = [];
  setPromptSpy(p => seen.push(p));
  const r = await runChain({ request: 'Write a short fixture deliverable.', config: tableChain(model, extra), runId: 'r-2a', log: () => {} });
  return { r, seen };
};
const NOTE = '# Your previous reply could not be counted';

test('2a: before the sentence is recorded, an API seat\'s re-ask is the same prompt (byte-identical), so a seat that keeps answering a short table stays unheard', BEFORE, async () => {
  const { r, seen } = await go('mock-critic-table-after-note');
  const asks = seen.filter(p => p.label.startsWith('panel-1-la'));
  assert.ok(asks.length >= 2, asks.map(a => a.label).join(', '));
  assert.ok(asks.every(a => !a.user.includes(NOTE)), 'no note: the prompt is untouched');
  assert.equal(asks[0].user, asks[1].user, 'the re-ask is the identical prompt');
  assert.equal(r.passed, false);
});

test('2a door: with the sentence, the re-ask of an API seat carries what the table lacked (criterion numbered as in its list), the first ask does not, and the full table it then writes is accepted', async () => {
  setHeldForTest({ criticReaskNote: H.criticReaskNote });
  const { r, seen } = await go('mock-critic-table-after-note');
  const first = seen.find(p => p.label === 'panel-1-la');
  const reask = seen.find(p => p.label === 'panel-1-la-reask1');
  assert.ok(first && reask, seen.map(p => p.label).join(', '));
  assert.equal(first.user.includes(NOTE), false, 'the first ask is untouched');
  const n = r.criteria.length;
  assert.ok(reask.user.includes(`${NOTE}\n\nIt said the draft meets the criteria, but it had no entry for criterion ${n} (numbered as in the list above).`), reask.user.slice(-500));
  assert.ok(reask.user.startsWith(first.user), 'the note is appended to the same prompt');
  assert.equal(reask.provider, 'mock');
  assert.equal(seen.some(p => p.label === 'panel-1-la-reask2'), false, 'one re-ask for a refused table');
  assert.equal(r.passed, true, 'the reply to the note is a full table with evidence: the parser accepts it and the panel signs off');
  assert.equal(r.signoffTableGaps.length, 1);
  assert.equal(r.signoffTableGaps[0].kind, 'missing_rows');
});

test('2a: the note is for a refused table only: an unreadable reply\'s re-ask gets none, and every kind of gap has its own words', async () => {
  setHeldForTest({ criticReaskNote: H.criticReaskNote });
  const cut = await go('mock-critic-cut', { maxRounds: 1 });
  assert.ok(cut.seen.filter(p => /-reask\d$/.test(p.label)).length >= 1);
  assert.ok(cut.seen.every(p => !p.user.includes(NOTE)), 'no table gap: no note');
  assert.match(H.criticReaskNote({ kind: 'no_table', ids: [1, 2, 3] }), /but it had no entry per criterion\./);
  assert.match(H.criticReaskNote({ kind: 'missing_rows', ids: [2, 5] }), /no entry for criteria 2 and 5 \(numbered as in the list above\)\./);
  assert.match(H.criticReaskNote({ kind: 'missing_rows', ids: [2, 3, 5] }), /criteria 2, 3 and 5 /);
  assert.match(H.criticReaskNote({ kind: 'no_evidence', ids: [1] }), /its entry for criterion 1 \(numbered as in the list above\) had no evidence\./);
  assert.match(H.criticReaskNote({ kind: 'unreadable_verdict', ids: [4] }), /its entry for criterion 4 .* did not say MET or FAILED\./);
  assert.equal(/table/i.test(H.criticReaskNote({ kind: 'no_table', ids: [1] })), false, 'the note never says "table": a judge could answer with a Markdown one');
});
