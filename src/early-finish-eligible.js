// ROADMAP 83 (the session's early-finish proposal) and 0.8.4 S4 (control 1, the floor): the two readers that must agree on WHEN a proposal is acted on, kept in one place.
// `earlyFinishEligible(config)` is the one predicate: a layered chain with overseer rounds, whose reviser (the builder when there is none) is the person's OWN session (provider "external"), with BOTH held sentences recorded. chain.js asks it before it
// acts on an `EARLY-FINISH` trailer line (the next pass then asks the overseer layer alone); the route entry (src/run-controls.js routeRefusal) asks it before it accepts a route, because a proposal acted on and a routed pass would both decide where the
// next pass starts. While either sentence is held the predicate is false: no proposal is acted on and no route is refused for it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { held } from './held-roles.js';
import { roundLimitsOf, isOverseerChain } from './overseer-rounds.js';
import { parseDisputes } from './draft-disputes.js';

export const earlyFinishEligible = config => {
  const critics = config?.seats?.critics || [];
  const layered = critics.length > 0 && critics.every(c => c.layer !== undefined);
  return layered && isOverseerChain(roundLimitsOf(config)) && (config?.seats?.reviser || config?.seats?.builder)?.provider === 'external' && !!held('reviserEarlyFinishNote') && !!held('earlyFinishAskSection');
};

/**
 * Does the reply that answered pass `pass` end with an `EARLY-FINISH` line? The answer is `revise-<pass>.md`, or `revise-<pass>-full.md` when a full rewrite replaced the patch reply (the session's final word is the one in the reply that became the draft; chain.js
 * reads it the same way). Read through parseDisputes, the parser chain.js uses. `files` = the run folder's file names. False when there is no such reply.
 */
export function earlyFinishProposedAfter(runDir, files, pass) {
  const name = [`revise-${pass}-full.md`, `revise-${pass}.md`].find(n => files.includes(n));
  if (!name) return false;
  return typeof parseDisputes(readFileSync(join(runDir, name), 'utf8')).earlyFinish === 'string';
}
