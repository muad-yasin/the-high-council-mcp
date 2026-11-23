# 217: six places in the writing skills, from an outside review

A-DRAFT: every sentence of this note waits for the owner's yes.

Read against the code at commit `07dbe925`, the tip of `dev` when it was written. `skills/` there is the same as at `0b4016a5`, so the line numbers hold on both.

**Where the six come from.** An outside review of another repository, one that ships copies of five of THC's writing skills, reported six places in them. Those skills are `drafting`, `fact-checking`, `final-read`, `good-news-writing` and `line-editing`, and by the review's own check the copies match THC's files at `0b4016a5` (not verified here), so each place is read in THC's own `skills/`. This note restates each one in its own words, checks it against THC's files, and proposes the smallest change.
- Four hold as defects, one of them only in part, as a missing scope.
- Two hold in part, as wording.

Every sentence of a skill is read by a model, so every proposed sentence below is A-DRAFT, and nothing changes until the owner says yes. The note goes row by row, one section per place, with the gates, the limits and the questions collected at the end.

**No test pins any of the six sentences.** A grep of `test/`, `docs/`, `README.md` and `AI-README.md` for each finds none; `test/skills-catalog.test.js` reads the folder list, not the text. So each change is checked by reading its places together, and no test changes with it.

## 1. `drafting` tells the writer to keep shut two references that its own steps call for (a defect)

- **What is wrong.** `skills/drafting/SKILL.md:19` tells the writer to keep the technique lists, the skill's references among them, closed until a full draft exists. Two of those references are needed before the draft:
  - the brief's fourth question sends the writer to `references/registers.md` (`:28`);
  - `references/in-product-copy.md:11` asks for a string's length limit before any text is written.
- **The smallest change,** for the last sentence of `:19`: "Follow the steps below. Keep the technique references here, and `line-editing`'s tells, closed until a full draft exists; the two inputs of the brief are the exception, opened when a step calls for them: the registers while the brief is set, and a string's length limit before writing text a product will display."
- **What stays:** the rule above it (`:17`): a list may reject a draft and may never prescribe one. Choosing a register and knowing a length limit belong to the brief; they are not techniques.

## 2. `fact-checking`: an invented quote is said to survive every defence, which the file's own US section does not support (a defect)

- **What is wrong.** `skills/fact-checking/references/legal-guardrail.md:13` grounds the house ban on invented quotes in a legal claim stated for every case: such a quote survives every other defence. The same file's US section (`:33`) says that opinion and parody which no reasonable reader takes as fact are generally not actionable. So for a parody that no reader takes as fact, the two lines disagree.
- **Reported, not verified here:** the review names a US Supreme Court case on a parody interview of a public figure (*Hustler Magazine v. Falwell*, 1988). This note did not read it. German law on invented quotes was not read either.
- **The smallest change,** for the first two sentences of `:13`, with two sentences added (the rest of the line, on altered quotes, stays): "**Why an invented quote is the sharpest exposure:** it turns your opinion into someone else's statement of fact; the defences a writer usually leans on do not hold. A parody name doesn't help if the referent is recognisable; truth doesn't help because the words were never said. In the US, a court can still find that no reasonable reader would take a parody as fact (Defamation, below). The ban here has another ground: quotation marks promise the reader that someone said those words."
- **What stays:** the ban itself. A case named in the file would also go into the header's record of sources checked against primary text (`:3`), with the date it was read.

## 3. `final-read`: its example verdict runs the reading panel on a piece the facts check has sent back (a defect)

- **What is wrong.** `skills/final-read/SKILL.md:43` says that one flagged load-bearing claim sends the piece back before the reading panel reads it. The example verdict under it (`:60-63`) reports one flagged claim, sent back to research, and below that a line from the panel. Copied as it stands, the example teaches the panel to judge a draft that the flag has already sent back for changes.
- **The smallest change:** two examples in place of one.
  - The flagged one keeps its facts line alone, with a line under it: no panel line, because the piece goes back before the panel reads it.
  - A clean pass shows both lines:

    ```
    FACTS: traced 7 / re-verified 2 / FLAGGED 0
    READER: fix - decorative cold open; the argument starts at sentence two
    ```
- **What stays:** the two rules under the example (`:65` onward), which hold for both examples.

## 4. `final-read`: the lineup test asks for one templated piece (wording; holds in part)

