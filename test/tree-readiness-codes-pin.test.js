// Restore gap 2a (gate page 10.5; C&C ruling 9.2): the readiness codes that can OPEN a stop are each decided for the restore: either restorable (RESTORABLE_CODES) or refusing, with the reason written here. A code a later readiness version adds
// fails this test until someone decides it. The scan reads src/tree-ready.js and FAILS on a `blocked(` / `incomplete(` call whose first argument is not a plain string literal unless that exact call text is listed in TERNARIES with the codes it can
// raise, so a NEW ternary (or a changed one) cannot hide a code behind an expression.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESTORABLE_CODES } from '../src/tree-transitions.js';
import { BLOCKED_CHILD_ALSO } from '../src/tree-blocked-child.js';

// blocked-severity codes (they open a stop) that a restored file does NOT close, each with why
const REFUSES = {
  not_passed: 'a fact the run produced: a restored file does not change that the run did not pass',
  unsigned_change: 'the delivered text is not the signed text: restoring bytes does not make a panel read them',
  no_milestone_lint: 'the report records no milestone lint: a fact the run produced',
  status_policy: 'the handoff Status and findings are not ones a ready node may have: a fact the run produced',
  split_unreadable: 'section 8 point 1: a body that hashes to the record parses its fence the same way, so this code could never legitimately close',
  closed_incomplete: 'a person closed the node: only a person\'s answer replaces it',
  // CHANGED ACCEPTED TEST (lane T, G2, D2 F4c; Q2, Muad 25 Okt 2026 14:45 "Yes to all"): contract_check, split_changed, expansion_refused and derivation_refused MOVED to RESTORABLE_CODES, each closed only by its own live test
  // (src/tree-restore.js restoreDecision). The premises that put them here moved: contract_check reads the task, context and HANDOFF files live, so a file put back changes the check; split_changed is the body hash (the recorded body back is the
  // verified block); expansion_refused stops being raised exactly when a split_verified exists (D2 F3), a record fact the table checks; derivation_refused is the live re-derivation returning (fail closed, D3 F4-1).
};
// blocked-severity codes whose scope is the TREE or an AGREEMENT, never a node key: pendingBlockedChildren (src/tree-blocked-child.js) keeps only scopes matching a node key, so they open no stop
const NOT_NODE_SCOPED = {
  record_unreadable: 'scope tree: the record itself does not read',
  sticky_block: 'scope tree: a sticky tree block (parent_changed, root_affected, record_corrupt)',
  accounting_blocked: 'scope tree: the accounting gate fails',
  integration_failed: 'scope: an agreement (R@g1:A1), not a node',
};
// incomplete-severity codes: they open NO stop (opensBlockedStop = blocked severity, plus BLOCKED_CHILD_ALSO), so the restore never meets them
const NO_STOP = ['awaiting_cap', 'root_missing', 'generation_pending', 'not_started', 'running', 'stopped', 'stale', 'split_not_verified', 'unexpanded', 'needs_decision_unresolved', 'integration_unrecorded', 'held_unrecorded', 'open_stop'];
// the calls whose first argument is not a plain literal, written out exactly, with the codes each can raise (all of them blocked severity here)
const TERNARIES = {
  "blocked(r.check === 'split_changed' ? 'split_changed' : 'expansion_refused', k,": ['split_changed', 'expansion_refused'],
};

