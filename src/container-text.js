// T2-6 (audit, 13 Oct 2026; gate note E_Audit_Gate_Notes_reasked_T26.md): text a model or a person wrote is placed INSIDE a labelled container in a prompt (<deliverable>, <proposer-answer>, ...). If that text
// contains the container's own closing tag, whatever follows it reads as a new, top-level part of the prompt. This module is the ONE list of container tags and the ONE helper that keeps text inside its container.
//
// containerText(text): every "<" that STARTS a container tag (open or close, any case, spaces or invisible characters between "<", "/" and the name, an attribute after the name) becomes the visible "&lt;", so the span can no longer
// open or close a container. Nothing else is touched: a "<" that is not the start of one of these tags (code, generics, HTML of the deliverable) stays as written, so a reviewer still reads the deliverable's meaning.
// The change is MARKED, not reversible: an original "&lt;deliverable" in the text and an escaped "<deliverable" read the same afterwards; that is accepted (the reader is a model, and it sees the tag as text either way).
// Applied to the interpolated text only, never to the template around it. src/roles.js's own helpers (claimText, advisorText, writerText, boardText) predate this module and escape their own tags the same way; they are
// covered by test/container-text.test.js, which lists them. roles.js is pinned byte for byte (test/prompt-pin.test.js, re-recorded with T2-6 commit 2); its three formerly bare sites are wrapped, and test/container-text.test.js keeps KNOWN_BARE empty, so a new bare container fails the guard.

import { HIDDEN_CLASS_SOURCE } from './hidden-chars.js';
export const CONTAINER_TAGS = Object.freeze([
  'deliverable', 'proposer-answer', 'draft-before', 'draft-after',
  'critic-claim', 'prior-review', 'advisor-claim', 'writer-reason', 'changed-passage',
  'earlier-plan',
]);

// Between "<", "/" and the name a reader may be shown spaces, a no-break space, or an invisible character; all of them are matched, so none is a way around the escape.
const GAP = `[\\s${HIDDEN_CLASS_SOURCE}]*`;   // audit item 7: every character that renders as nothing (src/hidden-chars.js), not the four zero-width ones this once listed
const gapped = tags => `<(${GAP}/?${GAP})(${tags.join('|')})`;
const escapers = new Map(); // one global regex per tag list, built once (the lists are the few fixed ones of the callers)
const escaperFor = tags => {
  const key = tags.join('|');
  if (!escapers.has(key)) escapers.set(key, new RegExp(gapped(tags), 'giu'));
  return escapers.get(key);
};

/** The boundary a prompt reader could take for one of `tags`. Exported so a test can assert that no escaped output still matches it. */
export const tagStartFor = tags => new RegExp(gapped(tags), 'iu');
export const CONTAINER_TAG_START = tagStartFor(CONTAINER_TAGS);

/** `tags` defaults to all ten; the callers in src/roles.js that always escaped only their own wrapper's tags pass that same list, so what they defuse is unchanged except for the spelling gap. */
export function containerText(v, tags = CONTAINER_TAGS) {
  return `${v}`.replace(escaperFor(tags), '&lt;$1$2'); // `${v}` is what the bare template did: null and undefined read "null" / "undefined" as before, so an input without a container-tag span gives byte-identical prompt text
}
