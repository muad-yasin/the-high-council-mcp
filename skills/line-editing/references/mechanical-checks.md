# Mechanical checks - what to script, and how they fail

A script is worth writing for one class of problem: things that are **objectively true or false, invisible one item at a time, and cheap to count.** Everything else is reading.

**All of these are rejectors or advisory flags, never targets.** A batch that scores perfectly can still be worthless - the six-piece batch behind this skill's "rejects, never prescribes" rule passed every check that existed at the time.

## Per item

- **Character counts on every length-capped layer.** By script, never by eye; fixes made late under a length limit cost substance.
- **Banned or reserved words, on word boundaries**, across every layer - words withheld for gravity, words nobody says aloud, a name that must never appear. A naive substring match for a two-letter identifier once matched every word containing those letters.
- **The wrong dash, currency symbol or quote glyph.** One owner per convention, checked mechanically.
- **A quote or structural break in a layer that forbids one.**
- **An empty field with a silent fallback behind it.** The most valuable check here and the least obvious: where a missing subhead quietly renders the headline instead, the failure looks fine in review. Anything with a graceful fallback needs an explicit emptiness check.
- **A final sentence opening on "Ultimately" / "In conclusion" / "In the end".**
- **The dash sandwich** - two or more mid-sentence dash breaks in one body sentence. Split on paragraphs before sentences.

## Per batch

- **Identical opening moves** across items.
- **Shortest-sentence lengths clustering on one number.** A real fingerprint: every piece in one batch had a shortest sentence of exactly five words, because a rule demanded six or fewer.
- **One verb owning every headline.**
- **Filler-idiom hits** from the newswire and machine-tell lists - advisory; a hit means read the sentence.
- **Quote-mix drift**, where a house convention exists, on the layer that actually carries quotes.
- **Negation-monoculture count** on positive batches: items that pivot or close on "no X, no Y - just Z". More than one load-bearing instance is the fingerprint.

## Library-wide

- **Named-but-unlinked.** Where items carry an "affected entity" field, find items whose field is empty but whose text names a known entity on a word boundary. Not automatically wrong, always worth a look: an item that names something and links nothing loses every downstream behaviour that depends on the link. This gap was found by hand twice before anyone scripted it.
- **The category sweep for real names.** Sweep from the category, not from the examples that prompted the rule. One shape that found five unaltered real organizations in shipped text: rank every all-caps acronym by frequency (your own names are the bulk, so anything unfamiliar is a finding), then run a spelled-out pass for *Foundation | Institute | Association | Commission | Agency | Bureau | Department | Ministry | Court | Union | Council | Prize | Alliance*.
- **Convention drift.** Check the shipped library against the house rules periodically. One audit found 17% of items breaching a rule in force for months, many written after it landed and approved in review.

## Three lessons about writing a check

1. **Enumerate the paraphrases before you write the pattern.** A guard with a synonym hole gives confidence without coverage. One pattern was widened three separate times, each after something slipped through that any reader would have caught.
2. **A guard's file list is as easy to under-populate as its pattern**, and running clean tells you nothing about what it didn't read. When content moves, extend the check's scope in the same change.
3. **A completion claim names how it counted.** "Checked" is not a result; "checked N items by method M, found K" is.

## The honest limit

Zero *shipped* bad work is reachable, because a human sign-off is part of the system. Zero *generated* bad work is not something checks can promise: emptiness is an absence, and every mechanical definition of "not generic" one project wrote was eventually satisfied by generic text. These checks make bad drafts rare, named and cheap to kill.
