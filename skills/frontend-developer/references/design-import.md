# Importing an external design mockup - literal extraction, not visual reproduction

Use for any pass that imports an externally-produced design deliverable: a new mockup, a redesign round, a rework of an existing screen against a fresh render. Skip for small tweaks with no external mockup behind them.

**The rule: the mockup file's literal values are the spec.** Pointing an agent at a mockup and asking it to "build this screen" produces a *visual reproduction* - it reads the render, estimates a radius or spacing by eye, and ships something close. Close is exactly how one project shipped two different card corner radii side by side for weeks and kept re-growing a thin inset border nobody had chosen. This pipeline makes literal extraction the default instead of an occasional discipline.

## The seven steps

**1. Find the real spec file.** Deliverables often arrive as an archive; the file that matters is the source mockup (HTML/CSS, a design-tool export with real values), not a screenshot or preview image. Open the raw file.

**2. Literal extraction - declared values AND resolved geometry.** Pull every in-scope token into a table, one row each: color (with alpha recorded *separately*), corner radius, padding/margin/gap, font family/weight/size/line-height, shadow (offset, blur, spread, color, opacity), gradient stops. Grep the literal attribute values - a number read off a screenshot is already a reproduction.

Declared styles are not the whole spec. **Two review rounds on one project each verified every extracted value correctly and the result still read visibly off,** because grepping styles yields the *declared* values a layout engine consumes, never the *resolved* final positions and sizes after layout actually runs. The fix was a small script that loads the mockup in a headless browser at the product's reference viewport and dumps every element's resolved box and computed style to JSON. Use both: declared values feed the conversion table, resolved geometry is what the built layout gets checked against.

**3. Copy assets verbatim first.** Any image, icon, or font the mockup references is copied into the project before conversion. A regenerated or redrawn equivalent is a different asset.

**4. Conversion pass, written down.** Map each extracted value to the target stack, one line per token, recording the *mapping* and not just the result, so a reviewer can check the conversion itself:
- Units against the target's own reference scale.
- **Color and alpha re-measured, not copied**, whenever the target renders in a different color space than the mockup. One measured case: a border alpha declared as 0.10 in the mockup needed 0.025 in a linear-color renderer to look the same; a literal copy would have shipped visibly wrong. Re-derive against a real in-product capture.
- Radii, spacing, and type onto the project's existing token set. A mockup value that doesn't match an existing token is a **decision point for the written plan** - never a silent new token and never a per-element override.
- Layout structure onto the project's settled layout patterns - don't invent a new pattern to mirror the mockup's markup.

**5. Written plan, including exclusions.** Per screen and component: the converted values, where each lands in the codebase, and **which parts of the mockup are illustrative and deliberately not being taken**. Precedent: a rework took a mockup's aesthetic direction but refused its literal positioning of interactive elements, because that geometry was behavior-locked in code and the mockup's numbers were never meant to move it. A plan that doesn't name its exclusions invites accidental value-copying.

**6. Review the plan** against binding constraints (the token set, locked mechanics) and get sign-off on anything touching copy. Even a pass that feels small - both incidents above survived several sessions because they read as too minor to plan.

**7. Implement the reviewed values.** Re-interpreting a value during the build, even in a direction that looks better, is a deviation that goes back through steps 5-6, not a style choice.

## Verify shared changes before building on them

**A pixel-level check against the mockup is required immediately after any shared or foundational visual change** (a button system, a panel primitive, a type-scale change) - before any other screen is built on top. On one import, a defect in a shared button was found only at the end, after eight more screens had been built on the unverified fix, so the rework touched far more than it needed to. Per-screen content changes can wait for the end-of-pass sweep; shared infrastructure cannot.

**Make the comparison numeric.** Every comparison that consisted of two images read side by side by a person or an agent produced individually-verified-but-still-wrong rounds. A real pixel diff reports a mismatch percentage and a highlight image of exactly where the drift is. It doesn't replace human judgment - text regions differ structurally across rendering engines - but it turns "does this look right" into a number to start from.

## What this replaces, and what it doesn't

It replaces "launch an agent at the mockup, then review the result," which puts the literal-vs-reproduced check after the build, when drift is a diff against working code. It does not replace `visual-craft`'s post-build "does this actually look right" pass, which catches composition problems rather than spec fidelity.
