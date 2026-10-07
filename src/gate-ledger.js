// The gate ledger: `runs/<id>/gate-ledger.jsonl`, one hash-chained line per event (0.8.1 plan DR-4, M3,
// persistence register P5). It is the record of every gate a run asked a person to answer and of what
// happened after: a send, a stop, an advisor's request for more material.
//
// Contract.
//   readLedger(runDir)      -> { ok, missing, lines[], torn, failedAt?, reason? }  (read-only)
//   verifyLedger(runDir)    -> the same verdict, for `council gate verify`
//   withLedger(runDir, fn)  -> runs fn({ lines, append }) holding the run's ledger lock; append(event, fields)
//                              writes one line. Used by src/gate.js for the two gate events.
//   appendEvent(runDir, event, fields) -> appends one of PUBLIC_EVENTS (sent, stopped, more_material_requested, amend_requested).
//   EVENTS, PUBLIC_EVENTS, LEDGER_FILE, LEDGER_SCHEMA
//
// Line format: {"schema":"gate-ledger/1","seq":n,"prev":<sha256 hex | null>,"ts":<ISO>,"event":<name>,...fields}.
// `seq` starts at 1. `prev` is the sha256 of the previous line's bytes WITHOUT its trailing newline, so a
// reader can check a ledger by hand with `head -n1 | tr -d '\n' | sha256sum`; the first line's `prev` is null.
//
// Tamper-evident, not tamper-proof (decided rule 9): a changed or deleted line BEFORE the last one breaks
// the chain and the run fails closed (`gate_ledger_corrupt`). Anything that can write the run folder can
// edit or append the last line, cut the tail, or rewrite the whole file, and the chain cannot tell (src/gate.js
// compares a gate's file with its ledger lines, which catches an edit of one but not of both). No text
// anywhere says otherwise.
//
// Torn tail. A line is complete only when it ends in "\n"; every line is written by one write() of the
// whole line, newline included, then fsync. A last segment with no newline is a write a crash cut short:
// it is ignored on read and cut away (at the byte offset after the last complete line) before the next
// append. A COMPLETE line that does not parse, or whose seq/prev/schema is wrong, is a mid-file break,
// never a torn tail.
//
// Concurrency. The `prev` of a new line depends on the last line, so read-then-append must not interleave
// between two processes (an MCP server and a terminal answering the same run). Every append holds the
// run's ledger lock, the same O_EXCL lock with stale-pid takeover as the run lock (src/run-lock.js).
// Every holder is synchronous from take to release, so a lock whose pid is alive is really in use. A lock
// file that cannot be read (a crash between creating it and writing the pid) is judged by its age: older
// than 30 s (P14's rule for the advice lock) it is stale and taken over; until then it is waited on.
import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, openSync, readFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { acquireRunLock, RunLockedError } from './run-lock.js';

export const LEDGER_FILE = 'gate-ledger.jsonl';
export const LEDGER_LOCK_FILE = 'gate-ledger.lock';
export const LEDGER_SCHEMA = 'gate-ledger/1';
// The set M4 (sent), M5 (more_material_requested) and M6 (stopped) need; plan M3 Work 2. 0.8.2 item 6d (owner, 7 Oct 2026: "we go with the full one") adds the contract record's three:
// contract_locked, amend_requested and amend_decided (src/contract-record.js). A ledger that holds one of them is read as "broken" by a 0.8.1 tool (it reports an unknown event, whatever the
// format id says), which the CHANGELOG lists under the breaking heading.
export const EVENTS = Object.freeze(['gate_requested', 'gate_answered', 'sent', 'stopped', 'more_material_requested', 'contract_locked', 'amend_requested', 'amend_decided']);
// The two gate events are written only by src/gate.js and the contract's lock and decision events only by src/contract-record.js (both through withLedger); everything else may append these.
// amend_requested is public on purpose: it is a request that decides nothing (the `contract_amend` tool appends it), and a person reads its words before a decision.
export const PUBLIC_EVENTS = Object.freeze(['sent', 'stopped', 'more_material_requested', 'amend_requested']);

