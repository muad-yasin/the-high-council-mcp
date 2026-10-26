// BUG-D-005 / BUG-C-013 (Review/Bugs_0.8.3): the folded handoff's NOTE lines have their own stage file, `handoff-notes.md`, read back FIRST on a replay. When the `handoff` stage was judged STALE on a resume and run again, only
// `handoff.*` was set aside, so the old `handoff-notes.md` survived: its answers were applied to the new item list and re-recorded `cached: true` (the CLI never rewrites a cached stage), and every later sitting read them again.
// The fix: a stale `handoff` sets `handoff-notes` aside with it (chain.js invoke(), the stale branch), and the file is read back only when the handoff stage itself was replayed.
// Offline, $0, the real src/roles.js, a fake stage cache (the seam setCache gives; its invalidate() really removes the entry, as the CLI's moves the files).
//   HN-1 covers the LIVE re-run with the mock handoff seat. The mock's handoff reply carries no NOTE lines (providers.js has no mock handoff that writes them), so HN-1 proves the OLD answers are not applied, NOT that the
//        NEW reply's answers are; HN-2 proves that second half through an external seat, whose answer the test writes by hand.
//   HN-2 covers the EXTERNAL case across two sittings sharing one store: sitting 1 goes stale and pauses at the handoff, sitting 2 has the pasted answer, which is a cache hit for the handoff stage (cached: true) while no notes file exists.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { noteId } from '../src/review-notes.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const signoff = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const ITEM = 'Add a queue';
const ID = noteId('proposal', ITEM);
const hitOf = (text, extra = {}) => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, ...extra });

// One store shared by the sittings of a test: `store` holds the handoff and handoff-notes files (everything else is replayed from the default reply); `invalidated` lists the labels the run set aside.
function makeStore(initial) {
  const store = new Map(Object.entries(initial)); const invalidated = [];
  const cache = {
    invalidate(label) { invalidated.push(label); store.delete(label); },
    get(label) {
      if (store.has(label)) return store.get(label);
      if (label === 'handoff' || label === 'handoff-notes') return null;
      const text = label === 'panel-1-la' ? signoff({ proposals: [{ text: ITEM }] }) : label.startsWith('panel-') ? signoff() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
      return hitOf(text);
    },
  };
  return { store, invalidated, cache };
}

