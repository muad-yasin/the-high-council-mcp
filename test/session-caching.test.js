// 0.8.4 cache part (b)2, the merged-tree rows of the session switch x caching (C&C, 10 Nov 2026 18:46 and 18:53, filed in the (b)2 GO: owned by the second of the session switch and (b)2 to merge). Offline, $0: resolveRun and the cache fingerprint are pure.
// WHY THEY EXIST: the session switch (src/claude-route.js applySessionRoute, src/cli.js the cache fingerprint) was written while no shipped chain carried `prompt_cache`; (b)2 turns the switch on in plan-claude-council (1 hour), so what a converted chain does with it is now live.
//   SC-1 a chain the session route converts has NO `prompt_cache` left when no judge seat that can use it remains (plan-claude-council: every judge is a Claude seat, so all become sessions), and the converted chain passes the lint; the OpenRouter route keeps the switch as written.
//        The check is shown able to fail: the same converted chain with the switch put back is refused by the lint.
//   SC-2 finished stages keep their replies after a mode change: the stage cache fingerprint of the chain as the CLI builds it for the session route and for the OpenRouter route equals the fingerprint of the chain run directly, with the switch on in the file.
//        The check is shown able to fail: the fingerprint of the converted chain as it is (without the switch) is NOT the direct chain's, so the CLI's choice to read the chain as written is what keeps the replies.
// LIMIT (stated): SC-2 replicates the expression of src/cli.js (`cacheFingerprint`, from resolveRun's `unrouted`), it does not call it; a change of that line is not caught here, only a change of what resolveRun hands it.
// NO RED JOB for these rows, said up front: the behaviour is the session switch's and is already on the merged tree. On the tree before the merge (5f31224b) resolveRun refuses the session route as reserved, so SC-1 would fail at `route === 'session'` and SC-2 would throw on `r.unrouted`: neither says anything about caching, so no such run is evidence. The can-fail evidence is INSIDE each test, in the same pass: SC-1 the lint refuses the switch put back on the converted chain; SC-2 the converted chain read as it is does not match the direct fingerprint, and the scan of src/cli.js fails on the same text with its prompt_cache clause removed in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChainSeats } from '../src/chain.js';
import { fingerprintInputs } from '../src/cache-integrity.js';
import * as PromptCache from '../src/prompt-cache.js';

