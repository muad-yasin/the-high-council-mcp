---
name: ux-design
description: Runs the design pass before any interface is built - user flow, text wireframe, every screen state (locked, first-time, empty, loading, error), accessibility, notification intrusiveness, onboarding, dark-pattern screening, and UI copy. Use before implementing or changing any user-facing surface, including small requests like "add a button" or "show X to the user", even when the request never uses a design word. Hands a flow, wireframe and states list to frontend-developer. Not for whether the built result looks right (visual-craft).
license: MIT
---

# UX Design

**Flow before visuals.** Never jump to layout or style before the user's path is mapped. A small visual-only finding that doesn't need a design pass goes in a backlog note, not a fresh design cycle.

Output of this skill, handed to `frontend-developer`: **a confirmed flow, a text wireframe, and a complete states list.** Whether the built composition, palette and staging read well is `visual-craft`'s, afterwards.

```
- [ ] 1. Flow mapped (goal, entry point, steps, branches, where it lives)
- [ ] 2. Wireframe + every state listed + surplus space named
- [ ] 3. Accessibility pass
- [ ] 4. Notification tier chosen; transient exits designed; dark-pattern screen
- [ ] 5. First-session path checked
- [ ] 6. Copy: action names consistent, errors say what to do next
```

## 1. Map the flow - always first

- What is the user trying to do, and what brought them here? Steps from entry to goal; cut steps to the minimum actions to value.
- Decision points and branches ("if they can't afford it, show X").
- **Extend an existing surface before adding a new one.** A new top-level surface is a bigger decision than it looks; don't reach for it by default.
- **No interruption fires on its own.** A modal or full-screen takeover is gated behind an explicit user action, never a timer, threshold or app-open event. A first-run sequence is the one legitimate exception, and a deliberate, named one.
- **Before writing a tutorial or hint, check whether existing UI already teaches the behavior.** One design pass that assumed three gaps needed new copy found most were already self-teaching; only the genuinely untaught behavior earns copy.

## 2. Wireframe and states