async function sitting(cache, { external = false } = {}) {
  setCache(cache);
  const builder = external ? { provider: 'external', model: 'claude-code-session', lab: 'writer' } : { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = {
    name: 'fixture-notes-stale', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, freedoms: { pass: true }, reviewNotes: { enabled: true, perKind: 3 }, handoff: true,
    seats: { builder, reviser: builder, handoff: builder, critics: [seat('la', 1), seat('lb', 2), seat('lc', 3)] },
  };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-notes-stale', log: () => {}, config });
  return { result, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-notes-stale', chain: 'fixture-notes-stale', task: 't.md', result, config }))) };
}

test('HN-1: a stale handoff that runs again live does not take the OLD handoff-notes answers; the old file is set aside with the old handoff, and no handoff-notes record is replayed as cached', async () => {
  // 'old' never equals the prompt hash of the handoff prompt this run builds, so cacheVerdict() says stale
  const { invalidated, cache } = makeStore({
    handoff: hitOf(`# Handoff\n\nBuild it.\n\nNOTE-TAKEN: ${ID}`, { promptHash: 'old' }),
    'handoff-notes': hitOf(`NOTE-TAKEN: ${ID}`, { provider: 'harness', model: 'none' }),
  });
  const { result, report } = await sitting(cache);
  assert.deepEqual(invalidated, ['handoff', 'handoff-notes'], 'the stale handoff and its derived notes file are both set aside');
  assert.ok(!result.stages.find(s => s.label === 'handoff').cached, 'the handoff really ran live');
  assert.equal(result.stages.filter(s => s.label === 'handoff-notes' && s.cached === true).length, 0, 'no handoff-notes record is replayed from the superseded file');
  assert.equal(report.review_notes.items.length, 1, 'the one item is recorded');
  assert.equal(report.review_notes.items[0].answer.status, 'unanswered', 'the old reply\'s TAKEN is not applied to the new reply (the mock handoff reply has no NOTE lines)');
});

test('HN-1b (the gate alone, a cache whose invalidate() leaves the notes file in place): a handoff that ran live ignores the notes file it can still read, and records nothing as cached', async () => {
  const { store, cache } = makeStore({
    handoff: hitOf(`# Handoff\n\nBuild it.\n\nNOTE-TAKEN: ${ID}`, { promptHash: 'old' }),
    'handoff-notes': hitOf(`NOTE-TAKEN: ${ID}`, { provider: 'harness', model: 'none' }),
  });
  const keep = cache.invalidate; cache.invalidate = label => { if (label !== 'handoff-notes') keep(label); };   // only the handoff moves; the notes file stays readable
  const { result, report } = await sitting(cache);
  assert.ok(store.has('handoff-notes'), 'the old file is still there to be read');
  assert.equal(result.stages.filter(s => s.label === 'handoff-notes').length, 0, 'the live reply had no NOTE lines, so there is no record, cached or fresh');
  assert.equal(report.review_notes.items[0].answer.status, 'unanswered');
});

test('HN-2 (external writer, two sittings): the stale handoff pauses and sets the old notes file aside; the pasted answer then supplies the answers, written fresh (cached: false) from the NEW reply', async () => {
  const { store, invalidated, cache } = makeStore({
    handoff: hitOf(`# Handoff\n\nBuild it.\n\nNOTE-TAKEN: ${ID}`, { promptHash: 'old' }),
    'handoff-notes': hitOf(`NOTE-TAKEN: ${ID}`, { provider: 'harness', model: 'none' }),
  });
  let pause = null;
  try { await sitting(cache, { external: true }); } catch (e) { pause = e; }
  assert.ok(pause, 'sitting 1 pauses at the external seat');
  assert.equal(pause.label, 'handoff');
  assert.deepEqual(invalidated, ['handoff', 'handoff-notes']);
  assert.ok(!store.has('handoff') && !store.has('handoff-notes'), 'neither old file is left to be read');
  // sitting 2: the operator pasted a NEW answer (no prompt hash: trusted as unverified, so the handoff stage is a cache hit while no notes file exists yet)
  store.set('handoff', hitOf(`# Handoff\n\nBuild it.\n\nNOTE-DECLINED: ${ID}: not needed`));
  const { result, report } = await sitting(cache, { external: true });
  const rec = result.stages.filter(s => s.label === 'handoff-notes');
  assert.equal(rec.length, 1, 'one handoff-notes record');
  assert.equal(rec[0].cached, false, 'written fresh, so the CLI writes the file this sitting (a cached record is never written)');
  assert.equal(rec[0].text, `NOTE-DECLINED: ${ID}: not needed`, 'the NEW reply\'s line, not the old TAKEN');
  const answer = report.review_notes.items[0].answer;
  assert.equal(answer.status, 'declined');
  assert.equal(answer.reason, 'not needed');
  assert.equal(answer.from, 'handoff');
});

test('HN-3 (no regression, the plain replay): a handoff replayed from the cache still reads handoff-notes first and records it cached: true', async () => {
  const { invalidated, cache } = makeStore({
    // no promptHash: unverified, trusted, replayed; its text had the NOTE lines stripped (a case-insensitive disk), the notes file keeps them
    handoff: hitOf('# Handoff\n\nBuild it.'),
    'handoff-notes': hitOf(`NOTE-DECLINED: ${ID}: kept from the first sitting`, { provider: 'harness', model: 'none' }),
  });
  const { result, report } = await sitting(cache);
  assert.deepEqual(invalidated, [], 'nothing is set aside');
  const rec = result.stages.filter(s => s.label === 'handoff-notes');
  assert.equal(rec.length, 1);
  assert.equal(rec[0].cached, true);
  assert.equal(report.review_notes.items[0].answer.status, 'declined');
  assert.equal(report.review_notes.items[0].answer.reason, 'kept from the first sitting');
});
