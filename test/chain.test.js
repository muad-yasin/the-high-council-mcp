// relay/test/chain.test.js
//
// Regression coverage for parseJson's repair pipeline (src/chain.js), added 2026-09-10 after a
// real, reproducible failure: three consecutive plan-cheap runs against the same real task all
// stopped at round 1 because Qwen3.5-9B's critique reply had an unescaped " inside a markdown-
// style 'single quoted' span (it quotes source phrases verbatim but doesn't escape a literal "
// that happens to land inside the quoted span). The old fallback silently logged "treating the
// round as a pass" while never actually marking it a pass - passed stayed false with no recorded
// reason. Fixtures below are trimmed real excerpts of the actual broken/fixed replies, not
// synthetic examples - see brand/HIGH_COUNCIL.md's sibling project (cnc-harness) DECISIONS.md,
// 2026-09-10, for the full incident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJson, parseDisputes, classifyUnreadable, runChain, runDescendingChain, criteriaUserPrompt } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
const mockProposalsConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-proposals.json'), 'utf8'));
const mockPartitionedConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock-partitioned.json'), 'utf8'));

test('parseJson: stray unescaped quote inside a markdown-quoted span is repaired', () => {
  // Trimmed from a real Qwen3.5-9B reply (run 2026-09-10T20-02-20-992Z, critique-1.md) - the
  // inner "The Council," breaks a naive JSON.parse without the string-state-aware repair.
  const text = `{
  "meets": true,
  "criteria": [
    { "criterion": "c1", "verdict": "MET", "evidence": "Section 6 states: 'nothing else. No mention of "The Council," no round count, no per-model attribution, no objection record...'" }
  ],
  "failures": [],
  "verdict_line": "All good."
}`;
  const parsed = parseJson(text);
  assert.ok(parsed, 'expected the repair pipeline to recover valid JSON');
  assert.equal(parsed.meets, true);
  assert.equal(parsed.criteria.length, 1);
});

test('parseJson: raw newline inside a string value is repaired', () => {
  const text = `{
  "meets": false,
  "criteria": [],
  "failures": [{ "criterion": "c1", "problem": "line one
line two" }],
  "verdict_line": "v"
}`;
  const parsed = parseJson(text);
  assert.ok(parsed, 'expected the repair pipeline to recover valid JSON');
  assert.equal(parsed.failures[0].problem, 'line one\nline two');
});

test('parseJson: genuinely garbled model output still correctly fails (no false fix)', () => {
  // Trimmed from a real Qwen3.5-9B reply (run 2026-09-10T19-59-54-039Z, critique-1.md) - leaked
  // CSS-looking text and a stray semicolon, not a mechanically-fixable quoting slip. The repair
  // pipeline must not paper over genuinely nonsense content - returning null here is correct.
  const text = `{
  "meets": true,
  "criteria": [
    { "criterion": "c1", "verdict": "MET", "description": "css="font-size: 100%" font-family: 'Varta', sans-serif";
      "node:sqlite": "extra" }
  ]
}`;
  const parsed = parseJson(text);
  assert.equal(parsed, null, 'garbled content should not be silently "fixed" into something parseable');
});

test('parseJson: existing repairs (trailing comma, bare key) still work - no regression', () => {
  assert.ok(parseJson('{"a": 1, "b": [1, 2,],}'), 'trailing comma before ] or } should still repair');
  // Mistral Large, 2026-09-07: a key written as a bare "key: value" string instead of
  // "key": "value" - the pre-existing repair this test guards against regressing.
  const parsed = parseJson('{"reason: this explanation was written as one bare string"}');
  assert.ok(parsed, 'bare "key: value" string should still repair into a real key/value pair');
  assert.equal(parsed.reason, 'this explanation was written as one bare string');
});

test('parseJson: well-formed JSON parses unchanged, not mangled by the new repair', () => {
  const text = JSON.stringify({ meets: true, criteria: [{ criterion: 'c', verdict: 'MET', evidence: 'quoted "properly" already' }], failures: [] });
  const parsed = parseJson(text);
  assert.ok(parsed);
  assert.equal(parsed.criteria[0].evidence, 'quoted "properly" already');
});

