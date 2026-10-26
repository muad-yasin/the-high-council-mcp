// The objection ledger the TOP layer reads (E4, unit one; contract Review/Build_0.8.3/m6-closing/Layered_Panel_Contract.md section 4.5 and Astra #12/#13; gate page E4_Gate_Page.md, approved by C&C 14 Oct 2026).
// PURE: no model, no clock, no file, no module (this file has NO imports, a leaf by design: a later import would show in test/objection-ledger.test.js, and in the read-only import guard). Nothing calls it yet; unit
// two wires it into runChain behind a held sentence. State owned: none; no ledger is stored, it is derived from records the run keeps (or, for two of the inputs, captures made at the line that already reads them).
//
// objectionLedger({ openByRound, replies, reviserByRound, draftShaByRound, heardByRound, notAskedByRound, layerOf, currentRound }) -> rows, one per distinct objection (lab + id), in a TOTAL order (first round, lab, id).
//   openByRound      [{ round, failures: [{ lab, id, criterion, problem, quote? }] }]   what each judge raised in each round (chain.js openByRound)
//   replies          [{ round, lab, id, status, effect, ask?, quoted_from?, quoted_ref?, quoted_layer?, evidence? }]   the run's answer_back_replies in event order; `round` is the round the ANSWER was given;
//                    `evidence` is the judge's own reasoning text, kept in memory on the row and never serialized into report.json (gate page section 3)
//   reviserByRound   { [round]: { declined: [{ id?, reason }], draftChanged } }   the reviser's response to round r's objections (captured at the revise: answerBackLatest is rebuilt at every revise, so history is lost there)
//   draftShaByRound  { [round]: sha12 }   the 12-hex hash of the draft the panel judged in that round (captured at the round's start)
//   heardByRound     { [round]: [lab] }    labs that gave a verdict that round;  notAskedByRound  { [round]: [lab] }   labs whose layer was not asked that round
//   layerOf          { [lab]: layer };  currentRound: the round about to be asked (the ledger covers the rounds before it).
// A row: { id, raised_by: { lab, layer }, source: { round, draft_sha12 }, first_round, last_raised_round, criterion, problem, quote?, reviser: { declined, reason?, draft_changed },
//          judge: null | { last_disposition, status, round, ask?, quoted_from?, quoted_ref?, quoted_layer?, reasoning? }, observed: { not_raised_again_in? | not_asked_since? | unheard_since? }, status: 'active' | 'closed' }.
// INPUT CONTRACT (what unit two must feed; chain.js line numbers at e55a378):
//   - openByRound holds the judge's OWN raises of each round. A failure the harness carried (applyAnswers' asFailure, and a stated pass's openOwn: they carry `carried_from_round`) is a restatement, not a raise: it is
//     read as raised in the round it carries, never in the round it appears in. The failures of a CARRIED VERDICT (v.carried, `fromRound`: an unheard seat's earlier verdict kept for the round) are not this round's raises and
//     are excluded by the caller.
//   - heardByRound lists the labs with a NEW verdict that round: a carried verdict is not "heard" (it would otherwise read as "not raised again" for a lab that never re-judged). notAskedByRound comes from the layers[]
//     rows with state `not_asked`.
//   - reviserByRound is captured at the revise (chain.js ~3981 and ~4005: answerBackLatest is rebuilt there, so history is lost), draftShaByRound at the round's start; `evidence` lives on the in-memory answer row and is
//     stripped when the report is serialized (it follows the re-ask splice at ~3456/~3508).
//   - reply effects (answer_back_replies): `withdrawn` closes (only after the last own raise); `withdrawal_refused`, `sustained`, `unanswered`, `stated_pass_open`, `unreadable_answer` leave it ACTIVE; `unknown_id` is
//     IGNORED (an answer naming an id the judge no longer holds: it never changes a row). For the OBSERVATION: a round with any answer but `unanswered` is spoken for by the disposition field (no "not raised again" for it);
//     `unanswered` (silence) leaves "not raised again" as the one observation.
//   - two notions of "last": the last OWN raise decides `closed` and the observation; the last APPEARANCE (own or carried: the harness keeps a carried objection in later rounds) decides the reviser lookup.
// RULES (Astra #12/#13, the standing question "how could this record what nobody produced, or lose what somebody did"):
//   - status is 'closed' ONLY for a VALIDATED withdrawal (effect 'withdrawn': its quote was found) given AFTER the objection was last raised. Everything else is 'active': a refused withdrawal, a sustained one, an unanswered
//     or unreadable answer, a stated pass that held it open, and "not raised again", which is an OBSERVATION and never a resolution.
//   - a lab that was not asked again is "not asked since round N", never "let it go"; a lab asked and not heard is "unheard since round N".
//   - the reviser's response and the judge's disposition are SEPARATE fields; draft_changed is whether the draft changed at all, not a claim that THIS objection was fixed.
//   - ACTIVE rows are never shortened or dropped (fitLedger); only closed history may be.

