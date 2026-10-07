// Wiring item (5), 6a (ticket 24): a criteria retry (the gate found criteria about the criteria list) is told about a request's own list of requirements, and the retry the seat answers is accepted. The two
// sentences that were inline in src/chain.js are unchanged word for word before the re-record and are held here word for word after it. $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as H from './held-prompts/held.js';
import * as R from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
afterEach(() => { setHeldForTest(null); setPromptSpy(null); });
const BEFORE = { skip: 'criteriaRetryNote' in R && 'recorded in src/roles.js: this describes the state before the re-record' };

const OLD_META = q => `Your previous answer described the format of a criteria list ("${q}") instead of the deliverable the request asks for. Write criteria that a reader checks against that deliverable itself.`;
const OLD_INFEASIBLE = q => `Your previous answer contained a criterion the draft can never satisfy: "${q}". The draft is ONE document. Any other file named in the request is produced by a later stage of this pipeline, not by the draft. Write criteria that one document can satisfy.`;
const META_FIRST = 'Is a JSON object with a "criteria" key containing a list of strings.';

const go = async () => {
  const base = chain('mock-unanimous');
  const config = { ...base, maxRounds: 1, seats: { ...base.seats, criteria: { provider: 'mock', model: 'mock-criteria-spec-mirror' } } };
  const seen = [];
  setPromptSpy(p => seen.push(p));
  const request = 'Write a short fixture plan. The plan must contain a limitations section; it fails if it has none.';
  try { return { r: await runChain({ request, config, runId: 'r-6a', log: () => {} }), seen }; } catch (error) { return { error, seen }; }
};

test('6a: before the sentence is recorded the retry is byte-identical to what was always sent; a seat that needs the new sentence is stopped by the gate', BEFORE, async () => {
  const { error, seen } = await go();
  const retry = seen.find(p => p.label === 'criteria-retry');
  assert.ok(retry, seen.map(p => p.label).join(','));
  assert.ok(retry.user.endsWith(`\n\n${OLD_META(META_FIRST)}`), retry.user.slice(-400));
  assert.match(String(error?.message), /twice returned criteria about the criteria list/);
});

test('6a door: with the sentence the retry carries it after the old one (kept word for word), the seat answers with criteria about the deliverable, and the run goes on', async () => {
  setHeldForTest({ criteriaRetryNote: H.criteriaRetryNote });
  const { r, error, seen } = await go();
  assert.equal(error, undefined, String(error?.message));
  const retry = seen.find(p => p.label === 'criteria-retry');
  assert.ok(retry.user.includes(`\n\n${OLD_META(META_FIRST)} If the request carries its own list of what the answer must contain or when it fails, check whether your previous criteria repeat it. For each item on that list, write the condition that makes the answer right or wrong, not the item's presence.`), retry.user.slice(-600));
  assert.equal(seen.find(p => p.label === 'criteria').user.includes('check whether your previous criteria repeat it'), false, 'the first ask is untouched');
  assert.equal(r.criteria.length, 3, 'the retried criteria are the ones kept');
});

test('6a: the feasibility retry\'s sentence is the old one word for word, held or not (it only moves into src/roles.js)', () => {
  assert.equal(H.criteriaRetryNote('infeasible', 'Ships HANDOFF.md'), OLD_INFEASIBLE('Ships HANDOFF.md'));
  assert.ok(H.criteriaRetryNote('meta', 'x').startsWith(OLD_META('x')), 'the meta retry keeps its old sentence first');
});
