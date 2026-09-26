# Text that renders inside a product

Written from shipping text inside an app - dialogue, messages, notifications, tutorial lines, list rows, buttons. **Where it stops:** nothing here covers localization, store listings, or platform review policies. Store character limits and rules change per store and per year, and a stale copy here would be worse than none - check the store's current documentation.

## What the medium changes

**The reader often can't re-read and can't pause.** A toast, a scrolling line, dialogue that advances on tap. Anything load-bearing must survive first contact, so **put what the reader must act on early in the sentence** - the back half of a line met in motion is decoration.

**The column is narrow.** A 130-word block on a phone reads as work before it reads as content. That's a reason to break where the piece turns, but the cheap one; the real one is that the break marks the joint in the argument.

**Every string has a hard ceiling, set by geometry, not taste.** Find it before writing and check counts by script. Two traps:

- **The ceiling that is only usually hit.** The longest real string is rarely the longest name; it's the combination of a long name, a long status word and a wide number landing together. On one project the binding case was always the state nobody measured.
- **Auto-shrinking text doesn't fix overflow; it hides it.** It looks fine in one screenshot and ships to a device with a different screen.

**The surrounding interface is already speaking.** If a red banner above the line says URGENT, the line doesn't also get to shout. Read each string with its chrome - label, badge, icon, the button beneath - because that assembly is the sentence the reader actually gets.

**Text met once is read by someone doing something else.** Onboarding and tutorial copy is skimmed at speed. Write the thing to do, not an explanation of why it exists.

## Rules that survived contact

- **Withhold the action, never the information.** A locked or unavailable item says what it is and what it costs; the button is what's withheld. A planning screen is not a discovery mechanic. (A deliberate exception on one project: a physical object in a game world left silently unusable so players would wonder about it. It worked because it was an object in a world, not a menu row - a screen keeps transparency, a world can keep a mystery.)
- **A caption explaining a lock the reader can't resolve is a nag.** Plain dimmed chrome reads better.
- **Currency, units and number formatting have one owner in code; copy follows it.** Docs and design copy that disagree with what the product renders drift forever.
- **Don't state in prose a number that also lives in the product.** Point to where it lives; a hand-copied figure goes stale silently.
- **Frozen text is frozen.** Someone's own sincere words, a legal string, a dictated line: edit only with per-item sign-off, never in a sweep. Writing new text beside frozen text is normal; rewriting the frozen layer is not.

## The batch problem

In-product copy is written in batches - twenty rows, ten notifications, a screen of empty states - and **uniformity is invisible one item at a time.** Read the whole batch in a row before shipping any of it: the same opening move, the same shape, the same verb owning every line.

**But a recurring conclusion is not a fingerprint.** If the same finding keeps arriving because the material keeps producing it, that's the thing being true. Steering around it to look varied means declining to say it. Vary how it lands, never whether it lands.
