// 0.8.3 estimator unit (C&C thcmcp-6d, 19 Okt 2026; money path): the upper-estimate rows count the SYSTEM text a call will really send.
// Why: invoke() projects (system + user characters / 4) input plus the seat's whole maxTokens; the rows used to price only declared sizes, so a grant sized from the figure ("this call can finish") was smaller than the
// projection of the real call and the call stopped at its cap (tree-whole-mock legs 9, 9b, 10 at 0c57c97f; Review/Build_0.8.3/regress-grant-vs-projection.txt).
// EST-1 is GROUND TRUTH, not the estimator's own mapping: a mock chain is run for real with setPromptSpy armed, each call's real system length is recorded, and the row with the same label (declared sizes zeroed, so
// only the system text and the fixed constants remain) must carry at least that many tokens. A row priced with the wrong text (a panel row with the builder's) is red here.
// EST-2: every row of every chain file has a rule (an unknown label THROWS). EST-3: the throw can fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, resolveChainSeats } from '../src/chain.js';
import { estimateChainRows } from '../src/cost.js';
import { systemTextsFor } from '../src/stage-system.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chainFile = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const MOCKS = readdirSync(join(root, 'chains')).filter(f => /^mock.*\.json$/.test(f)).map(f => f.replace(/\.json$/, '')).filter(n => !n.startsWith('mock-advise'));
// the two chains that PAUSE at an external seat: their spy calls up to the pause are still ground truth
const PAUSES = new Set(['mock-external', 'mock-questions-wait']);

// The layered paid chains (maxOverseerRounds + layerRevisions) plan their panel as `panel-L<layer>-<lab>` rows and their revisions as ONE `revise-all` row, while the run labels its calls `panel-<round>-<lab>` and `revise-<round>`:
// the label map below joins them (a mock chain with overseer rounds is run, so the default and worst-case shapes are guarded, not only the plain one).
const rowFor = (label, rows, config) => {
  if (rows.has(label)) return rows.get(label);
  const panel = /^panel-\d+-(.+)$/.exec(label);
  if (panel) { const seat = (config.seats.critics || []).find(c => (c.lab || c.provider) === panel[1]); return seat?.layer !== undefined ? rows.get(`panel-L${seat.layer}-${panel[1]}`) : undefined; }
  if (/^revise-\d+$/.test(label)) return rows.get('revise-all');
  return undefined;
};
// calls a run makes that have NO planned row (named, not silently skipped): a retry of a cut-off reply, the second attempt of a patch revise, a canary probe reply
const UNPLANNED = /(-retry|-full|-question)$|^canary-reply-/;
const overseerMock = () => { const base = chainFile('mock-layered'); const c = { ...base, maxOverseerRounds: 2, layerRevisions: { 1: 1, 2: 1 } }; delete c.maxRounds; return c; };

test('EST-1: for every mock chain (and a mock chain with overseer rounds), each call the run really made has a row that carries at least its real system text (ground truth by setPromptSpy)', async () => {
  let matched = 0; const perChain = {};
  const cases = [...MOCKS.map(name => [name, chainFile(name)]), ['mock-layered+overseer', overseerMock()]];
  for (const [name, config] of cases) {
    const seen = [];
    setPromptSpy(p => seen.push({ label: p.label, chars: p.system.length }));
    try { await runChain({ request: 'Write a short fixture deliverable.', config, runId: 'r-est1', log: () => {} }); }
    catch (e) { assert.ok(PAUSES.has(name) && /waiting for external stage/.test(e.message), `${name} ran to its end (or paused at its named external seat): ${e.message}`); }
    finally { setPromptSpy(null); }
    const zeroed = resolveChainSeats({ ...config, estimate: { promptTokens: 0, draftTokens: 0, critiqueTokens: 0 } });
    const rows = new Map(estimateChainRows(zeroed, { maximum: true }).map(r => [r.label, r]));
    for (const s of seen) {
      const row = rowFor(s.label, rows, config);
      if (!row) { assert.match(s.label, UNPLANNED, `${name}: the call "${s.label}" has no planned row and is not a named unplanned call`); continue; }
      matched += 1; perChain[name] = (perChain[name] || 0) + 1;
      const perCall = row.input / (row.times || 1);
      assert.ok(perCall >= Math.ceil(s.chars / 4), `${name}: row "${row.label}" carries ${perCall} input tokens per call but the call "${s.label}" really sent ${Math.ceil(s.chars / 4)} tokens of system text alone`);
    }
  }
  assert.ok(matched >= 100, `the check compared ${matched} (call, row) pairs: not vacuous`);
  assert.ok((perChain['mock-layered+overseer'] || 0) >= 6, 'the overseer-shape chain was compared row by row (panel-L rows and revise-all)');
  for (const name of MOCKS.filter(n => !PAUSES.has(n))) assert.ok((perChain[name] || 0) >= 3, `${name} matched ${perChain[name] || 0} rows`);
});

test('EST-2: every row label of every chain file has a system-text rule: expected, maximum and fromRun all price without throwing and every row has a finite input and price', () => {
  const names = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'));
  assert.ok(names.length > 40, 'the chains folder was read');
  for (const f of names) {
    const config = resolveChainSeats(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')));
    for (const opts of [{}, { maximum: true }, { fromRun: true }]) {
      const rows = estimateChainRows(config, opts);
      for (const r of rows) assert.ok(Number.isFinite(r.input) && Number.isFinite(r.usd), `${f} ${JSON.stringify(opts)} row ${r.label}: a finite price`);
    }
  }
});

test('EST-3: a row label with no rule THROWS (a row nobody mapped is a bug, not a silent zero)', () => {
  assert.throws(() => systemTextsFor('brand-new-stage-x', chainFile('mock-debate'), null), /has no system-text rule/);
  assert.deepEqual(systemTextsFor('advise-a', chainFile('mock-debate'), null), [], 'the advise rows add their own text and are the one named exception');
});
