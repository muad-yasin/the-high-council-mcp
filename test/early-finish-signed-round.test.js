// 0.8.4 round 1, held fix: report.json `signed_text.round` names the round in which the draft with signed_text.sha256 was put to the panel. Through the real CLI, $0 (test/helpers/early-ladder-run.js: the ladder chain, every judge a mock, the writer external).
// The case: a run ends EARLY at the session's proposal. The text it signed is the draft the overseer layer was asked about in the early ask's pass, and that pass is not one of the passes the panel's verdict rows record
// (the early ask's yes is recorded nowhere as a verdict), so the field named the pass BEFORE: 1 where the ask was in pass 2 (leg P1), 4 where it was in pass 5 (leg P2).
// What tells the case apart (not a wording pin): the round of the prompt that carried this text to a judge. Each leg reads it from the prompt log (a prompt's label names its round, its reply identity names the draft by the first 12 hex of the text's sha256), never from the report.
// Controls: not in this file. The shapes the change must not move (a run that ends at a sign-off, a delivered text that differs, the in-process leg D that stays at round 2) are read by test/text-labels.test.js, test/signed-vs-delivered.test.js and test/a7-finish-now-late-finding.test.js, which ran green before and after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { earlyLadderRun } from './helpers/early-ladder-run.js';

const LEGS = { P1: () => 'mock-exch-support-keep-clean', P2: l => (l === 1 ? 'mock-exch-support-keep-always-sev5' : 'mock-exch-support-keep-clean') };
const ran = {};
const leg = k => (ran[k] ??= earlyLadderRun({ name: `esr-${k.toLowerCase()}`, critic: LEGS[k] }));

function premise(w) {
  assert.ok(w.report, `premise: the run wrote report.json (steps ${JSON.stringify(w.steps)})`);
  assert.equal(w.report.stop?.kind, 'early_finish', 'premise: the run ended early at the session\'s proposal');
  assert.ok(w.asks.length > 0, 'premise: the overseer layer was shown the early ask');
}
for (const k of ['P1', 'P2']) {
  test(`signed_text.round (${k}): an early finish names the round in which the signed text was put to the panel (the early ask's own round)`, () => {
    const w = leg(k); premise(w);
    const sha = w.report.signed_text.sha256;
    const carried = w.asks.filter(a => a.draftId === sha.slice(0, 12));
    assert.ok(carried.length > 0, `premise: an early ask carries the signed text's id (${w.asks.map(a => `${a.label}:${a.draftId}`).join(' ')} vs ${sha.slice(0, 12)})`);
    assert.equal(w.report.signed_text.round, Math.max(...carried.map(a => a.round)), `the round of the prompt that carried the text (the report says ${w.report.signed_text.round}; the ask was in ${carried.map(a => a.round).join(',')})`);
    assert.equal(w.report.signed_text.round, w.report.stop.pass, 'and the stop is in that same pass');
  });
}
