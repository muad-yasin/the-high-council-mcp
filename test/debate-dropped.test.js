// debate.dropped (0.7.8, thc-research brief 10 W3). The debate stage filters out posts on an
// unknown id, on the poster's own proposal, or with a stance it does not know, and the reply stage
// filters replies the same way. The filters are unchanged; these tests pin that every rejected item
// is now counted, per lab and reason, in report.json's debate.dropped and in BOARD.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, debatePostDropReason, debateReplyDropReason, tallyDropped } from '../src/chain.js';
import { renderBoardMd } from '../src/report-shape.js';
import Ajv2020 from 'ajv/dist/2020.js';

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(resolve(here, '../chains/mock-debate.json'), 'utf8'));
const withProposers = (...models) => ({
  ...base,
  seats: { ...base.seats, proposers: models.map((model, i) => ({ provider: 'mock', model, lab: `mock-${'abc'[i]}` })) },
});

const P = [{ id: 'A-1', lab: 'a' }, { id: 'A-2', lab: 'a' }, { id: 'B-1', lab: 'b' }];

test('debatePostDropReason: one reason per rejected post, null for a kept one', () => {
  assert.equal(debatePostDropReason({ on: 'B-1', stance: 'object' }, 'a', P), null);
  assert.equal(debatePostDropReason({ on: 'Z-9', stance: 'object' }, 'a', P), 'unknown_target');
  assert.equal(debatePostDropReason({ on: 'A-1', stance: 'object' }, 'a', P), 'own_proposal');
  assert.equal(debatePostDropReason({ on: 'B-1', stance: 'maybe' }, 'a', P), 'bad_stance');
  assert.equal(debatePostDropReason({ on: 'A-1', stance: 'maybe' }, 'a', P), 'own_proposal', 'the target is checked first');
});

test('debateReplyDropReason: one reason per rejected reply, null for a kept one', () => {
  const posted = [P[0]];
  assert.equal(debateReplyDropReason({ id: 'A-1', action: 'keep' }, 'a', P, posted), null);
  assert.equal(debateReplyDropReason({ id: 'Z-9', action: 'keep' }, 'a', P, posted), 'unknown_target');
  assert.equal(debateReplyDropReason({ id: 'B-1', action: 'keep' }, 'a', P, posted), 'not_own_proposal');
  assert.equal(debateReplyDropReason({ id: 'A-2', action: 'keep' }, 'a', P, posted), 'not_posted_on');
  assert.equal(debateReplyDropReason({ id: 'A-1', action: 'shrug' }, 'a', P, posted), 'bad_action');
});

test('tallyDropped: one row per stage, lab and reason, in first-seen order', () => {
  assert.deepEqual(tallyDropped([
    { stage: 'debate', by: 'a', reason: 'bad_stance' },
    { stage: 'debate', by: 'b', reason: 'unknown_target' },
    { stage: 'debate', by: 'a', reason: 'bad_stance' },
    { stage: 'replies', by: 'a', reason: 'bad_stance' },
  ]), [
    { stage: 'debate', by: 'a', reason: 'bad_stance', count: 2 },
    { stage: 'debate', by: 'b', reason: 'unknown_target', count: 1 },
    { stage: 'replies', by: 'a', reason: 'bad_stance', count: 1 },
  ]);
  assert.deepEqual(tallyDropped([]), []);
});

test('runChain: a clean debate records dropped: [] and BOARD.md has no dropped section', async () => {
  const result = await runChain({ request: 'Do the thing.', config: base, log: () => {} });
  assert.deepEqual(result.debate.dropped, []);
  assert.doesNotMatch(renderBoardMd({ runId: 'x', result }), /Dropped from the debate/);
});

test('runChain: rejected posts and replies are counted per lab and reason, and nothing else changes', async () => {
  const logs = [];
  const result = await runChain({ request: 'Do the thing.', config: withProposers('mock-proposer-sloppy', 'mock-proposer-b', 'mock-proposer-garbled'), log: m => logs.push(m) });
  const d = result.debate.dropped;
  const row = (stage, by, reason) => d.find(r => r.stage === stage && r.by === by && r.reason === reason)?.count;
  assert.equal(row('debate', 'mock-a', 'unknown_target'), 1);
  assert.equal(row('debate', 'mock-a', 'own_proposal'), 1);
  assert.equal(row('debate', 'mock-a', 'bad_stance'), 1);
  assert.equal(row('debate', 'mock-c', 'unreadable'), 1);
  assert.equal(row('replies', 'mock-a', 'unknown_target'), 1);
  assert.equal(row('replies', 'mock-a', 'bad_action'), 1);
  assert.equal(row('replies', 'mock-c', 'unreadable'), 1);
  assert.equal(d.filter(r => r.by === 'mock-b').length, 0, 'the well-behaved lab dropped nothing');
  // The filters themselves did not change: nothing rejected reaches posts or replies.
  assert.ok(result.debate.posts.every(p => p.on !== 'Z-99' && ['support', 'object', 'merge'].includes(p.stance)));
  assert.ok(result.debate.replies.every(r => ['keep', 'amend', 'withdraw'].includes(r.action)));
  assert.ok(result.debate.posts.every(p => result.proposals.find(x => x.id === p.on).lab !== p.by));
  assert.match(logs.join('\n'), /mock-a: .*3 dropped \(1 unknown_target, 1 own_proposal, 1 bad_stance\)/);

  const board = renderBoardMd({ runId: 'x', result });
  assert.match(board, /## Dropped from the debate/);
  assert.match(board, /- mock-a: 1 debate post - named a proposal id that does not exist/);
  assert.match(board, /- mock-c: the whole debate reply - reply did not parse at all/);
  assert.match(board, /- mock-a: 1 author reply - had an action other than keep, amend or withdraw/);
  // The board text the builder reads is untouched: the section is BOARD.md's alone.
  assert.doesNotMatch(result.board, /Dropped from the debate/);
});

test('schema: debate.dropped validates, and a malformed row does not', () => {
  const schema = JSON.parse(readFileSync(resolve(here, '../schemas/report-v1.json'), 'utf8'));
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile({ ...schema.$defs.debate, $defs: schema.$defs });
  const ok = { posts: [], replies: [], dropped: [{ stage: 'debate', by: 'x', reason: 'bad_stance', count: 2 }] };
  assert.ok(validate(ok), JSON.stringify(validate.errors));
  assert.equal(validate({ ...ok, dropped: [{ stage: 'debate', by: 'x', reason: 'bored', count: 1 }] }), false);
  assert.equal(validate({ ...ok, dropped: [{ stage: 'debate', by: 'x', reason: 'bad_stance', count: 0 }] }), false);
});
