// The exit codes of src/cli.js that END a layered or ordinary run, kept in ONE module because programs other than the CLI read them (src/mcp/server.js, and test/exit-codes.test.js pins the literals in src/tree-run.js and src/tree-resume.js).
// 22: the run FINISHED (deliverable and report.json written) and the panel did NOT agree (`passed` false in report.json). Reached only by falling off the end of the main run, or of --rematch / --replay; a tree MEMBER and an advice call keep 0.
// 23: a layered run STOPPED at the overseer-round cap or a layer's revision bound, RESUMABLE, waiting for the person's choice (--continue / --finish). It wrote report-partial.json and NO report.json, so it is not a finished run.
// 24: a run STOPPED because OpenRouter refused a seat at its price pin (src/price-refused.js), RESUMABLE, waiting for the person (a pricing.user.json row, then --resume; or --resume --skip-seat where the stage can do without the seat).
//     It wrote report-partial.json and NO report.json. An advice call has no resume: a refusal there is a failed call (exit 16) with the same sentence.
export const EXIT_NOT_AGREED = 22;
export const EXIT_ROUND_STOPPED = 23;
export const EXIT_PRICE_REFUSED = 24;
// 25: a layered run STOPPED because the conflict decider asked for the person to choose between objections (src/conflict-decider.js, E4b unit 3), RESUMABLE: `--resume <run folder> --prevail n=<id>|neither`. It wrote report-partial.json and NO report.json.
//     A plain resume only says so again, at $0. A tree member exits 25 too: its tree offers the choice (`council tree decide <tree> --prevail-node <node> --prevail ...`) and `council tree resume` applies it.
export const EXIT_CONFLICT_ASKED = 25;
// 26: a run is STOPPED at an excerpt approval (0.8.4 D10, plan A T5.5): a gate of kind excerpt_approval has no excerpts_recorded line, so the person has excerpts of their project to approve, edit or refuse and nothing may
//     go on until they have (`council gate answer <run> <gate>` at a terminal, then a plain --resume applies the answers). ONE code for ONE state, used by the stop AND by the refusal of a resume while the gate waits for the person or cannot be read
//     (src/gate.js excerptApprovalStops: with the privacy switch on an ANSWERED gate is applied by the next resume instead) (a plain --resume, resume_run, submit_stage), so automation can branch on it. THIS CONSTANT IS THE ONE the pause unit (with the excerpt extraction) uses for its stop: it must not mint another.
//     RESUMABLE once the answers are recorded; it wrote nothing new; nothing was spent. Not a finish (not in FINISHED_EXIT_CODES).
export const EXIT_AWAITING_EXCERPT_APPROVAL = 26;
// The codes that mean "the run FINISHED" (it wrote its artifacts; read report.json for how it ended), for the programs that SPAWN the CLI and must not read one of them as "never started" or "paused":
// 0 finished and agreed, 7 / 8 finished but the final security review blocked / could not judge it, 22 finished but the panel did not agree. 23 and 24 are NOT in this set (they are stops, not finishes); neither is 3 (an external seat).
export const FINISHED_EXIT_CODES = new Set([0, 7, 8, EXIT_NOT_AGREED]);
// 0.8.4 S20 slice 2 (control 1): `--next-pass-layer-3` on a resume RECORDS a request to start the next pass at layer 3 in the gate ledger and exits here: nothing was run, nothing was spent, and the run waits for the handler session's decision (`council route-decide`). Not 21 (a typed spending limit: the MCP turns it into a limit dialog) and not 0 (finished).
export const EXIT_ROUTE_REQUESTED = 27;
