// Cache-hit staleness detection (v2 plan §7.2, GLM-6 primary design with the scoped
// input-hash amendment MISTRAL-6/DEEPSEEK-6/QWEN-5 converged on).
//
// Same class of bug as the lab-dropout incident: a "successful" result is shown that does
// not correspond to a full, current execution. Stage caching replays a completed stage's
// output for free on resume - excellent when nothing changed, silently wrong when the task
// text or chain config changed between a pause and a resume. Nothing today checks that a
// cached answer still matches what would be asked now.
//
// Scope, deliberately narrow: the fingerprint covers the task's own text and the chain
// config - not the full --context document bundle, which would fire on every irrelevant
// context-doc edit and defeat the point of caching (this was an explicit board decision,
// not an oversight - see maintainers/DECISIONS.md).
import { createHash } from 'node:crypto';
import { withoutPriceLimits } from './price-limits.js';
import { withoutHostBlock } from './host-block.js';

/** A short fingerprint of the inputs a cached stage's validity depends on. */
export function fingerprintInputs(taskText, config) {
  // `summary` is a chain card's display line: no stage reads it, so editing it must not make a
  // resumed run read every finished stage as stale. A config without one hashes exactly as before.
  let forHash = config;
  if (config && typeof config === 'object' && 'summary' in config) { const { summary: _display, ...rest } = config; forHash = rest; }
  // 0.8.4 (the permanent ladder): the chain file's `ladder` key says which layer a pass STARTS at, never what a stage asked or answered, and the run's own numbers are saved in run.json at its start (a resume reads those). Editing the key must
  // not make a resumed run read every finished stage as stale. A config with no `ladder` hashes exactly as before.
  if (forHash && typeof forHash === 'object' && 'ladder' in forHash) { const { ladder: _ladderKey, ...rest } = forHash; forHash = rest; }
  // A seat's own price limit (extra.provider.max_price prompt/completion) filters hosts by price and changes nothing a finished stage said: raising it keeps the stages, like raising a pricing.user.json row.
  // A config with no limit hashes exactly as before (src/price-limits.js returns it unchanged). 0.8.3: a stage an older build wrote for a config that carries a limit reads as stale once.
  forHash = withoutPriceLimits(forHash);
  // 0.8.4 (Open Inference block): the slug is sent on every OpenRouter call whatever the config says (src/price-pin.js), so its entry in a seat's extra.provider.ignore changes nothing a finished stage said: a run paused on a chain
  // file without it resumes on one with it and keeps its stages. Any other edit of an ignore list still changes the fingerprint (src/host-block.js). A config with no such entry hashes exactly as before.
  forHash = withoutHostBlock(forHash);
  return createHash('sha256').update(JSON.stringify({ taskText, config: forHash })).digest('hex').slice(0, 12);
}

/**
 * The whole cache decision for one hit, in one pure function (wired into chain.js invoke(); it
 * replaced withStalenessCheck, which was exported and tested but never called - pre-release cache
 * audit, backlog). `hit` is what the cache returned: `staleInputs` is the CLI's task/config
 * fingerprint comparison, `inputsFingerprint` is present when the entry recorded one, `promptHash`
 * when it recorded the prompt it answered. Returns:
 *   { status: 'fresh' }                   - the same prompt; replay it
 *   { status: 'stale', why }             - re-run it (an external stage asks again)
 *   { status: 'unverified', why }        - trusted, but recorded as unverified (see below)
 *
 * Pre-release cache audit #1 (HIGH, Review/PreRelease_Audit_cache_2026-09-23.md): an entry with NO
 * record of its inputs at all (no fingerprint, no prompt hash - an external answer from before
 * 9733a8d) used to be trusted with a log line, so an edited chain replayed an old build answer into
 * deliverable.md. It is stale now. An entry from between the two fixes (a fingerprint, no prompt
 * hash) passed the coarse check and cannot be checked more finely; it is trusted and recorded.
 */
export function cacheVerdict(hit, promptHash) {
  if (hit.staleInputs) return { status: 'stale', why: 'the task text or chain config changed since it was cached', cause: 'inputs' };
  if (hit.promptHash) {
    return hit.promptHash === promptHash ? { status: 'fresh' }
      : { status: 'stale', why: 'it answered a different prompt than the one this stage is asked now', cause: 'prompt' };   // 0.8.4 T14 (CA2/D17): `cause` tells a changed prompt from the other stale reasons; only 'prompt' can be kept as it is when THC's wording changed (src/stale-guard.js decides); 'inputs' and 'no_record' are cache misses as before.
  }
  if (hit.inputsFingerprint) return { status: 'unverified', why: 'it was cached before prompt hashes were recorded; its task and chain still match, but not that it answered this exact prompt' };
  // `fromDisk` is set by the CLI's run-folder cache. An entry there with no record of its inputs is a
  // pre-fingerprint file and is stale. A caller's own in-memory cache (a direct runChain() caller,
  // the tests) records none by construction; its hits stay trusted, as unverified.
  if (hit.fromDisk) return { status: 'stale', why: 'it carries no record of what it answered (cached before input fingerprints existed)', cause: 'no_record' };
  return { status: 'unverified', why: 'the cache that supplied it records no fingerprint or prompt hash' };
}

// Pre-release audit 5 #1 (Review/PreRelease_Audit_ResumeCache_2026-09-23.md, HIGH): the stage cache
// was looked up by label alone. A seat that failed in one sitting left no cache file, ran live in the
// next and changed what later stages were asked - while those later stages replayed from disk
// against the old prompt. By a third sitting a cached round-2 sign-off on the old draft was replayed
// onto new text no critic had read, and the run finished passed=true. The fingerprint above cannot
// see that (task and config never changed), so every cached stage now also records a hash of the
// exact prompt it answered, and invoke() in chain.js treats a different prompt as a cache miss.
/** A short hash of the exact prompt (system + user) a stage was asked. */
export function promptHashOf(system, user) {
  return createHash('sha256').update(JSON.stringify([system ?? '', user ?? ''])).digest('hex').slice(0, 16);
}
/** The same hash, all 64 hex characters: what an audit line records for the exact prompt (brief 29). */
export function promptSha256Of(system, user) {
  return createHash('sha256').update(JSON.stringify([system ?? '', user ?? ''])).digest('hex');
}
