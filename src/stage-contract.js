// Stage contract schema (v2 plan §2.2, ~/Projects/relay/runs/2026-09-11T12-19-34-184Z/deliverable.md).
//
// A stage contract is a small, structured, self-contained description of
// what a stage needs and must return, derived from a chain config alone -
// no run state, no prior conversation. It is the one shared substrate that
// prepare_stage_prompt (§3), the resume brief (§5), the pre-flight check
// (§6) and partial-deliverable detection (§7.1) all read or write.
//
// This module only defines and derives the schema (Phase 1, items 1-2). It
// does not yet drive prompt assembly, resume, pre-flight or completeness
// checks - those are later phases and read this contract, not the other
// way around.

// Canonical stage kinds. chain.js emits per-lab/per-round labels
// (`propose-glm`, `panel-2-mistral`, `revise-3`, ...); STAGE_KIND_PATTERNS
// maps any such label back to one of these fixed kinds so the contract
// vocabulary stays small and stable even as labs and round counts vary.
const STAGE_DEFS = {
  questions: {
    role: 'Ask up to N clarifying questions that would change the plan, each with a stated default.',
    required_sections: ['questions'],
    return_instructions: 'Return JSON: { "questions": [{ "question": string, "default": string }] }.',
  },
  criteria: {
    role: 'Write the acceptance criteria the eventual deliverable will be checked against, before the deliverable exists.',
    required_sections: ['criteria'],
    return_instructions: 'Return JSON: { "criteria": [string, ...] }.',
  },
  // Whole alternative architectures (chain.js, config.alternatives.enabled; 2026-09-23).
  alternative: {
    role: 'Blind: propose ONE whole alternative architecture for the request - its name, shape, key trade-offs and what it is bad at - without seeing any other seat\'s.',
    required_sections: ['name', 'shape'],
    return_instructions: 'Return JSON: { "name": string, "shape": string, "key_tradeoffs": string, "bad_at": string }.',
  },
  'alt-debate': {
    role: 'Post an anonymised objection, support, or merge suggestion against another seat\'s whole architecture, without knowing which lab wrote it.',
    required_sections: ['posts'],
    return_instructions: 'Return JSON: { "posts": [{ "on": string, "stance": "support"|"object"|"merge", "text": string }] }.',
  },
  'alt-reply': {
    role: 'As the architecture\'s own author, decide whether to keep, amend, or withdraw it in light of the posts against it.',
    required_sections: ['replies'],
    return_instructions: 'Return JSON: { "replies": [{ "id": string, "action": "keep"|"amend"|"withdraw", "text": string }] }.',
  },
  skeleton: {
    role: 'Sketch the buildable shape of the deliverable that proposers will each independently fill in, blind to one another.',
    required_sections: ['skeleton'],
    return_instructions: 'Return the skeleton as plain text.',
  },
  propose: {
    role: 'Blind proposal: offer up to N buildable parts against the skeleton and criteria, without seeing any other seat\'s proposal.',
    required_sections: ['proposals'],
    return_instructions: 'Return JSON: { "proposals": [{ "title": string, ... }] }.',
  },
  judge: {
    role: 'Score a pool of proposals from one lab and keep the strongest, distinct subset.',
    // `picks`, the key the judge stage reads (src/roles.js JUDGE_SYSTEM, src/chain.js). This said
    // `kept` - the proposal-MERGE stage's key - so every correct judge reply got a false PARTIAL
    // OUTPUT warning, and an external judge that followed this contract was silently ignored
    // (bug audit 2026-09-23, GuardLayer backlog).
    required_sections: ['picks'],
    return_instructions: 'Return JSON: { "picks": [pool numbers, best first], "dropped_because": string }.',
  },
  debate: {
    role: 'Post an anonymised objection, support, or merge suggestion against another seat\'s proposal, without knowing which lab wrote it.',
    required_sections: ['posts'],
    return_instructions: 'Return JSON: { "posts": [{ "on": string, "stance": string, "text": string }] }.',
  },
  reply: {
    role: 'As the proposal\'s own author, decide whether to keep, amend, or withdraw it in light of the debate posts against it.',
    required_sections: ['replies'],
    return_instructions: 'Return JSON: { "replies": [{ "proposal": string, "action": "keep"|"amend"|"withdraw", "text": string }] }.',
  },
  build: {
    role: 'Integrate the surviving proposals into one coherent first draft of the deliverable.',
    required_sections: ['draft'],
    return_instructions: 'Return the draft as plain text/markdown.',
  },
  // Corrected 2026-09-15 (thcmcp-66 flagged a false-positive "PARTIAL OUTPUT WARNING" on every
  // real critic reply). Real bug, not an env-specific one: `required_sections: ['verdict',
  // 'objections']` named fields that never existed in the real critic schema - CRITIC_SYSTEM_
  // TEMPLATE (src/roles.js) has always instructed `{ meets, criteria, failures, verdict_line }`,
  // and the engine's own parser (normaliseCritique, src/chain.js) has always read `criteria` and
  // `failures`, never `verdict`/`objections`. Every real critic reply - checked against a real
  // run's panel-1-*.md files, not just against the prompt text - was failing this check, which
  // means the pre-existing test/partial-deliverable.test.js fixture (`{ verdict: 'pass',
  // objections: [] }`) was validating an imaginary schema that no real reply has ever produced.
  // `criteria` and `failures` are the two fields whose presence is what actually proves a critic
  // did a real per-criterion check rather than free text; a genuinely broken/truncated reply
  // still fails this the same way it always should.
  panel: {
    role: 'Critique the current draft against the acceptance criteria; pass or fail it, naming every objection if failing.',
    required_sections: ['criteria', 'failures'],
    return_instructions: 'Return JSON: { "meets": true|false, "criteria": [{ "criterion": string, "verdict": "MET"|"FAILED", "evidence": string }], "failures": [{ "criterion": string, "problem": string, "fix": string }], "verdict_line": string }.',
  },
  critique: {
    role: 'Critique the current draft against the acceptance criteria; pass or fail it, naming every objection if failing.',
    required_sections: ['criteria', 'failures'],
    return_instructions: 'Return JSON: { "meets": true|false, "criteria": [{ "criterion": string, "verdict": "MET"|"FAILED", "evidence": string }], "failures": [{ "criterion": string, "problem": string, "fix": string }], "verdict_line": string }.',
  },
  revise: {
    role: 'Revise the draft to address the union of every critic\'s objections from the prior round.',
    required_sections: ['draft'],
    return_instructions: 'Return the revised draft as plain text/markdown.',
  },
  final: {
    role: 'Make one last editorial pass over the signed-off draft before handoff.',
    required_sections: ['draft'],
    return_instructions: 'Return the final draft as plain text/markdown.',
  },
  handoff: {
    role: 'Turn the finished deliverable into a build-ready handoff: an ordered task list with acceptance tests per item.',
    required_sections: ['tasks'],
    return_instructions: 'Return the handoff document as plain text/markdown.',
  },
  argued: {
    role: 'Write "How this plan was argued" for a beginner developer, from the fact pack only: the options considered and why the losers lost, the objections that changed the plan, what is still disputed, and one line per lab. Cite a fact-pack id on every claim.',
    required_sections: ['How this plan was argued', 'The big options', 'The objections that changed the plan', 'What is still disputed', 'Where each lab stood'],
    return_instructions: 'Return the section as plain markdown, with the headings exactly as named in the prompt.',
  },
};

