// 0.8.4 D18 (C&C 09 Nov 2026): the notice to a requesting proposer lands at the proposer-return call, through deps.noticeFor, BEFORE the reply form (so the form stays the last directive of the text). This pins the one
// expression added to src/proposer-return.js (S9's passed unit): with noticeFor the notice sits between the user text and the form; without it the text is what it was. In-process, offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setHeldForTest } from '../src/held-roles.js';
import { runProposerReturn } from '../src/proposer-return.js';
import * as HS9 from './held-prompts/held-084-s9.js';

afterEach(() => setHeldForTest(null));
const ctx = { seats: [{ provider: 'mock', model: 'm', lab: 'p0' }], ovRound: 1, number: 1, entryText: 'Decision 1 text.', choice: 'The choice.', objection: { criterion: 'c', problem: 'p', quote: 'q' }, request: 'r', criteria: ['c'], skeleton: 's', plan: 'plan', runId: 'run', shuffle: false };
async function sent(noticeFor) {
  setHeldForTest({ ...HS9 });
  const users = [];
  const deps = { invoke: async (seat, o) => { users.push(o.user); return { text: 'no json' }; }, record: s => s, settleAll: fns => Promise.all(fns), skipChosen() {}, offerSkip() {}, rethrowControlFlow() {}, parseJson: () => null, cap: v => v, log() {}, ...(noticeFor ? { noticeFor } : {}) };
  await runProposerReturn(ctx, deps);
  return users;
}

test('with noticeFor the notice sits between the user text and the reply form, which stays last; without it the text is unchanged', async () => {
  const plain = await sent(null);
  assert.equal(plain.length, 1);
  const form = HS9.proposerReturnReplyForm('alt');
  assert.ok(plain[0].endsWith(`\n\n${form}`));
  const noticed = await sent((seat, round) => (round === 1 ? '\n\nYour request for src/a.js was declined by the handling session.' : ''));
  assert.equal(noticed[0], plain[0].slice(0, plain[0].length - `\n\n${form}`.length) + '\n\nYour request for src/a.js was declined by the handling session.' + `\n\n${form}`);
  assert.ok(noticed[0].endsWith(`\n\n${form}`), 'the form is still the last directive');
  const none = await sent(() => '');
  assert.equal(none[0], plain[0], 'an empty notice changes nothing');
});