/** A named tunable, with its derivation. D5's figure (contract section 4.5), kept as the character figure of the budget. */
export const LEDGER_MAX_CHARS = 40_000;
/** 40,000 characters / 4: the harness's own rule (src/cost.js estimateTokens, CHARS_PER_TOKEN 4). */
export const LEDGER_MAX_TOKENS_EST = 10_000;
/** The longest piece of a judge's reasoning shown for one row; a longer one is cut with CUT_MARK, visibly. A tunable, not a measured figure. */
export const EVIDENCE_CAP_CHARS = 800;
export const CUT_MARK = ' [cut]';
/** How many closed ids the "earlier closed rows omitted" line names; the COUNT stays exact. With more, the line says "and N more"; if even that does not fit, count only. A tunable. */
export const OMITTED_IDS_MAX = 20;

const utf8 = new TextEncoder();
/**
 * An ESTIMATE of tokens: ceil(UTF-8 bytes / 4). Equal to the harness's chars/4 for ASCII; it counts a multi-byte character by its bytes. It is an estimate that under-counts non-Latin text; tuned when an input-window table exists.
 * (CJK is about 3 bytes per character and roughly one token or more each, so it under-counts by about 25%.) No claim about quality or about any one model's tokenizer.
 */
export const tokensEst = text => Math.ceil(utf8.encode(String(text ?? '')).length / 4);
export const measure = text => ({ chars: String(text ?? '').length, tokens_est: tokensEst(text) });

const cap = (text, n) => { const t = String(text ?? '').trim(); return t.length > n ? t.slice(0, n) + CUT_MARK : t; };
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // codepoint order: no locale, no Intl

export function objectionLedger({ openByRound = [], replies = [], reviserByRound = {}, draftShaByRound = {}, heardByRound = {}, notAskedByRound = {}, layerOf = {}, currentRound = Infinity } = {}) {
  const raised = new Map(); // `${lab}\u0000${id}` -> { lab, id, rounds: Set, latest: failure }
  for (const r of openByRound) {
    for (const f of r?.failures || []) {
      if (!f?.lab || !f?.id) continue;
      const k = `${f.lab}\u0000${f.id}`;
      const e = raised.get(k) || { lab: f.lab, id: f.id, rounds: new Set(), seen: new Set(), latestRound: -Infinity, latest: [] };
      // Two notions. A failure the harness carried restates an objection first raised in `carried_from_round`; it is read as THAT round's raise, never as this one's (it must not move last_raised_round, which decides
      // `closed` and the observation). But it still APPEARS in later rounds, and the reviser answers it there: `seen` (every round it appears in, own or carried) decides the reviser lookup.
      const own = Number.isFinite(f.carried_from_round) ? f.carried_from_round : r.round;
      e.rounds.add(own); e.seen.add(r.round);
      if (own > e.latestRound) { e.latestRound = own; e.latest = [f]; } else if (own === e.latestRound) e.latest.push(f);
      raised.set(k, e);
    }
  }
  const lastReply = new Map(); // the latest reply per lab+id: by round, then by event order
  replies.forEach((p, i) => {
    if (!p?.lab || !p?.id || p.effect === 'unknown_id') return; // an answer naming an id the judge no longer holds changes nothing
    const k = `${p.lab}\u0000${p.id}`;
    const have = lastReply.get(k);
    if (!have || p.round > have.p.round || (p.round === have.p.round && i > have.i)) lastReply.set(k, { p, i });
  });
  const known = [...openByRound.map(r => r?.round), ...Object.keys(heardByRound).map(Number), ...Object.keys(notAskedByRound).map(Number)].filter(Number.isFinite);
  const upto = Math.min(currentRound - 1, known.length ? Math.max(...known) : -Infinity); // never loops on an unbounded currentRound
  const rows = [];
  for (const [k, e] of raised) {
    const rounds = [...e.rounds].sort((a, b) => a - b);
    const first = rounds[0]; const last = rounds[rounds.length - 1];
    const rv = reviserByRound[Math.max(...e.seen)]; // the LAST APPEARANCE (own or carried), not the last own raise
    const declinedHere = (rv?.declined || []).filter(d => d && d.id === e.id);
    const reviser = declinedHere.length
      ? { declined: true, reason: declinedHere.map(d => d.reason).join(' / '), draft_changed: rv?.draftChanged ?? null }
      : { declined: false, draft_changed: rv?.draftChanged ?? null };
    const got = lastReply.get(k)?.p;
    const judge = got ? {
      last_disposition: got.effect, status: got.status ?? null, round: got.round,
      ...(got.ask !== undefined ? { ask: got.ask } : {}),
      ...(got.quoted_from !== undefined ? { quoted_from: got.quoted_from } : {}),
      ...(got.quoted_ref !== undefined ? { quoted_ref: got.quoted_ref } : {}),
      ...(got.quoted_layer !== undefined ? { quoted_layer: got.quoted_layer } : {}),
      ...(typeof got.evidence === 'string' && got.evidence.trim() ? { reasoning: cap(got.evidence, EVIDENCE_CAP_CHARS) } : {}),
    } : null;
    const latest = [...e.latest].sort((x, y) => byCode(x.problem ?? '', y.problem ?? ''))[0]; // several failures under one id in a round: stable order, the problems are joined below
    const closed = judge?.last_disposition === 'withdrawn' && judge.round > last;
    const observed = {};
    if (!closed) {
      const later = []; // the rounds after the last time it was raised, up to the round just before the one about to be asked, that the run actually recorded
      for (let r = last + 1; r <= upto; r++) later.push(r);
      // A round in which the judge ANSWERED this id (any effect but `unanswered`: withdrawn, refused, sustained, stated_pass_open, unreadable_answer) is spoken for by the disposition field, so it is no "not raised again"
      // round: a sustained answer is carried by the harness and would otherwise read as "looks fixed" beside "still open". Silence (`unanswered`) is the observation left.
      const answered = r => replies.some(p => p?.lab === e.lab && p.id === e.id && p.round === r && p.effect && p.effect !== 'unanswered' && p.effect !== 'unknown_id');
      const heard = later.find(r => (heardByRound[r] || []).includes(e.lab) && !answered(r));
      if (heard !== undefined) observed.not_raised_again_in = heard;
      else if (later.some(r => (notAskedByRound[r] || []).includes(e.lab))) observed.not_asked_since = last;
      else if (later.length) observed.unheard_since = last;
    }
    rows.push({
      id: e.id, raised_by: { lab: e.lab, layer: layerOf[e.lab] ?? null }, source: { round: first, draft_sha12: draftShaByRound[first] ?? null }, first_round: first, last_raised_round: last,
      criterion: latest.criterion ?? '', problem: [...new Set(e.latest.map(x => x.problem ?? '').filter(Boolean))].sort(byCode).join(' / '), ...(latest.quote ? { quote: latest.quote } : {}), reviser, judge, observed, status: closed ? 'closed' : 'active',
    });
  }
  rows.sort((a, b) => a.first_round - b.first_round || byCode(a.raised_by.lab, b.raised_by.lab) || byCode(a.id, b.id));
  return rows;
}

