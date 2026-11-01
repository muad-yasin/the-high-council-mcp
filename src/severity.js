// Severity tags on objections (B3 prep, JUDGE lane, unit 1: the CONTRACT). Pure: nothing here reads a clock, a file or a provider, and no model is called. The wiring comes in later units; this file is the one place
// that says what a severity IS, which band it falls in, what holds a sign-off or a climb, who may change a tag, what "settled" means, and what the record carries. Every sentence below is mechanism, not prompt wording; the
// words a judge reads are A-DRAFT and live in src/roles.js (a later unit), shown once at the wording review.
//
// THE DECISIONS (Muad, 31 Okt 2026, in chat; binding text: the B3 PREP heading and its amendments in the maintainer's board):
//   - a 1-10 scale, CVSS-like bands; 7 to 10 blocks a sign-off until the objection is FIXED; 4 to 6.9 blocks it until the debate SETTLES it; below 4 does not block (his closing round is the final read);
//   - the handler session or layer 3 may raise or lower a tag; no other seat may;
//   - a plan CLIMBS a layer only when no objection rated 4 or above is open (his "A"; a 5 was tried and withdrawn: "4 was good already");
//   - the 4 and 7 lines are a start: B3 records every rating and the lines are tuned after B3 from what it records.
//
// THE GRAMMAR. A severity is a JSON number from 1 to 10 in steps of 0.1. Nothing else is a severity: not a string ("7", "high"), not 0, not 10.1, not null. A missing or unreadable tag is NEVER read as "below 4" and is
// never given a default number (a defaulted number would record a value the seat did not produce): on a chain with the switch on it makes the verdict unreadable (an abstention). The re-ask loop that already existed re-asks an unheard seat only
// when every heard reviewer is clean, so a missing tag gets ONE re-ask with a note (src/chain.js askLayer, unit V), whatever the other judges did; a seat still without a readable tag after it is not heard. Failures the harness itself writes (a FAILED table row the judge left out of its list; the "meets:false, nothing named" objection) carry no severity, so they take the same path.
//
// THE SWITCH. `severity: { enabled: true }` in a chain. Off (absent or false) means byte-identical prompts, verdicts and records: no code path reads a severity, no line is added to a prompt. The switch is for a unanimous
// panel only (lintSeverityChain): in "first" mode a tag would be ignored without a word, and a switch that does nothing silently is refused instead.
//
// THE BANDS (bandOf): below 4 = 'sweep' (does not block; the final read records it); 4 to 6.9 = 'settle'; 7 to 10 = 'fix'. The thresholds below are dated constants, tuned after B3.
//
// WHAT HOLDS WHAT. An objection rated 4 or above that is not settled holds its layer's sign-off AND holds the climb (holdsSignOff, holdsClimb are the same line today; they are two functions because his two rules are two rules and
// the lines may be tuned apart). What settles one (settleVerdict, settleStateOf), each an observable the code already produces:
//   'withdrawn' = the raiser's own argued withdrawal in the layer exchange (src/layer-debate.js outcomeOf);
//   'fixed'     = a withdrawal in the answer-back whose quote is found in the REVISED draft (src/answer-back.js applyAnswers: effect 'withdrawn', quoted true, not quoted_from 'reviewer': a quote from another reviewer's evidence is a judge persuaded, recorded 'withdrawn'). The word "fixed" typed by a judge is NOT this: the answer-back reads
//                 it as an unreadable answer and carries the objection;
// Nothing else settles: a tie among the other judges, silence, an unreadable post, a plain keep, a declined line from the writer, a head count of any kind (the count rule was WITHDRAWN on the maintainer's word, 1 Nov 2026). The exchange never closes an objection by head count of CONTESTS (outcomeOf), and that is kept. A re-tag below 4 by layer 3 (or the handler) also releases one: it changes the value in force, not the state.
// THE BANDS DO NOT DIFFER IN WHAT RELEASES THEM: a withdrawal by the raiser settles every band (a seat that was shown to be wrong is not holding a defect); the other reading (a 7 or above is settled by a fix only) is NOT built.
//
// WHO MAY CHANGE A TAG. Only the handler session ('handler': a typed, relayed, recorded control, like the relayed cap raise) and layer 3 ('layer3': a field of its verdict naming the objection id). A change is
// { id, from, to, by, reason, pass }: the reason is required (a downgrade without a stated reason is the silent downgrade the grading systems warn about), the original tag stays in the record beside the change, and the
// id of the objection never changes (src/objection-ids.js hashes lab, criterion and quote only). The writer, the raiser and any other judge cannot re-tag, and a reply that carries a `severity` is not applied.
// A raiser's `amend` rewrites the problem text only. An invalid change is ignored (never applied) and the caller records that it was refused.
//
// COPIES. Wherever an objection is rebuilt with named fields, `severity` is carried (the unit-2 list: answer-back.js buildAnswerBack and asFailure, layer-debate.js exchangeObjections, chain.js adoptedNow and the row copies,
// the dispute stage's records belong to another lane, CACHE unit D). Where two copies of one id merge, the highest readable tag wins (mergeSeverity); an unreadable copy never lowers a readable one. A new objection named in an exchange post is asked to carry a severity; if it carries none that
// is readable it is KEPT (a failure a judge raised is never dropped for lacking a tag: that would fail open), with severity null and band 'unreadable': it holds sign-off and the climb until it is settled or the handler or layer 3
// tags it, and the record shows null, never a number. There is no re-ask route for a post. Blind verdicts keep the re-ask.
//
// THE RECORD (all additive; nothing renamed). Each `objection` in report.json (signoff[].objections[], critique failures, layer_debates[] rows) may carry `severity` (the raiser's own tag).
// A new top-level `severity` section holds endRecord(): { lines, open_at_end[], swept[], retags[] } - every objection rated 4 or above still open at an end with its original tag, its effective tag, its band, its state and
// its changes; the swept (below 4) ones; and every valid re-tag in the order made. `severity` and `layer_debates` (written today, declared nowhere) are added to schemas/report-v1.json in unit 2, the unit that writes the section.
//
// THE BUILD LIST does not exist in the code today: the nearest records are report.json `dispute.open_objections`, which another lane owns (and `council handoff --from-run`, which rebuilds HANDOFF.md from report.json; the run's own handoff stage is built from the deliverable text).
// THE CLOSING ROUND IS THE FINAL READ (his answer, 1 Nov 2026): the top layer reads the final text once (src/final-read.js); a seat whose every objection there is rated below 4 is recorded as a sweep. There is no separate call per seat: the sweep prompt and its contract were REMOVED.
export const SEVERITY_SCALE = Object.freeze({ min: 1, max: 10, step: 0.1 });
// Muad, 31 Okt 2026 20:51: 7 to 10 until fixed, 4 to 6.9 until the debate settles it, below 4 not blocking. A start, tuned after B3 from what B3 records.
export const SEVERITY_LINES = Object.freeze({ settle: 4, fix: 7 });

