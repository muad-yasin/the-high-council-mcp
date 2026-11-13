// 0.8.4 T14 (CA2/D17, amended by the owner 05 Nov 2026 03:52): a changed WORDING on resume continues on the saved replies; a changed CONTENT is a cache miss as before. The pure rule (src/stale-guard.js), offline, $0.
// RED BASE 61a36cc1 has no src/stale-guard.js: this file fails to LOAD there (one error, ERR_MODULE_NOT_FOUND, no named rows); its rows are matched on the committed tree only.
// Row ids P1-P10 are unique to this file (the real-verb rows of the T14 unit use T14-b.. in test/stale-wording.test.js).
//   P1 passOfLabel;  P2 the rule's one yes;  P3 its refusals;  P4 the sibling case (a run paused at an external seat mid-pass makes no paid call for its cached group-mates);  P5 a live miss of a group-mate;
//   P6 fail closed: unstamped, later sitting, edited reply, live upstream;  P7 the record writtenBy;  P8 the kept list is rebuilt per ledger;  P9 textHashOf;  P10 one row per label.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as SG from '../src/stale-guard.js';

const NOW = { version: '0.8.4', code_sha256: 'b'.repeat(64) };
const OLD = { version: '0.8.4', code_sha256: 'a'.repeat(64), sitting: 1, text: 'x'.repeat(12) };
const ledger = (now = NOW) => SG.createWordingLedger({ now });

test('P1 passOfLabel: every stage family that belongs to a pass names it (revise-N is the reply to pass N); a stage that belongs to no pass is null', () => {
  const table = [['panel-3-l1', 3], ['panel-12-l2', 12], ['critique-2', 2], ['revise-4', 4], ['revise-4-full', 4], ['allocator-2', 2], ['ldebate-5-x2-l1', 5], ['lreply-5-x2-l1', 5], ['rule-3', 3], ['conflict-2', 2],
    ['criteria', null], ['skeleton', null], ['build', null], ['handoff', null], ['build-check-1', null], ['final-read-L3-l3', null], ['panelist-3-x', null], ['propose-a', null]];
  for (const [label, pass] of table) assert.equal(SG.passOfLabel(label), pass, label);
});

test('P2 the one yes: a prompt-stale stage with a stamp, an unchanged reply, a changed code and nothing changed upstream is KEPT and listed (label, pass, cause, the version that wrote it)', () => {
  const g = ledger();
  g.note({ label: 'criteria', writtenBy: OLD });
  g.note({ label: 'panel-1-a', group: 'panel-1-L1', writtenBy: OLD });
  const d = g.decide({ label: 'critique-1', writtenBy: OLD });
  assert.deepEqual(d, { keep: true });
  assert.deepEqual(g.kept, [{ stage: 'critique-1', pass: 1, cause: 'prompt', written_under: '0.8.4' }]);
});

test('P3 the refusals, each with its reason: same code (content, audit 5), no stamp, an unarmed ledger, a version-only comparison when a stamp is missing', () => {
  assert.deepEqual(ledger().decide({ label: 'panel-1-a', writtenBy: { ...OLD, code_sha256: NOW.code_sha256 } }), { keep: false, why: 'same_code' }, 'same code, different prompt: only the content can have changed');
  assert.deepEqual(ledger().decide({ label: 'panel-1-a', writtenBy: null }), { keep: false, why: 'no_stamp' });
  assert.deepEqual(ledger().decide({ label: 'panel-1-a', writtenBy: { version: '0.8.4', code_sha256: 'a'.repeat(64) } }), { keep: false, why: 'no_stamp' }, 'a record with no sitting number is unstamped');
  assert.deepEqual(SG.createWordingLedger({ now: null }).decide({ label: 'panel-1-a', writtenBy: OLD }), { keep: false, why: 'unarmed' });
  // PIN (limit): with no code stamp on either side the comparison is by version alone, so two builds with one version string are never "changed".
  assert.deepEqual(ledger({ version: '0.8.4' }).decide({ label: 'panel-1-a', writtenBy: { version: '0.8.4', sitting: 1 } }), { keep: false, why: 'same_code' });
  assert.deepEqual(ledger({ version: '0.8.5' }).decide({ label: 'panel-1-a', writtenBy: { version: '0.8.4', sitting: 1 } }), { keep: true }, 'a different version counts without any stamp');
});

test('P4 THE SIBLING CASE (pure rule): critic 2 was written in a LATER sitting than critics 1 and 3 (a seat that really ran or was rewritten after them), one declared group: critic 3 is KEPT (no paid call); the same three without the group make critic 3 a miss. An external answer received between sittings carries the ASKING sitting (plan 3b), so it is not "later" and the ungrouped case keeps it too: that is the real-verb row T14-s', () => {
  const run = group => {
    const g = ledger();
    g.note({ label: 'criteria', writtenBy: OLD });
    const c1 = g.decide({ label: 'panel-1-a', group, writtenBy: OLD }); g.note({ label: 'panel-1-a', group, writtenBy: OLD });
    const c2 = g.decide({ label: 'panel-1-b', group, writtenBy: OLD }); g.note({ label: 'panel-1-b', group, writtenBy: { ...OLD, sitting: 2 } });   // written in sitting 2
    const c3 = g.decide({ label: 'panel-1-c', group, writtenBy: OLD });
    return [c1.keep, c2.keep, c3.keep, c3.why];
  };
  assert.deepEqual(run('panel-1-L1'), [true, true, true, undefined], 'grouped: zero re-asks');
  assert.deepEqual(run(null), [true, true, false, 'upstream_changed'], 'ungrouped: the later-sitting sibling counts as changed (the safe side)');
});

