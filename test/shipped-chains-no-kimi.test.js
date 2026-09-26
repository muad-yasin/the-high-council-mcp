// Muad, 2026-09-26: "Kimi K3 is not excluded completely from being used, it was just removed from
// our own chain configs." A user may seat Kimi/Moonshot in a chain of their own (src/denied-models.js
// no longer refuses it), but no chain this package ships may name one, in any seat or extra field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deniedReasonsOf } from '../src/denied-models.js';

const chainsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'chains');

test('no shipped chain seats a Kimi/Moonshot model', () => {
  const hits = [];
  for (const f of readdirSync(chainsDir).filter(f => f.endsWith('.json'))) {
    const cfg = JSON.parse(readFileSync(join(chainsDir, f), 'utf8'));
    const seats = JSON.stringify(cfg.seats || {});
    if (/kimi|moonshot/i.test(seats)) hits.push(f);
  }
  assert.deepEqual(hits, []);
});

test('a user chain may seat Kimi; xAI/Grok stays denied', () => {
  assert.deepEqual(deniedReasonsOf({ provider: 'openrouter', model: 'moonshotai/kimi-k3' }), []);
  assert.ok(deniedReasonsOf({ provider: 'openrouter', model: 'x-ai/grok-4' }).length > 0);
});