/**
 * Fits the ledger into the budget WITHOUT touching an active row. `render({ rows, omitted })` is the held sentence's function (or a test's): it returns the exact text that would be sent.
 * Order: (1) as is; (2) closed rows compacted (`compact: true`, the renderer prints one line); (3) the oldest closed rounds collapsed into `omitted` { count, ids } one round at a time, named, never silent;
 * (4) still over with ONLY active rows left = overflow: { overflow: true, text: null }: the caller stops the run and sends nothing. Both limits must hold (chars AND tokens_est).
 */
export function fitLedger(rows, render, { maxChars = LEDGER_MAX_CHARS, maxTokens = LEDGER_MAX_TOKENS_EST } = {}) {
  const fits = text => { const m = measure(text); return m.chars <= maxChars && m.tokens_est <= maxTokens; };
  const done = (shown, omitted, text, compacted) => ({
    rows: shown, omitted, overflow: false, text, ...measure(text),
    counts: { rows: shown.length, active: shown.filter(r => r.status === 'active').length, closed_cut: omitted ? omitted.count : 0, compacted },
  });
  let text = render({ rows, omitted: null });
  if (fits(text)) return done(rows, null, text, 0);
  const small = rows.map(r => (r.status === 'closed' ? { ...r, compact: true } : r));
  const compacted = small.filter(r => r.compact).length;
  text = render({ rows: small, omitted: null });
  if (fits(text)) return done(small, null, text, compacted);
  const closedRounds = [...new Set(small.filter(r => r.status === 'closed').map(r => r.first_round))].sort((a, b) => a - b);
  let kept = small; const cutIds = [];
  const omittedOf = (ids, idsMax) => { const sorted = [...ids].sort(byCode); return { count: sorted.length, ids: sorted.slice(0, idsMax), more: Math.max(0, sorted.length - idsMax) }; };
  for (const round of closedRounds) {
    for (const r of kept) if (r.status === 'closed' && r.first_round === round) cutIds.push(r.id);
    kept = kept.filter(r => !(r.status === 'closed' && r.first_round === round));
    for (const idsMax of [OMITTED_IDS_MAX, 0]) { // the capped id list first; if that line itself does not fit, the count alone
      const omitted = omittedOf(cutIds, idsMax);
      text = render({ rows: kept, omitted });
      if (fits(text)) return done(kept, omitted, text, kept.filter(r => r.compact).length);
    }
  }
  // OVERFLOW means the ACTIVE rows alone (plus at most a count line) do not fit.
  const left = cutIds.length ? omittedOf(cutIds, 0) : null;
  const m = measure(render({ rows: kept, omitted: left }));
  return { rows: kept, omitted: left, overflow: true, text: null, ...m, counts: { rows: kept.length, active: kept.length, closed_cut: cutIds.length, compacted: 0 } };
}