test('parseJson: fenced JSON with a stray inner quote is still recovered', () => {
  const text = '```json\n{"meets": true, "note": "said \'it is "fine"\' apparently", "failures": []}\n```';
  const parsed = parseJson(text);
  assert.ok(parsed, 'expected fenced+repaired JSON to parse');
  assert.equal(parsed.meets, true);
});

// classifyUnreadable: added 2026-09-10 after GP judging run 2026-09-10T20-01-59-545Z
// (panel-1-glm.md) - GLM 5.3 Flash burned its entire token budget on thinking and returned an
// empty reply with finish_reason "error". The old two-way check (token cap vs. malformed JSON)
// labelled that "malformed JSON - read the saved reply, it may still be an objection", which is
// wrong on both counts: there's no reply to read, and it's not an objection. See src/chain.js.
test('classifyUnreadable: provider stop:"error" is its own category, not "malformed JSON"', () => {
  const why = classifyUnreadable({ output: 20, thinking: 20, stop: 'error' }, 8000);
  assert.match(why, /error/i);
  assert.doesNotMatch(why, /malformed JSON/);
});

test('classifyUnreadable: stop:"error" wins even when output also happens to be near the cap', () => {
  // A provider error can land at any output-token count, including one that would otherwise be
  // misread as "hit the token cap" - stop:"error" must take priority over the cap heuristic.
  const why = classifyUnreadable({ output: 7999, stop: 'error' }, 8000);
  assert.match(why, /error/i);
  assert.doesNotMatch(why, /hit the token cap/);
});

test('classifyUnreadable: near-cap output with no error still reads as truncation', () => {
  const why = classifyUnreadable({ output: 7999 }, 8000);
  assert.equal(why, 'hit the token cap, truncated');
});

test('classifyUnreadable: low output with no error still reads as a formatting problem', () => {
  const why = classifyUnreadable({ output: 8 }, 8000);
  assert.equal(why, 'malformed JSON - read the saved reply, it may still be an objection');
});

// v3 §4 (contract-vs-criteria fix, ~/Projects/relay/tasks/thcmcp-v3-draft-fixed.md). Real
// incident: across four runs, a criteria seat that never learned a chain's own required
// sections wrote a criterion forbidding one - a deadlock that cost rounds and, once, could not
// be resolved by any revision. The criteria seat now can't produce that conflict in the first
// place, because it's told what's required before it writes anything.
test('criteriaUserPrompt: a proposal-mode chain is told its required sections, so it cannot forbid one', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-proposals.json'), 'utf8'));
  const prompt = criteriaUserPrompt('Do the thing.', config);
  assert.match(prompt, /# Sections this chain always adds/);
  assert.match(prompt, /Scope ledger/);
  assert.match(prompt, /Do not write a criterion that forbids this section's presence/);
});

test('criteriaUserPrompt: a chain with no required sections adds no block at all', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const prompt = criteriaUserPrompt('Do the thing.', config);
  assert.equal(prompt, '# Request\n\nDo the thing.');
  assert.doesNotMatch(prompt, /Sections this chain always adds/);
});

// §5 (v3 plan, MISTRAL-3 accepted): a reviser that declines an objection ends its reply with
// trailing "DECLINED: <reason>" lines (src/roles.js). Those lines must never reach the next
// round's draft and must be recorded separately, in order, in the run result's `disputes` array.
test('parseDisputes: strips trailing DECLINED lines from the draft and returns them in order', () => {
  const text = 'THE DELIVERABLE\n\nBody text.\n\nDECLINED: the critic quoted no evidence.\nDECLINED: this is a matter of taste, not a defect.';
  const { draft, disputes } = parseDisputes(text);
  assert.equal(draft, 'THE DELIVERABLE\n\nBody text.');
  assert.deepEqual(disputes, ['the critic quoted no evidence.', 'this is a matter of taste, not a defect.']);
});

test('parseDisputes: a reply with no DECLINED trailer is returned unchanged with an empty disputes array', () => {
  const text = 'THE DELIVERABLE\n\nBody text.';
  const { draft, disputes } = parseDisputes(text);
  assert.equal(draft, text);
  assert.deepEqual(disputes, []);
});

