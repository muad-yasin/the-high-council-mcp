// The tree's money (0.8.3 M2; PLAN 7.1-7.5 and D7, D18). The root run's `--max-usd` is the one cap; every child runs on a grant out of it, and a run that stops at its cap is the CLI's old behaviour. This module is what
// the tree adds, and it NEVER calls a model:
//   gateTree        the accounting gate (PLAN 7.2): reads every member's evidence and decides, for each reservation, whether the record can be trusted. A tree that fails it makes no paid start or resume.
//   treeSpent       what the tree has spent: `sum of runSpentUsd + sum of added(R)` (PLAN 7.1), with the "once" rule: a reservation is added only where the run's own record no longer accounts for it.
//   budgetOf        grants held, what is available, each node's lifetime cap (PLAN 7.3, 7.4).
//   proposeGrants / admitAgainstLimits   the split between children and the admission rules (PLAN 7.3).
//   topUp / acceptAccounting             the library functions behind `council tree decide --top-up / --accounting` (the terminal verbs are M5/M6).
//
// Evidence is read from the run folders, as every spend reader does (src/spend.js). The one recorded figure is the reservation: a member's own `spend-reservations.jsonl`, and its mirror in the tree's `events.jsonl`
// (`reservation_mirrored`, written by the member's sink with the same line, src/tree-mirror.js). The rule behind every check: a record `runSpentUsd` reads that does not match its documented shape counts against a grant, never
// for it. This is crash and error handling, not protection against someone editing their own files.
//
// Cost: the gate reads every member folder (a few small files each) while the caller holds the tree lock, and a running member's mirror write waits only about 2 s for that lock before it fails closed ("not sent"). The
// gate is therefore kept to plain reads; test/tree-budget.test.js times it on a 13-member tree and the numbers are in the M2 report.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runSpentUsd } from './spend.js';
import { RESERVATIONS_FILE, RESERVATIONS_SCHEMA } from './spend-reservations.js';
import { SUPERSEDED_DIR } from './superseded.js';
import { canonicalJson, sha256Of } from './thin-contract.js';
import { dryRunReport } from './dry-run.js';
import { TreeRefusal, appendTreeEvent, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { deadKeys, isSupersededGeneration } from './tree-transitions.js';

/** Two money figures that should be one value are equal within this (floating-point sums of cents). */
export const MONEY_EPS = 1e-9;
/**
 * THE cap in force (gate page 5/12, ONE reader): the `toCapUsd` of the latest `cap_amended` event, else the cap tree.json was started with. tree.json is never edited (a test pins it), so the starting cap stays readable
 * and an amendment is a record. Everything that needs "the cap" - budgetOf, lifetimeCapOf, the previews, the accounting gate, the views - goes through here (test/tree-cap-amended.test.js scans src/ for any other reader of
 * the starting cap in tree.json). A `cap_amended` that does not read as a positive number is a corrupt record (the shape check), so none is skipped here.
 */
export function effectiveCapUsd(record) {
  for (let i = record.events.length - 1; i >= 0; i -= 1) if (record.events[i].event === 'cap_amended') return record.events[i].toCapUsd;
  return startingCapUsd(record);
}
/** The cap the tree STARTED with (tree.json, never edited): the one other reader of that field, for the amendment screen's "started at" line. Everything that needs the cap IN FORCE reads effectiveCapUsd. */
export const startingCapUsd = record => record.tree.rootCapUsd;
const keyOf = (runId, id) => `${runId}:${id}`;
const nodeKeyOf = n => `${n.node}@g${n.generation}`;
const isMoney = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const near = (a, b) => Math.abs(a - b) <= MONEY_EPS;
const OUTCOMES = ['recorded', 'failed', 'billed_unreadable'];
/** The key the gate gives the problem `report_unreadable` of a run, so a person's acceptance can name it (reservation keys are `<run id>:r<n>`; this one cannot collide with them). */
export const reportKeyOf = runId => `${runId}:report.json`;

function readJsonFile(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { return { state: e.code === 'ENOENT' ? 'missing' : 'bad', error: e.code || e.message }; }
  try { return { state: 'ok', value: JSON.parse(raw) }; } catch { return { state: 'bad', error: 'not valid JSON' }; }
}

/** Why a reservation line is not well formed (PLAN 7.2 item 2), or null. */
function reservationLineProblem(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'not an object';
  if (o.schema !== RESERVATIONS_SCHEMA) return `schema is not ${RESERVATIONS_SCHEMA}`;
  if (typeof o.id !== 'string' || !o.id) return 'no id';
  if (o.event === 'reserved') return Number.isFinite(o.usd) && o.usd > 0 ? null : 'a reserved line needs a finite usd above zero';
  if (o.event === 'settled') {
    if (!OUTCOMES.includes(o.outcome)) return `unknown outcome ${JSON.stringify(o.outcome)}`;
    if (o.outcome === 'recorded') return isMoney(o.usd) ? null : 'a recorded settlement needs a finite usd of zero or more';
    if (o.outcome === 'failed') return o.usd === 0 || o.usd === null ? null : 'a failed settlement carries usd 0 or null';
    return Number.isFinite(o.usd) && o.usd > 0 ? null : 'a billed_unreadable settlement needs a finite usd above zero';
  }
  return `unknown event ${JSON.stringify(o.event)}`;
}

/** A member's reservations file, strictly (unlike src/spend-reservations.js, which skips what it cannot read): every complete line must parse and be well formed. A last line with no newline is a cut-short write and is ignored. */
export function readReservationFile(runDir) {
  const out = { exists: false, lines: [], loose: [], problems: [] };
  let raw;
  try { raw = readFileSync(join(runDir, RESERVATIONS_FILE), 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') out.problems.push(`${RESERVATIONS_FILE} cannot be read (${e.code || e.message})`);
    return out;
  }
  out.exists = true;
  const parts = raw.split('\n'); parts.pop();
  parts.forEach((text, i) => {
    let o;
    try { o = JSON.parse(text); } catch { out.problems.push(`line ${i + 1} is not valid JSON`); return; }
    // `loose`: what src/spend-reservations.js's lenient reader would see (the right schema, a string id, a reserved/settled event), well formed or not. runSpentUsd counts by THAT view, so the table rows of PLAN 7.1
    // follow it, while the checks above stay strict: a damaged line blocks, and the tree's figure stays on the high side.
    if (o && typeof o === 'object' && o.schema === RESERVATIONS_SCHEMA && typeof o.id === 'string' && o.id && (o.event === 'reserved' || o.event === 'settled')) out.loose.push(o);
    const why = reservationLineProblem(o);
    if (why) out.problems.push(`line ${i + 1}: ${why}`); else out.lines.push(o);
  });
  return out;
}

const groupById = lines => {
  const m = new Map();
  lines.forEach((l, i) => { const g = m.get(l.id) || { reserved: [], settled: [] }; g[l.event].push({ ...l, _at: i }); m.set(l.id, g); });
  return m;
};

/** The evidence records `runSpentUsd` reads for a run's state (PLAN 7.1), each { source, usd, reservationId, provider, kind }, plus the problems found reading them. */
function evidenceOf(runDir, problems) {
  const evidence = [];
  const bad = (code, detail) => problems.push({ code, detail, keys: [] });
  const rep = readJsonFile(join(runDir, 'report.json'));
  if (rep.state === 'bad') bad('report_unreadable', `report.json ${rep.error}`);
  const totals = rep.state === 'ok' ? rep.value?.totals : null;
  const finished = rep.state === 'ok' && totals?.usd !== undefined && totals?.usd !== null;
  const record = (source, o, extra = {}) => {
    if (!isMoney(o?.usd)) { bad('money_not_a_number', `${source}: usd is not a finite number of zero or more`); return; }
    evidence.push({ source, usd: o.usd, reservationId: typeof o.reservationId === 'string' ? o.reservationId : null, provider: o.provider ?? null, kind: typeof o.kind === 'string' ? o.kind : null, ...extra });
  };
  const supDir = join(runDir, SUPERSEDED_DIR);
  const supFiles = (() => { try { return readdirSync(supDir).filter(f => f.endsWith('.usage.json')).sort(); } catch { return []; } })();
  const readSup = file => { const r = readJsonFile(join(supDir, file)); if (r.state !== 'ok') { bad('usage_unreadable', `${SUPERSEDED_DIR}/${file} ${r.error || 'is missing'}`); return null; } return r.value; };
  if (finished) {
    if (!isMoney(totals.usd)) bad('report_totals', 'report.json totals.usd is not a finite number of zero or more');
    if (totals.supersededUsd !== undefined && !isMoney(totals.supersededUsd)) bad('report_totals', 'report.json totals.supersededUsd is not a finite number of zero or more');
    const stages = Array.isArray(rep.value.stages) ? rep.value.stages : [];
    stages.forEach(s => record(`report.stages:${s?.label}`, s));
    const absorbed = Array.isArray(rep.value.superseded) ? rep.value.superseded : [];
    absorbed.forEach(s => record(`report.superseded:${s?.label}`, s));
    if (isMoney(totals.usd) && stages.every(s => isMoney(s?.usd)) && !near(totals.usd, stages.reduce((n, s) => n + s.usd, 0) + (isMoney(totals.supersededUsd) ? totals.supersededUsd : 0))) {
      bad('report_totals', `report.json totals.usd (${totals.usd}) is not the sum of its stages plus supersededUsd`);
    }
    const labels = new Set(absorbed.map(s => s?.label));
    for (const f of supFiles) {                                                               // records written after the report was built (a post-run call): attributed from the file
      if (labels.has(`${SUPERSEDED_DIR}/${f.replace(/\.usage\.json$/, '')}`)) continue;
      const u = readSup(f); if (u) record(`${SUPERSEDED_DIR}/${f}`, u);
    }
    const old = readJsonFile(join(runDir, 'handoff-from-run.usage.json'));
    if (old.state === 'ok') record('handoff-from-run.usage.json', old.value);
  } else {
    let stagesSeen = 0;
    let top = [];
    try { top = readdirSync(runDir).filter(f => f.endsWith('.usage.json')).sort(); } catch { /* a missing folder is reported by the caller */ }
    for (const f of top) {
      const u = readJsonFile(join(runDir, f));
      if (u.state !== 'ok') { bad('usage_unreadable', `${f} ${u.error || 'is missing'}`); continue; }
      stagesSeen += 1; record(f, u.value);
    }
    for (const f of supFiles) { const u = readSup(f); if (u) record(`${SUPERSEDED_DIR}/${f}`, u); }
    if (!stagesSeen) {
      const stopped = readJsonFile(join(runDir, 'STOPPED-budget.json'));
      if (stopped.state === 'ok' && stopped.value?.spentUsd !== undefined && !isMoney(stopped.value.spentUsd)) bad('money_not_a_number', 'STOPPED-budget.json spentUsd is not a finite number of zero or more');
    }
  }
  return { evidence, finished };
}

/**
 * The files a run's cost is read from when its report.json does not read (spend.js costOfRun): every top-level `*.usage.json`, those under superseded/, the reservations file (only with a line) and
 * `STOPPED-budget.json` (only with a finite spentUsd), each as { name, sha256 } of the bytes read, sorted by name. A file that cannot be read is NOT listed (it was not read). An acceptance of an unreadable report records exactly this list.
 */
export function filesReadForFigure(runDir) {
  const names = [];
  try { for (const f of readdirSync(runDir)) if (f.endsWith('.usage.json')) names.push(f); } catch { /* no folder: nothing was read */ }
  try { for (const f of readdirSync(join(runDir, SUPERSEDED_DIR))) if (f.endsWith('.usage.json')) names.push(`${SUPERSEDED_DIR}/${f}`); } catch { /* none */ }
  // evidence, not mere presence ($0 can mean no evidence): a reservations file counts only with at least one line, STOPPED-budget.json only with a finite spentUsd
  try { if (readFileSync(join(runDir, RESERVATIONS_FILE), 'utf8').trim()) names.push(RESERVATIONS_FILE); } catch { /* absent or unreadable: not read */ }
  try { if (Number.isFinite(JSON.parse(readFileSync(join(runDir, 'STOPPED-budget.json'), 'utf8'))?.spentUsd)) names.push('STOPPED-budget.json'); } catch { /* absent, unreadable or not a figure: not read */ }
  const out = [];
  for (const name of [...new Set(names)].sort()) { try { out.push({ name, sha256: sha256Of(readFileSync(join(runDir, name), 'utf8')) }); } catch { /* unreadable: not read */ } }
  return out;
}

/**
 * The floors the tree's accepted unreadable reports set: Map run id -> the largest figure a person accepted for it (answer 1, rulings 12 Oct). An acceptance counts only with its gate fields and a cover for the
 * problem `report_unreadable` of that run. The figure is a FLOOR: the member's spend is never counted below it, and a report.json that later reads with a higher total wins.
 */
export function unreadableFloorsOf(record) {
  const floors = new Map();
  for (const e of record.events) {
    if (e.event !== 'accounting_accepted' || typeof e.gateId !== 'string' || !e.gateId || typeof e.shownSha256 !== 'string' || !Array.isArray(e.covers) || !Array.isArray(e.unreadableReports)) continue;
    for (const u of e.unreadableReports) {
      if (!u || typeof u.runId !== 'string' || !Number.isFinite(u.figureUsd) || u.figureUsd < 0) continue;
      if (!e.covers.some(c => c && c.code === 'report_unreadable' && Array.isArray(c.keys) && c.keys.includes(reportKeyOf(u.runId)))) continue;
      floors.set(u.runId, Math.max(floors.get(u.runId) ?? 0, u.figureUsd));
    }
  }
  return floors;
}

/** The floor a person accepted for a run's unreadable report, or 0. */
export const unreadableFloorOf = (record, runId) => unreadableFloorsOf(record).get(runId) ?? 0;
/** Every caller of returnedUsdOf / closeReturnOf passes the floor (no default): a close must never hand back money below an accepted figure, and a caller that forgot would do it silently. */
function mustHaveFloor(who, floorUsd) {
  if (!Number.isFinite(floorUsd) || floorUsd < 0) throw new TypeError(`${who}: the accepted floor is required (unreadableFloorOf(record, runId), 0 when none): a close never gives back money below it`);
}

/**
 * What one member has spent, as the tree counts it: the run folder's own figure (spend.js), never below the floor a person accepted for its unreadable report. THE one reader of this rule: the gate's members,
 * returnedUsdOf (so a close) and the stop screen all call it, and a scan pins that nothing else under src/tree-*.js calls runSpentUsd except the figure builder in gateTree (which wants the folder's own figure).
 * `floors` = a map already read from the record (gateTree reads it once), `floorUsd` = a number already known (a caller with no record, returnedUsdOf); else the record is read.
 */
export function memberSpentUsd(record, n, runDir, { floors = null, floorUsd = null } = {}) {
  const floor = floorUsd ?? (floors ?? unreadableFloorsOf(record)).get(n.runId) ?? 0;
  return Math.max(runDir && existsSync(runDir) ? runSpentUsd(runDir) : 0, floor);
}

/**
 * The accounting gate and the tree's spend (PLAN 7.1, 7.2). Reads the record and every member's folder; writes nothing. Returns
 *   ok          false when a check failed and a person has not accepted the charge: the tree is accounting_blocked and makes no paid start or resume
 *   problems    every failed check { code, detail, node, runId, keys }; `keys` are the `<run id>:<reservation id>` keys a person may accept with acceptAccounting (a problem with none needs its record restored)
 *   members     [{ node, generation, runId, runDir, spentUsd, started }]
 *   reservations [{ key, worstCaseUsd, row, addedUsd, ... }]: each reservation's state and its PLAN 7.1 row
 *   treeSpentUsd, addedUsd   what the tree has spent, and the part of it the reservations added
 */
export function gateTree(rootDir, { record = readTreeRecord(rootDir) } = {}) {
  const state = stateOf(record);
  const runsDir = dirname(rootDir);
  // An acceptance counts only when it carries the gate whose approval authorized it and the problems it covers (M5d: a person's decision, never a bare record); it covers EXACTLY those problems as they read then
  // (code, keys, figures), so a later, different problem about the same reservation is a new stop.
  const accepted = new Set(); const covered = new Set();
  for (const e of record.events) {
    if (e.event !== 'accounting_accepted' || typeof e.gateId !== 'string' || !e.gateId || typeof e.shownSha256 !== 'string' || !Array.isArray(e.covers)) continue;
    for (const k of e.reservationIds) accepted.add(k);
    for (const c of e.covers) if (c && typeof c.code === 'string' && Array.isArray(c.keys) && typeof c.detailSha256 === 'string') covered.add(coverSig(c.code, c.keys, c.detailSha256));
  }
  const floors = unreadableFloorsOf(record);
  const mirror = new Map();                                                                    // run id -> mirrored lines
  // ROADMAP 77: an advice run's mirror is its own event (`reservation_mirrored` keeps its node path); both feed ONE run-id map, so every check below reads an advice run exactly as it reads a member
  for (const e of record.events) if (e.event === 'reservation_mirrored' || e.event === 'advice_reservation_mirrored') { const l = mirror.get(e.runId) || []; l.push(e.line); mirror.set(e.runId, l); }
  const problems = []; const members = []; const reservations = []; const adviceRuns = [];
  const seenRun = new Set();
  let treeSpentUsd = 0; let addedUsd = 0;
  // ONE per-run inspection for a member AND for every run of a recommendation request (ROADMAP 77): no weaker check exists for an advice folder. `subject` = { runId, phase }; `nodeKey` is how problems name it; `started`: has the run begun (a folder is then owed).
  const inspect = (n, nodeKey, started) => {
    if (seenRun.has(n.runId)) return null;
    seenRun.add(n.runId);
    const runDir = join(runsDir, n.runId);
    const mine = [];                                                                           // this run's problems
    const add = (code, detail, keys = []) => mine.push({ code, detail, node: nodeKey, runId: n.runId, keys });
    const dirExists = existsSync(runDir);
    if (started && !dirExists) add('member_folder_missing', `${nodeKey} started but its run folder ${n.runId} is gone`);
    if (started && dirExists) { const rj = readJsonFile(join(runDir, 'run.json')); if (rj.state !== 'ok') add('member_run_json', `${nodeKey} started but its run.json ${rj.error || 'is missing'}`); }
    const inner = [];
    const { evidence } = dirExists ? evidenceOf(runDir, inner) : { evidence: [] };
    for (const p of inner) add(p.code, p.detail, p.keys);
    const file = dirExists ? readReservationFile(runDir) : { exists: false, lines: [], loose: [], problems: [] };
    for (const pr of file.problems) add('reservations_unreadable', pr);
    const inFile = groupById(file.lines);
    const looseFile = groupById(file.loose);
    const mirrorLines = (mirror.get(n.runId) || []);
    const inMirror = groupById(mirrorLines);
    const ids = new Set([...inFile.keys(), ...looseFile.keys(), ...inMirror.keys()]);
    const evidenceFor = id => evidence.filter(e => e.reservationId === id);
    // PLAN 7.2 items 3, 4, 6, per reservation
    for (const id of ids) {
      const key = keyOf(n.runId, id);
      const f = inFile.get(id) || { reserved: [], settled: [] }; const m = inMirror.get(id) || { reserved: [], settled: [] };
      const lf = looseFile.get(id) || { reserved: [], settled: [] };
      if (f.reserved.length > 1) add('reserved_twice', `${key} is reserved ${f.reserved.length} times in the run file`, [key]);
      if (f.settled.length > 1) add('settled_twice', `${key} is settled ${f.settled.length} times in the run file`, [key]);
      if (f.settled.length && !f.reserved.length) add('settled_without_reserved', `${key} has a settled line and no reserved line before it`, [key]);
      if (f.settled.length && f.reserved.length && f.settled[0]._at < f.reserved[0]._at) add('settled_before_reserved', `${key} is settled before it is reserved`, [key]);
      if (m.reserved.length > 1) add('reserved_twice', `${key} is mirrored as reserved ${m.reserved.length} times`, [key]);
      if (m.settled.length > 1) add('settled_twice', `${key} is settled ${m.settled.length} times in the mirror`, [key]);      // gate page 6 (budget commit 0): the mirror's own copy; before this it read as a settlement the mirror lacks, the opposite of what happened
      if (m.reserved.length && !f.reserved.length) add('mirror_ahead_of_file', `${key} is in the mirror and the run's own file lacks it`, [key]);
      if (m.reserved.length && f.reserved.length && canonicalJson(strip(m.reserved[0])) !== canonicalJson(strip(f.reserved[0]))) add('mirror_disagrees', `${key}: the mirrored reserved line differs from the run file's`, [key]);
      const ev = evidenceFor(id);
      let acceptedByGate = false;
      if (f.settled.length === 1 && f.reserved.length >= 1) {
        const s = f.settled[0];
        const mirrored = m.settled.length === 1 && canonicalJson(strip(m.settled[0])) === canonicalJson(strip(s));
        let proof = false;
        if (s.outcome === 'failed') proof = true;
        else if (s.outcome === 'recorded') proof = ev.length === 1 && near(ev[0].usd, s.usd);
        else if (s.outcome === 'billed_unreadable') { const billed = ev.filter(e => e.kind === 'billed'); proof = billed.length === 1 && near(billed[0].usd, s.usd); }
        if (!mirrored) { if (m.settled.length < 2) add('settlement_not_mirrored', `${key}: the run file settles it and the mirror does not hold the identical line`, [key]); }      // two settled lines in the mirror are named below (settled_twice), not as a missing one
        else if (!proof) add('settlement_without_evidence', `${key}: ${s.outcome} settlement of ${s.usd} is not matched by exactly one evidence record of that amount (${ev.length} carry the id)`, [key]);
        acceptedByGate = mirrored && proof;
      }
      if (f.settled.length === 0 && m.settled.length && f.reserved.length) add('mirror_settled_file_not', `${key} is settled in the mirror and open in the run file`, [key]);
      // PLAN 7.1: the tree adds a reservation only where the run's own record no longer accounts for it
      const worst = [f.reserved[0], m.reserved[0], lf.reserved[0]].find(l => l && Number.isFinite(l.usd) && l.usd > 0)?.usd ?? 0;
      const evUsd = ev.reduce((a, e) => a + e.usd, 0);
      let row; let added = 0;
      if (lf.reserved.length && !lf.settled.length) { if (ev.length) { row = 3; added = -evUsd; } else row = 2; }       // 2: runSpentUsd counts the worst case; 3: it counts it twice (worst case + evidence)
      else if (!lf.reserved.length && m.reserved.length) { row = 4; added = Math.max(0, worst - evUsd); }
      else if (lf.reserved.length && lf.settled.length) { if (acceptedByGate) row = 1; else { row = 5; added = Math.max(0, worst - evUsd); } }
      else row = 0;
      addedUsd += added;
      reservations.push({ key, runId: n.runId, id, node: nodeKey, worstCaseUsd: worst, row, addedUsd: added, evidenceUsd: evUsd, evidenceCount: ev.length, settledAccepted: acceptedByGate });
    }
    // PLAN 7.2 item 5: no paid record without a reservation
    for (const e of evidence) {
      if (e.provider === 'mock' || !(e.usd > 0)) continue;
      if (!e.reservationId || !ids.has(e.reservationId)) add('paid_record_without_reservation', `${e.source} (${e.provider}, $${e.usd}) names ${e.reservationId ? `reservation ${e.reservationId}, which no file holds` : 'no reservation'}`);
    }
    // answer 1: a report.json that does not read is acceptable only when the run's cost can be read from the files beside it - no unreadable usage file, money or reservation line, and at least one file read. The
    // problem then gets the key a person's acceptance names and the figure + files it would be made from; otherwise it keeps no key and needs its record restored. A node that is RUNNING never gets one (its own report.json is not final): the rule lives here, in the gate, so the library cannot record it either.
    const unread = mine.find(p => p.code === 'report_unreadable');
    if (unread && dirExists && n.phase !== 'running' && !mine.some(p => ['usage_unreadable', 'money_not_a_number', 'reservations_unreadable'].includes(p.code))) {
      const files = filesReadForFigure(runDir);
      if (files.length) { unread.keys = [reportKeyOf(n.runId)]; unread.figure = { runId: n.runId, figureUsd: runSpentUsd(runDir), files }; }
    }
    const spentUsd = memberSpentUsd(record, n, dirExists ? runDir : null, { floors });
    treeSpentUsd += spentUsd;
    problems.push(...mine);
    return { runDir, spentUsd };
  };
  for (const n of state.nodes.values()) {
    const started = record.events.some(e => e.event === 'node_started' && e.node === n.node && e.generation === n.generation);
    const done = inspect(n, nodeKeyOf(n), started);
    if (done) members.push({ node: n.node, generation: n.generation, runId: n.runId, runDir: done.runDir, spentUsd: done.spentUsd, started });
  }
  // A recommendation's run is owed a folder once it is SENT (the record adds it before the send, so a missing folder of an unended request is a call not made yet); a request that ended `settled` made its calls, so a missing folder is a spend nobody can read: fail closed.
  for (const a of state.advice.values()) {
    for (const r of a.runs) {
      // `started`: the folder of an advice call exists BEFORE anyone approves its brief, with no run.json yet (run-status.js DR-15), so the folder alone is not a start. The call has begun once its run.json or its reservation file exists, or the request ended `settled`.
      // While the request is open its runs are `running` (no acceptance key is offered for a report that is still being written); after the end they are `closed`.
      const dir = join(runsDir, r.runId);
      const began = existsSync(join(dir, 'run.json')) || existsSync(join(dir, 'spend-reservations.jsonl'));
      const done = inspect({ runId: r.runId, phase: a.ended ? 'closed' : 'running' }, `advice:${a.adviceId}`, a.ended?.reason === 'settled' || began);
      if (done) adviceRuns.push({ adviceId: a.adviceId, runId: r.runId, runDir: done.runDir, spentUsd: done.spentUsd });
    }
  }
  treeSpentUsd += addedUsd;
  // THE LOUD INVARIANT (gate page 12.7, C&C 14 Oct): everything the tree has spent, has in flight at its bound, holds for an unreadable spend, or has granted and not yet spent must fit the cap in force. The transition table and
  // the admission keep it true on the write path; this is the check on the READ side, so a record that breaks it (a registration written by hand above the cap, a cap amended by hand below what is committed, or a future
  // writer that allocates the same free dollars twice) fails the gate - the stance `record_corrupt` takes - instead of showing a negative `available`. Not coverable by a person's acceptance (no keys): raise the cap or fix the record.
  if (record.tree) {
    const capUsd = effectiveCapUsd(record);
    const spentOf = new Map([...members, ...adviceRuns].map(m => [m.runId, m.spentUsd]));
    const rows = nodeMoneyOf(state, spentOf);
    const heldUsd = rows.reduce((a, r) => a + r.heldUsd, 0) + adviceMoneyOf(state, spentOf).reduce((a, r) => a + r.heldUsd, 0); const unknownUsd = rows.reduce((a, r) => a + r.unreturnedUsd, 0);
    if (treeSpentUsd + unknownUsd + heldUsd > capUsd + MONEY_EPS) problems.push({ code: 'over_committed', detail: `the money already committed (${treeSpentUsd.toFixed(4)} spent or in flight, ${unknownUsd.toFixed(4)} held for a spend that cannot be read, ${heldUsd.toFixed(4)} granted and not yet spent) is more than the cap in force (${capUsd.toFixed(4)})`, node: null, runId: null, keys: [] });
  }
  const blocking = problems.filter(p => !(p.keys.length && covered.has(coverSig(p.code, p.keys, sha256Of(p.detail)))));
  return { ok: blocking.length === 0, problems: blocking, allProblems: problems, accepted: [...accepted], members, adviceRuns, reservations, treeSpentUsd, addedUsd, state };
}
const strip = l => { const { _at, ...rest } = l; return rest; };
const coverSig = (code, keys, detailSha256) => `${code}\u0000${[...keys].sort().join(',')}\u0000${detailSha256}`;
/** What an acceptance records about ONE problem it covers: its code, its reservation keys and the hash of its detail text (which carries the figures as the gate saw them). */
export const problemCover = p => ({ code: p.code, keys: [...p.keys].sort(), detailSha256: sha256Of(p.detail) });

/**
 * What a node's close gives back to the pool (PLAN 7.5): its grant (first grant plus every top-up) minus `runSpentUsd`, which counts an unsettled reservation at its worst case (the figure the cap uses), never below zero.
 * ONE function for the member's exit hook and for the person's close (src/tree-close.js). `runDir` null = the run has no folder yet (a registered node): nothing spent.
 */
export function returnedUsdOf(n, runDir, floorUsd) {
  mustHaveFloor('returnedUsdOf', floorUsd);
  return Math.max(0, n.grant.amount + n.topUps.reduce((a, t) => a + t.amount, 0) - memberSpentUsd(null, n, runDir, { floorUsd }));
}

/**
 * Whole cents, rounded DOWN (R14, Astra F8): a figure a person approves is bound at exactly the cent amount the text shows, never above it - `money()` rounds to nearest, so an unfloored 1.004 would be shown as $1.00 while
 * 1.004 was authorised, and 1.006 as $1.01. The epsilon keeps 3.3 * 100 = 329.99999999999994 from losing a cent. ONE function for what a pool GIVES: the frontier preview's grant (the ceiling is rounded UP, ceilCents).
 */
export const floorCents = n => Math.floor(n * 100 + 1e-9) / 100;
/** A sum rounded UP to the cent (a tiny float excess does not cost a whole cent). The lowest cap an amendment accepts: it is named on the screen and enforced as this one figure. Also the SHOWN and bound upper-estimate figure of a child (its ceiling, never below the raw at-most figure) and a binding at-most grant (proposeGrants). */
export const ceilCents = n => Math.ceil(n * 100 - 1e-7) / 100;

/**
 * What THE PERSON'S close gives back (PLAN 7.2, 7.5; M5 API reviews R9): -> { returnedUsd, spendUnknown }. A node that STARTED and whose run folder is gone has a spend nobody can read, and 'never as zero' (PLAN 7.2): it
 * returns nothing and its grant stays charged (budgetOf charges the part of a closed node's grant that its recorded returnedUsd did not give back). A node that never started (registered, no folder yet) has spent nothing:
 * its whole grant comes back. `n.phase === 'registered'` is that case; any other phase has started.
 */
export function closeReturnOf(n, runDir, floorUsd) {
  mustHaveFloor('closeReturnOf', floorUsd);
  const folder = typeof runDir === 'string' && existsSync(runDir);
  if (!folder && n.phase !== 'registered') return { returnedUsd: 0, spendUnknown: true };
  return { returnedUsd: returnedUsdOf(n, folder ? runDir : null, floorUsd), spendUnknown: false };
}

/**
 * The money each registered node holds, from the folded state and what each run folder shows spent (`spentOf`: run id -> USD). ONE formula for budgetOf and for the accounting gate's over-commitment check, so the two
 * can never disagree about what is held. -> [{ key, node, generation, runId, phase, isRoot, grantUsd, spentUsd, heldUsd, unreturnedUsd }].
 */
function nodeMoneyOf(state, spentOf) {
  const nodes = [];
  const dead = deadKeys(state);
  for (const n of state.nodes.values()) {
    const grantUsd = n.grant.amount + n.topUps.reduce((a, t) => a + t.amount, 0);
    const spentUsd = spentOf.get(n.runId) ?? 0;
    const isRoot = n.node === 'R';
    // held = max(0, grant - spent) over every registered node that is not closed - A ROOT GENERATION INCLUDED (the root-hold fix / gate page 12.1, C&C 14 Oct; before it `isRoot ||` held nothing): a running R@g1 holds the whole cap it
    // was granted, so `available` is 0 while it runs, and a running R@g2 holds its grant, so no second admission (a top-up, the paid recommendation, any future caller) is offered the same free dollars. A budget-stopped node is not closed, so its grant stays held (PLAN 7.3, 7.5).
    // S8 G3 (rulings row 130): a DEAD node (its plan was replaced: deadKeys) that cannot spend any more holds NOTHING - its spend stays counted, its unspent grant returns to the pool. A dead node that is still RUNNING keeps its hold until it
    // ends: its process runs to its next pause or end on its own (the decision does not stop it), and the money must not be granted a second time meanwhile. Never keyed on state.stale (a stop-stale child can still resume).
    // ROADMAP 57: an ABANDONED tree holds nothing for any node (its members can never spend again; the abandon is refused while one is alive). The spend stays counted (gateTree reads the run folders); the R9 charge below is kept.
    const heldUsd = n.phase === 'closed' || state.abandoned || (dead.has(nodeKeyOf(n)) && n.phase !== 'running') ? 0 : Math.max(0, grantUsd - spentUsd);
    // R9: a node (A ROOT GENERATION TOO since the unreturnedUsd fix, C&C 14 Oct: before it, `!isRoot` made a closed root release its whole remainder, so a dollar that may have been spent was shown as free) the person closed with a recorded returnedUsd below what its folder shows as unspent (the spend was unreadable: returnedUsd 0) keeps holding the part it did not give back. That is NOT spend:
    // treeSpentUsd stays the PLAN 7.1 sum and a node's spentUsd what its folder shows; the unknown part is its own figure, which availableUsd subtracts
    const unreturnedUsd = n.phase === 'closed' && typeof n.returnedUsd === 'number' ? Math.max(0, grantUsd - spentUsd - n.returnedUsd) : 0;
    nodes.push({ key: nodeKeyOf(n), node: n.node, generation: n.generation, runId: n.runId, phase: n.phase, isRoot, grantUsd, spentUsd, heldUsd, unreturnedUsd });
  }
  return nodes;
}

/**
 * ROADMAP 77: the money a recommendation request holds, ONE row per request, kept OUT of nodeMoneyOf's rows on purpose (AP-3: `budget.nodes` and `gate.members` stay plan-only, so no reader of either changes). held = the grant minus what its runs spent
 * (`spentOf`: run id -> USD, the gate's own figure: an unsettled reservation counts at its worst case, so the remainder is NEVER the grant plus the mirrored reservations) until the request ends, then 0; an abandoned tree holds nothing.
 * -> [{ key, adviceId, grantUsd, spentUsd, heldUsd, runIds }]
 */
export function adviceMoneyOf(state, spentOf) {
  return [...state.advice.values()].map(a => {
    const spentUsd = a.runs.reduce((t, r) => t + (spentOf.get(r.runId) ?? 0), 0);
    return { key: `advice:${a.adviceId}`, adviceId: a.adviceId, grantUsd: a.grantUsd, spentUsd, heldUsd: a.ended || state.abandoned ? 0 : Math.max(0, a.grantUsd - spentUsd), runIds: a.runs.map(r => r.runId) };
  });
}

/** The grants, what is held and what is available (PLAN 7.3), from a gate result. A node's grant is its first grant plus every top-up. */
export function budgetOf(rootDir, { record = readTreeRecord(rootDir), gate = gateTree(rootDir, { record }) } = {}) {
  const tree = record.tree;
  if (!tree) throw new Error(`${rootDir}: no tree.json`);
  const rootCapUsd = effectiveCapUsd(record);                      // the cap IN FORCE: the field keeps its name for the views; since gate page 5 it is the amended total when there is one
  const spentOf = new Map([...gate.members, ...(gate.adviceRuns ?? [])].map(m => [m.runId, m.spentUsd]));
  const nodes = nodeMoneyOf(gate.state, spentOf);
  const advice = adviceMoneyOf(gate.state, spentOf);                    // ROADMAP 77: apart from `nodes`; their holds are in heldUsd, so lifetimeCapOf's heldUsd - n.heldUsd counts them for every node
  const heldUsd = nodes.reduce((a, n) => a + n.heldUsd, 0) + advice.reduce((a, r) => a + r.heldUsd, 0);
  const unknownSpendHeldUsd = nodes.reduce((a, n) => a + n.unreturnedUsd, 0);
  const unknownSpendNodes = nodes.filter(n => n.unreturnedUsd > 0).length;
  return { rootCapUsd, treeSpentUsd: gate.treeSpentUsd, heldUsd, unknownSpendHeldUsd, unknownSpendNodes, availableUsd: rootCapUsd - gate.treeSpentUsd - unknownSpendHeldUsd - heldUsd, nodes, advice };
}

/**
 * A node's lifetime cap (PLAN 7.4): `spent + min(grant - spent, rootCap - treeSpent - heldByOthers)`. `heldByOthers` is every other child's held grant (for the root, every child's). It is a lifetime cap, not a fresh
 * allowance per resume. "No live grant" is DEFINED here, once: the min(...) is zero or less. Then `live` is false, the cap is just what is spent, and the CLI refuses the start (exit 19) instead of starting a run that
 * would claim and stop at once.
 */
export function lifetimeCapOf(budget, key) {
  const n = budget.nodes.find(x => x.key === key);
  if (!n) throw new Error(`lifetimeCapOf: ${key} is not registered`);
  const heldByOthersUsd = budget.heldUsd - n.heldUsd;
  const roomUsd = Math.min(n.grantUsd - n.spentUsd, budget.rootCapUsd - budget.treeSpentUsd - (budget.unknownSpendHeldUsd ?? 0) - heldByOthersUsd);
  return { spentUsd: n.spentUsd, grantUsd: n.grantUsd, heldByOthersUsd, roomUsd, live: roomUsd > MONEY_EPS, lifetimeCapUsd: n.spentUsd + Math.max(0, roomUsd) };
}

/**
 * What waits for money (gate page 13, Astra #15): the nodes that stopped at their cap and can still be resumed (not dead, superseded or stale), and the children of an approved frontier whose latest preview bound them
 * `refusedBy: 'budget'` and that are not registered. Pure over the record and its folded state; reads no file. -> [{ kind: 'stopped' | 'refused', key }] in a stable order. A stopped node shows up while it is stopped even when money is
 * free (a top-up is then possible); `capFactsOf` decides whether the CAP is what it waits for.
 */
export function waitingForMoney(record, state) {
  if (state.abandoned) return [];                                     // a final tree refuses every amendment: nothing waits for money there (no awaiting_cap that tells a person to amend it)
  const dead = deadKeys(state);
  const out = [];
  for (const n of state.nodes.values()) {
    const key = nodeKeyOf(n);
    if (n.phase === 'stopped' && !dead.has(key) && !state.stale.has(key) && !isSupersededGeneration(state, n.node, n.generation)) out.push({ kind: 'stopped', key });
  }
  const registered = new Set([...state.nodes.keys()]);
  const previews = new Map();
  for (const e of record.events) if (e.event === 'frontier_previewed') previews.set(e.frontierKey, e);
  for (const [fk, preview] of previews) {
    const approved = record.events.some(e => e.event === 'frontier_approved' && e.frontierKey === fk);
    if (!approved) continue;
    for (const c of preview.children ?? []) {
      const key = `${c.node}@g${c.generation}`;
      if (c.admitted === false && c.refusedBy === 'budget' && !registered.has(key) && !state.closedUnstarted.has(key) && !dead.has(key)) out.push({ kind: 'refused', key });
    }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The cap facts the readiness verdict and the amendment screen read (gate page 13). `exhausted` = something waits for money AND under a cent is free: the clean "cap exhausted" state of Astra #15. A cap with a few cents free
 * that still cannot start the next thing keeps the existing reasons (a node "stopped", a child "not admitted: budget"): this is the exhausted state only, and the limit is named on the page.
 */
export function capFactsOf(record, budget) {
  const state = stateOf(record);
  const waiting = waitingForMoney(record, state);
  return { capUsd: budget.rootCapUsd, availableUsd: budget.availableUsd, waiting, exhausted: waiting.length > 0 && budget.availableUsd < 0.01 };
}

/** The limits in force (PLAN 4.2, 8.6): the initial values in tree.json, or the `to` of the latest `limit_raised` for each. attemptsPerChild has no raise. */
export function effectiveLimits(tree, events) {
  const limits = { ...tree.limits };
  for (const e of events) if (e.event === 'limit_raised' && ['maxDepth', 'maxRuns', 'maxChildrenPerSplit'].includes(e.limit) && e.to > limits[e.limit]) limits[e.limit] = e.to;
  return limits;
}

/**
 * The size of input a child's approval is PRICED for (bundle unit, 19 Okt 2026: the grant comes from the real bundle, not from the chains' declared sizes). One number per tree: tree.json `bundleAllowanceBytes`, or the default below. The preview and the registration
 * price at THIS number (never at the bundle's own size), so `ceiling_changed` keeps meaning prices or caps moved; registration then refuses a bundle bigger than the number (`bundle_over_shown`). PROVISIONAL default (not measured on a real run): 100,000 bytes, about 25k tokens.
 */
export const DEFAULT_BUNDLE_ALLOWANCE_BYTES = 100000;
export function bundleAllowanceBytesOf(tree) { const n = tree?.bundleAllowanceBytes; return Number.isInteger(n) && n > 0 ? n : DEFAULT_BUNDLE_ALLOWANCE_BYTES; }
/** The size a ROOT re-plan is priced for: the raise its opening decision recorded (`decision_recorded.allowanceBytes`, typed by a person at a terminal for THIS one plan: --allow-size), else the tree's number. Children never use it. */
export function allowanceOfDecision(tree, decision) { const n = decision?.allowanceBytes; return Number.isInteger(n) && n > 0 ? n : bundleAllowanceBytesOf(tree); }
/** The one size function: the bytes of EVERY file of a derived bundle (the same map at preview and at registration; a file added to the map counts the moment it is in it). */
export const bundleInputBytes = files => Object.values(files ?? {}).reduce((n, t) => n + Buffer.byteLength(String(t), 'utf8'), 0);

/** The chain's own dry-run figures (PLAN 7.3): the cheapest end a grant must cover, and the at-most figure it is capped at. Calls nothing. `null` for a chain that cannot be priced. */
export function chainFigures(config, { inputBytes = null } = {}) {
  const e = dryRunReport(config, { taskChars: inputBytes }).estimate;
  // with an input size the figures are the with-task ones (they exist only when the input passes the chain's assumed prompt: else the declared figures stand)
  const floor = inputBytes !== null && Number.isFinite(e?.floorWithTaskUsd) ? e.floorWithTaskUsd : e?.floorUsd;
  const most = inputBytes !== null && Number.isFinite(e?.maximumWithTaskUsd) ? e.maximumWithTaskUsd : e?.maximumUsd;
  return Number.isFinite(floor) && Number.isFinite(most) ? { cheapestUsd: floor, atMostUsd: most } : null;
}

/**
 * Admission against the limits (PLAN 7.3): in dependency order, each against its effective value. `children` = [{ id, depth }] already in dependency order; `registeredRuns` = how many runs the tree holds (the
 * root, every child, every replacement generation; a resume is never a new run); `keptSoFar` = the children of this split already registered. Returns [{ id, admitted, reason, limit }] (`limit`: 'maxDepth' | 'maxChildrenPerSplit' | 'maxRuns' for a refusal, else null).
 */
export function admitAgainstLimits({ limits, registeredRuns, children, keptSoFar = 0 }) {
  let runs = registeredRuns; let kept = keptSoFar;      // keptSoFar: children of THIS split that are already registered (a partly registered frontier shown again, M5c5): they count against the fan-out limit
  return children.map(c => {
    // `limit` is the KEY of the refusal (which effective limit it was); `reason` is only the words a person reads, and nothing may be decided from them (M5d: what a raise reopens is keyed on `limit`)
    if (c.depth > limits.maxDepth) return { id: c.id, admitted: false, reason: 'not admitted: depth limit', limit: 'maxDepth' };
    if (kept >= limits.maxChildrenPerSplit) return { id: c.id, admitted: false, reason: 'not admitted: fan-out limit', limit: 'maxChildrenPerSplit' };
    if (runs + 1 > limits.maxRuns) return { id: c.id, admitted: false, reason: 'not admitted: run limit', limit: 'maxRuns' };
    runs += 1; kept += 1;
    return { id: c.id, admitted: true, reason: null, limit: null };
  });
}

/**
 * The split between children (PLAN 7.3, D7): each child, in dependency order, has the equal share `available / k` (k = the number of that frontier's children not yet granted) and is proposed the at-most figure when that fits the share, otherwise the share. A binding at-most is granted WHOLE, rounded up to the cent (ceilCents) when the share holds that cent, so the recorded (whole-cent) grant is never below the figure shown as its ceiling; if the share holds the raw figure but not the cent above it, the raw figure is proposed and the grant floors below it. A child is admitted only when the grant covers the chain's cheapest end; below that it is `not admitted: budget` and takes nothing.
 * `maysStopBeforeFinishing` is read from the grant that gets RECORDED (floorCents of the proposal): below the at-most figure = may stop. Grants never sum past `availableUsd` (each is at most its share).
 * `children` = [{ id, atMostUsd, cheapestUsd }]. Returns [{ id, proposedUsd, grantUsd, admitted, reason, maysStopBeforeFinishing }].
 */
export function proposeGrants({ availableUsd, children }) {
  let remaining = availableUsd;
  return children.map((c, i) => {
    const k = children.length - i;
    const share = remaining / k;
    // when the at-most figure is what binds, the child is granted that figure whole, rounded UP to the cent if the equal share holds the cent (the recorded grant is a whole cent; a floored one would sit below the figure the screen calls its ceiling). Never above the share, so grants never sum past what is available.
    const whole = c.atMostUsd <= share + MONEY_EPS && ceilCents(c.atMostUsd) <= share + MONEY_EPS ? ceilCents(c.atMostUsd) : null;
    const proposedUsd = Math.max(0, whole ?? Math.min(c.atMostUsd, share));
    const admitted = proposedUsd + MONEY_EPS >= c.cheapestUsd && proposedUsd > 0;
    if (admitted) remaining -= proposedUsd;
    // may-stop is read from the grant that gets RECORDED (a whole cent, floored): below the at-most figure = may stop
    return { id: c.id, proposedUsd, grantUsd: admitted ? proposedUsd : 0, admitted, reason: admitted ? null : 'not admitted: budget', maysStopBeforeFinishing: admitted && floorCents(proposedUsd) + MONEY_EPS < c.atMostUsd };
  });
}

/**
 * A top-up (PLAN 7.5): after a budget stop, the person gives the node more of what the root cap still has free. Library function behind `council tree decide --top-up` (the terminal verb and its gate are M5/M6).
 * Under the tree lock: the accounting gate must pass, the node must be stopped, and the amount may not exceed `available`. Appends `grant_issued`. Throws a TreeRefusal otherwise.
 */
export function topUp(rootDir, { node, generation = 1, amountUsd, gateId, shownSha256, actor, via }, { now } = {}) {
  if (!(Number.isFinite(amountUsd) && amountUsd > 0)) throw new RangeError('topUp: an amount above 0');
  // REQUIRED, like registerChildAdmitted's bundleSha256 (M5d, C&C): a top-up is a person's decision through the gate; a grant without the gate that authorized it is not a grant
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('topUp: gateId and shownSha256 (64 hex) are required: a top-up is a decision a person made through the gate');
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const gate = gateTree(rootDir, { record });
    const refuse = reason => { appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'continuation_refused', scope: `${node}@g${generation}`, check: 'top_up', detail: reason }, { now }); throw new TreeRefusal({ code: 'continuation_refused', transition: 'grant_issued', reason }); };
    if (!gate.ok) return refuse(`the accounting gate fails (${gate.problems.map(p => p.code).join(', ')})`);
    const budget = budgetOf(rootDir, { record, gate });
    if (amountUsd > budget.availableUsd + MONEY_EPS) return refuse(`only ${budget.availableUsd.toFixed(4)} of the root cap is free; ${amountUsd} was asked`);
    // M5d: the gate whose approval authorized it and the hash of the text the person read travel on the record
    return appendTreeEventLocked(rootDir, { event: 'grant_issued', node, generation, amount: amountUsd, unit: 'usd', gateId, shownSha256, actor, via }, { now });
  });
}

