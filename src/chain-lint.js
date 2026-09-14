// v5 §1 candidate 5: fail-loud pre-flight for a chain config, before any
// metered call. Three checks, each with an actionable fix naming the real
// file. The "every model is priced" check two labs (GLM, Kimi) flagged is
// deliberately excluded - that's the already-logged v4 unpriced-model
// defect, not new scope for this candidate.
import { providerNames } from './providers.js';
import { validateSeatRole } from './seat-role.js';
import { ALLOWED_TOOLS } from './tools.js';

const KNOWN_SEAT_KEYS = ['criteria', 'builder', 'reviser', 'finalist', 'skeleton', 'handoff', 'questions', 'judge', 'proposers', 'critics', 'challenger'];

/**
 * Lint findings for a chain config, each `{ kind, message, fix }`. Never
 * throws - a malformed config just produces findings, same as any other
 * lint issue. Empty array means the chain passed.
 */
export function lintChain(config, filePath = '<chain>') {
  const findings = [];
  const seats = config?.seats || {};

  // 1. Missing stage contract: a seat under an unrecognized key is wired to
  // no stage at all - chain.js only ever reads the known keys, so a typo'd
  // key (e.g. "critic" instead of "critics") silently never runs, and the
  // chain author has no way to notice short of reading chain.js itself.
  for (const key of Object.keys(seats)) {
    if (!KNOWN_SEAT_KEYS.includes(key)) {
      findings.push({
        kind: 'missing-stage-contract',
        message: `seats.${key} is not a recognized stage seat and will never run.`,
        fix: `Rename "seats.${key}" to one of: ${KNOWN_SEAT_KEYS.join(', ')} in ${filePath}, or remove it if it isn't meant to run.`,
      });
    }
  }

  // 2. Unreachable stage: the critique/panel round needs at least one
  // critic seat. Missing crashes the run outright (chain.js reads
  // config.seats.critics.length unconditionally); an empty array either
  // crashes (round-robin signoff, a divide-by-zero index) or trivially
  // "passes" with nothing actually reviewed (unanimous signoff, vacuously
  // true over zero critics) - both are a review stage nobody can reach.
  if (!Array.isArray(seats.critics) || seats.critics.length === 0) {
    findings.push({
      kind: 'unreachable-stage',
      message: `seats.critics is missing or empty, so the critique/panel round can never run a real review.`,
      fix: `Add at least one seat to "seats.critics" in ${filePath}, e.g. { "provider": "anthropic", "model": "claude-sonnet-5" }.`,
    });
  }

  // 3. Missing tool reference: a seat naming a provider this codebase
  // doesn't know fails at call time with "Unknown provider" - worth
  // catching before spending, not after the first API call.
  const allSeats = [
    seats.criteria, seats.builder, seats.reviser, seats.finalist, seats.skeleton,
    seats.handoff, seats.questions, seats.judge, seats.challenger,
    ...(seats.proposers || []), ...(seats.critics || []),
  ].filter(Boolean);
  const known = new Set([...providerNames(), 'mock', 'external']);
  const seenUnknown = new Set();
  for (const s of allSeats) {
    if (s.provider && !known.has(s.provider) && !seenUnknown.has(s.provider)) {
      seenUnknown.add(s.provider);
      findings.push({
        kind: 'missing-tool-reference',
        message: `a seat references an unrecognized provider "${s.provider}".`,
        fix: `Check the spelling against a known provider (${[...known].join(', ')}) in ${filePath}, or add "${s.provider}" to src/providers.js if it's meant to be new.`,
      });
    }
  }

  // 4. Invalid seat role (v6 §1): an unknown `role.lens`, a `role.persona`
  // of the wrong type, an empty `role: {}`, or a stray field on `role`
  // would otherwise only surface as a wrong or missing debate-stage
  // prompt, silently, well after the config was accepted.
  for (const s of allSeats) {
    if (!s.role) continue;
    for (const problem of validateSeatRole(s.role)) {
      findings.push({
        kind: 'invalid-seat-role',
        message: `a seat's role is invalid: ${problem}`,
        fix: `Fix "role" on the affected seat in ${filePath}. A role is optional; set either "lens" (one of the fixed enum values) or "persona" (a string), or both, or omit "role" entirely.`,
      });
    }
  }

  // 5. Role on a seat kind that never reaches the debate stage (v6 phase
  // 7 bug-audit fix): chain.js's debate stage looks a seat's role up
  // exclusively via seats.proposers - a role set on any other seat kind
  // (criteria, builder, reviser, finalist, skeleton, handoff, questions,
  // judge, critics) is accepted by validateSeatRole but has no effect at
  // all, silently, since nothing ever reads it there.
  const nonProposerSeats = [
    ['criteria', seats.criteria], ['builder', seats.builder], ['reviser', seats.reviser],
    ['finalist', seats.finalist], ['skeleton', seats.skeleton], ['handoff', seats.handoff],
    ['questions', seats.questions], ['judge', seats.judge],
    ...(seats.critics || []).map(s => ['critics', s]),
  ];
  for (const [kind, s] of nonProposerSeats) {
    if (s?.role) {
      findings.push({
        kind: 'role-on-non-proposer-seat',
        message: `seats.${kind} has a "role" set, but only seats.proposers ever reach the debate stage where a role has any effect - this role is a silent no-op.`,
        fix: `Move "role" to the matching seat under "seats.proposers" in ${filePath}, or remove it from seats.${kind} if it was set by mistake.`,
      });
    }
  }

  // 6. Challenge stage (v7 item 5): `challenge.enabled` is the only key this
  // chain reads. The one-challenge, one-decision bound is the whole point of
  // the mechanism - the narrowness of the re-open is the decay mitigation -
  // so it is hard-coded in chain.js, never a config number. Any attempt to
  // make it tunable (a max-challenges count, extra rounds, anything besides
  // `enabled`) must fail here rather than silently do nothing.
  if (config?.challenge && typeof config.challenge === 'object') {
    for (const key of Object.keys(config.challenge)) {
      if (key !== 'enabled') {
        findings.push({
          kind: 'invalid-challenge-config',
          message: `challenge.${key} is not a recognized key - only "challenge.enabled" is exposed.`,
          fix: `Remove "challenge.${key}" from ${filePath}. The one-challenge, one-round bound is hard-coded and intentionally not configurable.`,
        });
      }
    }
    if ('enabled' in config.challenge && typeof config.challenge.enabled !== 'boolean') {
      findings.push({
        kind: 'invalid-challenge-config',
        message: `challenge.enabled must be a boolean.`,
        fix: `Set "challenge.enabled" to true or false in ${filePath}.`,
      });
    }
  }

  // 7. Resource allocator (v7.3): disagreement-targeted rounds, gated on
  // `allocator.enabled`. Only `enabled`, `tools` and `cwd` are read - unlike
  // challenge's single-key surface, this stage needs a way to name which
  // sandboxed tool applies to which contested claim, so `tools` is exposed
  // deliberately (each entry a fixed-shape {tool, args?, keywords} - never a
  // free-form command). Requires `signoff: "unanimous"`: the disagreement
  // signal this stage targets (a criterion some panel critics failed and
  // others didn't) only exists when every critic reviews every round: the
  // round-robin signoff path runs one critic per round and has no per-round
  // split to detect. Silently doing nothing on a round-robin chain would be
  // exactly the kind of "config key with no path to run" chain-lint's own
  // check 1 already exists to catch, so this is a hard-fail, not a no-op.
  if (config?.allocator && typeof config.allocator === 'object') {
    const ALLOCATOR_KEYS = ['enabled', 'tools', 'cwd'];
    for (const key of Object.keys(config.allocator)) {
      if (!ALLOCATOR_KEYS.includes(key)) {
        findings.push({
          kind: 'invalid-allocator-config',
          message: `allocator.${key} is not a recognized key - only ${ALLOCATOR_KEYS.map(k => `"${k}"`).join(', ')} are exposed.`,
          fix: `Remove "allocator.${key}" from ${filePath}.`,
        });
      }
    }
    if ('enabled' in config.allocator && typeof config.allocator.enabled !== 'boolean') {
      findings.push({
        kind: 'invalid-allocator-config',
        message: `allocator.enabled must be a boolean.`,
        fix: `Set "allocator.enabled" to true or false in ${filePath}.`,
      });
    }
    if (config.allocator.enabled === true && config.signoff !== 'unanimous') {
      findings.push({
        kind: 'invalid-allocator-config',
        message: `allocator.enabled requires "signoff": "unanimous" - the disagreement signal it targets (a criterion split across the panel) does not exist under round-robin signoff.`,
        fix: `Set "signoff": "unanimous" in ${filePath}, or remove "allocator" if this chain is meant to stay round-robin.`,
      });
    }
    if (config.allocator.tools !== undefined) {
      if (!Array.isArray(config.allocator.tools)) {
        findings.push({
          kind: 'invalid-allocator-config',
          message: `allocator.tools must be an array.`,
          fix: `Set "allocator.tools" to an array of { tool, args?, keywords } in ${filePath}, or omit it.`,
        });
      } else {
        config.allocator.tools.forEach((spec, i) => {
          if (!spec || !ALLOWED_TOOLS.includes(spec.tool)) {
            findings.push({
              kind: 'invalid-allocator-config',
              message: `allocator.tools[${i}] names an unrecognized tool "${spec?.tool}" - only ${ALLOWED_TOOLS.join(', ')} are on the sandboxed allowlist.`,
              fix: `Fix "allocator.tools[${i}].tool" in ${filePath} to one of: ${ALLOWED_TOOLS.join(', ')}.`,
            });
          }
          if (!Array.isArray(spec?.keywords) || !spec.keywords.length || !spec.keywords.every(k => typeof k === 'string' && k)) {
            findings.push({
              kind: 'invalid-allocator-config',
              message: `allocator.tools[${i}].keywords must be a non-empty array of strings - it decides which contested criterion this tool fires on.`,
              fix: `Add "keywords": ["..."] to allocator.tools[${i}] in ${filePath}.`,
            });
          }
        });
      }
    }
  }

  return findings;
}
