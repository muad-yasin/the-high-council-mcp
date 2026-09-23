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
// not an oversight - see DECISIONS.md).
import { createHash } from 'node:crypto';

/** A short fingerprint of the inputs a cached stage's validity depends on. */
export function fingerprintInputs(taskText, config) {
  return createHash('sha256').update(JSON.stringify({ taskText, config })).digest('hex').slice(0, 12);
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
  if (hit.staleInputs) return { status: 'stale', why: 'the task text or chain config changed since it was cached' };
  if (hit.promptHash) {
    return hit.promptHash === promptHash ? { status: 'fresh' }
      : { status: 'stale', why: 'it answered a different prompt than the one this stage is asked now' };
  }
  if (hit.inputsFingerprint) return { status: 'unverified', why: 'it was cached before prompt hashes were recorded; its task and chain still match, but not that it answered this exact prompt' };
  // `fromDisk` is set by the CLI's run-folder cache. An entry there with no record of its inputs is a
  // pre-fingerprint file and is stale. A caller's own in-memory cache (a direct runChain() caller,
  // the tests) records none by construction; its hits stay trusted, as unverified.
  if (hit.fromDisk) return { status: 'stale', why: 'it carries no record of what it answered (cached before input fingerprints existed)' };
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