test('runChain: a fixture reviser reply ending in DECLINED lines is stripped from the draft and collected into result.disputes, in order (mock provider, mock.json revise stage)', async () => {
  const config = { ...mockConfig, signoff: undefined }; // non-panel path: mock.json's own critic/reviser cycle
  const result = await runChain({
    request: 'TRIGGER_DECLINED_TEST: write a short fixture deliverable.',
    config,
    log: () => {},
  });
  // The reviser's own DECLINED trailer must never survive into the deliverable a later critic
  // grades, or into any later round's draft.
  assert.doesNotMatch(result.deliverable, /DECLINED:/);
  assert.ok(Array.isArray(result.disputes) && result.disputes.length >= 1, 'expected at least one dispute to be recorded');
  assert.deepEqual(result.disputes.map(d => d.reason), [
    'the critic quoted no evidence for this claim.',
    'this is a matter of taste, not a defect.',
  ]);
  assert.ok(result.disputes.every(d => typeof d.round === 'number'));
});

// v7 item 2: seat reliability recording and provider-failure dropout degradation.
// mock.json's non-unanimous ("first" mode) critique path used to let a thrown provider error
// (network failure, 5xx, etc.) propagate straight out of runChain and crash the whole run - a
// real paid run was lost to exactly this. `mock-network-error` (src/providers.js) simulates
// that failure offline. Backward compat is the point: a chain that doesn't set
// degrade_on_provider_error must crash exactly as it always did.
test('runChain: a provider failure crashes the run when degrade_on_provider_error is unset (today\'s exact behavior, unchanged)', async () => {
  const config = {
    ...mockConfig,
    signoff: undefined,
    seats: { ...mockConfig.seats, critics: [{ provider: 'mock', model: 'mock-network-error' }] },
  };
  await assert.rejects(
    runChain({ request: 'a request', config, log: () => {} }),
    /mock: provider unreachable/,
  );
});

test('runChain: degrade_on_provider_error: true drops the failing seat and completes the run instead of crashing', async () => {
  const config = {
    ...mockConfig,
    signoff: undefined,
    degrade_on_provider_error: true,
    seats: { ...mockConfig.seats, critics: [{ provider: 'mock', model: 'mock-network-error' }] },
  };
  const result = await runChain({ request: 'a request', config, log: () => {} });
  assert.ok(result.deliverable, 'expected the run to complete with a deliverable rather than throw');
  assert.equal(result.passed, false);
  assert.ok(result.dropouts.some(d => d.stage === 'critique-1' && /provider failure/.test(d.reason)),
    'expected the dropped critic seat to be recorded in result.dropouts');
});

// v7 §3, descending rounds (config.descending: true). A round debates a NEW, frozen object in
// sequence - plan, architecture, edge cases, code - with prior stages locked and carried as
// context, never reopened. The lock must be enforced at the executor level (src/chain.js), not
// by an unenforced prompt rule - this project has a documented history of that exact bug shape.
test('runDescendingChain: an amendment against the frozen stage-1 plan during stage 3 is rejected and recorded, not applied', async () => {
  const config = {
    ...mockConfig,
    descending: true,
    seats: {
      ...mockConfig.seats,
      // Always tries to amend "plan" no matter which stage is actually open.
      critics: [{ provider: 'mock', model: 'mock-descending-amend-frozen' }],
    },
  };
  const result = await runDescendingChain({ request: 'Plan a small offline tool.', config, log: () => {} });

  assert.equal(result.descending, true);
  assert.deepEqual(result.order, ['plan', 'architecture', 'edge_cases', 'code']);

  // Every stage was built and frozen.
  for (const stage of result.order) assert.ok(typeof result.frozen[stage] === 'string' && result.frozen[stage].length > 0);

  // The critic tried to amend "plan" at every stage, including stage 3 (edge_cases) - the case
  // the task calls out explicitly. Every attempt after stage 1 targets an already-frozen stage
  // and must be rejected, not applied.
  const rejectedAtStage3 = result.rejectedAmendments.find(r => r.stage === 'edge_cases' && r.target === 'plan');
  assert.ok(rejectedAtStage3, 'expected the stage-3 amendment attempt against the frozen plan to be recorded as rejected');
  assert.match(rejectedAtStage3.reason, /frozen/);

  // At stage 1, "plan" IS the current stage, so that one amendment is legitimately applied - the
  // frozen plan carries the critic's text once, from stage 1 only.
  assert.match(result.frozen.plan, /Rewrite the frozen plan/);

  // Every stage after stage 1 (architecture, edge_cases, code) tried to amend the now-frozen
  // "plan" and was rejected - three rejections, none applied.
  assert.equal(result.rejectedAmendments.filter(r => r.target === 'plan').length, 3, 'expected the amendment to be rejected at every stage after stage 1 (architecture, edge_cases, code)');
  assert.deepEqual(result.rejectedAmendments.map(r => r.stage), ['architecture', 'edge_cases', 'code']);
});