- **What the review asks.** `skills/final-read/references/anchors.md:20`, and its twin in `skills/final-read/SKILL.md:54`, ask the reader to name the templated piece. The review asks that "none" be allowed and that the reader quote what gave each piece away, since a set may hold none or several, and a rejected anchor may have failed for another reason.
- **What holds, and what does not.**
  - The forced choice is the test's design. The lineup is the main guard against a reviewer flattering its own writing (`anchors.md:3`), and asked to find the templated piece a reader will find one, so naming one's own candidate is the answer (`:22`). With "none" allowed, that reviewer has its way out back.
  - What does hold: `anchors.md:10` stores each rejected anchor beside the reason it was rejected, and that reason is not always that it read as templated, so the piece a reader names can be one that failed for something else. The test does not need the named piece to be templated: what it measures is whether the candidate gets named.
- **The options, with their results** (the owner's pick):
  - (a) leave both lines: the test keeps its force, and why a piece was named stays unwritten;
  - (b) both lines also ask for the passage that gave the piece away, written beside its name (the review's second point, without "none"; no sentence drafted here): the answer becomes checkable, and the forced choice stays;
  - (c) allow "none", as the review asks: the reviewer that flatters its own piece gets its way out back.

## 5. `good-news-writing`: "there is no story" can drop a piece that Step 2 keeps as a short item (wording; holds in part)

- **What is wrong.** In the section on when to use the skill, `skills/good-news-writing/SKILL.md:17` says that a contrast the writer would have to build means there is no story. Step 2 (`:56`) gives the same missing contrast another outcome: a short item of two or three understated sentences. A writer who stops at `:17` never reaches the short item that `:56` offers for exactly this case. It holds in part: `:17` decides whether this skill is used at all, so "no story" can be read as no story for this skill, but the skill's own Step 2 writes the short item, so the two places disagree on whether the skill takes the piece.
- **The smallest change,** for that sentence of `:17`: "If you would have to build it, write no feature: what is verified still makes a short item (Step 2)."
- **What stays:** the rest of the line, on underselling a real contrast against inventing one.

## 6. `line-editing`: the two stance tests carry no scope (a defect, in part: a missing scope)

- **What is wrong.** The distillation test (`skills/line-editing/SKILL.md:33`) fails a piece whose one-sentence summary only restates the event, and the wire test (`:34`) fails a body sentence that a news wire could print as it stands. The reading panel's own distillation line (`skills/final-read/references/reading-panel.md:36`) makes a restatement an automatic fix. But `drafting`'s table of registers gives other jobs to a status report, a routine notice and a change note (`skills/drafting/references/registers.md:16-18`): a routine notice has no turn, and its failure is to be written as a piece. The reading panel accepts honest routine material (`skills/final-read/references/reading-panel.md:10`). So an editor following `:34` marks a plain notice as failed precisely because it reports plainly.
- **The smallest change:**
  - one sentence under the heading "The diagnostics" (`:30`), before the list: "Apply the distillation and wire tests to pieces that make an argument. For a status report, a routine notice or a change note, use that register's row in `drafting/references/registers.md` instead: plain reporting that stops when it is done is a pass there."
  - its twins in `reading-panel.md`, the same scope on both stance lines: `:9` "- Wire test, per layer (pieces that make an argument): straight news is right for the first line and wrong for a body sentence." and `:36` "- Distillation test (pieces that make an argument): state in one sentence what the piece *argues*. A restatement of the event means no stance - automatic `fix`."
- **What stays:** both tests, for the registers that argue, and the order of a pass (`:20`).

## The owner's gates

- **Every proposed sentence is read by a model,** so each needs the owner's yes, as drafted or reworded.
- **Place 4 is his pick** among three options.
- **Place 2 is legal wording** in a public file.

## What the changes must not touch

- the rules the six places lean on:
  - a list may reject a draft and never prescribe one;
  - the ban on invented quotes;
  - the gate before the panel;
  - the forced choice, unless (c) is picked;
  - the short item;
  - the stance tests for the registers that argue;
- the skills' descriptions and the catalog: no skill is added or removed.

## Questions only the owner can answer

1. **Place 4:** (a), (b) or (c)?
2. **Place 2:** the new sentence speaks of the US only, and German law on invented quotes was not read. Change the sentence as drafted, or have the German framework read first?
3. **When:** are the six made on `dev` before the release, or later?