export const SETTLE_WORDS = Object.freeze(['withdrawn', 'fixed']);
export const RETAG_BY = Object.freeze(['handler', 'layer3']);

const isTenth = v => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;

/** The severity as a seat wrote it -> { ok: true, value } | { ok: false, why }. A JSON number only; never a word, never a string of digits. */
export function readSeverity(raw) {
  if (typeof raw !== 'number') return { ok: false, why: raw === undefined || raw === null ? 'no severity was given' : `severity is ${Array.isArray(raw) ? 'a list' : typeof raw}, not a number` };
  if (!Number.isFinite(raw)) return { ok: false, why: 'severity is not a finite number' };
  if (raw < SEVERITY_SCALE.min || raw > SEVERITY_SCALE.max) return { ok: false, why: `severity ${raw} is outside ${SEVERITY_SCALE.min} to ${SEVERITY_SCALE.max}` };
  if (!isTenth(raw)) return { ok: false, why: `severity ${raw} has more than one decimal place` };
  return { ok: true, value: raw };
}

const need = v => { const r = readSeverity(v); if (!r.ok) throw new Error(`severity: ${r.why}`); return r.value; };

/** 'sweep' (below 4), 'settle' (4 to 6.9) or 'fix' (7 to 10). Throws on anything that is not a readable severity: a band is never guessed. */
export function bandOf(value) {
  const v = need(value);
  return v >= SEVERITY_LINES.fix ? 'fix' : v >= SEVERITY_LINES.settle ? 'settle' : 'sweep';
}
/** An objection with no readable tag is HELD (never read as below 4, never a throw). */
export const holdsSignOff = value => !readSeverity(value).ok || bandOf(value) !== 'sweep';
export const holdsClimb = value => !readSeverity(value).ok || bandOf(value) !== 'sweep';