test('runChain: descending mode absent preserves existing behavior exactly (mock.json runs its normal path)', async () => {
  const result = await runChain({ request: 'Write a short fixture deliverable.', config: mockConfig, log: () => {} });
  assert.equal(result.descending, undefined);
  assert.ok(typeof result.deliverable === 'string' && result.deliverable.length > 0);
});

// v7 §3, extended per the author's direction (2026-09-14): round 1 (plan) flows into the
// existing criteria/proposals/debate/reply machinery instead of a bespoke descending prompt, and
// the final round (code) is where signoff + handoff happen - once, over the whole descending
// stack - rather than per stage.
test('runDescendingChain: round 1 runs the existing criteria/proposals pipeline; the final stage runs signoff and handoff once over the whole stack', async () => {
  const config = {
    ...mockConfig,
    descending: true,
    signoff: 'unanimous',
    handoff: true,
    proposals: { parts: 2 },
    debate: true,
    seats: {
      ...mockConfig.seats,
      proposers: [{ provider: 'mock', model: 'mock-proposer-a', lab: 'mock-a' }, { provider: 'mock', model: 'mock-proposer-b', lab: 'mock-b' }], // distinct labs: a shared lab is refused (duplicate-lab)
      critics: [{ provider: 'mock', model: 'mock-critic-holdout' }],
    },
  };
  const result = await runDescendingChain({ request: 'Plan a small offline tool.', config, log: () => {} });

  // Round 1 went through the real pipeline: criteria came from the criteria stage (mock.json's
  // fixture criteria, not something a descending-only prompt invented), and proposals/board are
  // populated by the mock proposer seats - proof the proposal machinery actually ran once, for
  // round 1 only (result.proposals is not per-stage).
  assert.ok(Array.isArray(result.criteria) && result.criteria.length > 0);
  assert.ok(Array.isArray(result.proposals) && result.proposals.length > 0);
  assert.ok(typeof result.board === 'string' && result.board.length > 0);

  // Signoff and handoff exist exactly once, on the final result, judging the whole stack - not
  // one per stage.
  assert.ok(Array.isArray(result.signoff) && result.signoff.length > 0);
  assert.ok(typeof result.handoff === 'string' && result.handoff.length > 0);
  assert.ok(typeof result.passed === 'boolean');

  // The final deliverable is what the signoff/handoff stage produced (its own critique/revise
  // loop over the concatenated stack), not the bare, un-critiqued concatenation.
  assert.ok(typeof result.deliverable === 'string' && result.deliverable.length > 0);
});

// v1 context partitioning (config.proposals.partition, opt-in). See src/roles.js's proposerUser
// tests for the prompt-level regression pin; these cover the chain.js wiring: validation, the
// slice metadata that survives onto each proposal object, and that omitting `partition` entirely
// leaves every proposal's `slice` field `null` - unchanged behavior for every chain that doesn't
// use this.
test('runChain: config.proposals.partition absent leaves proposal.slice null for every proposal (no behavior change)', async () => {
  const result = await runChain({ request: 'Do the thing.', config: mockProposalsConfig, log: () => {} });
  assert.ok(Array.isArray(result.proposals) && result.proposals.length > 0, 'expected proposals to exist');
  assert.ok(result.proposals.every(p => p.slice === null), 'every proposal.slice must be null when partitioning is not configured');
});

