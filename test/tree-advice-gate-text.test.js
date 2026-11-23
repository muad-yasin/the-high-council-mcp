// 0.8.3 ROADMAP 77, step 4 (person-facing money words, B-DRAFT); 0.8.4 (the advice add-on is removed, wave 2): the recommendation request's hold left the tree, so the money words are the plain ones. Rows: (T1) the cap-amendment gate has
// one "granted and not yet spent" line, no line about a recommendation request, and "committed in all" is the sum of what it lists; (T2) the top-up gate's money sentence is built by heldWordsOf, which says "held for children X" and nothing else.
// All $0, the real handler.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: T1 and T2 registered a recommendation request (registerAdviceAdmitted) and expected its own hold line and "... and for a recommendation request Y". NEW: no request can exist; T1 pins the plain gate text, T2 pins heldWordsOf as "held for children X" only. WHY: src/tree-advice-record.js is removed with the recommendation route; the words that stay are these.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideHandler, heldWordsOf } from '../src/tree-decide.js';
import { budgetOf } from '../src/tree-budget.js';
import { closedRootTree, ROOT_ID } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';

const shownBy = async t => {
  const io = terminal([]); io.stdin.end();
  await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { 'amend-cap': '30' }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  return io.shown() + io.errors();
};

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the gate named a recommendation request's hold on its own line and left it out of "granted and not yet spent". NEW: the gate has the one "granted and not yet spent" line and no recommendation line. WHY: the request and its hold are removed.
test('T1 the cap-amendment gate has one "granted and not yet spent" line and no line about a recommendation request', async () => {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  const plain = await shownBy(t);
  assert.match(plain, /Where the money stands now/); assert.doesNotMatch(plain, /recommendation/i);
  assert.match(plain, /granted and not yet spent: \$0\.00/, plain);
  assert.match(plain, /committed in all: \$[\d.]+/, plain);
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: heldWordsOf added "and for a recommendation request Y" while a request held money. NEW: it is "held for children X" only. WHY: the request and its hold are removed.
test('T2 heldWordsOf: "held for children X" only; the top-up gate text is built with it', () => {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  assert.match(heldWordsOf(budgetOf(t.rootDir)), /^held for children \$[\d.]+$/);
  assert.doesNotMatch(heldWordsOf(budgetOf(t.rootDir)), /recommendation/);
  assert.match(readFileSync(new URL('../src/tree-decide.js', import.meta.url), 'utf8'), /\$\{heldWordsOf\(budget\)\}/, 'the top-up text uses it');
});