/** The tag on an objection (or any object with a `severity`), read: { ok, value } | { ok: false, why }. */
export const severityOf = f => (f && typeof f === 'object' ? readSeverity(f.severity) : { ok: false, why: 'no objection' });

/** A change is usable only from the handler or layer 3, with an objection id, a readable new value, a stated reason and a pass number. -> { ok: true } | { ok: false, why }. */
export function checkRetag(change) {
  if (!change || typeof change !== 'object') return { ok: false, why: 'the change is not an object' };
  if (!RETAG_BY.includes(change.by)) return { ok: false, why: `only ${RETAG_BY.join(' or ')} may change a tag, not ${JSON.stringify(change.by)}` };
  if (typeof change.id !== 'string' || !/^O-\w+$/.test(change.id)) return { ok: false, why: 'the change names no objection id' };
  const to = readSeverity(change.to);
  if (!to.ok) return { ok: false, why: `the new value is unreadable: ${to.why}` };
  if (typeof change.reason !== 'string' || !change.reason.trim()) return { ok: false, why: 'a change needs a stated reason' };
  if (!Number.isInteger(change.pass) || change.pass < 1) return { ok: false, why: 'a change names the pass it was made in' };
  return { ok: true };
}

const validChanges = (id, changes) => (Array.isArray(changes) ? changes : []).filter(c => c && c.id === id && checkRetag(c).ok);

/** The tag in force for an objection: the latest valid change naming its id, else the raiser's own readable tag, else null (no readable tag). */
export function effectiveSeverity(objection, changes = []) {
  const mine = validChanges(objection?.id, changes);
  if (mine.length) return mine.at(-1).to;
  const own = severityOf(objection);
  return own.ok ? own.value : null;
}

/** Does a withdrawal (the raiser's own argued withdrawal, in the exchange or in the answer-back) settle an objection of this band? His reading, confirmed in his answers to the open picks (detail-file heading "HIS ANSWERS TO THE OPEN PICKS"): it settles EVERY band, a withdrawn 7 or above included (the record keeps the ORIGINAL tag with the state `withdrawn`).
 * This is the ONE place the reading lives, so a different answer is a one-line change here; `settleVerdict` and the record builder both read it. (What a withdrawal DOES in a run, removing the objection from the list, is the older code of the exchange and the answer-back and is not behind this predicate.) */
export const withdrawalSettles = _band => true;

/** Does this list of objections leave the sign-off free? True when none of them holds it (every one is readable and below the settle line). The empty list is free. */
export const severityMeets = failures => !(failures || []).some(f => holdsSignOff(f?.severity));

/** 'settled' | 'sweep' | 'open'. `state` is a disposition word (see settleStateOf). A settle word settles; a missing or unreadable tag is never read as below 4: it is 'open' until settled. */
export function settleVerdict(value, state) {
  const r = readSeverity(value);
  if (SETTLE_WORDS.includes(state)) return withdrawalSettles(r.ok ? bandOf(r.value) : 'unreadable') ? 'settled' : 'open';
  if (!r.ok) return 'open';
  return r.value >= SEVERITY_LINES.settle ? 'open' : 'sweep';
}

/** The one disposition word for an objection from what the code observed: { exchange: the exchange outcome, answer: the answer-back record (effect, quoted) }. A settle word in either source wins. */
export function settleStateOf({ exchange, answer } = {}) {
  if (exchange === 'withdrawn') return 'withdrawn';
  if (answer && answer.effect === 'withdrawn' && answer.quoted === true) return answer.quoted_from === 'reviewer' ? 'withdrawn' : 'fixed';   // a quote found in ANOTHER reviewer's evidence means the judge was persuaded, not shown a fix
  return exchange || 'not_debated';
}

/** Two copies of one objection id: the highest readable tag. -> { ok, value } | { ok: false, why }. */
export function mergeSeverity(a, b) {
  const ra = readSeverity(a); const rb = readSeverity(b);
  if (ra.ok && rb.ok) return { ok: true, value: Math.max(ra.value, rb.value) };
  return ra.ok ? ra : rb.ok ? rb : ra;
}

