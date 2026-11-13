// 0.8.4 T14 (CA2/D17), the stages read OUTSIDE invoke(): the handler's `answers` (and, the same way, build-check-<n>) are consumed from disk without a write-back, so the ledger reads the pause's own record (the sitting and version that ASKED,
// merged into the hit from `<label>.prompt.json`). Offline, $0, runChain with a fake cache (the seam setCache gives), the shipped mock chain mock-questions-wait. The `criteria` stage is the cached stage after the answers.
//   D1  the answers were asked and consumed in sitting 1, the criteria cached in sitting 1, an update (the code differs): the answers are FRESH (same prompt) and the criteria, stale by prompt, are KEPT: nothing is asked again
//   D2  the answers were set aside in sitting 2 and a NEW answer came in sitting 3 (its pause file says sitting 2): the criteria, written in sitting 1, are asked again (the audit-5 shape: a changed upstream)
//   D4  a used answer edited by hand, then an update: the answers read fresh but their reply no longer matches its recorded hash, so the criteria after them are asked again (without the update the same edit already re-runs them)
//   D5  the answers asked under the earlier wording of THEIR OWN prompt (stale by prompt) are KEPT like any stage: no set-aside, no pause; the cache hooks fire (the WARNINGS line, the first-use hash)
//   B1  a build-check answer stale by its own prompt that judges ok is KEPT (the run goes on, no pause)
//   B2  one that does NOT judge ok under the current ids is set aside as before and is never listed as kept (a kept answer is never refused afterwards)
//   D3  an answer with no record of the sitting that asked (asked before this version) is unstamped: fail closed, the criteria are asked again (the first-upgrade case, README Known limits)
// RED BASE 61a36cc1 (no src/stale-guard.js, no setWordingStamp): this file LOADS (namespace import of src/chain.js, a local hash helper, CHECK and answer from test/helpers/build-check.js which exist there) and D1-D5, B1 and B2 fail by TypeError at the call that arms the ledger.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chain from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { CHECK, answer as checkAnswer } from './helpers/build-check.js';
import { createHash } from 'node:crypto';
const hash12 = text => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 12);   // the format of writtenBy.text (pinned by P9 in stale-guard.test.js); local so these rows load on a tree that has no src/stale-guard.js

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(here, '../chains/mock-questions-wait.json'), 'utf8'));
const run = () => chain.runChain({ request: 'Plan a tea shop.', config, log: () => {} });
const OLD = { version: '0.0.1', sitting: 1 };
afterEach(() => { chain.setCache(null); chain.setWordingStamp?.(null); chain.setBudget(null); setHeldForTest(null); });

async function setup() {
  chain.setBudget(null); chain.setCache(null); chain.setWordingStamp(null);
  let pause;
  await assert.rejects(run(), e => { pause = e; return e instanceof chain.ExternalPause && e.label === 'answers'; });
  // a full run once, to have the real text of the criteria stage
  chain.setCache({ get: l => (l === 'answers' ? { text: '1. default', promptHash: pause.promptHash, fromDisk: true } : null), invalidate: () => {}, warn: () => {} });
  const base = await run();
  const criteria = base.stages.find(s => s.label === 'criteria'), questions = base.stages.find(s => s.label === 'questions');
  assert.ok(criteria?.text && questions?.text, 'fixture: the questions and criteria stages ran and have a text');
  return { pause, criteriaText: criteria.text, questionsText: questions.text };
}
// the questions stage is cached too (a real resume replays it): without a record it would run live and mark every stage after it as changed
const cacheOf = ({ answersRecord, criteriaRecord, questionsText, invalidated }) => ({
  get: l => (l === 'answers' ? answersRecord : l === 'criteria' ? criteriaRecord : l === 'questions' ? { text: questionsText, writtenBy: { ...OLD, text: hash12(questionsText) } } : null),
  invalidate: (l) => invalidated.push(l), warn: () => {},
});

test('D1 answers consumed in sitting 1, criteria cached in sitting 1, resumed after an update: the answers are fresh and the criteria are KEPT, no call', async () => {
  const { pause, criteriaText, questionsText } = await setup();
  const invalidated = [];
  chain.setCache(cacheOf({
    invalidated, questionsText,
    answersRecord: { text: '1. default', promptHash: pause.promptHash, fromDisk: true, writtenBy: OLD },
    criteriaRecord: { text: criteriaText, promptHash: 'f'.repeat(16), fromDisk: true, writtenBy: { ...OLD, text: hash12(criteriaText) } },
  }));
  chain.setWordingStamp({ version: '0.8.4' });
  const r = await run();
  assert.deepEqual(invalidated, [], 'nothing was set aside');
  assert.equal(r.stages.find(s => s.label === 'criteria').cached, true, 'the criteria were replayed, not asked');
  assert.deepEqual(chain.wordingKept().map(k => k.stage), ['criteria']);
});

test('D2 the answers were set aside in sitting 2 and answered anew in sitting 3 (the pause file says sitting 2): the criteria written in sitting 1 are asked again', async () => {
  const { pause, criteriaText, questionsText } = await setup();
  const invalidated = [];
  chain.setCache(cacheOf({
    invalidated, questionsText,
    answersRecord: { text: '1. a different answer', promptHash: pause.promptHash, fromDisk: true, writtenBy: { version: '0.8.4', sitting: 2 } },
    criteriaRecord: { text: criteriaText, promptHash: 'f'.repeat(16), fromDisk: true, writtenBy: { ...OLD, text: hash12(criteriaText) } },
  }));
  chain.setWordingStamp({ version: '0.8.5' });
  const r = await run();
  assert.deepEqual(invalidated, ['criteria'], 'the criteria were set aside');
  assert.ok(!r.stages.find(s => s.label === 'criteria').cached, 'and asked again');
  assert.deepEqual(chain.wordingKept(), []);
});

