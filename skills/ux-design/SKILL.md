---
name: ux-design
description: General UX/product design process - flow, wireframe, screen states (locked/empty/first-time/loading/error), notification hierarchy, onboarding, and dark-pattern screening for any interface with a real user. Use this skill BEFORE any UI implementation, whenever a task involves designing, planning or changing a user-facing surface - even small requests like "add a button" or "show X to the user," and even if the request never uses a design word. Use ahead of frontend-developer, not instead of it - this covers what to build and why; frontend-developer covers how to implement it. Not for "does this actually look right" judgment - palette, composition, material, and spatial staging are visual-craft's. Not for game-specific screen/scene design - that is a ux-design/visual-craft skill's job if a game-specific one is installed.
---

# UX Design

You are designing a user-facing surface. Core discipline: **flow before visuals** - never jump to layout or style before the user's path is mapped. A small visual-only finding that doesn't need a full design pass belongs in a lightweight backlog note, not a fresh design cycle.

**Real, previously-hit failure modes, generalized from shipped production work** (text truncation vs. real measured height, inconsistent stat display across two screens, a displayed unit that disagrees with the product's real clock, transient messages overwritten by unrelated refreshes, stale cached viewport geometry, unguarded lifecycle-transition reconciliation, literal mockup-import fidelity) live in `references/field-lessons.md` - **read it before a review pass on shipped UI/UX work, or when a defect "feels familiar."**

## Step 1: Map the user flow (always first)

- What is the user trying to accomplish, and why now - what got them to this screen?
- Steps in order, from entry point to goal. What's the minimum number of actions to value? Cut steps.
- Decision points and branches (e.g. "if the user can't afford the action, show X").
- Which existing surface does this live in - or does it genuinely justify a new one? Adding a new top-level surface is a bigger decision than extending an existing one; don't reach for it by default.
- **No interruption/takeover fires on its own.** Any full-screen or modal interruption is gated behind an explicit user action (a tap, a click on a real control), never a background-condition cold-open (a timer, a threshold crossing, an app-open event with nothing the user did). A first-run/onboarding sequence is the one legitimate exception - and even that should be a deliberate, named override, not the default shape a new flow reaches for.
- **Before scoping a tutorial/hint for a behavior, check whether an existing persistent UI element already teaches it.** A design pass that assumed three gaps needed new copy can find that most were already self-teaching via existing labels or affordances - only the genuinely-untaught behavior earns new copy. A smaller, honest scope beats padding a design pass to a round number of "onboarding tips."

## Step 2: Wireframe

- Text wireframe: regions, elements, hierarchy - no visual style yet.
- **One primary action per screen.** If two actions compete, restructure.
- Primary actions in easy reach for the input method (thumb zone on mobile, natural cursor rest position on desktop). Real minimum tap/click target sizes with real spacing to the neighbor.
- **Compose for a range of viewport sizes, not one screen.** Say explicitly where surplus space goes (a scrolling region, a spacer, a background) the same way you list states - leaving it unnamed means it lands wherever an unrelated flexible-size rule happens to sit, and that gap is invisible in any screenshot taken at exactly the size you designed for.
- **Keep interactive content out of any real hardware/OS keep-out zone for the target platform** (a device notch, a system status bar, an OS-reserved edge) - this is an authoring-time rule to check explicitly, not something the runtime silently handles for you.
- List every state the screen can be in: locked/teaser, first-time, empty, loading, active, error. What does each one communicate about what's coming?
- **Decide mystery-lock vs. full-transparency deliberately per screen - don't default to one uniformly.** A screen whose purpose is discovery/surprise should hide locked content entirely; a screen whose purpose is planning/investment should show locked content's full name/cost/requirements up front, since seeing the whole shape is the point. Pick based on which job the screen is doing, and say which you picked and why.
- **Every locked/empty state needs the same four things a real empty-state screen needs**, not just a blank/greyed-out control: a short headline for what's there, a one-line reason why it's not available yet, a visual/icon cue, and - where one genuinely exists - a clear next step. A vague generic hint ("check back later") is a worse default than either a plain dimmed lock with no caption, or a real reason - decide which of those two shapes fits, don't invent a third that says nothing.
- **A newly-interactive element needs a visible affordance that it's tappable/clickable** as part of its design, not left to implementation to notice - an icon, highlight, chevron, or caption. This is one of the most commonly-missed requirements specifically because a wireframe pass tends to describe *what* an element does without ever calling out that it needs to *look* actionable.
- **Say which of two jobs each visual signal is doing: *inviting* (draws attention - a glow, a pulse, a badge) or *informative* (legible but receding - a label, a count, a chip).** This distinction (from Celia Hodent's UX framework for games, which generalizes cleanly beyond games) stops an informative element being over-animated into a nag, or an inviting one styled too quietly to invite. Related two-second habit: if a control needs a caption to explain its own verb, question the control before writing the caption.

## Step 3: Accessibility pass (don't skip, even for a prototype)

- **Never rely on color alone** for status, outcome, or state - always pair color with a shape, icon, sign, or label so colorblind users can read the same information.
- Sufficient text contrast on all backgrounds.
- Visible labels on inputs, not placeholder-only.
- Touch/click targets and spacing verified at real small-viewport sizes, not just the design's own comfortable default.
- **Motion is an accessibility axis too.** Full-viewport motion (large parallax, screen shake, aggressive transitions) is a documented motion-sickness trigger. Sustained small motion (pulses, subtle glows) should read as noticeable, not nagging; any genuinely-needed large-scale motion gets a reduced-motion opt-out designed alongside it, not retrofitted after a complaint.

## Step 4: Notification hierarchy and user trust

- **Pick the right intrusiveness tier deliberately - don't default to the loudest one.** A working ladder, cheapest-to-loudest: a passive badge on a persistent entry point for a background event the user isn't waiting on; a persistent-but-dismissible banner/strip for something time-sensitive but not critical; a full takeover (modal, interstitial) reserved for something that genuinely needs the user's undivided attention right now, and even that gated behind an explicit user action per Step 1's no-auto-fire rule wherever possible. Match the tier to how urgent the information genuinely is, not to how much the feature wants to announce itself.
- **A transient surface owns its own exit, designed as an explicit state** - exactly when it goes away (on dismissal, after one full read/cycle; never "freeze indefinitely with no way out") and whether it reappears on reload. A notification with no designed exit is the one a user eventually reports as a bug ("it's stuck").
- **Screen for dark patterns before finalizing any design with a monetization or engagement angle - and treat this as compliance, not taste.** Named categories worth checking against explicitly: nagging (repeated interruption for the same ask), forced continuity (making cancellation harder to find than signup), confirmshaming (guilt-worded decline options), roach motel (easy in, hard out), disguised ads, and hidden costs revealed only at the last step. **No feature should ever sell the recovery from a user's own mistake** - a "restore your data" or "undo this" path that's free for anyone but paywalled for someone who tripped it accidentally is the shape to flag hardest. Anything with real user-psychology or monetization stakes deserves a second pass from someone (or something) other than whoever designed it, before it ships.

## Step 5: First-session and onboarding

- **Teach by doing, never by "press this button" modals.** The most commonly cited failure mode in onboarding design is a lock-out tutorial that imposes one allowed action and blocks everything else - a real first instance of a mechanic, hand-authored, teaches better than an instructional overlay describing it. One new concept per beat.
- **A forced, linear guided sequence (can't skip, can't go back) is a deliberate override, not a default shape.** It costs real trust if used casually - reserve it for a true first-run experience, and treat every additional guided sequence after the first as a new argument made from scratch, not an inheritance from the first one's precedent.
- Time-to-first-value matters: measure roughly how long a new user takes to reach the product's actual core action, and treat a long stretch of setup/explanation before that point as a real design problem, not an acceptable cost of "onboarding."

## Judgment discipline: push back, don't validate

**When the asked-for direction is weaker than one you can see, say so before executing, and present the alternative with its trade-offs.** On any project without a dedicated design team, a design skill's most valuable output is often the pushback, not the execution. Hold that recommendation under mild pushback if the reasoning still stands; fold immediately once the person you're building for makes an actual decision, record it as a deliberate override, and never re-litigate a settled call without new information. And never invent a UX statistic or cite an unnamed "study" - a fabricated number launders opinion as evidence and will eventually get checked.

## Mistakes to actively flag

- Visuals or mockups requested before a flow exists → produce the flow first.
- More than one competing primary action on a screen.
- A new interaction pattern inconsistent with established surfaces, without a stated reason.
- Skipping accessibility because "it's just a prototype" - cheap now, expensive to retrofit.
- An interruption designed to auto-fire off a background condition instead of gated behind a real user action.
- A locked/empty state that's just a greyed-out control with no headline/reason/next-step.
- An interactive element with no visible affordance that it's interactive.
- A notification pitched louder (or quieter) than the information's actual urgency warrants.
- A design with monetization/psychology stakes that skips an independent second look.
- An action whose name changes between the control, the confirmation, and the result.
- An error state that says what failed without saying what to do next.
- A label carrying both a joke/brand voice moment and the only statement of a rule the user needs.
- A UX claim propped up by an invented statistic or an unnamed "study."
- A design direction validated because it was asked for, when a visibly stronger alternative went unmentioned.
- The same correction absorbed twice without being written down anywhere.

## Voice and handoff

**Tone and function can fight - both bind, but function wins on anything the user acts on.**

- **An action keeps the same name through the whole flow.** A control that says "Delete" produces a confirmation that says "Deleted," not "Operation complete." A button that commits an action names the specific verb ("Delete file", "Send €50"), never a bare "OK" - the generic verb sends the user back to re-read whatever explains what they're about to do.
- **Name things by what the user controls, not by how the system is built.** A user manages files, messages, or orders - never a "handler," a "controller," or a "state." A user-facing label that leaks an implementation noun is a copy defect, same severity as a missing empty state.
- **An error says what happened and what to do next, in the product's voice.** No apologizing, no vagueness about what failed. "Something went wrong" is a stub, not real copy.
- **Each element does exactly one job.** A label labels, a caption explains, an example demonstrates. A label carrying a brand-voice joke *and* the only statement of a rule the user needs is a design bug - the user who skims past the joke loses the rule. Where a personality/voice element and clarity genuinely conflict on anything the user acts on, split it into two lines rather than picking one at the other's expense.

Hand off to frontend-developer as: confirmed flow + wireframe + complete states list. This skill owns the *what/where* - it doesn't own whether the resulting composition, palette, or spatial staging actually reads well once built. That's `visual-craft`'s job; hand off to it once flow and implementation are both settled.
