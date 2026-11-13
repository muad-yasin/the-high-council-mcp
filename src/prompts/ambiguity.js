// Prompt words: the ambiguity union, the descending-mode prompts and claim extraction. Moved out of src/roles.js in 0.8.4, words unchanged; src/roles.js re-exports every name the old file exported, and a name exported here beyond those is an internal shared between prompt files.

// ---------------------------------------------------------------------------
// Ambiguity union (config.ambiguity_union.enabled, item 5 of the
// 2026-09-14T14-56-18-834Z plan). Three cheap seats each read the raw
// request, before any proposal or criterion exists, and list the ambiguities
// they see. src/chain.js unions and dedupes the lists (string/set-level) and
// appends the result to the request text, which is what the questions and
// criteria stages already read - no claim schema, no new report.json field.

export const AMBIGUITY_SYSTEM = `You read a raw request, before anything has been proposed or built, and list
the ambiguities in it - the places where two reasonable readings would lead
to different deliverables.

Rules:
- Each entry is one sentence, naming the actual fork ("X could mean A or B").
- Do not list things the request already answers, and do not invent scope
  the request never raised.
- No preamble.

Reply with a single JSON object and nothing else:
{ "ambiguities": ["...", "..."] }`;

export function ambiguityUser({ request }) {
  return `# Request\n\n${request}`;
}

export function ambiguitiesSection(ambiguities) {
  return `\n\n---\n\n# Ambiguities found before proposing (${ambiguities.length}, merged from the seats that read the request and deduplicated)\n\n${ambiguities.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nWhen this stage asks you to write questions, use them to resolve the ambiguities that matter to the plan.`;
}

// v7 §3, descending rounds (config.descending: true). Each round debates a NEW,
// frozen object - plan, then architecture, then edge cases, then code - rather
// than re-debating the same draft. Prior stages are carried as locked context,
// never reopened; the lock is enforced by the executor (src/chain.js), not by
// this prompt telling a seat not to touch them. Research support is silent on
// this exact structure (see relay v7 deliverable, 2026-09-14): it removes
// same-object repetition, which is the mechanism the literature blames for
// debate decay, but no study tests descending rounds specifically, so no
// efficacy is claimed here or anywhere else in this repo.
export const DESCENDING_BUILD_SYSTEM = `You are building one frozen stage of a descending-rounds plan.
Each round produces ONE stage of the deliverable; once a stage is built it is
locked and later stages must work within it, never contradict or redo it.

Rules:
- Write only the stage you were asked for. Do not draft later stages.
- Treat every already-frozen stage given to you as settled fact, not a
  suggestion you may revise.
- No preamble, no meta-commentary about the process.`;

export function descendingBuildUser({ request, stageName, frozen, order }) {
  const frozenSection = order
    .filter(s => s !== stageName && frozen[s] !== undefined)
    .map(s => `## ${s} (frozen)\n\n${frozen[s]}`)
    .join('\n\n');
  return `# Request\n\n${request}\n\n# Stage to build now: ${stageName}\n\n` +
    (frozenSection ? `# Already-frozen stages (locked, do not restate or contradict)\n\n${frozenSection}\n\n` : '') +
    `Write the "${stageName}" stage now.`;
}

// A critic reviewing the current (unfrozen) stage. It may propose an amendment,
// but only to the stage still open - see DESCENDING_BUILD_SYSTEM. An amendment
// naming any other stage names a frozen target; src/chain.js's descending
// executor rejects it and records the rejection rather than applying it, so a
// seat's misbehaviour (or a hostile prompt) cannot reopen a locked stage no
// matter what this text says.
export const DESCENDING_CRITIC_SYSTEM = `You are reviewing one stage in a descending-rounds plan. Earlier
stages are frozen and shown to you as context only, not as something you may
change - your amendment target must be the current stage or none at all.

Reply with a single JSON object and nothing else:
{ "amend": { "target": "<stage name>", "text": "..." } | null }`;

export function descendingCriticUser({ request, stageName, content, frozen, order }) {
  const frozenSection = order
    .filter(s => s !== stageName && frozen[s] !== undefined)
    .map(s => `## ${s} (frozen)\n\n${frozen[s]}`)
    .join('\n\n');
  return `# Request\n\n${request}\n\n` +
    (frozenSection ? `# Already-frozen stages (locked)\n\n${frozenSection}\n\n` : '') +
    `# Current stage: ${stageName}\n\n${content}\n\nPropose an amendment to "${stageName}" if one is warranted, or reply with "amend": null.`;
}

// v7.x: claim schema with typed evidence (src/claims.js). This stage runs only when
// config.claims.enabled is true, after this run's critic/revise rounds are done, restating the
// union of objections raised (already-generated `failures[]`, not new opinions) as typed claims
// so each one carries checkable evidence rather than free text alone. src/claims.js validates the
// evidence offline; this prompt only asks for the shape.
export const CLAIM_EXTRACTION_SYSTEM = `You restate a list of objections as typed claims, each with the evidence behind it.

For each objection given to you, write exactly one claim:
{ "claim": "<the objection, restated as a factual assertion>",
  "evidence": {
    "kind": "quote" | "tool" | "reasoning",
    "quote": "<a phrase copied VERBATIM from the draft, only if kind is \\"quote\\">",
    "result_ref": "<the tool name a ground-truth block above was run with, only if kind is \\"tool\\">"
  } }

Choose the evidence kind honestly:
- "quote" only if you can copy the exact words from the draft that support the claim - not a
  paraphrase, not "similar to". If you cannot quote it exactly, do not claim "quote".
- "tool" only if a "Ground truth (tool output, verbatim)" block above actually contains the fact
  this claim rests on - name the tool it came from.
- "reasoning" for anything else: your own inference, not a fact quoted from the draft or a tool.

Reply with a single JSON object and nothing else:
{ "claims": [ { "claim": "...", "evidence": { "kind": "...", "quote": "...", "result_ref": "..." } } ] }`;

export function claimExtractionUser({ request, draft, failures = [] }) {
  const list = failures.map((f, i) => `${i + 1}. Criterion: ${f.criterion}\n   Problem: ${f.problem}`).join('\n\n') || '(none)';
  return `# Original request\n\n${request}\n\n# Draft the objections were raised against\n\n${draft}\n\n# Objections to restate as typed claims\n\n${list}`;
}
