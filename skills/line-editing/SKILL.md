---
name: line-editing
description: Revises prose that already exists and names what makes it read flat or machine-written - the opening-sentence deletion test, the distillation test, the layer-echo test, named failure modes such as polished emptiness, the double lede, the wall and the four ending failures, machine-writing tells with their measured evidence and limits, checks worth scripting, and a library-wide sweep that grades before it edits. Use when copy reads flat, generic, over-explained or AI-generated, when polishing a draft before review, when editing someone else's text, and for batch or library-wide voice passes. Not for writing from scratch (drafting), for whether the claims are true (fact-checking), or for the independent verdict before publishing (final-read).
license: MIT
---

# Line Editing

Line editing turns "this reads wrong" into a named, fixable thing. Most flat prose is not a sentence problem: it is a piece with no stance, a turn in the wrong place, or an ending that explains itself - and polishing sentences on top of that produces cleaner flat prose.

**This skill owns:** revising text that exists, the diagnostics and named failure modes, machine-writing tells, and scripted checks. **It does not own** first drafts or register choice (`drafting`), whether claims are true (`fact-checking`), or the pre-publication verdict (`final-read`). **An edit never changes a factual claim.** If a sentence needs a different fact to work, that is a research finding, not an edit.

## Everything here rejects; nothing prescribes

A tell list is not a style guide read backwards. Writing to the inverse of one - short sentences only, fear of certain constructions, a dash quota - produces its own uncanny flatness: prose that reads as afraid of something. On one content project, the diagnostics below were turned into a drafting rubric; six pieces written under it passed every check and were all rejected as generic. **The goal is text that reads like somebody meant it, never text that passes a detector.** Keep these files closed while drafting; open them to attack what exists.

## The order of a pass

1. **Facts first.** If the piece makes factual claims and `fact-checking` hasn't run, stop - you would be polishing something about to be deleted.
2. **Structure before sentences.** Run the distillation test (below). A piece with no stance gets no stance from line work.
3. **Junctions before ornament** - the opening, the turn, the ending. That's where the failures are.
4. **Sentences last.**
5. **Mechanical checks by script, not by eye** (`references/mechanical-checks.md`).

## The diagnostics

- **Deletion test - opening sentence only.** Remove it; if the piece survives or improves, it was decoration. **Never run it on the ending**, which is removable by design - it would fail every good ending ever written.
- **Distillation test.** Can a cold reader state in one sentence what the piece *argues*, and is that more than a restatement of the event? "The bank laundered money and paid a fine" is a restatement: no stance.
- **Wire test, per layer.** Could a news wire print this word for word? For a first-layer headline, that's a pass - it should read as straight news. For a subhead's last clause or a body sentence, it's a fail: information standing where an angle should be.
- **Explanation test.** Does any voice - narrator, analyst, a second character - tell the reader what to conclude? Delete that voice. This outranks any word list, and it's the machine tell with the clearest structural evidence (`references/ai-tells.md`). The ending may carry the writer's verdict; a narrator explaining the middle may not.
- **Layer-echo test.** Read every layer together - headline, subhead, opening, ending. Does any layer map onto another? **Check every junction**; real pieces have echoed at the opening and the ending at once.

## Named failure modes

Full definitions, tests and fixes: `references/failure-modes.md`. The names, so a pass can say what it sees:

- **Polished emptiness** - clean, paced, nothing at stake. Fails distillation.
- **The proven mechanism, cold** - shows exactly how the wrong was done, never says it's wrong. Would the piece read the same if the writer were indifferent?
- **The double lede** - subhead and opening state one proposition in different words. Not script-detectable.
- **Report-shaped drafting** - body written most-important-fact-first; causes the double lede and a leftover ending together.
- **Decorative cold open**, **the wall** (one block over ~70 words with no turn), and **the four ending failures**: trailing qualifier, abstract closer, unpacked closer, relieving closer.
- **Wryness instead of anger**, **newswire voice**, **wire diction pasted intact**, **thin body on a real story**, **press-release voice on a warm piece** (`good-news-writing`).
- **Batch fingerprint** - sameness visible only across pieces. A recurring *conclusion* is not a fingerprint; steering around a true recurring point is the worse failure.

## Machine-writing tells, short form

- **A focal vocabulary** that surged in published text after chat assistants arrived (*delve, showcase, underscore, intricate, pivotal, realm, meticulous*), plus inflated verbs (*leverage, utilize, harness, streamline, empower*).
- **Negative parallelism as rhythm** ("not just X, but Y"; "It's not X. It's Y."), **reflexive triplets**, **signposting filler** ("it's important to note", "at its core"), **transition stacking**.
- **The summary closer** - a last sentence opening "Ultimately", "In conclusion", "In the end". Treat this one as a hard rejector: it's the neutral wrap-up, bad craft whether or not a model wrote it.
- **Metronomic rhythm** - every sentence in one length band.
- **Over-explaining the point** - the structural tell; a word swap doesn't remove it.

**Two cautions keep this honest.** These are signs, not proof: humans wrote every construction first, the tell is reflexive use, and one sign is noise - several failing together in a short passage is the fingerprint. And **never run an AI-text detector on a person's work and treat the score as evidence**: detectors measurably misflag non-native English writers. Evidence, thresholds and their sources: `references/ai-tells.md`.

## A library-wide sweep

1. **Grade first, edit nothing - two lenses.** Once with the diagnostics; once as an ordinary reader skimming, asking only "does this read generated?" The reader lens catches a weak body behind a strong headline.
2. **Verdicts: keep / trim** (right piece, mechanical flaw) **/ rewrite** (no stance, wrong register, or a named failure mode) - with the failure mode as the reason and, for each rewrite, the one sentence it should argue.
3. **Write the triage report before touching anything**, worst first, each rewrite with its full proposed text.
4. **Sign-off before applying.** Nothing lands until someone has read the report.
5. **Apply in batches**, re-running the scripted checks per batch.
6. **Flag, never patch, anything outside the copy layer** - a broken link, a wrong price, a wiring gap goes to whoever owns it.

## Mistakes to flag

- A factual claim changed in an edit.
- Frozen text (someone's own words, a legal string) touched in a sweep. Frozen never means exempt from the fact rules: if frozen text is false, the finding is that it's false.
- The wall "fixed" by inserting a break; a fingerprint "fixed" by writing to a rhythm target.
- An ending rewritten because it failed the deletion test.
- Prose sanded down to pass a tell list until it is afraid of language.
- Scope changed silently - non-text changes applied alongside a copy edit instead of proposed.
- A check reported without its method. One sweep under-reported by 27% because it split on sentences before paragraphs, and the number was acted on. "Checked N items by method M, found K."
