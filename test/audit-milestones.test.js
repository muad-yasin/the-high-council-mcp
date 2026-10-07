// 0.8.2 audit fixes, Tier 1 item 2 (73-handoff-contract 2 + 3): the milestone parser never hangs. A criterion token of 17+ digits (value >= 2^53) made `n++` a no-op in the range loop
// (an endless loop AFTER the paid stages, and every resume replays the cached handoff.md into the same loop); a whitespace-separated id list with no "|" backtracked exponentially. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintMilestones, parseMilestones } from '../src/milestones.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'Status: ready_for_build\n\n## Milestones\n\n### M1 - first\nExit: done\n- check: C1 | run it => ok\n';

// The old parser never returned on these inputs, so each runs in a child process with a limit: a hang is a red test, not a stuck suite.
const inChild = (body, ms = 15000) => {
  const script = `import { lintMilestones, parseMilestones } from ${JSON.stringify(join(root, 'src', 'milestones.js'))};\nconst base = ${JSON.stringify(BASE)};\n${body}`;
  const p = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: ms });
  assert.equal(p.error?.code, undefined, `it returned (not a timeout): ${p.error?.message}`);
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout);
};

test('73-handoff 2: a C-token of 17 digits in a "- discharges:" line returns at once', () => {
  const kinds = inChild(`console.log(JSON.stringify(lintMilestones({ text: base + '- discharges: C1 (ref C20261007031500123)\\n', criteriaIds: ['C1'] }).findings.map(f => f.kind)));`);
  assert.deepEqual(kinds, [], 'the long token is not an id; the real C1 is discharged by its check');
});

test('73-handoff 2: a token that is not a criterion id (more than 4 digits) names nothing, in a check list and in a range', () => {
  const out = inChild(`const m = parseMilestones(base.replace('- check: C1 |', '- check: C1, C99999999999999999999 |') + '- discharges: C20261007031500123, C2-C99999999999999999999\\n');
    console.log(JSON.stringify([m.milestones[0].checks[0].criteria, m.milestones[0].discharges]));`);
  assert.deepEqual(out, [[], ['C2']], 'a check list with a non-id in it is not an id list at all; in a discharges line the readable C2 stands and the junk token names nothing');
});

test('73-handoff 3: 30 whitespace-separated ids and no "|" return in under 50 ms; zero-padded ids too', () => {
  const out = inChild(`const lists = [Array.from({ length: 30 }, (_, i) => 'C' + (i + 1)).join(' '), Array(34).fill('C0001').join(' '), Array(34).fill('C1 to C2').join(' ')];
    console.log(JSON.stringify(lists.map(ids => { const t0 = Date.now(); const m = parseMilestones(base.replace('- check: C1 | run it', '- check: ' + ids + ': run tests')); return [Date.now() - t0, m.milestones[0].checks[0].criteria]; })));`, 20000);
  for (const [ms, criteria] of out) { assert.ok(ms < 50, `parsed in ${ms} ms`); assert.deepEqual(criteria, [], 'no "|" straight after the list: the ids name nothing'); }
});

test('the id shapes that worked still work: C1, C01, ranges, commas, "&", "and", and a check with a pipe in its own text', () => {
  const cases = [['C1, C3 | a => b', ['C1', 'C3']], ['C01 | a => b', ['C1']], ['C1-C3 | a => b', ['C1', 'C2', 'C3']], ['C2 to C4 | a => b', ['C2', 'C3', 'C4']], ['C1 & C2 | a => b', ['C1', 'C2']], ['C1, C3 and C5 | a => b', ['C1', 'C3', 'C5']], ['C1 C2 | a => b', ['C1', 'C2']], ['C1 | a | b => c', ['C1']]];
  for (const [line, want] of cases) assert.deepEqual(parseMilestones(BASE.replace('- check: C1 | run it => ok', `- check: ${line}`)).milestones[0].checks[0].criteria, want, line);
  assert.deepEqual(parseMilestones(BASE.replace('- check: C1 | run it => ok', '- check: C1 | a | b => c')).milestones[0].checks[0].check, 'a | b');
  assert.deepEqual(lintMilestones({ text: BASE, criteriaIds: ['C1'] }).findings, []);
});
