// G7 RULE 1c, the printed ways on (C&C thcmcp-a1's brief Review/Build_0.8.3/m8/cr-fixes/Brief_19_2026-10-25.md items 2a and 4; T's G5+6 report "Items to flag"; T's trace of item 4). No new words: each line printed here is
// an existing sentence, reused from its one copy.
//   2a: the session's frontier approval (MCP tree_decide, form frontier) refused a child a LIMIT did not admit with "is not admitted (...). This approval is a person's" and no way on; the frontier screen's own limit line
//       (src/tree-stop.js limitRaiseLine) is now appended, only where the screen prints it (a child refused BY a limit).
//   the decide-route throw (C&C, 26 Okt 2026): a throw from describeFrontier escaped MCP tree_decide's frontier form (the SDK answered with its bare error text); it is now the route's refusal, fail closed, nothing asked.
//       No input reaches it once item 3 is in, so the test uses the seam tree-approve.js already has for the same call (deps.describeFrontier).
//   4:  a PREVIEWED, unapproved frontier is listed by awaitingApprovalOf without asking describeFrontier. With its child chain file edited after the preview, `council tree approve` refuses it (exit 19) and status printed
//       approve as the only way on. Now status lists it only where describeFrontier takes it, prints the approve verb's own refusal words (src/tree-approve.js cannotExpandWords) and, for a chain, S13's way on (src/tree-resume.js chainWayOn).
// Real verbs on all-mock chains ($0). The previewed-unapproved state is written as `tree approve` writes it (src/tree-approve.js: frontier_previewed is appended after the person's yes and before the gate's use, which can fail).
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { awaitingApprovalOf } from '../src/tree-loop.js';
import { approveHandler } from '../src/tree-approve.js';
import { refusalWords } from '../src/tree-expansion.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { treeStatusPayload } from '../src/mcp/tree-status.js';
import { treeDecideResult } from '../src/mcp/tree-decide.js';
import { sessionFrontierAnswer, sessionFrontierQuote } from '../src/tree-approve-session.js';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { terminal } from './helpers/terminal.js';

// the sentences, whole (they exist today; the test pins that the one copy is printed where it was missing): the frontier screen's limit line (src/tree-stop.js), S13's way on (src/tree-resume.js), the approve verb's refusal (src/tree-approve.js)
// CHANGED ACCEPTED TEST (Fable FINAL H-07, 26 Okt 2026). OLD: `A limit can be raised only by you, after seeing this: council tree decide ${root} --max-runs|--max-depth|--max-children <n> (a raise never changes the root cap).`
const LIMIT_LINE = root => `A limit can be raised only by you, at the terminal: council tree decide ${root} --max-runs|--max-depth|--max-children <n> (a raise never changes the root cap).`;
const CHAIN_WAY_ON = root => `put the chain file back as the tree registered it, or end the tree with \`council tree decide ${root} --abandon\``;
const CANNOT_EXPAND = (pending, r) => `${pending.parent.node} cannot be expanded yet. ${refusalWords(r)}`;
const nextSteps = text => text.slice(text.indexOf('What you can do')).split('\n').slice(1).map(l => l.trim()).filter(Boolean);
const waitingOf = text => { const lines = text.split('\n'); const i = lines.indexOf('Waiting'); const rest = lines.slice(i + 1); const j = rest.findIndex(l => l !== '' && !l.startsWith(' ')); return rest.slice(0, j < 0 ? rest.length : j).map(l => l.trim()).filter(Boolean); };

test('2a: the session route\'s refusal of a child a limit did not admit names the frontier screen\'s limit line; the approval stays a person\'s', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 2, attemptsPerChild: 1 } });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.ok(d.view.children.some(c => !c.admitted && c.refusedLimit), `precondition: a child is refused by a limit: ${JSON.stringify(d.view.children.map(c => [c.node, c.admitted, c.refusedLimit]))}`);
  const res = JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, form: 'frontier', step: 'quote' } }).content[0].text);
  assert.equal(res.gate, undefined, `no gate is asked for: ${JSON.stringify(res)}`);
  assert.match(String(res.error), /is not admitted \(.*\)\. This approval is a person's: `council tree approve`/, 'the refusal as before');
  assert.ok(String(res.error).endsWith(`. ${LIMIT_LINE(ROOT_ID)}`), `the way on, in the screen's own words: ${res.error}`);       // red at 454b7384: the refusal ends at "`council tree approve`"
});

