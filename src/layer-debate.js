// B2 (debate-084/b2, A-DRAFT): the exchange inside layer 1. Pure helpers for src/chain.js: they read what the judges replied and decide what stands. No call is made here and nothing is written; the calls go through invoke() in chain.js.
// A post is one of support / contest / insufficient_evidence / no_view. A contest COUNTS only with a reason and a quote found in the draft (src/post-quotes.js normQuoteTight): a quote anchors an argument, it does not replace one.
// Only the RAISER closes its own objection (a withdrawal with a reason). A head count never does.
import { normQuoteTight } from './post-quotes.js';
import { criterionKeyOf } from './objection-ids.js';
import { mergeSeverity, readSeverity } from './severity.js';

/** 0.8.4 S4b / S8: why a late finding is `ungrounded` (null when it is grounded): no criterion, no quote, or a quote the plan does not hold. The ONE rule: the ending exchange's late findings and the closing read's both ask it. */
export const lateUngroundedWhy = ({ criterion, quote }, draftText) => (!criterion ? 'no_criterion' : !quote ? 'no_quote' : (normQuoteTight(quote).length < 8 || !String(draftText ?? '').includes(normQuoteTight(quote))) ? 'quote_not_in_plan' : null);

export const STANCES = ['support', 'contest', 'insufficient_evidence', 'no_view'];
/** The exchange's safety stop (N9): the most rounds one pass's exchange runs. There is no key to set it: the loop is N9's, it ends when a round changes nothing (the second round always runs on layer 1 while an objection stands), and stops here. */
export const EXCHANGE_ROUNDS = 7;
/** 0.8.4 (ladder unit, exchange idea 2; C&C 10 Nov, his idea named layer 1): the layer-1 exchange of a pass stops after this many rounds. The ENDING exchange keeps EXCHANGE_ROUNDS (7); the shortened exchanges of the layers above layer 1 are one round (S6). */
export const LAYER_ONE_EXCHANGE_ROUNDS = 3;
/** The number of judges the exchange would read at the lowest layer: 0 when the chain has no exchange (not a layered chain with "signoff": "unanimous"). The exchange is part of every such chain (0.8.4: there is no switch); it needs two heard judges to run, so a chain whose lowest layer has fewer than two judges never runs it. */
export function exchangeJudgeCount(config) {
  const critics = config?.seats?.critics;
  if (config?.signoff !== 'unanimous' || !Array.isArray(critics) || !critics.length || !critics.every(c => c && c.layer !== undefined)) return 0;
  const lowest = Math.min(...critics.map(c => c.layer));
  return critics.filter(c => c.layer === lowest).length;
}
const str = v => (typeof v === 'string' ? v.trim() : '');

/** The objections of the layer's heard verdicts, one per id: [{ id, key, criterion, problem, quote? }]. Two problems under one id (same judge, criterion and quote) are one objection with the problems joined, as answer-back does. */
export function exchangeObjections(heard, objectionId) {
  const out = [];
  for (const { key, failures, stage } of heard) {
    for (const f of failures || []) {
      const id = objectionId(key, f);
      const dup = out.find(o => o.id === id);
      if (dup) {
        if (f.problem && !String(dup.problem).includes(f.problem)) dup.problem = `${dup.problem} / ${f.problem}`;
        if (f.severity !== undefined) { const m = mergeSeverity(dup.severity, f.severity); if (m.ok) dup.severity = m.value; }   // two copies of one id keep the highest readable tag
        continue;
      }
      out.push({ id, key, criterion: f.criterion, problem: f.problem, ...(f.quote ? { quote: f.quote } : {}), ...(readSeverity(f.severity).ok ? { severity: f.severity } : {}), ...((f.carried_from ? f.raised_in : stage) ? { raised_in: f.carried_from ? f.raised_in : stage } : {}), ...(f.carried_from ? { carried_from: f.carried_from } : {}) });   // raised_in (M0 FIX-UP 2): the stage that produced the verdict the objection is in; a carried objection keeps the one it was first raised in and never takes the stage of the verdict it is carried into
    }
  }
  return out;
}

