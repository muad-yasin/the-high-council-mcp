// The tree record on disk (0.8.3 M1; PLAN 4.1-4.3). `runs/<rootId>/tree/` holds `tree.json` (written once, atomically, at tree start, never edited), `events.jsonl` (append-only: the tree's one record) and
// `.tree.lock`. Every child is an ordinary flat run folder `runs/<childId>/`; nothing is nested, copied or linked.
//
// Writing. Every writer takes the tree lock (src/run-lock.js's `acquireRunLock` with `file: '.tree.lock'`: it throws instead of waiting, so a writer retries a bounded number of times), then, still under the lock:
//   1. reads the whole file and validates its COMMITTED PREFIX: every complete line parses as an object of schema tree-events/1, with a known event name and the fields that event requires, and ids are unique;
//   2. applies the TAIL RULE: bytes after the last newline are a write a crash cut short and were never committed. They are copied byte for byte to `events.torn-<n>.txt` (n counting up, never overwritten), fsynced,
//      and only then is `events.jsonl` truncated back to its last complete line and fsynced. (src/spend-reservations.js meets the same case by writing a leading newline; here that would turn the fragment into a
//      malformed COMPLETE line, which blocks, so the fragment is preserved and cut instead);
//   3. checks the transition table (src/tree-transitions.js) and refuses what it does not list;
//   4. writes ONE line with ONE write and fsyncs it, before the action the event authorizes.
// A malformed complete line is NOT repaired by code: the tree is `blocked: record_corrupt`, nothing but a `blocked` record is appended, and no paid start or resume runs anywhere in the tree until a person restores
// the file. Readers never truncate and never take the lock; they read only complete lines and REPORT a malformed one rather than skipping it.
//
// The whole of it is synchronous, on purpose: M2's mirror of a run's reservations is written from inside a paid call's path and must not yield between taking the lock and releasing it (src/run-lock.js refuses a
// second acquire from the same process, so a yield with the lock held would let a parallel call refuse itself). Spend never appears in this file; amounts are only grants (PLAN 4.3).
import { closeSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { acquireRunLock, RunLockedError } from './run-lock.js';
import { sha256Of } from './thin-contract.js';
import { rootTaskProblem } from './tree-task-pin.js';
import { piiAllowProblem, piiModeProblem } from './tree-pii-mode.js';
import { EVENTS_SCHEMA, eventShapeError, foldRecord, transitionRefusal } from './tree-transitions.js';

export const TREE_DIR = 'tree';
export const TREE_FILE = 'tree.json';
export const EVENTS_FILE = 'events.jsonl';
export const TREE_LOCK_FILE = '.tree.lock';
export const TREE_SCHEMA = 'tree/1';
/** The settled product defaults (PLAN 2.1, 4.2): depth 2 with the root at 0, 12 runs per tree, 4 children per split, one attempt per child. The first three are raisable at a stop (PLAN 8.6); the last is not. */
export const DEFAULT_LIMITS = Object.freeze({ maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 4, attemptsPerChild: 1 });

// The lock is held for one validate-and-append (read a small file, one write, one fsync): a few milliseconds even on a loaded machine. A writer that finds it held tries again every 20 ms, a hundred times:
// two seconds, a hundred times the longest hold, and still shorter than anything a person waits on. Past that the lock is treated as unavailable (the caller gets the RunLockedError).
export const LOCK_TRIES = 100;
export const LOCK_WAIT_MS = 20;
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A refused transition or an unusable record. The CLI turns it into exit 19 (EXIT_TREE_REFUSED). `code` is 'transition_refused', 'record_corrupt', or another blocked reason. */
export class TreeRefusal extends Error {
  constructor({ code, transition = null, reason, check = null }) {
    super(`tree refused${transition ? ` ${transition}` : ''} (${code}): ${reason}`);
    this.name = 'TreeRefusal';
    this.code = code; this.transition = transition; this.reason = reason;
    this.check = check;       // in memory only (D2 F9a): the refusing writer's own check word, e.g. 'admission' for a limit or the budget (never written beyond the `blocked` line the writer already appended)
  }
}

export const treeDirOf = rootDir => join(rootDir, TREE_DIR);
const pathIn = (rootDir, name) => join(rootDir, TREE_DIR, name);

// A directory entry reaches the disk only when the directory is fsynced. Windows cannot open a directory for it; there the rename's own durability is the platform's.
export function fsyncDir(dir) {
  try { const fd = openSync(dir, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch { /* a platform that cannot fsync a directory */ }
}

/**
 * Reads the record. Read-only: it takes no lock, creates nothing and truncates nothing, so it is safe while a writer holds the lock (`council tree status` is built on it, M6).
 * Returns { exists, tree, treeError, events, corrupt, fragment, committedBytes, lastLine }:
 *   events      every complete line that is a well-formed event, in file order
 *   corrupt     [{ line, reason }] for every complete line that is not (a blank line included) and for a tree.json / tree_started that disagree; empty when the record is sound
 *   fragment    the bytes after the last newline (a write a crash cut short), or null
 */
export function readTreeRecord(rootDir) {
  const dir = treeDirOf(rootDir);
  const out = { rootDir, exists: existsSync(dir), tree: null, treeSha256: null, treeError: null, events: [], corrupt: [], fragment: null, committedBytes: 0 };
  let raw = null;
  try { raw = readFileSync(join(dir, TREE_FILE), 'utf8'); } catch (err) { if (err.code !== 'ENOENT') out.treeError = `tree.json cannot be read (${err.code || err.message})`; }
  if (raw !== null) {
    try {
      const t = JSON.parse(raw);
      if (t?.schema !== TREE_SCHEMA) out.treeError = `tree.json is not schema ${TREE_SCHEMA}`; else { out.tree = t; out.treeSha256 = sha256Of(raw); }
    } catch { out.treeError = 'tree.json is not valid JSON'; }
  }
  let buf = Buffer.alloc(0);
  try { buf = readFileSync(join(dir, EVENTS_FILE)); } catch (err) { if (err.code !== 'ENOENT') out.corrupt.push({ line: null, reason: `events.jsonl cannot be read (${err.code || err.message})` }); }
  const lastNl = buf.lastIndexOf(0x0a);
  out.committedBytes = lastNl + 1;
  if (buf.length > out.committedBytes) out.fragment = buf.subarray(out.committedBytes);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const seen = new Set();
  let start = 0; let lineNo = 0;
  while (start < out.committedBytes) {
    const end = buf.indexOf(0x0a, start);
    lineNo += 1;
    let obj = null; let why = null;
    try {
      const text = decoder.decode(buf.subarray(start, end));
      if (!text.trim()) why = 'a blank line';
      else { obj = JSON.parse(text); why = eventShapeError(obj); }
    } catch { why = 'not valid UTF-8 JSON'; }
    if (!why && seen.has(obj.id)) why = `event id ${obj.id} appears twice`;
    if (why) out.corrupt.push({ line: lineNo, reason: why });
    else { seen.add(obj.id); out.events.push(obj); }
    start = end + 1;
  }
  if (out.events.length && out.events[0].event !== 'tree_started') out.corrupt.push({ line: 1, reason: 'the first event is not tree_started' });
  if (out.events.length && out.tree === null && !out.treeError) out.corrupt.push({ line: null, reason: 'events exist but tree.json does not' });
  const ts = out.events.find(e => e.event === 'tree_started');
  if (ts && out.treeSha256 && ts.treeJsonSha256 !== out.treeSha256) out.corrupt.push({ line: null, reason: 'tree.json differs from the hash tree_started recorded' });
  if (out.treeError) out.corrupt.push({ line: null, reason: out.treeError });
  if (out.tree) out.tree = withAmendedChains(out.tree, out.events);
  return out;
}

/**
 * The tree as every reader should see it: tree.json is never edited, so a person's `chain_limits_amended` (src/tree-chain-limits.js, 0.8.3: a seat's own price limit changed in a chain file) is laid over the chain entry it
 * names, keeping the hash the tree STARTED with next to the accepted one (`startedSha256`) and replacing the limits snapshot. Every reader of `record.tree.chains` (loadChainConfig, tree start, registration, the ceiling reader)
 * then accepts the amended file with no change of its own. `treeSha256` stays the raw file's hash. No amendment: the very same object.
 */
export function withAmendedChains(tree, events) {
  let chains = tree.chains;
  for (const e of events) {
    if (e.event !== 'chain_limits_amended' || !Array.isArray(chains)) continue;
    chains = chains.map(c => (c.name === e.chain ? { ...c, startedSha256: c.startedSha256 ?? c.sha256, sha256: e.toSha256, priceLimits: e.toLimits } : c));
  }
  return chains === tree.chains ? tree : { ...tree, chains };
}

/** The folded state of a record, with `record_corrupt` added to the sticky reasons when the file does not read. */
/**
 * The ONE refusal for a record that does not read (a tree.json that is missing, or any malformed line: foldRecord SKIPS such a line, so a state read from it is not the state the record holds). Used by the person's verbs (src/tree-decide.js)
 * and by the session channel (src/tree-decide-session.js), so a quote, an answer and a deferral are refused before any gate, price row or event is written. -> a sentence, or null when the record reads.
 */
export const unreadableRecordRefusal = record => (!record.tree || record.corrupt.length ? `the record of this tree does not read (${record.corrupt.length} problem${record.corrupt.length === 1 ? '' : 's'}); nothing can be decided on it` : null);

export function stateOf(record) {
  const state = foldRecord(record.events);
  if (record.corrupt.length && !state.sticky.has('record_corrupt')) state.sticky.set('record_corrupt', null);
  return state;
}

/**
 * Runs `fn` holding the tree lock, retrying a held lock `tries` times, `waitMs` apart (synchronously). The lock is released in `finally`; this does not rely on run-lock's exit listener, which is added during
 * the exit emission and would not fire. A lock still held after the last try throws the RunLockedError.
 */
export function withTreeLock(rootDir, fn, { tries = LOCK_TRIES, waitMs = LOCK_WAIT_MS, sleep = sleepSync } = {}) {
  let release = null; let last = null;
  for (let i = 0; i < Math.max(1, tries); i++) {
    try { release = acquireRunLock(treeDirOf(rootDir), { file: TREE_LOCK_FILE }); break; } catch (err) {
      if (!(err instanceof RunLockedError)) throw err;
      last = err;
      if (i < tries - 1) sleep(waitMs);
    }
  }
  if (!release) throw last;
  try { return fn(); } finally { release(); }
}

function cutTornTail(rootDir, record) {
  if (!record.fragment) return null;
  let n = 1;
  while (existsSync(pathIn(rootDir, `events.torn-${n}.txt`))) n++;
  const torn = pathIn(rootDir, `events.torn-${n}.txt`);
  writeFileSync(torn, record.fragment, { flag: 'wx' });
  const tfd = openSync(torn, 'r'); try { fsyncSync(tfd); } finally { closeSync(tfd); }
  fsyncDir(treeDirOf(rootDir));
  const efd = openSync(pathIn(rootDir, EVENTS_FILE), 'r+');
  try { ftruncateSync(efd, record.committedBytes); fsyncSync(efd); } finally { closeSync(efd); }
  return torn;
}

function writeLine(rootDir, line) {
  const fd = openSync(pathIn(rootDir, EVENTS_FILE), 'a');
  try { writeSync(fd, `${JSON.stringify(line)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}

/**
 * Appends one event under the tree lock (see the header). `event` is { event: <name>, ...fields }; the writer adds `schema`, `id` and `at`. Returns the event as written.
 * A transition the table does not list is NOT written: a `blocked` record naming it is (reason transition_refused), and a TreeRefusal is thrown. On a corrupt record only a `blocked` event is ever appended.
 * `facts` and `now` are injectable for tests: `facts.pidAlive`, `facts.host` (see tree-transitions.js), `now()` -> ms.
 */
export function appendTreeEvent(rootDir, event, { facts, now, ...lockOptions } = {}) {
  return withTreeLock(rootDir, () => appendTreeEventLocked(rootDir, event, { facts, now }), lockOptions);
}

/**
 * The append itself, for a caller that ALREADY holds the tree lock (withTreeLock). A member's start takes the lock ONCE for the accounting gate, the continuation checks and its claim (PLAN 7.6: "in the same
 * hold of the lock"), so nothing can change between the checks and the claim; it uses this for the claim and for the `blocked` record of a refusal. src/run-lock.js refuses a second acquire from the same
 * process, so calling appendTreeEvent inside withTreeLock would fail: the two are not interchangeable. Everything else uses appendTreeEvent.
 */
export function appendTreeEventLocked(rootDir, event, { facts = {}, now = () => Date.now() } = {}) {
  if (!event || typeof event.event !== 'string') throw new TypeError('appendTreeEvent: { event: <name>, ...fields }');
  // schema, id and time are the writer's. An event read back from the record and appended again would repeat its id, and the tree would be a corrupt record until a person fixed the file.
  for (const k of ['schema', 'id', 'at']) if (k in event) throw new TypeError(`appendTreeEvent: "${k}" is set by the writer, not by the caller`);
  {
    const record = readTreeRecord(rootDir);
    const isBlocked = event.event === 'blocked';
    const stamp = id => ({ schema: EVENTS_SCHEMA, id, ...event, at: new Date(now()).toISOString() });
    const nextId = () => `e${Math.max(0, ...record.events.map(e => Number(e.id.slice(1)))) + 1}`;
    if (record.corrupt.length) {
      const detail = record.corrupt.map(c => `${c.line === null ? 'record' : `line ${c.line}`}: ${c.reason}`).join('; ');
      const last = record.events[record.events.length - 1];
      cutTornTail(rootDir, record);
      if (!isBlocked) {
        if (!(last?.event === 'blocked' && last.reason === 'record_corrupt')) writeLine(rootDir, { schema: EVENTS_SCHEMA, id: nextId(), event: 'blocked', at: new Date(now()).toISOString(), reason: 'record_corrupt', scope: 'tree', detail });
        throw new TreeRefusal({ code: 'record_corrupt', transition: event.event, reason: detail });
      }
    } else cutTornTail(rootDir, record);
    const line = stamp(nextId());
    const bad = eventShapeError(line);
    if (bad) throw new TypeError(`appendTreeEvent: ${bad}`);
    if (!isBlocked) {
      const refusal = transitionRefusal(stateOf(record), line, facts);
      if (refusal) {
        const scope = line.node !== undefined ? `${line.node}@g${line.generation}` : 'tree';
        writeLine(rootDir, { schema: EVENTS_SCHEMA, id: nextId(), event: 'blocked', at: new Date(now()).toISOString(), reason: 'transition_refused', scope, transition: line.event, detail: refusal.reason });
        throw new TreeRefusal(refusal);
      }
    }
    writeLine(rootDir, line);
    return line;
  }
}

/**
 * Writes `tree.json` (PLAN 4.2): once, atomically (temp file, fsync, rename, directory fsync), never edited. `none` is refused for a tree (the root cap is finite). The tree id is the root run's id, which is
 * the name of the folder holding `tree/`. Returns { tree, sha256 } with the hash of the file as written. `rootTask` ({ task, cwd, taskHash }, src/tree-task-pin.js) is the optional, additive pin of the root's task; `piiGate` ('warn' | 'hard-stop', src/tree-pii-mode.js) the optional, additive personal-data mode of the whole tree.
 */
export function createTreeFile(rootDir, { rootCapUsd, chains, limits = DEFAULT_LIMITS, rootTask, piiGate, piiAllow, bundleAllowanceBytes, now = () => Date.now() } = {}) {
  if (!Number.isFinite(rootCapUsd) || rootCapUsd <= 0) throw new RangeError('a tree needs a finite root cap above 0 (--max-usd none is refused for a tree)');
  if (!Array.isArray(chains) || !chains.some(c => c.depth === 0) || chains.some(c => !c.name || !c.sha256 || !Number.isInteger(c.depth))) throw new TypeError('chains: [{ depth, name, sha256 }, ...] with the root chain at depth 0');
  // 0.8.3: optional and additive, written once like every tree.json field: the hash of the chain file WITHOUT its seats' price limits and the limits as they were (src/price-limits.js); with them a person can accept a changed limit later (src/tree-chain-limits.js). Absent (a tree made by hand or before) = that chain's limits cannot be amended.
  if (chains.some(c => (c.limitFreeSha256 !== undefined && !/^[0-9a-f]{64}$/.test(c.limitFreeSha256)) || (c.priceLimits !== undefined && !Array.isArray(c.priceLimits)))) throw new TypeError('chains: limitFreeSha256 is 64 hex and priceLimits an array when given');
  // the root task pin (src/tree-task-pin.js): optional and additive; a damaged one is refused before anything is written
  if (rootTask !== undefined && rootTaskProblem(rootTask)) throw new TypeError(`rootTask: ${rootTaskProblem(rootTask)}`);
  // the personal-data mode (src/tree-pii-mode.js): optional and additive; absent (a record written before 0.8.3, or built by hand) means the gate is off for this tree - `tree start` always writes one now; anything but 'warn' or 'hard-stop' is refused before anything is written
  if (piiGate !== undefined && piiModeProblem(piiGate)) throw new TypeError(`piiGate: ${piiModeProblem(piiGate)}`);
  // T-b: the types a person allowed for the ROOT task after seeing the stop (`tree start --allow-pii`); optional and additive (absent = none), only under a recorded mode, written once like every tree.json field
  if (piiAllow !== undefined && (piiAllowProblem(piiAllow) || piiGate === undefined)) throw new TypeError(`piiAllow: ${piiAllowProblem(piiAllow) ?? 'an allowance needs a recorded personal-data mode'}`);
  // the size of input a child's approval is priced for (src/tree-budget.js bundleAllowanceBytesOf): optional and additive (absent = the default), set by a person's setting, written once
  if (bundleAllowanceBytes !== undefined && !(Number.isInteger(bundleAllowanceBytes) && bundleAllowanceBytes > 0)) throw new TypeError('bundleAllowanceBytes: a positive whole number of bytes');
  const dir = treeDirOf(rootDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, TREE_FILE);
  if (existsSync(file)) throw new Error(`${file} exists: a tree is started once and tree.json is never edited`);
  const tree = { schema: TREE_SCHEMA, treeId: basename(rootDir), rootCapUsd, chains, ...(rootTask !== undefined ? { rootTask: { task: rootTask.task, cwd: rootTask.cwd, taskHash: rootTask.taskHash } } : {}), limits: { ...limits }, ...(piiGate !== undefined ? { piiGate } : {}), ...(piiAllow !== undefined ? { piiAllow: [...piiAllow] } : {}), ...(bundleAllowanceBytes !== undefined ? { bundleAllowanceBytes } : {}), createdAt: new Date(now()).toISOString() };
  const text = JSON.stringify(tree, null, 2);
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'wx');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
  fsyncDir(dir);
  return { tree, sha256: sha256Of(text) };
}

/**
 * Starts a tree: `tree.json` first (durable), then the `tree_started` event carrying its sha256. This order closes the crash window in one direction: a tree.json with no events is completed by
 * recovery (src/tree-recovery.js: `planRecovery` plans the `tree_started`, `recoverTree` appends it), and events with no tree.json (or a different hash) are a corrupt record. PLAN 8.5 lets `tree_started` follow only "no tree.json yet"; that row is read here as "no `tree_started`
 * event yet" (DECISIONS 8 Oct, C&C-accepted), because 4.2 writes tree.json at start.
 */
export function startTree(rootDir, spec) {
  const { tree, sha256 } = createTreeFile(rootDir, spec);
  const started = appendTreeEvent(rootDir, { event: 'tree_started', treeId: tree.treeId, treeJsonSha256: sha256 }, { now: spec.now });
  return { tree, sha256, started };
}