// Order matters only for readability; STAGE_KIND_PATTERNS is checked in
// order and the first match wins, so put more specific patterns first.
const STAGE_KIND_PATTERNS = [
  [/^questions$/, 'questions'],
  [/^criteria$/, 'criteria'],
  [/^alternative-/, 'alternative'],
  [/^alt-debate-/, 'alt-debate'],
  [/^alt-reply-/, 'alt-reply'],
  [/^skeleton$/, 'skeleton'],
  [/^propose-.+-retry$/, 'propose'],
  [/^propose-/, 'propose'],
  [/^judge-/, 'judge'],
  [/^debate-/, 'debate'],
  [/^reply-/, 'reply'],
  [/^build(-retry)?$/, 'build'],
  [/^panel-/, 'panel'],
  [/^critique-/, 'critique'],
  [/^revise-/, 'revise'],
  [/^final(-retry)?$/, 'final'],
  [/^handoff(-retry)?$/, 'handoff'],
  [/^argued(-retry)?$/, 'argued'],
];

/** Map a chain.js stage label (e.g. "propose-glm", "panel-2-mistral") to a canonical stage kind, or null if unrecognised. */
export function stageKindOf(label) {
  const hit = STAGE_KIND_PATTERNS.find(([pattern]) => pattern.test(label));
  return hit ? hit[1] : null;
}

/**
 * List the canonical stage kinds a given chain config will actually run,
 * in the order chain.js runs them. Mirrors the flag checks in runChain().
 */