/** One judge's reply -> { posts, news, dropped }. `shown` are the objections it was shown (a post on any other id is dropped). */
export function readPosts(parsed, { shown, draft, severity = false, lastRound = false, own = [] }) {   // lastRound (0.8.4 S4b, W26, CA6): the seventh round of the ENDING exchange, where no round follows: a defect named there is a LATE FINDING (returned in `late`), never an objection (`news` and `proposed` stay empty)
  const ids = new Set(shown.map(o => o.id));
  const draftText = normQuoteTight(draft);
  const posts = []; const dropped = [];
  for (const p of Array.isArray(parsed?.posts) ? parsed.posts : []) {
    if (!p || typeof p !== 'object') continue;
    const on = str(p.on); const stance = str(p.stance).toLowerCase().replace(/[\s-]+/g, '_');
    if (!ids.has(on)) { dropped.push({ on, reason: 'unknown_id' }); continue; }
    if (!STANCES.includes(stance)) { dropped.push({ on, reason: 'unknown_stance' }); continue; }
    if (posts.some(x => x.on === on)) { dropped.push({ on, reason: 'second_post' }); continue; }
    const text = str(p.text); const quote = str(p.quote);
    let counted = true; let why;
    if (stance === 'contest') {
      if (!text) { counted = false; why = 'no_reason'; }
      else if (!quote) { counted = false; why = 'no_quote'; }
      else if (normQuoteTight(quote).length < 8 || !draftText.includes(normQuoteTight(quote))) { counted = false; why = 'quote_not_in_plan'; }
    } else if (stance !== 'no_view' && !text) { counted = false; why = 'no_reason'; }
    // A post that fails its check is recorded as NO VIEW with the refusal reason on the record, and the stance it asked for beside it (Q1(a), RU-S3-27); it is not retried (D11)
    posts.push({ on, stance: counted ? stance : 'no_view', text, ...(quote ? { quote } : {}), counted, ...(why ? { why, asked: stance } : {}) });
  }
  // 0.8.4 S14 (D37 option iv, W1's clause): `own_quote`, the judge's quote for each of its OWN unquoted objections (the ids listed to it in the post), read like a reply's quote: kept here, attached by the caller only if the plan holds it. An id the judge was not asked about is ignored.
  const ownSet = new Set((Array.isArray(own) ? own : []).filter(x => typeof x === 'string'));
  const ownQuotes = [];
  for (const q of Array.isArray(parsed?.own_quote) ? parsed.own_quote : []) {
    if (!q || typeof q !== 'object') continue;
    const id = str(q.id); const quote = str(q.quote);
    if (ownSet.has(id) && quote && !ownQuotes.some(x => x.id === id)) ownQuotes.push({ id, quote });
  }
  const ownField = ownQuotes.length ? { own_quotes: ownQuotes } : {};
  const news = []; const proposed = []; const late = [];
  if (lastRound) {
    // 0.8.4 S4b (W26, D24, Q-i4, Q-i5): the field `late_finding` (an object, or a list of them) is read as a late finding; an entry of `new_objections` in this round is NOT minted and NOT dropped: it is read the same way and flagged named_as_objection.
    // The text of the defect is its `problem` (or `text` / `description`: the plan names the field `late_finding` and its criterion, quote and rating, not the name of the text). A finding with no text at all says nothing and is not recorded.
    // A criterion or a quote that is missing, or a quote the plan does not hold, flags it `ungrounded` (with why) and keeps it. A rating is read by readSeverity (1 to 10, one decimal); one that is missing or invalid is kept unrated (`rating_refused` says why) and is never retried.
    const asList = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []);
    const lateOf = (x, namedAsObjection) => {
      if (!x || typeof x !== 'object') return null;
      const problem = str(x.problem) || str(x.text) || str(x.description);
      if (!problem) return null;
      const criterion = str(x.criterion); const quote = str(x.quote);
      const flags = []; const why = lateUngroundedWhy({ criterion, quote }, draftText);
      if (why) flags.push('ungrounded');
      if (namedAsObjection) flags.push('named_as_objection');
      const raw = x.rating !== undefined ? x.rating : x.severity;
      const r = readSeverity(raw);
      return { problem, ...(criterion ? { criterion } : {}), ...(quote ? { quote } : {}), rating: r.ok ? r.value : null, ...(r.ok ? {} : { rating_refused: raw === undefined ? 'no_rating' : (r.why || 'unreadable') }), flags, ...(why ? { ungrounded_why: why } : {}) };
    };
    // C&C's item 5: nothing is dropped silently. An entry that says nothing (no text), an entry that is not an object, and a field that is neither an object nor a list are counted in `dropped` with their reason, as a post that fails is.
    for (const [field, named] of [['late_finding', false], ['new_objections', true]]) {
      const v = parsed?.[field];
      if (v !== undefined && v !== null && typeof v !== 'object') dropped.push({ reason: 'late_finding_unreadable' });
      for (const x of asList(v)) { const l = lateOf(x, named); if (l) late.push(l); else dropped.push({ reason: x && typeof x === 'object' ? 'late_finding_no_text' : 'late_finding_unreadable' }); }
    }
    return { posts, news, proposed, dropped, late, ...ownField };
  }
  for (const n of Array.isArray(parsed?.new_objections) ? parsed.new_objections : []) {
    if (!n || typeof n !== 'object') continue;
    const problem = str(n.problem); const criterion = str(n.criterion);
    if (!problem) continue;
    // FEATURE_SPECS l.267 (Q1(c)), per reason by what the code did before: a defect with NO CRITERION was dropped without a trace, so recording it as proposed is purely additive and applies now, demand held or not. The two reasons about the passage (none given,
    // or one the F7 check does not find) belong to defects the code MINTS and lets HOLD; they follow the wording that asks for a required passage (the exchange post prompt still says "copied exactly, or omit"), so they join `proposed` when that word is recorded.
    if (!criterion) { proposed.push({ problem, ...(str(n.quote) ? { quote: str(n.quote) } : {}), why: 'no_criterion' }); continue; }
    // NEW-F4-1 (M1, S19): with the rating demand in force (`severity`), a defect named in a post needs a valid rating (Q1(c)); one without it is recorded as PROPOSED with its refusal reason, mints no id, leaves the rest of the post valid and is never retried (D11).
    // Without the demand nobody was asked to rate, so the defect is kept as it always was (an unrated objection holds the sign-off).
    if (severity && !readSeverity(n.severity).ok) { proposed.push({ criterion, problem, ...(str(n.quote) ? { quote: str(n.quote) } : {}), why: 'no_valid_rating' }); continue; }
    news.push({ criterion, problem, ...(str(n.quote) ? { quote: str(n.quote) } : {}), ...(severity && readSeverity(n.severity).ok ? { severity: n.severity } : {}) });
  }
  return { posts, news, proposed, dropped, ...ownField };
}

