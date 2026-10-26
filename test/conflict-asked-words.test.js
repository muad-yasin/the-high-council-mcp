// PI-5's CODE FINDING (d0, pass-2 follow-up; lane B, 24 Okt 2026): the stop line of a conflict the decider asked about joined EVERY id with one connector, so a returned objection with two or more other objections printed "X came back after Y came back after Z". The line now names the returned objection first and lists the others after "in response to", joined with ", " (the shape of the board line in src/report-shape.js). Pure text of src/conflict-decider.js conflictAskedWords; the words of the line are d0's signed PI-5 sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictAskedWords } from '../src/conflict-decider.js';

const conflictLine = (conflict, n = 1) => conflictAskedWords({ pass: 3, conflicts: [{ n, decider_prevail: 'neither', ...conflict }] }, { runPath: 'runs/R1', command: 'council' }).split('\n').find(l => l.startsWith(`Conflict ${n}:`));

test('one other objection: the line is d0\'s sentence byte for byte', () => {
  const line = conflictLine({ ids: ['O-a', 'O-b'], labs: ['la', 'lb'], layers: [1, 2], rounds: [1, 2], silent_round: 2 });
  assert.equal(line, 'Conflict 1: O-a (la, layer 1, raised in pass 1) came back after the writer revised the plan in response to O-b (lb, layer 2, raised in pass 2). The judge that raised O-a was asked in pass 2 and did not list it.');
});

test('two other objections: ONE "came back after", the others in one comma list after "in response to"', () => {
  const line = conflictLine({ ids: ['O-a', 'O-b', 'O-c'], labs: ['la', 'lb', 'lc'], layers: [1, 2, 3], rounds: [1, 2, 3], silent_round: 3 });
  assert.equal(line.split('came back after').length - 1, 1, line);
  assert.equal(line, 'Conflict 1: O-a (la, layer 1, raised in pass 1) came back after the writer revised the plan in response to O-b (lb, layer 2, raised in pass 2), O-c (lc, layer 3, raised in pass 3). The judge that raised O-a was asked in pass 3 and did not list it.');
});

test('each asked conflict gets its own line, and the one command still names every id', () => {
  const w = conflictAskedWords({ pass: 3, conflicts: [
    { n: 1, ids: ['O-a', 'O-b'], labs: ['la', 'lb'], layers: [1, 2], rounds: [1, 2], silent_round: 2, decider_prevail: 'O-b' },
    { n: 2, ids: ['O-c', 'O-d', 'O-e'], labs: ['lc', 'ld', 'le'], layers: [1, 2, 3], rounds: [1, 2, 3], silent_round: 3, decider_prevail: 'neither' }] }, { runPath: 'runs/R1', command: 'council' });
  const lines = w.split('\n').filter(l => /^Conflict \d:/.test(l));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.equal(l.split('came back after').length - 1, 1, l);
  assert.ok(w.includes('--prevail 1=<O-a|O-b|neither>,2=<O-c|O-d|O-e|neither>'));
});