/** The ids that hold a layer's sign-off and its climb: rated 4 or above (re-tags applied) or carrying no readable tag, and not settled. Input order. Never throws: an untagged objection is held. */
export function openAtIds(objections, changes = []) {
  return (objections || []).filter(o => settleVerdict(effectiveSeverity(o, changes), o.state) === 'open').map(o => o.id);
}

/** The loud end record: what is still open at an end, what was swept, every valid re-tag, An untagged objection is open with severity null and band 'unreadable'. */
export function endRecord(objections, changes = []) {
  const retags = (Array.isArray(changes) ? changes : []).filter(c => checkRetag(c).ok);
  const open_at_end = []; const swept = [];
  for (const o of objections || []) {
    const v = effectiveSeverity(o, changes);
    const row = { id: o.id, lab: o.lab, original: o.original !== undefined ? o.original : (severityOf(o).ok ? o.severity : null), severity: v, band: v === null ? 'unreadable' : bandOf(v), state: o.state, changes: validChanges(o.id, changes) };
    const verdict = settleVerdict(v, o.state);
    if (verdict === 'open') open_at_end.push(row); else if (verdict === 'sweep') swept.push(row);
  }
  return { lines: { ...SEVERITY_LINES }, open_at_end, swept, retags };
}

/** The chain-lint findings for the switch, as a list (empty = fine): a unanimous panel only, and no layer with a single seat (his sentence "one judge cannot hold the plan alone" cannot be honoured there, so the combination is refused, fail closed; B3's 4/3/2 layers are unaffected). */
export function lintSeverityChain(config, filePath = 'the chain file') {
  const out = [];
  if (config?.severity?.enabled !== true) return out;
  if (config.signoff !== 'unanimous') {
    // A-DRAFT (the words a person reads)
    out.push({ kind: 'severity-needs-unanimous', message: 'severity.enabled is true but this chain is not "signoff": "unanimous": a severity gate acts on the unanimous panel loop only, so in any other mode the tags would be read and ignored without a word.', fix: `Set "signoff": "unanimous" in ${filePath}, or remove severity.` });
  }
  const critics = Array.isArray(config.seats?.critics) ? config.seats.critics : [];
  const perLayer = new Map();
  for (const c of critics) perLayer.set(c?.layer ?? 1, (perLayer.get(c?.layer ?? 1) || 0) + 1);
  const lone = [...perLayer].filter(([, n]) => n === 1).map(([l]) => l);
  if (lone.length) {
    // A-DRAFT (the words a person reads)
    out.push({ kind: 'severity-one-seat-layer', message: `severity.enabled is true but layer ${lone.join(', ')} has a single seat: a layer with one seat runs no exchange, so nobody could debate an objection there, and it would hold the sign-off until its raiser withdrew it.`, fix: `Give every layer at least two seats in ${filePath}, or remove severity.` });
  }
  return out;
}

// ---- Unit 3: the run's severity ledger (one per run, in memory) and the record it becomes in report.json ----
/** The run's severity ledger. `peek` and `commit` are the ONE place a tag becomes the value in force: the FIRST VALID tag the ledger records, from a verdict that COUNTED, stands for an objection id for its life (a verdict that carries no readable tag commits nothing, so a missing tag filled
 * by a re-ask, or a thrown-away attempt, is not "no tag" and pins nothing); within one verdict the highest claim of an id wins (the caller); a later pass that claims another value is OVERRIDDEN to the first one and the override is recorded with both values and its direction
 * (a downgrade is the self-unblocking case this rule exists for; an upgrade is a judge saying it is worse and being refused). Only the handler or layer 3 may change a tag (units 4+), never the raiser. */
