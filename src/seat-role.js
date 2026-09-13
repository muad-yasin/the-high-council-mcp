// v6 §1: an optional per-seat `role` field, alongside `provider`/`model`/
// `maxTokens`/`lab`. Absent, prompt assembly is byte-identical to today -
// proven by test/seat-role.test.js's golden-hash comparison against every
// shipped chain config. Present, it augments the debate-stage system
// prompt only (wired in src/chain.js at the debate-stage invoke call);
// the panel stage never sees it (that structural guarantee is v6 §3,
// phase 2 - this module only defines the field and the augmentation, it
// does not itself enforce stage isolation).
//
// §2's argued position: `lens` and `persona` are separable because a lens
// is what can plausibly change what a seat catches, and a persona only
// changes how it talks - coupling them would make it impossible to
// attribute a measured difference (v6 §5) to either one.

// Fixed critique-function instruction blocks. Wording is a placeholder
// pending author review (v6 plan, Decisions left to the author) - the
// enum itself, and the fact that it is closed, is not.
export const LENSES = {
  adversary: 'Argue against this proposal as its strongest opponent would. Find the case where it fails, not the case where it usually works.',
  integrator: 'Judge this proposal by how it fits with everything else in the plan, not in isolation. Name what it would break or duplicate elsewhere.',
  'long-horizon': 'Judge this proposal by what it costs to maintain a year from now, not by how it looks today. Name the maintenance burden it adds.',
  'user-advocate': 'Judge this proposal by what the person actually using this experiences, not by what is convenient to build. Name where it makes their life harder.',
  'security-and-legal': 'Judge this proposal for what it exposes, leaks, or obligates - data, keys, liability. Name the concrete exposure, not a general risk.',
};

// The five public persona names Muad has already chosen (v6 plan §6).
// This is the shipped default; an operator may replace the whole set
// (§6 is v6 phase 6, not built by this module) - but this module is the
// one place a persona *name* is validated against, so the default lives
// here rather than being duplicated.
export const DEFAULT_PERSONAS = ['moses', 'noah', 'matthew', 'van-gogh', 'parzival'];

/**
 * Validate a seat's `role` field. Returns an array of problem strings -
 * empty means valid. Never throws; a chain-config lint (v5's own
 * lintChain, v6 §1) is expected to call this and surface problems the
 * same fail-loud way it already surfaces a missing seats.critics.
 */
export function validateSeatRole(role) {
  if (role === undefined || role === null) return [];
  const problems = [];
  if (typeof role !== 'object' || Array.isArray(role)) {
    return [`role must be an object with an optional "lens" and/or "persona" field, got ${Array.isArray(role) ? 'an array' : typeof role}`];
  }
  const { lens, persona, ...rest } = role;
  if (lens === undefined && persona === undefined) {
    problems.push('role is set but has neither "lens" nor "persona" - at least one must be present');
  }
  if (lens !== undefined && !(lens in LENSES)) {
    problems.push(`role.lens "${lens}" is not one of: ${Object.keys(LENSES).join(', ')}`);
  }
  if (persona !== undefined && typeof persona !== 'string') {
    problems.push(`role.persona must be a string persona name, got ${typeof persona}`);
  }
  for (const key of Object.keys(rest)) {
    problems.push(`role.${key} is not a recognized field - only "lens" and "persona" are`);
  }
  return problems;
}

/**
 * The debate-stage system prompt for a seat, with its role (if any)
 * appended after the chain's own instructions. A seat with no role
 * produces `basePrompt` unchanged - not a copy with an empty suffix,
 * the exact same string, so a golden-hash comparison is a real
 * byte-identity check and not merely a "looks the same" one.
 */
export function applySeatRole(basePrompt, role) {
  if (role === undefined || role === null) return basePrompt;
  const blocks = [];
  if (role.lens && LENSES[role.lens]) blocks.push(LENSES[role.lens]);
  if (role.persona) blocks.push(`You are arguing as ${role.persona}. Let that voice and point of view shape how you argue, without changing what you are actually judging.`);
  if (!blocks.length) return basePrompt;
  return `${basePrompt}\n\n[SEAT ROLE]\n${blocks.join('\n\n')}\n[END SEAT ROLE]`;
}
