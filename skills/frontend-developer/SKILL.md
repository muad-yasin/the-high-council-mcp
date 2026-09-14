---
name: frontend-developer
description: General frontend/interface engineering rules - component structure, data binding, accessibility, state-driven UI, and the verification discipline UI code needs beyond "it compiles." Use whenever writing, modifying, or reviewing any code that renders or drives an interface - web components, CLI output formatting, a terminal UI, a desktop app view - including small tasks like wiring a button or displaying a number, even if the request doesn't say "UI." Not for game-specific rendering (Unity canvases, uGUI, a fixed-camera 3D scene) - that is a ui-implementation/visual-craft skill's job if one is installed. Not for business logic, data models, or persistence - that is backend-developer's.
---

# Frontend Developer

You implement interfaces: whatever renders or reacts to a person's input, whether that's a web page, a CLI's output, a terminal UI, or a desktop app view. Correctness of what's implemented is this skill's job; whether it's also *well-designed* (the right flow, the right states, the right hierarchy) should already be settled before this skill's rules apply - if no such pass happened, do it first rather than implementing a guess.

## Design away the bug class

Most of the rules below exist because a whole bug class was made structurally impossible, not because someone remembered harder - **make illegal states unrepresentable.** A shared formatter replaces scattered ad hoc formatting calls in which "one call site drifts from the rest" was representable. A single source of navigation/visibility truth replaces a scattered set of show/hide flags in which "two things are both visible when they shouldn't be" was representable. So when a UI bug recurs in the same shape a second time, the first question is **"can this class be made unrepresentable?"** - not "where else do I patch it?" A build-failing guard (a lint rule, a test that scans for the pattern) is the second-best answer; a comment recording the past fix and trusting the next person to remember it is the worst.

## Hard rules

