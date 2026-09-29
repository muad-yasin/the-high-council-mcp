// Bug audit 2026-09-28, external seats #3: the `answers` pause was replayed straight from disk,
// never through the staleness check every other external stage gets, so after a task amendment the
// old answers were applied (by position) to the new questions. Now a hit that answered a different
// prompt is set aside and the operator is asked again; a matching one is used. Mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, ExternalPause } from '../src/chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(here, '../chains/mock-questions-wait.json'), 'utf8'));
const run = request => runChain({ request, config, log: () => {} });

test('answers written for a different prompt are set aside and asked again; matching ones are used', async () => {
  setBudget(null);
  setCache(null);
  let pause;
  await assert.rejects(run('Plan a tea shop.'), e => { pause = e; return e instanceof ExternalPause && e.label === 'answers'; });

  const invalidated = [];
  setCache({ get: l => l === 'answers' ? { text: '1. Old answer for the tea shop.', promptHash: 'not-this-prompt', fromDisk: true } : null, invalidate: (l, why) => invalidated.push([l, why]), warn: () => {} });
  await assert.rejects(run('Plan a tea shop.'), e => e instanceof ExternalPause && e.label === 'answers');
  assert.deepEqual(invalidated.map(x => x[0]), ['answers'], 'the stale answers were set aside');

  let asked = 0;
  setCache({ get: l => { if (l !== 'answers') return null; asked++; return { text: '1. default', promptHash: pause.promptHash, fromDisk: true }; }, invalidate: () => assert.fail('fresh answers must not be set aside'), warn: () => {} });
  const r = await run('Plan a tea shop.');
  assert.equal(asked, 1);
  assert.ok(r.deliverable, 'the run went on with the matching answers');
  setCache(null);
});
