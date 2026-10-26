// Bug audit 2026-09-23 (Review/BugAudit_CLI_2026-09-23.md #7): outcomes shared exit codes, so a
// caller could not tell a missing key from a preflight block, or a usage error from the artifact
// gate. Every named exit code in src/cli.js is distinct, and the README's table lists each one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
// README split (owner, 26 Okt 2026: "one final commit"): the section moved word for word to AI-README.md (the exit-code table); the pin reads it there.
const readme = readFileSync(join(root, 'AI-README.md'), 'utf8');
// cli.js keeps most EXIT_ constants itself; 22 and 23 come from src/exit-codes.js (the one module the programs that spawn the CLI also read). Exit-22 unit: `named` reads both places, so no code can be left out.
const exitCodesSrc = readFileSync(join(root, 'src', 'exit-codes.js'), 'utf8');
const named = [...cli.matchAll(/^const (EXIT_[A-Z_]+) = (\d+);/gm), ...exitCodesSrc.matchAll(/^export const (EXIT_[A-Z_]+) = (\d+);/gm)].map(m => [m[1], Number(m[2])]);

test('every named exit code is distinct', () => {
  assert.ok(named.length >= 10, `expected the EXIT_ constants, found ${named.length}`);
  const values = named.map(([, v]) => v);
  assert.equal(new Set(values).size, values.length, JSON.stringify(named));
});

test('the tree\'s "stopped for a person" code is one number in src/cli.js and src/tree-resume.js, is not 0 or 1, and covers held_by_stop, limit_reached and awaiting_choice (and nothing else is mapped to it)', async () => {
  const { EXIT_STOPPED_FOR_PERSON } = await import('../src/tree-resume.js');
  const fromCli = named.find(([k]) => k === 'EXIT_TREE_STOPPED_FOR_PERSON')?.[1];
  assert.equal(fromCli, EXIT_STOPPED_FOR_PERSON); assert.ok(![0, 1].includes(EXIT_STOPPED_FOR_PERSON));
  const src = readFileSync(join(root, 'src', 'tree-resume.js'), 'utf8');
  assert.match(src, /const EXIT_OF = \{ held_by_stop: EXIT_STOPPED_FOR_PERSON, limit_reached: EXIT_STOPPED_FOR_PERSON, awaiting_choice: EXIT_STOPPED_FOR_PERSON, /);
  // CHANGED ACCEPTED (lane T, G3+4, D3 F9-1): OLD 6. NEW 7: a sitting with nothing to do while an approved child (or new root plan) waits for money it was not admitted for exits 20 too (the person raises the cap; tree-admission-reopen.test.js pins the exit)
  assert.equal((src.match(/EXIT_STOPPED_FOR_PERSON/g) ?? []).length, 7, 'the constant, its three mappings, the blocked rule, the waiting approval and the money wait');
});

test('a blocked tree exits 20 when a person can act (root_affected, parent_changed) and 1 when something is broken (record_corrupt, an unknown reason, none)', async () => {
  const { exitCodeOf, EXIT_STOPPED_FOR_PERSON } = await import('../src/tree-resume.js');
  const blocked = reasons => exitCodeOf({ status: 'blocked', reasons });
  assert.equal(blocked(['root_affected']), EXIT_STOPPED_FOR_PERSON); assert.equal(blocked(['parent_changed']), EXIT_STOPPED_FOR_PERSON); assert.equal(blocked(['root_affected', 'parent_changed']), EXIT_STOPPED_FOR_PERSON);
  assert.equal(blocked(['record_corrupt']), 1); assert.equal(blocked(['parent_changed', 'record_corrupt']), 1); assert.equal(blocked(['something_new']), 1); assert.equal(blocked([]), 1);
  assert.equal(exitCodeOf({ status: 'held_by_stop' }), EXIT_STOPPED_FOR_PERSON); assert.equal(exitCodeOf({ status: 'limit_reached' }), EXIT_STOPPED_FOR_PERSON); assert.equal(exitCodeOf({ status: 'nothing_to_do' }), 0); assert.equal(exitCodeOf({ status: 'nothing_to_do', approvalWaits: false }), 0); assert.equal(exitCodeOf({ status: 'nothing_to_do', approvalWaits: true }), EXIT_STOPPED_FOR_PERSON, 'a waiting approval is a human gate: not 0'); assert.equal(exitCodeOf({ status: 'stopped_by_person' }), 0); assert.equal(exitCodeOf({ status: 'crashed' }), 1);
});

test('the README exit-code table lists every code the CLI uses, and no other', () => {
  const table = readme.slice(readme.indexOf('### Exit codes'));
  const documented = new Set([...table.slice(0, table.indexOf('Codes 9-17')).matchAll(/^\| (\d+) \|/gm)].map(m => Number(m[1])));
  const literal = [...cli.matchAll(/process\.exit\((\d+)\)/g)].map(m => Number(m[1]));
  const used = new Set([...literal, ...named.map(([, v]) => v)]);
  assert.deepEqual([...used].sort((a, b) => a - b), [...documented].sort((a, b) => a - b));
});

test('exit-22 unit: 22 (ended, not agreed) and 23 (stopped for the person) live in src/exit-codes.js only; the finished set is 0, 7, 8 and 22; tree-run and tree-resume read 23 as the same number (pinned, not imported)', async () => {
  const codes = await import('../src/exit-codes.js');
  const { STATUS_OF_EXIT } = await import('../src/tree-resume.js');
  assert.equal(codes.EXIT_NOT_AGREED, 22); assert.equal(codes.EXIT_ROUND_STOPPED, 23);
  assert.deepEqual([...codes.FINISHED_EXIT_CODES].sort((a, b) => a - b), [0, 7, 8, 22]);
  assert.equal(codes.FINISHED_EXIT_CODES.has(codes.EXIT_ROUND_STOPPED), false, '23 is a stop, not a finish');
  assert.equal(STATUS_OF_EXIT[codes.EXIT_ROUND_STOPPED], 'awaiting_choice', 'tree-resume maps the same 23');
  const treeRun = readFileSync(join(root, 'src', 'tree-run.js'), 'utf8');
  assert.match(treeRun, new RegExp(`code === ${codes.EXIT_ROUND_STOPPED}\\) return result\\('awaiting_choice'`), 'tree-run reads the same 23 for a stopped member');
  for (const f of ['cli.js', join('mcp', 'server.js')]) {
    const src = readFileSync(join(root, 'src', f), 'utf8');
    assert.equal(/^const EXIT_(NOT_AGREED|ROUND_STOPPED) = /m.test(src), false, `${f} holds no second copy`);
  }
});
