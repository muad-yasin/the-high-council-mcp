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
 * Wrap a base cache getter (label -> { text, inputsFingerprint, ... } | null) so that a
 * cache hit computed against different inputs than `currentFingerprint` is treated as a
 * miss - forcing chain.js to re-run that stage - rather than silently replayed as valid.
 * `onStale(label)` is called once per invalidated hit, for logging/warning side effects;
 * this module has no file or console dependency of its own, so it stays unit-testable.
 */
export function withStalenessCheck(baseGet, currentFingerprint, onStale = () => {}) {
  return label => {
    const cached = baseGet(label);
    if (!cached) return null;
    if (cached.inputsFingerprint && cached.inputsFingerprint !== currentFingerprint) {
      onStale(label);
      return null;
    }
    return cached;
  };
}