/**
 * A cap amendment (gate page 5, Astra #15): the person types a NEW TOTAL for the whole tree. Library function behind `council tree decide --amend-cap` (the form and its gate text are the next commit). Under the tree lock:
 * the accounting gate must pass (the committed exposure cannot be shown otherwise); the revision the person read must be the next one (a stale reading is refused, so two amendments cannot both be applied to what only one
 * of them saw); the total must differ from the cap in force and may never be below what is ALREADY COMMITTED (spent + in-flight bounds + holds for an unreadable spend + unspent grants of live registered nodes); the lowest
 * total accepted now is named. A raise ADDS authorization: nothing starts, nothing is reset, and no stop is cleared (a record_corrupt / privacy / human-rejection stop stands). Running members keep the cap they claimed
 * with; a raise reaches a member at its NEXT claim. An abandoned tree refuses it in the table. Like topUp it needs the gate that authorized it. Throws a TreeRefusal after writing a `blocked` record.
 */
export function amendCap(rootDir, { toCapUsd, expectedRevision, gateId, shownSha256, actor, via }, { now } = {}) {
  if (!(Number.isFinite(toCapUsd) && toCapUsd > 0)) throw new RangeError('amendCap: a finite total above 0');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('amendCap: expectedRevision (the revision the person read, a whole number from 1)');
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('amendCap: gateId and shownSha256 (64 hex) are required: a new total is a decision a person made through the gate');
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const gate = gateTree(rootDir, { record });
    const refuse = reason => { appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'continuation_refused', scope: 'tree', check: 'amend_cap', detail: reason }, { now }); throw new TreeRefusal({ code: 'continuation_refused', transition: 'cap_amended', reason }); };
    // `over_committed` is the one problem a raise CURES (a cap that was lowered by hand, or grants written above it): it does not stop the amendment, every other problem does
    const blocking = gate.problems.filter(p => p.code !== 'over_committed');
    if (blocking.length) return refuse(`the accounting gate fails (${blocking.map(p => p.code).join(', ')})`);
    const budget = budgetOf(rootDir, { record, gate });
    const committedUsd = budget.treeSpentUsd + budget.unknownSpendHeldUsd + budget.heldUsd;
    const floorUsd = ceilCents(committedUsd);                                  // ONE figure named and enforced: the committed exposure rounded UP to the cent (budget commit 2; before, toFixed(4) could name a total the check then refused)
    const revision = gate.state.capAmendments.length + 1;
    if (expectedRevision !== revision) return refuse(`the cap was amended since you read it (this would be amendment ${revision}, not ${expectedRevision}): read the tree again`);
    if (Math.abs(toCapUsd - budget.rootCapUsd) <= MONEY_EPS) return refuse(`${toCapUsd} is the cap already in force: nothing to amend`);
    if (toCapUsd + MONEY_EPS < floorUsd) return refuse(`${toCapUsd} is below the ${floorUsd.toFixed(2)} already committed (spent or in flight ${budget.treeSpentUsd.toFixed(4)}, held for an unreadable spend ${budget.unknownSpendHeldUsd.toFixed(4)}, granted and not yet spent ${budget.heldUsd.toFixed(4)}); the lowest total accepted now is ${floorUsd.toFixed(2)}`);
    return appendTreeEventLocked(rootDir, { event: 'cap_amended', fromCapUsd: budget.rootCapUsd, toCapUsd, expectedRevision, gateId, shownSha256, actor, via }, { now });
  });
}

