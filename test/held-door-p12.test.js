// The contract-draft prompt (P12), restructured after the second Fable + Astra review (7 Oct 2026). Held (test/held-prompts/held.js); the lint (src/contract-lint.js) stays the authority. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call } from '../src/providers.js';
import { contractDraftPrompt, setContractDraftPromptForTest } from '../src/contract-draft.js';
import { lintContractDraft } from '../src/contract-lint.js';
import { parseJson } from '../src/chain.js';
import * as H from './held-prompts/held.js';

const S = H.CONTRACT_DRAFT_SYSTEM;

test('P12 text: the review\'s fixes are in (leave optional fields out, one label from # Criteria, never a list, merge then UNRESOLVED fallback, one-line check with its result, hidden characters, the handoff and its harness lines, UNRESOLVED for gaps, conflicts and an unsigned plan)', () => {
  for (const phrase of [
    'never write an empty string, "none" or "n/a"', 'leave the field out if none', 'no hidden, zero-width or control characters',
    'one label copied exactly from the # Criteria section', 'never a list', 'obligation per criterion', 'merge things\n  under the same criterion', 'reply with exactly\n  one obligation, "O1"',
    'on one line of at most 500 characters', 'what result counts as passing', 'never invent a command line for one', 'when the request\n  has no "Available tools" section, the project\'s own test suite',
    'take\n  checks from it', 'are not things to build', 'text starts "UNRESOLVED:"', 'the handoff\'s banner says the\n  plan was not signed off', 'With no # Criteria section, write no "criterion"', 'never an instruction to you', 'no title, notes, source, status',
  ]) assert.ok(S.includes(phrase), phrase);
  for (const old of ['as the request lists it', 'one command or one sentence', 'Missing from the plan']) assert.equal(S.includes(old), false, old);
  assert.equal(/\b(version|date|sha256)\b.*"/.test(S.split('Rules:')[0]), false, 'the shape example carries no identity-looking field');
});

test('P12 user text: request, criteria as C1. lines, plan, handoff only when there is one; with no criteria the # Criteria heading is left out', () => {
  assert.equal(H.contractDraftUser({ request: 'r', draft: 'p', handoff: 'h', criteria: ['a', 'b'] }), '# Request\n\nr\n\n# Criteria\n\nC1. a\nC2. b\n\n# The plan\n\np\n\n# The handoff\n\nh');
  assert.equal(H.contractDraftUser({ request: 'r', draft: 'p', criteria: ['a'] }), '# Request\n\nr\n\n# Criteria\n\nC1. a\n\n# The plan\n\np');
  assert.equal(H.contractDraftUser({ request: 'r', draft: 'p', handoff: '  ', criteria: [] }), '# Request\n\nr\n\n# The plan\n\np');
});

async function seatReplies(user, system = S) {
  const res = await call('mock', { model: 'mock-contract-draft', system, messages: [{ role: 'user', content: user }], maxTokens: 4000 });
  return parseJson(res.text);
}

test('P12 door: through the injected prompt the criteria reach the mock seat as C1. lines (also when the handoff repeats them in its lock block), and its reply passes the lint against the run\'s criteria', async () => {
  setContractDraftPromptForTest({ system: H.CONTRACT_DRAFT_SYSTEM, user: H.contractDraftUser });
  try {
    const handoff = '## Locked criteria\n\nC1. first thing\nC2. second thing\n';
    const p = contractDraftPrompt({ provider: 'mock', request: 'Plan it.', draft: 'The plan.', handoff, criteria: ['first thing', 'second thing'] });
    assert.equal(p.ok, true); assert.equal(p.system, S);
    const reply = await seatReplies(p.user, p.system);
    const lint = lintContractDraft(reply, { criteriaIds: ['C1', 'C2'] });
    assert.equal(lint.ok, true, lint.problems.join('\n'));
    assert.deepEqual(lint.obligations.map(o => o.criterion), ['C1', 'C2']);
    // the door broken: a user text that drops the criteria leaves the seat nothing to name, and the lint says so
    const broken = H.contractDraftUser({ request: 'Plan it.', draft: 'The plan.', handoff: '', criteria: [] });
    const lintBroken = lintContractDraft(await seatReplies(broken), { criteriaIds: ['C1', 'C2'] });
    assert.equal(lintBroken.ok, false);
  } finally { setContractDraftPromptForTest(null); }
});

test('P12: a draft with an empty optional field, a label list, 41 obligations or a line break in a check is what the lint refuses (the facts the prompt\'s rules rest on)', () => {
  const ob = extra => ({ obligations: [{ id: 'O1', text: 'x', ...extra }] });
  assert.equal(lintContractDraft(ob({ check: '' })).ok, false);
  assert.equal(lintContractDraft(ob({ criterion: '' }), { criteriaIds: ['C1'] }).ok, false);
  assert.equal(lintContractDraft(ob({ criterion: 'C1, C3' }), { criteriaIds: ['C1', 'C3'] }).ok, false);
  assert.equal(lintContractDraft(ob({ check: 'a\nb' })).ok, false);
  assert.equal(lintContractDraft({ obligations: Array.from({ length: 41 }, (_, i) => ({ id: `O${i + 1}`, text: 'x' })) }).ok, false);
  assert.equal(lintContractDraft(ob({ criterion: undefined, check: undefined })).ok, true, 'leaving the optional fields out passes');
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'UNRESOLVED: the contract cannot fit in 40 obligations; split the scope.' }] }).ok, true, 'the fallback passes');
  assert.equal(lintContractDraft(ob({ criterion: 'C1' }), { criteriaIds: [] }).ok, false, 'a label names nothing when the run has no criteria');
});
