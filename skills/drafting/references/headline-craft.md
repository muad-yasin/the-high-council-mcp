# Headlines and layered surfaces

Written from shipping several hundred short pieces that readers met as a scrolling line first and a page second. It applies to any layered surface: subject line then email, card title then description, doc heading then first paragraph, ad line then landing page.

## Three layers, three jobs

| Layer | Job | Register |
|---|---|---|
| **First line** (the one met first: a feed row, a subject line, a card title) | What happened, to whom - enough to decide whether to open it | Fact. Reports; never characterizes. |
| **Header** (on the page, once opened) | The angle: what makes this a story - the kicker clause, the precise figure, the one quote | Angle |
| **Body** | The argument - the reason to read past the first line | Argument |

**Report, angle, argument - a ladder of increasing interpretation.** The payoff lives in the body. Putting the joke or the hook in the first line spends the body's best material before anyone has read it, and a line that performs every time it scrolls past reads as the product mugging at its reader.

## The first line - report the news

One clause: subject, active verb, object. Invented examples in the shape that worked:

> Harbor Logistics opens two more depots
> Regional bank fined for moving cartel money
> Fund manager fakes his own death to escape fraud charges

What the form does:

- **The flat statement is the deadpan.** Serious news carries its full weight undecorated; decoration takes weight away.
- **The verb carries the direction** - *opens, fined, collapses, fakes*. Valence lives in the verb, not in a kicker bolted on with a dash.
- **The verb is a completed action,** not an intention, a status or a process. Rejected in one real batch: *puts, moves to cap, joins after clearing, stands by, to merge*. The one legitimate weak verb is *says*, when the news is that somebody said it.
- **Numbers are rounded** - their job here is scale; precision belongs downstream. **Round the verified figure, never a guessed one.**
- **What the reader acts on leads the sentence.** "An analyst puts Company X's fair value at 40" buries the name behind a generic actor.
- No quote, no structural break, no dash-kicker.

## The header - state the angle

The reader has already opened it, so the header frames the piece rather than winning a click. It is roughly the Step-1 sentence in news clothes, and it is where classic headline craft lives: the break, the kicker, the precise figure, at most one quote.

Defaults, not rejectors: **one sentence, with a named subject.** A two-sentence header is usually the body's opening in the wrong slot; one opening on a bare pronoun makes the reader guess who they're looking at. Both have legitimate exceptions. On the project this comes from, both were hard rejectors until a library audit found 17% of shipped headers breaching them - many written after the rule landed and approved in review. **A style rejector your own approved output keeps breaking has become a default; update the rule or enforce it, but don't pretend it holds.**

**The header has no floor.** When a strong body leaves it little, the honest header is short.

## The collision, and the two exits

**The header and the body's opening can't both be the claim.** This is the most valuable rule here (mechanism: `../SKILL.md` Step 4). Two exits:

- **Move the body.** Open on an object, a definition the reader already owns, the surrounding world, or the mechanism; let the claim arrive in the second beat.
- **Move the header.** When the body's opening genuinely is the evidence and belongs there, let the header take the scale, the superlative, the money - whatever the opening didn't spend.

Which is right depends on whether the opening was already earning its place. That's judgment, not a checklist.

## The one exception

On a one-line item - a notice, a gag - the first line and the header may be near-identical: there is only one clause to spend. Safe only where the reader never sees the two stacked (the list shows one, the page the other). Check that first.

## Mechanics worth fixing once

- **Set a hard character ceiling and check it by script, never by eye.** Two sessions on one project blew the ceiling repeatedly by eyeballing, and every late fix cost substance.
- **A length floor is usually a mistake.** It produces padding; short is a consequence of the right form. The project retired its own minimum-length target for this reason.
- **One structural break character, used everywhere.** Mixed dashes across a library are a visible inconsistency (see `line-editing`'s notes on the em dash).
- **A name is always the same name and spelling.** Recurring entities are always named, because recognition is the signal. A one-story person may appear as a role in the first line ("fund manager") with the name on the page - the head-then-lede structure newspapers use. That covers people, never the organization the reader is meant to act on.
- **Watch the identity merger.** Where a person *is* the organization, naming both spends a clause restating the subject. Would cutting one lose the reader anything?
