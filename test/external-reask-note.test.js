// Bug audit 2026-09-28 (external seats #5): re-asking an unheard external critic wrote the same
// prompt again, with no hint that the last reply was unreadable. Mock + external seats, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, ExternalPause } from '../src/chain.js';

test('an external critic\'s re-ask says the previous reply could not be read; the first ask does not', async () => {
  const cfg = { name: 'x', maxRounds: 1, signoff: 'unanimous', criteria: ['It exists.'],
    seats: { builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-bare-met', lab: 'a' }, { provider: 'external', model: 'subscription:x', lab: 'ext' }] } };
  const answers = {};
  const pauses = [];
  for (let i = 0; i < 3; i++) {
    setBudget(null);
    setCache({ get: l => answers[l] ? { text: answers[l], usage: { input: 0, output: 0 } } : null, warn: () => {} });
    try { await runChain({ request: 'Req.', config: cfg, draft: 'A draft.', log: () => {} }); break; }
    catch (e) { if (!(e instanceof ExternalPause)) throw e; pauses.push(e); answers[e.label] = 'not a verdict'; }
  }
  setCache(null);
  const first = pauses.find(p => p.label === 'panel-1-ext');
  const re1 = pauses.find(p => p.label === 'panel-1-ext-reask1');
  assert.ok(first && re1, pauses.map(p => p.label).join(', '));
  assert.doesNotMatch(first.user, /previous reply could not be read/);
  assert.match(re1.user, /# Your previous reply could not be read[\s\S]*panel-1-ext\.md/);
});
