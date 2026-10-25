// The verdict envelope (ROADMAP 74's V half; Layered_Panel_Contract.md section 14 and Review/Build_0.8.3/m6-closing/E3b_Gate_Page.md, ruled 14 Oct 2026). A critic's reply that states a verdict must carry a
// review_id and a draft_id this CALL expects, so a verdict-shaped object quoted from the draft, from a relay seat's earlier verdict or from an old example can never be taken as the seat's own.
//
// SCOPE OF THE PROPERTY (C&C condition C1): the ids are secret from nothing that has filesystem access to the run folder (the record `<label>.envelope.json` and the prompt both sit there). The envelope protects
// against QUOTED material inside the prompt, NOT against a seat with disk access; an external session that reads the record is the intended path. Nobody may later claim a stronger property.
//
// ONE record per critic INVOKE label (panel-N-<lab><tag>, -answered, -retry, -reaskN ...), built from that call's own shown draft; a resume reads the recorded pair and never regenerates it, and it must be read BEFORE the
// prompt is built (the stage cache replays by prompt hash: a different prompt is a miss and re-pays). UNIT ONE: chain.js imports the id predicate (isEnvelopePair) only; no shipped call site passes `expect`.
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { nextSupersededN, SUPERSEDED_DIR } from './superseded-n.js';
import { mkdirSync } from 'node:fs';

/** The one rule for a usable pair (a stored record, a fresh one, a parseJson `expect`): both ids are 12 lowercase hex characters. A corrupt record is "no data", never a throw. */
export const isEnvelopePair = p => !!p && /^[0-9a-f]{12}$/.test(p.review_id ?? '') && /^[0-9a-f]{12}$/.test(p.draft_id ?? '');

let randomHex = () => randomBytes(6).toString('hex'); // 12 hex characters of OS randomness; unpredictable, not derived from anything a seat can see
/** Test seam (backend rule 10): replace the source of the nonce. Pass nothing to restore the default. */
export function setEnvelopeRandom(fn) { randomHex = fn || (() => randomBytes(6).toString('hex')); }

let inForce = false;
/** Whether this RUN uses the envelope. Decided once at the start from the recorded run.json flag (`verdict_envelope`), never from the record on disk: a run started without it never issues one, a run started with it always does. */
export function setEnvelopeInForce(on) { inForce = on === true; }
export const envelopeInForce = () => inForce;

let store = null;
/** The one place the envelope record is read and written ({ read(label) -> record|null, write(label, record) }), set per run folder like setCache. null = no store: issueEnvelope throws. */
export function setEnvelopeStore(s) { store = s || null; }

/** draft_id: the first 12 hex of the sha256 of the draft text AS SHOWN to the seat on this call (in patch mode: the draft plus the changes since the last review). */
export const draftIdOf = shownDraft => createHash('sha256').update(String(shownDraft ?? ''), 'utf8').digest('hex').slice(0, 12);

/**
 * The pair a call expects, recorded BEFORE the call is sent. A recorded pair for this label whose draft_id still matches the draft shown now is returned as it is (a resume replays the recorded value; nothing is
 * regenerated). A recorded pair whose draft_id does not match is stale (the draft is not the one it was issued for, so the cached stage cannot be replayed either): a fresh pair replaces it.
 */
export function issueEnvelope(label, shownDraft) {
  if (!store) throw new Error('verdict envelope: no envelope store is set (setEnvelopeStore), so a pair cannot be recorded before the call');
  const draft_id = draftIdOf(shownDraft);
  const recorded = store.read(label);
  if (isEnvelopePair(recorded) && recorded.draft_id === draft_id) return recorded;
  // The pair is keyed to (label, draft_id). A record for another draft (path A) or one that cannot be used (path F, corrupt) is MOVED ASIDE, never overwritten or deleted (gate page section 11.2).
  store.supersede?.(label);
  const record = { review_id: randomHex(), draft_id, label };
  store.write(label, record);
  return record;
}

/** The store for a run folder: `<runDir>/<label>.envelope.json`, written by temp file + rename so a crash never leaves half a record; an unreadable or malformed record reads as none. */
export function fileEnvelopeStore(runDir) {
  const path = label => join(runDir, `${label}.envelope.json`);
  return {
    read(label) {
      const p = path(label);
      if (!existsSync(p)) return null;
      try { const r = JSON.parse(readFileSync(p, 'utf8')); return isEnvelopePair(r) ? r : null; } catch { return null; }
    },
    /** Move the live record (if any) to `superseded/<label>.<n>.envelope.json`, n shared with the stage files; a no-op without a file. Returns the n or null. */
    supersede(label) {
      const p = path(label);
      if (!existsSync(p)) return null;
      const dir = join(runDir, SUPERSEDED_DIR);
      mkdirSync(dir, { recursive: true });
      const n = nextSupersededN(runDir, label);
      renameSync(p, join(dir, `${label}.${n}.envelope.json`));
      return n;
    },
    write(label, record) { const p = path(label); writeFileSync(`${p}.tmp`, JSON.stringify(record)); renameSync(`${p}.tmp`, p); },
  };
}

/** What a scripted mock seat (or any reader of a prompt) uses to find the ids, independent of the held sentence's wording: the 12-hex value after each id name (last occurrence). null when absent. */
export function idsFromPrompt(text) {
  // The LAST match: the envelope section is the last thing in the prompt, so an id-shaped string quoted in the draft cannot steer a reader. A digit within 40 characters before the value breaks the match (stated limit).
  const last = name => [...String(text).matchAll(new RegExp(`${name}\\D{0,40}([0-9a-f]{12})`, 'g'))].at(-1)?.[1];
  const review_id = last('review_id');
  const draft_id = last('draft_id');
  return review_id && draft_id ? { review_id, draft_id } : null;
}

/**
 * Whether a SIDE run (--rematch, --replay) uses the envelope, decided once per folder and RECORDED at the start in `<dir>/verdict-envelope.json` {"in_force": true}: a side folder has no run.json start record of its own,
 * and a replay folder must not get one (run-status reads "no run.json" as "before start"). Recorded wins (sticky: with the sentence missing it fails loud at the first critic call, as for a main run); a folder that
 * already holds stage files and no record was started without the envelope = false; a fresh or reused-empty folder = the Reply identity sentence exists (`sentenceExists`). The record is written only when true.
 * Stated hole: none for rematch/replay folders created after this record exists; a folder whose sitting began before it existed is read as "started without".
 */
export function sideEnvelopeFlag(dir, startedAlready, sentenceExists) {
  const file = join(dir, 'verdict-envelope.json');
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf8')).in_force === true; } catch { return false; } }
  if (startedAlready || !sentenceExists) return false;
  writeFileSync(`${file}.tmp`, JSON.stringify({ in_force: true }));
  renameSync(`${file}.tmp`, file);
  return true;
}
