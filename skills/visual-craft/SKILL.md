---
name: visual-craft
description: Judges and fixes whether a visual surface actually looks right - composition and focal hierarchy, palette, typography roles, material consistency, spatial staging, contrast and colorblind checks, and screenshot-based QA of icons, UI chrome, backdrops, 3D scenes and generated assets. Use once flow and implementation are correct and the question is "does this look right", including when something only "looks off" or "looks cheap". Not for flow, wireframes or screen states (ux-design) or implementation correctness (frontend-developer).
license: MIT
---

# Visual Craft

You own whether something *looks* right, in any medium: UI chrome, icons, logos, backdrops, illustration, 3D scenes, generated or procedural assets. `ux-design` owns the flow, wireframe and states (the *what* and *where*); `frontend-developer` owns implementation correctness. This skill starts once both are right. Where a rule carries extra weight for 3D-scene work, it says so.

## 1. Anchor the visual language before touching an object

- **Extend what exists; never invent a style in isolation.** Anchor to shipped assets, reference images, a written palette or token file - and re-open that reference at every addition, not from memory of it. A "style" is a stack of separate decisions (shape language, value range, palette, material vocabulary); camera, perspective and layout are a *presentation* layer on top. Name which layer a complaint lives in before fixing it.
- **Know the generic default before you land on it by accident.** Each domain has instantly recognizable defaults (the dark fintech dashboard, the cream-and-terracotta startup palette, the stock-photo hero banner). Landing on one unexamined is not a choice; name it and either justify it or move off it.
- **Resolve composition in value before color.** Check focal hierarchy and depth in grayscale or silhouette first - at the scale of the whole screen or scene (one dominant value mass), each asset (a clear silhouette), and UI-over-content (the UI holds its own value territory). A composition that doesn't read in value is not rescued by a palette.
- **One dominant focal read per frame.** Two elements competing for first glance is a composition bug, not a taste disagreement.
- **Small, reused palette.** Vary value and saturation within a few hues rather than adding hues. A new color needs a stated reason tied to meaning, never "it looked nice" on one element or a generated asset that drifted.
- **Materials agree.** Everything sharing a space agrees on how shiny, rough or flat it reads, and each material reads as its substance before any label does. Copy-pasting one element's setup without checking its neighbors is the usual way this breaks. 3D specifics: `references/3d-staging-and-performance.md`.
- **Typography is an identity decision.** Name each font role (display, body, numerals) and give any new typeface a stated reason, like a new color. Keep to a small reused type scale - roughly two sizes or weights per screen unless justified. Live-updating numerals need tabular (fixed-width) digits so a changing value never reflows the layout.

## 2. Grouping and staging

- **Group the way the eye groups.** Proximity, similarity and common region make separate things read as one cluster; figure-ground keeps an interactive element from melting into a busy background. Readability first (silhouette, value, grouping), then hierarchy.
- **Never place an object in a fixed, non-orthogonal camera by eyeballing.** Translating "top-left" into world coordinates by intuition is one of the most repeated gaps in 3D work. Sample the engine's world-to-screen projection at known landmarks and trust that mapping. Block out new layouts with placeholder shapes first. Detail: `references/3d-staging-and-performance.md`.

## 3. 2D and UI quality

- One icon set shares stroke weight, corner radius and shadow depth; a single mismatch reads as "wrong" faster than any quality gap.
- Judge legibility at the real render size, never at generation or preview size - crisp at 512 px can be mush at 48 px.
- Once a shared chrome, panel or shadow system exists, a bespoke per-screen treatment is a regression.
- **Color never carries meaning alone** - pair it with a shape, icon, sign or label. **Contrast is computed, not eyeballed:** the WCAG 2.x formula and AA thresholds (4.5:1 normal text; 3:1 large text and for UI components and meaningful graphics) are the current conformance bar. Compute from a rendered capture, not stored constants - a renderer's color space can make a stored value lie. Check color-vision deficiency with a simulator on a real capture.

## 4. Verification - check, don't just judge

- **A rendered capture is the ground truth** for "did it draw, and where." Geometry hidden behind an opaque element at the same depth, or a color-parsing bug that blows a value to white while the stored value looks fine, are found only this way.
- **A capture from a live edit or hot-reload session proves only the live state.** Redo accepted values as persisted edits and re-capture from a fresh session.
- **Compare against the reference file, every time**, not memory of it.
- **More than one distance, angle and viewport shape.** Many defects exist at only one framing.
- **Check a growing set together** (a contact sheet or grid), not only piece by piece - palette, scale and silhouette drift exist only in the comparison.
- **Every real state gets a look** - empty, locked, first-time - not "later polish."
- **A vision-model read - your own included - is a measurement, not a taste authority.** Diff against a reference, name the checkable heuristic before judging, describe the image before evaluating it, crop to the asset under review, and keep a human as the final judge of style.
- **State the trade-off when a fix isn't free** (a zoom that helps the common case but risks cropping on an untested aspect ratio).

Verification detail, generated-asset acceptance, and when tooling earns its cost: `references/verification-and-tooling.md`.

## Mistakes to flag

- A 3D object placed by eyeballed screen position instead of a verified projection.
- A computed position, color or bounds trusted without a capture.
- A new color, typeface, material or pattern added without checking precedent.
- A surface that landed on a recognizable generic default without naming it.
- A scene or asset judged from one distance, angle or viewport.
- A growing asset set reviewed only piece by piece.
- An empty, locked or first-time state deferred as "polish."
- Full detail built on a new layout before a placeholder pass confirmed it.
- Live-updating numerals without tabular digits.
- A contrast or colorblind claim made by eye or from stored constants.
- "Does this look right?" put to a vision model with no reference, heuristic or describe-first step.
- A new tool or pipeline adopted from habit rather than a stated gap.