export class LedgerBusyError extends Error {
  constructor(holder, lockPath) {
    super(`the gate ledger is being written (lock ${lockPath}, held by pid ${holder?.pid ?? 'unknown'}${holder?.host ? ` on ${holder.host}` : ''}). Try again; if no council process is running on this run, delete that lock file.`);
    this.code = 'gate_busy';
  }
}

export class LedgerWriteError extends Error {
  constructor(message) {
    super(message);
    this.code = 'gate_ledger_write_failed';
  }
}

export class LedgerCorruptError extends Error {
  constructor(verdict) {
    super(`the gate ledger is broken at line ${verdict.failedAt}: ${verdict.reason}`);
    this.code = 'gate_ledger_corrupt';
    this.verdict = verdict;
  }
}

export const sha256Hex = data => createHash('sha256').update(data).digest('hex');

// Parses and checks the ledger's bytes. Pure: no file access.
export function parseLedger(buf) {
  const lines = [];
  let offset = 0;          // byte offset just after the last complete, good line
  let prev = null;
  let i = 0;
  while (offset < buf.length) {
    const nl = buf.indexOf(0x0a, offset);
    if (nl === -1) return { ok: true, lines, torn: true, goodBytes: offset, lastSha: prev };
    const raw = buf.subarray(offset, nl);
    i += 1;
    let line;
    try { line = JSON.parse(raw.toString('utf8')); } catch { return { ok: false, lines, failedAt: i, reason: 'the line is not JSON', goodBytes: offset }; }
    if (!line || typeof line !== 'object' || Array.isArray(line)) return { ok: false, lines, failedAt: i, reason: 'the line is not an object', goodBytes: offset };
    if (line.schema !== LEDGER_SCHEMA) return { ok: false, lines, failedAt: i, reason: `schema is not ${LEDGER_SCHEMA}`, goodBytes: offset };
    if (line.seq !== i) return { ok: false, lines, failedAt: i, reason: `seq is ${JSON.stringify(line.seq)}, expected ${i}`, goodBytes: offset };
    if (line.prev !== prev) return { ok: false, lines, failedAt: i, reason: 'prev does not match the sha256 of the line before', goodBytes: offset };
    if (!EVENTS.includes(line.event)) return { ok: false, lines, failedAt: i, reason: `unknown event ${JSON.stringify(line.event)}`, goodBytes: offset };
    lines.push(line);
    prev = sha256Hex(raw);
    offset = nl + 1;
  }
  return { ok: true, lines, torn: false, goodBytes: offset, lastSha: prev };
}

/** The ledger as data, checked. A missing ledger is an empty, valid one (`missing: true`). Never writes. */
export function readLedger(runDir) {
  const path = join(runDir, LEDGER_FILE);
  let buf;
  try { buf = readFileSync(path); } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, missing: true, lines: [], torn: false };
    // Exists but cannot be read: fail closed, never "no events".
    return { ok: false, missing: false, lines: [], torn: false, failedAt: 0, reason: `cannot read the ledger (${err.code})` };
  }
  const { goodBytes, lastSha, ...verdict } = parseLedger(buf);
  return { missing: false, ...verdict };
}

export const verifyLedger = readLedger;

const RESERVED = ['schema', 'seq', 'prev', 'ts', 'event'];

// A holder keeps the lock for one read, one write and one fsync (milliseconds), so a second writer waits
// rather than failing: two answers to one gate then end as one answer and one gate_not_pending, and a
// `sent` line is not lost to a terminal answering at the same moment. Two seconds is far above any
// holder's time on a local disk and far below the 30 s hold of a tool call (DR-6); past it the lock's
// holder is taken to be stuck and the writer gets gate_busy. A dead holder's lock is taken over at once.
const LOCK_WAIT_MS = 2000;
const UNREADABLE_LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 10;
const SLEEPER = new Int32Array(new SharedArrayBuffer(4)); // a synchronous sleep; the writers are synchronous

