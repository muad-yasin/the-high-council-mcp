// 0.8.3 ROADMAP 77, step 4b: the terminal route (src/tree-advice-route.js). All $0: the REAL cli.js is spawned for the advice run (a priced mock advice chain from a directory outside the working folder); the person is a scripted terminal.
// Rows: (R1) the whole route: the offer, the typed grant, the brief approval, the run, the pick -> the text of the chosen recommendation, the request ended settled BEFORE it returns, held 0, the run's spend counted and mirrored;
// (R2) a declined grant holds nothing; (R3) a quote that changes between the offer and the answer holds nothing; (R4) without a brief builder (the production default) the route offers nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { budgetOf, gateTree } from '../src/tree-budget.js';
import { askForRecommendation, grantGateText, GRANT_WORD } from '../src/tree-advice-route.js';
import { adviceOfferLines } from '../src/tree-advice.js';
import { closedRootTree, GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAIN = 'mock-advise-priced';
const BRIEF = () => ({
  schema_version: 'advice-brief/1', moment: 'stuck', question: 'The plan ended in a stop. What one instruction should the person give the next planner to repair it?',
  decision_at_stake: 'What the person tells the next planner decides how the new main plan is made.',
  options_considered: [{ name: 'Regenerate', summary: 'Give the next planner one instruction.' }, { name: 'Keep', summary: 'Keep the plan as it is.' }],
  first_look: true, sensitivity: 'internal', not_included: ['the earlier plan'],
});
function setup() {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'The plan leaves the billing out.', ...GATE_FIELDS });
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-advise-single.json'), 'utf8'));
  config.name = CHAIN; config.seats.critics[0].model = 'mock-priced'; config.seats.critics[0].maxTokens = 200;
  const advDir = mkdtempSync(join(tmpdir(), 'tree-route-chains-')); writeFileSync(join(advDir, `${CHAIN}.json`), JSON.stringify(config));
  const env = { PATH: process.env.PATH, HOME: t.work, COUNCIL_ADVISE_CHAIN_SINGLE: CHAIN, COUNCIL_ADVICE_CHAINS_DIR: advDir, COUNCIL_ADVISE_COOLDOWN_MS: '0' };
  return { t, env };
}
const run = (s, io, deps = {}, over = {}) => askForRecommendation({ rootDir: s.t.rootDir, rootId: ROOT_ID, work: s.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, env: s.env, deps: { buildBrief: BRIEF, pollMs: 50, ...deps }, ...over });
const adviceRows = t => stateOf(readTreeRecord(t.rootDir)).advice;

test('R4 without a brief builder (the production default) the route offers nothing and holds nothing', { timeout: 60_000 }, async () => {
  const s = setup(); const io = terminal([]); io.stdin.end();
  const r = await run(s, io, { buildBrief: undefined });
  assert.deepEqual([r.kind, r.why], ['none', 'held']);
  assert.equal(adviceRows(s.t).size, 0); assert.equal(io.shown(), '');
});

test('R2 the grant gate is one instruction (type the word), and declining holds nothing', { timeout: 60_000 }, async () => {
  const s = setup(); const io = terminal(['no']);
  const r = await run(s, io);
  assert.equal(r.kind, 'none', io.shown() + io.errors());
  assert.match(io.shown(), new RegExp(`To ask for it, type: ${GRANT_WORD}\\n`)); assert.doesNotMatch(io.shown(), /\[y\/N\] *\n.*type: ask/);
  assert.equal(adviceRows(s.t).size, 0);
});

test('R1 the whole route with the real cli.js: typed grant, brief approved at the terminal, the run, the pick -> the chosen text; the request ended settled, nothing held, the spend counted and mirrored', { timeout: 120_000 }, async () => {
  const s = setup(); const io = terminal([GRANT_WORD, 'y', 'y', '1']);
  const r = await run(s, io);
  assert.equal(r.kind, 'recommended', io.shown() + io.errors());
  assert.ok(r.text.length > 0);
  const a = [...adviceRows(s.t).values()];
  assert.equal(a.length, 1);
  assert.equal(a[0].ended?.reason, 'settled', `${io.shown()}\n${io.errors()}`);
  assert.equal(a[0].runs.length, 1);
  const b = budgetOf(s.t.rootDir).advice[0];
  assert.equal(b.heldUsd, 0, 'ended: nothing held'); assert.ok(b.spentUsd > 0, 'the run\'s spend is counted');
  assert.equal(gateTree(s.t.rootDir).ok, true);
  assert.ok(readTreeRecord(s.t.rootDir).events.some(e => e.event === 'advice_reservation_mirrored'), 'mirrored by the run\'s own process');
  if (r.kind === 'recommended') assert.deepEqual(r.fromRecommendation, { n: 1, adviceId: a[0].adviceId });
});

test('R3 a price that changes between the offer and the answer: the compare fails, the approval is NOT used and nothing is held', { timeout: 60_000 }, async () => {
  const s = setup(); const io = terminal([GRANT_WORD, 'y']);
  const loadChain = name => {
    const config = JSON.parse(readFileSync(join(s.env.COUNCIL_ADVICE_CHAINS_DIR, `${name}.json`), 'utf8'));
    if (io.typed() >= 2) config.advise.usd = 0.9;         // the ceiling the person was shown (the first quote) is not the ceiling now
    return config;
  };
  const r = await run(s, io, { loadChain });
  assert.deepEqual([r.kind, r.why], ['none', 'changed'], io.shown() + io.errors());
  assert.match(io.errors(), /what you were shown has changed/);
  assert.equal(adviceRows(s.t).size, 0, 'nothing is held');
});

test('R5 a brief that is not approved at the terminal: the request ends declined, nothing is sent or spent, the person types their own decision', { timeout: 60_000 }, async () => {
  const s = setup(); const io = terminal([GRANT_WORD, 'y', 'n']);
  const r = await run(s, io);
  assert.equal(r.kind, 'own', io.shown() + io.errors());
  const a = [...adviceRows(s.t).values()][0];
  assert.equal(a.ended?.reason, 'declined'); assert.equal(budgetOf(s.t.rootDir).advice[0].spentUsd, 0); assert.equal(budgetOf(s.t.rootDir).advice[0].heldUsd, 0);
});
