// 0.8.4 (ladder unit, own fix-up on the read-on-disk commit; C&C 10 Nov): the stale-guard keep rule (src/stale-guard.js, rule 3) applied to a FINAL READ. A read on disk counts at a finish-now only when it answered THIS text.
// A read whose prompt differs is kept ONLY when THC's wording changed and nothing it depends on changed; a draft that changed is a cache miss, so the read is not replayed and the seat reads not run.
// PURE: no disk, no clock. Row ids SG-FR-1 ... 6. The control of each refusal is SG-FR-1 (the one yes).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as SG from '../src/stale-guard.js';

const NOW = { version: '0.8.4', code_sha256: 'b'.repeat(64) };
const WROTE = n => ({ version: '0.8.4', code_sha256: 'a'.repeat(64), sitting: n, text: 'x'.repeat(12) });   // written by older code in sitting n
const READ = 'final-read-top-gamma';
const ledger = () => SG.createWordingLedger({ now: NOW });

test('SG-FR-1 (the control, the one yes): the read was written under older wording in sitting 1, every stage upstream of it was written in sitting 1 and replays unchanged: the read is KEPT (the same text, other words)', () => {
  const g = ledger();
  for (const label of ['criteria', 'build', 'panel-1-l1', 'revise-1', 'panel-2-l3']) g.note({ label, writtenBy: WROTE(1) });
  assert.deepEqual(g.decide({ label: READ, writtenBy: WROTE(1) }), { keep: true });
  assert.deepEqual(g.kept.map(k => k.stage), [READ]);
});

test('SG-FR-2 (the draft changed after the read, in a LATER sitting): the rounds reopened in sitting 2 and a revise was written there: the read of sitting 1 is NOT kept (upstream_changed, naming the revise), whatever the wording did', () => {
  const g = ledger();
  for (const label of ['criteria', 'build', 'panel-1-l1']) g.note({ label, writtenBy: WROTE(1) });
  g.note({ label: 'revise-3', writtenBy: WROTE(2) });
  assert.deepEqual(g.decide({ label: READ, writtenBy: WROTE(1) }), { keep: false, why: 'upstream_changed', upstream: 'revise-3' });
  assert.deepEqual(g.kept, []);
});

test('SG-FR-3 (the draft changed in THIS sitting): a revise that ran live or missed the cache in the sitting being run (it changes what later stages are asked) makes the read not kept - the finish-now sitting never runs one, but a plain resume does', () => {
  const g = ledger();
  g.note({ label: 'criteria', writtenBy: WROTE(1) });
  g.note({ label: 'revise-3', live: true });
  assert.deepEqual(g.decide({ label: READ, writtenBy: WROTE(1) }), { keep: false, why: 'upstream_changed', upstream: 'revise-3' });
});

test('SG-FR-4 (a draft changed in the SAME sitting as the read, written BEFORE it in run order): the rule does not call it changed - it existed when the read was written, so the read answered it; it is kept. PINNED as the rule\'s own design: the ledger holds only stages UPSTREAM of the call in run order, and a revise written after the read in the same sitting is downstream and cannot change the read\'s prompt', () => {
  const g = ledger();
  g.note({ label: 'revise-2', writtenBy: WROTE(1) });
  assert.deepEqual(g.decide({ label: READ, writtenBy: WROTE(1) }), { keep: true });
});

test('SG-FR-5 (a draft whose saved text was edited by hand, or that has no stamp): the read is not kept - an unstamped upstream stage counts as later than everything, an edited reply no longer matches its recorded text', () => {
  const unstamped = ledger(); unstamped.note({ label: 'revise-2', writtenBy: null });
  assert.deepEqual(unstamped.decide({ label: READ, writtenBy: WROTE(1) }), { keep: false, why: 'upstream_changed', upstream: 'revise-2' });
  const edited = ledger(); edited.note({ label: 'revise-2', writtenBy: WROTE(1), textOk: false });
  assert.deepEqual(edited.decide({ label: READ, writtenBy: WROTE(1) }), { keep: false, why: 'upstream_changed', upstream: 'revise-2' });
});

test('SG-FR-6 (content, not wording): the code that wrote the read is the code now running, yet the prompt differs: only the content can have changed, so the read is not kept (same_code); and a read with no stamp, or an unarmed ledger, is never kept', () => {
  assert.deepEqual(ledger().decide({ label: READ, writtenBy: { ...WROTE(1), code_sha256: NOW.code_sha256 } }), { keep: false, why: 'same_code' });
  assert.deepEqual(ledger().decide({ label: READ, writtenBy: null }), { keep: false, why: 'no_stamp' });
  assert.deepEqual(SG.createWordingLedger({ now: null }).decide({ label: READ, writtenBy: WROTE(1) }), { keep: false, why: 'unarmed' });
});
