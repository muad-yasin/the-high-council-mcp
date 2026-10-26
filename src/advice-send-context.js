// The ONE place the advice send path's context is composed (0.8.3 ROADMAP 77, step 3; plan note Review/Build_0.8.3/m7/Roadmap77_Paid_Repair_Plan_Note_2026-10-20.md section 9, 6d's order of 20 Okt). Moved out of `registerAdviceTools`
// (src/mcp/advice.js) UNCHANGED, so that the MCP server and the tree's decide form reach `createSendPath` (src/send-path.js) through the same composition: one quote -> approve -> start path (CLAUDE.md). Nothing here is new behaviour.
// What the CALLER supplies is what only it has: `loadChain`, `spawnRun` (how a run is started: the MCP server spawns src/cli.js detached), `nextRunId`, `usdLimit`. What this builds is what the send path needs beside them: the in-memory masks of live
// runs, the runs this process started, the quote time-to-live, and the one writer of a client's STOP request.
// -> { masks, maskAt, ownRuns, ttlMs, stopRun, sendPath }.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readStopRequest, writeStopRequest } from './stop-files.js';
import { createSendPath, QUOTE_TTL_MS } from './send-path.js';

export function createAdviceSendContext({ work, runsDir, env = process.env, loadChain, spawnRun, nextRunId, usdLimit = null }) {
  const masks = new Map();
  const maskAt = new Map();
  const ownRuns = new Set();
  // Ten minutes; the environment can shorten it (a test seam, not a setting anyone needs).
  const ttlMs = Number(env.COUNCIL_ADVISE_QUOTE_TTL_MS) > 0 ? Number(env.COUNCIL_ADVISE_QUOTE_TTL_MS) : QUOTE_TTL_MS;
  // 13 Oct 2026 (late-window cancel): the ONE writer of a client's STOP request, defined before createSendPath so the send path can arm it at the point the start becomes irrevocable.
  // A client that cancels, or leaves, stops the advice runs this server started and that are still going: a run whose
  // client is gone otherwise spends to its own ceiling and nobody collects it. The calls in flight finish (they are billed either
  // way) and the optional stages are skipped; what was paid for stays on disk. Brief 29, step 6.
  const stopRun = (id, why) => {
    // A STOP request (src/stop-files.js), by the client: the run ends at exit 18 with what it paid for (0.8.1 M6). Silent on failure on
    // purpose: this also runs while the process exits, and a run that cannot be told to stop still ends at its own ceiling (advise.usd) or, when its chain sets one, its wall clock.
    // The first STOP written stays (13 Oct 2026, J1-13-1): the writer stays quiet exactly when the READER would stop the run anyway (readStopRequest: a request for ANOTHER run is stale and reads as none, so it is replaced; a corrupt one reads as
    // the person's, so it stays). The listener now stays armed for the whole call, so a person's own `council stop` (by user) can already be on disk when the cancel fires; a later write replaced who stopped the run (the handler's own later stopRun did
    // too, before this). A second client cancel for the same run changes nothing either: its first note says where it fired.
    try { if (existsSync(join(runsDir, id)) && !existsSync(join(runsDir, id, 'report.json')) && readStopRequest(join(runsDir, id), id) === null) writeStopRequest(join(runsDir, id), { by: 'client_cancel', run: id, note: why }); } catch { /* the run folder is the truth */ }
  };
  const sendPath = createSendPath({ work, runsDir, env, loadChain, spawnRun, nextRunId, usdLimit, masks, maskAt, ownRuns, ttlMs, stopRun });
  return { masks, maskAt, ownRuns, ttlMs, stopRun, sendPath };
}
