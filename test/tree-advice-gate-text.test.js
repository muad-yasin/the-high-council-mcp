// 0.8.3 ROADMAP 77, step 4 (person-facing money words, B-DRAFT): money a recommendation request holds is not "held for children". Rows: (T1) the cap-amendment gate names the request's hold apart and no longer counts it as "granted and not yet spent";
// with no request the text has no such line; (T2) the top-up gate's money sentence is built by heldWordsOf, which says "held for children X and for a recommendation request Y" only while a request holds money. All $0, the real handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideHandler, heldWordsOf } from '../src/tree-decide.js';
import { budgetOf } from '../src/tree-budget.js';
import { registerAdviceAdmitted } from '../src/tree-advice-record.js';
import { closedRootTree, ROOT_ID } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';

const SHA = 'a'.repeat(64);
const answer = { actor: 'person', via: 'terminal' };
const shownBy = async t => {
  const io = terminal([]); io.stdin.end();
  await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { 'amend-cap': '30' }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  return io.shown() + io.errors();
};

test('T1 the cap-amendment gate names a recommendation request\'s hold on its own line and leaves it out of "granted and not yet spent"; with no request there is no such line', async () => {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  const plain = await shownBy(t);
  assert.match(plain, /Where the money stands now/); assert.doesNotMatch(plain, /recommendation/i);
  registerAdviceAdmitted(t.rootDir, { adviceId: 'A1', grantUsd: 4, stopId: 'e9', gateId: 'g-grant', shownSha256: SHA, answer, ttlMs: 600_000 });
  const withHold = await shownBy(t);
  assert.match(withHold, /granted and not yet spent: \$0\.00/, withHold);
  assert.match(withHold, /held for a recommendation request: \$4\.00 \(request A1: set aside \$4\.00, spent \$0\.00\)/, withHold);
  assert.match(withHold, /committed in all: \$4\.00/, 'the hold still counts toward what is committed');
});

test('T2 heldWordsOf: "held for children X" alone while no request holds money, "... and for a recommendation request Y" while one does; the top-up gate text is built with it', () => {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  assert.match(heldWordsOf(budgetOf(t.rootDir)), /^held for children \$[\d.]+$/);
  registerAdviceAdmitted(t.rootDir, { adviceId: 'A1', grantUsd: 4, stopId: 'e9', gateId: 'g-grant', shownSha256: SHA, answer, ttlMs: 600_000 });
  assert.match(heldWordsOf(budgetOf(t.rootDir)), /^held for children \$0\.00 and for a recommendation request \$4\.00$/);
  assert.match(readFileSync(new URL('../src/tree-decide.js', import.meta.url), 'utf8'), /\$\{heldWordsOf\(budget\)\}/, 'the top-up text uses it');
});