- Text wireframe: regions, elements, hierarchy - no visual style yet.
- **One primary action per screen.** Two competing primaries means restructure.
- Primary actions within easy reach of the input method (thumb zone on touch, the natural cursor path on desktop).
- **Compose for a range of viewport sizes and name where surplus space goes** (a scroll region, a spacer, a background). Left unnamed, it lands wherever an unrelated flexible rule sits - invisible in any capture taken at the one size you designed for.
- **Keep interactive content out of hardware and OS keep-out zones** (notches, status bars, gesture edges) - an authoring rule to check, not something the runtime handles for you.
- **List every state:** locked or teaser, first-time, empty, loading, active, error. Say what each communicates.
- **Mystery-lock or full transparency, chosen per screen.** A discovery screen may hide locked content; a planning screen shows its name, cost and requirements up front. Say which and why.
- **A locked or empty state gets a headline, a one-line reason, a visual cue, and a next step where one exists.** "Check back later" is worse than either a plain dimmed lock or a real reason.
- **A newly interactive element needs a visible affordance** (icon, highlight, chevron, caption) specified in the design. Wireframes describe what an element does and routinely forget that it must *look* actionable.
- **Say whether each visual signal invites or informs.** Inviting signals draw attention (a glow, a pulse, a badge); informative ones are legible but recede (a label, a count). The distinction (Celia Hodent's inviting and informative signs, from game UX) generalizes well and stops an informative element being animated into a nag. If a control needs a caption to explain its own verb, question the control first.

## 3. Accessibility - not skipped for a prototype

Design-time items, stated against WCAG 2.2 AA, the current W3C Recommendation. Many legal baselines still cite WCAG 2.1 AA (the US ADA Title II rule, the EU harmonised standard until its 2.2-aligned revision is cited); 2.2 AA covers 2.1 AA, so design to 2.2.

- **Color never carries meaning alone** - pair it with a shape, icon, sign or label.
- **Contrast** meets 4.5:1 for normal text and 3:1 for large text and for UI components and meaningful graphics. Computed, not eyeballed (`visual-craft`).
- **Targets:** the WCAG floor is 24x24 CSS px (or equivalent spacing); platform guidance is larger (44x44 pt on Apple platforms, 48x48 dp on Android). Design to the platform number.
- **Every function works from a keyboard**, with a visible focus indicator that sticky headers, banners or overlays never hide.
- **Drag has a single-pointer alternative** (buttons, tap-to-place) unless dragging is essential.
- **Visible labels on inputs**, never placeholder-only. Don't make people re-enter what they already gave in the same flow.
- **Sign-in needs no memory or puzzle test** - allow paste and password managers; offer an alternative to cognitive challenges.
- **Help, if offered, sits in the same place on every screen.**
- **Motion is an accessibility axis.** Large parallax, shake and full-viewport transitions are documented motion-sickness triggers; design the reduced-motion version alongside them. Sustained small motion should read as noticeable, not nagging.

## 4. Notifications, trust, and dark patterns

- **Pick the intrusiveness tier by urgency, not by how much the feature wants attention.** Cheapest to loudest: a passive badge on a persistent entry point; a dismissible banner for time-sensitive but non-critical news; a full takeover only for what genuinely needs undivided attention now, still gated behind a user action where possible.
- **A transient surface owns its exit as a designed state:** when it goes away (dismissal, after one read or cycle - never "frozen with no way out") and whether it returns on reload. A notification with no designed exit gets reported as "it's stuck."
- **Screen for dark patterns before finalizing anything with a monetization or engagement angle - as compliance, not taste.** Several jurisdictions regulate these: the EU's Digital Services Act bars online platforms from interfaces that deceive or manipulate users, and consumer-protection and subscription-renewal law applies more widely. Check explicitly for: nagging, forced continuity (cancelling harder than signing up), confirmshaming, roach motel, disguised ads, and costs revealed only at the last step. **Never sell the recovery from a user's own mistake** - an undo or restore that is paywalled only for people who tripped it by accident is the shape to flag hardest. Anything with real psychology or money stakes gets a second look from someone other than its designer.

## 5. First session and onboarding

- **Teach by doing.** The most-cited onboarding failure is a lock-out tutorial that allows one action and blocks everything else. A real, hand-authored first instance of a mechanic teaches better than an overlay describing it. One new concept per beat.
- **A forced linear sequence (no skip, no back) is a deliberate override,** reserved for a true first run. Every further guided sequence argues its case from scratch.
- **Time to first value** - roughly how long a new user takes to reach the core action. A long stretch of setup before it is a design problem, not the cost of onboarding.

## 6. Copy and handoff

Tone and function can both bind; **function wins on anything the user acts on.**

- **An action keeps one name through the flow.** "Delete" produces a confirmation that says "Deleted," not "Operation complete." A committing button names its verb ("Delete file", "Send €50"), never a bare "OK."
- **Name what the user controls, not how it's built.** Files, messages and orders - never a "handler" or a "state." A leaked implementation noun is a copy defect.
- **An error says what happened and what to do next,** in the product's voice, without apology or vagueness. "Something went wrong" is a stub.
- **Each element does one job.** A label carrying both a joke and the only statement of a rule loses the rule for everyone who skims past the joke. Split it into two lines.

## Judgment: push back, don't validate

When the asked-for direction is weaker than one you can see, say so before executing, with the trade-off. On a project without a design team, the pushback is often this skill's most valuable output. Hold it under mild pushback if the reasoning stands; once the owner decides, record it as a deliberate override and don't re-litigate without new information. Never invent a UX statistic or cite an unnamed study.

## Mistakes to flag

- Visuals or mockups requested before a flow exists - produce the flow first.
- Two competing primary actions on one screen.
- An interaction pattern inconsistent with existing surfaces, with no stated reason.
- Accessibility skipped because "it's a prototype."
- An interruption that auto-fires off a background condition.
- A locked or empty state that is only a greyed-out control.
- An interactive element with no visible affordance.
- A notification louder (or quieter) than its urgency.
- A monetization or engagement design with no independent second look.
- An action whose name changes between control, confirmation and result.
- An error with no next step; a label doing two jobs.
- A UX claim resting on an invented statistic.
- A direction validated because it was asked for, when a stronger one went unmentioned.
- The same correction absorbed twice without being written down.

Recurring display and state defects from shipped work - read before reviewing shipped UI or when a defect "feels familiar": `references/field-lessons.md`.