export function createSeverityRun() {
  const firstOf = new Map(); const overrides = []; const withdrawn = []; const retagRows = []; const retagRefused = []; let closed = null; let final = null;   // firstOf: { value: the raiser's first valid tag, pass, force?: the value a re-tag put in force }
  const key = (lab, id) => `${lab}\u0000${id}`;
  const listOf = failures => { const m = new Map(); for (const f of failures || []) { if (!f || typeof f !== 'object') continue; const k = key(f.lab, f.id); const had = firstOf.get(k); if (!m.has(k)) m.set(k, { id: f.id, lab: f.lab, severity: had ? (had.force ?? had.value) : f.severity, original: had ? had.value : (readSeverity(f.severity).ok ? f.severity : null), state: 'unresolved' }); } return [...m.values()]; };   // the record reads the value IN FORCE (a re-tag included) and keeps the raiser's first valid tag as `original`
  return {
    /** The tag in force for a verdict being READ: the first valid tag already committed for this objection, else the claimed one. No side effect (the verdict may still be thrown away: a cut-off reply, an incomplete table). */
    peek(lab, id, claimed) { const had = firstOf.get(key(lab, id)); return had ? (had.force ?? had.value) : claimed; },
    /** The value in force for an objection (a re-tag if one was applied, else the raiser's first valid tag), or null when none is known. */
    inForce(lab, id) { const had = firstOf.get(key(lab, id)); return had ? (had.force ?? had.value) : null; },
    /** A verdict that COUNTED (it ended its pass as a vote): its claimed tags become the first valid ones, or, for an id that has one, are recorded as overrides. Never called for a carried verdict (it counted in an earlier pass) or twice for one pass. */
    commit(lab, id, claimed, pass) {
      const r = readSeverity(claimed); if (!r.ok) return;
      const k = key(lab, id); const had = firstOf.get(k);
      if (!had) { firstOf.set(k, { value: r.value, pass }); return; }
      if (had.pass === pass || r.value === had.value) return;
      overrides.push({ id, lab, first: had.value, claimed: r.value, direction: r.value < had.value ? 'downgrade' : 'upgrade', pass });
    },
    withdraw(lab, id, how, pass, shown) {   // `shown`: the tag on the objection as the caller holds it, used when none was committed yet (an objection withdrawn in the exchange of the pass that raised it)
      if (withdrawn.some(w => w.lab === lab && w.id === id && w.how === how && w.pass === pass)) return;
      const sh = readSeverity(shown);
      const value = firstOf.get(key(lab, id))?.value ?? (sh.ok ? sh.value : null);
      const band = value === null ? 'unreadable' : bandOf(value);
      withdrawn.push({ id, lab, severity: value, band, state: withdrawalSettles(band) ? 'withdrawn' : 'withdrawn_unsettled', how, pass });
    },
    /** Layer 3's re-tags of ONE pass (unit 4a). `bySeat` = [{ seat, retags: [{ id, severity, reason }] }] from the COUNTED verdicts of the top layer; `ledger` = Map(id -> { lab, status, severity }) of the ledger shown this pass. Each retag is checked: a known id of an ACTIVE row of
     * that ledger, a readable new value, a stated reason, at most one per id per seat, a real change. `from` is DERIVED here (the value in force), never read from the reply. Two seats naming the same id: the HIGHER new value applies and both rows are recorded (fail closed).
     * Returns { applied: [{ id, lab, from, to }], refused } and puts the new value in force from now on (the raiser's FIRST tag stays what later claims are measured against). */
    applyRetags(pass, bySeat, ledger) {
      const accepted = [];
      for (const { seat, retags } of bySeat || []) {
        if (!Array.isArray(retags)) continue;
        const mine = new Set();
        for (const r of retags) {
          const refuse = why => retagRefused.push({ id: typeof r?.id === 'string' ? r.id : null, seat, pass, why });
          const to = readSeverity(r?.severity);
          if (typeof r?.id !== 'string' || !/^O-\w+$/.test(r.id)) { refuse('no_objection_id'); continue; }
          if (!to.ok) { refuse('unreadable_value'); continue; }
          if (typeof r.reason !== 'string' || !r.reason.trim()) { refuse('no_reason'); continue; }
          const row = ledger?.get(r.id);
          if (!row) { refuse('id_not_in_ledger'); continue; }
          if (row.status !== 'active') { refuse('row_closed'); continue; }
          if (mine.has(r.id)) { refuse('second_retag_same_pass'); continue; }
          mine.add(r.id);
          const had = firstOf.get(key(row.lab, r.id));
          const from = had ? (had.force ?? had.value) : (readSeverity(row.severity).ok ? row.severity : null);
          if (from === to.value) { refuse('no_change'); continue; }
          accepted.push({ id: r.id, lab: row.lab, seat, from, to: to.value, reason: r.reason.trim().slice(0, 600) });
        }
      }
      const applied = [];
      for (const id of [...new Set(accepted.map(a => a.id))]) {
        const group = accepted.filter(a => a.id === id); const top = Math.max(...group.map(a => a.to)); const lab = group[0].lab;
        let had = firstOf.get(key(lab, id)); if (!had) { had = { value: group[0].from, pass: 0 }; firstOf.set(key(lab, id), had); }
        had.force = top;
        for (const a of group) retagRows.push({ id, lab, seat: a.seat, from: a.from, to: a.to, applied_to: top, by: 'layer3', pass, reason: a.reason });
        applied.push({ id, lab, from: group[0].from, to: top });
      }
      return { applied, refused: retagRefused.filter(x => x.pass === pass) };
    },
    /** Layer 3's re-tags in a pass in which no ledger was shown (none built, or none for this pass): nothing is applied; every re-tag is recorded as refused with the reason, never dropped silently. */
    refuseRetags(pass, bySeat, why) {
      for (const { seat, retags } of bySeat || []) for (const r of Array.isArray(retags) ? retags : []) retagRefused.push({ id: typeof r?.id === 'string' ? r.id : null, seat, pass, why });
    },
    /** The end of a finished pass: the pass's whole list (heard, carried, sustained). The last one is what a run that stops mid-pass reports, as NOT computed. */
    closePass(pass, failures) { closed = { pass, list: listOf(failures) }; },
    /** The end of the run, reached: `failures` is the complete list (a not-agreed end: the dispute stage's openFailures; a passed end: the last pass's list, swept items only). */
    setFinal(pass, failures, passed, { nobodyHeard = false, unheard = [] } = {}) { final = { pass, list: listOf(failures), passed: passed === true, nobodyHeard: nobodyHeard === true, unheard: [...unheard] }; },
    snapshot() {
      const src = final && !final.nobodyHeard ? final : closed; if (!src) return null;   // a last pass in which no reviewer was heard computed nothing: the last pass that was heard is reported instead, as NOT computed
      const end = endRecord(src.list);
      const invariant = src === final && final.passed && end.open_at_end.length ? 'passed_with_open_objection' : undefined;
      return { computed: src === final, pass: src.pass, open: end.open_at_end, swept: end.swept, withdrawn: withdrawn.map(w => ({ ...w })), overrides: overrides.map(o => ({ ...o })), retags: retagRows.map(r => ({ ...r })), retags_refused: retagRefused.map(r => ({ ...r })), ...(src === final && final.unheard.length ? { unheard_at_end: [...final.unheard] } : {}), ...(invariant ? { invariant } : {}) };
    },
  };
}