1. **UI is never logic.** No business rules, no derived-value computation, no state mutation inside a component or view. A component reads from a data/state layer and calls its public methods; an `if` deciding a business outcome inside a UI file means stop and move it - reading a flag to decide *what to show* is fine, computing the business math that produced the flag is not. Positively: **a component/view is a deep module** - a small public surface (render inputs, events out) hiding all of its own internal wiring. If a caller has to reach into a child element to make a component behave correctly, the surface is wrong.
2. **UI reacts to events/state changes; it doesn't poll for something that already has one.** Subscribe to state changes; always unsubscribe/clean up on teardown - a leaked subscription outliving its component is the single most common UI memory/behavior bug across every framework. Two standard exceptions: a component resolving a reference to a sibling that may not exist yet does one lazy lookup at first real use rather than assuming initialization order; and a state that can already be true before a component ever mounts (an event fired during app bootstrap) needs an explicit one-time sync check right after subscribing, or a late-mounting component never sees it.
3. **Every real interactive/tap target meets a real minimum size** for its platform (commonly ~44-48 device-independent pixels on mobile, with real spacing to its neighbor) - a decorative icon may render smaller as long as its actual hit area meets the minimum, which is computable from the element's real bounding box, not eyeballed.
4. **Follow the established pattern in the codebase before inventing a new one.** Check how an existing, similar screen/component does layout, animation, or state before reaching for a new library, a new CSS approach, or a hand-rolled version of something the codebase already has a helper for.
5. **Audit any per-frame or per-tick UI work for cheap-to-miss recurring costs:** an unthrottled read of a large/slow data source on every render tick; visiting slow-changing data at fast cadence when it could be split into an active fast-changing subset and a throttled background sweep; and verbose logging left live in a hot render path instead of gated behind a debug flag that's actually off in production.
6. **Never let dynamically-sized content sit in a container that assumes a fixed size unless overflow is explicitly the intended behavior.** Wrapping text, a growing list, or a resizing image needs a container that grows with it (or an explicit, deliberate `overflow: hidden`/truncation) - a container sized for "should be enough" silently clips or overlaps the moment real content is longer than the guess. **Verify by measuring the actual content against the container, not by eyeballing a screenshot with short placeholder text** - and re-check whenever a new length ceiling is authored (a field budgeted for "a short name" breaks the moment someone's real name is long).

## All-states rule - never ship happy-path-only UI

Every element bound to real data must explicitly handle each state it can actually be in - typically **locked/unavailable, first-time/empty, loading, active/populated, and error.** If a request only describes the active state, implement the others anyway and say so - don't ship something that only works once there's already data in it. A newly-interactive element needs a real visual signal that it's interactive (not just a correctly-wired click handler with no visual cue) as part of shipping that state, not a follow-up polish pass.

**Prefer a state model over accumulated booleans.** When a show/hide condition grows a third `if (isX && !isY && ...)`, the branch itself is the symptom - the fix is one explicit state value the UI switches on, so an impossible combination can't be written or reached.

## Data binding rules

- Display values come from the data layer's own events/read models - match them exactly; never guess a field name, and never recompute a value from raw state when the data layer already exposes the computed form.
- All formatted output shown to a user (money, dates, numbers, percentages) goes through one shared formatting utility - never format inline at each call site, and never use a locale-sensitive default formatter/parser without pinning the locale explicitly. Locale-sensitive number parsing (a decimal separator that silently changes by machine locale) is one of the most commonly reproduced bugs across every mainstream language's standard library, and it is exactly the kind of thing generated code reaches for by default - pin the locale/culture explicitly at every parse and format site that touches user-facing numbers.
- Disable interactive elements during an in-flight operation (a submit button mid-request) to prevent duplicate submissions.
- A frequently-changing display (a live counter, a countdown) should only actually write to the DOM/render target when the displayed value changes - re-rendering unconditionally on every tick is wasted work that compounds under load.
- **Displayed value equals committed value: a preview of an amount or result some other layer will later commit is computed via the same function/call that layer uses to actually commit it - never re-derived inline in the UI.** The failure mode is silent drift: a rule changes on the committing side, the preview doesn't, and a user sees a promise the system doesn't keep.
- Never carry meaning through color alone (a red/green status, a colored badge with no icon, label, or count) - pair it with a shape, icon, sign, or word, both for accessibility and because a solid color with no other signal reads as an error state or a rendering glitch to a real user.

## Right-sizing (don't over-engineer)

- Get the interface correct first; optimize only against a measured problem, not a guessed one.
- Don't abstract a component or helper until a **second real use case** exists - one call site is a hypothetical seam, two is a real one.
- Basic responsiveness and the accessibility items above are part of "done," not a later polish pass.
- Turn off pointer/click handling on any element that never needs input (a label rendered inside its own button, purely decorative art) - a small, free win against per-frame hit-testing cost, worth doing by default rather than only when it's measured as a problem.

## You cannot self-certify UI

"It compiles" and "the click handler ran" are not evidence the UI is correct. Generated UI has measured weaknesses landing precisely on the rules above - the strongest argument they're load-bearing rather than stylistic:

- **Color/contrast accessibility.** Generated interfaces score poorly against real WCAG contrast and use-of-color checks by default, and simply *asking* for accessibility without a structural check often makes it worse, not better - pair the rule structurally (never color alone; a real contrast check) rather than relying on a prompt reminder.
- **Happy-path bias.** The state most likely to be missing from a first draft is the one that wasn't in the example the author was looking at while writing it - see the all-states rule above.
- **Locale-sensitive parsing/formatting.** See the data-binding rule above; this recurs specifically because the naive, unpinned call is the shortest one to write.
- **Verification shortcuts on ambiguously-graded work.** A direct programmatic invocation of a click handler (`element.click()`/`onClick()` called in code, bypassing real hit-testing), a clean compile, and a screenshot that *looks* right are all weak evidence - none of them exercises whether a real user's click/tap would actually land on the element. Where a check genuinely isn't automatable, say plainly what was *not* verified rather than letting a summary imply it was.

Further depth on verification discipline and a reviewer's checklist: `references/verification-and-review.md`.
