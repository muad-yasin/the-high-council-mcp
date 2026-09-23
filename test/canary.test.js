// v7.x item 4: canary objections - a causal capitulation probe (relay/runs/
// 2026-09-14T14-56-18-834Z/deliverable.md item 4). Gated on config.canary.enabled +
// config.canary.sampleRate. Offline, mock seats, no network, no keys - mirrors
// test/tool-verification.test.js's style.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runChain } from '../src/chain.js';
import { metricsReport } from '../src/metrics.js';
import { injectCanary, shouldSampleCanary, pickCanaryTarget, buildCanaryPost } from '../src/canary.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockDebateConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));

// --- Unit tests of the injection/capitulation module itself -------------------------------------

test('shouldSampleCanary: false when config.canary is absent, regardless of rng', () => {
  assert.equal(shouldSampleCanary({}, () => 0), false);
  assert.equal(shouldSampleCanary(undefined, () => 0), false);
});

test('shouldSampleCanary: false when enabled but rng lands outside sampleRate; true when inside', () => {
  const config = { canary: { enabled: true, sampleRate: 0.1 } };
  assert.equal(shouldSampleCanary(config, () => 0.5), false);
  assert.equal(shouldSampleCanary(config, () => 0.05), true);
});

test('pickCanaryTarget: picks the first proposal not already withdrawn; null if none qualify', () => {
  const proposals = [{ id: 'A-1', withdrawn: true }, { id: 'A-2' }, { id: 'A-3' }];
  assert.equal(pickCanaryTarget(proposals).id, 'A-2');
  assert.equal(pickCanaryTarget([{ id: 'A-1', withdrawn: true }]), null);
  assert.equal(pickCanaryTarget([]), null);
});

test('injectCanary: a mock author that capitulates (amends) records canary: true, capitulated: true', async () => {
  const proposals = [{ id: 'A-1', lab: 'mock-a' }];
  const decide = async () => 'amend';
  const result = await injectCanary(proposals, decide);
  assert.equal(result.post.canary, true);
  assert.equal(result.post.on, 'A-1');
  assert.equal(result.post.stance, 'object');
  assert.equal(result.reply.canary, true);
  assert.equal(result.reply.action, 'amend');
  assert.equal(result.reply.capitulated, true);
  assert.equal(result.capitulated, true);
  // Never mutates the target proposal - the outcome is recorded, not applied.
  assert.equal(proposals[0].amended, undefined);
  assert.equal(proposals[0].withdrawn, undefined);
});

test('injectCanary: a mock author that holds (keeps) records canary: true, capitulated: false', async () => {
  const proposals = [{ id: 'A-1', lab: 'mock-a' }];
  const decide = async () => 'keep';
  const result = await injectCanary(proposals, decide);
  assert.equal(result.reply.canary, true);
  assert.equal(result.reply.action, 'keep');
  assert.equal(result.reply.capitulated, false);
  assert.equal(result.capitulated, false);
});

test('injectCanary: withdraw also counts as capitulation; a bad/throwing decide degrades to holds', async () => {
  const proposals = [{ id: 'A-1', lab: 'mock-a' }];
  assert.equal((await injectCanary(proposals, async () => 'withdraw')).capitulated, true);
  assert.equal((await injectCanary(proposals, async () => 'nonsense')).reply.action, 'keep');
  assert.equal((await injectCanary(proposals, async () => { throw new Error('boom'); })).reply.action, 'keep');
});