/** 0.8.4 S14: true when `quote` (at least 8 normalised characters) appears in `draft`, the test a reply's or a post's quote is held to before it is attached to an objection (the same as the amend and withdraw checks of readReplies). */
export const quoteFound = (draft, quote) => { const q = normQuoteTight(quote); return q.length >= 8 && normQuoteTight(draft).includes(q); };

/**
 * One raiser's reply -> [{ id, action, text, problem?, quote?, post?, invalid?, invalid_reason?, unargued? }] (Q1(b), RU-S3-30..38). `own`: the objections it was asked about, each `{ id, criterion, shown?: the posts shown to it in that call, in order }`; `draft`: the text the passage check reads.
 * keep: a reason. amend: new text (`problem`); it keeps its criterion, and a passage it quotes (`quote`) must be found in the draft. withdraw: a reason; a passage it quotes must be found in the draft, a post it names (`post`, the 1-based number of a post shown in that call) must exist.
 * `strict` (the wording that asks for an anchor, W2, is recorded: held('layerReplyAnchorRule')): a withdrawal must also NAME a post or a passage, an amend must give its reason, and a withdrawal with no reason is invalid. Without it a judge was never asked for an anchor, so none is demanded (a withdrawal with no reason is a keep, recorded unargued, as before); what a judge DOES give is always checked.
 * A reply that parses but fails the requirement of its kind is returned with `invalid: true` and the failed requirement in `invalid_reason`: it counts as NO REPLY, the objection stands, and it is never read as a withdrawal (D2, D11; not retried).
 */
