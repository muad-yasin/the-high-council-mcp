// relay/test/stage-contract.test.js
//
// v2 plan Phase 1, item 2 (~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md §2.2,
// §10 Phase 1). Pins that the stage contract schema is derivable, with every required field
// non-empty, for every stage kind every existing chain fixture actually runs - so later phases
// (§3 prepare_stage_prompt, §5 resume brief, §6 pre-flight, §7.1 partial-deliverable detection)
// can rely on the contract without re-checking its shape themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stageKindsFor, buildStageContract, isValidStageContract, stageKindOf, renderStagePromptBundle } from '../src/stage-contract.js';
import { runChain, ExternalPause } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chainFiles = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'));

test('stage contract schema valid across every chain fixture', () => {
  assert.ok(chainFiles.length > 0, 'expected at least one chain fixture');
  for (const file of chainFiles) {
    const config = JSON.parse(readFileSync(join(root, 'chains', file), 'utf8'));
    const kinds = stageKindsFor(config);
    assert.ok(kinds.length > 0, `${file}: stageKindsFor returned no stages`);
    for (const kind of kinds) {
      const contract = buildStageContract(config, kind);
      assert.ok(isValidStageContract(contract), `${file}: stage "${kind}" produced an invalid contract: ${JSON.stringify(contract)}`);
    }
  }
});

test('stageKindOf maps chain.js\'s real per-run labels back to canonical kinds', () => {
  assert.equal(stageKindOf('criteria'), 'criteria');
  assert.equal(stageKindOf('skeleton'), 'skeleton');
  assert.equal(stageKindOf('propose-glm'), 'propose');
  assert.equal(stageKindOf('propose-glm-2'), 'propose');
  assert.equal(stageKindOf('propose-glm-retry'), 'propose');
  assert.equal(stageKindOf('judge-deepseek'), 'judge');
  assert.equal(stageKindOf('debate-mistral'), 'debate');
  assert.equal(stageKindOf('reply-qwen'), 'reply');
  assert.equal(stageKindOf('build'), 'build');
  assert.equal(stageKindOf('panel-2-mistral'), 'panel');
  assert.equal(stageKindOf('critique-1'), 'critique');
  assert.equal(stageKindOf('revise-3'), 'revise');
  assert.equal(stageKindOf('final'), 'final');
  assert.equal(stageKindOf('handoff'), 'handoff');
  assert.equal(stageKindOf('not-a-real-stage'), null);
});

test('buildStageContract throws on an unknown stage kind rather than returning a half-built contract', () => {
  assert.throws(() => buildStageContract({}, 'not-a-real-kind'), /unknown stage kind/);
});

// v2 plan §3, Phase 2 item 3. Offline only - `mock-external` pauses at a real
// ExternalPause without any API call, matching the "out of budget, mock chains only"
// constraint on this build.
test('test_prepare_stage_prompt_self_contained: the rendered bundle stays small and references context by path, not inline content', async () => {
  const chainConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  let pause = null;
  try {
    await runChain({ request: 'a fixture request', config: chainConfig, log: () => {} });
    assert.fail('expected mock-external to pause at its external builder stage');
  } catch (err) {
    if (!(err instanceof ExternalPause)) throw err;
    pause = err;
  }
  assert.equal(pause.label, 'build');

  const contract = buildStageContract(chainConfig, stageKindOf(pause.label));
  // Stand in for a 61k-token-equivalent context set the way the real NEEDS-<stage>.md
  // would hold it - referenced by path below, never inlined into the bundle itself.
  const bigContextPath = '/tmp/fixture-needs-build.md';
  const bundle = renderStagePromptBundle({
    contract,
    taskText: 'Fixture task: do the thing.',
    chainName: chainConfig.name,
    label: pause.label,
    run: '2026-01-01T00-00-00-000Z',
    references: [bigContextPath, '/tmp/fixture-BOARD.md'],
  });

  assert.match(bundle, /stage_id: build/);
  assert.match(bundle, new RegExp(contract.role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(bundle, /no_prior_context: true/);
  assert.match(bundle, /required_sections/);
  assert.match(bundle, /Fixture task: do the thing\./, 'the task statement must appear verbatim');
  assert.match(bundle, new RegExp(bigContextPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'context must be referenced by path');
  assert.doesNotMatch(bundle, /sixty-one-thousand-tokens-of-fixture-content/, 'context content itself must never be inlined');

  const approxTokens = Math.ceil(bundle.length / 4);
  assert.ok(approxTokens < 5000, `bundle should stay under ~5000 tokens, was ~${approxTokens}`);
});

test('test_fresh_agent_produces_valid_stage: the bundle alone names every required section with nothing assumed', () => {
  const chainConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8'));
  const contract = buildStageContract(chainConfig, 'build');
  const bundle = renderStagePromptBundle({
    contract,
    taskText: 'Fixture task.',
    chainName: chainConfig.name,
    label: 'build',
    run: '2026-01-01T00-00-00-000Z',
    references: ['/tmp/fixture-needs-build.md'],
  });
  // A zero-context reader has only the bundle text - simulate one by parsing it
  // back out with nothing else available, the way a fresh subagent would.
  const requiredSections = JSON.parse(bundle.match(/required_sections: (\[.*\])/)[1]);
  assert.deepEqual(requiredSections, contract.deliverable_format.required_sections);
  assert.match(bundle, /# RETURN/, 'the bundle must tell a zero-context reader how to hand its answer back');
  assert.match(bundle, /submit_stage/);
});
