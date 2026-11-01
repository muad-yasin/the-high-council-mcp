// B2 (debate-084/b2, A-DRAFT): the exchange inside layer 1. Pure helpers for src/chain.js: they read what the judges replied and decide what stands. No call is made here and nothing is written; the calls go through invoke() in chain.js.
// A post is one of support / contest / insufficient_evidence / no_view. A contest COUNTS only with a reason and a quote found in the draft (src/post-quotes.js normQuoteTight): a quote anchors an argument, it does not replace one.
// Only the RAISER closes its own objection (a withdrawal with a reason). A head count never does.
import { normQuoteTight } from './post-quotes.js';
import { mergeSeverity, readSeverity } from './severity.js';

export const STANCES = ['support', 'contest', 'insufficient_evidence', 'no_view'];
const str = v => (typeof v === 'string' ? v.trim() : '');

/** The objections of the layer's heard verdicts, one per id: [{ id, key, criterion, problem, quote? }]. Two problems under one id (same judge, criterion and quote) are one objection with the problems joined, as answer-back does. */
export function exchangeObjections(heard, objectionId) {
  const out = [];
  for (const { key, failures } of heard) {
    for (const f of failures || []) {
      const id = objectionId(key, f);
      const dup = out.find(o => o.id === id);
      if (dup) {
        if (f.problem && !String(dup.problem).includes(f.problem)) dup.problem = `${dup.problem} / ${f.problem}`;
        if (f.severity !== undefined) { const m = mergeSeverity(dup.severity, f.severity); if (m.ok) dup.severity = m.value; }   // two copies of one id keep the highest readable tag
        continue;
      }
      out.push({ id, key, criterion: f.criterion, problem: f.problem, ...(f.quote ? { quote: f.quote } : {}), ...(readSeverity(f.severity).ok ? { severity: f.severity } : {}) });
    }
  }
  return out;
}

/** One judge's reply -> { posts, news, dropped }. `shown` are the objections it was shown (a post on any other id is dropped). */
export function readPosts(parsed, { shown, draft, severity = false }) {
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
    posts.push({ on, stance, text, ...(quote ? { quote } : {}), counted, ...(why ? { why } : {}) });
  }
  const news = [];
  for (const n of Array.isArray(parsed?.new_objections) ? parsed.new_objections : []) {
    if (!n || typeof n !== 'object') continue;
    const problem = str(n.problem); const criterion = str(n.criterion);
    if (!problem || !criterion) continue;
    news.push({ criterion, problem, ...(str(n.quote) ? { quote: str(n.quote) } : {}), ...(severity && readSeverity(n.severity).ok ? { severity: n.severity } : {}) });   // a new objection with no readable severity is KEPT, untagged (held later, never defaulted)
  }
  return { posts, news, dropped };
}

/** One raiser's reply -> [{ id, action, text, problem? }]; a withdrawal with no reason is a keep (recorded unargued). */
export function readReplies(parsed, { own }) {
  const ids = new Set(own.map(o => o.id));
  const out = [];
  for (const r of Array.isArray(parsed?.replies) ? parsed.replies : []) {
    if (!r || typeof r !== 'object') continue;
    const id = str(r.id);
    if (!ids.has(id) || out.some(x => x.id === id)) continue;
    let action = str(r.action).toLowerCase(); const text = str(r.text);
    if (!['keep', 'amend', 'withdraw'].includes(action)) continue;
    let unargued = false;
    if (action === 'withdraw' && !text) { action = 'keep'; unargued = true; }
    out.push({ id, action, text, ...(action === 'amend' && str(r.problem) ? { problem: str(r.problem) } : {}), ...(unargued ? { unargued: true } : {}) });
  }
  return out;
}

/** What happened to one objection: withdrawn (its raiser said so, with a reason) / upheld (no counted contest or doubt stands against it) / unresolved (a counted contest or doubt stands and its raiser kept it). */
export function outcomeOf(posts, reply) {   // `posts`: the latest post of each judge (latestPosts)
  if (reply?.action === 'withdraw') return 'withdrawn';
  return posts.some(p => p.counted && (p.stance === 'contest' || p.stance === 'insufficient_evidence')) ? 'unresolved' : 'upheld';
}

/** The latest counted post of each judge on an objection (a judge that changed its stance in a later round is read by its last post). `posts` carry `by` and `round`; an uncounted post and a no_view are no stance. */
export function latestPosts(posts) {
  const last = new Map();
  for (const p of posts || []) if (p.counted !== false && p.stance !== 'no_view') last.set(p.by, p);
  return [...last.values()];
}
