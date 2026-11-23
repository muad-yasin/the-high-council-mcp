// The handler's re-tags (M1, S19 (c); copy N23, W38; his 31 Okt 2026 words "Handler session or layer-3 have permission to change severity tags"): a change of ONE objection's rating, from the NEXT pass on, is the handler session's OWN act. It needs no
// answer from the person, so there is no gate: `council retag-add` appends one line to `retags.jsonl` in the run folder, and the next resume reads the file and applies each line at the top of its own pass (src/chain.js applyHandlerRetags). The old rating
// is not computed here: the severity run records it when the act is applied (report.json `severity.retags`: id, from, to, by, reason, pass). A line is never rewritten or dropped; there is no undo.
// The earlier design asked the person for each re-tag through a gate of kind `retag` (src/gate.js requestRetag). That kind never shipped; a ledger that still carries a gate of it is NAMED at resume (src/gate.js gatesOfKind, called by src/cli.js) and sets nothing.
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RETAGS_FILE = 'retags.jsonl';
export const RETAG_ACTOR = 'handler';
const ID = /^[OL]-\w+(?:#r?\d+)?$/;   // 0.8.4 S18 (Q3 (a)): an objection id (O-...) or a late finding's id (L-...)
const refuse = (code, message) => ({ ok: false, code, message });
const valid = r => Number.isInteger(r?.pass) && r.pass >= 1 && typeof r.id === 'string' && ID.test(r.id)
  && typeof r.severity === 'number' && r.severity >= 1 && r.severity <= 10 && Math.abs(r.severity * 10 - Math.round(r.severity * 10)) < 1e-9
  && typeof r.reason === 'string' && r.reason.trim().length > 0 && r.reason.trim() === r.reason && !/[\r\n]/.test(r.reason);

/** Reads the file: { ok, retags: [{ pass, id, severity, reason, actor, at }], unreadable: [{ line, why }] }, oldest first. A line that cannot be read is listed, never dropped (the caller refuses to go on). A missing file is no re-tag. */
export function handlerRetagsOf(runDir) {
  const path = join(runDir, RETAGS_FILE);
  if (!existsSync(path)) return { ok: true, retags: [], unreadable: [] };
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return { ok: false, retags: [], unreadable: [{ line: 0, why: 'the file cannot be read' }] }; }
  const out = { ok: true, retags: [], unreadable: [] };
  text.split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    let r = null;
    try { r = JSON.parse(raw); } catch { /* listed below */ }
    if (!r || typeof r !== 'object' || !valid(r) || r.actor !== RETAG_ACTOR || typeof r.at !== 'string') { out.unreadable.push({ line: i + 1, why: 'it is not a re-tag line' }); return; }
    if (out.retags.some(x => x.pass === r.pass && x.id === r.id)) { out.unreadable.push({ line: i + 1, why: `a second re-tag of ${r.id} for pass ${r.pass}` }); return; }
    out.retags.push({ pass: r.pass, id: r.id, severity: r.severity, reason: r.reason, actor: r.actor, at: r.at });
  });
  return out;
}

/**
 * Records one re-tag. Refuses, writing nothing: retag_invalid (no pass, an id that is not an objection id, a rating that is not a number from 1 to 10 in steps of 0.1, no reason or one that runs over lines),
 * retag_file_unreadable (the file already holds a line that cannot be read), retag_duplicate (one per objection per pass). One write and an fsync, so a re-tag the command reported is on disk.
 */
export function addHandlerRetag(runDir, { pass, id, severity, reason }, { now = () => Date.now() } = {}) {
  const clean = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() : reason;
  if (!valid({ pass, id, severity, reason: clean })) return refuse('retag_invalid', 'a re-tag needs a pass number, an objection id (O-... or L-...), a rating from 1 to 10 in steps of 0.1 and a reason.');   // A-DRAFT
  const have = handlerRetagsOf(runDir);
  if (!have.ok || have.unreadable.length) return refuse('retag_file_unreadable', `${RETAGS_FILE} in this run folder holds a line that cannot be read (${have.unreadable[0]?.why ?? 'it cannot be read'}).`);   // A-DRAFT
  if (have.retags.some(r => r.pass === pass && r.id === id)) return refuse('retag_duplicate', `a re-tag of ${id} is already recorded for pass ${pass}.`);   // A-DRAFT
  const retag = { pass, id, severity, reason: clean, actor: RETAG_ACTOR, at: new Date(now()).toISOString() };
  const path = join(runDir, RETAGS_FILE);
  const fd = openSync(path, 'a');
  try { appendFileSync(fd, `${JSON.stringify(retag)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  return { ok: true, retag };
}