export function stageKindsFor(config) {
  const kinds = [];
  if (config.questions) kinds.push('questions');
  kinds.push('criteria');
  if (config.alternatives?.enabled === true) kinds.push('alternative', 'alt-debate', 'alt-reply');
  if (config.proposals) {
    kinds.push('skeleton', 'propose');
    if ((config.proposals.samples ?? 1) > 1) kinds.push('judge');
  }
  if (config.debate) kinds.push('debate', 'reply');
  kinds.push('build');
  kinds.push(config.signoff === 'unanimous' ? 'panel' : 'critique');
  kinds.push('revise');
  kinds.push('final');
  if (config.handoff) kinds.push('handoff');
  if (config.argued?.enabled === true && !config.descending) kinds.push('argued');
  return kinds;
}

/** Required section names for a stage kind alone, with no chain config needed. */
export function requiredSectionsFor(stageKind) {
  const def = STAGE_DEFS[stageKind];
  if (!def) throw new Error(`requiredSectionsFor: unknown stage kind "${stageKind}"`);
  return [...def.required_sections];
}

// Stage kinds whose return_instructions ask for JSON (required_sections names JSON keys to
// check for) vs. freeform markdown/text (required_sections names a single symbolic slot,
// satisfied by any non-empty text). Used by partial-deliverable detection (§7.1) to know how
// to validate a stage's raw output without re-deriving it from return_instructions text.
const STRUCTURED_STAGE_KINDS = new Set(['questions', 'criteria', 'alternative', 'alt-debate', 'alt-reply', 'propose', 'judge', 'debate', 'reply', 'panel', 'critique']);
export function isStructuredStage(stageKind) {
  return STRUCTURED_STAGE_KINDS.has(stageKind);
}

/**
 * Build the stage contract for one stage kind of one chain config.
 * Self-contained and derived purely from `config` - no run state - so it
 * can be regenerated identically at any point in a run's life.
 */
export function buildStageContract(config, stageKind) {
  const def = STAGE_DEFS[stageKind];
  if (!def) throw new Error(`buildStageContract: unknown stage kind "${stageKind}"`);
  const approxLength = stageKind === 'build' || stageKind === 'revise' || stageKind === 'final'
    ? config.estimate?.draftTokens ?? null
    : config.estimate?.promptTokens ?? null;
  return {
    stage_id: stageKind,
    role: def.role,
    no_prior_context: true,
    deliverable_format: {
      required_sections: [...def.required_sections],
      approx_length: approxLength,
    },
    return_instructions: def.return_instructions,
  };
}

/**
 * Render the self-contained stage_prompt.md bundle (§3) for a paused external stage.
 * Pure string assembly - no file IO - so it can be unit-tested without a run folder.
 * `references` must be paths, never inlined content: that is the property that keeps
 * the bundle small enough for a fresh, context-empty reader to hold comfortably.
 */
export function renderStagePromptBundle({ contract, taskText, chainName, label, run, references }) {
  return `# STAGE CONTRACT
stage_id: ${contract.stage_id}
role: ${contract.role}
no_prior_context: true
deliverable_format:
  required_sections: ${JSON.stringify(contract.deliverable_format.required_sections)}
  approx_length: ${contract.deliverable_format.approx_length ?? 'not estimated'}
return_instructions: ${contract.return_instructions}

# TASK
${taskText}

# WHAT'S ALREADY DECIDED
Chain: ${chainName ?? 'unknown'}. This run is paused waiting on stage "${label}".
(A fuller resume brief is planned - runs/<id>/RESUME.md, not yet built. Until then, read
run.log in the run folder for the full stage history if you need more than this line.)

# CONTEXT REFERENCES
The following documents are relevant background. Do not assume you have read them -
you have not. If your deliverable needs their content, read them:
${references.map(r => `  - ${r}`).join('\n')}

# WHAT NOT TO ASSUME
No static contract/criteria conflict check has run yet for this stage (planned, not
yet built). If the task's acceptance criteria seem to conflict with this stage's
required_sections above, say so in your deliverable rather than silently picking one.

# RETURN
Write your deliverable per return_instructions above. Give it back to the driving
session, which will call submit_stage(${JSON.stringify(run)}, ${JSON.stringify(label)}, <your deliverable text>).
`;
}

/** True iff every field a stage contract is required to carry is present and non-empty. */
export function isValidStageContract(contract) {
  return Boolean(
    contract &&
    typeof contract.stage_id === 'string' && contract.stage_id.length > 0 &&
    typeof contract.role === 'string' && contract.role.length > 0 &&
    contract.no_prior_context === true &&
    contract.deliverable_format &&
    Array.isArray(contract.deliverable_format.required_sections) &&
    contract.deliverable_format.required_sections.length > 0 &&
    typeof contract.return_instructions === 'string' && contract.return_instructions.length > 0
  );
}