test('runChain: config.proposals.partition.slices threads a per-seat slice onto that lab\'s proposals only', async () => {
  const result = await runChain({ request: 'Do the thing.', config: mockPartitionedConfig, log: () => {} });
  const sliced = result.proposals.filter(p => p.lab === 'mock-a');
  const unsliced = result.proposals.filter(p => p.lab === 'mock-b');
  assert.ok(sliced.length > 0 && unsliced.length > 0, 'expected proposals from both the sliced and unsliced seat');
  assert.ok(sliced.every(p => p.slice === 'Focus on the config schema and validation surface.'),
    'the seat named in partition.slices must carry its exact slice text on every one of its proposals');
  assert.ok(unsliced.every(p => p.slice === null),
    'a seat left out of partition.slices (partial partitioning) must carry no slice metadata, proving it is unaffected');
});

test('runChain: config.proposals.partition.slices with an unknown lab name throws at the proposal stage', async () => {
  const config = {
    ...mockPartitionedConfig,
    proposals: { ...mockPartitionedConfig.proposals, partition: { slices: { 'mock-nonexistent': 'Focus on X.' } } },
  };
  await assert.rejects(
    runChain({ request: 'Do the thing.', config, log: () => {} }),
    /unknown lab "mock-nonexistent"/,
  );
});

test('runChain: config.proposals.partition.slices with a non-string value throws at the proposal stage', () => {
  const config = {
    ...mockPartitionedConfig,
    proposals: { ...mockPartitionedConfig.proposals, partition: { slices: { 'mock-a': 42 } } },
  };
  return assert.rejects(
    runChain({ request: 'Do the thing.', config, log: () => {} }),
    /must be a non-empty string/,
  );
});

test('cutOffRetryCap: doubles a small cap, bounds it at 64k, and never retries below the seat\'s own cap', async () => {
  const { cutOffRetryCap } = await import('../src/chain.js');
  assert.equal(cutOffRetryCap(20000), 40000);
  assert.equal(cutOffRetryCap(36000), 64000);
  assert.equal(cutOffRetryCap(360000), 360000);
});

test('metaCriteria: flags the Zofia run\'s criteria-about-criteria, passes a real plan\'s criteria', async () => {
  const { metaCriteria } = await import('../src/chain.js');
  const bad = [
    "Is a JSON object with a 'criteria' key containing a list of strings.",
    'Contains exactly one criterion per required part of the request, up to 15.',
    'Each criterion checks one property and can be answered with yes or no.',
    "Makes no assumption about the presence or absence of the 'Scope ledger' section.",
  ];
  const good = [
    'Lists a concrete architecture for v1',
    'Specifies the order of building the components (Q4-Q7, Q9)',
    'Records dissenting opinions on debated questions',
    "Includes a section titled 'Scope ledger'",
  ];
  assert.ok(metaCriteria(bad).length > 0);
  assert.deepEqual(metaCriteria(good), []);
  assert.deepEqual(metaCriteria(['Every acceptance criterion in the plan names a test']), []);
});

test('infeasibleCriteria: flags criteria demanding documents a single stage cannot produce', async () => {
  const { infeasibleCriteria } = await import('../src/chain.js');
  const opts = { handoff: true, debate: true };
  assert.equal(infeasibleCriteria(['Is in the format of three core documents (PLAN.md, BOARD.md, HANDOFF.md) as required'], opts).length, 1);
  assert.equal(infeasibleCriteria(['Includes a HANDOFF.md startup file'], opts).length, 1);
  assert.deepEqual(infeasibleCriteria(['Is a single markdown file named PLAN.md', 'Contains a 7-year roadmap section'], opts), []);
  // Without a handoff stage, naming HANDOFF.md is the deliverable's own business.
  assert.deepEqual(infeasibleCriteria(['Includes a HANDOFF.md startup file'], { handoff: false, debate: false }), []);
});

// Bug audit 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #3): external-seat reviser files
// end in "\n", which left a blank last line and made every DECLINED line vanish into the draft.
test('parseDisputes: a trailing newline (or CRLF, or blank lines between) does not hide the DECLINED trailer', () => {
  for (const text of ['body\n\nDECLINED: x\n', 'body\n\nDECLINED: x\n\n\n', 'body\r\n\r\nDECLINED: x\r\n', 'body\n\nDECLINED: x\n\nDECLINED: y\n']) {
    const { draft, disputes } = parseDisputes(text);
    assert.equal(draft, text.startsWith('body\r') ? 'body\r' : 'body', JSON.stringify(text));
    assert.equal(disputes[0], 'x', JSON.stringify(text));
    assert.ok(!/DECLINED/.test(draft), `DECLINED leaked into the draft for ${JSON.stringify(text)}`);
  }
  assert.deepEqual(parseDisputes('body\n\nDECLINED: x\n\nDECLINED: y\n').disputes, ['x', 'y']);
});

