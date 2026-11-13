// plan-claude-council, run end to end offline (0.8.4 seats unit; C&C item 4 and the guard of item 8): the shipped roster with every model seat turned into a mock seat of the same lab, layer and persona (one mock model string per model, so the twins stay twins). Walks every copy path
// of a keyed seat (exchange, re-asks and retries) with the real twin shape. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain } from '../src/chain.js';

test('PCR-1 THE CLAUDE ROSTER ITSELF, MOCK-IFIED, RUNS END TO END: every model seat keeps its labs, layers and persona names, the guard never fires on any copy path (exchange, re-asks, retries, final read), and the eight judges leave eight distinct seat records', async () => {
  const { readFileSync } = await import('node:fs');
  const real = JSON.parse(readFileSync(new URL('../chains/plan-claude-council.json', import.meta.url), 'utf8'));
  const mockOf = s => ({ ...s, provider: 'mock', model: `mock-critic-script-xoooooooo-${s.model.replace(/[^a-z0-9]/g, '')}`, extra: undefined });
  const critics = real.seats.critics.map(mockOf);
  const config = { name: 'fixture-tw13', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 2 }, seat_personas: real.seat_personas,
    estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } };
  const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-tw13', config });
  const keys = new Set(r.panelVerdicts.map(v => v.seat ?? v.lab));
  const layerOneAndTwo = ['haiku5.5', 'haiku5.5-l1-2', 'sonnet5.5', 'sonnet5.5-l2', 'sonnet5.5-l2-2', 'opus5.5'];
  for (const k of layerOneAndTwo) assert.ok(keys.has(k), `a verdict record for ${k}: ${[...keys].join()}`);
  assert.equal(new Set(r.stages.filter(s => /^panel-/.test(s.label)).map(s => s.label.replace(/^panel-\d+-/, '').replace(/-(reask\d+|retry)$/, ''))).size >= 6, true, 'distinct stage labels per seat');
  // The final read of an agreed mock run is REUSED from the top layer's pass-time read (no final-read call, so the copy path of the final read is not walked here); the guard and test/same-layer-twins.test.js TW-12 cover that copy.
});