/** report.json `severity` (experimental, additive; absent with the switch off). `unheard_at_end` names the seats that gave no usable reply in the last pass (their last objections are in the list, but anything new they would have said is not). `computed: false` means the run stopped before the end of its last pass was reached, or no reviewer was heard in it: `open_at_end` then carries the last COMPUTED pass (`as_of_pass`) or is null with
 * `not_computed` saying why: never an empty list that reads as clean. A passed run's `open_at_end` is empty; if it is not, `invariant` says so. `retags` lists layer 3's re-tags (each seat's row, the value that applied), `retags_refused` the ones refused and why. */
export function severityRecord(config, result) {
  if (config?.severity?.enabled !== true) return undefined;
  const run = result?.severityRun;
  const counts = rows => ({ downgrade: rows.filter(o => o.direction === 'downgrade').length, upgrade: rows.filter(o => o.direction === 'upgrade').length });
  if (!run) return { lines: { ...SEVERITY_LINES }, computed: false, not_computed: 'the run stopped before the end of its first pass was reached, so nothing is recorded as open or swept', open_at_end: null, swept: [], withdrawn: [], overrides: { by_direction: counts([]), rows: [] }, retags: [] };   // A-DRAFT (the words a person reads)
  return {
    lines: { ...SEVERITY_LINES }, computed: run.computed === true, as_of_pass: run.pass,
    ...(run.computed === true ? {} : { not_computed: 'the run stopped before the end of its last pass was reached: open_at_end is the last pass that was computed' }),   // A-DRAFT
    open_at_end: run.open, swept: run.swept, withdrawn: run.withdrawn, overrides: { by_direction: counts(run.overrides), rows: run.overrides },
    ...(Array.isArray(run.unheard_at_end) && run.unheard_at_end.length ? { unheard_at_end: run.unheard_at_end } : {}),
    retags: Array.isArray(run.retags) ? run.retags : [], ...(Array.isArray(run.retags_refused) && run.retags_refused.length ? { retags_refused: run.retags_refused } : {}), ...(run.invariant ? { invariant: run.invariant } : {}),
  };
}
