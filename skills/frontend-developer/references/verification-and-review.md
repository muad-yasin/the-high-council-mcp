# Verifying frontend work, and reviewing someone else's

## 1. Real verification, not a compile and a glance

- **Drive the real interaction path, not a direct programmatic call to the handler.** Calling a click handler in code bypasses hit-testing, so it structurally cannot catch an element that's visually present but not clickable (wrong stacking order, an invisible overlay stealing input, a hit area smaller than the art). Drive input through the framework's real event/hit-test path, with a real frame boundary after any activation.
- **All states rendered.** For each data-bound screen, drive every state on the design's list (locked, first-time, empty, loading, active, error) and confirm each renders.
- **Multiple viewport shapes.** Keep a small named set and pick per job: a short design floor (compression and overflow), the most common real device shape (the default for anything a human reads), a tall/wide ceiling (maximum surplus, for automated sweeps), and a split-screen/tablet shape (exercises width caps and fit rules). Surplus-space defects are monotone in surplus, so one ceiling covers the whole tall range - an intermediate shape adds no new bug class.
- **Computable accessibility checks - the cheapest real win.** Contrast is deterministic from two colors (WCAG AA: 4.5:1 normal text, 3:1 large text and non-text UI components) - compute it from rendered colors, never source constants, because a renderer's color space can make a stored value lie about brightness. Hit-target minimums are readable straight off element bounds. Color-alone is checkable *structurally*: does every color-coded state also set an icon, shape, sign, or label?
- **Keyboard and screen-reader pass.** Tab through every state: order is logical, focus is always visible and never hidden under a sticky element, dialogs trap and return focus, every control announces a name and role. Automated rule engines (axe-core and similar) catch a useful subset of WCAG failures cheaply - run one - but a clean automated report is not a conformance claim.
- **Pseudolocalization, even for a single-language product.** Lengthen every string by about 40% (Microsoft's heuristic for English source text; short strings grow proportionally more) and swap in accented glyphs: it surfaces the whole fixed-container-overflow class in one pass instead of one instance at a time, and catches missing glyphs at the same time.

## 2. Signals that lie

- **Property reads about rendering can mislead.** On one project a text element's mesh vertex count reported a tiny number for text that was visibly fine (the text rendered through a different pipeline), and a "rendered width" read returned a garbage negative value that meant "not laid out yet," not "broken" - two wrong diagnoses were chased before either signal was checked against a known-good control. **When the question is "did this draw," a capture beats a property read.**
- **A capture is the right instrument for "did it draw," and the wrong one for "is the hierarchy correct."** A correctly-rendered element placed inside the wrong parent looks fine in a screenshot.
- **Screenshot/visual-regression diffs are a signal, never a gate.** Font rendering and anti-aliasing differ across environments; a nonzero diff on text-heavy regions is expected and still needs a human call.
- **Text verification is not visual verification.** Two review rounds once verified every extracted design value against the spec and the code, correctly - and both missed the headline defect: a dark ring on every tall button, caused by two independently correct values (a glow radius and a fill shape's corner radius) that were wrong only together. Only rendering them on top of each other finds that class.
- **A live-session capture proves only the live state.** It says nothing about whether the value persisted after the session ended.

## 3. Why you cannot self-certify UI - the evidence, graded

- **Accessibility / color-alone - STRONG (peer-reviewed).** "Generated Inaccessible: Measuring WCAG Violations in AI UI Design Tools" (Web for All conference, W4A 2026) found overall WCAG compliance of 29.0%, contrast 26.8%, and use of color 19.2% - use of color being among the most deterministic criteria. Naming accessibility requirements in the prompt *decreased* compliance. Intent is not a control; a structural pairing plus a computed check is.
- **Happy-path bias - MODERATE (preprints, 2025).** An empirical study of LLM-generated code robustness (arXiv 2503.20197) found about 43% of generated solutions less robust than human-written ones, with over 90% of the gaps being missing input or null checks.
- **Locale-sensitive parsing - MODERATE, canonical.** One of the most reproduced bugs across language ecosystems; a model trained on that corpus reproduces the unpinned default by reflex.
- **Verification shortcuts / reward hacking - STRONG (benchmarked).** Third-party benchmarks of coding agents (ImpossibleBench, 2025; SpecBench, 2026) observed agents editing tests, special-casing inputs and memorizing expected outputs when the grader allowed it. The cheapest passing signal is the tempting one.
- **Magic-number layout - THIN (practitioner-anecdotal).** The claim that generated UI bolts on ad hoc constants instead of measured constraints matches real wrapping-text histories but rests on reports, not a study. A prior, not a finding.

## 4. Reviewing someone else's frontend diff

Every item restates a SKILL.md rule in the form you'd catch it in review. The instinct behind the list: when a change adds a branch or special case, ask whether it can be reframed so whole branches disappear - "but it works" is not an approval bar.

- A missing locked/empty/first-time/loading/error state, or an interactive element with no interactivity affordance.
- Logic creeping into a component, or callers reaching into a component's children.
- Polling instead of subscribing; subscribing without cleanup.
- A guessed data shape; a preview amount re-derived inline instead of through the committing layer's own call.
- A duplicate of an established pattern (layout, list, animation, input) without a stated reason.
- A third boolean in show logic where one state value belongs.
- A thin wrapper or builder abstraction that adds indirection without buying clarity.
- A fixed-size container around dynamic content with no growth or truncation, unchecked against the longest real value.
- No named destination for surplus space; a text element acting as the absorber.
- An overflow effect shrunk to fit a clipping parent.
- A press-and-hold with a release path that doesn't reach the shared reset.
- A lifecycle handler with no answer for firing twice.
- A number formatted or parsed without a pinned locale; a literal string parsed.
- Color as the only carrier of meaning; a hit target under the platform minimum.
- A clickable non-native element with no role, name or keyboard handling; an icon-only control with no accessible name; focus that can land under a sticky header or escape an open dialog.
- A glyph not confirmed in the loaded font.
- A live-session edit trusted as final; a handler invoked in code offered as proof of clickability; a single-viewport capture offered as proof of layout.

Don't claim any check above as "in place" for a project unless it actually runs there.
