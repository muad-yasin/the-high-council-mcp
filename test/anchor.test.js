// 0.8.4 S14 (R22, N12, D21; C&C R510/R514/R517): the flag `unanchored` on an objection record that quotes no passage, and the count sentence on the board. ONE rule (src/anchor.js), read by reportJsonShape (the flag, on the three
// record types lastCritique.failures, signoff[].objections and layer_debates[].objections) and by renderBoardMd (the count). The flag says what the RECORD holds (no quote is recorded), true before and after W23. Offline, $0.
// Guarded: on a tree without src/anchor.js each row fails by itself at its first use, and the file still loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain } from '../src/chain.js';
import { reportJsonShape, renderBoardMd, renderPartialBoardMd } from '../src/report-shape.js';
import { readChainFile } from './helpers/chain-file.js';

const { isUnanchored, flagUnanchored, unanchoredCount, unanchoredOf, anchorSentence } = await import('../src/anchor.js').catch(() => ({}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = rel => readFileSync(resolve(root, 'src', rel), 'utf8');
const holdout = () => readChainFile(root, 'mock-dispute');
const run = (config, request = 'A mock task.') => runChain({ config, request, log: () => {} });
// A layered mock chain whose judges object to every draft: the run ends with open objections and a board with sections (the 'mock-dispute' chain of the flag rows ends with none, and a board with no section is not written).
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const layered = () => ({ name: 'anc-layered', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [seat('mock-exch-contest-keep-always', 'e1', 1), seat('mock-exch-contest-keep-always', 'e2', 1), seat('mock-critic-x', 'e3', 2)] } });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: '<n> of the <m> objections in the last critique name no quoted passage.' NEW: 'Objections in the last critique that name no quoted passage: <n> of <m>.' (group 1 is still n, group 2 m). WHY: anchorSentence (src/anchor.js:24), the resolved text of the row (RESOLVED_LIST).
const COUNT = /\nObjections in the last critique that name no quoted passage: (\d+) of (\d+)\.\n/;

test('ANC-1 the rule: an objection (a failure with an id) that quotes nothing, or only blanks, is unanchored; one that quotes a passage is not; a harness placeholder without an id is not an objection; flagUnanchored adds the flag to the first kind only and leaves every other record as it was', () => {
  const quoted = { id: 'O-aaaaaaaa', criterion: 'C', problem: 'p', quote: 'the retry limit is three' };
  const bare = { id: 'O-bbbbbbbb', criterion: 'C', problem: 'p' };
  const blank = { id: 'O-cccccccc', criterion: 'C', problem: 'p', quote: '  `` ' };
  const placeholder = { criterion: '(critic seat dropped)', problem: 'a provider error' };
  assert.deepEqual([quoted, bare, blank, placeholder, null, 'x'].map(r => isUnanchored(r)), [false, true, true, false, false, false]);
  const out = flagUnanchored([quoted, bare, blank, placeholder]);
  assert.equal(out[0], quoted, 'a quoted record is returned as it was');
  assert.deepEqual([out[1].unanchored, out[2].unanchored, 'unanchored' in out[3]], [true, true, false]);
  assert.equal(bare.unanchored, undefined, 'the input record is not changed');
  assert.deepEqual(unanchoredCount([quoted, bare, blank, placeholder]), { n: 2, m: 3 });
  assert.deepEqual(unanchoredCount(null), { n: 0, m: 0 });
  assert.equal(flagUnanchored(null), null);
  assert.deepEqual(unanchoredOf({ lastCritique: { failures: [quoted, bare] } }), [bare]);
});

test('ANC-7 R528: a quote attached in the exchange lives in the run as its own field attached_quote; the anchor rule reads it (the record is anchored), the report view names it `quote` beside quote_attached_in, a judge\'s own quote is never replaced, and an input list is not changed', async () => {
  const { materialiseAttached } = await import('../src/anchor.js').catch(() => ({}));
  const att = { id: 'O-aaaaaaaa', attached_quote: 'the retry limit is three', quote_attached_in: 'lreply-1-e1' };
  assert.equal(isUnanchored(att), false, 'an attached passage anchors the record');
  assert.equal(isUnanchored({ id: 'O-aaaaaaaa' }), true);
  assert.deepEqual(unanchoredCount([att, { id: 'O-bbbbbbbb' }]), { n: 1, m: 2 });
  const out = materialiseAttached([att, { id: 'O-cccccccc', quote: 'own quote', attached_quote: 'x' }, { id: 'O-dddddddd' }, null]);
  assert.deepEqual(out[0], { id: 'O-aaaaaaaa', quote: 'the retry limit is three', quote_attached_in: 'lreply-1-e1' });
  assert.equal(out[1].quote, 'own quote', 'the judge\'s own quote wins');
  assert.equal('attached_quote' in out[1], false);
  assert.deepEqual(out.slice(2), [{ id: 'O-dddddddd' }, null]);
  assert.equal(att.attached_quote, 'the retry limit is three', 'the input is not changed');
  assert.equal(materialiseAttached(null), null);
});

test('ANC-2 REAL RUN, unfenced: a holdout judge that quotes nothing leaves a last critique whose objections all carry unanchored: true in report.json (lastCritique.failures and signoff[].objections), and the board states the count "M of the M" (the board half runs the layered chain anc-layered: the flag chain ends without a board section)', async () => {
  const r = await run(holdout());
  const rep = reportJsonShape({ runId: 'x', chain: 'mock-dispute', task: 't', result: r });
  const failures = rep.lastCritique.failures.filter(f => typeof f.id === 'string');
  assert.ok(failures.length >= 1, 'the premise: the holdout leaves an objection');
  assert.ok(failures.every(f => f.unanchored === true && !f.quote), JSON.stringify(failures[0]));
  const signed = rep.signoff.flatMap(s => s.objections || []);
  assert.ok(signed.length >= 1 && signed.every(o => o.unanchored === true), 'signoff[].objections carry the flag');
  const lr = await run(layered());
  const board = renderBoardMd({ runId: 'x', result: lr });
  assert.ok(board.length > 0, 'the premise: the layered run has a board');
  const m = COUNT.exec(`\n${board}`);
  assert.ok(m, 'the board states the count');
  assert.equal(m[1], m[2], 'before W23 every objection of an unfenced run is in the count: "M of the M", read honestly');
  assert.equal(Number(m[2]), lr.lastCritique.failures.filter(f => typeof f.id === 'string').length);
});

test('ANC-3 REAL RUN, fenced: a run whose request carries a fenced source block is flagged the same way (R22: every objection quotes, every run)', async () => {
  const r = await run(holdout(), 'Review this.\n\n```js\nconst retries = 3;\nexport const run = () => retries;\n```\n');
  const rep = reportJsonShape({ runId: 'x', chain: 'mock-dispute', task: 't', result: r });
  const failures = rep.lastCritique.failures.filter(f => typeof f.id === 'string');
  assert.ok(failures.length >= 1 && failures.every(f => f.unanchored === true), JSON.stringify(failures[0]));
});

test('ANC-4 the flag is derived at report time and nowhere in the run: the in-run objects carry no unanchored field, and a record that quotes a passage gets none in the report', async () => {
  const r = await run(holdout());
  assert.ok(r.lastCritique.failures.every(f => !('unanchored' in f)), 'the run\'s own failures are untouched');
  const withQuote = { ...r, lastCritique: { ...r.lastCritique, failures: r.lastCritique.failures.map(f => (typeof f.id === 'string' ? { ...f, quote: 'the retry limit is three' } : f)) } };
  const rep = reportJsonShape({ runId: 'x', chain: 'c', task: 't', result: withQuote });
  assert.ok(rep.lastCritique.failures.every(f => !('unanchored' in f)));
  assert.doesNotMatch(`\n${renderBoardMd({ runId: 'x', result: withQuote })}`, COUNT, 'nothing to state when every objection quotes a passage');
});

test('ANC-5 ONE rule: report-shape.js asks src/anchor.js and holds no quote test of its own; the schema documents the field on the objection record', () => {
  const shape = SRC('report-shape.js');
  assert.match(shape, /import \{ flagUnanchored, anchorSentence, materialiseAttached \} from '\.\/anchor\.js';/);
  assert.doesNotMatch(shape, /problemKey/, 'no second copy of the rule');
  const schema = JSON.parse(readFileSync(resolve(root, 'schemas', 'report-v1.json'), 'utf8'));
  assert.equal(schema.$defs.objection.properties.unanchored.type, 'boolean');
  assert.match(schema.$defs.objection.properties.unanchored.description, /does not say whether the judge was asked/);
});

test('ANC-6 (a PIN, not a red row; C&C R525 item 1): the STOPPED run\'s board (BOARD-partial.md) carries the same count sentence as the finished run\'s board, because renderPartialBoardMd renders through renderBoardMd (it already did on the tree before R525); both go through the ONE helper. Fails if the partial board loses the sentence or a second call site of the helper appears', async () => {
  const r = await run(layered());
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): same re-pin as COUNT above. WHY: anchorSentence (src/anchor.js:24).
  const SENTENCE = /\nObjections in the last critique that name no quoted passage: \d+ of \d+\.\n/;
  const partial = renderPartialBoardMd({ runId: 'x', result: r, cause: 'overseer_cap' });
  const finished = renderBoardMd({ runId: 'x', result: r });
  assert.match(partial, SENTENCE, `the partial board states it: ${partial.slice(0, 200)}`);
  assert.equal(partial.match(SENTENCE)[0], finished.match(SENTENCE)[0], 'and the finished board states the identical text');
  assert.equal(anchorSentence([{ id: 'O-aaaaaaaa', quote: 'a passage of the plan' }]), '', 'nothing to say when every objection quotes a passage');
  const shape = readFileSync(resolve(root, 'src', 'report-shape.js'), 'utf8');
  assert.equal((shape.match(/anchorSentence\(/g) || []).length, 1, 'ONE call site for the sentence: both boards go through renderBoardMd');
});
