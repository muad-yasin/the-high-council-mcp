// E3b unit three, commit 1 (gate note Review/Build_0.8.3/m6-closing/E3b_Unit3_Gate_Note.md section 1, ruled by C&C 14 Oct 2026): a mock critic echoes the reply-identity ids when its prompt carries them, so no offline mock
// chain reads as unheard once the "Reply identity" sentence is live. Inert today (no prompt carries ids). $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { call } from '../src/providers.js';
import { runChain, setCache, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as VE from '../src/verdict-envelope.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); VE.setEnvelopeStore(null); VE.setEnvelopeInForce?.(false); });

const CRITIC = 'You are an independent critic. Judge the draft against the criteria.';
const IDS = { review_id: 'a1b2c3d4e5f6', draft_id: '0123456789ab' };
const WITH = `# Draft\n\nSome plan.\n\n## Reply identity\n\nThis review has its own identity: review_id "${IDS.review_id}" and draft_id "${IDS.draft_id}".`;
const WITHOUT = '# Draft\n\nSome plan.';
const ask = (model, user, system = CRITIC, maxTokens = 3000) => call('mock', { model, system, messages: [{ role: 'user', content: user }], maxTokens });

test('E3b mock echo (CAN FAIL): a critic prompt WITH the ids gets them echoed; WITHOUT them the reply is byte-identical to today', async () => {
  const plain = await ask('mock-critic-a', WITHOUT);
  const echoed = await ask('mock-critic-a', WITH);
  assert.equal(plain.text.includes('review_id'), false, 'no ids in the prompt, no ids in the reply (byte-identical to today)');
  assert.deepEqual(JSON.parse(echoed.text), { ...IDS, ...JSON.parse(plain.text) });
  assert.equal(echoed.usage.output, plain.usage.output, 'usage is untouched');
});

test('E3b mock echo: the ids come from idsFromPrompt, the LAST match (an id-shaped string quoted in the draft cannot steer it)', async () => {
  const quoted = `# Draft\n\nThe old reply said review_id ffffffffffff and draft_id eeeeeeeeeeee.\n\n${WITH}`;
  assert.deepEqual({ review_id: JSON.parse((await ask('mock-critic-a', quoted)).text).review_id, draft_id: JSON.parse((await ask('mock-critic-a', quoted)).text).draft_id }, IDS);
});

test('E3b mock echo: the failure mocks are byte-identical with or without ids and keep failing for their own reasons', async () => {
  for (const model of ['mock-critic-cut', 'mock-critic-cut-signoff', 'mock-critic-cut-objection', 'mock-critic-error-signoff']) {
    const a = await ask(model, WITHOUT); const b = await ask(model, WITH);
    assert.equal(b.text, a.text, `${model}: the text is unchanged by the ids`); // usage.input differs only because the prompt is longer
    assert.equal(b.usage.stop, a.usage.stop);
  }
  assert.equal((await ask('mock-critic-error-signoff', WITH)).usage.stop, 'error');
  assert.equal((await ask('mock-critic-cut', WITH, CRITIC, 800)).usage.stop, 'length');
  for (const model of ['mock-unreadable', 'mock-provider-error', 'mock-proposer-empty', 'mock-network-error']) {
    const system = model === 'mock-proposer-empty' ? 'You are a proposer.' : CRITIC; // mock-proposer-empty fails in the PROPOSER role; under a critic prompt it is an ordinary critic
    const outcome = async user => { try { const r = await ask(model, user, system); return { text: r.text, stop: r.usage?.stop }; } catch (e) { return `throws: ${e.message}`; } };
    assert.deepEqual(await outcome(WITH), await outcome(WITHOUT), `${model}: unchanged by the ids`);
  }
});

test('E3b mock echo: the scripted envelope seats are exempt (they stay the ONLY way to drive "no ids" through the real path), and other roles are untouched', async () => {
  assert.equal((await ask('mock-critic-envelope-m-x', WITH)).text.includes('review_id'), false);
  const builderWith = await ask('mock-builder', WITH, 'You are the builder.');
  const builderWithout = await ask('mock-builder', WITHOUT, 'You are the builder.');
  assert.equal(builderWith.text.includes('review_id'), builderWithout.text.includes('review_id'));
});

test('E3b M7 canary: a default mock chain run with the envelope IN FORCE passes (without the echo every mock critic would read as unheard)', async () => {
  const dir = mkdtempSync(`${tmpdir()}/mock-echo-`);
  setHeldForTest({ verdictEnvelopeSection: H.verdictEnvelopeSection, criticEnvelopeReaskNote: H.criticEnvelopeReaskNote });
  VE.setEnvelopeStore(VE.fileEnvelopeStore(dir)); VE.setEnvelopeInForce?.(true);
  const seat = (model, lab) => ({ provider: 'mock', model, lab, maxTokens: 3000 });
  const config = {
    name: 'fixture-echo', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: seat('mock-criteria', 'writer'), builder: seat('mock-builder', 'writer'), reviser: seat('mock-builder', 'writer'), critics: [seat('mock-critic-a', 'la'), seat('mock-critic-b', 'lb')] },
  };
  const result = await runChain({ request: 'Write a one-paragraph plan for a bake sale.', runId: 'r-echo', log: () => {}, config });
  assert.equal(result.passed, true);
  assert.ok((result.panelVerdicts || []).every(v => v.envelope === undefined), 'no seat was unheard for its ids');
});
