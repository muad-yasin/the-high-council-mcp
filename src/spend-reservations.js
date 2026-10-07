// The reservation record (0.8.2 item 8b; ChatGPT review 1 #4c; owner, 7 Oct 2026: "build it tonight"; C&C: yes, one narrow recorded figure).
//
// The problem. invoke() reserves a call's worst case in memory before it sends (src/chain.js `budget.reserved`) and replaces it with the real cost when the call returns. If the process is killed while a paid call is
// in flight, the reservation vanishes with it: the provider may bill the call, no usage file exists, and a resume starts counting from zero, so a run could lap its own cap.
//
// The record. `runs/<id>/spend-reservations.jsonl`, append-only, one JSON line per event, written with ONE write and fsynced:
//     {"schema":"spend-reservations/1","event":"reserved","id":"r1","label":"panel-1-x","seat":"provider/model","usd":<worst case>,"at":<ISO>}   BEFORE the call is sent
//     {"schema":"spend-reservations/1","event":"settled","id":"r1","outcome":"recorded"|"failed"|"billed_unreadable","usd":<what it cost, or null>,"at":<ISO>}   when invoke() returns or throws
// An UNSETTLED reservation (a `reserved` line with no `settled` line) is a call that was in flight when the process ended. It stays charged at its worst case: a resume counts it toward the cap, and `--spend`,
// `run_status` and the spend report add it to the run's cost, until the run folder is gone. There is no command to reconcile one (0.8.2): the cap errs high, never low. A call that settles normally
// leaves two lines and costs nothing extra anywhere. Mock runs and every call projected at $0 write nothing, so their run folders are unchanged.
//
// What it carries: an id, the stage label, the seat (provider/model), amounts and times. Never task text, prompts or run content (test/spend.test.js pins this). It is the ONE recorded figure in a spend
// derivation that is otherwise read back from the run folder (CLAUDE.md "Cross-run spend"): it records a moment nothing else can reconstruct (a call sent, not yet answered), it lives and dies with the run
// folder, and a missing, torn or corrupt file reads as "no unsettled reservations", which is today's behaviour. Writing is the opposite: if a reservation cannot be written, the call is NOT sent.
// Tamper-evident? No, and it does not claim to be: whoever can write the run folder can edit it.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const RESERVATIONS_FILE = 'spend-reservations.jsonl';
export const RESERVATIONS_SCHEMA = 'spend-reservations/1';
const clip = (v, n = 200) => String(v ?? '').slice(0, n);

function readLines(runDir) {
  let raw;
  try { raw = readFileSync(join(runDir, RESERVATIONS_FILE), 'utf8'); } catch { return []; }
  const out = [];
  // A line is complete only when it ends in a newline: a last segment without one is a write a crash cut short, and is ignored.
  const parts = raw.split('\n');
  parts.pop();
  for (const line of parts) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && typeof o === 'object' && o.schema === RESERVATIONS_SCHEMA && typeof o.id === 'string') out.push(o);
  }
  return out;
}

/** The reservations no `settled` line closed: [{ id, label, seat, usd }]. Never throws; a missing, torn or corrupt file reads as none. */
export function unsettledReservations(runDir) {
  const lines = readLines(runDir);
  const settled = new Set(lines.filter(l => l.event === 'settled').map(l => l.id));
  return lines.filter(l => l.event === 'reserved' && !settled.has(l.id) && Number.isFinite(l.usd) && l.usd > 0)
    .map(l => ({ id: clip(l.id, 40), label: clip(l.label), seat: clip(l.seat), usd: l.usd }));
}
export const unsettledUsd = runDir => unsettledReservations(runDir).reduce((n, r) => n + r.usd, 0);

/**
 * The sink invoke() writes through for one run folder: reserve({ label, seat, usd }) -> id (throws when the line cannot be written), settle(id, { outcome, usd }) (never throws: an unsettled
 * reservation is the safe side). Ids continue after the ones already in the file, so a resume never reuses one.
 */
export function openReservations(runDir, { now = () => Date.now() } = {}) {
  const path = join(runDir, RESERVATIONS_FILE);
  // Ids continue after the highest one in the file, torn or corrupt lines included (a repeated id would read as settled by the older line).
  let n = 0;
  try { for (const m of readFileSync(path, 'utf8').matchAll(/"id":"r(\d+)"/g)) n = Math.max(n, Number(m[1])); } catch { /* no file yet */ }
  const write = obj => {
    // A --rematch or --replay folder is created when the side run first needs it, which can be this call: the folder is made here rather than the call going out unrecorded.
    let fd;
    try { fd = openSync(path, 'a'); } catch (e) { if (e.code !== 'ENOENT') throw e; mkdirSync(runDir, { recursive: true }); fd = openSync(path, 'a'); }
    try {
      // A file that ends in a torn line (a write a crash cut short) gets a newline first, so this line is not glued onto the fragment and stays readable.
      let lead = '';
      try { const raw = readFileSync(path); if (raw.length && raw[raw.length - 1] !== 0x0a) lead = '\n'; } catch { /* unreadable: append as is */ }
      writeSync(fd, `${lead}${JSON.stringify({ schema: RESERVATIONS_SCHEMA, ...obj, at: new Date(now()).toISOString() })}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
  };
  return {
    reserve({ label, seat, usd }) {
      const id = `r${++n}`;
      write({ event: 'reserved', id, label: clip(label), seat: clip(seat), usd });
      return id;
    },
    settle(id, { outcome, usd = null }) {
      try { write({ event: 'settled', id, outcome, usd }); } catch { /* the reservation stays charged: the cap errs high */ }
    },
  };
}
