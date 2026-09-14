---
name: frontend-developer
description: General frontend/interface engineering rules - component structure, data binding, layout across real viewport sizes, input and lifecycle handling, accessibility, importing an external design mockup literally, and the verification discipline UI code needs beyond "it compiles." Use whenever writing, modifying, or reviewing any code that renders or drives an interface - web components, a mobile or desktop app view, a game engine's UI layer, a terminal UI, CLI output formatting - including small tasks like wiring a button or displaying a number, even if the request doesn't say "UI." Run ux-design first for anything newly shown to a person; its flow, wireframe and states list are this skill's input. Not for business logic, data models, or persistence - that is backend-developer's. Not for whether the result looks right - that is visual-craft's.
---

# Frontend Developer

You implement interfaces: whatever renders or reacts to a person's input. Correctness of what's implemented is this skill's job; whether it's also *well-designed* (the right flow, states, hierarchy) should be settled before these rules apply - if no such pass happened, run `ux-design` first rather than implementing a guess. Whether the built result *looks* right is `visual-craft`'s.

## Design away the bug class

Most rules below exist because a bug class was made structurally impossible, not because someone remembered harder - **make illegal states unrepresentable.** A shared formatter replaces scattered formatting calls in which "one call site drifts to the machine locale" was representable. A real navigation stack replaces a scattered hide/show list in which "two screens both visible" was representable - and turns every new screen from another chance to forget a sweep site into zero sweep sites. So when a UI bug recurs in the same shape, the first question is **"can this class be made unrepresentable?"** - not "where else do I patch it?" A build-failing guard (a lint rule, a test scanning for the pattern) is second-best; a comment recording the past fix is the worst, and demonstrably so: one project re-shipped a wrapping-text bug eight lines below the comment documenting its earlier fix. **The limit:** over-constraining creates brittleness. Constrain the states that have actually bitten you; a new invariant with no incident behind it is speculation with a test attached.

## Hard rules