test('buildCanaryPost: fixed, evidence-free text - no quote, no tool reference, and no word that it is a probe', () => {
  const post = buildCanaryPost({ id: 'A-1' });
  assert.equal(post.canary, true);
  // Pre-release audit 2026-09-23 (ProposalsDebateDispute #1): this text used to SAY it was a
  // canary probe, so every author was told. What it is lives in data only (canary: true).
  assert.doesNotMatch(post.text, /canary|probe|inject|measur|capitulat/i);
  assert.doesNotMatch(post.text, /["“”]/, 'evidence-free: no quote');
  assert.doesNotMatch(post.text, /criterion|tool|because/i, 'evidence-free: no criterion, tool or reason');
});

// --- The metrics module's exclusion filter (the single most important assertion here) ----------

test('metricsReport objection-follow-through rate: canary post/reply pairs are excluded, both when the author holds and when it capitulates', () => {
  const runsDir = fakeRunsDir({
    'run-real-only': {
      proposals: [{ id: 'A-1' }],
      debate: {
        posts: [{ by: 'mock-b', on: 'A-1', stance: 'object' }],
        replies: [{ id: 'A-1', action: 'amend' }],
      },
    },
    'run-with-canary-holds': {
      proposals: [{ id: 'B-1' }],
      debate: {
        // No real objection at all - only the canary, which holds. If the filter were missing,
        // this canary object+keep pair would (wrongly) count B-1 as "objected but not followed
        // through", dragging the rate down for a proposal nobody real ever objected to.
        posts: [{ by: 'canary', on: 'B-1', stance: 'object', canary: true }],
        replies: [{ id: 'B-1', action: 'keep', canary: true, capitulated: false }],
      },
    },
    'run-with-canary-capitulates': {
      proposals: [{ id: 'C-1' }],
      debate: {
        // Only a canary, which capitulates. If the filter were missing, this would (wrongly)
        // inflate the real follow-through rate with a probe result, not a real objection.
        posts: [{ by: 'canary', on: 'C-1', stance: 'object', canary: true }],
        replies: [{ id: 'C-1', action: 'amend', canary: true, capitulated: true }],
      },
    },
  });

  const report = metricsReport(runsDir, { days: 36500 });
  // Only run-real-only's single real objected proposal (followed through) should be counted -
  // the two canary-only runs must contribute zero to both numerator and denominator.
  assert.equal(report.counts.objected, 1);
  assert.equal(report.counts.objectedFollowedThrough, 1);
  assert.equal(report.objectionFollowThroughRate, 1);
});

test('metricsReport: a real objection alongside a canary on the same proposal only counts the real one', () => {
  const runsDir = fakeRunsDir({
    'run-mixed': {
      proposals: [{ id: 'A-1' }],
      debate: {
        posts: [
          { by: 'mock-b', on: 'A-1', stance: 'object' },
          { by: 'canary', on: 'A-1', stance: 'object', canary: true },
        ],
        // The real reply holds; the canary reply (excluded) capitulates. If the canary reply
        // leaked in, this proposal would wrongly count as "followed through".
        replies: [
          { id: 'A-1', action: 'keep' },
          { id: 'A-1', action: 'amend', canary: true, capitulated: true },
        ],
      },
    },
  });
  const report = metricsReport(runsDir, { days: 36500 });
  assert.equal(report.counts.objected, 1);
  assert.equal(report.counts.objectedFollowedThrough, 0, 'the canary\'s amend must not count as the real objection\'s follow-through');
});

// --- Threaded through runChain's existing debate stage -------------------------------------------

test('canary enabled and sampled: a canary post/reply pair is appended to debate.posts/replies, ' +
  'each carrying canary: true, and never mutates the target proposal\'s amended/withdrawn flags', async () => {
  const config = {
    ...mockDebateConfig,
    canary: { enabled: true, sampleRate: 1, rng: () => 0, decide: async () => 'amend' },
  };
  const result = await runChain({ request: 'A request that will get a canary injected.', config, log: () => {} });

  const canaryPosts = result.debate.posts.filter(p => p.canary === true);
  const canaryReplies = result.debate.replies.filter(r => r.canary === true);
  assert.equal(canaryPosts.length, 1);
  assert.equal(canaryReplies.length, 1);
  assert.equal(canaryReplies[0].capitulated, true);
  assert.equal(result.canary.injected, true);
  assert.equal(result.canary.capitulated, true);

  // The canary reply itself never carries the fields a real amend applies to a proposal (`how`,
  // `acceptance_test`) - only `action`, `canary`, `capitulated`, so there is nothing in its shape
  // chain.js's real reply-application loop (which only reads `debate.replies`, never
  // `debate.posts`, and is not run again after this point) could even apply.
  assert.equal(canaryReplies[0].how, undefined);
  assert.equal(canaryReplies[0].acceptance_test, undefined);
  // Isolation itself (a capitulating canary decide never touches the proposals array) is proven
  // directly, without a real debate round's own amendments in the way, by the injectCanary unit
  // tests above.
});

test('canary enabled but not sampled this run (rng misses sampleRate): no canary field appears anywhere', async () => {
  const config = {
    ...mockDebateConfig,
    canary: { enabled: true, sampleRate: 0.1, rng: () => 0.99 },
  };
  const result = await runChain({ request: 'A request that will not get a canary this run.', config, log: () => {} });
  assert.equal(result.debate.posts.some(p => p.canary === true), false);
  assert.equal(result.debate.replies.some(r => r.canary === true), false);
  assert.deepEqual(result.canary, { injected: false });
});

test('flag absent: no canary logic runs at all, and result.canary key is entirely absent', async () => {
  const result = await runChain({ request: 'A plain request, no canary config.', config: mockDebateConfig, log: () => {} });
  assert.equal('canary' in result, false, 'canary must not appear on the result when config.canary is absent');
  assert.equal(result.debate.posts.some(p => p.canary === true), false);
  assert.equal(result.debate.replies.some(r => r.canary === true), false);
});

// --- Test helper: a throwaway runs/ directory of hand-built report.json fixtures ---------------

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

function fakeRunsDir(runs) {
  const dir = mkdtempSync(join(tmpdir(), 'thcmcp-canary-metrics-'));
  let i = 0;
  for (const [, report] of Object.entries(runs)) {
    // runIdToDate (src/spend.js) requires this exact ...T##-##-##-###Z suffix shape - a plain
    // ISO string with a distinguishing second/millisecond per run, so metricsReport picks all of
    // them up as "recent" and each gets its own directory.
    const ss = String(i % 60).padStart(2, '0');
    const runId = `2026-09-14T10-00-${ss}-00${i}Z`;
    i += 1;
    const runDir = join(dir, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report));
  }
  return dir;
}