export function readReplies(parsed, { own, draft = '', strict = false, noAmend = false }) {   // noAmend (0.8.4 S4b, W26's reply sentence, T22u): the last round of the ending exchange has no amend option; an amend there is invalid (it counts as no reply and records no amended text)
  const byId = new Map(own.map(o => [o.id, o]));
  const draftText = normQuoteTight(draft);
  const found = q => normQuoteTight(q).length >= 8 && draftText.includes(normQuoteTight(q));
  const out = [];
  for (const r of Array.isArray(parsed?.replies) ? parsed.replies : []) {
    if (!r || typeof r !== 'object') continue;
    const id = str(r.id);
    if (!byId.has(id) || out.some(x => x.id === id)) continue;
    let action = str(r.action).toLowerCase(); const text = str(r.text);
    if (!['keep', 'amend', 'withdraw'].includes(action)) continue;
    const problem = action === 'amend' ? str(r.problem) : ''; const quote = str(r.quote); const criterion = str(r.criterion);
    const shown = byId.get(id).shown || [];
    const post = Number.isInteger(r.post) && r.post >= 1 ? r.post : null;
    let why; let unargued = false;
    if (action === 'keep') { if (!text) why = 'keep_no_reason'; }
    else if (action === 'amend') {
      if (noAmend) why = 'amend_in_last_round';
      else if (!problem) why = 'amend_no_text';
      else if (strict && !text) why = 'amend_no_reason';
      else if (criterion && criterionKeyOf(criterion) !== criterionKeyOf(byId.get(id).criterion)) why = 'amend_other_criterion';
      else if (quote && !found(quote)) why = 'amend_passage_not_found';
    } else if (!text && !strict) { action = 'keep'; unargued = true; }   // before the anchor wording is recorded: a withdrawal with no reason is a keep, recorded unargued
    else if (!text) why = 'withdraw_no_reason';
    else if (post !== null && post > shown.length) why = 'withdraw_post_unknown';
    else if (quote && !found(quote)) why = 'withdraw_passage_not_found';
    else if (strict && post === null && !quote) why = 'withdraw_no_anchor';
    out.push({ id, action, text, ...(problem ? { problem } : {}), ...(quote ? { quote } : {}), ...(post !== null ? { post } : {}), ...(unargued ? { unargued: true } : {}), ...(why ? { invalid: true, invalid_reason: why } : {}) });
  }
  return out;
}

/**
 * 0.8.4 S6 (M1; Q5, W14, G7): the SIGN-OFF LINE of a raiser's reply in the shortened exchange of layers 2 and 3. W14 asks the reply to END with one line, `sign-off: yes` or `sign-off: no`. Read from the RAW reply text, not from the parsed JSON
 * (an object followed by a line still parses: chain.js parseJson reads the first-to-last brace span). Pure; nothing here decides anything, the computed rule (Q2) does, and G7 only lets a "no" refuse a sign-off.
 * Returns 'yes' | 'no' | 'missing' (no last line of that kind, or no text) | 'garbled' (a sign-off line whose answer is neither yes nor no, or that echoes the instruction: "sign-off: yes, if ... otherwise sign-off: no").
 * Only the LAST non-empty line counts (W14: "the last line"); a closing code fence on its own line is skipped. Markup around the line (bold, backticks, a bullet) and a closing full stop are tolerated.
 */
