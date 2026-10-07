// Does a debate post quote the text it is about? (0.8.2 item 3; owner decision 2, 5 Oct 2026: "an objection or merge that quotes nothing reaches the author marked 'no quote'".)
// The 5 Oct analysis found half the lab-runs quote the attacked text in under half of their objection and merge posts; a post that quotes nothing is not wrong, but the author
// should know it. This module only DETECTS: a post "quotes" when it has a quoted span of at least 4 characters (once normalised) that appears, after the same normalisation, in the text of the
// proposal it is about (a span may run over lines, up to 400 characters; a "> " blockquote line counts; single-quoted text does not, because an apostrophe is not a quote). The mark an author sees (the sentence in its prompt) is a prompt change and waits for the owner's list; the data below is recorded on the post
// (`quoted: true|false`, additive) only when the chain sets `debate_hygiene.noQuoteMarks`. A support post is never marked: it claims nothing against the text.
// The harness's own escapes in text a poster was shown (boardText: a leading `#` becomes `\#`, a defused tag starts with `&lt;`) are undone, so a phrase copied from what the poster saw still matches.
// 0.8.2 audit fixes (cnc-prompts F1, cnc-debate F1, 73-verdicts 1 + 3, 73-config F1): straight and curly quotes and apostrophes are one thing on both sides of a comparison.
export const normQuote = s => String(s ?? '').toLowerCase().replace(/\\#/g, '#').replace(/&lt;/g, '<').replace(/[`*_"'\u201c\u201d\u00ab\u00bb\u2018\u2019]/g, '').replace(/\s+/g, ' ').trim();
const norm = normQuote;
const CLOSER = { '"': '"', '\u201c': '\u201d', '`': '`', '\u00ab': '\u00bb' };

// Pairs delimiters first, at any length: scan left to right, an opener takes the next matching closer and the scan resumes after it. (The 0.8.2 release read a span with a length
// filter INSIDE the pattern, so a short quoted term before the real quote failed, the scan restarted at its closing delimiter, and the prose between the two quoted terms became
// a "quote".) An opener with no closer after it is skipped, and that closer is never searched for again, so the scan is linear.
function pairedSpans(text) {
  const s = String(text ?? ''); const out = []; const none = new Set();
  let i = 0;
  while (i < s.length) {
    const close = CLOSER[s[i]];
    if (!close || none.has(close)) { i++; continue; }
    const j = s.indexOf(close, i + 1);
    if (j < 0) { none.add(close); i++; continue; }
    out.push(s.slice(i + 1, j)); i = j + 1;
  }
  for (const m of s.matchAll(/^>[ \t]*(.+)$/gm)) out.push(m[1]); // a "> " blockquote line counts
  return out;
}

/** The quoted spans of a debate POST: a quoted span (a blockquote line counts) of 4 to 400 characters once normalised, so a correct short exact quote such as `Redis` counts and "no" does not. */
export function quotedSpans(text) {
  return pairedSpans(text).filter(q => q.length <= 400 && norm(q).length >= 4);
}

/** The quoted spans of a judge's WITHDRAWAL evidence: any length (the prompt asks for the passage copied exactly), at least 8 characters AFTER normalising, so `________` quotes nothing. */
export function evidenceSpans(text) {
  return pairedSpans(text).filter(q => norm(q).length >= 8);
}

/** The searchable text of a proposal or alternative: the fields a poster is SHOWN (src/roles.js renderProposal / renderAlternative), joined. Its id, lab, model and the like are not part of what it could quote. */
const SHOWN = ['title', 'serves', 'what', 'why', 'how', 'acceptance_test', 'name', 'shape', 'key_tradeoffs', 'bad_at'];
export const itemText = item => SHOWN.map(k => (item && typeof item === 'object' ? item[k] : null)).filter(v => typeof v === 'string').join('\n');

/** True when some quoted span of `postText` is found in `targetText` (normalised: case, markdown emphasis and spacing do not matter). */
export function quotesTarget(postText, targetText) {
  const target = norm(targetText);
  return target.length > 0 && quotedSpans(postText).some(s => target.includes(norm(s)));
}

/** The post with `quoted` set, for an objection or a merge; any other post is returned as it came. */
export function markPostQuote(post, items) {
  if (!post || (post.stance !== 'object' && post.stance !== 'merge')) return post;
  const target = (items || []).find(i => i.id === post.on);
  // A merge may quote the proposal it folds into as well as the one it is posted on.
  const other = post.stance === 'merge' && post.merge_with ? (items || []).find(i => i.id === post.merge_with) : null;
  return { ...post, quoted: quotesTarget(post.text, itemText(target)) || (other ? quotesTarget(post.text, itemText(other)) : false) };
}