const RR = await import('../src/resolve-run.js').catch(() => ({}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shipped = () => JSON.parse(readFileSync(join(root, 'chains', 'plan-claude-council.json'), 'utf8'));
const OPENROUTER_ONLY = { OPENROUTER_API_KEY: 'sk-test-dummy-key' };
const TASK = 'a task text for the fingerprint';
// the expression of src/cli.js (cacheFingerprint): the chain as written, from resolveRun's `unrouted`
const asTheCliFingerprints = r => fingerprintInputs(TASK, { ...r.unrouted, ...r.config, seats: r.unrouted.seats, ...(r.unrouted.preflight !== undefined ? { preflight: r.unrouted.preflight } : {}), ...(r.unrouted.prompt_cache !== undefined ? { prompt_cache: r.unrouted.prompt_cache } : {}) });

test('SC-1 a chain the session route converts keeps no prompt_cache (no judge seat is left that can use it) and passes the lint; the OpenRouter route keeps the switch; the lint refuses the switch put back on the converted chain', () => {
  assert.equal(typeof RR.resolveRun, 'function');
  const file = shipped();
  assert.deepEqual(file.prompt_cache, { enabled: true, ttl: '1h' }, 'premise: the shipped chain carries the switch (cache part (b)2 step (a))');
  const session = RR.resolveRun(structuredClone(file), { flag: 'session' });
  assert.equal(session.route, 'session');
  assert.equal('prompt_cache' in session.config, false, 'the converted chain has no prompt_cache');
  assert.deepEqual(PromptCache.lintPromptCache(session.config, 'the converted plan-claude-council'), [], 'and the lint finds nothing');
  assert.ok(session.config.seats.critics.every(s => s.provider === 'external'), 'every judge is a session seat');
  const withSwitchBack = { ...session.config, prompt_cache: { enabled: true, ttl: '1h' } };
  assert.ok(PromptCache.lintPromptCache(withSwitchBack, 'the converted chain with the switch put back').length > 0, 'known-bad input: the lint refuses the switch on a chain with no seat that can use it');
  const routed = RR.resolveRun(structuredClone(file), { flag: 'openrouter', env: OPENROUTER_ONLY });
  assert.deepEqual(routed.config.prompt_cache, { enabled: true, ttl: '1h' }, 'the OpenRouter route keeps the switch as written');
});

test('SC-2 finished stages keep their replies after a mode change: the session route, the OpenRouter route and the direct route fingerprint alike, with the switch present in the file and with it absent; the direct route\'s expression is untouched', () => {
  const asWritten = shipped();
  const without = structuredClone(asWritten); delete without.prompt_cache;
  const ANTHROPIC_ONLY = { ANTHROPIC_API_KEY: 'sk-test-dummy-key' };
  for (const [state, file] of [['with the switch', asWritten], ['without the switch', without]]) {
    const direct = fingerprintInputs(TASK, resolveChainSeats(structuredClone(file)));
    const viaDirect = RR.resolveRun(structuredClone(file), { flag: 'anthropic', env: ANTHROPIC_ONLY });
    const session = RR.resolveRun(structuredClone(file), { flag: 'session' });
    const routed = RR.resolveRun(structuredClone(file), { flag: 'openrouter', env: OPENROUTER_ONLY });
    assert.equal(viaDirect.route, 'anthropic');
    assert.equal(fingerprintInputs(TASK, viaDirect.config), direct, `${state}: the direct route hashes the chain it runs, as the CLI does (its expression is the config itself)`);
    assert.equal(asTheCliFingerprints(session), direct, `${state}: a stage written on the direct route is replayed on the session route`);
    assert.equal(asTheCliFingerprints(routed), direct, `${state}: and on the OpenRouter route`);
    assert.notEqual(fingerprintInputs(TASK, session.config), direct, `${state}: known-bad input: the converted chain read as it is (session seats) would not match, so reading the chain as written is what keeps the replies`);
    if (file.prompt_cache !== undefined) {
      // known-bad input, the expression as it was before FIX 4 (found by this test on the merged tree): without the unrouted chain spread first, the dropped prompt_cache is put back at the END of the object and JSON.stringify hashes the key order, so the session route's fingerprint differed from the direct chain's and every finished stage read as stale
      const asBefore = r => fingerprintInputs(TASK, { ...r.config, seats: r.unrouted.seats, ...(r.unrouted.preflight !== undefined ? { preflight: r.unrouted.preflight } : {}), ...(r.unrouted.prompt_cache !== undefined ? { prompt_cache: r.unrouted.prompt_cache } : {}) });
      assert.notEqual(asBefore(session), direct, `${state}: known-bad input: the earlier expression does not match on the session route`);
    }
  }
  // the CLI's own line: the expression is replicated above, so the line itself is scanned (the replication cannot notice a change of src/cli.js)
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const CLAUSE = /const cacheFingerprint = fingerprintInputs\([^\n]*\{ \.\.\.claudeRouting\.unrouted, \.\.\.config, seats:[^\n]*claudeRouting\.unrouted\.prompt_cache/;
  const DIRECT = /const cacheFingerprint = fingerprintInputs\(rawTaskTextForCacheFingerprint, claudeRoute !== 'anthropic' \? \{[^\n]*\} : config\);/;
  assert.match(cli, CLAUSE, 'src/cli.js builds the cache fingerprint from the chain as written, in its own key order, prompt_cache included');
  assert.match(cli, DIRECT, 'and the direct route\'s expression is the config itself, as before');
  assert.doesNotMatch(cli.replace(/\{ \.\.\.claudeRouting\.unrouted, \.\.\.config,/g, '{ ...config,'), CLAUSE, 'known-bad input: the same scan fails on the line without the unrouted spread');
  assert.doesNotMatch(cli.replace(/claudeRouting\.unrouted\.prompt_cache/g, 'gone'), CLAUSE, 'and without the prompt_cache clause');
  assert.doesNotMatch(cli.replace(/ : config\);/, ' : configX);'), DIRECT, 'known-bad input: the direct-route scan fails if the direct expression changes');
});
