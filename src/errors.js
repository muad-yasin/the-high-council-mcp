// v5 §1 candidate 4: a small, stable catalog of the codes this project's
// hard-fail paths actually hit, each with a one-line cause, a one-line
// fix naming a real file, and a doc pointer - documented in
// TROUBLESHOOTING.md, which every code here must also appear in (checked
// by test/errors.test.js).
//
// Tone, fixed by Muad from a concrete preview (2026-09-13): name what's
// wrong in plain words, explain what the missing concept IS in one line
// (not just that it's absent), blank line, then the concrete fix with a
// real path, then a doc pointer. No jargon the reader hasn't met yet. No
// apology, no personality, no exclamation marks - warm is not chatty.
// `formatCouncilError` enforces this shape mechanically so no call site
// can drift from it by writing its own message.

export const ERROR_CATALOG = {
  'COUNCIL-E001': {
    kind: 'degradable',
    title: 'Missing API key',
    render: ctx => ({
      what: `The "${ctx.provider}" API key isn't set, so chain "${ctx.chain}" can't call that lab.`,
      concept: `An API key is what proves to ${ctx.provider} that a request is yours to pay for - without it, every call to that lab fails before it starts.`,
      fix: `Set ${ctx.envVar} in your .env file.`,
      doc: 'README.md#setup',
    }),
  },
  'COUNCIL-E002': {
    kind: 'degradable',
    title: 'Unpriced model',
    render: ctx => ({
      what: `"${ctx.provider}/${ctx.model}" has no listed price, so its cost can't be shown or added to your spend total.`,
      concept: `A price is the per-token rate this program uses to add up what a run will cost before you pay for it.`,
      fix: `Add an entry for "${ctx.provider}/${ctx.model}" to src/pricing.json.`,
      doc: 'README.md#the-spend-cap',
    }),
  },
  'COUNCIL-E003': {
    kind: 'fatal',
    title: 'Malformed chain file',
    render: ctx => ({
      what: `The chain file "${ctx.path}" isn't valid JSON, so it can't be read at all.`,
      concept: `A chain file is the plain JSON config that says which models fill which seat - a syntax error anywhere in it stops the whole file from parsing.`,
      fix: `Check ${ctx.path} for a missing comma, bracket, or quote.`,
      doc: 'README.md#chains',
    }),
  },
  'COUNCIL-E004': {
    kind: 'degradable',
    title: 'Unreadable stage reply',
    render: ctx => ({
      what: `The reply from "${ctx.lab}" for stage "${ctx.label}" couldn't be read as the JSON this stage expects.`,
      concept: `A stage reply is one lab's structured answer for one step of the chain - an unreadable one is treated as an abstention, not a failure, so the run continues without it.`,
      fix: `Read the saved reply at ${ctx.file || 'runs/<id>/<label>.md'} to see what that lab actually returned.`,
      doc: 'TROUBLESHOOTING.md#council-e004',
    }),
  },
  'COUNCIL-E005': {
    kind: 'fatal',
    title: 'Policy refusal',
    render: ctx => ({
      what: ctx.parseError
        ? `The policy file "${ctx.path}" isn't valid JSON, so it can't be enforced at all.`
        : `Chain "${ctx.chain}" was refused by the policy file at "${ctx.path}": ${Array.isArray(ctx.reasons) ? ctx.reasons.join(' ') : ctx.reasons}`,
      concept: `A policy file is a locked, operator-set set of limits (allowed providers, regions, spend, required tags) checked before any provider is called - a run that would violate it never starts.`,
      fix: ctx.parseError
        ? `Fix the JSON syntax in ${ctx.path}.`
        : `Change the chain, or the policy file at ${ctx.path}, so this run no longer violates it.`,
      doc: 'docs/policy.md',
    }),
  },
};

/**
 * The full, tone-shaped message for `code`, filled with `ctx`. Throws if
 * `code` isn't in the catalog - a call site using an unknown code is a
 * bug in this codebase, not a user-facing condition.
 */
export function formatCouncilError(code, ctx = {}) {
  const entry = ERROR_CATALOG[code];
  if (!entry) throw new Error(`formatCouncilError: unknown code "${code}"`);
  const { what, concept, fix, doc } = entry.render(ctx);
  return `${code} [${entry.kind}] ${entry.title}\n${what} ${concept}\n\n${fix}\nSee: ${doc}`;
}

/**
 * An Error carrying a catalog `code` and its `kind` (degradable|fatal), so
 * a top-level catch can print the tone-shaped message and choose an exit
 * code without re-deriving either.
 */
export class CouncilError extends Error {
  constructor(code, ctx = {}) {
    super(formatCouncilError(code, ctx));
    this.code = code;
    this.kind = ERROR_CATALOG[code]?.kind;
    this.ctx = ctx;
  }
}
