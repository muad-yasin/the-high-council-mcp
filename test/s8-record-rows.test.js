// 0.8.4 S8 (M3) record rows T13u and T17v (the two NEW run rows of the 32-row list; the four assertion rows are edits of RL-6, GU-5 and C3-23 and call the same module). $0, offline, mock seats. Fixtures and assertions: test/helpers/s8-record-rows.js.
// The RED version of each row is the same check run on a swapped input: test/s8-record-rows-red.test.js (never committed).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { runT13u, checkT13u, runT17v, checkT17v } from './helpers/s8-record-rows.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

test('T13u (Part 0, CA8, Q8 item 5): the handler\'s not_yet after a layer-3 SIGN-OFF that sorted a block of seat S may-leave: layer 3\'s reasons are not shown to S in its next review (failing case: S sees them); S answers its own open block as usual', async () => {
  const d = await runT13u(false);
  checkT13u(d);
  // facts that hold only for the sign-off run (they are false in the layer-3-objects variant, so they are not in checkT13u)
  const row = d.result.panelVerdicts.find(v => v.lab === 'top-gamma' && v.round === 3);
  assert.equal(row.verdict, 'signed_off', 'T13u-s1: layer 3 SIGNED OFF at pass 3');
  assert.ok(d.served.indexOf('build-check-1') >= 0 && d.served.indexOf('build-check-1') < d.served.indexOf('panel-4-mid-beta'), 'T13u-s2: the handler\'s check came before S\'s next review (the not_yet sent the plan back)');
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-t13u', chain: 'fixture-t13u', task: 't.md', result: d.result, config: d.config })));   // as s7c-reasons.test.js reportOf :59
  // CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, row R06; a record row). OLD: [['undecided', 'prompt_held']] ("its words are not recorded here"). NEW: the go-up ruling call is served (rule-3-top-gamma) and the record reads [['undecided', 'unreadable_ruling']]. WHY: the go-up ruling words (goUpRulingSystem, goUpRulingUser, goUpRulingsSection) are recorded in src/roles.js since dc60423a, so held() finds them although this fixture injects none: the ruling IS asked, the fixture's mock reply for it is the plan text, which no ruling parser reads, so the ruling decided nothing. The conclusion stays: the only source of an overrule row is the sorting.
  assert.ok(d.served.includes('rule-3-top-gamma'), 'T13u-s3a: the go-up ruling is asked of layer 3 (its words are recorded)');
  assert.deepEqual(report.escalations[0].outcome.map(o => [o.result, o.why]), [['undecided', 'unreadable_ruling']], 'T13u-s3: the go-up ruling is undecided (asked, its reply is unreadable), so the only source of an overrule row is the sorting');
  // NAMED GAP (not driven): "the block open on the record as a dissent" - needs S to keep the block in pass 4, dissentRecordSection held and an agreement point with the block open (chain.js :6880); not traced.
});

test('T17v (Q8): an objection named in a post that stands when the ending exchange ends is sorted at layer 3\'s final read (failing case: it reaches the ending unsorted)', async () => {
  const d = await runT17v(false);
  checkT17v(d);
});