export function readSignoffLine(text) {
  if (typeof text !== 'string') return 'missing';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !/^```+\s*$/.test(l));
  const last = lines.at(-1);
  if (!last) return 'missing';
  const m = /^[\s*_`>#\-]*sign[-_ ]?off\s*[*_`]*\s*:\s*[*_`]*\s*(.*)$/i.exec(last);
  if (!m) return 'missing';
  const rest = m[1].trim();
  if (/sign[-_ ]?off/i.test(rest)) return 'garbled';
  const word = rest.replace(/^[*_`"'\s]+/, '').split(/[\s,;:.!)*_`"']/)[0].toLowerCase();
  return word === 'yes' || word === 'no' ? word : 'garbled';
}

/** The JSON form of the same answer (G7 / B's reading (C)): the field `sign_off` of the reply object, the string "yes" or "no" (any case) or a boolean. 'yes' | 'no' | 'missing' (no such field) | 'garbled' (any other value). */
export function readSignoffField(parsed) {
  if (!parsed || typeof parsed !== 'object' || !('sign_off' in parsed)) return 'missing';
  const v = parsed.sign_off;
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (typeof v === 'string') { const w = v.trim().toLowerCase().replace(/[.!]+$/, ''); if (w === 'yes' || w === 'no') return w; }
  return 'garbled';
}

/**
 * The sign-off a reply gives, from its line and its field: { line, field, value, mismatch }. value: 'no' when either says no (G7: when both are present and differ, "no" wins), else 'yes' when either says yes, else null (nothing readable:
 * the computed rule decides, with no stop and no re-ask, T6b). mismatch: line and field both readable and different. A garbled line or field is not a "no": it is as good as missing for the decision, and the record shows the word.
 */
export function signoffOf(text, parsed) {
  const line = readSignoffLine(text); const field = readSignoffField(parsed);
  const said = [line, field].filter(x => x === 'yes' || x === 'no');
  return { line, field, value: said.includes('no') ? 'no' : said.includes('yes') ? 'yes' : null, mismatch: said.length === 2 && said[0] !== said[1] };
}

/** The five outcomes of an objection at the end of an exchange (0.8.4, Q1 outcome table; the record word is the outcome that fits the objection's FINAL text). withdrawn_argued: its raiser withdrew with a reason. stands_uncontested: it stands and no counted contest or insufficient-evidence post is on it. stands_contested: it stands and at least one counted contest or insufficient-evidence post is on its final text. not_debated: raised or amended in a round with no round after it. unresolved_at_stop: still changing when the safety stop fired. (unresolved_at_bound is a route mark, never an outcome.) */
export const OUTCOMES = ['withdrawn_argued', 'stands_uncontested', 'stands_contested', 'not_debated', 'unresolved_at_stop'];

/** What happened to one objection: withdrawn_argued (its raiser said so, with a reason) / stands_uncontested (no judge's LATEST position on its final text is a contest or doubt) / stands_contested (at least one judge's latest position on its final text is a contest or doubt and its raiser kept it, or gave no valid reply). not_debated and unresolved_at_stop are decided by the caller, which knows the rounds. M0 FIX-UP 2, item 6 (Muad's pick of 4 Nov 2026 relayed by C&C, "follow each judge's latest position"; copy correction 10, CHANGE_LOG 10g; it replaces M0 FIX 2's "any counted contest on the final text"): `posts` are ALL the posts on the objection's final text and each judge counts ONCE, by its latest counted post (latestPosts), so a contest that the same judge later withdrew by supporting, or by saying it has no view, no longer decides. */
export function outcomeOf(posts, reply) {
  if (reply?.action === 'withdraw') return 'withdrawn_argued';
  return latestPosts(posts).some(p => p.stance === 'contest' || p.stance === 'insufficient_evidence') ? 'stands_contested' : 'stands_uncontested';
}

/**
 * The minority notes of one objection (Q1(d), kept per objection and verbatim): when it stands, the reasons of the judges that contested it (a counted contest post); when its raiser withdrew it, the reasons of the judges that supported it (a counted
 * support post: the view the withdrawal went against). `posts` are ALL the posts on the objection's final text: one entry per judge, from that judge's latest counted post if that post has the wanted stance (latestPosts), in the poster's own words: { by, round, stance, text, quote? }.
 * A judge that contested and later supported has no contest note; a judge whose latest position is no view has none. An objection that stands with no contest, or one nobody debated, has none.
 */
export function minorityNotesOf(posts, outcome) {
  const want = outcome === 'withdrawn_argued' ? ['support'] : outcome === 'stands_contested' || outcome === 'unresolved_at_stop' ? ['contest'] : [];
  return latestPosts(posts).filter(p => want.includes(p.stance)).map(p => ({ by: p.by, round: p.round, stance: p.stance, text: p.text, ...(p.quote ? { quote: p.quote } : {}) }));
}

/**
 * What the writer's note reads of one objection's posts on its final text (M0 FIX-UP 2, item 6; C&C's word, Option B). `posted`: some reviewer left a counted post other than no_view there, which is what "debated" and so settled() (src/chain.js) have always meant, whatever the reviewers' positions now are. `posts`, `support`, `contest` and `doubt`: each reviewer counted ONCE, by its latest position (the recorded
 * sentence counts reviewers), a no_view in no bucket and listed nowhere, a contest the reviewer dropped by supporting not listed. A reviewer who contested and then had no view leaves `posted` true and every count 0: the note reads "(upheld): 0 supported it, 0 contested it, 0 said the evidence was insufficient."
 */
export function notePositionsOf(posts) {
  const posted = (posts || []).some(p => p.counted !== false && p.stance !== 'no_view');
  const latest = latestPosts(posts).filter(p => p.stance !== 'no_view');
  return { posted, posts: latest, support: latest.filter(p => p.stance === 'support').length, contest: latest.filter(p => p.stance === 'contest').length, doubt: latest.filter(p => p.stance === 'insufficient_evidence').length };
}

/** The position each judge holds on an objection's final text: its latest counted post, an explicit no_view included (a judge whose latest position is no view has no stance: it counts as support, contest or doubt in no bucket). A refused (counted:false) post and an omitted one are no position and update nothing; a carried copy of an earlier post counts as the position it carries. Order: each judge where it first appears. `posts` are all the posts on the final text. */
export function latestPosts(posts) {
  const last = new Map();
  for (const p of posts || []) if (p.counted !== false) last.set(p.by, p);
  return [...last.values()];
}