/**
 * The person accepts a charge the gate cannot prove (PLAN 7.2): library function behind `council tree decide --accounting`. Appends `accounting_accepted` naming the `<run id>:<reservation id>` keys; the block lifts
 * for those keys and each stays in treeSpent at its PLAN 7.1 contribution (an accepted charge is still reconciled, so a duplicate is never made authoritative). It never edits a money record.
 */
export function acceptAccounting(rootDir, { keys, gateId, shownSha256, actor, via, expectCovers = null, expectFigures = null }, { now } = {}) {
  if (!Array.isArray(keys) || !keys.length || keys.some(k => typeof k !== 'string' || !k.includes(':'))) throw new TypeError('acceptAccounting: keys = ["<run id>:<reservation id>", ...]');
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('acceptAccounting: gateId and shownSha256 (64 hex) are required: an acceptance is a decision a person made through the gate');
  return withTreeLock(rootDir, () => {
    const record = readTreeRecord(rootDir);
    const gate = gateTree(rootDir, { record });
    const wanted = new Set(keys);
    // exactly the problems that stand NOW and name only these keys; each is recorded with its code and the hash of its figures
    const covers = gate.problems.filter(p => p.keys.length && p.keys.every(k => wanted.has(k))).map(problemCover);
    // R4 (M5 API reviews): when the caller names the problems the person was SHOWN (`expectCovers`, problemCover of each), the acceptance covers exactly those and no others: a problem that appeared, went away or reads with other
    // figures between the screen and this lock is "changed while you read", refused and recorded as nothing
    if (expectCovers !== null) {
      const sig = c => coverSig(c.code, c.keys, c.detailSha256);
      const shown = new Set(expectCovers.map(sig)); const now_ = new Set(covers.map(sig));
      if (shown.size !== now_.size || [...shown].some(x => !now_.has(x))) throw new TreeRefusal({ code: 'continuation_refused', transition: 'accounting_accepted', reason: 'the accounting problems changed while you read them (a problem appeared, went away or reads with other figures): nothing was accepted; run the command again to see them' });
    }
    // answer 1: the figure of an unreadable report is not in the problem's detail text, so the cover cannot bind it; the form passes the figures and file hashes it SHOWN and they are compared here, under the lock
    if (expectFigures !== null) {
      const sigOf = f => canonicalJson({ runId: f.runId, figureUsd: Math.round(f.figureUsd * 1e9), files: f.files.map(x => [x.name, x.sha256]) });
      const now_ = gate.problems.filter(p => p.figure && p.keys.every(k => wanted.has(k))).map(p => sigOf(p.figure)).sort();
      const shown = expectFigures.map(sigOf).sort();
      if (shown.length !== now_.length || shown.some((x, i) => x !== now_[i])) throw new TreeRefusal({ code: 'continuation_refused', transition: 'accounting_accepted', reason: 'the accounting problems changed while you read them (a problem appeared, went away or reads with other figures): nothing was accepted; run the command again to see them as they are now' });
    }
    if (!covers.length) {
      appendTreeEventLocked(rootDir, { event: 'blocked', reason: 'continuation_refused', scope: 'tree', check: 'accounting_accept', detail: 'the accounting gate has no problem about those reservations that an acceptance could cover' }, { now });
      throw new TreeRefusal({ code: 'continuation_refused', transition: 'accounting_accepted', reason: 'nothing to accept: the accounting gate has no problem about those reservations that an acceptance could cover' });
    }
    // answer 1: a cover of `report_unreadable` carries the figure and the files read, recomputed here under the lock from the same reading the gate made
    const unreadableReports = gate.problems.filter(p => p.figure && covers.some(c => c.code === p.code && c.keys.length === p.keys.length && c.keys.every((k, i) => k === [...p.keys].sort()[i]))).map(p => p.figure);
    return appendTreeEventLocked(rootDir, { event: 'accounting_accepted', reservationIds: keys, covers, ...(unreadableReports.length ? { unreadableReports } : {}), gateId, shownSha256, actor, via }, { now });
  });
}
