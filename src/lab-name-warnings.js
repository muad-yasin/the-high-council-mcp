// ONE MODEL UNDER TWO LAB NAMES: a warning (0.8.4, S7-03; his decision 12 of 28 Okt 2026: "Warn (Recommended)"; behind it his 18 Okt 2026 question "Where is the sense as a same model in seperate seats being counted as a different lab?").
// THC counts independent labs by LAB NAME (src/chain.js labOf: the seat's `lab`, else its provider). Lab names are free text, so one model seated twice under two names is counted as two labs. No lint compared seat identity
// across labs among the critics (the self-review rule compares the builder's and reviser's model with the panel; two models under ONE lab is `duplicate-lab`). This is a WARNING, never a lintChain finding: every lintChain finding
// reads "will not run" and also stops a paused run from resuming (lint runs on resume), which a warning about a name must not do. `council doctor --chain` prints these as WARNING: lines beside judgePersonaWarnings, and a run's FIRST start (not a resume) adds them to the same pre-flight list (src/cli.js: PRE-FLIGHT WARNING: in the run log, a `- pre_flight:` line in WARNINGS.md). Both read `.message` only.
//
// Contract (pure; no I/O; no model call):
//   modelLabWarnings(config) -> [{ message, identity, labs, seats }]   one entry per model that sits under two or more lab names among `config.seats.critics`, sorted by identity.
//     Which seats: the critics panel, in order. Seats that are not objects are skipped.
//     "One model": `IDENTITY(seat)` below, the repo's own rule for "is this the same agent" (src/chain.js seatIdentity: a seat's model with provider prefix and :variant dropped and lower case, so
//                  `anthropic/claude-sonnet-5` through OpenRouter and `claude-sonnet-5` direct are one model; an external seat is identified by its model string; mock seats have no identity and never match).
//     Lab name:    labOf(seat) (src/chain.js).
//     `seats`:     [{ path: 'seats.critics[<i>]', provider, model, lab }] of every seat of that model, in panel order. `labs`: the distinct lab names, in order of first appearance.
//   The same model under ONE lab (a layered panel seats it on several layers; the lab-identity unit allows it) is not a warning.
import { labOf, seatIdentity } from './chain.js';

const IDENTITY = seatIdentity;   // the one place the definition of "one model" lives

export function modelLabWarnings(config) {
  const critics = Array.isArray(config?.seats?.critics) ? config.seats.critics : [];
  const byModel = new Map();
  critics.forEach((seat, i) => {
    if (!seat || typeof seat !== 'object') return;
    const id = IDENTITY(seat);
    if (!id) return;
    if (!byModel.has(id)) byModel.set(id, []);
    byModel.get(id).push({ path: `seats.critics[${i}]`, provider: seat.provider, model: seat.model, lab: labOf(seat) });
  });
  const out = [];
  for (const [identity, seats] of byModel) {
    const labs = [...new Set(seats.map(s => s.lab))];
    if (labs.length < 2) continue;
    // A-DRAFT (Builder D, 4 Nov 2026): the words a person reads, for the one wording review.
    const where = seats.map(s => `${s.path} (${s.provider}/${s.model}, lab "${s.lab}")`).join('; ');
    out.push({ identity, labs, seats, message: `one model sits on judge seats under ${labs.length} lab names: ${where}. THC counts independent labs by lab name, so this one model counts as ${labs.length} labs. Give these seats one lab name, or seat a different model.` });
  }
  return out.sort((a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
}
