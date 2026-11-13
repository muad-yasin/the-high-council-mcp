// PR #2 fix unit, ruling 13: the line the raise screen shows about the person's finish ("What your finish does: ...", src/spend-finish.js spendFinishNote, S16-w66) said the run ends at the stop, after the final read, and nothing about the figure it prints: that figure is
// what the NEXT call needs (src/resume-ceiling.js), not what the whole finish needs. The --finish answer (S16-w62f) already says it: "a raise that does not cover it stops the run again, still not ended." The note now ends with those words as a sentence of its own, no new wording;
// the raise screen and the line a resume prints read the same constant. In-process, offline, $0: the pure functions and the screen builder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spendFinishNote, spendFinishAnswer } from '../src/spend-finish.js';
import { buildCapScreen } from '../src/cap-screen.js';

// the caveat, taken from the answer that records it (never retyped here)
const CAVEAT = /(a raise that does not cover it stops the run again, still not ended\.)/.exec(spendFinishAnswer({ label: 'panel-2-lb', runDir: 'r' }))?.[1];
const SAID = CAVEAT ? CAVEAT[0].toUpperCase() + CAVEAT.slice(1) : null;

test('premise: the --finish answer carries the caveat once, and its last words are the caveat', () => {
  assert.ok(CAVEAT, 'the answer names the caveat');
  const answer = spendFinishAnswer({ label: 'panel-2-lb', topLayer: 3, topSeats: 2, runDir: 'r' });
  assert.equal(answer.split(CAVEAT).length - 1, 1);
  assert.ok(answer.endsWith(CAVEAT));
});

test('the finish note ends with the caveat of the --finish answer, in the same words, and still begins as it did', () => {
  const note = spendFinishNote('panel-2-lb');
  assert.ok(note.endsWith(` ${SAID}`), note);
  assert.ok(note.startsWith('  you chose to end the run at the spending stop (stage "panel-2-lb"); it ends there, NOT agreed, after the final read.'));
  assert.equal(note.split(SAID).length - 1, 1, 'once');
});

test('the raise screen of a run with a finish armed shows the caveat on its "What your finish does" line, before the person types the figure', () => {
  for (const kind of ['raise', 'raise_early', 'amend', 'legacy']) {
    const text = buildCapScreen({ kind, history: { previousCapUsd: 1, spentUsd: 0.9, floorUsd: 0.9, suggestedUsd: 1.2, finishNote: spendFinishNote('panel-2-lb') } }).text;
    const line = text.split('\n').find(l => l.startsWith('What your finish does:'));
    assert.ok(line && line.endsWith(SAID), `${kind}: ${line}`);
  }
});
