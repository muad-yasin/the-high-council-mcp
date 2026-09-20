// v5 §1 candidate 5: fail-loud pre-flight for a chain config, before any
// metered call. Three checks, each with an actionable fix naming the real
// file. The "every model is priced" check two labs (GLM, Kimi) flagged is
// deliberately excluded - that's the already-logged v4 unpriced-model
// defect, not new scope for this candidate.
import { providerNames } from './providers.js';
import { validateSeatRole } from './seat-role.js';
import { ALLOWED_TOOLS } from './tools.js';
import { priceOf } from './cost.js';
import { findSeatByLab, labOf } from './chain.js';

// Labs the source procurement report names as not EU-based (v7.x compliance
// chains). Used only to enforce an EU-region compliance claim against the
// seats that would violate it - not a general allow/deny list.
const NON_EU_PROVIDERS = ['deepseek', 'zai'];

const KNOWN_SEAT_KEYS = ['criteria', 'builder', 'reviser', 'finalist', 'skeleton', 'handoff', 'questions', 'judge', 'proposers', 'critics', 'challenger', 'ambiguity', 'coldRead', 'security_reviewer'];

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
    seats.handoff, seats.questions, seats.judge, seats.challenger, seats.security_reviewer,
    ...(seats.proposers || []), ...(seats.critics || []), ...(seats.ambiguity || []),
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

  // 6b. Cold-reader coherence check (harness features v6 item A/6): coldRead.enabled is
  // the only key this chain reads, same narrow stance as challenge above - no sub-config,
  // so nothing beyond boolean-ness is validated here.
  if (config?.coldRead && typeof config.coldRead === 'object') {
    for (const key of Object.keys(config.coldRead)) {
      if (key !== 'enabled') {
        findings.push({
          kind: 'invalid-cold-read-config',
          message: `coldRead.${key} is not a recognized key - only "coldRead.enabled" is exposed.`,
          fix: `Remove "coldRead.${key}" from ${filePath}. The single fresh-seat, zero-context call is hard-coded and intentionally not configurable.`,
        });
      }
    }
    if ('enabled' in config.coldRead && typeof config.coldRead.enabled !== 'boolean') {
      findings.push({
        kind: 'invalid-cold-read-config',
        message: `coldRead.enabled must be a boolean.`,
        fix: `Set "coldRead.enabled" to true or false in ${filePath}.`,
      });
    }
  }

  // 6c. Final security review (src/security-review.js): `security_review.enabled` is the only key
  // read. The blocking severities are hard-coded there on purpose, so a chain cannot loosen its
  // own gate - any other key here would silently do nothing, so it fails instead. A
  // seats.security_reviewer in a chain that never enables the stage is a seat that never runs,
  // the same class of silent no-op check 1 exists for.
  if (config?.security_review !== undefined) {
    if (!config.security_review || typeof config.security_review !== 'object' || Array.isArray(config.security_review)) {
      findings.push({
        kind: 'invalid-security-review-config',
        message: `security_review must be an object like { "enabled": true }.`,
        fix: `Set "security_review" to { "enabled": true } or remove it in ${filePath}.`,
      });
    } else {
      for (const key of Object.keys(config.security_review)) {
        if (key !== 'enabled') {
          findings.push({
            kind: 'invalid-security-review-config',
            message: `security_review.${key} is not a recognized key - only "security_review.enabled" is exposed.`,
            fix: `Remove "security_review.${key}" from ${filePath}. The blocking severities are fixed in src/security-review.js, not a chain setting.`,
          });
        }
      }
      if ('enabled' in config.security_review && typeof config.security_review.enabled !== 'boolean') {
        findings.push({
          kind: 'invalid-security-review-config',
          message: `security_review.enabled must be a boolean.`,
          fix: `Set "security_review.enabled" to true or false in ${filePath}.`,
        });
      }
    }
  }
  if (seats.security_reviewer && config?.security_review?.enabled !== true) {
    findings.push({
      kind: 'unreachable-stage',
      message: `seats.security_reviewer is set but security_review.enabled is not true, so the security-review stage never runs.`,
      fix: `Add "security_review": { "enabled": true } to ${filePath}, or remove "seats.security_reviewer".`,
    });
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

  // 8. Compliance chain metadata (v7.x, procurement readiness): an optional
  // top-level `compliance: { regions: [...], providers: [...] }` on the four
  // shipped compliance chains (eu-only, us-only, single-vendor-*). Absent on
  // every other chain, so this whole check is a no-op for them - the same
  // opt-in shape as challenge/allocator above. A compliance chain's
  // description is a claim a procurement reviewer reads and trusts, so it
  // must actually match what the seats do, not just what the author wrote.
  if (config?.compliance && typeof config.compliance === 'object') {
    const COMPLIANCE_KEYS = ['regions', 'providers'];
    for (const key of Object.keys(config.compliance)) {
      if (!COMPLIANCE_KEYS.includes(key)) {
        findings.push({
          kind: 'invalid-compliance-config',
          message: `compliance.${key} is not a recognized key - only ${COMPLIANCE_KEYS.map(k => `"${k}"`).join(', ')} are exposed.`,
          fix: `Remove "compliance.${key}" from ${filePath}.`,
        });
      }
    }

    const declaredProviders = new Set(config.compliance.providers || []);
    const declaredRegions = new Set(config.compliance.regions || []);
    const actualProviders = new Set(allSeats.map(s => s.provider).filter(Boolean));
    const description = config.description || '';

    for (const p of declaredProviders) {
      if (!actualProviders.has(p)) {
        findings.push({
          kind: 'invalid-compliance-config',
          message: `compliance.providers names "${p}", but no seat in this chain uses it.`,
          fix: `Remove "${p}" from "compliance.providers" in ${filePath}, or add a seat that uses it.`,
        });
      }
    }
    for (const p of actualProviders) {
      if (!declaredProviders.has(p)) {
        findings.push({
          kind: 'invalid-compliance-config',
          message: `a seat uses provider "${p}", but "compliance.providers" doesn't name it - a compliance chain must declare every provider it actually touches.`,
          fix: `Add "${p}" to "compliance.providers" in ${filePath}.`,
        });
      }
    }
    for (const p of declaredProviders) {
      if (!description.includes(p)) {
        findings.push({
          kind: 'invalid-compliance-config',
          message: `compliance.providers names "${p}", but the chain's own "description" doesn't mention it.`,
          fix: `Name "${p}" in the "description" field of ${filePath} - a compliance chain's description is a claim about what it touches and must say so in prose, not only in config.`,
        });
      }
    }
    for (const r of declaredRegions) {
      if (!description.includes(r)) {
        findings.push({
          kind: 'invalid-compliance-config',
          message: `compliance.regions names "${r}", but the chain's own "description" doesn't mention it.`,
          fix: `Name "${r}" in the "description" field of ${filePath}.`,
        });
      }
    }

    // Every seat in a compliance chain must be priced: an unpriced seat is
    // uncapped (src/cost.js's priceOf), an unaccountable-spend gap a
    // procurement-facing chain must not carry.
    for (const s of allSeats) {
      if (s.provider && known.has(s.provider) && s.provider !== 'mock' && s.provider !== 'external' && !priceOf(s.provider, s.model)) {
        findings.push({
          kind: 'invalid-compliance-config',
          message: `a seat uses ${s.provider}/${s.model}, which has no entry in src/pricing.json - a compliance chain must have every seat priced.`,
          fix: `Add "${s.provider}/${s.model}" to src/pricing.json, or use a priced model in ${filePath}.`,
        });
      }
    }

    // A region claim of "EU" is a claim no seat routes through a non-EU lab.
    if (declaredRegions.has('EU')) {
      for (const s of allSeats) {
        if (NON_EU_PROVIDERS.includes(s.provider)) {
          findings.push({
            kind: 'invalid-compliance-config',
            message: `compliance.regions claims "EU", but a seat uses "${s.provider}", which is not an EU-based lab.`,
            fix: `Remove the "${s.provider}" seat from ${filePath}, or drop "EU" from "compliance.regions" if this chain isn't actually EU-only.`,
          });
        }
      }
    }
  }

  // 9. Roster overrides (item 5/6 of relay/runs/2026-09-14T14-56-18-834Z/
  // deliverable.md): `roster.criteria_seat` is a seat-selection override -
  // it must resolve to a real seat's lab/provider id somewhere in this
  // chain, or the criteria stage fails at call time instead of at lint
  // time. `roster.minimal_two_strong` is the gate a two-strong chain sets
  // so this file can assert it never also declares a five-seat critic
  // roster - checked here, not in chain.js, so the rule applies only to a
  // chain that opts in and never touches a chain that doesn't.
  const ROSTER_KEYS = ['criteria_seat', 'minimal_two_strong'];
  if (config?.roster && typeof config.roster === 'object') {
    for (const key of Object.keys(config.roster)) {
      if (!ROSTER_KEYS.includes(key)) {
        findings.push({
          kind: 'invalid-roster-config',
          message: `roster.${key} is not a recognized key - only ${ROSTER_KEYS.map(k => `"${k}"`).join(', ')} are exposed.`,
          fix: `Remove "roster.${key}" from ${filePath}.`,
        });
      }
    }
    if ('criteria_seat' in config.roster) {
      if (typeof config.roster.criteria_seat !== 'string' || !config.roster.criteria_seat) {
        findings.push({
          kind: 'invalid-roster-config',
          message: `roster.criteria_seat must be a non-empty string naming a seat's lab/provider id.`,
          fix: `Set "roster.criteria_seat" to a lab/provider id that matches one of this chain's seats in ${filePath}.`,
        });
      } else if (!findSeatByLab(config, config.roster.criteria_seat)) {
        findings.push({
          kind: 'invalid-roster-config',
          message: `roster.criteria_seat "${config.roster.criteria_seat}" does not match any seat's lab/provider in this chain.`,
          fix: `Fix "roster.criteria_seat" in ${filePath} to a lab/provider id present among this chain's seats (its "lab" field, or its "provider" if "lab" is unset).`,
        });
      }
    }
    if ('minimal_two_strong' in config.roster) {
      if (typeof config.roster.minimal_two_strong !== 'boolean') {
        findings.push({
          kind: 'invalid-roster-config',
          message: `roster.minimal_two_strong must be a boolean.`,
          fix: `Set "roster.minimal_two_strong" to true or false in ${filePath}.`,
        });
      } else if (config.roster.minimal_two_strong === true && Array.isArray(seats.critics) && seats.critics.length >= 5) {
        findings.push({
          kind: 'invalid-roster-config',
          message: `roster.minimal_two_strong is set but seats.critics has ${seats.critics.length} seats - a five-seat critic roster defeats the point of a minimal two-strong chain.`,
          fix: `Trim "seats.critics" in ${filePath} to a small adjudicator roster, or remove "roster.minimal_two_strong".`,
        });
      }
    }
  }

  // 10. schemaVersion (v8 item (b), part 2): optional integer, defaulted to 1 when absent so
  // every chain file already in chains/ keeps validating and running unmodified - config is
  // data, optional with a documented default, never a required field that breaks an existing
  // caller. Type/range enforcement lives in config/chain-schema.json (checked by
  // test/chain-schema.test.js), not here - this only reads and defaults the value; no
  // version-dependent behaviour exists yet for it to gate.
  if ('schemaVersion' in (config || {}) && !Number.isInteger(config.schemaVersion)) {
    findings.push({
      kind: 'invalid-schema-version',
      message: `schemaVersion must be an integer when present (got ${JSON.stringify(config.schemaVersion)}).`,
      fix: `Set "schemaVersion" to an integer (e.g. 1) in ${filePath}, or omit it - absence defaults to 1.`,
    });
  }

  // 11. Inert verify.tools (v8 item (b), part 3): the real incident this rule exists for is
  // MLLM Coder v3 item 2 - a chain specced `verify.tools` entries meant to fact-check a diff,
  // but `runVerification` runs before any change-request/diff exists in that chain's real
  // stage order (proposals -> debate -> build), so the entries were inert from the moment the
  // config was written; a human reading chain.js caught it, not the config or any check. This
  // is a config-shape check only, scoped to what the config alone can prove: a chain with no
  // `proposals` stage and no seat that could produce a build/diff (`seats.builder`) has nothing
  // upstream of verify that could plausibly generate the diff-shaped artifact a verify.tools
  // entry would fact-check. Named plainly: lintChain has no warn/error severity tier (every
  // finding here is fatal per src/cli.js's own "has N problem(s) and will not run" gate, same
  // as this file's other 10 rules) - adding one would be a chain.js/cli.js engine change beyond
  // this item's scope, so this rule fires only on the narrow, provable case above, never on a
  // chain that intends to always run with --draft (that path supplies the diff at the CLI,
  // outside what a static config-shape lint can see, and is exactly why the rule requires BOTH
  // no proposals AND no builder rather than firing on verify.tools alone). Deliberately narrow:
  // one concrete rule for the one recorded incident, not a general stage-dependency grammar
  // (out of scope - see deep-research-v8-directional-followup-2026-09-15.md §2.4(a)'s own
  // conclusion against an open stage/dependency system).
  if (config?.verify?.enabled && Array.isArray(config.verify.tools) && config.verify.tools.length > 0) {
    if (!config.proposals && !seats.builder) {
      findings.push({
        kind: 'inert-verify-tools',
        message: `verify.tools is non-empty, but this chain has no "proposals" stage and no "seats.builder" - nothing in the config produces a diff/change-request for verify to check before it runs.`,
        fix: `Add "proposals" and/or a "seats.builder" seat to ${filePath} if verify.tools is meant to check a diff this chain builds, or remove "verify.tools" if this chain is always run with --draft (a diff supplied at the CLI, invisible to this static check).`,
      });
    }
  }

  // 11b. Dispute stage (2026-09-20): `enabled` and `stall_rounds` are the only keys chain.js
  // reads. Same narrow stance as challenge/coldRead - a key that silently does nothing is the
  // failure check 1 exists for. Requires `signoff: "unanimous"`, for the same reason the
  // allocator does: the stall signal is "the same (criterion, lab) objections for N rounds",
  // and round-robin runs one critic per round, so that set cannot be compared across rounds.
  if (config?.dispute !== undefined) {
    if (!config.dispute || typeof config.dispute !== 'object' || Array.isArray(config.dispute)) {
      findings.push({
        kind: 'invalid-dispute-config',
        message: `dispute must be an object like { "enabled": true, "stall_rounds": 2 }.`,
        fix: `Set "dispute" to { "enabled": true } or remove it in ${filePath}.`,
      });
    } else {
      const DISPUTE_KEYS = ['enabled', 'stall_rounds'];
      for (const key of Object.keys(config.dispute)) {
        if (!DISPUTE_KEYS.includes(key)) {
          findings.push({
            kind: 'invalid-dispute-config',
            message: `dispute.${key} is not a recognized key - only ${DISPUTE_KEYS.map(k => `"${k}"`).join(', ')} are exposed.`,
            fix: `Remove "dispute.${key}" from ${filePath}. The dispute stage runs once and never re-opens the vote; that bound is hard-coded, not a setting.`,
          });
        }
      }
      if ('enabled' in config.dispute && typeof config.dispute.enabled !== 'boolean') {
        findings.push({
          kind: 'invalid-dispute-config',
          message: `dispute.enabled must be a boolean.`,
          fix: `Set "dispute.enabled" to true or false in ${filePath}.`,
        });
      }
      if ('stall_rounds' in config.dispute
        && (!Number.isInteger(config.dispute.stall_rounds) || config.dispute.stall_rounds < 2)) {
        findings.push({
          kind: 'invalid-dispute-config',
          message: `dispute.stall_rounds must be an integer of at least 2 (got ${JSON.stringify(config.dispute.stall_rounds)}) - "the same objections twice" is the minimum evidence that a disagreement is not moving.`,
          fix: `Set "dispute.stall_rounds" to 2 or more in ${filePath}, or omit it to use the default of 2.`,
        });
      }
      if (config.dispute.enabled === true && config.signoff !== 'unanimous') {
        findings.push({
          kind: 'invalid-dispute-config',
          message: `dispute.enabled requires "signoff": "unanimous" - the stall signal it watches (the same criterion/lab objections across rounds) does not exist under round-robin signoff, which asks one critic per round.`,
          fix: `Set "signoff": "unanimous" in ${filePath}, or remove "dispute".`,
        });
      }
    }
  }

  // 12. Self-review: the builder's or reviser's own lab sitting on the critic
  // panel. The real incident is the cheap-7 run of 2026-09-20, where one lab
  // (Sonnet 5) wrote the criteria, the skeleton, the draft and every revision
  // AND held a critic seat - so it voted on its own work, and a false claim
  // survived to the deliverable. Under `signoff: "unanimous"` that vote is not
  // advisory: every critic must sign off on the same draft, so the builder's
  // lab holds a real veto over objections to its own text, and the panel's
  // independence - the one property this harness exists to measure - is
  // quietly not what the config appears to promise.
  //
  // Keys on labOf (imported from chain.js, never re-implemented here), never
  // on `provider`: three OpenRouter seats are three labs, and the mock chains
  // deliberately put several labs on one provider. Keying on provider would
  // fire on every mock chain and miss the real case entirely.
  //
  // Scoped to `signoff: "unanimous"` on purpose, same narrowness as check 11.
  // Verified against all 42 shipped chains on 2026-09-20: exactly one fails
  // (cheap-7.json, the chain the incident came from, replaced by cheap-7-v2).
  // Under round-robin signoff one critic reviews per round and there is no
  // veto to capture, and `single-vendor-anthropic/openai.json` are deliberately
  // single-lab compliance chains that would fire on every run - so widening
  // this past unanimous means annotating those first, not just dropping the
  // condition here.
  //
  // The escape is an explicit, greppable `"selfReview": "allowed"` at the top
  // level, so a chain that really wants this has said so in writing and `grep
  // -r selfReview chains/` lists every one. No shipped chain uses it.
  if (config?.signoff === 'unanimous' && Array.isArray(seats.critics) && config?.selfReview !== 'allowed') {
    const criticLabs = new Set(seats.critics.filter(Boolean).map(labOf));
    for (const kind of ['builder', 'reviser']) {
      const seat = seats[kind];
      if (seat && criticLabs.has(labOf(seat))) {
        findings.push({
          kind: 'self-review',
          message: `seats.${kind} is lab "${labOf(seat)}", which also holds a seat on the critic panel - under unanimous signoff that lab votes on, and can veto objections to, its own draft.`,
          fix: `Remove the "${labOf(seat)}" seat from "seats.critics" in ${filePath} so the panel is independent of the author, or move seats.${kind} to a lab that is not on the panel. If this chain genuinely wants a lab reviewing its own work, add "selfReview": "allowed" at the top level of ${filePath} and say why in its "description".`,
        });
      }
    }
  }
  if ('selfReview' in (config || {}) && config.selfReview !== 'allowed') {
    findings.push({
      kind: 'self-review',
      message: `selfReview must be the exact string "allowed" when present (got ${JSON.stringify(config.selfReview)}) - any other value silently reads as "not allowed".`,
      fix: `Set "selfReview": "allowed" in ${filePath}, or remove the key entirely.`,
    });
  }

  return findings;
}
