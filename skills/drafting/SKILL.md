---
name: drafting
description: Takes a brief to a first complete draft of new prose - repairing a brief that names a length but no purpose, writing the one sentence the piece exists to say before any prose, choosing a register on purpose, breaking paragraphs where the argument turns, building the ending from the reader's reaction, and keeping stacked layers (headline, subhead, opening) from rewording each other. Use whenever new text is being written - landing and product copy, documentation, announcements, emails, articles, in-product and UI text - and whenever a draft "has nothing to say". Not for revising existing prose (line-editing), for verifying claims or deciding what may be said about real people (fact-checking, which runs first on anything drawn from real events), or for warm coverage of a real subject (good-news-writing).
license: MIT
---

# Drafting

Drafting fails less often from bad sentences than from having nothing to say and writing it well anyway. The result is clean, correctly paced, and empty - and it passes every check, because checks measure the surface. This skill is the part before the surface: what the piece is for, what it argues, and how it ends.

**This skill owns:** the brief, the one sentence a piece exists to say, the register, the structure, the ending, and the order of stacked layers. **It does not own** what is true (`fact-checking`), revising text that already exists (`line-editing`), or the independent verdict before anyone sees it (`final-read`).

**On anything drawn from real events, `fact-checking` runs first.** Drafting before the facts exist means the facts get fitted to prose that is already written - the usual route by which an invented claim ships.

## The rule behind the whole skill

**Lists may reject a draft. They may never prescribe one.** On one long-running content project, a writing guide grew into a catalogue: a beat table, a sentence-length rule, sixteen named techniques. Six pieces were written with it open. All six passed every mechanical check, and all six were rejected as generic. The shortest sentence in each was exactly five words, because a rule demanded six or fewer; four of the six opened on the same clever move, because a table listed it.

Varied rhythm, a sharp opening, a turn and a landing are *outputs* of having something to say. Demanded as inputs, they produce their imitation - which is what readers recognise as machine-written. Follow the steps below; keep technique lists (the references here, `line-editing`'s tells) closed until a full draft exists.

## Step 0 - the brief, and repairing it

A brief you can draft from answers five things. Get them before writing:

1. **Who reads this, and what do they already know?** A state of knowledge, not a demographic. "A developer who has hit this error and searched for it" is a reader; "developers" is not.
2. **What do they do differently afterwards?** "Nothing, they now understand X" is a valid answer.
3. **What must survive if they read only a quarter of it?**
4. **Which register, and who is speaking?** (`references/registers.md`)
5. **What are the real constraints?** Length ceiling, where it renders, whether it can be re-read, and which text is frozen because somebody else owns it.

**A brief with a length but no purpose produces filler at exactly that length.** Say so once, in one line, then write to purpose and let the length fall where it falls.

## Step 1 - the sentence, before any prose

One sentence, answering the register's own question:

| Register | The sentence answers |
|---|---|
| Critical / satirical | What does the strongest verified detail prove, **what is wrong about it**, and who should care? |
| Warm / positive | What did they choose, what was the easy version, which verified detail makes you smile? (full register: `good-news-writing`) |
| Explanatory / documentation | What does the reader believe that is costing them, and what replaces it? |
| Promotional | What can someone now do that they could not before - the thing, not its category? |
| Memorial | What does this detail preserve? No joke anywhere near it. |
| Routine notice | Nothing. Write it short and stop. |

**The second clause is the one that gets dropped, and it is the one that matters.** When the critical question stopped at "what does this prove", five technically strong pieces in a row each demonstrated a mechanism and left the reader to supply the point. Demonstrating a mechanism is not naming a wrong. Put the stance in plain words in the sentence, or the piece will not contain it either.

When the read is uncertain, write two or three candidate sentences and pick one before drafting - culling at the sentence is nearly free. **The sentence travels with the draft into review**, so a reviewer can veto the stance in five seconds without diagnosing prose.

## Step 2 - the honesty check

If no true answer exists - the material is real but proves nothing anyone should care about - the piece is a notice, and two or three plain sentences are correct. **Do not inflate.** A full-length piece about nothing is this skill's most dangerous output, because it is clean and passes everything. Its tell is length: rejected drafts on the project above ran about twice the shipped length, with editorializing filling the space where a finding should have been.

## Step 3 - write it

**The argument enters at word one** - not as a thesis statement, as the piece already doing its work. No word count open. Every sentence serves the Step-1 sentence or goes.

**Break where the piece turns.** A paragraph break marks where the piece changes what it is doing: setup to evidence, evidence to consequence, consequence to verdict. That makes it a content check: **if you cannot find where the piece turns, it probably doesn't turn.** One library audit found 58 of 63 pieces over 70 words shipped as a single block, because each had been written as one continuous push. Fix the argument, not the whitespace.

**Build the ending from the reader's reaction, not from the argument.** An ending chosen because it completes the case retrieves a concept (a calculation, a process), and concepts don't land because they can't be pictured. Instead:

1. **Name the reader's reaction in their own words** - the half-sentence a person says aloud on first hearing this ("Wait, they did it twice?"). Generic labels ("outrage") produce identical endings across a batch.
2. **Find the verified fact that answers it.** Critical registers deny relief (it is still happening, it happened again). Warm registers grant continuation (they are still at it).
3. **State that fact and stop.** No qualifier, no explanation of why it matters.

A fact confirms the feeling; a label ("this is outrageous") relieves it. When no such fact exists, end on the last real thing. A manufactured ending is worse than none, and reaching for a stronger close is the most reliable way to invent a claim.

## Step 4 - the layer ladder

Where a piece is met in layers - headline then subhead then body, subject line then email, card title then description - **each layer climbs one step: report, then angle, then argument. No layer rewords another.** The failure is propositional, not lexical: a subhead and an opening sentence can share no words and still state the same claim twice. The cause is derivation - both are compressions of the same Step-1 sentence - so change the derivation: **the header states the claim; the body opens on evidence and arrives at it.** A detail lives in exactly one layer. Detail: `references/headline-craft.md`.

## Step 5 - read it back once, as someone who owes you nothing

Top to bottom, where and how a real reader meets it. Does each layer add something the one before didn't? Run the **deletion test on the opening sentence only**: if the piece survives without it, it was decoration. Never on the ending, which is removable by design - the ending's test is Step 3's. If something reads wrong and you can't name why, now open `line-editing`.

## Mistakes to flag

- Drafting before the facts exist on anything drawn from real events.
- A notice inflated into a feature; length as the first symptom.
- The mechanism proved and the wrong left unsaid - the piece would read the same if the writer were indifferent.
- A technique installed to have used it; a list consulted mid-sentence.
- An ending that invents a fact to land harder.
- A brief accepted with a length and no purpose.
- A register nobody chose - house-neutral is a choice too, usually the wrong one.
- A headline and an opening sentence that state the same proposition.
- Somebody's own sincere voice (an apology, a founder's letter, a condolence) drafted for them instead of edited from their words.

Registers and the rules that cross them: `references/registers.md`. Headlines and layered surfaces: `references/headline-craft.md`. Text that renders inside a product: `references/in-product-copy.md`.