function lineFor(seq, prev, ts, event, fields) {
  // Fixed key order by construction, so a golden ledger is byte-stable.
  return `${JSON.stringify({ schema: LEDGER_SCHEMA, seq, prev, ts, event, ...fields })}\n`;
}

/**
 * Holds the run's ledger lock, re-reads the ledger, and calls fn({ lines, append }). append(event, fields)
 * writes one whole line with one write() and fsyncs it, after cutting a torn tail away. Throws
 * LedgerBusyError when another live process holds the lock and LedgerCorruptError on a mid-file break
 * (nothing is appended to a broken ledger). `now` is injectable for golden fixtures.
 */
export function withLedger(runDir, fn, { now = () => Date.now(), waitMs = LOCK_WAIT_MS } = {}) {
  let release;
  for (const deadline = Date.now() + waitMs; ;) {
    try { release = acquireRunLock(runDir, { file: LEDGER_LOCK_FILE, unreadableStaleMs: UNREADABLE_LOCK_STALE_MS }); break; } catch (err) {
      if (!(err instanceof RunLockedError)) throw err;
      if (Date.now() >= deadline) throw new LedgerBusyError(err.holder, join(runDir, LEDGER_LOCK_FILE));
      Atomics.wait(SLEEPER, 0, 0, LOCK_RETRY_MS);
    }
  }
  try {
    const path = join(runDir, LEDGER_FILE);
    let buf;
    try { buf = readFileSync(path); } catch (err) {
      if (err.code !== 'ENOENT') throw new LedgerCorruptError({ failedAt: 0, reason: `cannot read the ledger (${err.code})` });
      buf = Buffer.alloc(0);
    }
    const parsed = parseLedger(buf);
    if (!parsed.ok) throw new LedgerCorruptError(parsed);
    const lines = parsed.lines;
    let goodBytes = parsed.goodBytes;
    let prev = parsed.lastSha;
    const append = (event, fields = {}) => {
      if (!EVENTS.includes(event)) throw new Error(`gate ledger: unknown event ${JSON.stringify(event)}`);
      const clash = RESERVED.filter(k => Object.hasOwn(fields, k));
      if (clash.length) throw new Error(`gate ledger: ${clash.join(', ')} are set by the ledger, not by the caller`);
      const text = lineFor(lines.length + 1, prev, new Date(now()).toISOString(), event, fields);
      const fd = openSync(path, existsSync(path) ? 'r+' : 'w');
      try {
        const size = fstatSync(fd).size;
        // Shorter than what was read under this same lock: something else cut the file. Never pad it.
        if (size < goodBytes) throw new LedgerCorruptError({ failedAt: lines.length, reason: 'the ledger got shorter while it was locked' });
        if (size > goodBytes) ftruncateSync(fd, goodBytes); // cut a torn tail
        const bytes = Buffer.from(text, 'utf8');
        const wrote = writeSync(fd, bytes, 0, bytes.length, goodBytes);
        // A short write leaves a torn tail, which the next reader ignores; this append did not happen.
        if (wrote !== bytes.length) throw new LedgerWriteError(`the ledger write stopped after ${wrote} of ${bytes.length} bytes`);
        fsyncSync(fd);
        goodBytes += bytes.length;
        prev = sha256Hex(bytes.subarray(0, bytes.length - 1));
      } finally { closeSync(fd); }
      const line = JSON.parse(text);
      lines.push(line);
      return line;
    };
    return fn({ lines, append });
  } finally {
    release();
  }
}

/** Appends one of PUBLIC_EVENTS. The gate events go through src/gate.js only. */
export function appendEvent(runDir, event, fields = {}, opts = {}) {
  if (!PUBLIC_EVENTS.includes(event)) throw new Error(`gate ledger: ${JSON.stringify(event)} is not an event this function writes (gate events are written by src/gate.js)`);
  return withLedger(runDir, ({ append }) => append(event, fields), opts);
}
