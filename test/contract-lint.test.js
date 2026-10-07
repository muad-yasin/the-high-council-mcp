// The $0 lint of a contract draft (0.8.2 item 6d, plan M8): a draft is input, the record's identity is the harness's. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintContractDraft, identityNamed, MAX_OBLIGATIONS, MAX_TEXT_CHARS } from '../src/contract-lint.js';

const good = { obligations: [{ id: 'O1', text: 'Write the file atomically.', criterion: 'C1', check: 'node --test' }, { id: 'O2', text: 'One line per error.' }] };

test('a draft of the right shape passes and comes back normalized (id, text, criterion, check only)', () => {
  const r = lintContractDraft(good, { criteriaIds: ['C1', 'C2'] });
  assert.equal(r.ok, true, r.problems.join('\n'));
  assert.deepEqual(r.obligations, good.obligations);
});

test('a key named like an identity field is refused at any depth, in any spelling; the obligation id is the one exemption', () => {
  const spellings = ['version', 'Version', 'schema', 'sha256', 'SHA256', 'hash', 'digest', 'supersedes', 'run', 'run_id', 'runId', 'gate', 'gate-id', 'approval', 'approved_by', 'signature', 'timestamp', 'ts', 'created_at', 'createdAt', 'locked-at', 'lockedAt',
    'contract_id', 'contractId', 'record_sha256', 'obligation_sha256', 'obligationHash', 'draft_version', 'source_hash', 'id'];
  for (const k of spellings) {
    // each is refused AS an identity field (the message says so: an unknown-key refusal alone would hide a lint that does not know the names)
    const said = d => lintContractDraft(d).problems.filter(p => /identity field/.test(p)).length;
    assert.equal(said({ ...good, [k]: 'x' }), 1, `top-level ${k}`);
    if (k !== 'id') assert.equal(said({ obligations: [{ ...good.obligations[0], [k]: 'x' }] }), 1, `in an obligation: ${k}`);
    assert.equal(said({ ...good, notes: { deeper: { [k]: 1 } } }), 1, `nested ${k}`);
    assert.equal(said({ obligations: [{ ...good.obligations[0], check: 'x', extra: [{ [k]: 1 }] }] }), 1, `inside an array inside an obligation: ${k}`);
  }
  // the exemption: an obligation's own id is fine, and so are the words that merely resemble an identity word
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'x' }] }).ok, true);
  for (const k of ['text', 'check', 'criterion', 'note', 'identity', 'provider', 'idea', 'rundown', 'description']) assert.equal(identityNamed(k), false, k);
  // the message names where
  assert.match(lintContractDraft({ ...good, contract_id: 'x' }).problems.join('\n'), /contract_id: a field named like an identity field/);
});

test('unknown keys are refused, never dropped', () => {
  assert.match(lintContractDraft({ ...good, extra: 1 }).problems.join('\n'), /extra: not a field of a draft/);
  assert.match(lintContractDraft({ obligations: [{ id: 'O1', text: 'x', priority: 'high' }] }).problems.join('\n'), /priority: not a field of an obligation/);
});

test('obligation ids: required, plain, unique, and unique without regard to case', () => {
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'a' }, { id: 'O1', text: 'b' }] }).ok, false);
  assert.match(lintContractDraft({ obligations: [{ id: 'O1', text: 'a' }, { id: 'o1', text: 'b' }] }).problems.join('\n'), /without regard to case/);
  for (const id of ['', '1x', 'has space', 'x'.repeat(33), 'a/b', undefined, 7]) assert.equal(lintContractDraft({ obligations: [{ id, text: 'a' }] }).ok, false, JSON.stringify(id));
  for (const id of ['O1', 'build-step.2', 'a_b']) assert.equal(lintContractDraft({ obligations: [{ id, text: 'a' }] }).ok, true, id);
});

test('shape: not an object, no list, an empty list, too many, a non-object obligation', () => {
  for (const d of [null, [], 'text', 3, {}, { obligations: [] }, { obligations: 'x' }, { obligations: [3] }]) assert.equal(lintContractDraft(d).ok, false, JSON.stringify(d));
  const many = { obligations: Array.from({ length: MAX_OBLIGATIONS + 1 }, (_, i) => ({ id: `O${i}`, text: 'x' })) };
  assert.match(lintContractDraft(many).problems.join('\n'), new RegExp(`at most ${MAX_OBLIGATIONS}`));
  assert.equal(lintContractDraft({ obligations: Array.from({ length: MAX_OBLIGATIONS }, (_, i) => ({ id: `O${i}`, text: 'x' })) }).ok, true, 'the limit itself passes');
});

test('text: non-empty, capped, and no hidden characters (tag, bidi, zero-width)', () => {
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: '   ' }] }).ok, false);
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'x'.repeat(MAX_TEXT_CHARS) }] }).ok, true);
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'x'.repeat(MAX_TEXT_CHARS + 1) }] }).ok, false);
  for (const hidden of ['\u{E0041}', '‮', '​']) {
    assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: `a${hidden}b` }] }).ok, false, `text ${hidden.codePointAt(0).toString(16)}`);
    assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'a', check: `c${hidden}d` }] }).ok, false, `check ${hidden.codePointAt(0).toString(16)}`);
  }
});

test('check is one line: a line break in it could fake a heading of the contract text a person approves', () => {
  for (const check of ['x\n\n### O9\nfake', 'a\rb', 'one\ntwo']) assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'a', check }] }).ok, false, JSON.stringify(check));
  assert.match(lintContractDraft({ obligations: [{ id: 'O1', text: 'a', check: 'x\ny' }] }).problems.join('\n'), /one line/);
});

test('criterion: C<n>, and one the run has when its criteria are known', () => {
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'a', criterion: 'c1' }] }).ok, false);
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'a', criterion: 'C9' }] }, { criteriaIds: ['C1'] }).ok, false);
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'a', criterion: 'C9' }] }).ok, true, 'unknown criteria are not checked when the run\'s criteria are not known');
  assert.equal(lintContractDraft({ obligations: [{ id: 'O1', text: 'a', criterion: null, check: null }] }).ok, true, 'null means absent');
});