test('P5 a live miss of one group-mate does not make another pay; a live miss of an UPSTREAM stage does', () => {
  const g = ledger();
  g.note({ label: 'panel-1-a', group: 'panel-1-L1', live: true });
  assert.deepEqual(g.decide({ label: 'panel-1-c', group: 'panel-1-L1', writtenBy: OLD }), { keep: true });
  const h = ledger();
  h.note({ label: 'revise-1', live: true });
  assert.deepEqual(h.decide({ label: 'panel-2-a', group: 'panel-2-L1', writtenBy: OLD }), { keep: false, why: 'upstream_changed', upstream: 'revise-1' });
});

test('P6 fail closed: an unstamped upstream, an upstream written in a LATER sitting (audit 5), an upstream whose reply was edited, and a group-mate of ANOTHER group each make the stage a miss', () => {
  const miss = (entry, group = 'g2') => { const g = ledger(); g.note(entry); return g.decide({ label: 'panel-2-a', group, writtenBy: OLD }); };
  assert.equal(miss({ label: 'revise-1', writtenBy: null }).why, 'upstream_changed', 'unstamped');
  assert.equal(miss({ label: 'revise-1', writtenBy: { ...OLD, sitting: 2 } }).why, 'upstream_changed', 'written after this stage was cached');
  assert.equal(miss({ label: 'revise-1', writtenBy: OLD, textOk: false }).why, 'upstream_changed', 'edited reply');
  assert.equal(miss({ label: 'panel-2-z', group: 'g1', writtenBy: { ...OLD, sitting: 2 } }).why, 'upstream_changed', 'another group is a dependency');
  assert.deepEqual(ledger().decide({ label: 'panel-2-a', writtenBy: OLD, textOk: false }), { keep: false, why: 'text_edited' }, "the stage's own edited reply");
  // the same sitting number is not "later": a stage written in the same sitting as the dependent is upstream of it by run order
  assert.equal(miss({ label: 'revise-1', writtenBy: OLD }, 'g2').keep, true);
});

test('P7 writtenByRecord: version, the stamp when there is one, the sitting, the reply hash when given; null when the sitting has no stamp (fail closed: nothing is written)', () => {
  assert.deepEqual(SG.writtenByRecord({ now: NOW, sitting: 2, text: 'abcdef012345' }), { version: '0.8.4', code_sha256: NOW.code_sha256, sitting: 2, text: 'abcdef012345' });
  assert.deepEqual(SG.writtenByRecord({ now: { version: '0.8.4' }, sitting: 1 }), { version: '0.8.4', sitting: 1 }, 'no code stamp, no text: both keys absent');
  assert.equal(SG.writtenByRecord({ now: NOW, sitting: null }), null);
  assert.equal(SG.writtenByRecord({ now: null, sitting: 1 }), null);
  assert.equal(SG.writtenByRecord({ now: NOW, sitting: 0 }), null);
});

test('P8 the kept list belongs to its ledger (rebuilt per sitting, never carried); wordingChanged on both sides of the stamp rule', () => {
  const a = ledger(); a.decide({ label: 'critique-1', writtenBy: OLD });
  assert.equal(a.kept.length, 1);
  assert.equal(ledger().kept.length, 0);
  assert.equal(SG.wordingChanged({ version: '0.8.3' }, { version: '0.8.4' }), true);
  assert.equal(SG.wordingChanged({ version: '0.8.4', code_sha256: 'a' }, { version: '0.8.4' }), false);
  assert.equal(SG.wordingChanged(null, NOW), false);
});

test('P9 textHashOf: 12 hex over the text, stable, and different for a different text (what writtenBy.text holds)', () => {
  assert.match(SG.textHashOf('a plan'), /^[0-9a-f]{12}$/);
  assert.equal(SG.textHashOf('a plan'), SG.textHashOf('a plan'));
  assert.notEqual(SG.textHashOf('a plan'), SG.textHashOf('a plan '));
  assert.equal(SG.textHashOf(undefined), SG.textHashOf(''), 'a missing text hashes as empty, never throws');
});

test('P10 deciding the same label twice (a call asked again in one sitting) keeps ONE row in the list', () => {
  const g = ledger();
  assert.deepEqual(g.decide({ label: 'panel-1-a', group: 'panel-1-L1', writtenBy: OLD }), { keep: true });
  assert.deepEqual(g.decide({ label: 'panel-1-a', group: 'panel-1-L1', writtenBy: OLD }), { keep: true });
  assert.equal(g.kept.length, 1);
});
