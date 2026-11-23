# Registers - picking one on purpose

A register is not a tone setting. It decides what the piece is *for*, which Step-1 question you ask, what the ending has to do, and which failure you are most likely to produce. Picking one by default - usually "neutral, mildly enthusiastic" - is how copy ends up sounding like all other copy.

**The material's engine decides the register, not its subject.** The same company can be the subject of a critical piece, a warm piece and a notice in one week. Ask: is there a wrong in the verified material, a good choice, or neither?

## The catalogue

| Register | Engine | Ending's job | Its own failure |
|---|---|---|---|
| **Critical / satirical** | Someone with power did a wrong that is in the record | Deny relief | The mechanism proved coldly, with no stance |
| **Warm / positive** | Someone made a good choice; no villain in the facts | Grant continuation | Press-release tone; a jab at a target that isn't there (`good-news-writing`) |
| **Explanatory / documentation** | The reader believes something that costs them | Hand back control - the next action | Completeness performed instead of usefulness |
| **Promotional** | A capability that did not exist before | One concrete consequence | Claiming the feeling instead of showing the cause |
| **Memorial** | A death, a loss, a harm to a real person | Preserve | Any humour at all; solemnity standing in for a detail |
| **Change note** (commit message, changelog entry, pull-request text) | Something changed for the people who use or maintain it | What the reader must do, or what cannot be undone | Praise of the change in place of the change; the work's history in place of its effect |
| **Routine notice** | Something happened; it proves nothing | None | Being written as a piece |
| **Status report / result summary** | A decision someone must make, or an open item | The open item, or the decision asked for | A verdict word stronger than the check behind it; a question's premise answered instead of checked; a status word with no date or conditions |

## Rules that cross registers

**Never punch down.** The target of a critical piece is whoever had the power and used it - never the people the harm landed on, never the reader, never someone who could not have chosen otherwise. Most breaches are accidental: an aside that reaches for a laugh from a group already in the story as victims.

**If the house line is neutrality on a conflict, even-handedness is a stance, never a fact.** Where a publication stays out of wars, elections or culture-war fights, the legitimate target is the class of actor who profits from a conflict or could end it - never one side against the other. The trap is asserting "both sides" as a *fact*: one draft claimed that governments on both sides of a live front line bought from the same vendor, one clause after naming a real company and a real war. The source said otherwise. That was a false factual claim and a stance breach in one sentence.

**Some text is somebody else's to write.** A founder's letter, an apology, a condolence, a personal statement - drafting someone's sincere voice for them is not a service; it is a forgery of their register. On one project, every line in a named character's sincere voice was written by the project owner and only formatted by the agent. Ask for the person's own words, then edit those.

**Registers don't mix inside a piece.** A warm piece that turns to indict an industry for two sentences has stopped being warm without becoming critical; it has a mood swing. If the material genuinely carries both, that is two pieces.

## The status report

Prose about a result, for a reader who acts on the first line. The sentence it answers: **what did the check actually establish, what does it not establish, and what decision does it bear on?** It ends on the open item or the decision asked for, not on a summary of the work. Three failures, each from a real status text that a decision-maker acted on or nearly did:

- **A verdict word stronger than the check behind it.** A check was first reported as "YES, lined up" when it was built so that only that answer was possible; it could not have said no. Before writing the verdict, ask whether the check could have come out the other way. If not, the line says what was run and that it does not discriminate. (Whether a check is evidence at all is `verification-and-critique`'s, and so are the general rules on reporting results, its Part 4.)
- **A question's premise answered instead of checked.** "Where is the missing data?" presupposed that data was missing; in 12 of 16 failing cases all the data was present and the process had rejected it on its own checks. The first sentence of the answer corrects the premise, then answers the real question.
- **A status word with no date and no conditions.** "Ready", "done" and "approved" go stale while still reading as current: documents kept saying "ready to call" after the owner's decisions had changed, and the next reader would have acted on them. Give the status word its date and the decision or condition it depends on, and when the decision changes, mark the old text superseded rather than leaving it.

A claim about proof is scoped to the sample it covers ("fits these cases", never "fixes the class").

## The change note

Prose about a change, for two readers: the one who must act on it now, and the one who searches for it a year later. The sentence it answers: **what changed for the person who uses it, what must they now do, and what can no longer be undone?**

- **What the reader must do comes first** - a migration, a renamed flag, a removed option - because a reader who stops after two lines must still have met it.
- **Then what changed, as behaviour the reader can observe**, with the before and the after where either is short enough to show. "Refactored the loader" describes the writer's day; "a missing config file now gives the default instead of an error" describes the reader's.
- **It says what changed, never that the result is better.** "Faster", "improved" and "more robust" are claims that need a measurement, and a changelog is where an unmeasured one hardens into a product claim (`verification-and-critique`, Part 4).
- **It names what cannot be walked back** - data migrated one way, a format that older versions cannot read - because the reader plans the upgrade around it.
- **It leaves out how the work went.** Session names, ticket ids nobody outside can open, and the order things were tried are the writer's history; the next reader cannot use them.

## The hard calls

**Warm vs critical, when a real contrast exists.** A company whose only unusual feature is that someone actually reads the applications is, implicitly, an indictment of its industry. Test: **does the contrast exist in the verified facts, or would you have to build it?** If you would have to build it, write it warm and drop the jab. Underselling a real contrast is recoverable; a sideways attack on a target who isn't in the record is not.

**Memorial vs warm.** Memorial is never warm-with-restraint, and a living subject never gets memorial gravity ("a celebration of a life"). That is solemnity creep, and it reads as if you mistook the subject for dead.

**Learning vs doing, in documentation.** Before drafting a documentation page, ask two things: does the page guide what the reader does, or inform what the reader understands; and is the reader acquiring a skill, or applying one they already have? The answers give four different texts - a lesson (doing, while learning), a recipe for one task (doing, at work), a reference to consult (understanding, at work), an explanation to think with (understanding, while learning) - and a page that tries to be two of them serves neither reader. Both questions and the four kinds are the Diátaxis framework's (`evidence.md`).

**Promotional vs explanatory.** An announcement that explains how the feature works is two registers taped together and does neither job. Announce the capability, then link the documentation.