test('2a, the control: a child refused for budget (no limit) gets no limit line', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), cap: 10 });
  const res = JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, form: 'frontier', step: 'quote' } }).content[0].text);
  assert.match(String(res.error), /is not admitted/, JSON.stringify(res));
  assert.ok(!String(res.error).includes('A limit can be raised only by you'), res.error);
});

test('4: a previewed frontier whose child chain file changed is not listed for approval; status prints the approve verb\'s refusal and S13\'s way on, and the MCP view says the same', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, 'precondition: the frontier is described');
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...d.preview, boundSha256: d.boundSha256 });       // as tree-approve.js writes it after the yes, before the gate's use
  assert.deepEqual(awaitingApprovalOf(readTreeRecord(r.t.rootDir), stateOf(readTreeRecord(r.t.rootDir))), [pending.key], 'precondition: previewed and unapproved, so awaitingApprovalOf lists it');
  appendFileSync(join(r.t.work, 'chains', `${pricedChildren().childChain}.json`), '\n');       // the child chain file is no longer the one the tree registered
  const refused = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(refused.refusal?.check, 'chain', `precondition: describeFrontier refuses it for the chain: ${JSON.stringify(refused.refusal)}`);
  const io = terminal([pending.key.slice(0, 8), 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 19, 'the control: the verb refuses it (before and after)');
  assert.ok(io.errors().includes(CANNOT_EXPAND(findPendingFrontier({ rootDir: r.t.rootDir }), refused.refusal)), `the verb's words are the one copy: ${io.errors()}`);
  const facts = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(facts.awaitingApproval, [], 'not listed: the approve verb refuses it');       // red at 454b7384: [pending.key]
  const text = renderTreeStatus(facts);
  assert.ok(!nextSteps(text).some(l => l.includes('council tree approve')), `no approve line: ${nextSteps(text).join(' | ')}`);
  assert.ok(waitingOf(text).includes(CANNOT_EXPAND(pending, refused.refusal)), `the verb's refusal is printed: ${waitingOf(text).join(' | ')}`);
  assert.ok(nextSteps(text).includes(CHAIN_WAY_ON(ROOT_ID)), `S13's way on: ${nextSteps(text).join(' | ')}`);
  assert.equal(treeStatusPayload(facts).view, text, 'the MCP tree_status view is the same text');
});

test('the decide-route throw: a throw from describeFrontier is the session route\'s refusal in fixed words (quote and answer), and no gate is asked for', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const describe = () => { throw new Error('R@g1 cannot be expanded: a throw the route did not expect'); };
  const gates = () => (existsSync(join(r.t.rootDir, LEDGER_FILE)) ? readFileSync(join(r.t.rootDir, LEDGER_FILE), 'utf8') : '');       // the gate ledger: a gate asked for is a line in it
  const before = readTreeRecord(r.t.rootDir).events.length; const gatesBefore = gates();
  const a = { rootDir: r.t.rootDir, work: r.t.work };
  let q; assert.doesNotThrow(() => { q = sessionFrontierQuote(a, { describe }); }, 'the quote does not throw');       // red at 454b7384: it throws
  assert.equal(q.refusal, 'the frontier cannot be put to anyone yet: it could not be described this time. Nothing was asked and nothing was recorded.');
  assert.ok(!q.refusal.includes('a throw the route did not expect'), 'the error\'s own text does not leave on the MCP surface');
  assert.equal(q.gateId, undefined);
  let w; assert.doesNotThrow(() => { w = sessionFrontierAnswer({ ...a, gate: 'g', shown: 's', reason: 'yes from the user' }, { describe }); }, 'the answer does not throw');
  assert.equal(w.refusal, q.refusal);
  assert.equal(readTreeRecord(r.t.rootDir).events.length, before, 'nothing was recorded');
  assert.equal(gates(), gatesBefore, 'no gate was asked for');
});
