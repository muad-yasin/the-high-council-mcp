// Identity in a recursive-councils tree (0.8.3 M1; PLAN 4.4 and D15). Pure and $0: no file, no clock, no model.
//
// Three kinds of identity, never mixed (PLAN 4.4):
//   - the LOGICAL NODE: a path of milestone ids from the root (`R`, `R/M2`, `R/M2/M1`) plus a generation (`g1`, `g2`...). It is assigned when a frontier is registered and is never written into any task text,
//     so two siblings with identical task text keep identical content hashes (the task hash means what it always meant).
//   - the RUN and ATTEMPT: the run folder id and attempt `a1` (one attempt per child), recorded in `node_registered`.
//   - the CONTENT HASHES the harness already has (task, criteria, checks, context, signed text); they keep their exact meaning.
// A FRONTIER is one set of children proposed from one parent split; its key is the sha256 of the canonical JSON of what defines it, so a replacement generation (opened by a recorded decision) is another frontier.
// An OBLIGATION has an identity apart from any child's positional criterion number (`C1`, `C2`... are positional), so it can be followed across generations and hops.
// The canonical form is src/thin-contract.js's (keys sorted at every depth, no whitespace, UTF-8): the one behind every hash in the harness.
import { canonicalJson, sha256Of } from './thin-contract.js';
import { oneLine } from './criteria-lock.js';

export const ROOT_NODE = 'R';
export const OBLIGATION_CLASSES = Object.freeze(['global', 'delegated', 'root-only']);

/** `R/M2@g1`: a logical node at one generation. The path part is made of milestone ids; the `@g` part is how a replacement is told from what it replaces. */
export const nodeKey = (node, generation) => `${node}@g${generation}`;

/** The node path of a child: its parent's path, a slash, its milestone id. */
export const childNode = (parentNode, milestoneId) => `${parentNode}/${milestoneId}`;
/** The depth of a node path: the root is 0 (`R` -> 0, `R/M2` -> 1, `R/M2/M1` -> 2). */
export const depthOf = node => String(node).split('/').length - 1;

/**
 * The frontier key: sha256 of the canonical JSON of { parentNode, parentGeneration, parentRunId, splitSha256, openedBy, children: [[node, generation], ...] }.
 * `openedBy` is the id of the `decision_recorded` event that opened these generations (null for a first frontier). The children are a set, so they are sorted: previewing the same split
 * twice in another order is the same frontier, and a frontier of replacement generations (other generations, another `openedBy`) is a different one and needs its own approval.
 */
export function frontierKey({ parentNode, parentGeneration, parentRunId, splitSha256, openedBy = null, children }) {
  if (!Array.isArray(children) || !children.length) throw new TypeError('frontierKey: children must be a non-empty list of { node, generation }');
  const pairs = children.map(c => [String(c.node), Number(c.generation)]);
  if (pairs.some(([n, g]) => !n || !Number.isInteger(g) || g < 1)) throw new TypeError('frontierKey: every child needs a node path and a generation of 1 or more');
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  return sha256Of(canonicalJson({ parentNode, parentGeneration, parentRunId, splitSha256, openedBy, children: pairs }));
}

/**
 * An obligation's identity: { originNode, originGeneration, originId, originClass, textSha256, form }.
 *   originId     the criterion id at the node whose locked list first held it (`C3`)
 *   originClass  its class there: global, delegated or root-only (PLAN 5.1)
 *   form         the item as that node held it: a string, or { criterion, kind, check, on } (pack A12)

 * `text` is the criterion's words; only the hash of their one-line form (src/criteria-lock.js oneLine, the collapse criteriaHash uses: the ONE place it is applied) is kept, so the identity stays small and a reworded copy has another identity (a child may add to an inherited obligation, never reword it).
 */
export function obligationIdentity({ originNode, originGeneration, originId, originClass, text, form }) {
  if (!OBLIGATION_CLASSES.includes(originClass)) throw new TypeError(`obligationIdentity: originClass is one of ${OBLIGATION_CLASSES.join(', ')}, got ${JSON.stringify(originClass)}`);
  if (typeof text !== 'string' || !text) throw new TypeError('obligationIdentity: the criterion text is required');
  return { originNode, originGeneration, originId, originClass, textSha256: sha256Of(oneLine(text)), form: form ?? text };
}

/** One short stable string for an obligation identity, to compare two of them (never shown as the obligation itself). */
export const obligationKey = identity => sha256Of(canonicalJson(identity));
