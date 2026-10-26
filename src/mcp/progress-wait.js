// The long-poll behind run_status (brief 26) and the advice hold, as a LEAF module: its readers, sleep and clock are injected, so a test can drive it with a scripted
// sequence (no process, no clock) and importing it registers no tool and reads no folder (src/mcp/server.js does both at module scope).
//
//   waitForProgress({ readStatus, readLog, sleep, now }, { seconds, since, until }, extra) -> { cursor, events, waitedMs, settled, status, timedOut, cancelled, usdSoFar }
//     readStatus() -> the run's derived status word        readLog() -> the stage-log lines so far (objects)
//     sleep(ms) -> a promise (200 ms between polls)         now() -> milliseconds (the clock of `waitedMs` and the time limit)
//     extra: the MCP request extra ({ _meta.progressToken, sendNotification, signal }) or undefined
//   until 'event' (default): return at the first new stage-log line. until 'settled': keep holding across new lines (each one still sends a progress notification
//   when the call has a progressToken) and return only when the run is no longer running or the time is up. One notification per poll in which the log GREW, with
//   `progress` = the line count (it must rise on every notification), so two growths inside one poll interval send ONE notification (that is the cadence the server's
//   own test no longer pins through two live processes).
export const POLL_MS = 200;

export async function waitForProgress({ readStatus, readLog, sleep, now = Date.now }, { seconds, since, until }, extra) {
  const t0 = now();
  const token = extra?._meta?.progressToken;
  const from = since ?? readLog().length;
  let sent = from;
  for (;;) {
    // Status first, then the log: a run that finishes between the two reads then shows all its lines.
    const status = readStatus();
    const log = readLog();
    const fresh = log.slice(from);
    const over = now() - t0 >= seconds * 1000;
    const aborted = !!extra?.signal?.aborted;
    // Progress notifications (MCP 2026-07-28 "progress"): only when the caller sent a progressToken. `progress` must rise on every notification, so it is the log line count, sent only when it grew.
    if (token !== undefined && log.length > sent && !aborted) {
      sent = log.length;
      try { await extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: log.length, message: `${log[log.length - 1].stage} done` } }); } catch { /* the call was cancelled or the client is gone: the answer below still goes out */ }
    }
    const running = status === 'running';
    if ((until === 'event' && fresh.length) || !running || over || aborted) {
      return {
        cursor: log.length, events: fresh.map(stageEvent), waitedMs: now() - t0,
        // settled: the run is no longer running. `status` says why (a RunStatus value, listed in types/index.d.ts:
        // 'paused' is an external seat that needs the caller). Only 'done' means there is a result.
        settled: !running, status, timedOut: running && !aborted && !fresh.length && over, cancelled: aborted,
        usdSoFar: Math.round(log.reduce((t, e) => t + (Number(e.usd) || 0), 0) * 1e4) / 1e4,
      };
    }
    await sleep(POLL_MS);
  }
}

export const stageEvent = e => ({ stage: e.stage, lab: e.lab ?? null, ms: e.ms ?? null, outcome: e.outcome ?? null, tokensOut: e.tokensOut ?? null });
