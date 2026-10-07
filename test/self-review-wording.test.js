// Roadmap item 28 (Astra's 0.8.2 review, F2; Muad's yes 7 Oct 2026 via C&C): true role wording. The plan's writer, seated on its own panel in a chain with "selfReview": "allowed", is
// told it wrote the draft; every other judge keeps the old opening byte for byte. The deep dive's findings are "not votes" (its lab may still judge on the panel). $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, criticPromptFor, isWriterSeat, resolveChainSeats, labOf } from '../src/chain.js';
import { renderDeepDiveBoard } from '../src/deep-dive.js';
import * as R from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
afterEach(() => setPromptSpy(null));
const SELF = 'You are a critic in a multi-model review chain.\nYou wrote the draft you are reviewing: this chain lets its writer judge too.';
const OLD = 'You are an independent critic in a multi-model review chain.\nYou did not write the draft you are reviewing.';

// Each critic's real system prompt, built by the one door every panel call site uses.
const writersOf = cfg => cfg.seats.critics.filter(c => criticPromptFor(c, false, undefined, cfg).startsWith(SELF)).map(labOf);

test('28a, the shipped chains: in plan-daily-7 and plan-highest-7 exactly one judge is told it wrote the draft, the writer\'s own seat; every other judge keeps the old opening', () => {
  for (const name of ['plan-daily-7', 'plan-highest-7']) {
    const cfg = resolveChainSeats(chain(name));
    assert.equal(cfg.selfReview, 'allowed', name);
    assert.deepEqual(writersOf(cfg), ['sonnet5-writer'], name);
    for (const c of cfg.seats.critics.filter(c => labOf(c) !== 'sonnet5-writer')) assert.ok(criticPromptFor(c, false, undefined, cfg).startsWith(OLD), `${name}: ${labOf(c)}`);
  }
});

test('28a, the merged-writer shape (the writer slots point at the criteria seat, builder lab = a critic lab): exactly that judge, and the same model under another lab is not mistaken for it', () => {
  const base = chain('plan-daily-7');
  const opus = base.seats.critics.find(c => labOf(c) === 'opus5.5-sub');
  const writer = { ...opus };
  const cfg = { ...base, seats: { ...base.seats, builder: writer, reviser: writer, skeleton: writer, handoff: writer, critics: base.seats.critics.filter(c => labOf(c) !== 'sonnet5-writer') } };
  assert.deepEqual(writersOf(cfg), ['opus5.5-sub']);
  // highest-7 also seats Opus 5.5 through OpenRouter: another execution of the same model, not the external session that writes.
  const hi = chain('plan-highest-7');
  assert.ok(hi.seats.critics.some(c => labOf(c) === 'opus5.5' && c.provider !== 'external'));
  assert.equal(writersOf({ ...hi, seats: { ...hi.seats, builder: writer, reviser: writer } }).includes('opus5.5'), false);
});

test('28a: without "selfReview": "allowed" nobody gets the self-review opening, even a seat that shares the writer\'s lab', () => {
  const cfg = chain('plan-daily-7');
  const { selfReview, ...without } = cfg;
  assert.equal(selfReview, 'allowed');
  assert.deepEqual(writersOf(without), []);
  assert.equal(isWriterSeat(cfg.seats.critics.find(c => labOf(c) === 'sonnet5-writer'), cfg.seats), true, 'the seat is still recognised; only the prompt waits for the switch');
});

test('28a: the self-review prompt differs from the old one in its opening only', () => {
  const plain = R.criticSystem(false, { fencedSource: true, criteriaKinds: true });
  const self = R.criticSystem(false, { fencedSource: true, criteriaKinds: true, selfReview: true });
  const oldOpening = plain.slice(0, plain.indexOf('harder to satisfy than the model that wrote it.') + 'harder to satisfy than the model that wrote it.'.length);
  const newOpening = self.slice(0, self.indexOf('as to every other critic.') + 'as to every other critic.'.length);
  assert.equal(self.slice(newOpening.length), plain.slice(oldOpening.length));
  assert.ok(self.startsWith(SELF));
  assert.equal(R.criticSystem(true), R.criticSystem(true, { selfReview: false }), 'no flag, no change');
});

test('28a door: a mock run with "selfReview": "allowed" sends the self-review opening to the writer\'s seat only', async () => {
  const base = chain('mock-unanimous');
  const writer = { provider: 'mock', model: 'mock-builder', lab: 'w' };
  const seen = [];
  setPromptSpy(p => seen.push(p));
  await runChain({ request: 'A mock task.', runId: 'r-28', log: () => {}, config: { ...base, selfReview: 'allowed', seats: { ...base.seats, builder: writer, reviser: writer, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'w' }, { provider: 'mock', model: 'mock-critic-b', lab: 'x' }] } } });
  const panel = seen.filter(p => /^panel-\d+-/.test(p.label));
  assert.ok(panel.some(p => p.label.startsWith('panel-1-w')) && panel.some(p => p.label.startsWith('panel-1-x')), panel.map(p => p.label).join(', '));
  for (const p of panel) assert.ok(p.system.startsWith(/^panel-\d+-w/.test(p.label) ? SELF : OLD), p.label);
});

test('28b-d: the deep dive is told its job is not a vote, the reviser that its findings are not votes, and the board says so and names a lab that also judges', () => {
  const sys = R.deepDiveSystem('sources');
  assert.ok(sys.includes('This job is not a vote on the plan. Your findings go to the plan\'s author'));
  assert.equal(/do not vote|does not vote/.test(sys), false);
  assert.equal(R.deepDiveVerdictLine({ job: 'sources', count: 3 }), 'Deep dive (sources): 3 finding(s). These findings are not votes.');
  const dd = { lab: 'ds', model: 'm', job: 'sources', calls: 1, planned_calls: 1, spent: 0, usd_cap: 1, findings: [] };
  assert.match(renderDeepDiveBoard(dd), /Its findings are not votes: each went to the reviser before the panel's first review\.\n/);
  assert.match(renderDeepDiveBoard(dd, { judges: ['ds', 'x'] }), /review\. The same lab also sits on the panel and votes there\.\n/);
  assert.equal(/does not vote/.test(renderDeepDiveBoard(dd, { judges: ['ds'] })), false);
});
