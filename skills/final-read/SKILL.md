---
name: final-read
description: Runs the independent adversarial pass on finished writing before anyone else sees it - first an armed fact pass that re-searches every load-bearing claim instead of trusting memory, then a reading panel of four stances (professional reader, ordinary reader, QA reader, owner's proxy) answering checkable questions, with a lineup against real anchor pieces to resist self-flattery. Returns per-piece verdicts and never edits. Use after drafting and editing are finished and before work is shown, published or shipped, and on demand to audit already-published text. Works in the same session that wrote the piece; a fresh context is stronger. Not for producing fixes - claims go back to fact-checking, prose to line-editing.
license: MIT
---

# Final Read

The writer is the worst-placed person to check the writing. On one content project, a drafting session invented facts - plausible, well written, false - and they survived every check, because the writer ran the checks. The written rule had said "never the author" from day one; nothing structural made it happen. This skill is the structure.

**This skill owns nothing and writes nothing.** It reads finished work the way its real readers will, verifies it, and hands back verdicts. Facts belong to `fact-checking`, prose to `drafting` and `line-editing`. The general principles of review - ground truth over self-review, reviewers who report rather than fix, checkable questions - are `verification-and-critique`'s; this skill is their concrete form for prose.

## Two properties that make it work

1. **Plausibility is not evidence.** Invented claims read exactly like real ones, so a "does anything look invented?" read is worth nothing. The fact pass is *armed*: claim by claim, against the packet's sources and fresh searches, and a claim it can't trace is flagged, not forgiven.
2. **It never fixes what it finds.** A reviewer's rewrite is new prose written without the sources open, and a reviewer who polishes becomes a second author grading their own taste. **Name the problem and where it lives; never write its successor.**

## Who runs it

**By default, the session that wrote the piece.** A fresh context is stronger and stays available, but requiring it made the pass expensive enough to skip - and a pass that always runs beats a better one that sometimes does.

Self-running works because **Pass 1 is mechanical**: a re-searched claim is verified no matter who typed the query. The whole discipline is one line - **re-search every load-bearing claim at review time; never check it against memory.** Recall is the operation that failed.

**Pass 2 is the half that degrades when self-run**, because asking yourself whether your prose is good returns yes. The countermeasure is the lineup test, actually performed. When a piece matters unusually, or Pass 2 keeps returning "publish", or findings start arriving pre-answered (a draft carrying a "keeper" sentence *because* the panel asks for one), spend the fresh context.

## The packet

Per piece: every layer of the text, **the one sentence it argues**, **this work's own source links**, the captured particulars, and any downstream consequence it proposes (a rating, a recommendation, a price, a call to action) with its reasoning.

The sources are this work's verification URLs, not an older internal note - an old note is a summary someone wrote once and has been found to disagree with the text it describes. **A piece with no sources and no particulars isn't reviewable; hand it back unread.** A rewrite whose only "source" is an old note skipped verification, and the skipped step is the finding.

## Pass 1 - the armed fact pass (always first)

List every load-bearing claim across every layer: events, figures, dates, orderings, quotes presented as real, causal links, superlatives, absences. Trace each to the packet or re-search it. Verdict per claim: `traced` / `re-verified` / `FLAGGED (searched: ...)`.

- **Figures, rulings, sentences and superlatives go to the primary document**; syndicated copies count once (`fact-checking` rule 5).
- **Every quotation mark is a finding until traced.** A parody or altered name doesn't make a story fictional; only `fact-checking`'s two-question test does. This line was once written the other way - one class of invented quote was listed as a deliberate *non*-finding, so the only independent pass skipped the exact defect it existed to catch, and an invented quote shipped in a product's most-read piece.
- **Not findings:** interpretation, analogy, arithmetic on verified numbers (check the arithmetic), rounding, staged beats that change how a scene plays rather than what happened. Genuinely unsure? **Flag it with a question mark rather than deciding** - that call belongs to whoever signs off.
- **Hunt hardest** at the ending, absolutes, summaries standing in for documents, inherited claims on rewrites, sentence vs time served, timeline inversions, synonyms stated as the record's word, invented absences, unnamed authorities, and unaltered real names in satire (`fact-checking/references/verification.md`).

**One flagged load-bearing claim sends the piece back before the panel reads it.**

## Pass 2 - the reading panel

Four stances, each answering questions with **checkable answers** - never "is this good?", because yes is free. Full question sets: `references/reading-panel.md`.

1. **The professional reader** - would a real outlet publish this, and did the point land without being pointed at?
2. **The ordinary reader** - would I open it (why, in five words), where did I want to stop, and what would I retell? Asked across the batch too: after reading them all, would I open the next one?
3. **The QA reader** - does every layer add something the one above didn't, where does the piece turn, does the ending confirm the reader's feeling or explain it?
4. **The owner's proxy** - does it say what it means, and does it hold the house rules? A proposed consequence that doesn't follow from the piece *as written* is a finding.

Where judgment is relative, run the **lineup test**: mix the candidate, unlabelled, with two known-good and two known-bad pieces, rank all five by "written by someone with a point of view", and name the templated one. Ranking against real anchors resists flattery in a way absolute grading doesn't. A lineup against remembered examples is not a lineup (`references/anchors.md`).

## The verdict block

Up to two lines per piece, riding into whatever goes to the person who signs off:

```
FACTS: traced 6 / re-verified 2 / FLAGGED 1 - "served nine years" traces nowhere (searched: [terms]); back to research
READER: fix - decorative cold open; the argument starts at sentence two
```

- **FACTS always rides** - a zero-flag count is a claim about work done.
- **READER rides only when it isn't `publish`.** A line that always says the same thing stops being read.
- Verdicts: `publish` / `fix: <named finding>` / `kill: <reason>`. Use a named failure mode where one fits (`line-editing`); describe a new one plainly and flag it as a candidate.
- **Never replacement prose.** Point at the sentence; don't write its successor.

## Honest limits

This raises the detection rate and makes surviving failures cheap to kill; it doesn't promise zero bad output. A human sign-off is what makes zero *shipped* bad output reachable - this pass makes that sign-off faster and better aimed, never unnecessary. The fact pass is only as strong as its packet: a one-line note behind an eight-claim piece produces confident "traced" verdicts over untraced claims - say so, and treat the gap as the finding.

## Mistakes to flag

- A claim checked against memory instead of re-searched.
- A piece reviewed without sources or particulars, instead of handed back.
- Replacement prose in a verdict; a reviewer who edits.
- "Is this good?" answered instead of the checkable questions; a lineup run against remembered examples.
- A quote let through because a name was altered.
- A READER line that always says `publish`, or a FACTS line left off because nothing was flagged.
- The panel's own reasoning silently substituted for a stated house rule - when they disagree, the disagreement is the finding.

The four stances in full: `references/reading-panel.md`. Building and maintaining anchors: `references/anchors.md`. Handing the reviewed batch to whoever signs off: `references/presentation.md`.