test('D3 PIN (a named limit): an answer with no record of the sitting that asked it is unstamped, so the criteria after it are asked again even after an update', async () => {
  const { pause, criteriaText, questionsText } = await setup();
  const invalidated = [];
  chain.setCache(cacheOf({
    invalidated, questionsText,
    answersRecord: { text: '1. default', promptHash: pause.promptHash, fromDisk: true },
    criteriaRecord: { text: criteriaText, promptHash: 'f'.repeat(16), fromDisk: true, writtenBy: { ...OLD, text: hash12(criteriaText) } },
  }));
  chain.setWordingStamp({ version: '0.8.4' });
  await run();
  assert.deepEqual(invalidated, ['criteria']);
});

test('D4 a used answer edited by hand, then an update: the criteria after it are asked again', async () => {
  const { pause, criteriaText, questionsText } = await setup();
  const invalidated = [];
  chain.setCache(cacheOf({
    invalidated, questionsText,
    answersRecord: { text: '1. an answer edited after it was used', promptHash: pause.promptHash, fromDisk: true, writtenBy: { ...OLD, text: hash12('1. default') } },
    criteriaRecord: { text: criteriaText, promptHash: 'f'.repeat(16), fromDisk: true, writtenBy: { ...OLD, text: hash12(criteriaText) } },
  }));
  chain.setWordingStamp({ version: '0.8.4' });
  await run();
  assert.deepEqual(invalidated, ['criteria']);
});

test('D5 answers stale by their own prompt are KEPT (no set-aside, no pause); the cache hooks get the stage and the reply', async () => {
  const { criteriaText, questionsText } = await setup();
  const invalidated = [], kept = [], used = [];
  chain.setCache({
    ...cacheOf({
      invalidated, questionsText,
      answersRecord: { text: '1. default', promptHash: 'f'.repeat(16), fromDisk: true, writtenBy: OLD },
      criteriaRecord: { text: criteriaText, promptHash: 'f'.repeat(16), fromDisk: true, writtenBy: { ...OLD, text: hash12(criteriaText) } },
    }),
    keptEarlier: (label, w) => kept.push([label, w.version]), stampUse: (label, text) => used.push([label, text]),
  });
  chain.setWordingStamp({ version: '0.8.4' });
  const r = await run();
  assert.deepEqual(invalidated, [], 'nothing was set aside');
  assert.ok(r.deliverable, 'the run went on, no pause');
  assert.deepEqual(kept, [['answers', '0.0.1']]);
  assert.deepEqual(used, [['answers', '1. default']]);
  assert.deepEqual(chain.wordingKept().map(k => k.stage), ['answers', 'criteria']);
});

// a layered chain with an external writer (the handler), every stage before the build check replayed from a stamped record, and the build-check answer stale by its own prompt
const CRITERION = 'The plan defines a retry limit.';
const signoffText = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', objections: [] });
const checkConfig = () => ({
  name: 'fixture-build-check-kept', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, freedoms: { pass: true },
  seats: { builder: { provider: 'external', model: 'claude-code-session', lab: 'writer' }, reviser: { provider: 'external', model: 'claude-code-session', lab: 'writer' },
    critics: [1, 2, 3].map(layer => ({ provider: 'mock', model: 'mock-review-fixture', lab: `l${layer}`, maxTokens: 3000, layer })) },
});
// every label has a stamped record, as in test/handoff-notes-stale.test.js (a layered mock chain with this fallback is known to reach the build check on this branch); only build-check-1 is stale by its prompt
const DRAFT = 'The worker retries failed requests.';
const checkStore = (answerText, invalidated) => ({
  get: l => {
    if (l === 'handoff' || l === 'handoff-notes') return null;
    const text = l === 'build-check-1' ? answerText : /^build-check-\d+$/.test(l) ? checkAnswer('good_to_build') : l.startsWith('panel-') ? signoffText : l.startsWith('revise-') ? `${DRAFT}\n\nRevision ${l.slice(7)}.` : DRAFT;
    return { text, ...(l === 'build-check-1' ? { promptHash: 'f'.repeat(16), fromDisk: true } : {}), writtenBy: { ...OLD, text: hash12(text) } };
  },
  invalidate: l => invalidated.push(l), warn: () => {},
});
const runCheck = () => chain.runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-bc', log: () => {}, config: checkConfig() });

test('B1 a build-check answer stale by its own prompt that judges ok is KEPT: no set-aside, and it is listed once', async () => {
  setHeldForTest(CHECK);
  const invalidated = [];
  chain.setCache(checkStore(checkAnswer('good_to_build'), invalidated));
  chain.setWordingStamp({ version: '0.8.4' });
  await runCheck();
  assert.ok(!invalidated.includes('build-check-1'), 'not set aside');
  assert.equal(chain.wordingKept().filter(k => k.stage === 'build-check-1').length, 1);
});

test('B2 a build-check answer that does NOT judge ok (a not_yet with no reasons) is set aside and is not listed as kept: a kept answer is never refused afterwards', async () => {
  setHeldForTest(CHECK);
  const invalidated = [];
  chain.setCache(checkStore(checkAnswer('not_yet', ''), invalidated));
  chain.setWordingStamp({ version: '0.8.4' });
  await assert.rejects(runCheck(), e => e instanceof chain.ExternalPause && e.label === 'build-check-1');
  assert.deepEqual(invalidated, ['build-check-1']);
  assert.equal(chain.wordingKept().filter(k => k.stage === 'build-check-1').length, 0);
});
