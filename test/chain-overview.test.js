// The README's chain overview is generated from the chain files (owner, 14 Nov 2026: "A table with Chain, layers, seats, title",
// one row per seat, the flagship at the bottom, the section between "What's new in 0.8.3" and Pricing, "Your first run" after
// Pricing). This file fails when the README's table differs from what scripts/chain-overview.mjs writes, when a seat of a chain
// is missing from it, when the flagship is not the last chain, or when the sections are out of that order. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateChainOverview, readmeWithOverview } from '../scripts/chain-overview.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const cells = row => row.split('|').slice(1, -1).map(c => c.trim());

test('the README chain overview equals what the script writes (edit the chains, run node scripts/chain-overview.mjs)', () => {
  assert.equal(readmeWithOverview(root), readme);
});

test('every shipped chain is in the overview with one row per proposer and judge seat, each with its title and model', () => {
  const rows = generateChainOverview(root).split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Chain'));
  const byChain = new Map(); let current = null;
  for (const r of rows) { const [c, layer, title, model] = cells(r); if (c) { current = c.replace(/`/g, ''); byChain.set(current, []); } byChain.get(current).push({ layer, title, model: model.replace(/`/g, '') }); }
  const shipped = readdirSync(join(root, 'chains')).filter(f => /^(plan-.*|local-ollama)\.json$/.test(f)).map(f => f.replace(/\.json$/, ''));
  assert.deepEqual([...byChain.keys()].sort(), shipped.sort(), 'the overview lists exactly the shipped chains');
  for (const [name, got] of byChain) {
    const seats = chain(name).seats;
    const want = [...(seats.proposers || []).map(s => ({ layer: 'Proposer', s })), ...(seats.critics || []).map(s => ({ layer: s.layer ? String(s.layer) : 'Judge', s }))];
    assert.equal(got.length, want.length, `${name}: one row per seat`);
    for (const { layer, s } of want) assert.ok(got.some(g => g.layer === layer && g.model === s.model && g.title === (s.persona || '–')), `${name}: ${layer} ${s.persona} ${s.model} has its row`);
  }
  const last = [...byChain.keys()].at(-1);
  assert.equal(chain(last).seat_personas?.form, 'voice', 'the flagship (the chain with voices) is the last chain of the table');
});

test('the sections: the chains after "What\'s new in 0.8.3", then Pricing, then "Your first run"; the contents list names the chains', () => {
  const at = h => readme.indexOf(`\n## ${h}`);
  const order = ["What's new in 0.8.3", 'The chains: who sits where', 'Pricing', 'Your first run'].map(at);
  assert.ok(order.every(i => i > 0), 'each section exists');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the sections are in this order');
  assert.match(readme.slice(readme.indexOf('## Contents')), /\[The chains\]\(#the-chains-who-sits-where\)/);
});