// Bug audit 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #5, #7).
test('criteria guards: legitimate criteria are not refused; the Zofia shapes still are', async () => {
  const { metaCriteria, infeasibleCriteria } = await import('../src/chain.js');
  assert.deepEqual(metaCriteria(['The /orders endpoint returns a JSON object with an id and a status.', 'Tags are stored as a list of strings.']), []);
  assert.ok(metaCriteria(["Is a JSON object with a 'criteria' key containing a list of strings."]).length);
  const opts = { handoff: true, debate: true };
  assert.deepEqual(infeasibleCriteria(["Doesn't contradict DECISIONS.md or CLAUDE.md.", 'Is consistent with PLAN.md and ROADMAP.md.'], opts), []);
  assert.equal(infeasibleCriteria(['Is in the format of three core documents (PLAN.md, BOARD.md, HANDOFF.md) as required'], opts).length, 1);
  assert.equal(infeasibleCriteria(['Delivers PLAN.md and ROADMAP.md as two files.'], opts).length, 1);
});

test('criteria guards: criteria retried for being meta must also pass the feasibility guard', async () => {
  const { runChain, setCache, setBudget } = await import('../src/chain.js');
  const seat = model => ({ provider: 'mock', model, lab: model });
  const replies = {
    criteria: '{"criteria": ["Is a JSON object with a \'criteria\' key", "Names a rollback plan", "Lists owners"]}',
    'criteria-retry': '{"criteria": ["Ships HANDOFF.md with the build order", "Names a rollback plan", "Lists owners"]}',
  };
  setBudget(null);
  setCache({ get: l => replies[l] ? { text: replies[l], usage: { input: 1, output: 1 }, usd: 0 } : null });
  try {
    await assert.rejects(() => runChain({ request: 'Plan X.', log: () => {}, config: { name: 'audit', maxRounds: 1, signoff: 'unanimous', handoff: { enabled: true },
      seats: { criteria: seat('mock-criteria'), builder: seat('mock-builder'), reviser: seat('mock-builder'), handoff: seat('mock-handoff'), critics: [seat('mock-critic-a')] } } }),
      /retried criteria demand documents/);
  } finally { setCache(null); }
});

// Bug audit 2026-09-23 (Review/BugAudit_ChainParsers_2026-09-23.md #8).
test('proposals: a proposal\'s own id/lab never overrides the harness identity; a regex-y id cannot throw', async () => {
  const { runChain, setCache, setBudget, scoreProposals } = await import('../src/chain.js');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-proposals.json'), 'utf8'));
  const own = JSON.stringify({ proposals: [{ id: 'P(1', lab: 'someone-else', title: 'T', serves: 's', what: 'w', why: 'y', how: 'h', acceptance_test: 'a' }] });
  setBudget(null);
  setCache({ get: l => /^propose-mock-pa(-\d+)?$/.test(l) ? { text: own, usage: { input: 1, output: 1 }, usd: 0 } : null });
  try {
    const r = await runChain({ request: 'Plan X.', config: cfg, log: () => {} });
    const p = r.proposals.find(x => x.proposer_id === 'P(1');
    assert.ok(p, 'the proposal is kept, with the model\'s own id recorded as proposer_id');
    assert.equal(p.id, 'MOCKPA-1');
    assert.equal(p.lab, 'mock-pa');
    assert.equal(p.proposer_lab, 'someone-else');
  } finally { setCache(null); }
  assert.doesNotThrow(() => scoreProposals([{ id: 'P(1', lab: 'a' }], 'P(1 - accepted - fine'));
  assert.equal(scoreProposals([{ id: 'P(1', lab: 'a' }], 'P(1 - accepted - fine').rows[0].status, 'accepted');
});