const SOURCE = readFileSync(join(import.meta.dirname, '..', 'src', 'tree-ready.js'), 'utf8');
/** Every blocked( / incomplete( CALL in `source` (not its definition): [{ severity, rest }] where `rest` is the call's text after the open paren. Takes the text as a parameter so the self-test below can feed it a known-bad input. */
function callsIn(source) {
  const out = [];
  for (const m of source.matchAll(/\b(blocked|incomplete)\(([^\n]*)(?:\n(?=([^\n]*)))?/g)) {
    const lineStart = source.slice(source.lastIndexOf('\n', m.index) + 1, m.index);
    if (/^\s*(const|function)\b/.test(lineStart) || /=>\s*$/.test(m[2])) continue;
    out.push({ severity: m[1], rest: m[2] === '' || /^\s*$/.test(m[2]) ? `${m[2]}${m[3] ?? ''}` : m[2] });     // a call whose first argument starts on the NEXT line is read from there too (a line break is not a way to hide a ternary)
  }
  return out;
}
function codesOf(severity, source = SOURCE) {
  const out = new Set(); const unknown = [];
  for (const c of callsIn(source).filter(x => x.severity === severity)) {
    const literal = /^'([a-z_]+)'\s*,/.exec(c.rest);
    if (literal) { out.add(literal[1]); continue; }
    const text = `${severity}(${c.rest}`.slice(0, 200);
    const known = Object.keys(TERNARIES).find(t => text.startsWith(t));
    if (known && severity === 'blocked') for (const code of TERNARIES[known]) out.add(code); else unknown.push(text);
  }
  return { codes: out, unknown };
}
const calls = callsIn(SOURCE);

test('the scan CAN FAIL (known-bad input): a NEW ternary, a call split across lines, and a variable first argument each land in `unknown`; a plain literal and the listed ternary do not', () => {
  const bad = ["  blocked(x ? 'a' : 'b', k, `t`);", "  blocked(\n    cond ? 'a' : 'b', k, `t`);", "  incomplete(code, k, `t`);"];
  for (const src of bad) assert.notDeepEqual(codesOf(/^\s*blocked/.test(src) ? 'blocked' : 'incomplete', src).unknown, [], JSON.stringify(src));
  assert.deepEqual(codesOf('blocked', "  blocked('not_passed', k, `t`);").unknown, []);
  assert.deepEqual(codesOf('blocked', "  blocked(r.check === 'split_changed' ? 'split_changed' : 'expansion_refused', k, `t`);").unknown, [], 'the listed ternary is known');
  assert.notDeepEqual(codesOf('blocked', "  blocked(r.check === 'other' ? 'split_changed' : 'expansion_refused', k, `t`);").unknown, [], 'a CHANGED ternary text is unknown again');
});

test('the scan finds the calls it is meant to (it can fail): a handful of known codes are in the source', () => {
  const b = codesOf('blocked'); const i = codesOf('incomplete');
  for (const c of ['report_unreadable', 'plan_unreadable', 'provider_pin', 'not_passed']) assert.ok(b.codes.has(c), `blocked ${c}`);
  for (const c of ['stale', 'running']) assert.ok(i.codes.has(c), `incomplete ${c}`);
  assert.ok(calls.length >= 20, `${calls.length} calls found`);
});

test('no blocked( / incomplete( call hides its code in an expression that is not written out in TERNARIES (a new ternary fails here)', () => {
  assert.deepEqual(codesOf('blocked').unknown, [], 'a blocked( call with a non-literal first argument');
  assert.deepEqual(codesOf('incomplete').unknown, [], 'an incomplete( call with a non-literal first argument');
});

test('every blocked-severity code is decided for the restore: restorable, or refusing with its reason; every incomplete code opens no stop', () => {
  const blocked = codesOf('blocked').codes; const incomplete = codesOf('incomplete').codes;
  const undecided = [...blocked].filter(c => !RESTORABLE_CODES.includes(c) && !(c in REFUSES) && !(c in NOT_NODE_SCOPED));
  assert.deepEqual(undecided, [], 'a readiness code that opens a stop and is neither restorable nor listed as refusing (decide it in RESTORABLE_CODES or REFUSES)');
  for (const c of [...incomplete].filter(c => !BLOCKED_CHILD_ALSO.includes(c))) assert.ok(NO_STOP.includes(c), `incomplete code ${c} opens no stop: list it in NO_STOP (or decide it)`);
  for (const c of BLOCKED_CHILD_ALSO) assert.ok(c in REFUSES, `${c} opens a stop and must be decided`);
  for (const c of Object.keys(REFUSES)) assert.ok(blocked.has(c) || BLOCKED_CHILD_ALSO.includes(c), `REFUSES lists ${c}, which readiness no longer raises`);
  for (const c of RESTORABLE_CODES) assert.ok(blocked.has(c), `RESTORABLE_CODES lists ${c}, which readiness no longer raises as blocked`);
  assert.deepEqual(RESTORABLE_CODES.filter(c => c in REFUSES), [], 'a code is decided ONCE: restorable or refusing, never both');
  for (const c of Object.keys(NOT_NODE_SCOPED)) assert.ok(blocked.has(c), `NOT_NODE_SCOPED lists ${c}, which readiness no longer raises`);
  assert.equal([...Object.values(REFUSES), ...Object.values(NOT_NODE_SCOPED)].every(w => w.length > 10), true, 'each decision carries its reason');
});