1. **UI is never logic.** No business rules, derived-value math, or state mutation in a component. Reading a flag to decide *what to show* is fine; computing the business outcome that produced it is not. **A component is a deep module** - a small public surface (render inputs, events out) hiding its internal wiring. If a caller reaches into a child element to make it behave, the surface is wrong.
2. **UI reacts to events; it doesn't poll for state that has one.** Always unsubscribe on teardown - a leaked subscription outliving its component is the most common UI bug across frameworks. Two standard exceptions: a reference to a sibling that may not exist yet is resolved lazily at first real use, never assumed from initialization order (an early call silently no-ops forever otherwise); and state that can already be true before a component mounts (an event fired during bootstrap) needs a one-time sync right after subscribing.
3. **Real minimum hit targets** for the platform (commonly 44-48 device-independent pixels on touch, with real spacing to the neighbor). Decorative art may render smaller if the *hit area* meets the minimum - computable from the element's real bounds, never eyeballed.
4. **Follow the established pattern before inventing one.** Check how an existing similar screen does layout, animation, state, and input before reaching for a new library or hand-rolling something the codebase already has a helper for. Settled layout choices stay settled - reuse them, don't re-litigate them per screen.
5. **Audit per-frame/per-tick work for cheap-to-miss costs:** an unthrottled read of a slow data source every tick (throttle to about a second when frame precision isn't needed); slow-changing data visited at frame cadence (split an active fast subset from a throttled background sweep); verbose logging in a hot path not compiled out of production builds. Never drive UI animation through a system that marks elements dirty every frame even when nothing changes.
6. **Never put dynamically-sized content in a fixed-size container unless overflow is explicitly intended.** Many text systems' default overflow mode does *not* clip - surplus text paints outside its box over its neighbors, silent at author time. Content that grows gets a container that grows with it (remove the fixed height - a bigger constant is not the fix); content in a genuinely fixed box gets shortened or the box widened, with truncation/ellipsis set regardless. **Verify by measuring the longest real value in the data against the container, never by a screenshot of a typical one**, and re-check whenever a new length ceiling is authored. A truncation mode can fail on the *vertical* axis too - dropping an entire line with no ellipsis and no warning, which looks like a missing binding rather than a sizing bug.
7. **Name where surplus space goes.** A layout handed more space than its design minimum puts that surplus *somewhere*. Each screen names **one** destination (a scroll region, a spacer, a background, a content area) and every sibling explicitly declares it won't grow. **Text is never a legal absorber** - it stays pinned to one edge of its growing box. Leave the destination unchosen and a growth flag set for an unrelated reason silently becomes it: one project shipped a ~450-unit hole mid-screen that survived six visual passes because every capture was taken at the one aspect ratio where surplus is zero.
8. **An overflow effect (glow, shadow, pulse) inside a clipping container clips silently.** Size the effect first, then widen the container's padding to match - never shrink the effect to fit one parent, which makes it wrong everywhere.
9. **Every release path of a press-and-hold funnels into one idempotent reset**: release, pointer leaving the element, a cancelled touch, the app backgrounding mid-hold, the element being hidden while held. The failure is a stale "held" flag outliving its gesture - a finger sliding off the button leaving an action running forever.
10. **A foreground trigger coordinating with an autonomous feed registers pending intent, then waits for a may-fire gate** - it never fires the instant its condition is due. The feed pauses while any trigger is pending; the pending flag is count-based, each instance balances its own claim, floored at zero, and released on teardown - or a destroyed trigger wedges the feed forever.

## All-states rule - never ship happy-path-only UI

Every element bound to real data handles each state it can be in - typically **locked/unavailable, first-time/empty, loading, active, and error.** If a request describes only the active state, implement the others anyway and say so. A newly-interactive element needs a real visual signal that it's interactive as part of shipping that state, not a later polish pass.

**Prefer a state model over accumulated booleans.** When show logic grows a third `isX && !isY && ...`, the branch is the symptom - the fix is one explicit state value, so impossible combinations can't be written.

## Data binding rules

- Display values come from the data layer's own events and read models - match them exactly; never guess a field name or recompute from raw state what the data layer already exposes.
- **Every user-facing number, date, and amount goes through one shared formatter with an explicitly pinned locale** - never inline, never the platform default. Locale-sensitive parsing is among the most reproduced bugs in every mainstream standard library, and the naive call is the shortest to write, so it's what generation reaches for: parsing the literal "0.55" under a comma-decimal locale has returned 55. Never parse a literal string you could write as a literal.
- Disable an interactive element during its in-flight operation to prevent double submission.
- A frequently-changing display writes to the render target only when the displayed value actually changes.
- **Displayed value equals committed value:** a preview of anything another layer will later commit is computed through the same call that commits it - never re-derived inline. Otherwise the rule changes on one side, and a user sees a promise the system doesn't keep.
- **A displayed rate's time unit matches the product's real cadence**, and two screens showing "the same" number use the identical basis - divergence is invisible until a user notices the numbers don't add up.
- Never carry meaning through color alone - pair it with a shape, icon, sign, or word. A solid-color badge with no other signal gets read as a rendering glitch.
- A non-ASCII glyph used without confirming it exists in the loaded font renders as a silent blank or box, with no warning.

## Right-sizing (don't over-engineer)

- Get the interface correct first; optimize only against a measured problem.
- Don't abstract a component until a **second real use case** exists. Apply the thin-wrapper test hardest to UI builder/generator scripts: one earns its keep by deleting drift and manual wiring, and stops earning it once it's harder to read than what it replaced.
- Responsiveness across real viewport sizes and the accessibility items above are part of "done."
- Turn off hit-testing on elements that never take input (a label inside its own button, decorative art) - free, worth doing by default.

## Importing an external design mockup

**The mockup file's literal values are the spec; never re-derive a value from how a render looks.** An agent pointed at a mockup and asked to "build this" produces a visual reproduction - close, and close is how one project shipped two card radii side by side for weeks. Extract declared values *and* resolved layout geometry, write the conversion table down, name what is deliberately not taken, and **pixel-diff any shared/foundational visual change against the mockup before building anything on top of it**. The pipeline: `references/design-import.md`.

## Timing, lifecycle, and viewport

`references/timing-lifecycle-input.md` - read before live verification, lifecycle/background-resume handling, overlay/hotspot positioning over moving content, or any transient message. The rules load-bearing enough to state here:

- **Activating an element does not run its setup synchronously in many frameworks** - put a real frame boundary between activation and interaction in any automated check, and force a layout pass before reading measured positions on first activation (a deferred layout reads stale or exactly zero).
- **Live/runtime edits made in an editor or hot-reload session can silently revert when the session ends.** Redo the accepted value as a persisted edit and re-verify from a fresh session.
- **Every lifecycle handler (resume, foreground, reconnect) answers "what if this fires twice, or fires when nothing changed?"** before it ships.
- **A cached viewport/safe-area measurement taken at startup can go stale** when the platform settles dimensions in stages - re-measure on the platform's settling signal.
- **A one-shot message and a periodic refresh that share a render target are in a race** - give the message its own slot or make the refresh skip while it's pending.

## You cannot self-certify UI

"It compiles," "the handler ran," and a screenshot that looks right are not evidence. Generated UI has measured weaknesses landing precisely on these rules: color/contrast accessibility (a peer-reviewed study found generated interfaces around 29% WCAG-compliant, and *asking* for accessibility made it worse - pair the signal structurally, then compute the check), happy-path bias, locale-sensitive parsing, and verification shortcuts on ambiguously-graded work. **Never let the same agent both write the check and certify the result.** Where a check isn't automatable, say plainly what was *not* verified.

**A capture at one viewport shape is not evidence about the others.** Verify at a short design floor, the most common real device shape, the tallest/widest ceiling, and a split-screen/tablet shape - defects that depend on surplus space are invisible at the shape where surplus is zero.

Verification protocol, the evidence graded, and the review checklist: `references/verification-and-review.md`.
